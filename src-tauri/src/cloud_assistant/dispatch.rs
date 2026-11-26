//! Production admission to bounded cloud execution. No device interpretation here.
use super::error;
use crate::error::Result;
use std::future::Future;
use tokio::sync::Semaphore;
use tokio_util::sync::CancellationToken;

pub const MAX_IN_FLIGHT: usize = 4;

pub struct Dispatcher {
    slots: Semaphore,
}
impl Default for Dispatcher {
    fn default() -> Self { Self { slots: Semaphore::new(MAX_IN_FLIGHT) } }
}
impl Dispatcher {
    pub async fn run<T>(&self, cancel: &CancellationToken, work: impl Future<Output = Result<T>>) -> Result<T> {
        let _slot = tokio::select! {
            biased;
            _ = cancel.cancelled() => return Err(error("assistantCancelled")),
            slot = self.slots.acquire() => slot.map_err(|_| error("assistantCancelled"))?,
        };
        if cancel.is_cancelled() { return Err(error("assistantCancelled")); }
        // Running work owns cancellation so complex sessions can send their
        // best-effort remote cancel. Dropping it here would skip that cleanup.
        work.await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, atomic::{AtomicUsize, Ordering}};
    #[tokio::test]
    async fn four_jobs_run_while_cancelled_or_timed_out_waiters_never_start() {
        let dispatcher = Arc::new(Dispatcher::default());
        let started = Arc::new(tokio::sync::Barrier::new(MAX_IN_FLIGHT + 1));
        let release = Arc::new(Semaphore::new(0));
        let active = Arc::new(AtomicUsize::new(0));
        let mut jobs = vec![];
        for _ in 0..MAX_IN_FLIGHT {
            let (dispatcher, started, release, active) = (dispatcher.clone(), started.clone(), release.clone(), active.clone());
            jobs.push(tokio::spawn(async move { dispatcher.run(&CancellationToken::new(), async move {
                active.fetch_add(1, Ordering::SeqCst); started.wait().await;
                let _permit = release.acquire().await.unwrap();
                Ok(())
            }).await }));
        }
        tokio::time::timeout(std::time::Duration::from_secs(2), started.wait()).await.unwrap();
        assert_eq!(active.load(Ordering::SeqCst), MAX_IN_FLIGHT);
        let attempted = AtomicUsize::new(0); let cancel = CancellationToken::new(); cancel.cancel();
        let error = dispatcher.run(&cancel, async { attempted.fetch_add(1, Ordering::SeqCst); Ok(()) }).await.unwrap_err();
        assert_eq!(error.kind, "assistantCancelled");
        let pending_cancel = CancellationToken::new();
        let waiting = dispatcher.run(&pending_cancel, async { attempted.fetch_add(1, Ordering::SeqCst); Ok(()) });
        let cancel_waiter = async { tokio::task::yield_now().await; pending_cancel.cancel(); };
        let (result, _) = tokio::join!(waiting, cancel_waiter); assert_eq!(result.unwrap_err().kind, "assistantCancelled");
        let timeout_cancel = CancellationToken::new();
        let waiting = dispatcher.run(&timeout_cancel, async { attempted.fetch_add(1, Ordering::SeqCst); Ok(()) });
        assert!(tokio::time::timeout(std::time::Duration::from_millis(10), waiting).await.is_err());
        assert_eq!(attempted.load(Ordering::SeqCst), 0);
        release.add_permits(MAX_IN_FLIGHT);
        for job in jobs { job.await.unwrap().unwrap(); }
        assert_eq!(dispatcher.slots.available_permits(), MAX_IN_FLIGHT);
        dispatcher.run(&CancellationToken::new(), async { Ok(()) }).await.unwrap();
    }
}
