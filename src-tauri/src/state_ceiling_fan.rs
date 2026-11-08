use super::*;
use crate::ceiling_fan as fan;

impl AppState {
    async fn ensure_ceiling_fan_context(
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
        fan::validate_device(&d)?;
        if !d.online {
            return Err(AppError::new(
                "offline",
                "凉霸离线，恢复在线后可操作。",
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

    pub async fn ceiling_fan(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<fan::Report> {
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        let r = self.handle(&c, fan::read(&c, &d).await).await?;
        self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, false)
            .await?;
        Ok(r)
    }

    pub async fn change_ceiling_fan(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        change: fan::Change,
    ) -> Result<fan::Changed> {
        let _guard = self.ceiling_fan_write.lock().await;
        let (c, d) = self.device(&home_id, generation, &did).await?;
        self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, true)
            .await?;
        let before = self.handle(&c, fan::read(&c, &d).await).await?;
        if before.revision != baseline {
            return Err(AppError::new(
                "conflict",
                "凉霸状态已变化，正在更新，请按当前状态重新操作。",
                true,
            ));
        }
        let commands = fan::commands(&before, &change)?;
        for (method, params) in commands {
            self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, true)
                .await?;
            let sent = self
                .handle(&c, c.ceiling_fan_rpc(&d, method, params).await)
                .await;
            if let Err(e) = sent {
                if !write_error_is_uncertain(&e) {
                    return Err(e);
                }
                // Never send the next step or replay a write after an uncertain
                // reply, including the nightlight-to-daylight brightness path.
                break;
            }
        }
        let mut latest = None;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, false)
                .await?;
            match self.handle(&c, fan::read(&c, &d).await).await {
                Ok(r) => {
                    self.ensure_ceiling_fan_context(&home_id, generation, &did, &c, &d, false)
                        .await?;
                    if fan::matches(&before, &r, &change) {
                        return Ok(fan::Changed {
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
            .map(|report| fan::Changed {
                report,
                confirmed: false,
            })
            .ok_or_else(|| {
                AppError::new(
                    "uncertain",
                    "暂未确认凉霸状态，正在重新读取；未重复下发。",
                    true,
                )
            })
    }
}
