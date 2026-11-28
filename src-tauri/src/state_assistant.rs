use super::*;
use crate::cloud_assistant::{self, authorization::Poll, Status};
impl AppState {
    /// Refresh account transport credentials only. The caller must decide whether
    /// its original operation is safe to retry; this helper never replays it.
    pub(crate) async fn refresh_mijia_session(&self) -> Result<()> {
        let (cloud,_)=self.assistant_identity().await?;
        self.refresh_mijia_for(&cloud).await
    }
    pub(super) async fn refresh_mijia_for(&self, expected:&Arc<Cloud>) -> Result<()> {
        let epoch = {
            let inner = self.session_state().lock().await;
            if !inner.authenticated() || !inner.cloud.as_ref().is_some_and(|v| Arc::ptr_eq(v, expected)) {
                return Err(AppError::stale());
            }
            inner.auth_version
        };
        let cloud = expected;
        let credentials=Box::pin(self.assistant.refresh_mijia(&cloud.credentials,epoch)).await?;
        if credentials.user_id!=cloud.credentials.user_id||credentials.region!=cloud.credentials.region{return Err(AppError::stale());}
        let refreshed=Arc::new(Cloud::new(credentials)?);
        let mut inner=self.session_state().lock().await;
        if !inner.authenticated()||inner.auth_version!=epoch||!inner.cloud.as_ref().is_some_and(|v|Arc::ptr_eq(v,cloud)){return Err(AppError::stale());}
        auth::save(&refreshed.credentials)?;
        inner.cloud=Some(refreshed);
        // Same account and permissions: keep auth_version/auth_epoch and logical
        // assistant generation stable; only the transport SID was renewed.
        Ok(())
    }
    pub(crate) async fn assistant_identity(&self) -> Result<(Arc<Cloud>, u64)> {
        let inner = self.inner.lock().await;
        if !inner.authenticated() {
            return Err(AppError::auth());
        }
        Ok((
            inner.cloud.clone().ok_or_else(AppError::auth)?,
            inner.auth_version,
        ))
    }
    async fn check_assistant_identity(&self, cloud: &Arc<Cloud>, epoch: u64) -> Result<()> {
        let (current, version) = self.assistant_identity().await?;
        if !Arc::ptr_eq(&current, cloud) || epoch != version {
            Err(AppError::stale())
        } else {
            Ok(())
        }
    }
    pub async fn assistant_status(&self, refresh: bool) -> Result<Status> {
        let (cloud, epoch) = match self.assistant_identity().await {
            Ok(v) => v,
            Err(_) => return Ok(Status::unavailable("loginRequired")),
        };
        if refresh {
            self.assistant.reconnect(&cloud.credentials, epoch).await?;
        } else {
            let _ = self.assistant.ensure_connected(&cloud.credentials, epoch).await;
        }
        let status = self.assistant.status(&cloud.credentials, epoch).await?;
        self.check_assistant_identity(&cloud, epoch).await?;
        Ok(status)
    }
    pub async fn start_assistant_authorization(&self) -> Result<QrView> {
        let (cloud, epoch) = self.assistant_identity().await?;
        let qr = Box::pin(self.assistant.start(&cloud.credentials, epoch)).await?;
        self.check_assistant_identity(&cloud, epoch).await?;
        Ok(qr)
    }
    pub async fn poll_assistant_authorization(&self, id: String) -> Result<Poll> {
        let (cloud, epoch) = self.assistant_identity().await?;
        let result = Box::pin(self.assistant.poll(&cloud.credentials, epoch, &id))
            .await
            .map_err(|e| {
                if e.kind == "authExpired" {
                    cloud_assistant::error("assistantAuthorizationRequired")
                } else {
                    e
                }
            })?;
        self.check_assistant_identity(&cloud, epoch).await?;
        if result.status=="success" {
            // The revalidation scan already obtained a fresh MIjIA SID. Adopt
            // that exact session without another exchange or replaying a call.
            let credentials=self.assistant.saved_mijia(&cloud.credentials,epoch).await?;
            if credentials.user_id!=cloud.credentials.user_id||credentials.region!=cloud.credentials.region{return Err(AppError::stale());}
            let refreshed=Arc::new(Cloud::new(credentials)?);
            let mut inner=self.session_state().lock().await;
            if !inner.authenticated()||inner.auth_version!=epoch||!inner.cloud.as_ref().is_some_and(|v|Arc::ptr_eq(v,&cloud)){return Err(AppError::stale());}
            auth::save(&refreshed.credentials)?;inner.cloud=Some(refreshed);
        }
        Ok(result)
    }
    pub async fn cancel_assistant_authorization(&self, id: String) -> Result<()> {
        self.assistant.cancel_login(&id).await;
        Ok(())
    }
    pub async fn revoke_assistant_authorization(&self) -> Result<()> {
        let (cloud,epoch)=self.assistant_identity().await?;
        self.assistant.prepare_bootstrap(&cloud.credentials,epoch).await?;
        self.assistant.revoke().await
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn native_authorization_entries_have_bounded_futures() {
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let state = AppState::with_session(None, None).unwrap();
                let status = state.assistant_status(false);
                let login = state.poll_login("mock-only".into());
                let start = state.start_assistant_authorization();
                let poll = state.poll_assistant_authorization("mock-only".into());
                for (name, size) in [
                    ("status", std::mem::size_of_val(&status)),
                    ("login", std::mem::size_of_val(&login)),
                    ("start", std::mem::size_of_val(&start)),
                    ("poll", std::mem::size_of_val(&poll)),
                ] {
                    eprintln!("native assistant {name} future: {size}");
                    assert!(size < 128 * 1024, "{name}: {size}");
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
