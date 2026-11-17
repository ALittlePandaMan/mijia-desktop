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
        if before.baseline != baseline && !ui_control::dispatch_only() {
            return Err(AppError::new(
                "conflict",
                "设备状态已变化，正在更新，请按当前状态重新操作。",
                true,
            ));
        }
        let mut command_state=before.clone();
        if let Some(value)=ui_control::setting("vacuum.cleaning").await.and_then(|v|v.as_bool()){command_state.cleaning=value;}
        if let Some(value)=ui_control::setting("vacuum.mode").await.and_then(|v|v.as_u64()){command_state.mode=value as u8;command_state.clean_setting=(command_state.clean_setting&!3)|value as u32;}
        let (method, params) = vacuum::command(&d, &command_state, &change)?;
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
        match &change{vacuum::Change::Start{}=>ui_control::record_setting("vacuum.cleaning",serde_json::json!(true)).await,vacuum::Change::Pause{}=>ui_control::record_setting("vacuum.cleaning",serde_json::json!(false)).await,vacuum::Change::Mode{value}=>ui_control::record_setting("vacuum.mode",serde_json::json!(value)).await,_=>{}}
        let mut latest = if crate::state::ui_control::dispatch_only(){Some(before.clone())}else{None};
        for delay in crate::state::ui_control::delays(&[350, 800, 1500]) {
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
