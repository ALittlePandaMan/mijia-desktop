use super::*;
use crate::monitor_catalog::{self, View};
impl AppState {
    #[cfg(feature = "desktop")]
    pub(crate) async fn detached_monitor_context(
        &self,
        label: &str,
        scope: &str,
        home_id: Option<&str>,
        alive: Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<(Self, u64)> {
        let mut context = self.shared_context(false, None).await?;
        let generation = {
            let mut inner = context.inner.lock().await;
            let cloud = inner.cloud.as_ref().ok_or_else(AppError::auth)?;
            if PreferenceStore::scope(&cloud.credentials.user_id, &cloud.credentials.region) != scope {
                return Err(AppError::stale());
            }
            // Detached media may address only validated members of a monitor group.
            inner.clear_home();
            inner.homes.clear();
            inner.monitor_alive = Some(alive.clone());
            inner.auth_version
        };
        context.media_window = label.into();
        context.monitors = Arc::new(crate::monitor::Registry::with_owner(
            self.camera_connections.clone(), label.into(), Some(alive),
        ));
        context.camera_lifecycle = Arc::new(Mutex::new(()));
        context.cloud_playbacks = Arc::new(crate::camera::cloud_media::PlaybackSessions::default());
        if home_id.is_none() {
            context.monitor_catalog = self.monitor_catalog.clone();
        }
        Ok((context, generation))
    }

    #[cfg(feature = "desktop")]
    pub(crate) async fn sync_detached_monitor_login(&self) -> Result<()> {
        let root = self.session_state().lock().await;
        let mut scoped = self.inner.lock().await;
        if !scoped.authenticated() || !root.authenticated() || root.auth_version != scoped.auth_version {
            return Err(AppError::stale());
        }
        scoped.cloud = root.cloud.clone();
        Ok(())
    }

    #[cfg(feature = "desktop")]
    pub(crate) async fn monitor_tray_target(
        &self, startup: Option<crate::app_settings::StartupTarget>,
    ) -> Result<crate::app_settings::StartupTarget> {
        use crate::app_settings::{HomeTarget, StartupTarget};
        let inner = self.inner.lock().await;
        if !inner.authenticated() { return Err(AppError::auth()); }
        let cloud = inner.cloud.as_ref().ok_or_else(AppError::auth)?;
        let scope = PreferenceStore::scope(&cloud.credentials.user_id, &cloud.credentials.region);
        if let Some(target) = startup {
            match &target {
                StartupTarget::Home(h) if h.scope == scope => return Ok(target),
                StartupTarget::All { scope: saved, all_homes: true } if saved == &scope => return Ok(target),
                _ => {}
            }
        }
        let home_id = inner.selected.clone().or_else(|| inner.homes.first().map(|home| home.id.clone()))
            .ok_or_else(AppError::stale)?;
        drop(inner);
        if PreferenceStore::new()?.view(&scope, &home_id)?.monitor_all_homes {
            Ok(StartupTarget::All { scope, all_homes: true })
        } else {
            Ok(StartupTarget::Home(HomeTarget { scope, home_id }))
        }
    }

    #[cfg(feature = "desktop")]
    pub(crate) fn current_media_owner(&self, did: &str) -> Option<String> {
        self.camera_connections.owner(did)
    }

    async fn monitor_account(&self) -> Result<(Arc<Cloud>, u64, String)> {
        let inner = self.inner.lock().await;
        if !inner.authenticated() {
            return Err(AppError::auth());
        }
        let cloud = inner.cloud.clone().ok_or_else(AppError::auth)?;
        Ok((
            cloud.clone(),
            inner.auth_version,
            PreferenceStore::scope(&cloud.credentials.user_id, &cloud.credentials.region),
        ))
    }
    pub async fn monitor_catalog_view(&self, force: bool) -> Result<View> {
        self.monitor_catalog_for(force, None).await
    }
    pub(crate) async fn monitor_catalog_for(&self, force: bool, home_id: Option<&str>) -> Result<View> {
        if home_id.is_some_and(|id| id.is_empty() || id.len() > 256) {
            return Err(AppError::invalid("请选择要监控的家庭。"));
        }
        let (cloud, generation, scope) = self.monitor_account().await?;
        let epoch = self.inner.lock().await.auth_epoch.clone();
        let future = self
            .monitor_catalog
            .load(format!("{scope}:{generation}:{}", home_id.unwrap_or("")), force, cloud.clone(), home_id);
        tokio::pin!(future);
        let mut check = tokio::time::interval(Duration::from_millis(100));
        let result = loop {
            tokio::select! {
                result=&mut future=>break result,
                _=check.tick()=>if epoch.load(std::sync::atomic::Ordering::Acquire)!=generation{return Err(AppError::stale());}
            }
        };
        let monitor_catalog::Directory { mut homes, choices } =
            self.handle_monitor_transport(&cloud, generation, result).await?;
        let store = PreferenceStore::new()?;
        let all_homes = store.view(&scope, "")?.monitor_all_homes;
        for home in &mut homes {
            home.excluded_device_ids = store
                .view(&scope, &home.home.id)?
                .monitor
                .excluded_device_ids;
        }
        let (_, current, current_scope) = self.monitor_account().await?;
        if current != generation || current_scope != scope {
            return Err(AppError::stale());
        }
        let incomplete = homes.iter().any(|home| home.error.is_some());
        Ok(View {
            scope,
            generation,
            all_homes: home_id.is_none() && all_homes,
            homes,
            available_homes: choices,
            incomplete,
        })
    }
    pub async fn change_monitor_selection(
        &self,
        scope: String,
        home_id: String,
        did: String,
        excluded: bool,
    ) -> Result<View> {
        let _serial = self.local_preferences.lock().await;
        let view = self.monitor_catalog_view(false).await?;
        if view.scope != scope {
            return Err(AppError::stale());
        }
        let home = view
            .homes
            .iter()
            .find(|h| h.home.id == home_id && h.error.is_none())
            .ok_or_else(AppError::stale)?;
        if !home.devices.iter().any(|d| d.did == did) {
            return Err(AppError::stale());
        }
        let rooms = home
            .home
            .rooms
            .iter()
            .map(|r| r.id.clone())
            .collect::<Vec<_>>();
        PreferenceStore::new()?.change(
            &scope,
            &home_id,
            PreferenceChange::SetMonitorExcluded { did, excluded },
            &home.devices,
            &rooms,
        )?;
        self.monitor_catalog_view(false).await
    }
    pub async fn create_monitor_all(&self, generation: u64, dids: Vec<String>) -> Result<String> {
        self.create_monitor_for(generation, dids, None).await
    }
    pub(crate) async fn create_monitor_for(&self, generation: u64, dids: Vec<String>, home_id: Option<&str>) -> Result<String> {
        if !crate::monitor::valid_page(&dids) {
            return Err(AppError::invalid("摄像头列表无效。"));
        }
        let _serial = self.local_preferences.lock().await;
        let view = Box::pin(self.monitor_catalog_for(false, home_id)).await?;
        if view.generation != generation {
            return Err(AppError::stale());
        }
        let members = monitor_catalog::selected_page(&view.homes, &dids)?;
        let _lifecycle = self.camera_lifecycle.lock().await;
        let (_, current, scope) = self.monitor_account().await?;
        if current != generation || scope != view.scope {
            return Err(AppError::stale());
        }
        self.close_camera_sessions().await?;
        let (cloud, current, scope) = self.monitor_account().await?;
        if current != generation || scope != view.scope {
            return Err(AppError::stale());
        }
        self.monitors
            .create_members(cloud, members, generation, true)
    }
    async fn aggregate_monitor(
        &self,
        viewer: &str,
        generation: u64,
    ) -> Result<(Arc<Cloud>, String, Vec<Device>)> {
        let (source, home, devices) = self.monitors.aggregate(viewer, generation)?;
        let (cloud, current, _) = self.monitor_account().await?;
        if current != generation
            || cloud.credentials.user_id != source.credentials.user_id
            || cloud.credentials.region != source.credentials.region
        {
            return Err(AppError::stale());
        }
        Ok((source, home, devices))
    }
    pub async fn read_monitor_all(
        &self,
        viewer_id: String,
        generation: u64,
    ) -> Result<Vec<crate::monitor::Row>> {
        let (source, home, devices) = self.aggregate_monitor(&viewer_id, generation).await?;
        self.handle_monitor_transport(
            &source, generation, self.monitors.read(&home, generation, &viewer_id, &devices),
        ).await
    }
    pub async fn retry_monitor_all(
        &self,
        viewer_id: String,
        generation: u64,
        did: String,
    ) -> Result<()> {
        let (_, home, devices) = self.aggregate_monitor(&viewer_id, generation).await?;
        let device = devices
            .iter()
            .find(|d| d.did == did)
            .ok_or_else(AppError::stale)?;
        self.monitors
            .retry(&home, generation, &viewer_id, &did, device)
    }
    pub async fn stop_monitor_all(&self, viewer_id: String, generation: u64) -> Result<()> {
        let (_, home, _) = self.aggregate_monitor(&viewer_id, generation).await?;
        self.stop_monitor(home, generation, viewer_id).await
    }
    /// A transient camera-only context owns no stream and cannot outlive its viewer.
    pub(crate) async fn monitor_camera_context(
        &self,
        home: &str,
        generation: u64,
        did: &str,
    ) -> Result<Option<Self>> {
        let Some((source, descriptor, device, alive)) =
            self.monitors.context(home, generation, did)
        else {
            return Ok(None);
        };
        let mut context = self.shared_context(false, None).await?;
        // Power changes from the scoped camera page must affect the existing wall,
        // while its short-lived context must not own or close that wall on drop.
        context.monitors = self.monitors.clone();
        {
            let mut inner = context.inner.lock().await;
            let cloud = inner.cloud.as_ref().ok_or_else(AppError::auth)?;
            if inner.auth_version != generation
                || cloud.credentials.user_id != source.credentials.user_id
                || cloud.credentials.region != source.credentials.region
                || !alive.load(std::sync::atomic::Ordering::Acquire)
            {
                return Err(AppError::stale());
            }
            inner.selected = Some(home.into());
            inner.generation = generation;
            inner.devices = vec![device];
            inner.homes = vec![descriptor];
            inner.monitor_alive = Some(alive);
        }
        Ok(Some(context))
    }
    pub(super) async fn monitor_device(
        &self,
        target: &crate::monitor::actions::Target,
    ) -> Result<(Arc<Cloud>, Device)> {
        if let Some(context) = self
            .monitor_camera_context(&target.home_id, target.generation, &target.did)
            .await?
        {
            self.monitors.require_member(target)?;
            return context
                .device(&target.home_id, target.generation, &target.did)
                .await;
        }
        self.device(&target.home_id, target.generation, &target.did)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture_cloud() -> Arc<Cloud> {
        Arc::new(Cloud::new(crate::auth::Credentials {
            user_id: "1".into(),
            security: "AAECAwQFBgcICQoLDA0ODw==".into(),
            service_token: "mock-only".into(),
            region: "cn".into(),
            device_id: "mock-device".into(),
            service_id: "mijia".into(),
            c_user_id: "mock-user".into(),
        }).unwrap())
    }
    #[tokio::test]
    async fn a_late_expiry_can_reconnect_a_renewed_account_but_cannot_clear_it() {
        let source = fixture_cloud();
        let state = AppState::with_session(Some(source.clone()), None).unwrap();
        let renewed = fixture_cloud();
        state.inner.lock().await.cloud = Some(renewed.clone());
        let stale = state.handle_monitor_transport::<()>(&source, 0, Err(AppError::auth())).await.unwrap_err();
        assert_eq!(stale.kind, "monitorSessionRenewed");
        {
            let mut inner = state.inner.lock().await;
            inner.auth_version = 1;
            inner.auth_epoch.store(1, std::sync::atomic::Ordering::Release);
        }
        let stale = state.handle_monitor_transport::<()>(&source, 0, Err(AppError::auth())).await.unwrap_err();
        assert_eq!(stale.kind, "staleContext");
        assert!(Arc::ptr_eq(&state.cloud().await.unwrap(), &renewed));
    }
    #[tokio::test]
    async fn scoped_monitor_catalog_offers_other_homes_without_accessing_their_devices() {
        let calls = Arc::new(std::sync::Mutex::new(Vec::new()));
        let reads = calls.clone();
        let cloud = Arc::try_unwrap(fixture_cloud()).ok().unwrap()
            .with_test_request(move |path, payload| match path {
                "/v2/homeroom/gethome_merged" => Ok(serde_json::json!({"homelist":[
                    {"id":100,"uid":1,"name":"家庭一"},{"id":200,"uid":1,"name":"家庭二"}
                ]})),
                "/v2/home/home_device_list" => {
                    reads.lock().unwrap().push(payload.unwrap()["home_id"].as_u64().unwrap());
                    Ok(serde_json::json!({"device_info":[]}))
                }
                _ => panic!("Unexpected monitor metadata request"),
            });
        let state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
        let view = state.monitor_catalog_for(false, Some("200")).await.unwrap();
        assert_eq!(view.homes[0].home.id, "200");
        assert_eq!(view.available_homes.len(), 2);
        assert!(!view.all_homes);
        assert_eq!(state.monitor_catalog_for(false, Some("300")).await.err().unwrap().kind, "permissionDenied");
        assert_eq!(state.create_monitor_for(view.generation, vec!["foreign".into()], Some("200")).await.unwrap_err().kind, "staleContext");
        assert_eq!(*calls.lock().unwrap(), vec![200]);
        assert!(state.inner.lock().await.selected.is_none());
    }
    #[test]
    fn two_surfaces_can_open_different_cameras_and_share_the_same_connection_limit() {
        let connections = Arc::new(crate::camera::Connections::default());
        let source = fixture_cloud();
        let main = connections.claim("a", "main", source.clone()).unwrap();
        let other = connections.claim("b", "monitor-fixture", source.clone()).unwrap();
        assert_eq!(connections.claim("a", "monitor-fixture", source.clone()).err().unwrap().kind, "cameraInUse");
        drop(main);
        assert!(connections.claim("a", "monitor-fixture", source.clone()).is_ok());
        assert!(connections.claim("b", "main", source).is_err());
        drop(other);
    }
    #[test]
    fn aggregate_monitor_entries_fit_windows_worker_stack_without_device_io() {
        std::thread::Builder::new()
            .stack_size(1024 * 1024)
            .spawn(|| {
                let state = AppState::with_session(None, None).unwrap();
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    for _ in 0..20 {
                        let catalog = state.monitor_catalog_view(false);
                        let create = state.create_monitor_all(1, vec!["mock".into()]);
                        assert!(std::mem::size_of_val(&catalog) < 128 * 1024);
                        assert!(std::mem::size_of_val(&create) < 128 * 1024);
                        assert!(catalog.await.is_err());
                        assert!(create.await.is_err());
                    }
                });
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
