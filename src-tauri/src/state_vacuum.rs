use super::*;
use crate::vacuum;
impl AppState {
    async fn ensure_vacuum_context(
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
        vacuum::validate_device(&d)?;
        if !d.online {
            return Err(AppError::new(
                "offline",
                "扫地机器人离线，恢复在线后可操作。",
                true,
            ));
        }
        if write && d.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享设备仅允许查看。",
                false,
            ));
        }
        Ok(())
    }
    pub async fn vacuum(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<vacuum::Report> {
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        let r = self.handle(&c, vacuum::read(&c, &d, true).await).await?;
        self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn change_vacuum(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: vacuum::Change,
    ) -> Result<vacuum::Changed> {
        let _guard = self.vacuum_write.lock().await;
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, true)
            .await?;
        let before = self.handle(&c, vacuum::read(&c, &d, false).await).await?;
        if before.baseline != baseline {
            return Err(AppError::new(
                "conflict",
                "设备状态已变化，正在更新，请按当前状态重新操作。",
                true,
            ));
        }
        let (method, params) = vacuum::command(&d, &before, &change)?;
        self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, true)
            .await?;
        if let Err(e) = self
            .handle(&c, vacuum::send(&c, &d, method, params).await)
            .await
        {
            if !write_error_is_uncertain(&e) {
                return Err(e);
            }
        }
        let mut latest = None;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, false)
                .await?;
            match self.handle(&c, vacuum::read(&c, &d, false).await).await {
                Ok(r) => {
                    self.ensure_vacuum_context(&home_id, generation, &did, &c, &d, false)
                        .await?;
                    if vacuum::matches(&r, &change) {
                        return Ok(vacuum::Changed {
                            report: r,
                            confirmed: true,
                        });
                    }
                    latest = Some(r);
                }
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => {}
            }
        }
        latest
            .map(|report| vacuum::Changed {
                report,
                confirmed: false,
            })
            .ok_or_else(|| AppError::new("uncertain", "设备状态尚未确认，未重复发送。", true))
    }
}
