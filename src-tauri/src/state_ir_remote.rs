use super::*;
use crate::ir_remote as ir;
impl AppState {
    pub async fn ir_remote(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<ir::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let table = self.handle(&cloud, ir::load(&cloud, &device).await).await?;
        let (current, latest) = self.device(&home_id, generation, &did).await?;
        if !Arc::ptr_eq(&current, &cloud)
            || latest.control_did() != device.control_did()
            || latest.model != device.model
        {
            return Err(AppError::stale());
        }
        Ok(table.report)
    }
    pub async fn send_ir_key(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        name: String,
        nonce: String,
    ) -> Result<String> {
        let _guard = self.ir_remote_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !device.online || device.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "设备离线或当前共享权限不允许控制。",
                false,
            ));
        }
        let table = self.handle(&cloud, ir::load(&cloud, &device).await).await?;
        let params = ir::click_params(&device, &table, &baseline, &name)?;
        let (current, latest) = self.device(&home_id, generation, &did).await?;
        if !Arc::ptr_eq(&current, &cloud)
            || latest.control_did() != device.control_did()
            || latest.model != device.model
            || !latest.online
            || latest.shared_read_only
        {
            return Err(AppError::stale());
        }
        let scope = format!(
            "{}\n{}\n{}\n{}",
            cloud.credentials.region, cloud.credentials.user_id, home_id, did
        );
        ir::take_nonce(
            self.ir_remote_nonces.lock().await.entry(scope).or_default(),
            &nonce,
        )?;
        self.handle(&cloud, cloud.request(ir::CLICK_PATH, params).await)
            .await?;
        self.device(&home_id, generation, &did).await?;
        Ok("遥控请求已发送，请观察设备实际反馈；红外遥控无法回读开关状态。".into())
    }
}
