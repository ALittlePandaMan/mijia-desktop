use super::*;
impl AppState {
    pub async fn monitor_detail_open(
        &self,
        target: crate::monitor::actions::Target,
    ) -> Result<crate::monitor::actions::Detail> {
        self.device(&target.home_id, target.generation, &target.did)
            .await?;
        self.monitors.open_detail(&target)
    }
    pub async fn monitor_detail_command(
        &self,
        target: crate::monitor::actions::Target,
        lease_id: String,
        operation: crate::camera::media_control::Operation,
    ) -> Result<crate::camera::media_control::Reply> {
        use crate::camera::media_control::Operation;
        let (_, device) = self
            .device(&target.home_id, target.generation, &target.did)
            .await?;
        if matches!(
            operation,
            Operation::Quality { .. } | Operation::Record { .. } | Operation::Microphone { .. }
        ) {
            return Err(AppError::invalid("此操作需要专用接口。"));
        }
        if device.shared_read_only
            && matches!(
                operation,
                Operation::Talk { enabled: true } | Operation::Ptz { .. }
            )
        {
            return Err(AppError::invalid("此共享设备仅有读取权限。"));
        }
        self.monitors
            .detail_operation(&target, &lease_id, &operation)?;
        let (stream, session) = self.monitors.detail_route(&target, &lease_id, None)?;
        let confirmed_operation = operation.clone();
        let reply = stream
            .command(
                &target.home_id,
                target.generation,
                &target.did,
                &session,
                operation,
                None,
            )
            .await?;
        self.device(&target.home_id, target.generation, &target.did)
            .await?;
        self.monitors
            .detail_confirmed(&target, &lease_id, &confirmed_operation)?;
        Ok(reply)
    }
    pub async fn monitor_detail_microphone(
        &self,
        target: crate::monitor::actions::Target,
        lease_id: String,
        packet: String,
    ) -> Result<()> {
        use base64::Engine;
        let (_, device) = self
            .device(&target.home_id, target.generation, &target.did)
            .await?;
        if device.shared_read_only
            || !crate::camera::media_control::features(&device.model).talk
            || packet.len() > 1700
        {
            return Err(AppError::invalid("此对讲请求无效。"));
        }
        let (stream, session) = self.monitors.detail_route(&target, &lease_id, None)?;
        let packet = base64::engine::general_purpose::STANDARD
            .decode(packet)
            .map_err(|_| AppError::invalid("音频包无效。"))?;
        stream
            .command(
                &target.home_id,
                target.generation,
                &target.did,
                &session,
                crate::camera::media_control::Operation::Microphone { packet },
                None,
            )
            .await?;
        self.monitors.detail_route(&target, &lease_id, None)?;
        Ok(())
    }
    pub async fn monitor_detail_close(
        &self,
        target: crate::monitor::actions::Target,
        lease_id: String,
    ) -> Result<()> {
        self.device(&target.home_id, target.generation, &target.did)
            .await?;
        if let Some((stream, session, operations)) =
            self.monitors.release_detail(&target, &lease_id)?
        {
            for operation in operations {
                let _ = stream
                    .command(
                        &target.home_id,
                        target.generation,
                        &target.did,
                        &session,
                        operation,
                        None,
                    )
                    .await;
            }
        }
        self.monitors.finish_detail(&target, &lease_id);
        Ok(())
    }
    pub async fn monitor_media_name(
        &self,
        target: &crate::monitor::actions::Target,
    ) -> Result<String> {
        let (_, device) = self
            .device(&target.home_id, target.generation, &target.did)
            .await?;
        let (stream, session) = self.monitors.route(target)?;
        stream.owns(&target.home_id, target.generation, &target.did, &session)?;
        Ok(device.name)
    }
    pub async fn monitor_command(
        &self,
        target: crate::monitor::actions::Target,
        operation: crate::monitor::actions::Operation,
        destination: Option<std::path::PathBuf>,
    ) -> Result<crate::camera::media_control::Reply> {
        self.device(&target.home_id, target.generation, &target.did)
            .await?;
        let (stream, session) = self.monitors.route(&target)?;
        let recording = destination.map(|path| crate::camera::media_control::RecordSettings {
            path,
            home: target.home_id.clone(),
            generation: target.generation,
            did: target.did.clone(),
            exports: self.camera_exports.clone(),
        });
        let reply = stream
            .command(
                &target.home_id,
                target.generation,
                &target.did,
                &session,
                operation.into_camera(),
                recording,
            )
            .await?;
        self.inner
            .lock()
            .await
            .check(&target.home_id, target.generation)?;
        self.monitors.route(&target)?;
        Ok(reply)
    }
    pub async fn monitor_screenshot(
        &self,
        target: crate::monitor::actions::Target,
        png: String,
        destination: std::path::PathBuf,
    ) -> Result<crate::camera::saved_media::SavedMedia> {
        use base64::Engine;
        self.monitor_media_name(&target).await?;
        if png.len() > 44 * 1024 * 1024 {
            return Err(AppError::invalid("截图数据过大。"));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png)
            .map_err(|_| AppError::invalid("截图数据无效。"))?;
        self.camera_exports.screenshot(
            &target.home_id,
            target.generation,
            &target.did,
            &destination,
            &bytes,
        )
    }
    pub async fn create_monitor(
        &self,
        home_id: String,
        generation: u64,
        dids: Vec<String>,
    ) -> Result<String> {
        let _lifecycle = self.camera_lifecycle.lock().await;
        {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            if dids.is_empty()
                || dids.iter().collect::<std::collections::HashSet<_>>().len() != dids.len()
                || dids.iter().any(|id| {
                    !inner
                        .devices
                        .iter()
                        .any(|d| &d.did == id && crate::monitor::eligible(d))
                })
            {
                return Err(AppError::invalid("摄像头列表已变化。"));
            }
        }
        self.close_camera_sessions().await?;
        let inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        let cloud = inner.cloud.clone().ok_or_else(AppError::auth)?;
        let home = inner
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .cloned()
            .ok_or_else(AppError::stale)?;
        let devices = dids
            .iter()
            .map(|did| {
                inner
                    .devices
                    .iter()
                    .find(|d| &d.did == did && crate::monitor::eligible(d))
                    .cloned()
                    .ok_or_else(AppError::stale)
            })
            .collect::<Result<Vec<_>>>()?;
        self.monitors.create(cloud, home, generation, devices)
    }
    pub async fn read_monitor(
        &self,
        home_id: String,
        generation: u64,
        viewer_id: String,
    ) -> Result<Vec<crate::monitor::Row>> {
        let (cloud, devices) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            (
                inner.cloud.clone().ok_or_else(AppError::auth)?,
                inner.devices.clone(),
            )
        };
        self.handle(
            &cloud,
            self.monitors
                .read(&home_id, generation, &viewer_id, &devices),
        )
        .await
    }
    pub async fn retry_monitor(
        &self,
        home_id: String,
        generation: u64,
        viewer_id: String,
        did: String,
    ) -> Result<()> {
        let (_, device) = self.device(&home_id, generation, &did).await?;
        self.monitors
            .retry(&home_id, generation, &viewer_id, &did, &device)
    }
    pub async fn stop_monitor(
        &self,
        home_id: String,
        generation: u64,
        viewer_id: String,
    ) -> Result<()> {
        let _lifecycle = self.camera_lifecycle.lock().await;
        let done = self.monitors.stop(&home_id, generation, &viewer_id);
        for _ in 0..100 {
            if done
                .iter()
                .all(|d| d.load(std::sync::atomic::Ordering::Acquire))
            {
                return Ok(());
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        }
        Err(AppError::new(
            "videoStopping",
            "视频连接尚未完成关闭。",
            true,
        ))
    }
}
