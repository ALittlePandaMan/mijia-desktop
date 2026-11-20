use super::*;
use crate::home_scenes as scenes;
impl AppState {
    pub async fn home_scenes(&self, home_id: String, generation: u64) -> Result<scenes::Report> {
        let (cloud, home, epoch) = self.scene_context(&home_id, generation).await?;
        let rows = self
            .handle(&cloud, scenes::load(&cloud, &home).await)
            .await?;
        self.check_scene_context(&home_id, generation, epoch, &cloud)
            .await?;
        Ok(scenes::Report {
            home_id,
            generation,
            scenes: rows,
        })
    }
    async fn scene_context(
        &self,
        home_id: &str,
        generation: u64,
    ) -> Result<(Arc<Cloud>, Home, u64)> {
        let inner = self.inner.lock().await;
        inner.check(home_id, generation)?;
        Ok((
            inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
            inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .cloned()
                .ok_or_else(AppError::stale)?,
            inner.epoch,
        ))
    }
    async fn check_scene_context(
        &self,
        home_id: &str,
        generation: u64,
        epoch: u64,
        cloud: &Arc<Cloud>,
    ) -> Result<()> {
        let inner = self.inner.lock().await;
        inner.check(home_id, generation)?;
        if inner.epoch != epoch || !inner.cloud.as_ref().is_some_and(|c| Arc::ptr_eq(c, cloud)) {
            return Err(AppError::stale());
        }
        Ok(())
    }
    pub async fn run_home_scene(
        &self,
        home_id: String,
        generation: u64,
        scene_id: String,
        request_id: String,
    ) -> Result<()> {
        let _gate = self.home_scene_write.lock().await;
        let (cloud, home, epoch) = self.scene_context(&home_id, generation).await?;
        // Re-read permissions and manual triggers immediately before dispatch.
        let rows = self
            .handle(&cloud, scenes::load(&cloud, &home).await)
            .await?;
        let params = scenes::run_params(&home, &rows, &scene_id)?;
        self.check_scene_context(&home_id, generation, epoch, &cloud)
            .await?;
        let scope = format!(
            "{}\n{}\n{}",
            cloud.credentials.region, cloud.credentials.user_id, home_id
        );
        scenes::take_request(
            self.home_scene_requests
                .lock()
                .await
                .entry(scope)
                .or_default(),
            &request_id,
        )?;
        // A scene can contain delays and non-idempotent actions. Never retry a
        // write or describe cloud acceptance as verified device completion.
        let result = self
            .handle(&cloud, cloud.request(scenes::RUN_PATH, params).await)
            .await;
        self.check_scene_context(&home_id, generation, epoch, &cloud)
            .await?;
        match result {
            Ok(Value::Bool(false)) => Err(AppError::new(
                "sceneRejected",
                "任务未能执行，请刷新后重试。",
                false,
            )),
            Ok(_) => {
                let devices={
                    let inner=self.inner.lock().await;
                    inner.check(&home_id,generation)?;
                    inner.devices.iter().map(|d|d.control_did().to_owned()).collect()
                };
                cloud.invalidate_observed(Some(&home_id),None);
                self.home_cards.invalidate_devices(&devices).await;
                self.check_scene_context(&home_id,generation,epoch,&cloud).await?;
                let _=self.card_changes.send((home_id,String::new()));
                Ok(())
            }
            Err(error) if matches!(error.kind.as_str(), "network" | "protocol") => {
                Err(AppError::new(
                    "sceneUncertain",
                    "尚未确认任务是否执行，请先核实设备状态。",
                    false,
                ))
            }
            Err(error) => Err(error),
        }
    }
}
