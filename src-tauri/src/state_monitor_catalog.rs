use super::*;
use crate::monitor_catalog::{self, View};
impl AppState {
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
        let (cloud, generation, scope) = self.monitor_account().await?;
        let epoch = self.inner.lock().await.auth_epoch.clone();
        let future = self
            .monitor_catalog
            .load(format!("{scope}:{generation}"), force, cloud);
        tokio::pin!(future);
        let mut check = tokio::time::interval(Duration::from_millis(100));
        let mut homes = loop {
            tokio::select! {
                result=&mut future=>break result?,
                _=check.tick()=>if epoch.load(std::sync::atomic::Ordering::Acquire)!=generation{return Err(AppError::stale());}
            }
        };
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
            all_homes,
            homes,
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
        let view = self.monitor_catalog_view(false).await?;
        if view.generation != generation {
            return Err(AppError::stale());
        }
        let members = monitor_catalog::selected(&view.homes);
        let expected = members
            .iter()
            .map(|(_, d)| d.did.clone())
            .collect::<std::collections::BTreeSet<_>>();
        if dids.len() != expected.len()
            || dids.iter().collect::<std::collections::BTreeSet<_>>() != expected.iter().collect()
        {
            return Err(AppError::stale());
        }
        let _lifecycle = self.camera_lifecycle.lock().await;
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
    ) -> Result<(String, Vec<Device>)> {
        let (source, home, devices) = self.monitors.aggregate(viewer, generation)?;
        let (cloud, current, _) = self.monitor_account().await?;
        if current != generation
            || cloud.credentials.user_id != source.credentials.user_id
            || cloud.credentials.region != source.credentials.region
        {
            return Err(AppError::stale());
        }
        Ok((home, devices))
    }
    pub async fn read_monitor_all(
        &self,
        viewer_id: String,
        generation: u64,
    ) -> Result<Vec<crate::monitor::Row>> {
        let (home, devices) = self.aggregate_monitor(&viewer_id, generation).await?;
        self.monitors.read(&home, generation, &viewer_id, &devices)
    }
    pub async fn retry_monitor_all(
        &self,
        viewer_id: String,
        generation: u64,
        did: String,
    ) -> Result<()> {
        let (home, devices) = self.aggregate_monitor(&viewer_id, generation).await?;
        let device = devices
            .iter()
            .find(|d| d.did == did)
            .ok_or_else(AppError::stale)?;
        self.monitors
            .retry(&home, generation, &viewer_id, &did, device)
    }
    pub async fn stop_monitor_all(&self, viewer_id: String, generation: u64) -> Result<()> {
        let (home, _) = self.aggregate_monitor(&viewer_id, generation).await?;
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
