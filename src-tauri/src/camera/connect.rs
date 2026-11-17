//! Race transport acquisition only. Exactly one returned socket performs MISS auth/video start.
use super::{startup::Route, transport::Connection, *};
use std::sync::mpsc;
pub(super) fn race(
    config: &Config,
    stop: &AtomicBool,
    hint: Option<Route>,
) -> Result<(Connection, Route)> {
    race_routes(config, stop, hint, true)
}
pub(super) fn race_remote(config: &Config, stop: &AtomicBool) -> Result<(Connection, Route)> {
    race_routes(config, stop, None, false)
}
fn race_routes(
    config: &Config,
    stop: &AtomicBool,
    hint: Option<Route>,
    allow_local: bool,
) -> Result<(Connection, Route)> {
    let routes = [Route::Local, Route::Relay, Route::Punch]
        .into_iter()
        .filter(|r| match r {
            Route::Local => allow_local && config.host.is_some(),
            _ => config.uid.is_some(),
        })
        .collect::<Vec<_>>();
    race_candidates(&routes, stop, |route, cancel| {
        let delay = if hint == Some(route) || hint.is_none() && route != Route::Punch {
            0
        } else if hint.is_some() {
            250
        } else {
            1000
        };
        let until = Instant::now() + Duration::from_millis(delay);
        while Instant::now() < until {
            if cancel.load(Ordering::Acquire) {
                return Err(AppError::stale());
            }
            std::thread::sleep(Duration::from_millis(20));
        }
        if cancel.load(Ordering::Acquire) {
            return Err(AppError::stale());
        }
        match route {
            Route::Local => Connection::connect(config.host.ok_or_else(AppError::stale)?, cancel),
            Route::Relay => Connection::from_relay(super::relay_list::connect(
                config.uid.as_ref().ok_or_else(AppError::stale)?,
                &config.servers,
                cancel,
            )?),
            Route::Punch => Connection::from_relay(super::relay::connect(
                config.uid.as_ref().ok_or_else(AppError::stale)?,
                cancel,
            )?),
        }
    })
}
/// A private address can belong to a different home on the current LAN.
/// Validate one transport at a time; a rejected local peer never suppresses the signed remote route.
pub(super) fn authenticated<T>(
    primary: impl FnOnce() -> Result<(T, Route)>,
    remote: impl FnOnce() -> Result<(T, Route)>,
    mut validate: impl FnMut(&mut T, Route) -> Result<()>,
    has_remote: bool,
    stop: &AtomicBool,
) -> Result<(T, Route)> {
    let (mut value, route) = primary()?;
    match validate(&mut value, route) {
        Ok(()) => Ok((value, route)),
        Err(error) => {
            if route != Route::Local || !has_remote || stop.load(Ordering::Acquire) {
                return Err(error);
            }
            drop(value);
            let (mut value, route) = remote()?;
            validate(&mut value, route)?;
            Ok((value, route))
        }
    }
}
fn race_candidates<T: Send>(
    routes: &[Route],
    stop: &AtomicBool,
    connect: impl Fn(Route, &AtomicBool) -> Result<T> + Sync,
) -> Result<(T, Route)> {
    if routes.is_empty() {
        return Err(err("videoTransportUnavailable", "没有可用的视频连接路径。"));
    }
    let cancels = routes
        .iter()
        .map(|_| AtomicBool::new(false))
        .collect::<Vec<_>>();
    std::thread::scope(|scope| {
        let (tx, rx) = mpsc::channel();
        for (&route, cancel) in routes.iter().zip(&cancels) {
            let tx = tx.clone();
            let connect = &connect;
            scope.spawn(move || {
                let result = connect(route, cancel);
                let _ = tx.send((route, result));
            });
        }
        drop(tx);
        let mut remaining = routes.len();
        let mut last = AppError::protocol();
        let result = loop {
            if stop.load(Ordering::Acquire) {
                break Err(AppError::stale());
            }
            match rx.recv_timeout(Duration::from_millis(20)) {
                Ok((route, Ok(value))) => break Ok((value, route)),
                Ok((_, Err(error))) => {
                    last = error;
                    remaining -= 1;
                    if remaining == 0 {
                        break Err(last);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => break Err(last),
            }
        };
        for cancel in &cancels {
            cancel.store(true, Ordering::Release);
        }
        result
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rejected_foreign_local_address_falls_back_to_signed_remote_once() {
        let stop = AtomicBool::new(false);
        let mut calls = vec![];
        let result = authenticated(
            || Ok((0, Route::Local)),
            || Ok((1, Route::Relay)),
            |value, route| {
                calls.push(route);
                if *value == 0 {
                    Err(err("videoAuthRejected", "foreign local peer"))
                } else {
                    Ok(())
                }
            },
            true,
            &stop,
        )
        .unwrap();
        assert_eq!(result, (1, Route::Relay));
        assert_eq!(calls, vec![Route::Local, Route::Relay]);
    }
    #[test]
    fn remote_auth_rejection_does_not_repeat_commands() {
        let stop = AtomicBool::new(false);
        let result = authenticated(
            || Ok((1, Route::Relay)),
            || panic!("no repeat"),
            |_, _| Err(err("videoAuthRejected", "rejected")),
            true,
            &stop,
        );
        assert_eq!(result.unwrap_err().kind, "videoAuthRejected");
    }
    #[test]
    fn cancelled_local_auth_never_opens_a_remote_session() {
        let stop = AtomicBool::new(true);
        let result = authenticated(
            || Ok((1, Route::Local)),
            || panic!("cancelled"),
            |_, _| Err(AppError::stale()),
            true,
            &stop,
        );
        assert!(result.is_err());
    }
    #[test]
    fn fast_route_does_not_wait_for_slow_timeout() {
        let stop = AtomicBool::new(false);
        let started = Instant::now();
        let result = race_candidates(&[Route::Local, Route::Relay], &stop, |r, c| {
            if r == Route::Local {
                return Ok(7);
            }
            while !c.load(Ordering::Acquire) {
                std::thread::sleep(Duration::from_millis(1));
            }
            Err(AppError::stale())
        })
        .unwrap();
        assert_eq!(result, (7, Route::Local));
        assert!(started.elapsed() < Duration::from_secs(1));
    }
    #[test]
    fn failures_do_not_cancel_another_viable_route() {
        let stop = AtomicBool::new(false);
        assert_eq!(
            race_candidates(&[Route::Local, Route::Relay], &stop, |r, _| {
                if r == Route::Local {
                    Err(AppError::protocol())
                } else {
                    Ok(2)
                }
            })
            .unwrap(),
            (2, Route::Relay)
        );
    }
    #[test]
    fn stop_cancels_every_candidate() {
        let stop = AtomicBool::new(true);
        assert!(
            race_candidates::<()>(&[Route::Local, Route::Relay], &stop, |_, c| {
                while !c.load(Ordering::Acquire) {
                    std::thread::sleep(Duration::from_millis(1));
                }
                Err(AppError::stale())
            })
            .is_err()
        );
    }
}
