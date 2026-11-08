use super::*;
impl AppState {
    pub async fn camera_auxiliary(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::auxiliary::Snapshot> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !crate::camera::category_supported(&device) {
            return Err(AppError::invalid("此设备不是摄像机。"));
        }
        let schema = self.specs.panel(&device).await?;
        let result = self
            .handle(
                &cloud,
                crate::camera::auxiliary::read(
                    &cloud,
                    &schema,
                    device.shared_read_only,
                    device.online,
                )
                .await,
            )
            .await?;
        self.device(&home_id, generation, &did).await?;
        Ok(result)
    }
    pub async fn change_camera_auxiliary(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::camera::auxiliary::Kind,
        active: bool,
        expected_active: bool,
    ) -> Result<crate::camera::auxiliary::Changed> {
        use crate::camera::auxiliary::{self, Kind, Prepared};
        let _guard = self.camera_power_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !crate::camera::category_supported(&device) {
            return Err(AppError::invalid("此设备不是摄像机。"));
        }
        let schema = self.specs.panel(&device).await?;
        let state = self
            .camera_auxiliary(home_id.clone(), generation, did.clone())
            .await?;
        let control = match kind {
            Kind::Alarm => &state.alarm,
            Kind::Light => &state.light,
        };
        if !control.writable || control.active.is_none() {
            return Err(AppError::new(
                "unavailable",
                control.reason.as_deref().unwrap_or("尚未确认实际状态。"),
                true,
            ));
        }
        if control.active == Some(active) {
            return Ok(auxiliary::Changed {
                report: state,
                confirmed: true,
            });
        }
        if control.active != Some(expected_active) {
            return Err(AppError::new(
                "stateChanged",
                "摄像机功能状态已改变，请重新选择。",
                true,
            ));
        }
        let Prepared::Property { siid, piid, value } = auxiliary::prepare(
            &schema,
            kind,
            active,
            device.shared_read_only,
            device.online,
        )?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let sent = self
            .handle(
                &cloud,
                cloud.write_panel_property(&schema, siid, piid, value).await,
            )
            .await;
        if let Err(error) = sent {
            if !write_error_is_uncertain(&error) {
                return Err(error);
            }
        }
        let mut report = state;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .camera_auxiliary(home_id.clone(), generation, did.clone())
                .await
            {
                Ok(actual) => {
                    report = actual;
                    let current = match kind {
                        Kind::Alarm => &report.alarm,
                        Kind::Light => &report.light,
                    };
                    if current.active == Some(active) {
                        return Ok(auxiliary::Changed {
                            report,
                            confirmed: true,
                        });
                    }
                }
                Err(error) if matches!(error.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(error)
                }
                Err(_) => {}
            }
        }
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        Ok(auxiliary::Changed {
            report,
            confirmed: false,
        })
    }
    pub async fn camera_power(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::power::Snapshot> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !crate::camera::category_supported(&device) {
            return Err(AppError::invalid("此设备不是摄像机。"));
        }
        let schema = self.specs.panel(&device).await?;
        let result = if let Some(p) =
            crate::camera::power::binding(&schema).filter(|_| device.online)
        {
            let mut actual = self
                .read_property_panel(&cloud, &home_id, generation, &schema, p.siid, p.piid)
                .await?;
            let mut state = crate::camera::power::snapshot(&actual, device.shared_read_only, true);
            if state.awake == Some(false) {
                actual = self
                    .read_property_panel(&cloud, &home_id, generation, &schema, p.siid, p.piid)
                    .await?;
                state = crate::camera::power::snapshot(&actual, device.shared_read_only, true);
            }
            if state.awake.is_none() {
                return Err(AppError::new(
                    "cameraStateUnknown",
                    "暂时无法读取摄像机休眠状态。",
                    true,
                ));
            }
            state
        } else {
            crate::camera::power::snapshot(&schema, device.shared_read_only, device.online)
        };
        self.device(&home_id, generation, &did).await?;
        Ok(result)
    }
    pub async fn change_camera_power(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        awake: bool,
        expected_awake: bool,
    ) -> Result<crate::camera::power::Changed> {
        let _guard = self.camera_power_write.lock().await;
        let state = self
            .camera_power(home_id.clone(), generation, did.clone())
            .await?;
        if !state.writable {
            return Err(AppError::new(
                "permissionDenied",
                state
                    .reason
                    .unwrap_or_else(|| "此设备不可控制休眠。".into()),
                false,
            ));
        }
        if state.awake == Some(awake) {
            self.monitors
                .power_changed(&home_id, generation, &did, awake)?;
            return Ok(crate::camera::power::Changed {
                report: state,
                confirmed: true,
            });
        }
        if state.awake != Some(expected_awake) {
            return Err(AppError::new(
                "stateChanged",
                "摄像机状态已经改变，请重新选择。",
                true,
            ));
        }
        let (_, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        let p = crate::camera::power::binding(&schema)
            .ok_or_else(|| AppError::invalid("未找到摄像机休眠属性。"))?;
        let result = self
            .set_property(
                home_id.clone(),
                generation,
                did.clone(),
                p.siid,
                p.piid,
                Value::Bool(awake),
            )
            .await?;
        let report =
            crate::camera::power::snapshot(&result.panel, device.shared_read_only, device.online);
        if result.verified {
            self.monitors
                .power_changed(&home_id, generation, &did, awake)?;
        }
        Ok(crate::camera::power::Changed {
            report,
            confirmed: result.verified,
        })
    }
    pub async fn camera_cloud_name(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        date: &str,
        id: &str,
    ) -> Result<String> {
        let (cloud, device) = self.device(home, generation, did).await?;
        crate::camera::events::record(&cloud, &device, date, id).await?;
        self.device(home, generation, did).await?;
        Ok(device.name)
    }
    pub async fn camera_cloud_save(
        &self,
        home: String,
        generation: u64,
        did: String,
        date: String,
        id: String,
        destination: std::path::PathBuf,
    ) -> Result<crate::camera::saved_media::SavedMedia> {
        use base64::Engine;
        let video = self
            .camera_care_video(home.clone(), generation, did.clone(), date, id)
            .await?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(video.data)
            .map_err(|_| AppError::protocol())?;
        let _current = self.device(&home, generation, &did).await?;
        self.camera_exports
            .cloud_recording(&home, generation, &did, &destination, &bytes)
    }
    pub async fn camera_care_video(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        event_id: String,
    ) -> Result<crate::camera::cloud_media::Video> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let report = self
            .handle(
                &cloud,
                crate::camera::cloud_media::video(&cloud, &device, &date, &event_id).await,
            )
            .await?;
        let (current, selected) = self.device(&home_id, generation, &did).await?;
        if !Arc::ptr_eq(&cloud, &current) || selected.control_did() != device.control_did() {
            return Err(AppError::stale());
        }
        Ok(report)
    }
    pub async fn camera_care_thumbnail(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        event_id: String,
    ) -> Result<String> {
        use base64::Engine;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let bytes = self
            .handle(
                &cloud,
                crate::camera::cloud_media::thumbnail(&cloud, &device, &date, &event_id).await,
            )
            .await?;
        let (current, selected) = self.device(&home_id, generation, &did).await?;
        if !Arc::ptr_eq(&cloud, &current) || selected.control_did() != device.control_did() {
            return Err(AppError::stale());
        }
        let mime = if bytes.starts_with(&[255, 216, 255]) {
            "image/jpeg"
        } else if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
            "image/png"
        } else {
            return Err(AppError::protocol());
        };
        Ok(format!(
            "data:{mime};base64,{}",
            base64::engine::general_purpose::STANDARD.encode(bytes)
        ))
    }
    pub async fn doorbell_cloud(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
    ) -> Result<crate::camera::doorbell_cloud::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        crate::camera::doorbell_cloud::validate_device(&device)?;
        // Cloud history remains readable while this battery device is asleep;
        // no live session or wakeup is requested by this path.
        let report = self
            .handle(
                &cloud,
                crate::camera::doorbell_cloud::read_report(&cloud, &device, &date).await,
            )
            .await?;
        let (current, selected) = self.device(&home_id, generation, &did).await?;
        if !Arc::ptr_eq(&cloud, &current)
            || selected.model != device.model
            || selected.control_did() != device.control_did()
        {
            return Err(AppError::stale());
        }
        Ok(report)
    }
    pub async fn camera_media_name(
        &self,
        home_id: &str,
        generation: u64,
        did: &str,
        session_id: &str,
    ) -> Result<String> {
        let (_, device) = self.device(home_id, generation, did).await?;
        self.cameras.owns(home_id, generation, did, session_id)?;
        Ok(device.name)
    }
    pub async fn camera_care(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
    ) -> Result<crate::camera::events::CareReport> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !crate::camera::profiles::care(&device.model) {
            return Err(AppError::invalid("此型号的看家助手云端协议尚未核实。"));
        }
        let report = self
            .handle(
                &cloud,
                crate::camera::events::read_report(&cloud, &device, &date).await,
            )
            .await?;
        self.inner.lock().await.check(&home_id, generation)?;
        Ok(report)
    }
    pub async fn finish_camera_sessions(&self) {
        let _ = self.close_camera_sessions().await;
    }
    pub(crate) async fn close_camera_sessions(&self) -> Result<()> {
        let mut done = self.monitors.stop_all();
        self.cameras.stop_all_request();
        done.extend(self.cameras.pending_stops());
        if !done.is_empty() {
            for _ in 0..100 {
                if done
                    .iter()
                    .all(|d| d.load(std::sync::atomic::Ordering::Acquire))
                {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        }
        if done
            .iter()
            .any(|d| !d.load(std::sync::atomic::Ordering::Acquire))
        {
            return Err(AppError::new(
                "videoStopping",
                "视频连接尚未完成关闭，请稍后重试。",
                true,
            ));
        }
        Ok(())
    }
    pub async fn camera_features(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::camera::media_control::Features> {
        let (_, device) = self.device(&home_id, generation, &did).await?;
        if !crate::camera::category_supported(&device) {
            return Err(AppError::invalid("此设备没有视频能力。"));
        }
        let mut features = crate::camera::media_control::features(&device.model);
        if device.shared_read_only {
            features.talk = false;
            features.ptz = false;
            features.reason = Some("此共享设备仅有读取权限。");
        }
        Ok(features)
    }
    pub async fn camera_command(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        operation: crate::camera::media_control::Operation,
        destination: Option<std::path::PathBuf>,
    ) -> Result<crate::camera::media_control::Reply> {
        let (_, device) = self.device(&home_id, generation, &did).await?;
        if device.shared_read_only
            && matches!(
                operation,
                crate::camera::media_control::Operation::Talk { enabled: true }
                    | crate::camera::media_control::Operation::Ptz { .. }
            )
        {
            return Err(AppError::invalid("此共享设备仅有读取权限。"));
        }
        let recording = destination.map(|path| crate::camera::media_control::RecordSettings {
            path,
            home: home_id.clone(),
            generation,
            did: did.clone(),
            exports: self.camera_exports.clone(),
        });
        let reply = self
            .cameras
            .command(
                &home_id,
                generation,
                &did,
                &session_id,
                operation,
                recording,
            )
            .await?;
        self.inner.lock().await.check(&home_id, generation)?;
        Ok(reply)
    }
    pub async fn camera_microphone(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        packet: String,
    ) -> Result<()> {
        use base64::Engine;
        let (_, device) = self.device(&home_id, generation, &did).await?;
        self.cameras.owns(&home_id, generation, &did, &session_id)?;
        if device.shared_read_only || !crate::camera::media_control::features(&device.model).talk {
            return Err(AppError::invalid("此设备没有可用的对讲发送权限或协议。"));
        }
        if packet.len() > 1700 {
            return Err(AppError::invalid("麦克风音频包过大。"));
        }
        let packet = base64::engine::general_purpose::STANDARD
            .decode(packet)
            .map_err(|_| AppError::invalid("麦克风音频包无效。"))?;
        self.cameras
            .command(
                &home_id,
                generation,
                &did,
                &session_id,
                crate::camera::media_control::Operation::Microphone { packet },
                None,
            )
            .await
            .map(|_| ())
    }
    pub async fn camera_screenshot(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
        png: String,
        destination: std::path::PathBuf,
    ) -> Result<crate::camera::saved_media::SavedMedia> {
        use base64::Engine;
        self.device(&home_id, generation, &did).await?;
        self.cameras.owns(&home_id, generation, &did, &session_id)?;
        if png.len() > 44 * 1024 * 1024 {
            return Err(AppError::invalid("截图数据过大。"));
        }
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(png)
            .map_err(|_| AppError::invalid("截图数据无效。"))?;
        self.camera_exports
            .screenshot(&home_id, generation, &did, &destination, &bytes)
    }
    pub async fn camera_media_folder(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        export_id: String,
    ) -> Result<()> {
        self.device(&home_id, generation, &did).await?;
        let directory = self
            .camera_exports
            .folder(&home_id, generation, &did, &export_id)?;
        crate::platform_paths::open_directory(&directory)
    }
    pub fn stop_camera_sessions(&self) {
        self.monitors.clear_hints();
        self.cameras.stop_all();
        self.monitors.stop_all();
    }
    pub async fn start_camera(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        quality: Option<String>,
    ) -> Result<String> {
        let _lifecycle = self.camera_lifecycle.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        self.close_camera_sessions().await?;
        let panel = self.specs.panel(&device).await?;
        if crate::camera::power::binding(&panel).is_some()
            && crate::camera::power::read(&cloud, &panel, device.shared_read_only, device.online)
                .await?
                .awake
                == Some(false)
        {
            return Err(AppError::new("cameraOff", "摄像机休眠中", false));
        }
        let ticket = self.cameras.begin();
        let home = self
            .inner
            .lock()
            .await
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .cloned()
            .ok_or_else(AppError::stale)?;
        let mut config = self
            .handle(
                &cloud,
                crate::camera::negotiate(&cloud, &home, &device).await,
            )
            .await?;
        config.select_quality(quality.as_deref().unwrap_or("auto"))?;
        // Hold the identity lock through session registration; a family switch
        // or logout cannot leave a just-negotiated stream behind.
        let inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        if !inner.cloud.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cloud))
            || !inner
                .devices
                .iter()
                .any(|d| d.did == did && d.model == device.model && d.online)
        {
            return Err(AppError::stale());
        }
        self.cameras
            .start_reserved(home_id, generation, did, config, ticket)
    }
    pub async fn read_camera(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
    ) -> Result<Vec<crate::camera::Event>> {
        let inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        if !inner
            .devices
            .iter()
            .any(|d| d.did == did && crate::camera::category_supported(d))
        {
            return Err(AppError::stale());
        }
        self.cameras.read(&home_id, generation, &did, &session_id)
    }
    pub async fn stop_camera(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        session_id: String,
    ) -> Result<()> {
        // A stale viewer may stop only its own opaque session, never the newer one.
        let _lifecycle = self.camera_lifecycle.lock().await;
        if let Some(done) = self
            .cameras
            .stop_request(&home_id, generation, &did, &session_id)?
        {
            for _ in 0..100 {
                if done.load(std::sync::atomic::Ordering::Acquire) {
                    return Ok(());
                }
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
            return Err(AppError::new(
                "videoStopping",
                "视频连接尚未完成关闭，请返回后重试。",
                true,
            ));
        }
        Ok(())
    }
}
