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
        if before.revision != baseline && !ui_control::dispatch_only() {
            return Err(AppError::new(
                "conflict",
                "浴霸状态已变化，正在更新，请按当前状态重新操作。",
                true,
            ));
        }
        let mut command_state=before.clone();if let Some(mode)=ui_control::setting("bath.mode").await.and_then(|v|v.as_str().map(str::to_owned)){command_state.mode=mode;}if let Some(gears)=ui_control::setting("bath.gears").await.and_then(|v|v.as_u64()){command_state.gears=gears as u16;}
        let (method, params) = bath::command(&command_state, &change)?;
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
        ) && bath::matches(&command_state, &command_state, &change)
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
        match &change{
            bath::Change::Stop=>ui_control::record_setting("bath.mode",serde_json::json!("bh_off")).await,
            bath::Change::Mode{mode,gear,enabled}=>{let on=enabled.unwrap_or_else(||!command_state.mode.split('|').any(|m|m==mode));let mut modes:Vec<String>=if command_state.mode=="bh_off"{vec![]}else{command_state.mode.split('|').map(str::to_owned).collect()};modes.retain(|m|if mode=="venting"{m!="venting"}else{m=="venting"});if on{modes.push(mode.clone());}let next=if modes.is_empty(){"bh_off".into()}else{modes.join("|")};ui_control::record_setting("bath.mode",serde_json::json!(next)).await;let place=match mode.as_str(){"warmwind"=>100,"coolwind"=>10,"venting"=>1,_=>0};if place>0{let old=(command_state.gears/place)%10;ui_control::record_setting("bath.gears",serde_json::json!(command_state.gears-old*place+if on{*gear as u16*place}else{0})).await;}},_=>{}
        }
        let mut latest = if crate::state::ui_control::dispatch_only(){Some(before.clone())}else{None};
        for delay in crate::state::ui_control::delays(&[350, 800, 1500]) {
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
