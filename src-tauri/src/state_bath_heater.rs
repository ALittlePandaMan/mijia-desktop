use super::*;
use crate::bath_heater as bath;
impl AppState {
    async fn ensure_bath_context(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        cloud: &Arc<Cloud>,
        device: &Device,
        write: bool,
    ) -> Result<()> {
        let (c, d) = self.device(home, generation, did).await?;
        if !Arc::ptr_eq(&c, cloud)
            || d.model != device.model
            || d.control_did() != device.control_did()
        {
            return Err(AppError::stale());
        }
        bath::validate_device(&d)?;
        if !d.online {
            return Err(AppError::new(
                "offline",
                "浴霸离线，恢复在线后可操作。",
                true,
            ));
        }
        if write && d.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享设备仅有读取权限。",
                false,
            ));
        }
        Ok(())
    }
    pub async fn bath_heater(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<bath::Report> {
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_bath_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        let r = self.handle(&c, bath::read(&c, &d).await).await?;
        self.ensure_bath_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn change_bath_heater(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: bath::Change,
    ) -> Result<bath::Changed> {
        let _guard = self.bath_heater_write.lock().await;
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_bath_context(&home_id, generation, &did, &c, &d, true)
            .await?;
        let before = self.handle(&c, bath::read(&c, &d).await).await?;
        if before.revision != baseline {
            return Err(AppError::new(
                "conflict",
                "浴霸状态已变化，正在更新，请按当前状态重新操作。",
                true,
            ));
        }
        let (method, params) = bath::command(&before, &change)?;
        self.ensure_bath_context(&home_id, generation, &did, &c, &d, true)
            .await?;
        // Absolute local intents are idempotent. In particular, disabling an
        // already absent mode must not stop a different active mode.
        if matches!(
            &change,
            bath::Change::Mode {
                enabled: Some(_),
                ..
            }
        ) && bath::matches(&before, &before, &change)
        {
            return Ok(bath::Changed {
                report: before,
                confirmed: true,
            });
        }
        let sent = self
            .handle(&c, c.bath_heater_rpc(&d, method, params).await)
            .await;
        if let Err(e) = sent {
            if !write_error_is_uncertain(&e) {
                return Err(e);
            }
        }
        let mut latest = None;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            self.ensure_bath_context(&home_id, generation, &did, &c, &d, false)
                .await?;
            match self.handle(&c, bath::read(&c, &d).await).await {
                Ok(r) => {
                    self.ensure_bath_context(&home_id, generation, &did, &c, &d, false)
                        .await?;
                    if bath::matches(&before, &r, &change) {
                        return Ok(bath::Changed {
                            report: r,
                            confirmed: true,
                        });
                    }
                    latest = Some(r)
                }
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => {}
            }
        }
        latest
            .map(|report| bath::Changed {
                report,
                confirmed: false,
            })
            .ok_or_else(|| {
                AppError::new(
                    "uncertain",
                    "暂未确认浴霸状态，正在重新读取；未重复下发。",
                    true,
                )
            })
    }
}
