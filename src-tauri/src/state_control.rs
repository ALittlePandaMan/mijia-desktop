use super::*;
use crate::mcp_core::intent::{self, Active};
impl AppState {
    /// UI control commands enter here before native queues.
    pub(crate) async fn with_control_intent<T>(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        future: super::ui_control::ControlFuture<'_, T>,
    ) -> Result<T> {
        if !intent::active_current() {
            return Err(AppError::new(
                "superseded",
                "此操作已被更新的控制意图替代。",
                false,
            ));
        }
        let version = self.property_intents.reserve();
        let scope = self.account_scope().await?;
        let (_, device) = self.device(home, generation, did).await?;
        let key = intent::device_key(&scope, home, device.control_did());
        if let Ok(active) = intent::ACTIVE.try_with(Clone::clone) {
            if active.key == key && Arc::ptr_eq(&active.intents, &self.property_intents) {
                if !intent::active_current() {
                    return Err(AppError::stale());
                }
                return future.await;
            }
        }
        let ticket = self.property_intents.bind(version, [key.clone()]);
        let active = Active {
            intents: self.property_intents.clone(),
            ticket,
            key,
        };
        intent::ACTIVE
            .scope(active, async {
                if !intent::active_current() {
                    return Err(AppError::new(
                        "superseded",
                        "此操作已被更新的控制替代。",
                        false,
                    ));
                }
                let result = future.await;
                if !intent::active_current() {
                    return Err(AppError::new(
                        "superseded",
                        "操作期间出现更新的控制意图，结果未确认。",
                        false,
                    ));
                }
                result
            })
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[tokio::test]
    async fn native_scope_checks_cancelled_queue_and_keeps_account_logged_in() {
        let state = AppState::new().unwrap();
        let cloud = Cloud::new(auth::Credentials {
            user_id: "0".into(),
            security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            service_token: "isolated-fixture".into(),
            region: "cn".into(),
            device_id: "fixture".into(),
            service_id: "xiaomiio".into(),
            c_user_id: "fixture".into(),
        })
        .unwrap();
        let device:Device=serde_json::from_value(serde_json::json!({"did":"fixture","name":"fixture","model":"fixture.airer","online":true,"roomId":"room","roomName":"room"})).unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.cloud = Some(Arc::new(cloud));
            inner.boot_error = None;
            inner.selected = Some("home".into());
            inner.generation = 1;
            inner.devices = vec![device];
        }
        let entered = tokio::sync::Notify::new();
        let resume = tokio::sync::Notify::new();
        let sent = std::sync::atomic::AtomicUsize::new(0);
        let queued = state.with_control_intent("home", 1, "fixture", Box::pin(async {
            entered.notify_one();
            resume.notified().await;
            state.inner.lock().await.check("home", 1)?;
            sent.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
            Ok(())
        }));
        let newer = async {
            entered.notified().await;
            state
                .with_control_intent("home", 1, "fixture", Box::pin(async {
                    state.inner.lock().await.check("home", 1)
                }))
                .await
                .unwrap();
            resume.notify_one();
        };
        let (old, ()) = tokio::join!(queued, newer);
        assert_eq!(old.unwrap_err().kind, "superseded");
        assert_eq!(sent.load(std::sync::atomic::Ordering::Relaxed), 0);
        assert!(state.session().await.unwrap().logged_in);
    }
}
