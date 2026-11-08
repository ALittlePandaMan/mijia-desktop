use crate::{
    auth::{self, LoginAttempt, PollResult},
    cloud::Cloud,
    error::{AppError, Result},
    models::*,
    preferences::{PreferenceChange, PreferenceStore, PreferenceView},
    spec::{self, SpecRepository},
};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc, time::Duration};
use tokio::sync::{Mutex, OnceCell};
#[path = "state_router_access.rs"]
mod router_access_state;
#[path = "state_router_family.rs"]
mod router_family_state;
#[path = "state_router_qos.rs"]
mod router_qos_state;
#[path = "state_router_url.rs"]
mod router_url_state;

#[path = "state_bath_heater.rs"]
mod bath_heater_state;
#[path = "state_camera.rs"]
mod camera_state;
#[path = "state_ceiling_fan.rs"]
mod ceiling_fan_state;
#[path = "state_ir_remote.rs"]
mod ir_remote_state;
#[path = "state_monitor.rs"]
mod monitor_state;
#[path = "state_router_daily.rs"]
mod router_daily_state;
#[path = "state_router_scene.rs"]
mod router_scene_state;
#[path = "state_vacuum.rs"]
mod vacuum_state;
#[path = "state_scale.rs"]
mod scale_state;

#[path = "state_fryer.rs"]
mod fryer_state;

pub struct AppState {
    cameras: crate::camera::Sessions,
    monitors: crate::monitor::Registry,
    camera_lifecycle: Mutex<()>,
    camera_power_write: Mutex<()>,
    vacuum_write: Mutex<()>,
    camera_exports: Arc<crate::camera::saved_media::Exports>,
    inner: Mutex<Inner>,
    specs: SpecRepository,
    timer_write: Mutex<()>,
    light_settings_write: Mutex<()>,
    light_favorites_write: Mutex<()>,
    local_preferences: Mutex<()>,
    washer_program_write: Mutex<HashMap<String, WasherCommandRecord>>,
    purifier_write: Mutex<()>,
    airer_write: Mutex<()>,
    fridge_write: Mutex<()>,
    bath_heater_write: Mutex<()>,
    ceiling_fan_write: Mutex<()>,
    fryer_write: Mutex<()>,
    fryer_requests: Mutex<HashMap<String, String>>,
    scale_write: Mutex<()>,
    scale_requests: Mutex<HashMap<String, (u64,String)>>,
    ir_remote_write: Mutex<()>,
    ir_remote_nonces: Mutex<HashMap<String, std::collections::VecDeque<String>>>,
    dispenser_write: Mutex<()>,
    dispenser_selfcheck_pending: Mutex<HashMap<String, crate::dispenser_selfcheck::Change>>,
    dispenser_selfcheck_completed: Mutex<HashMap<String, crate::dispenser_selfcheck::Change>>,
    router_indicator_pending: Mutex<HashMap<String, crate::router_indicator::IndicatorChange>>,
    router_client_name_pending: Mutex<HashMap<String, crate::router_client_name::Change>>,
    router_client_name_completed: Mutex<HashMap<String, crate::router_client_name::Change>>,
    router_classification_pending: Mutex<HashMap<String, crate::router_classification::Pending>>,
    router_classification_completed: Mutex<HashMap<String, crate::router_classification::Pending>>,
    router_classification_catalog: Mutex<Option<(u64, crate::router_classification::Catalog)>>,
    router_family_pending: Mutex<HashMap<String, crate::router_family::Pending>>,
    router_family_completed: Mutex<HashMap<String, crate::router_family::Pending>>,
    router_url_pending: Mutex<HashMap<String, crate::router_url::Pending>>,
    router_url_completed: Mutex<HashMap<String, crate::router_url::Pending>>,
    router_qos_pending: Mutex<HashMap<String, crate::router_qos::Pending>>,
    router_qos_completed: Mutex<HashMap<String, crate::router_qos::Pending>>,
    router_access_pending: Mutex<HashMap<String, crate::router_access::Pending>>,
    router_access_completed: Mutex<HashMap<String, crate::router_access::Pending>>,
    router_wifi_pending: Mutex<HashMap<String, crate::router_wifi::WifiChange>>,
    router_daily_attempts: Mutex<HashMap<String, crate::router_daily::Pending>>,
    router_scene_attempts: Mutex<HashMap<String, crate::router_scene::Pending>>,
    router_wifi_gate: Mutex<()>,
    router_internet_pending: Mutex<HashMap<String, crate::router_internet::Change>>,
    router_network_pending: Mutex<HashMap<String, crate::router_network::Pending>>,
    router_advanced_pending: Mutex<HashMap<String, crate::router_advanced::Pending>>,
    panel_flights: Mutex<HashMap<String, Arc<OnceCell<Result<DevicePanel>>>>>,
    home_cards: crate::home_cards::HomeCardRepository,
    property_writes: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    ui_resources: crate::ui_resources::UiResourceRepository,
}
struct Inner {
    cloud: Option<Arc<Cloud>>,
    boot_error: Option<AppError>,
    login: Option<Arc<LoginAttempt>>,
    epoch: u64,
    generation: u64,
    selected: Option<String>,
    homes: Vec<Home>,
    devices: Vec<Device>,
    panels: HashMap<String, DevicePanel>,
    panel_updated_at: HashMap<String, u64>,
    state_revision: u64,
    property_versions: HashMap<String, u64>,
}
struct LightSettingsContext {
    cloud: Arc<Cloud>,
    device: Device,
    panel: DevicePanel,
    home_id: String,
    generation: u64,
    epoch: u64,
}
#[derive(Clone)]
struct WasherReadContext {
    cloud: Arc<Cloud>,
    device: Device,
    home_id: String,
    generation: u64,
    epoch: u64,
    revision: u64,
}
struct WasherCommandRecord {
    context: WasherReadContext,
    draft: crate::washer_programs::ProgramDraft,
    plan: crate::washer_programs::ProgramPlan,
    result: crate::washer_command::CommandResult,
}
impl Inner {
    fn check_washer_identity(&self, context: &WasherReadContext) -> Result<()> {
        self.check_light_modes_context(
            &context.home_id,
            context.generation,
            context.epoch,
            &context.cloud,
            &context.device,
        )?;
        if !self.devices.iter().any(|d| {
            d.did == context.device.did && d.firmware_version == context.device.firmware_version
        }) {
            return Err(AppError::stale());
        }
        Ok(())
    }
    fn check_washer_read(&self, context: &WasherReadContext) -> Result<()> {
        self.check_washer_identity(context)?;
        if self.state_revision != context.revision {
            return Err(AppError::stale());
        }
        Ok(())
    }
    fn clear_home(&mut self) {
        self.state_revision += 1;
        self.property_versions.clear();
        self.generation += 1;
        self.selected = None;
        self.devices.clear();
        self.panels.clear();
        self.panel_updated_at.clear();
    }
    fn check(&self, home: &str, generation: u64) -> Result<()> {
        if self.cloud.is_none() {
            return Err(AppError::auth());
        }
        if self.generation != generation || self.selected.as_deref() != Some(home) {
            Err(AppError::stale())
        } else {
            Ok(())
        }
    }
    fn check_panel(&self, home: &str, generation: u64, panel: &DevicePanel) -> Result<()> {
        self.check(home, generation)?;
        let current = self
            .devices
            .iter()
            .find(|device| device.did == panel.did)
            .ok_or_else(AppError::stale)?;
        if !panel_context_matches(current, panel) {
            return Err(AppError::stale());
        }
        Ok(())
    }
    fn check_control(&self, home: &str, generation: u64, panel: &DevicePanel) -> Result<()> {
        self.check_panel(home, generation, panel)?;
        if self
            .devices
            .iter()
            .any(|device| device.did == panel.did && device.shared_read_only)
        {
            return Err(AppError::new(
                "permissionDenied",
                "此共享设备只有查看权限。",
                false,
            ));
        }
        if self
            .devices
            .iter()
            .any(|device| device.did == panel.did && !device.online)
        {
            return Err(AppError::new("offline", "设备离线，暂不能控制。", false));
        }
        Ok(())
    }
    fn check_light_modes_context(
        &self,
        home: &str,
        generation: u64,
        epoch: u64,
        cloud: &Arc<Cloud>,
        device: &Device,
    ) -> Result<()> {
        self.check(home, generation)?;
        if self.epoch != epoch
            || !self
                .cloud
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, cloud))
            || !self.devices.iter().any(|current| {
                current.did == device.did
                    && current.model == device.model
                    && current.control_did() == device.control_did()
                    && current.split_route.is_none()
                    && current.unsupported_reason.is_none()
            })
        {
            return Err(AppError::stale());
        }
        Ok(())
    }
    fn check_light_settings_context(
        &self,
        context: &LightSettingsContext,
        writing: bool,
    ) -> Result<()> {
        self.check_light_modes_context(
            &context.home_id,
            context.generation,
            context.epoch,
            &context.cloud,
            &context.device,
        )?;
        self.check_panel(&context.home_id, context.generation, &context.panel)?;
        if writing {
            let device = self
                .devices
                .iter()
                .find(|device| device.did == context.device.did)
                .ok_or_else(AppError::stale)?;
            if let Some(reason) = crate::light_settings::write_reason(device, &context.panel) {
                return Err(AppError::new("permissionDenied", reason, false));
            }
        }
        Ok(())
    }
}

fn panel_context_matches(device: &Device, panel: &DevicePanel) -> bool {
    if device.did != panel.did || device.model != panel.model {
        return false;
    }
    if panel.unsupported_reason.is_some() && panel.services.is_empty() {
        return true;
    }
    device.unsupported_reason.is_none()
        && device.control_did() == panel.control_did()
        && device.split_route.is_some() == panel.route_did.is_some()
        && device.split_route.as_ref().is_none_or(|route| {
            !panel.services.is_empty()
                && panel
                    .services
                    .iter()
                    .all(|service| service.siid == route.service_iid)
        })
}
fn property_version_key(did: &str, siid: u32, piid: u32) -> String {
    format!("{did}\n{siid}\n{piid}")
}
fn write_error_is_uncertain(error: &AppError) -> bool {
    matches!(
        error.kind.as_str(),
        "network" | "protocol" | "deviceError" | "offline"
    )
}
fn merge_newer_properties(
    incoming: &mut DevicePanel,
    current: &DevicePanel,
    read_version: u64,
    versions: &HashMap<String, u64>,
) {
    for prop in incoming.services.iter_mut().flat_map(|s| &mut s.properties) {
        if versions
            .get(&property_version_key(&incoming.did, prop.siid, prop.piid))
            .is_some_and(|version| *version > read_version)
        {
            if let Some(confirmed) = current
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .find(|p| p.siid == prop.siid && p.piid == prop.piid)
            {
                *prop = confirmed.clone();
            }
        }
    }
}

fn protect_runtime_panel(inner: &mut Inner, panel: &DevicePanel) {
    inner.state_revision += 1;
    let revision = inner.state_revision;
    for p in panel.services.iter().flat_map(|s| &s.properties) {
        inner
            .property_versions
            .insert(property_version_key(&panel.did, p.siid, p.piid), revision);
    }
    inner.panels.insert(panel.did.clone(), panel.clone());
    inner
        .panel_updated_at
        .insert(panel.did.clone(), epoch_secs());
}
fn property_matches(panel: &DevicePanel, siid: u32, piid: u32, value: &Value) -> bool {
    panel.services.iter().flat_map(|s| &s.properties).any(|p| {
        p.siid == siid
            && p.piid == piid
            && p.code == Some(0)
            && p.value
                .as_ref()
                .is_some_and(|v| spec::values_equal(v, value))
    })
}

impl AppState {
    pub fn new() -> Result<Self> {
        let (cloud, boot_error) = match auth::load().and_then(|c| c.map(Cloud::new).transpose()) {
            Ok(cloud) => (cloud.map(Arc::new), None),
            Err(error) => (None, Some(error)),
        };
        Ok(Self {
            cameras: crate::camera::Sessions::default(),
            camera_power_write: Mutex::new(()),
            monitors: crate::monitor::Registry::default(),
            camera_lifecycle: Mutex::new(()),
            vacuum_write: Mutex::new(()),
            camera_exports: Arc::new(crate::camera::saved_media::Exports::default()),
            home_cards: crate::home_cards::HomeCardRepository::new()?,
            property_writes: Mutex::new(HashMap::new()),
            local_preferences: Mutex::new(()),
            washer_program_write: Mutex::new(HashMap::new()),
            purifier_write: Mutex::new(()),
            airer_write: Mutex::new(()),
            fridge_write: Mutex::new(()),
            bath_heater_write: Mutex::new(()),
            ceiling_fan_write: Mutex::new(()),
            fryer_write: Mutex::new(()),
            fryer_requests: Mutex::new(HashMap::new()),
            scale_write: Mutex::new(()),
            scale_requests: Mutex::new(HashMap::new()),
            ir_remote_write: Mutex::new(()),
            ir_remote_nonces: Mutex::new(HashMap::new()),
            dispenser_write: Mutex::new(()),
            dispenser_selfcheck_pending: Mutex::new(HashMap::new()),
            dispenser_selfcheck_completed: Mutex::new(HashMap::new()),
            inner: Mutex::new(Inner {
                cloud,
                boot_error,
                login: None,
                epoch: 0,
                generation: 0,
                selected: None,
                homes: vec![],
                devices: vec![],
                panels: HashMap::new(),
                panel_updated_at: HashMap::new(),
                state_revision: 0,
                property_versions: HashMap::new(),
            }),
            specs: SpecRepository::new()?,
            timer_write: Mutex::new(()),
            light_settings_write: Mutex::new(()),
            router_indicator_pending: Mutex::new(HashMap::new()),
            router_client_name_pending: Mutex::new(HashMap::new()),
            router_client_name_completed: Mutex::new(HashMap::new()),
            router_classification_pending: Mutex::new(HashMap::new()),
            router_classification_completed: Mutex::new(HashMap::new()),
            router_classification_catalog: Mutex::new(None),
            router_family_pending: Mutex::new(HashMap::new()),
            router_family_completed: Mutex::new(HashMap::new()),
            router_url_pending: Mutex::new(HashMap::new()),
            router_url_completed: Mutex::new(HashMap::new()),
            router_qos_pending: Mutex::new(HashMap::new()),
            router_qos_completed: Mutex::new(HashMap::new()),
            router_access_pending: Mutex::new(HashMap::new()),
            router_access_completed: Mutex::new(HashMap::new()),
            router_wifi_pending: Mutex::new(HashMap::new()),
            router_daily_attempts: Mutex::new(HashMap::new()),
            router_scene_attempts: Mutex::new(HashMap::new()),
            router_wifi_gate: Mutex::new(()),
            router_internet_pending: Mutex::new(HashMap::new()),
            router_network_pending: Mutex::new(HashMap::new()),
            router_advanced_pending: Mutex::new(HashMap::new()),
            light_favorites_write: Mutex::new(()),
            panel_flights: Mutex::new(HashMap::new()),
            ui_resources: crate::ui_resources::UiResourceRepository::new(),
        })
    }
    pub async fn session(&self) -> Result<SessionView> {
        let inner = self.inner.lock().await;
        if let Some(error) = &inner.boot_error {
            return Err(error.clone());
        }
        Ok(inner
            .cloud
            .as_ref()
            .map(|c| c.credentials.view())
            .unwrap_or(SessionView {
                logged_in: false,
                user_id: None,
                region: "cn".into(),
            }))
    }
    pub async fn account_profile(&self) -> Result<AccountProfile> {
        let cloud = self.cloud().await?;
        // Ancillary profile errors must not delete an otherwise working MIoT login.
        let profile = cloud.account_profile().await?;
        let inner = self.inner.lock().await;
        if !inner
            .cloud
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cloud))
        {
            return Err(AppError::stale());
        }
        Ok(profile)
    }
    pub async fn start_login(&self, region: String) -> Result<QrView> {
        let epoch = {
            let mut inner = self.inner.lock().await;
            inner.epoch += 1;
            inner.login = None;
            inner.epoch
        };
        let (attempt, view) = LoginAttempt::start(&region).await?;
        let mut inner = self.inner.lock().await;
        if inner.epoch != epoch {
            return Err(AppError::stale());
        }
        inner.login = Some(Arc::new(attempt));
        Ok(view)
    }
    pub async fn cancel_login(&self, attempt_id: String) -> Result<()> {
        let mut inner = self.inner.lock().await;
        if inner.login.as_ref().is_some_and(|l| l.id == attempt_id) {
            inner.login = None;
            inner.epoch += 1;
        }
        Ok(())
    }
    pub async fn poll_login(&self, attempt_id: String) -> Result<PollView> {
        let attempt = self
            .inner
            .lock()
            .await
            .login
            .as_ref()
            .filter(|a| a.id == attempt_id)
            .cloned()
            .ok_or_else(AppError::stale)?;
        let _guard = attempt
            .poll_lock
            .try_lock()
            .map_err(|_| AppError::new("busy", "已有扫码确认请求，请稍候。", true))?;
        let result = attempt.poll().await?;
        let mut inner = self.inner.lock().await;
        if !inner
            .login
            .as_ref()
            .is_some_and(|a| Arc::ptr_eq(a, &attempt))
        {
            return Err(AppError::stale());
        }
        match result {
            PollResult::Pending => Ok(PollView {
                status: "pending".into(),
                session: None,
            }),
            PollResult::Expired => {
                inner.login = None;
                Ok(PollView {
                    status: "expired".into(),
                    session: None,
                })
            }
            PollResult::Success(credentials) => {
                let view = credentials.view();
                let cloud = Cloud::new(credentials)?;
                auth::save(&cloud.credentials)?;
                inner.cloud = Some(Arc::new(cloud));
                inner.boot_error = None;
                inner.login = None;
                inner.epoch += 1;
                inner.clear_home();
                inner.homes.clear();
                Ok(PollView {
                    status: "success".into(),
                    session: Some(view),
                })
            }
        }
    }
    pub async fn logout(&self) -> Result<()> {
        let mut inner = self.inner.lock().await;
        self.stop_camera_sessions();
        inner.cloud = None;
        inner.login = None;
        inner.epoch += 1;
        inner.clear_home();
        inner.homes.clear();
        inner.boot_error = None;
        let result = auth::delete();
        drop(inner);
        self.router_internet_pending.lock().await.clear();
        self.router_network_pending.lock().await.clear();
        self.dispenser_selfcheck_pending.lock().await.clear();
        self.dispenser_selfcheck_completed.lock().await.clear();
        self.router_client_name_pending.lock().await.clear();
        self.router_client_name_completed.lock().await.clear();
        self.router_classification_pending.lock().await.clear();
        self.router_classification_completed.lock().await.clear();
        *self.router_classification_catalog.lock().await = None;
        self.router_family_pending.lock().await.clear();
        self.router_family_completed.lock().await.clear();
        self.router_url_pending.lock().await.clear();
        self.router_url_completed.lock().await.clear();
        self.router_qos_pending.lock().await.clear();
        self.router_qos_completed.lock().await.clear();
        self.router_access_pending.lock().await.clear();
        self.router_access_completed.lock().await.clear();
        result
    }
    async fn cloud(&self) -> Result<Arc<Cloud>> {
        self.inner
            .lock()
            .await
            .cloud
            .clone()
            .ok_or_else(AppError::auth)
    }
    async fn handle<T>(&self, cloud: &Arc<Cloud>, result: Result<T>) -> Result<T> {
        if result
            .as_ref()
            .err()
            .is_some_and(|e| e.kind == "authExpired")
        {
            let mut inner = self.inner.lock().await;
            if inner.cloud.as_ref().is_some_and(|c| Arc::ptr_eq(c, cloud)) {
                self.stop_camera_sessions();
                inner.cloud = None;
                inner.login = None;
                inner.epoch += 1;
                inner.clear_home();
                inner.homes.clear();
                if let Err(error) = auth::delete() {
                    inner.boot_error = Some(error);
                }
                if let Ok(mut records) = self.router_internet_pending.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.router_network_pending.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.dispenser_selfcheck_pending.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.dispenser_selfcheck_completed.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.router_client_name_pending.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.router_classification_pending.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.router_classification_completed.try_lock() {
                    records.clear();
                }
                if let Ok(mut records) = self.router_client_name_completed.try_lock() {
                    records.clear();
                }
            }
        }
        result
    }
    pub async fn home_preferences(
        &self,
        home_id: String,
        generation: u64,
        change: Option<PreferenceChange>,
    ) -> Result<PreferenceView> {
        // Keep local changes ordered, independently of cloud/device writes.
        let _serial = self.local_preferences.lock().await;
        let (cloud, scope, devices, rooms) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            let cloud = inner.cloud.clone().ok_or_else(AppError::auth)?;
            let scope =
                PreferenceStore::scope(&cloud.credentials.user_id, &cloud.credentials.region);
            let home = inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .ok_or_else(AppError::stale)?;
            (
                cloud,
                scope,
                inner.devices.clone(),
                home.rooms.iter().map(|r| r.id.clone()).collect::<Vec<_>>(),
            )
        };
        let selected = home_id.clone();
        let result = tokio::task::spawn_blocking(move || {
            let store = PreferenceStore::new()?;
            match change {
                Some(change) => store.change(&scope, &selected, change, &devices, &rooms),
                None => store.view(&scope, &selected),
            }
        })
        .await
        .map_err(|_| AppError::new("localPreferences", "本地设置无法读取或保存，请重试。", true))?;
        let inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        if !inner
            .cloud
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, &cloud))
        {
            return Err(AppError::stale());
        }
        result
    }
    pub async fn list_homes(&self) -> Result<Vec<Home>> {
        let cloud = self.cloud().await?;
        let homes = self.handle(&cloud, cloud.homes().await).await?;
        let mut inner = self.inner.lock().await;
        if !inner.cloud.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cloud)) {
            return Err(AppError::stale());
        }
        inner.homes = homes.clone();
        Ok(homes)
    }
    pub async fn select_home(&self, home_id: String) -> Result<HomeSnapshot> {
        let (cloud, home, generation) = {
            let mut inner = self.inner.lock().await;
            self.stop_camera_sessions();
            let cloud = inner.cloud.clone().ok_or_else(AppError::auth)?;
            let home = inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .cloned()
                .ok_or_else(|| AppError::invalid("家庭不在当前账号可访问的列表中。"))?;
            inner.clear_home();
            inner.selected = Some(home_id.clone());
            (cloud, home, inner.generation)
        };
        let snapshot = self.read_home_snapshot(&cloud, &home, generation).await?;
        let mut inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        inner.devices = snapshot.devices.clone();
        Ok(snapshot)
    }
    pub async fn refresh_devices(&self, home_id: String, generation: u64) -> Result<HomeSnapshot> {
        let (cloud, home) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            (
                inner.cloud.clone().unwrap(),
                inner
                    .homes
                    .iter()
                    .find(|h| h.id == home_id)
                    .cloned()
                    .ok_or_else(AppError::stale)?,
            )
        };
        let snapshot = self.read_home_snapshot(&cloud, &home, generation).await?;
        let mut inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        inner.devices = snapshot.devices.clone();
        // A refresh can change split routing or the model descriptor. Rebuild
        // panels rather than retaining a route to an obsolete physical device.
        inner.panels.clear();
        inner.panel_updated_at.clear();
        inner.state_revision += 1;
        inner.property_versions.clear();
        Ok(snapshot)
    }
    async fn classification_catalog(
        &self,
        cloud: &Arc<Cloud>,
    ) -> Result<crate::router_classification::Catalog> {
        let mut cached = self.router_classification_catalog.lock().await;
        if let Some((_, catalog)) = cached
            .as_ref()
            .filter(|(at, _)| epoch_secs().saturating_sub(*at) < 3600)
        {
            return Ok(catalog.clone());
        }
        let catalog = self
            .handle(
                cloud,
                crate::router_classification::fetch_catalog(cloud).await,
            )
            .await?;
        *cached = Some((epoch_secs(), catalog.clone()));
        Ok(catalog)
    }
    fn classification_key(cloud: &Cloud, home_id: &str, did: &str, mac: &str) -> String {
        format!(
            "{}\n{}\n{home_id}\n{did}\n{}",
            cloud.credentials.user_id,
            cloud.credentials.region,
            mac.to_ascii_lowercase()
        )
    }
    pub async fn read_router_classification(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<crate::router_classification::Read> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        if !crate::router_client_name::valid_mac(&mac) {
            return Err(AppError::invalid("设备标识无效。"));
        }
        let catalog = self.classification_catalog(&cloud).await?;
        let items = self
            .handle(&cloud, crate::router::read_clients(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = Self::classification_key(&cloud, &home_id, &did, &mac);
        let pending = self
            .router_classification_pending
            .lock()
            .await
            .get(&key)
            .map(|p| p.change.clone());
        Ok(crate::router_classification::Read {
            report: crate::router_classification::report(&device, &items, &mac, &catalog)?,
            pending,
        })
    }
    pub async fn change_router_classification(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_classification::Change,
        confirm_only: bool,
    ) -> Result<crate::router_classification::Outcome> {
        use crate::router_classification as cls;
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        if !crate::router_client_name::valid_mac(&change.mac) {
            return Err(AppError::invalid("设备标识无效。"));
        }
        let key = Self::classification_key(&cloud, &home_id, &did, &change.mac);
        if self
            .router_client_name_pending
            .lock()
            .await
            .contains_key(&key)
        {
            return Err(AppError::new("busy", "此设备的名称修改尚未确认。", false));
        }
        let catalog = self.classification_catalog(&cloud).await?;
        let mut items = self
            .handle(&cloud, crate::router::read_clients(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let existing = self
            .router_classification_pending
            .lock()
            .await
            .get(&key)
            .cloned();
        let finish =
            |items: &[crate::router::RouterClient], p: &cls::Pending| -> Result<cls::Outcome> {
                let done = cls::confirmed(items, p);
                Ok(cls::Outcome {
                    status: if done { "confirmed" } else { "uncertain" }.into(),
                    message: if done {
                        "设备分类已回读确认。"
                    } else {
                        "设备分类尚未回读确认，只会继续查询，不会重复发送。"
                    }
                    .into(),
                    report: Some(cls::report(&device, items, &change.mac, &catalog)?),
                })
            };
        if let Some(p) = existing {
            if p.change != change {
                return Err(AppError::new("busy", "上次设备分类修改尚未确认。", false));
            }
            let outcome = finish(&items, &p)?;
            if outcome.status == "confirmed" {
                self.router_classification_pending.lock().await.remove(&key);
                self.router_classification_completed
                    .lock()
                    .await
                    .insert(key, p);
            }
            return Ok(outcome);
        }
        if confirm_only {
            let previous = self
                .router_classification_completed
                .lock()
                .await
                .get(&key)
                .cloned()
                .filter(|p| p.change == change)
                .ok_or_else(|| AppError::invalid("没有待确认的设备分类修改。"))?;
            return finish(&items, &previous);
        }
        let (payload, p) = cls::prepare(&device, &items, &catalog, &change)?;
        if crate::router_client_name::select(&items, &change.mac)
            .is_some_and(|client| client.classification.as_ref() == Some(&p.target))
        {
            return Ok(cls::Outcome {
                status: "confirmed".into(),
                message: "设备分类没有变化。".into(),
                report: Some(cls::report(&device, &items, &change.mac, &catalog)?),
            });
        }
        if cls::confirmed(&items, &p) {
            return finish(&items, &p);
        }
        self.router_classification_completed
            .lock()
            .await
            .remove(&key);
        self.router_classification_pending
            .lock()
            .await
            .insert(key.clone(), p.clone());
        match self
            .handle(&cloud, cloud.request_router_classification(payload).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.router_classification_pending.lock().await.remove(&key);
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(&cloud, crate::router::read_clients(&cloud, &device).await)
                .await
            {
                Ok(list) => items = list,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            if cls::confirmed(&items, &p) {
                let outcome = finish(&items, &p)?;
                self.router_classification_pending.lock().await.remove(&key);
                self.router_classification_completed
                    .lock()
                    .await
                    .insert(key, p);
                return Ok(outcome);
            }
        }
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        finish(&items, &p)
    }
    pub async fn router_client_name(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_client_name::Change,
        confirm_only: bool,
    ) -> Result<crate::router_client_name::Outcome> {
        use crate::router_client_name as rename;
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
            .await?;
        if !rename::valid_mac(&change.mac) || !rename::valid_name(&change.name) {
            return Err(AppError::invalid("设备名称或设备标识无效。"));
        }
        let key = format!(
            "{}\n{}\n{}\n{}\n{}",
            cloud.credentials.user_id,
            cloud.credentials.region,
            home_id,
            did,
            change.mac.to_ascii_lowercase()
        );
        if self
            .router_classification_pending
            .lock()
            .await
            .contains_key(&key)
        {
            return Err(AppError::new("busy", "此设备的分类修改尚未确认。", false));
        }
        let mut items = self
            .handle(&cloud, crate::router::read_clients(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
            .await?;
        let existing = self
            .router_client_name_pending
            .lock()
            .await
            .get(&key)
            .cloned();
        if let Some(pending) = existing {
            if pending != change {
                return Err(AppError::new("busy", "上次设备名称修改尚未确认。", false));
            }
            if let Some(client) =
                rename::select(&items, &change.mac).filter(|c| c.name == change.name)
            {
                let client = client.clone();
                self.router_client_name_pending.lock().await.remove(&key);
                self.router_client_name_completed
                    .lock()
                    .await
                    .insert(key, pending);
                return Ok(rename::Outcome {
                    status: "confirmed".into(),
                    message: "设备名称已回读确认。".into(),
                    client: Some(client),
                });
            }
            return Ok(rename::Outcome {
                status: "uncertain".into(),
                message: "名称修改尚未回读确认，只会继续查询，不会重复发送。".into(),
                client: None,
            });
        }
        if confirm_only {
            let complete = self
                .router_client_name_completed
                .lock()
                .await
                .get(&key)
                .cloned();
            if complete.as_ref() == Some(&change) {
                let client = rename::select(&items, &change.mac)
                    .filter(|c| c.name == change.name)
                    .cloned();
                return Ok(rename::Outcome {
                    status: if client.is_some() {
                        "confirmed"
                    } else {
                        "uncertain"
                    }
                    .into(),
                    message: "名称已变化时无法再次确认原结果。".into(),
                    client,
                });
            }
            return Err(AppError::invalid("没有待确认的设备名称修改。"));
        }
        let Some(payload) = rename::payload(&device, &items, &change)? else {
            return Ok(rename::Outcome {
                status: "confirmed".into(),
                message: "设备名称没有变化。".into(),
                client: rename::select(&items, &change.mac).cloned(),
            });
        };
        self.router_client_name_completed.lock().await.remove(&key);
        self.router_client_name_pending
            .lock()
            .await
            .insert(key.clone(), change.clone());
        match self
            .handle(&cloud, cloud.request_router_client_rename(payload).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.router_client_name_pending.lock().await.remove(&key);
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(&cloud, crate::router::read_clients(&cloud, &device).await)
                .await
            {
                Ok(list) => items = list,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
                .await?;
            if let Some(client) =
                rename::select(&items, &change.mac).filter(|c| c.name == change.name)
            {
                let client = client.clone();
                self.router_client_name_pending.lock().await.remove(&key);
                self.router_client_name_completed
                    .lock()
                    .await
                    .insert(key, change);
                return Ok(rename::Outcome {
                    status: "confirmed".into(),
                    message: "设备名称已回读确认。".into(),
                    client: Some(client),
                });
            }
        }
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
            .await?;
        Ok(rename::Outcome {
            status: "uncertain".into(),
            message: "名称修改尚未回读确认，只会继续查询，不会重复发送。".into(),
            client: None,
        })
    }
    async fn router_context(
        &self,
        home_id: &str,
        generation: u64,
        did: &str,
    ) -> Result<(Arc<Cloud>, Device, u64)> {
        let inner = self.inner.lock().await;
        inner.check(home_id, generation)?;
        let device = inner
            .devices
            .iter()
            .find(|d| d.did == did)
            .cloned()
            .ok_or_else(AppError::stale)?;
        crate::router::gateway_id(&device)?;
        Ok((
            inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
            device,
            inner.epoch,
        ))
    }
    async fn ensure_router_context(
        &self,
        home_id: &str,
        generation: u64,
        epoch: u64,
        cloud: &Arc<Cloud>,
        device: &Device,
        writing: bool,
    ) -> Result<()> {
        let inner = self.inner.lock().await;
        inner.check_light_modes_context(home_id, generation, epoch, cloud, device)?;
        let current = inner
            .devices
            .iter()
            .find(|d| d.did == device.did && d.partner_id == device.partner_id)
            .ok_or_else(AppError::stale)?;
        if writing {
            crate::router_indicator::writable(current)?;
        }
        Ok(())
    }
    pub async fn router_network(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        kind: crate::router_network::Kind,
    ) -> Result<crate::router_network::Read> {
        use crate::{router_internet as wan, router_network as net};
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let actual = self
            .handle(&cloud, net::read(&cloud, &device, kind).await)
            .await?;
        let key = wan::record_key(&cloud, epoch, &did);
        let wifi_key = format!(
            "{}\n{}\n{did}",
            cloud.credentials.user_id, cloud.credentials.region
        );
        let pending = self.router_network_pending.lock().await.get(&key).cloned();
        let external_pending = pending
            .as_ref()
            .is_some_and(|p| p.change.values.kind() != kind)
            || self.router_internet_pending.lock().await.contains_key(&key)
            || self
                .router_wifi_pending
                .lock()
                .await
                .contains_key(&wifi_key)
            || self
                .router_advanced_pending
                .lock()
                .await
                .contains_key(&wifi_key);
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let pending =
            pending
                .filter(|p| p.change.values.kind() == kind)
                .map(|p| net::PendingView {
                    id: p.id.clone(),
                    change: p.change.clone(),
                    feedback_required: net::feedback_ready(&actual.report, &p),
                });
        Ok(net::Read {
            report: actual.report,
            pending,
            external_pending,
        })
    }
    pub async fn acknowledge_router_network(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        id: String,
    ) -> Result<crate::router_network::Read> {
        use crate::{router_internet as wan, router_network as net};
        let _gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("busy", "另一项网络设置仍在处理中。", true))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let key = wan::record_key(&cloud, epoch, &did);
        let mut records = self.router_network_pending.lock().await;
        let pending = records
            .get(&key)
            .filter(|p| p.id == id)
            .cloned()
            .ok_or_else(AppError::stale)?;
        let actual = self
            .handle(
                &cloud,
                net::read(&cloud, &device, pending.change.values.kind()).await,
            )
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        if !net::feedback_ready(&actual.report, &pending) {
            return Err(AppError::new(
                "unconfirmed",
                "配置尚未满足终端反馈核实条件。",
                false,
            ));
        }
        records.remove(&key);
        Ok(net::Read {
            report: actual.report,
            pending: None,
            external_pending: false,
        })
    }
    pub async fn change_router_network(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_network::Change,
        confirm_only: bool,
    ) -> Result<crate::router_network::Outcome> {
        use crate::{router_internet as wan, router_network as net};
        net::validate(&change)?;
        let _gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("busy", "另一项网络设置仍在处理中。", true))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(!confirm_only).await?;
        let key = wan::record_key(&cloud, epoch, &did);
        let wifi_key = format!(
            "{}\n{}\n{did}",
            cloud.credentials.user_id, cloud.credentials.region
        );
        let mut records = self.router_network_pending.lock().await;
        let actual = self
            .handle(
                &cloud,
                net::read(&cloud, &device, change.values.kind()).await,
            )
            .await?;
        ensure(!confirm_only).await?;
        if let Some(p) = records.get(&key) {
            if p.change != change {
                return Err(AppError::new(
                    "networkPending",
                    "上一项网络设置仍未确认，请返回原页面核实。",
                    false,
                ));
            }
            let result = net::outcome(actual.report, p);
            if result.status == "confirmed" {
                records.remove(&key);
            }
            return Ok(result);
        }
        if confirm_only {
            return Ok(net::Outcome {
                status: "uncertain",
                report: Some(actual.report),
                message: "没有可确认的本次提交记录；不会发送网络设置。".into(),
                feedback_id: None,
            });
        }
        net::can_save(&actual.report, &change)?;
        if net::matches(&actual.report, &change.values) {
            return Ok(net::Outcome {
                status: "confirmed",
                report: Some(actual.report),
                message: "当前配置未改变。".into(),
                feedback_id: None,
            });
        }
        if self.router_internet_pending.lock().await.contains_key(&key)
            || self
                .router_wifi_pending
                .lock()
                .await
                .contains_key(&wifi_key)
            || self
                .router_advanced_pending
                .lock()
                .await
                .contains_key(&wifi_key)
        {
            return Err(AppError::new(
                "networkPending",
                "上一项网络设置仍未确认，请先返回核实。",
                false,
            ));
        }
        if records.len() >= 128 {
            return Err(AppError::new("busy", "尚有未确认的网络设置。", false));
        }
        let prepared = if matches!(&change.values, net::Values::Ipv6(_)) {
            Some(
                self.handle(
                    &cloud,
                    net::prepare_ipv6(&cloud, &device, &actual, &change.values, false).await,
                )
                .await?,
            )
        } else {
            None
        };
        ensure(true).await?;
        let pending = net::Pending {
            id: uuid::Uuid::new_v4().to_string(),
            change: change.clone(),
            primary_ok: false,
            lan_sent: false,
            lan_ok: false,
        };
        records.insert(key.clone(), pending);
        let receipt = if let Some(prepared) = prepared {
            prepared.send().await
        } else {
            net::write_port(&cloud, &device, &change.values).await
        };
        ensure(false).await?;
        match receipt {
            Ok(()) => records.get_mut(&key).unwrap().primary_ok = true,
            Err(e)
                if matches!(
                    e.kind.as_str(),
                    "routerGateway" | "permissionDenied" | "authExpired"
                ) =>
            {
                records.remove(&key);
                return self.handle(&cloud, Err(e)).await;
            }
            Err(_) => {}
        }
        if net::needs_lan(&change.values) && records[&key].primary_ok {
            // This second write is part of the explicit save, never a query/retry.
            match self
                .handle(
                    &cloud,
                    net::prepare_ipv6(&cloud, &device, &actual, &change.values, true).await,
                )
                .await
            {
                Ok(prepared) => {
                    ensure(true).await?;
                    records.get_mut(&key).unwrap().lan_sent = true;
                    let accepted = prepared.send().await.is_ok();
                    ensure(false).await?;
                    records.get_mut(&key).unwrap().lan_ok = accepted;
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {}
            }
        }
        let mut latest = None;
        let mut latest_message = "网络设置尚未回读确认；只会继续查询，不会重发。".to_string();
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(1200)).await;
            }
            ensure(false).await?;
            match self
                .handle(
                    &cloud,
                    net::read(&cloud, &device, change.values.kind()).await,
                )
                .await
            {
                Ok(s) => {
                    let result =
                        net::outcome(s.report, records.get(&key).ok_or_else(AppError::stale)?);
                    if result.status != "uncertain" {
                        if result.status == "confirmed" {
                            records.remove(&key);
                        }
                        ensure(false).await?;
                        return Ok(result);
                    }
                    latest_message = result.message;
                    latest = result.report;
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {}
            }
        }
        ensure(false).await?;
        Ok(net::Outcome {
            status: "uncertain",
            report: latest,
            message: latest_message,
            feedback_id: None,
        })
    }
    pub async fn router_internet(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_internet::Read> {
        use crate::router_internet as wan;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let actual = self
            .handle(&cloud, wan::read(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = wan::record_key(&cloud, epoch, &did);
        let pending = self.router_internet_pending.lock().await.get(&key).cloned();
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        // Only the explicit confirmation command resolves a stored operation.
        Ok(wan::Read {
            report: actual.report,
            pending,
        })
    }
    pub async fn change_router_internet(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_internet::Change,
        confirm_only: bool,
    ) -> Result<crate::router_internet::Outcome> {
        use crate::router_internet as wan;
        wan::validate(&change)?;
        let _gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("busy", "另一项网络设置仍在处理中。", true))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        if !confirm_only
            && self
                .router_network_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "networkPending",
                "上一项WAN或IPv6设置仍未确认，请返回原页面核实。",
                false,
            ));
        }
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(!confirm_only).await?;
        let key = wan::record_key(&cloud, epoch, &did);
        let wifi_key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let mut records = self.router_internet_pending.lock().await;
        let actual = self
            .handle(&cloud, wan::read(&cloud, &device).await)
            .await?;
        ensure(!confirm_only).await?;
        if let Some(p) = records.get(&key) {
            if p.values != change.values {
                return Err(AppError::new(
                    "busy",
                    "上次网络设置仍未确认，请先核实该操作。",
                    false,
                ));
            }
            if self
                .handle(
                    &cloud,
                    wan::verified(&cloud, &device, &actual.report, &p.values).await,
                )
                .await?
            {
                records.remove(&key);
                ensure(false).await?;
                return Ok(wan::Outcome {
                    status: "confirmed",
                    report: Some(actual.report),
                    message: "配置已回读确认，请核实实际网络连接。".into(),
                });
            }
            return Ok(wan::Outcome {
                status: "uncertain",
                report: Some(actual.report),
                message: "上次网络设置尚未确认，正在查询；不会重复发送。".into(),
            });
        }
        if confirm_only {
            return Ok(wan::Outcome {
                status: "uncertain",
                report: Some(actual.report),
                message: "没有可确认的本次提交记录；不会发送网络设置。".into(),
            });
        }
        if let Some(reason) = &actual.report.write_reason {
            return Err(AppError::new("unsupported", reason, false));
        }
        if wan::matches(&actual.report, &change.values) {
            if !self
                .handle(
                    &cloud,
                    wan::verified(&cloud, &device, &actual.report, &change.values).await,
                )
                .await?
            {
                return Ok(wan::Outcome {
                    status: "uncertain",
                    report: Some(actual.report),
                    message: "配置一致，拨号状态尚未确认；不会重复发送。".into(),
                });
            }
            return Ok(wan::Outcome {
                status: "confirmed",
                report: Some(actual.report),
                message: String::new(),
            });
        }
        if actual.report.revision != change.baseline {
            return Err(AppError::new(
                "conflict",
                "上网配置已变化，请返回后重新编辑。",
                false,
            ));
        }
        if !actual.report.local_available {
            return Err(AppError::new(
                "localRequired",
                "请连接当前路由器的网络后再进行设置。",
                false,
            ));
        }
        if self
            .router_wifi_pending
            .lock()
            .await
            .contains_key(&wifi_key)
            || self
                .router_advanced_pending
                .lock()
                .await
                .contains_key(&wifi_key)
        {
            return Err(AppError::new(
                "busy",
                "上一项Wi-Fi设置仍未确认，请先返回核实。",
                false,
            ));
        }
        if records.len() >= 128 {
            return Err(AppError::new("busy", "尚有未确认的上网设置。", false));
        }
        // Preparation may fetch a temporary token, but cannot write network settings.
        let prepared = self
            .handle(
                &cloud,
                wan::Prepared::new(&cloud, &device, &actual, &change.values).await,
            )
            .await?;
        ensure(true).await?;
        records.insert(key.clone(), change.clone());
        if let Err(error) = prepared.send().await {
            if error.kind == "routerGateway" {
                records.remove(&key);
                return Err(error);
            }
        }
        ensure(false).await?;
        let mut latest = None;
        for attempt in 0..3 {
            tokio::time::sleep(Duration::from_millis(if attempt == 0 {
                2500
            } else {
                1500
            }))
            .await;
            ensure(false).await?;
            match self.handle(&cloud, wan::read(&cloud, &device).await).await {
                Ok(s) => {
                    if self
                        .handle(
                            &cloud,
                            wan::verified(&cloud, &device, &s.report, &change.values).await,
                        )
                        .await?
                    {
                        ensure(false).await?;
                        records.remove(&key);
                        return Ok(wan::Outcome {
                            status: "confirmed",
                            report: Some(s.report),
                            message: "配置已回读确认，请核实实际网络连接。".into(),
                        });
                    }
                    latest = Some(s.report);
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {}
            }
        }
        Ok(wan::Outcome {
            status: "uncertain",
            report: latest,
            message: "网络设置已发送，尚未回读确认；不会重复发送。".into(),
        })
    }
    pub async fn router_indicator(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_indicator::IndicatorRead> {
        use crate::router_indicator as led;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let result = led::read(&cloud, &device).await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let report = self.handle(&cloud, result).await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let mut pending = self.router_indicator_pending.lock().await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        if pending
            .get(&key)
            .is_some_and(|c| led::matches(&report, &c.values))
        {
            pending.remove(&key);
        }
        Ok(led::IndicatorRead {
            report,
            pending: pending.get(&key).cloned(),
        })
    }
    pub async fn change_router_indicator(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_indicator::IndicatorChange,
        confirm_only: bool,
    ) -> Result<crate::router_indicator::IndicatorResult> {
        use crate::router_indicator as led;
        change.validate()?;
        let mut records = self
            .router_indicator_pending
            .try_lock()
            .map_err(|_| AppError::new("busy", "上一项指示灯设置仍在确认。", true))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(!confirm_only).await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let current = self
            .handle(&cloud, led::read(&cloud, &device).await)
            .await?;
        ensure(!confirm_only).await?;
        match led::decision(&current, &change, records.get(&key), confirm_only)? {
            led::SaveDecision::Confirmed => {
                records.remove(&key);
                return Ok(led::IndicatorResult {
                    status: "confirmed".into(),
                    report: Some(current),
                    message: String::new(),
                });
            }
            led::SaveDecision::ConfirmPending => {
                return Ok(led::IndicatorResult {
                    status: "uncertain".into(),
                    report: Some(current),
                    message: "上次设置尚未确认，正在查询实际状态。".into(),
                })
            }
            led::SaveDecision::Send => {
                records.remove(&key);
            }
        }
        if records.len() >= 128 {
            return Err(AppError::new(
                "busy",
                "尚有未确认的指示灯设置，请先查询实际状态。",
                false,
            ));
        }
        let overview = self
            .handle(&cloud, crate::router::load(&cloud, &device).await)
            .await?;
        if change.values.timer_on && overview.indicator_timer_supported != Some(true) {
            return Err(AppError::new(
                "unsupported",
                "未确认此路由器支持指示灯定时控制。",
                false,
            ));
        }
        ensure(true).await?;
        records.insert(key.clone(), change.clone());
        let receipt = led::write(&cloud, &device, &change.values).await;
        ensure(false).await?;
        if let Err(error) = receipt {
            if matches!(
                error.kind.as_str(),
                "routerGateway" | "permissionDenied" | "authExpired"
            ) {
                records.remove(&key);
                return self.handle(&cloud, Err(error)).await;
            }
        }
        let mut latest = None;
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
            ensure(false).await?;
            match self.handle(&cloud, led::read(&cloud, &device).await).await {
                Ok(report) => {
                    if led::matches(&report, &change.values) {
                        ensure(false).await?;
                        records.remove(&key);
                        return Ok(led::IndicatorResult {
                            status: "confirmed".into(),
                            report: Some(report),
                            message: String::new(),
                        });
                    }
                    latest = Some(report);
                }
                Err(error) if error.kind == "authExpired" => return Err(error),
                Err(_) => {}
            }
        }
        ensure(false).await?;
        Ok(led::IndicatorResult {
            status: "uncertain".into(),
            report: latest,
            message: "设置已发送，尚未回读确认；不会重复发送。".into(),
        })
    }
    pub async fn router_overview(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router::RouterReport> {
        let (cloud, device, revision) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            let device = inner
                .devices
                .iter()
                .find(|d| d.did == did)
                .cloned()
                .ok_or_else(AppError::stale)?;
            (
                inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
                device,
                inner.state_revision,
            )
        };
        let result = crate::router::load(&cloud, &device).await;
        {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            if inner.state_revision != revision
                || !inner.cloud.as_ref().is_some_and(|c| Arc::ptr_eq(c, &cloud))
            {
                return Err(AppError::stale());
            }
        }
        self.handle(&cloud, result).await
    }
    pub async fn router_password(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_password::Report> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let result = crate::router_password::read(&cloud, &device).await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        self.handle(&cloud, result).await
    }
    pub async fn router_wifi(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_wifi::WifiRead> {
        use crate::router_wifi as wifi;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let result = wifi::read(&cloud, &device).await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let report = self.handle(&cloud, result).await?.report;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let mut records = self.router_wifi_pending.lock().await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        if records
            .get(&key)
            .is_some_and(|c| wifi::matches(&report, &c.values))
        {
            records.remove(&key);
        }
        let pending = records.get(&key).cloned();
        drop(records);
        let external = self.router_advanced_pending.lock().await.get(&key).cloned();
        if let Some(change) = external {
            let actual = self
                .handle(&cloud, crate::router_advanced::read(&cloud, &device).await)
                .await?;
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            let mut operations = self.router_advanced_pending.lock().await;
            if operations.get(&key) == Some(&change) && change.matches(&actual.report) {
                operations.remove(&key);
            }
            return Ok(wifi::WifiRead {
                report: actual.report.wifi,
                pending,
                external_pending: operations.contains_key(&key),
            });
        }
        Ok(wifi::WifiRead {
            report,
            pending,
            external_pending: false,
        })
    }
    pub async fn change_router_wifi(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_wifi::WifiChange,
        confirm_only: bool,
    ) -> Result<crate::router_wifi::WifiResult> {
        use crate::router_wifi as wifi;
        wifi::valid_change(&change)?;
        let _gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("wifiBusy", "另一项Wi-Fi设置正在处理。", false))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        if !confirm_only
            && self
                .router_network_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "networkPending",
                "上一项WAN或IPv6设置仍未确认，请返回原页面核实。",
                false,
            ));
        }
        if (!confirm_only)
            && self
                .router_internet_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "busy",
                "上一项上网设置仍未确认，请先返回核实。",
                false,
            ));
        }
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(!confirm_only).await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let external = self.router_advanced_pending.lock().await.get(&key).cloned();
        if let Some(op) = external {
            let actual = self
                .handle(&cloud, crate::router_advanced::read(&cloud, &device).await)
                .await?;
            ensure(!confirm_only).await?;
            if !op.matches(&actual.report) {
                return Err(AppError::new(
                    "wifiBusy",
                    "上次高级Wi-Fi设置尚未确认，请先核对实际状态。",
                    false,
                ));
            }
            let mut pending = self.router_advanced_pending.lock().await;
            if pending.get(&key) == Some(&op) {
                pending.remove(&key);
            }
        }
        let mut records = self.router_wifi_pending.lock().await;
        let current = self
            .handle(&cloud, wifi::read(&cloud, &device).await)
            .await?;
        ensure(!confirm_only).await?;
        match wifi::decision(&current.report, &change, records.get(&key), confirm_only)? {
            wifi::SaveDecision::Confirmed => {
                records.remove(&key);
                return Ok(wifi::WifiResult {
                    status: "confirmed".into(),
                    report: Some(current.report),
                    message: String::new(),
                });
            }
            wifi::SaveDecision::ConfirmPending => {
                return Ok(wifi::WifiResult {
                    status: "uncertain".into(),
                    report: Some(current.report),
                    message: "Wi-Fi设置尚未回读确认，不会重复发送。".into(),
                })
            }
            wifi::SaveDecision::Send => {}
        }
        let payload = current.payload(&device, &change)?;
        if records.len() >= 64 {
            return Err(AppError::new(
                "busy",
                "尚有未确认的Wi-Fi设置，请先查询实际状态。",
                false,
            ));
        }
        ensure(true).await?;
        records.insert(key.clone(), change.clone());
        let receipt = wifi::write(&cloud, payload).await;
        ensure(false).await?;
        if let Err(error) = receipt {
            if matches!(
                error.kind.as_str(),
                "routerGateway" | "permissionDenied" | "authExpired"
            ) {
                records.remove(&key);
                return self.handle(&cloud, Err(error)).await;
            }
        }
        let mut latest = None;
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            ensure(false).await?;
            match self.handle(&cloud, wifi::read(&cloud, &device).await).await {
                Ok(snapshot) => {
                    ensure(false).await?;
                    if wifi::matches(&snapshot.report, &change.values) {
                        records.remove(&key);
                        return Ok(wifi::WifiResult {
                            status: "confirmed".into(),
                            report: Some(snapshot.report),
                            message: String::new(),
                        });
                    }
                    latest = Some(snapshot.report);
                }
                Err(error) if error.kind == "authExpired" => return Err(error),
                Err(_) => {}
            }
        }
        ensure(false).await?;
        Ok(wifi::WifiResult {
            status: "uncertain".into(),
            report: latest,
            message: "设置已发送，正在等待Wi-Fi恢复并核对实际状态；不会重复发送。".into(),
        })
    }
    pub async fn router_advanced(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_advanced::Read> {
        use crate::router_advanced as adv;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let actual = self
            .handle(&cloud, adv::read(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let config_pending = {
            let mut records = self.router_wifi_pending.lock().await;
            if records
                .get(&key)
                .is_some_and(|c| crate::router_wifi::matches(&actual.report.wifi, &c.values))
            {
                records.remove(&key);
            }
            records.contains_key(&key)
        };
        let mut records = self.router_advanced_pending.lock().await;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        if records.get(&key).is_some_and(|c| c.matches(&actual.report)) {
            records.remove(&key);
        }
        Ok(adv::Read {
            report: actual.report,
            pending: records.get(&key).map(|p| p.change.clone()),
            config_pending,
            dfs: records.get(&key).and_then(|p| p.view_dfs()),
        })
    }
    pub async fn change_router_advanced(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::router_advanced::Change,
        confirm_only: bool,
    ) -> Result<crate::router_advanced::Outcome> {
        use crate::{router_advanced as adv, router_wifi as wifi};
        adv::validate(&change)?;
        let _gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("wifiBusy", "另一项Wi-Fi设置正在处理。", false))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        if !confirm_only
            && self
                .router_network_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "networkPending",
                "上一项WAN或IPv6设置仍未确认，请返回原页面核实。",
                false,
            ));
        }
        if (!confirm_only)
            && self
                .router_internet_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "busy",
                "上一项上网设置仍未确认，请先返回核实。",
                false,
            ));
        }
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(!confirm_only).await?;
        let actual = self
            .handle(&cloud, adv::read(&cloud, &device).await)
            .await?;
        ensure(!confirm_only).await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        {
            let mut configs = self.router_wifi_pending.lock().await;
            if let Some(c) = configs.get(&key) {
                if !wifi::matches(&actual.report.wifi, &c.values) {
                    return Err(AppError::new(
                        "wifiBusy",
                        "上次Wi-Fi配置尚未确认，请先核对实际状态。",
                        false,
                    ));
                }
                configs.remove(&key);
            }
        }
        let mut records = self.router_advanced_pending.lock().await;
        if let Some(p) = records.get(&key).filter(|p| p.wait_left() > 0) {
            return Ok(adv::Outcome {
                status: "waiting".into(),
                report: Some(actual.report),
                message: "Wi-Fi正在开启，等待雷达检测完成。".into(),
                dfs: p.view_dfs(),
            });
        }
        match adv::decision(
            &actual.report,
            &change,
            records.get(&key).map(|p| &p.change),
            confirm_only,
        )? {
            wifi::SaveDecision::Confirmed => {
                records.remove(&key);
                return Ok(adv::Outcome {
                    status: "confirmed".into(),
                    dfs: None,
                    report: Some(actual.report),
                    message: String::new(),
                });
            }
            wifi::SaveDecision::ConfirmPending => {
                return Ok(adv::Outcome {
                    status: if records.get(&key).is_some_and(|p| p.view_dfs().is_some()) {
                        "dfsRequired".into()
                    } else {
                        "uncertain".into()
                    },
                    dfs: records.get(&key).and_then(|p| p.view_dfs()),
                    report: Some(actual.report),
                    message: "上次高级Wi-Fi设置尚未确认，正在查询实际状态。".into(),
                })
            }
            wifi::SaveDecision::Send => {}
        }
        let (payload, config) = actual.payloads(&device, &change)?;
        if records.len() >= 64 {
            return Err(AppError::new(
                "wifiBusy",
                "尚有未确认的高级Wi-Fi设置。",
                false,
            ));
        }
        ensure(true).await?;
        records.insert(
            key.clone(),
            adv::Pending {
                change: change.clone(),
                dfs: None,
                ready_at: None,
            },
        );
        let receipt = adv::write(&cloud, &change, payload, config).await;
        ensure(false).await?;
        if let Ok(adv::Receipt::NeedDfs(seconds)) = &receipt {
            let dfs = adv::DfsChallenge {
                id: uuid::Uuid::new_v4().to_string(),
                seconds: *seconds,
                waiting: false,
            };
            if let Some(p) = records.get_mut(&key) {
                p.dfs = Some(dfs.clone());
            }
            let fresh = self.handle(&cloud, adv::read(&cloud, &device).await).await;
            ensure(false).await?;
            let report = match fresh {
                Ok(s) => Some(s.report),
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => None,
            };
            return Ok(adv::Outcome {
                status: "dfsRequired".into(),
                report,
                message: String::new(),
                dfs: Some(dfs),
            });
        }
        if let Ok(adv::Receipt::Waiting(seconds)) = &receipt {
            if let Some(p) = records.get_mut(&key) {
                p.start_wait(*seconds);
            }
            return Ok(adv::Outcome {
                status: "waiting".into(),
                report: Some(actual.report),
                message: String::new(),
                dfs: records.get(&key).and_then(|p| p.view_dfs()),
            });
        }
        if let Err(error) = receipt {
            if matches!(
                error.kind.as_str(),
                "routerGateway" | "permissionDenied" | "authExpired" | "routerDfsConfirmation"
            ) {
                records.remove(&key);
                if error.kind == "authExpired" {
                    return self.handle(&cloud, Err(error)).await;
                }
                let fresh = self.handle(&cloud, adv::read(&cloud, &device).await).await;
                ensure(false).await?;
                return match fresh {
                    Ok(current) if adv::matches(&current.report, &change) => Ok(adv::Outcome {
                        status: "confirmed".into(),
                        dfs: None,
                        report: Some(current.report),
                        message: "已回读确认实际状态。".into(),
                    }),
                    Ok(current) => Ok(adv::Outcome {
                        status: "rejected".into(),
                        dfs: None,
                        report: Some(current.report),
                        message: if change.wifi.is_some() && error.kind != "routerDfsConfirmation" {
                            "设置未全部生效，请核对当前读取的Wi-Fi配置。".into()
                        } else {
                            error.message
                        },
                    }),
                    Err(e) if e.kind == "authExpired" => Err(e),
                    Err(_) => Ok(adv::Outcome {
                        status: "rejected".into(),
                        dfs: None,
                        report: None,
                        message: "设置被拒绝，正在重新查询实际状态。".into(),
                    }),
                };
            }
        }
        let mut latest = None;
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
            ensure(false).await?;
            match self.handle(&cloud, adv::read(&cloud, &device).await).await {
                Ok(current) => {
                    ensure(false).await?;
                    if adv::matches(&current.report, &change) {
                        records.remove(&key);
                        return Ok(adv::Outcome {
                            status: "confirmed".into(),
                            dfs: None,
                            report: Some(current.report),
                            message: String::new(),
                        });
                    }
                    latest = Some(current.report);
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {}
            }
        }
        ensure(false).await?;
        Ok(adv::Outcome {
            status: "uncertain".into(),
            dfs: None,
            report: latest,
            message: "设置已发送，实际状态尚未确认；只继续查询，不重复发送。".into(),
        })
    }
    pub async fn respond_router_dfs(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        id: String,
        proceed: bool,
    ) -> Result<crate::router_advanced::Outcome> {
        use crate::router_advanced as adv;
        if uuid::Uuid::parse_str(&id).is_err() {
            return Err(AppError::invalid("DFS确认标识无效。"));
        }
        let gate = self
            .router_wifi_gate
            .try_lock()
            .map_err(|_| AppError::new("wifiBusy", "另一项Wi-Fi设置正在处理。", false))?;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        if proceed
            && self
                .router_network_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "networkPending",
                "上一项WAN或IPv6设置仍未确认，请返回原页面核实。",
                false,
            ));
        }
        if (proceed)
            && self
                .router_internet_pending
                .lock()
                .await
                .contains_key(&crate::router_internet::record_key(&cloud, epoch, &did))
        {
            return Err(AppError::new(
                "busy",
                "上一项上网设置仍未确认，请先返回核实。",
                false,
            ));
        }
        let ensure = |writing| {
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, writing)
        };
        ensure(proceed).await?;
        let actual = self
            .handle(&cloud, adv::read(&cloud, &device).await)
            .await?;
        ensure(proceed).await?;
        let key = format!(
            "{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, did
        );
        let mut records = self.router_advanced_pending.lock().await;
        let pending = records
            .get(&key)
            .cloned()
            .ok_or_else(|| AppError::new("conflict", "DFS确认已结束，请查询实际状态。", false))?;
        match pending.dfs_decision(&actual.report, &id, proceed)? {
            adv::DfsDecision::Confirmed => {
                records.remove(&key);
                return Ok(adv::Outcome {
                    status: "confirmed".into(),
                    report: Some(actual.report),
                    message: "已回读确认实际状态。".into(),
                    dfs: None,
                });
            }
            adv::DfsDecision::Cancel => {
                records.remove(&key);
                return Ok(adv::Outcome {
                    status: "rejected".into(),
                    report: Some(actual.report),
                    message: "已取消DFS配置，已重新读取实际状态。".into(),
                    dfs: None,
                });
            }
            adv::DfsDecision::Conflict => {
                records.remove(&key);
                return Ok(adv::Outcome {
                    status: "rejected".into(),
                    report: Some(actual.report),
                    message: "等待确认期间Wi-Fi配置已变化，已停止提交。".into(),
                    dfs: None,
                });
            }
            adv::DfsDecision::Send => {}
        }
        let payload = match actual.config_payload(&device, &pending.change, true) {
            Ok(p) => p,
            Err(e) => {
                records.remove(&key);
                return Ok(adv::Outcome {
                    status: "rejected".into(),
                    report: Some(actual.report),
                    message: e.message,
                    dfs: None,
                });
            }
        };
        ensure(true).await?;
        records
            .get_mut(&key)
            .ok_or_else(AppError::stale)?
            .consume_dfs(&id)?;
        // Consume before dispatch. Reopening, duplicate callbacks and polling never replay this request.
        let receipt = cloud
            .request_router_wifi_write(payload)
            .await
            .and_then(adv::config_receipt);
        ensure(false).await?;
        if let Ok(adv::Receipt::Waiting(seconds)) = &receipt {
            if let Some(p) = records.get_mut(&key) {
                p.start_wait(*seconds);
            }
        }
        if let Err(error) = receipt {
            if matches!(
                error.kind.as_str(),
                "routerGateway" | "permissionDenied" | "authExpired"
            ) {
                records.remove(&key);
                if error.kind == "authExpired" {
                    return self.handle(&cloud, Err(error)).await;
                }
                let fresh = self.handle(&cloud, adv::read(&cloud, &device).await).await;
                ensure(false).await?;
                return match fresh {
                    Ok(current) if adv::matches(&current.report, &pending.change) => {
                        Ok(adv::Outcome {
                            status: "confirmed".into(),
                            report: Some(current.report),
                            message: String::new(),
                            dfs: None,
                        })
                    }
                    Ok(current) => Ok(adv::Outcome {
                        status: "rejected".into(),
                        report: Some(current.report),
                        message: error.message,
                        dfs: None,
                    }),
                    Err(e) if e.kind == "authExpired" => Err(e),
                    Err(_) => Ok(adv::Outcome {
                        status: "rejected".into(),
                        report: None,
                        message: "DFS配置被拒绝，正在查询实际状态。".into(),
                        dfs: None,
                    }),
                };
            }
        }
        drop(records);
        drop(gate);
        self.change_router_advanced(home_id, generation, did, pending.change, true)
            .await
    }
    pub async fn home_cards(
        &self,
        home_id: String,
        generation: u64,
    ) -> Result<crate::home_cards::HomeCardReport> {
        let (cloud, devices, revision) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            (
                inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
                inner.devices.clone(),
                inner.state_revision,
            )
        };
        let result = self
            .home_cards
            .load(
                cloud.clone(),
                &self.specs,
                &self.ui_resources,
                &home_id,
                generation,
                &devices,
            )
            .await;
        {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            if inner.state_revision != revision {
                return Err(AppError::stale());
            }
            if !inner
                .cloud
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &cloud))
            {
                return Err(AppError::stale());
            }
        }
        self.handle(&cloud, result).await
    }
    async fn washer_read_context(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<WasherReadContext> {
        let inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        let device = inner
            .devices
            .iter()
            .find(|d| d.did == did)
            .cloned()
            .ok_or_else(AppError::stale)?;
        if !crate::washer::supports_metadata(&device)
            || device.split_route.is_some()
            || device.unsupported_reason.is_some()
        {
            return Err(AppError::new(
                "unsupported",
                "此设备尚无已核实的专用洗衣接口。",
                false,
            ));
        }
        Ok(WasherReadContext {
            cloud: inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
            device,
            home_id,
            generation,
            epoch: inner.epoch,
            revision: inner.state_revision,
        })
    }
    async fn finish_washer_read<T>(
        &self,
        context: &WasherReadContext,
        result: Result<T>,
    ) -> Result<T> {
        self.inner.lock().await.check_washer_read(context)?;
        let result = self.handle(&context.cloud, result).await;
        if result.as_ref().is_err_and(|e| e.kind == "authExpired") {
            return result;
        }
        self.inner.lock().await.check_washer_read(context)?;
        result
    }
    async fn washer_program_input(
        &self,
        context: &WasherReadContext,
        draft: &crate::washer_programs::ProgramDraft,
    ) -> Result<(DevicePanel, crate::washer_programs::ProgramPlan)> {
        let (config, schema) = tokio::try_join!(
            crate::washer::load(&context.cloud, &context.device),
            self.specs.panel(&context.device)
        )?;
        self.inner.lock().await.check_washer_read(context)?;
        let rows = context.cloud.read_panel_properties(&schema).await?;
        self.inner.lock().await.check_washer_read(context)?;
        let mut panel = schema;
        spec::apply_reads(&mut panel, &rows);
        let now_ms = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| AppError::invalid("系统时间不正确。"))?
            .as_millis() as u64;
        let plan =
            crate::washer_programs::prepare(&context.device, &panel, &config, draft, now_ms)?;
        Ok((panel, plan))
    }
    pub async fn washer_program_preview(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        draft: crate::washer_programs::ProgramDraft,
    ) -> Result<crate::washer_programs::ProgramPreview> {
        let context = self.washer_read_context(home_id, generation, did).await?;
        let input = self.washer_program_input(&context, &draft).await;
        let (panel, plan) = self.finish_washer_read(&context, input).await?;
        let commands = self.washer_program_write.lock().await;
        let inner = self.inner.lock().await;
        inner.check_washer_read(&context)?;
        let pending = commands.iter().find(|(_, record)| {
            record.context.device.did == context.device.did
                && record.result.status == crate::washer_command::CommandStatus::Uncertain
                && inner.check_washer_identity(&record.context).is_ok()
        });
        let reason = pending
            .map(|_| "该洗衣机仍有未确认的请求，请先重新读取状态。".into())
            .or_else(|| {
                crate::washer_programs::ready(&context.device, &panel)
                    .err()
                    .map(|e| e.message)
            });
        Ok(crate::washer_programs::ProgramPreview {
            estimated_minutes: plan.estimated_minutes,
            can_start: reason.is_none(),
            reason,
            request_id: pending.map(|(id, _)| id.clone()),
            panel,
        })
    }
    fn washer_request_id(request_id: &str) -> Result<()> {
        if request_id.len() != 36
            || !request_id.bytes().enumerate().all(|(i, b)| {
                if [8, 13, 18, 23].contains(&i) {
                    b == b'-'
                } else {
                    b.is_ascii_hexdigit()
                }
            })
        {
            return Err(AppError::invalid("洗涤请求标识无效。"));
        }
        Ok(())
    }
    async fn accept_washer_command(
        &self,
        context: &WasherReadContext,
        result: &crate::washer_command::CommandResult,
    ) -> Result<()> {
        let mut inner = self.inner.lock().await;
        inner.check_washer_read(context)?;
        if let Some(panel) = &result.panel {
            inner.check_panel(&context.home_id, context.generation, panel)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            for p in panel.services.iter().flat_map(|s| &s.properties) {
                inner
                    .property_versions
                    .insert(property_version_key(&panel.did, p.siid, p.piid), revision);
            }
            inner.panels.insert(panel.did.clone(), panel.clone());
            inner
                .panel_updated_at
                .insert(panel.did.clone(), epoch_secs());
        }
        Ok(())
    }
    pub async fn start_washer_program(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
        draft: crate::washer_programs::ProgramDraft,
    ) -> Result<crate::washer_command::CommandResult> {
        use crate::washer_command::{self, CloudTransport, CommandPhase, CommandStatus};
        Self::washer_request_id(&request_id)?;
        let mut commands = self.washer_program_write.lock().await;
        let context = self.washer_read_context(home_id, generation, did).await?;
        if let Some(old) = commands.get(&request_id) {
            self.inner
                .lock()
                .await
                .check_washer_identity(&old.context)?;
            if old.context.device.did != context.device.did
                || old.draft.program != draft.program
                || old.draft.values != draft.values
                || old.draft.reservation_at != draft.reservation_at
            {
                return Err(AppError::invalid("不能用同一请求标识提交其他程序。"));
            }
            return Ok(old.result.clone());
        }
        // A lost UI reply cannot turn another click into another start request.
        let inner = self.inner.lock().await;
        commands.retain(|_, record| inner.check_washer_identity(&record.context).is_ok());
        if commands.values().any(|record| {
            record.context.device.did == context.device.did
                && record.result.status == CommandStatus::Uncertain
        }) {
            return Err(AppError::new(
                "unconfirmedCommand",
                "该洗衣机仍有未确认的请求，请先重新读取状态。",
                false,
            ));
        }
        if commands.len() >= 256 {
            return Err(AppError::new(
                "busy",
                "本次会话的洗涤请求已达上限，请重新登录后重试。",
                false,
            ));
        }
        drop(inner);
        let input = self.washer_program_input(&context, &draft).await;
        let (panel, plan) = self.finish_washer_read(&context, input).await?;
        {
            let inner = self.inner.lock().await;
            inner.check_washer_read(&context)?;
            inner.check_control(&context.home_id, context.generation, &panel)?;
        }
        crate::washer_programs::ready(&context.device, &panel)?;
        let transport = CloudTransport {
            cloud: &context.cloud,
            device: &context.device,
            schema: &panel,
        };
        let check = || async {
            let inner = self.inner.lock().await;
            inner.check_washer_read(&context)?;
            inner.check_control(&context.home_id, context.generation, &panel)
        };
        commands.insert(
            request_id.clone(),
            WasherCommandRecord {
                context: context.clone(),
                draft,
                plan: plan.clone(),
                result: washer_command::uncertain(
                    CommandPhase::Start,
                    "请求结果尚未确认，请重新读取设备状态。",
                ),
            },
        );
        let result = washer_command::commit(
            &transport,
            &context.device,
            &panel,
            &plan,
            &check,
            Duration::from_millis(600),
        )
        .await;
        let result = self.finish_washer_read(&context, result).await?;
        commands
            .get_mut(&request_id)
            .ok_or_else(AppError::stale)?
            .result = result.clone();
        self.accept_washer_command(&context, &result).await?;
        Ok(result)
    }
    pub async fn confirm_washer_program(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        request_id: String,
    ) -> Result<crate::washer_command::CommandResult> {
        use crate::washer_command::{self, CloudTransport};
        Self::washer_request_id(&request_id)?;
        let mut commands = self.washer_program_write.lock().await;
        let context = self.washer_read_context(home_id, generation, did).await?;
        let record = commands.get_mut(&request_id).ok_or_else(|| {
            AppError::new(
                "commandNotFound",
                "此前请求尚未提交，可重新核对程序。",
                false,
            )
        })?;
        self.inner
            .lock()
            .await
            .check_washer_identity(&record.context)?;
        if record.context.device.did != context.device.did {
            return Err(AppError::stale());
        }
        let schema = self.specs.panel(&context.device).await?;
        let transport = CloudTransport {
            cloud: &context.cloud,
            device: &context.device,
            schema: &schema,
        };
        let check = || async { self.inner.lock().await.check_washer_read(&context) };
        let result = washer_command::confirm(
            &transport,
            &context.device,
            &record.plan,
            record.result.phase,
            &check,
            Duration::from_millis(600),
        )
        .await;
        let result = self.finish_washer_read(&context, result).await?;
        self.accept_washer_command(&context, &result).await?;
        record.result = result.clone();
        Ok(result)
    }
    pub async fn washer_records(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        range: crate::washer_records::LogRange,
        cursor: Option<String>,
    ) -> Result<crate::washer_records::RecordReport> {
        range.validate()?;
        let context = self.washer_read_context(home_id, generation, did).await?;
        let result =
            crate::washer_records::load(&context.cloud, &context.device, range, cursor).await;
        self.finish_washer_read(&context, result).await
    }
    pub async fn washer_record_detail(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        range: crate::washer_records::LogRange,
        cursor: Option<String>,
        record_id: String,
    ) -> Result<crate::washer_records::RecordDetail> {
        range.validate()?;
        let context = self.washer_read_context(home_id, generation, did).await?;
        let result = crate::washer_records::load_detail(
            &context.cloud,
            &context.device,
            range,
            cursor,
            record_id,
        )
        .await;
        self.finish_washer_read(&context, result).await
    }
    pub async fn washer_config(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::washer::WasherConfigReport> {
        let (cloud, device, epoch, revision) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            let device = inner
                .devices
                .iter()
                .find(|d| d.did == did)
                .cloned()
                .ok_or_else(AppError::stale)?;
            crate::washer::query(&device)?;
            (
                inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
                device,
                inner.epoch,
                inner.state_revision,
            )
        };
        let result = crate::washer::load(&cloud, &device).await;
        {
            let inner = self.inner.lock().await;
            inner.check_light_modes_context(&home_id, generation, epoch, &cloud, &device)?;
            if inner.state_revision != revision
                || !inner
                    .devices
                    .iter()
                    .any(|d| d.did == device.did && d.firmware_version == device.firmware_version)
            {
                return Err(AppError::stale());
            }
        }
        let result = self.handle(&cloud, result).await;
        if result.as_ref().is_err_and(|e| e.kind == "authExpired") {
            return result;
        }
        let inner = self.inner.lock().await;
        inner.check_light_modes_context(&home_id, generation, epoch, &cloud, &device)?;
        if inner.state_revision != revision {
            return Err(AppError::stale());
        }
        result
    }
    pub async fn change_home_card(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        intent: String,
        confirm_only: bool,
    ) -> Result<crate::home_cards::HomeCardResult> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let prepared = self
            .home_cards
            .prepare_write(&cloud, &self.specs, &device, &intent)
            .await;
        // Even a failed prepare must not expose another account's result.
        {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            if !inner
                .cloud
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, &cloud))
            {
                return Err(AppError::stale());
            }
        }
        let prepared = self.handle(&cloud, prepared).await?;
        let result = if confirm_only {
            self.confirm_property(
                home_id.clone(),
                generation,
                did.clone(),
                prepared.siid,
                prepared.piid,
                prepared.value,
            )
            .await?
        } else {
            self.set_property(
                home_id.clone(),
                generation,
                did.clone(),
                prepared.siid,
                prepared.piid,
                prepared.value,
            )
            .await?
        };
        let current = self
            .home_cards
            .load(
                cloud.clone(),
                &self.specs,
                &self.ui_resources,
                &home_id,
                generation,
                std::slice::from_ref(&device),
            )
            .await;
        let (card, status) = match self.handle(&cloud, current).await {
            Ok(report) => (
                report.cards.into_iter().find(|card| card.did == did),
                report.statuses.into_iter().find(|status| status.did == did),
            ),
            Err(error) if error.kind == "authExpired" => return Err(error),
            Err(_) => (None, None),
        };
        self.inner.lock().await.check(&home_id, generation)?;
        let actual = if result.verified {
            Some(intent)
        } else {
            card.as_ref()
                .filter(|card| card.kind == "power")
                .and_then(|card| card.selected)
                .map(|selected| if selected { "on" } else { "off" }.into())
        };
        Ok(crate::home_cards::HomeCardResult {
            verified: result.verified,
            message: result.message,
            card,
            status,
            actual,
        })
    }
    async fn read_home_snapshot(
        &self,
        cloud: &Arc<Cloud>,
        home: &Home,
        generation: u64,
    ) -> Result<HomeSnapshot> {
        let devices = self.handle(cloud, cloud.devices(home).await).await?;
        self.inner.lock().await.check(&home.id, generation)?;
        let (order, order_notice) =
            match tokio::time::timeout(Duration::from_secs(5), cloud.home_order(home, &devices))
                .await
            {
                Ok(result) => match self.handle(cloud, result).await {
                    Ok(order) => (Some(order), None),
                    Err(error) if error.kind == "authExpired" => return Err(error),
                    Err(_) => (
                        None,
                        Some("设备已加载，暂无法同步米家中的排列顺序。".into()),
                    ),
                },
                Err(_) => (None, Some("设备已加载，排列顺序同步超时。".into())),
            };
        Ok(HomeSnapshot {
            home_id: home.id.clone(),
            generation,
            devices,
            order,
            order_notice,
        })
    }
    async fn device(
        &self,
        home_id: &str,
        generation: u64,
        did: &str,
    ) -> Result<(Arc<Cloud>, Device)> {
        let inner = self.inner.lock().await;
        inner.check(home_id, generation)?;
        let device = inner
            .devices
            .iter()
            .find(|d| d.did == did)
            .cloned()
            .ok_or_else(|| AppError::invalid("设备不属于当前家庭。"))?;
        Ok((inner.cloud.clone().unwrap(), device))
    }
    pub async fn speaker_player(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::speaker::Player> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !device.online {
            return Err(AppError::new(
                "offline",
                "音箱离线，暂不能读取播放状态。",
                true,
            ));
        }
        let report = tokio::time::timeout(
            Duration::from_secs(10),
            crate::speaker::load(&cloud, &device),
        )
        .await
        .map_err(|_| AppError::new("network", "播放状态读取超时。", true))??;
        self.inner.lock().await.check(&home_id, generation)?;
        Ok(report)
    }
    pub async fn change_speaker(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::speaker::Change,
    ) -> Result<()> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !device.online {
            return Err(AppError::new(
                "offline",
                "音箱离线，恢复在线后可操作。",
                false,
            ));
        }
        if device.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享音箱只有查看权限。",
                false,
            ));
        }
        crate::speaker::command(&change)?;
        let result = tokio::time::timeout(
            Duration::from_secs(10),
            cloud.change_speaker(&device, &change),
        )
        .await
        .map_err(|_| AppError::new("network", "播放器操作待确认。", true))?;
        self.inner.lock().await.check(&home_id, generation)?;
        self.handle(&cloud, result).await
    }
    pub async fn device_panel(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<DevicePanel> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let key = format!("{generation}\n{home_id}\n{did}");
        let flight = {
            let mut flights = self.panel_flights.lock().await;
            flights.entry(key.clone()).or_default().clone()
        };
        let result = flight
            .get_or_init(|| async {
                let panel = self.specs.panel(&device).await?;
                self.read_panel(&cloud, &home_id, generation, panel, true)
                    .await
            })
            .await
            .clone();
        let mut flights = self.panel_flights.lock().await;
        if flights
            .get(&key)
            .is_some_and(|current| Arc::ptr_eq(current, &flight))
        {
            flights.remove(&key);
        }
        result
    }
    pub async fn light_modes(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_modes::LightModeReport> {
        let (cloud, device, epoch) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            let device = inner
                .devices
                .iter()
                .find(|device| device.did == did)
                .cloned()
                .ok_or_else(|| AppError::invalid("设备不属于当前家庭。"))?;
            crate::light_modes::validate_device(&device)?;
            let cloud = inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone();
            inner.check_light_modes_context(&home_id, generation, inner.epoch, &cloud, &device)?;
            (cloud, device, inner.epoch)
        };
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            crate::light_modes::load(&cloud, &device),
        )
        .await
        .unwrap_or_else(|_| Err(AppError::new("network", "读取灯光模式超时，请重试。", true)));
        // Check all results, including errors, before forwarding account-bound
        // data. The Cloud instance/epoch guards cover logout and relogin even
        // if a caller still presents the same household and generation.
        self.inner
            .lock()
            .await
            .check_light_modes_context(&home_id, generation, epoch, &cloud, &device)?;
        let result = self.handle(&cloud, result).await;
        if result
            .as_ref()
            .is_err_and(|error| error.kind == "authExpired")
        {
            return result;
        }
        self.inner
            .lock()
            .await
            .check_light_modes_context(&home_id, generation, epoch, &cloud, &device)?;
        result
    }
    async fn light_settings_context(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<LightSettingsContext> {
        let (cloud, device, epoch) = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            let device = inner
                .devices
                .iter()
                .find(|device| device.did == did)
                .cloned()
                .ok_or_else(|| AppError::invalid("设备不属于当前家庭。"))?;
            crate::light_modes::validate_device(&device)?;
            (
                inner.cloud.as_ref().ok_or_else(AppError::auth)?.clone(),
                device,
                inner.epoch,
            )
        };
        let panel = self.specs.panel(&device).await?;
        let context = LightSettingsContext {
            cloud,
            device,
            panel,
            home_id,
            generation,
            epoch,
        };
        self.ensure_light_settings_context(&context, false).await?;
        Ok(context)
    }
    async fn ensure_light_settings_context(
        &self,
        context: &LightSettingsContext,
        writing: bool,
    ) -> Result<()> {
        self.inner
            .lock()
            .await
            .check_light_settings_context(context, writing)
    }
    async fn finish_light_settings<T>(
        &self,
        context: &LightSettingsContext,
        result: Result<T>,
    ) -> Result<T> {
        self.ensure_light_settings_context(context, false).await?;
        let result = self.handle(&context.cloud, result).await;
        if result
            .as_ref()
            .is_err_and(|error| error.kind == "authExpired")
        {
            return result;
        }
        self.ensure_light_settings_context(context, false).await?;
        result
    }
    pub async fn light_settings(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_settings::LightSettingsReport> {
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        let result =
            crate::light_settings::load(&context.cloud, &context.device, &context.panel).await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn change_light_settings(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_settings::LightSettingsChange,
    ) -> Result<crate::light_settings::LightSettingsResult> {
        crate::light_settings::validate(&change)?;
        let _guard = self
            .light_settings_write
            .try_lock()
            .map_err(|_| AppError::new("busy", "正在保存另一项灯光模式，请稍后重试。", true))?;
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        self.ensure_light_settings_context(&context, true).await?;
        let result = crate::light_settings::change(
            &context.cloud,
            &context.device,
            &context.panel,
            &change,
            |writing| self.ensure_light_settings_context(&context, writing),
        )
        .await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn confirm_light_settings(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_settings::LightSettingsChange,
    ) -> Result<crate::light_settings::LightSettingsResult> {
        crate::light_settings::validate_confirmation(&change)?;
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        let result = crate::light_settings::confirm(
            &context.cloud,
            &context.device,
            &context.panel,
            &change,
            |writing| self.ensure_light_settings_context(&context, writing),
        )
        .await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn light_favorites(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::light_favorites::LightFavoritesReport> {
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        let result = crate::light_favorites::load(&context.cloud, &context.device).await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn change_light_favorite(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_favorites::LightFavoriteChange,
    ) -> Result<crate::light_favorites::LightFavoriteResult> {
        crate::light_favorites::validate(&change)?;
        let _guard = self
            .light_favorites_write
            .try_lock()
            .map_err(|_| AppError::new("busy", "正在保存另一项收藏，请稍后重试。", true))?;
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        // Collection storage is cloud state, independent of the light's power
        // or online status. The authenticated endpoint enforces its write role.
        let result =
            crate::light_favorites::change(&context.cloud, &context.device, &change, |_writing| {
                self.ensure_light_settings_context(&context, false)
            })
            .await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn confirm_light_favorite(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::light_favorites::LightFavoriteChange,
    ) -> Result<crate::light_favorites::LightFavoriteResult> {
        crate::light_favorites::validate_confirmation(&change)?;
        let context = self
            .light_settings_context(home_id, generation, did)
            .await?;
        let result =
            crate::light_favorites::confirm(&context.cloud, &context.device, &change, |_writing| {
                self.ensure_light_settings_context(&context, false)
            })
            .await;
        self.finish_light_settings(&context, result).await
    }
    pub async fn device_ui_resources(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::ui_resources::DeviceUiResources> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        let instance = if let Some(typ) = schema
            .spec_type
            .as_deref()
            .filter(|typ| typ.starts_with("urn:miot-spec-v2:device:"))
        {
            (*self.specs.instance(typ).await?).clone()
        } else {
            Value::Null
        };
        let resources = self
            .ui_resources
            .load(cloud.clone(), &device, &schema, instance)
            .await;
        let resources = self.handle(&cloud, resources).await?;
        // Resources contain no state. Even a valid cached model must never
        // reopen an old account/home/device after its independent read finished.
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &schema)?;
        Ok(resources)
    }
    pub async fn device_preview(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<PanelPreview> {
        let (_, device) = self.device(&home_id, generation, &did).await?;
        {
            let inner = self.inner.lock().await;
            if let Some(panel) = inner
                .panels
                .get(&did)
                .filter(|panel| panel_context_matches(&device, panel))
            {
                if let Some(at) = inner
                    .panel_updated_at
                    .get(&did)
                    .filter(|at| epoch_secs().saturating_sub(**at) <= 300)
                {
                    return Ok(PanelPreview {
                        panel: panel.clone(),
                        cached_at: Some(*at),
                        has_cached_state: true,
                    });
                }
            }
        }
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        Ok(PanelPreview {
            panel,
            cached_at: None,
            has_cached_state: false,
        })
    }
    pub async fn dispenser_selfcheck_records(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_selfcheck_history::Records> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .map(|h| h.owner_id.clone())
                .ok_or_else(AppError::stale)?
        };
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::dispenser_selfcheck_history::read(&cloud, &device, &owner, &panel).await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn device_events(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        date: String,
        cursor: Option<String>,
    ) -> Result<crate::device_events::Page> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .map(|h| h.owner_id.clone())
                .ok_or_else(AppError::stale)?
        };
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::device_events::read(&cloud, &device, &owner, &panel, &date, cursor.as_deref())
                .await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn dispenser_records(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        before: Option<u64>,
    ) -> Result<crate::dispenser_history::Records> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .map(|h| h.owner_id.clone())
                .ok_or_else(AppError::stale)?
        };
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::dispenser_history::load_records(&cloud, &device, &owner, &panel, before).await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn dispenser_statistics(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        selection: crate::dispenser_history::Selection,
    ) -> Result<crate::dispenser_history::Statistics> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::dispenser_history::load_statistics(&cloud, &device, &panel, selection).await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn purifier_records(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        query: crate::purifier_history::RecordQuery,
    ) -> Result<crate::purifier_history::RecordPage> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check(&home_id, generation)?;
            inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .map(|h| h.owner_id.clone())
                .ok_or_else(AppError::stale)?
        };
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::purifier_history::load_records(&cloud, &device, &owner, &panel, query).await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn purifier_statistics(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        selection: crate::purifier_history::Selection,
    ) -> Result<crate::purifier_history::Statistics> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result =
            crate::purifier_history::load_statistics(&cloud, &device, &panel, selection).await;
        let result = self.handle(&cloud, result).await;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        result
    }
    pub async fn sensor_history(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<SensorHistory> {
        self.load_history(home_id, generation, did, None).await
    }
    pub async fn history_detail(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        selection: HistorySelection,
    ) -> Result<SensorHistory> {
        // Validate calendar bounds before fetching specs or history.
        crate::history_range::for_selection(&selection)?;
        self.load_history(home_id, generation, did, Some(selection))
            .await
    }
    async fn load_history(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        selection: Option<HistorySelection>,
    ) -> Result<SensorHistory> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = self
            .inner
            .lock()
            .await
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .map(|h| h.owner_id.clone())
            .ok_or_else(AppError::stale)?;
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let load = async {
            match selection {
                Some(selection) => {
                    crate::history::load_detail(&cloud, &device, &owner, &panel, selection).await
                }
                None => crate::history::load(&cloud, &device, &owner, &panel).await,
            }
        };
        let result = tokio::time::timeout(Duration::from_secs(25), load)
            .await
            .map_err(|_| AppError::new("network", "读取历史记录超时，请重试。", true))?;
        let history = self.handle(&cloud, result).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        Ok(history)
    }
    pub async fn outlet_energy(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        selection: EnergySelection,
    ) -> Result<EnergyReport> {
        crate::energy::validate(&selection)?;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let owner = self
            .inner
            .lock()
            .await
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .map(|h| h.owner_id.clone())
            .ok_or_else(AppError::stale)?;
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            crate::energy::load(&cloud, &device, &owner, &panel, selection),
        )
        .await
        .map_err(|_| AppError::new("network", "读取用电统计超时，请重试。", true))?;
        let report = self.handle(&cloud, result).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        Ok(report)
    }
    pub async fn reset_fridge(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        expected: crate::fridge::Snapshot,
    ) -> Result<ControlResult> {
        let _guard = self.fridge_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::fridge::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此冰箱型号的恢复设置动作尚未确认。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let action = crate::fridge::reset_action(&panel, &expected)?;
        let (siid, aiid) = (action.siid, action.aiid);
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            for (siid, piid) in crate::fridge::version_keys(&schema) {
                inner
                    .property_versions
                    .insert(property_version_key(&did, siid, piid), revision);
            }
        }
        let uncertain = match self
            .handle(
                &cloud,
                cloud
                    .action(schema.control_did(), siid, aiid, Vec::new())
                    .await,
            )
            .await
        {
            Ok(_) => false,
            Err(e) if write_error_is_uncertain(&e) => true,
            Err(e) => return Err(e),
        };
        let mut read_back = false;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => {
                    panel = p;
                    read_back = crate::fridge::snapshot(&panel).is_some();
                }
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => {}
            }
        }
        // The observed action has no outputs or independent completion marker.
        // Current settings are evidence of readback, not proof that reset ran.
        Ok(ControlResult {
            verified: false,
            message: if read_back {
                if uncertain {
                    "恢复命令响应不明确；当前设置已回读，请核实设备实际反馈，勿重复发送。"
                } else {
                    "恢复命令已提交，当前设置已回读；此动作无独立完成标识，请核实设备实际反馈。"
                }
            } else {
                "恢复结果尚未确认且当前设置读取失败，请重新读取，勿重复发送。"
            }
            .into(),
            panel,
        })
    }
    pub async fn change_dispenser(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_config::Change,
    ) -> Result<ControlResult> {
        let _guard = self.dispenser_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此管线机型号的设置尚未核实。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let plan = crate::dispenser_config::plan(&panel, &change)?;
        if plan.no_op {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &panel)?;
            protect_runtime_panel(&mut inner, &panel);
            return Ok(ControlResult {
                verified: true,
                message: "当前设备设置与目标一致。".into(),
                panel,
            });
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let version = inner.state_revision;
            for p in schema
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .filter(|p| p.access.iter().any(|a| a == "read"))
            {
                inner
                    .property_versions
                    .insert(property_version_key(&did, p.siid, p.piid), version);
            }
        }
        match self
            .handle(
                &cloud,
                cloud
                    .write_panel_property(&schema, plan.siid, plan.piid, plan.value)
                    .await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::dispenser_config::target_matches(&panel, &change) {
                let mut inner = self.inner.lock().await;
                inner.check_control(&home_id, generation, &panel)?;
                protect_runtime_panel(&mut inner, &panel);
                return Ok(ControlResult {
                    verified: true,
                    message: "设备已实时回读目标设置，请同时核实设备实际反馈。".into(),
                    panel,
                });
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_control(&home_id, generation, &panel)?;
        protect_runtime_panel(&mut inner, &panel);
        Ok(ControlResult {
            verified: false,
            message: "管线机设置结果待确认，请重新读取；未重复发送。".into(),
            panel,
        })
    }
    async fn load_dispenser_reminders(
        &self,
        cloud: &Arc<Cloud>,
        home: &str,
        generation: u64,
        device: &Device,
        schema: &DevicePanel,
    ) -> Result<crate::dispenser_reminders::Loaded> {
        let (panel, push, scenes) = tokio::join!(
            self.read_panel(cloud, home, generation, schema.clone(), false),
            cloud.dispenser_push_setting(device),
            cloud.dispenser_dnd_scenes(device)
        );
        let panel = match panel {
            Ok(p) => p,
            Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => return Err(e),
            Err(_) => schema.clone(),
        };
        let push = match self.handle(cloud, push).await {
            Ok(p) => Some(p),
            Err(e) if e.kind == "authExpired" => return Err(e),
            Err(_) => None,
        };
        let scenes = match self.handle(cloud, scenes).await {
            Ok(p) => Some(p),
            Err(e) if e.kind == "authExpired" => return Err(e),
            Err(_) => None,
        };
        let inner = self.inner.lock().await;
        inner.check_panel(home, generation, &panel)?;
        let owner = inner
            .homes
            .iter()
            .any(|h| h.id == home && !h.shared && h.owner_id == cloud.credentials.user_id);
        let report = crate::dispenser_reminders::project(
            device,
            &panel,
            push.as_ref(),
            scenes.as_ref(),
            owner,
        )?;
        Ok(crate::dispenser_reminders::Loaded {
            panel,
            push,
            scenes,
            report,
        })
    }
    pub async fn dispenser_reminders(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_reminders::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        Ok(self
            .load_dispenser_reminders(&cloud, &home_id, generation, &device, &schema)
            .await?
            .report)
    }
    async fn commit_dispenser_reminder_scene(
        &self,
        cloud: &Arc<Cloud>,
        home: &str,
        generation: u64,
        device: &Device,
        panel: &DevicePanel,
        mutation: (&Value, bool),
    ) -> Result<bool> {
        let (body, delete) = mutation;
        self.inner
            .lock()
            .await
            .check_control(home, generation, panel)?;
        match self
            .handle(
                cloud,
                cloud.change_timer_scene(device, delete, body.clone()).await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            self.inner
                .lock()
                .await
                .check_control(home, generation, panel)?;
            match self
                .handle(cloud, cloud.dispenser_dnd_scenes(device).await)
                .await
            {
                Ok(raw) if crate::dispenser_reminders::confirmed(device, &raw, body, delete) => {
                    return Ok(true)
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                _ => {}
            }
        }
        Ok(false)
    }
    async fn stop_dispenser_reminder(
        &self,
        cloud: &Arc<Cloud>,
        home: &str,
        generation: u64,
        schema: &DevicePanel,
        target: (f64, u32),
        strict: bool,
    ) -> Result<bool> {
        let (interval, union) = target;
        let mut panel = self
            .read_panel(cloud, home, generation, schema.clone(), false)
            .await?;
        let Some((hours, enabled, current)) = crate::dispenser_reminders::active_values(&panel)
        else {
            return Ok(false);
        };
        if current != union {
            return Ok(!strict);
        }
        if !enabled {
            return Ok(true);
        }
        if (hours - interval).abs() > 0.001 {
            return Ok(false);
        }
        self.inner
            .lock()
            .await
            .check_control(home, generation, &panel)?;
        {
            let mut inner = self.inner.lock().await;
            inner.state_revision += 1;
            let version = inner.state_revision;
            for p in schema
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .filter(|p| p.access.iter().any(|a| a == "read"))
            {
                inner
                    .property_versions
                    .insert(property_version_key(&schema.did, p.siid, p.piid), version);
            }
        }
        let inputs = vec![
            crate::dispenser_reminders::interval_value(interval),
            serde_json::json!(false),
            serde_json::json!(union),
        ];
        match self
            .handle(cloud, cloud.panel_action(schema, 2, 4, inputs).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(cloud, home, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::dispenser_reminders::cleanup_target(&panel, interval, union) {
                let mut inner = self.inner.lock().await;
                inner.check_control(home, generation, &panel)?;
                protect_runtime_panel(&mut inner, &panel);
                return Ok(true);
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_control(home, generation, &panel)?;
        protect_runtime_panel(&mut inner, &panel);
        Ok(false)
    }
    pub async fn change_dispenser_reminder(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_reminders::Change,
    ) -> Result<crate::dispenser_reminders::ChangeResult> {
        use crate::dispenser_reminders::{self as reminders, ChangeResult, Plan};
        let _guard = self.dispenser_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        let loaded = self
            .load_dispenser_reminders(&cloud, &home_id, generation, &device, &schema)
            .await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check_panel(&home_id, generation, &schema)?;
            inner
                .homes
                .iter()
                .any(|h| h.id == home_id && !h.shared && h.owner_id == cloud.credentials.user_id)
        };
        let plan = reminders::prepare(
            &device,
            &loaded.panel,
            loaded.push.as_ref(),
            loaded.scenes.as_ref(),
            owner,
            &change,
        )?;
        let mut verified = false;
        let mut message = "提醒设置结果待确认，请重新读取；未重复发送。";
        match &plan {
            Plan::Noop => verified = true,
            Plan::Push {
                field,
                enabled,
                no_op,
            } => {
                if *no_op {
                    verified = true
                } else {
                    self.inner
                        .lock()
                        .await
                        .check_panel(&home_id, generation, &schema)?;
                    match self
                        .handle(
                            &cloud,
                            cloud.change_dispenser_push(&device, *field, *enabled).await,
                        )
                        .await
                    {
                        Ok(_) => {}
                        Err(e) if write_error_is_uncertain(&e) => {}
                        Err(e) => return Err(e),
                    }
                    for delay in [350, 800, 1500] {
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        self.inner
                            .lock()
                            .await
                            .check_panel(&home_id, generation, &schema)?;
                        match self
                            .handle(&cloud, cloud.dispenser_push_setting(&device).await)
                            .await
                        {
                            Ok(raw)
                                if raw["settings"][field.key()]
                                    == serde_json::json!(if *enabled { "1" } else { "0" }) =>
                            {
                                verified = true;
                                break;
                            }
                            Err(e) if e.kind == "authExpired" => return Err(e),
                            _ => {}
                        }
                    }
                }
            }
            Plan::Cycle { value, no_op } => {
                if *no_op {
                    verified = true
                } else {
                    self.inner
                        .lock()
                        .await
                        .check_control(&home_id, generation, &schema)?;
                    {
                        let mut inner = self.inner.lock().await;
                        inner.state_revision += 1;
                        let version = inner.state_revision;
                        inner
                            .property_versions
                            .insert(property_version_key(&did, 2, 9), version);
                    }
                    match self
                        .handle(
                            &cloud,
                            cloud
                                .write_panel_property(&schema, 2, 9, serde_json::json!(value))
                                .await,
                        )
                        .await
                    {
                        Ok(_) => {}
                        Err(e) if write_error_is_uncertain(&e) => {}
                        Err(e) => return Err(e),
                    }
                    for delay in [350, 800, 1500] {
                        tokio::time::sleep(Duration::from_millis(delay)).await;
                        match self
                            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                            .await
                        {
                            Ok(p) if reminders::cycle(&p) == Some(*value) => {
                                let mut inner = self.inner.lock().await;
                                inner.check_control(&home_id, generation, &p)?;
                                protect_runtime_panel(&mut inner, &p);
                                verified = true;
                                break;
                            }
                            Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                                return Err(e)
                            }
                            _ => {}
                        }
                    }
                }
            }
            Plan::StopActive { interval, union } => {
                verified = self
                    .stop_dispenser_reminder(
                        &cloud,
                        &home_id,
                        generation,
                        &schema,
                        (*interval, *union),
                        true,
                    )
                    .await?;
            }
            Plan::Schedule {
                body,
                delete,
                pause,
                cleanup,
                baseline,
            } => {
                let raw = self
                    .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
                    .await?;
                if !reminders::unchanged(&device, &raw, baseline, None) {
                    return Err(AppError::new(
                        "reminderConflict",
                        "云提醒已被其他应用改变，未覆盖新的设置，请重新读取。",
                        true,
                    ));
                }
                let paused = if let Some(pause) = pause {
                    self.commit_dispenser_reminder_scene(
                        &cloud,
                        &home_id,
                        generation,
                        &device,
                        &schema,
                        (pause, false),
                    )
                    .await?
                } else {
                    true
                };
                if !paused {
                    message = "旧提醒的暂停状态未确认，未继续修改，请重新读取。"
                } else {
                    let stopped = if let Some((interval, union)) = cleanup {
                        self.stop_dispenser_reminder(
                            &cloud,
                            &home_id,
                            generation,
                            &schema,
                            (*interval, *union),
                            false,
                        )
                        .await?
                    } else {
                        true
                    };
                    if !stopped {
                        message = "旧云提醒已暂停，但设备提醒尚未确认停止，请重新读取。"
                    } else {
                        let raw = self
                            .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
                            .await?;
                        if reminders::unchanged(&device, &raw, baseline, pause.as_ref()) {
                            verified = self
                                .commit_dispenser_reminder_scene(
                                    &cloud,
                                    &home_id,
                                    generation,
                                    &device,
                                    &schema,
                                    (body, *delete),
                                )
                                .await?
                        } else {
                            message = "云提醒已被其他应用改变，未覆盖新的设置，请重新读取。"
                        }
                    }
                }
            }
        }
        let final_read = self
            .load_dispenser_reminders(&cloud, &home_id, generation, &device, &schema)
            .await?;
        if verified {
            verified = match &plan {
                Plan::Noop => {
                    matches!(&change, reminders::Change::Toggle { key, enabled, .. } if final_read.report.reminders.iter().any(|r| &r.key == key && &r.enabled == enabled))
                }
                Plan::Push { field, enabled, .. } => {
                    let s = match field {
                        reminders::PushField::CleanFinish => &final_read.report.clean_finish,
                        reminders::PushField::LackWater => &final_read.report.lack_water,
                    };
                    s.source == "cloud" && s.value == Some(*enabled)
                }
                Plan::Cycle { value, .. } => final_read.report.cycle == Some(*value),
                Plan::Schedule { body, delete, .. } => final_read
                    .scenes
                    .as_ref()
                    .is_some_and(|s| reminders::confirmed(&device, s, body, *delete)),
                Plan::StopActive { interval, union } => {
                    reminders::cleanup_target(&final_read.panel, *interval, *union)
                }
            }
        }
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &schema)?;
        Ok(ChangeResult {
            verified,
            message: if verified {
                "提醒设置已回读确认；到点执行与手机通知仍需实际反馈验证。"
            } else {
                message
            }
            .into(),
            report: Some(final_read.report),
        })
    }
    pub async fn dispenser_selfcheck(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_selfcheck::Change,
        confirm_only: bool,
    ) -> Result<ControlResult> {
        use crate::dispenser_selfcheck as check;
        let _guard = self.dispenser_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的自检动作尚未核实。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let key = format!(
            "{}\n{}\n{}\n{}",
            cloud.credentials.user_id, cloud.credentials.region, home_id, did
        );
        let existing = self
            .dispenser_selfcheck_pending
            .lock()
            .await
            .get(&key)
            .cloned();
        if let Some(pending) = existing {
            if pending != change {
                return Err(AppError::new("busy", "另一项自检操作尚未确认。", false));
            }
            if check::target_matches(&panel, pending.operation) {
                self.dispenser_selfcheck_pending.lock().await.remove(&key);
                self.dispenser_selfcheck_completed
                    .lock()
                    .await
                    .insert(key.clone(), pending);
                return Ok(ControlResult {
                    verified: true,
                    message: "自检阶段已回读，请结合设备实际反馈确认。".into(),
                    panel,
                });
            }
            return Ok(ControlResult {
                verified: false,
                message: "上次自检操作尚未回读确认，正在查询，不会重复发送。".into(),
                panel,
            });
        }
        if confirm_only {
            let completed = self
                .dispenser_selfcheck_completed
                .lock()
                .await
                .get(&key)
                .cloned();
            if completed.as_ref() == Some(&change) {
                let verified = check::target_matches(&panel, change.operation);
                return Ok(ControlResult {
                    verified,
                    message: if verified {
                        "自检阶段已回读，请结合设备实际反馈确认。"
                    } else {
                        "设备状态已变化，无法再次确认原阶段。"
                    }
                    .into(),
                    panel,
                });
            }
            return Err(AppError::invalid("没有待确认的自检操作。"));
        }
        let (aiid, inputs) = check::action(&panel, &change)?;
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let version = inner.state_revision;
            for p in schema
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .filter(|p| p.access.iter().any(|a| a == "read"))
            {
                inner
                    .property_versions
                    .insert(property_version_key(&did, p.siid, p.piid), version);
            }
        }
        self.dispenser_selfcheck_completed.lock().await.remove(&key);
        self.dispenser_selfcheck_pending
            .lock()
            .await
            .insert(key.clone(), change.clone());
        match self
            .handle(&cloud, cloud.panel_action(&schema, 7, aiid, inputs).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.dispenser_selfcheck_pending.lock().await.remove(&key);
                self.dispenser_selfcheck_completed
                    .lock()
                    .await
                    .insert(key.clone(), change.clone());
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if check::target_matches(&panel, change.operation) {
                let mut inner = self.inner.lock().await;
                inner.check_control(&home_id, generation, &panel)?;
                protect_runtime_panel(&mut inner, &panel);
                drop(inner);
                self.dispenser_selfcheck_pending.lock().await.remove(&key);
                return Ok(ControlResult {
                    verified: true,
                    message: "自检阶段已回读，请结合设备实际反馈确认。".into(),
                    panel,
                });
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_control(&home_id, generation, &panel)?;
        protect_runtime_panel(&mut inner, &panel);
        Ok(ControlResult {
            verified: false,
            message: "自检操作尚未回读确认，只会继续查询，不会重复发送。".into(),
            panel,
        })
    }
    pub async fn dispenser_sterilization(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_sterilization::Change,
    ) -> Result<ControlResult> {
        let _guard = self.dispenser_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此型号的杀菌动作尚未核实。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let aiid = crate::dispenser_sterilization::action(&panel, &change)?;
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let version = inner.state_revision;
            for p in schema
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .filter(|p| p.access.iter().any(|a| a == "read"))
            {
                inner
                    .property_versions
                    .insert(property_version_key(&did, p.siid, p.piid), version);
            }
        }
        // Vendor start/stop have no inputs. Send once, including when an
        // acknowledgement is lost; only direct status reads establish outcome.
        match self
            .handle(&cloud, cloud.panel_action(&schema, 2, aiid, vec![]).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::dispenser_sterilization::target_matches(&panel, change.operation) {
                let mut inner = self.inner.lock().await;
                inner.check_control(&home_id, generation, &panel)?;
                protect_runtime_panel(&mut inner, &panel);
                return Ok(ControlResult {
                    verified: true,
                    message: "设备状态已实时回读，请以设备提示和实际反馈为准。".into(),
                    panel,
                });
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_control(&home_id, generation, &panel)?;
        protect_runtime_panel(&mut inner, &panel);
        Ok(ControlResult {
            verified: false,
            message: "杀菌动作结果待确认，请重新读取；未重复发送。".into(),
            panel,
        })
    }
    pub async fn change_fridge(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::fridge::Change,
    ) -> Result<ControlResult> {
        let _guard = self.fridge_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::fridge::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此冰箱型号的控制绑定尚未确认。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let property = crate::fridge::validate(&panel, &change)?;
        let (siid, piid) = (property.siid, property.piid);
        if crate::fridge::target_matches(&panel, &change) {
            return Ok(ControlResult {
                verified: true,
                message: "当前设备设置与目标一致。".into(),
                panel,
            });
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            for (siid, piid) in crate::fridge::version_keys(&schema) {
                inner
                    .property_versions
                    .insert(property_version_key(&did, siid, piid), revision);
            }
        }
        match self
            .handle(
                &cloud,
                cloud
                    .write(
                        schema.control_did(),
                        siid,
                        piid,
                        crate::fridge::value(&change),
                    )
                    .await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::fridge::target_matches(&panel, &change) {
                return Ok(ControlResult {
                    verified: true,
                    message: "目标设置已由设备实时回读确认，请同时核实设备实际反馈。".into(),
                    panel,
                });
            }
        }
        Ok(ControlResult {
            verified: false,
            message: "冰箱设置结果尚未确认，请重新读取；未重复发送。".into(),
            panel,
        })
    }
    pub async fn airer_lift(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::airer::LiftChange,
    ) -> Result<ControlResult> {
        let _guard = self.airer_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::airer::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此晾衣机型号的升降尚未确认。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let plan = crate::airer::lift(&panel, &change)?;
        if plan.no_op {
            let verified = crate::airer::lift_confirmed(&panel, change.intent);
            return Ok(ControlResult {
                verified,
                message: if verified {
                    plan.message.into()
                } else {
                    "当前位置与升降状态不一致，请重新读取。".into()
                },
                panel,
            });
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            for (siid, piid) in [(2, 4), (4, 11), (4, 12)] {
                inner
                    .property_versions
                    .insert(property_version_key(&did, siid, piid), revision);
            }
        }
        match self
            .handle(
                &cloud,
                cloud.write(schema.control_did(), 2, 2, plan.value).await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        for delay in [350, 800, 1500, 2500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::airer::lift_confirmed(&panel, change.intent) {
                return Ok(ControlResult {
                    verified: true,
                    message: "升降状态已由设备实时回读确认。".into(),
                    panel,
                });
            }
        }
        Ok(ControlResult {
            verified: false,
            message: "升降结果尚未确认，请重新读取；未重复发送。".into(),
            panel,
        })
    }
    pub async fn save_airer_night(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::airer::NightChange,
    ) -> Result<ControlResult> {
        let _guard = self.airer_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::airer::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此晾衣机型号的夜灯设置尚未确认。"));
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let params = crate::airer::night_params(&panel, &change)?;
        if crate::airer::night(&panel).as_ref() == Some(&change.target) {
            return Ok(ControlResult {
                verified: true,
                message: "当前夜灯设置与目标一致。".into(),
                panel,
            });
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            for piid in 1..=6 {
                inner
                    .property_versions
                    .insert(property_version_key(&did, 4, piid), revision);
            }
        }
        let sent = self
            .handle(&cloud, cloud.write_airer_night(&device, params).await)
            .await;
        if let Err(e) = sent {
            if !write_error_is_uncertain(&e) && e.kind != "partialWrite" {
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await
            {
                Ok(p) => panel = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if crate::airer::night(&panel).as_ref() == Some(&change.target) {
                return Ok(ControlResult {
                    verified: true,
                    message: "六项夜灯设置均已由设备回读确认。".into(),
                    panel,
                });
            }
        }
        Ok(ControlResult {
            verified: false,
            message: "夜灯设置尚未全部确认，请重新读取；未重复发送。".into(),
            panel,
        })
    }
    pub async fn purifier_options(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::purifier_options::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        if crate::purifier_options::binding(&schema).is_none() {
            return Err(AppError::new(
                "unsupported",
                "此设备的冲洗设置绑定未确认。",
                false,
            ));
        }
        let panel = self
            .read_panel(&cloud, &home_id, generation, schema, false)
            .await?;
        let raw = if crate::purifier_options::flushing_supported(&device) == Some(true) {
            match self
                .handle(&cloud, cloud.purifier_push_setting(&device).await)
                .await
            {
                Ok(value) => Some(value),
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => None,
            }
        } else {
            None
        };
        let inner = self.inner.lock().await;
        inner.check_panel(&home_id, generation, &panel)?;
        let owner = inner
            .homes
            .iter()
            .any(|h| h.id == home_id && !h.shared && h.owner_id == cloud.credentials.user_id);
        crate::purifier_options::project(&device, &panel, raw.as_ref(), owner)
    }
    pub async fn change_purifier_push(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::purifier_options::Change,
    ) -> Result<crate::purifier_options::ChangeResult> {
        let _guard = self.purifier_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let report = self
            .purifier_options(home_id.clone(), generation, did.clone())
            .await?;
        crate::purifier_options::validate_push(&report, &change)?;
        if report.push_enabled == Some(change.enabled) {
            return Ok(crate::purifier_options::ChangeResult {
                verified: report.push_source == "cloud",
                message: "当前显示与目标一致，本次没有发送修改；默认显示不代表云端已保存。".into(),
                report: Some(report),
            });
        }
        let schema = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        match self
            .handle(
                &cloud,
                cloud.change_purifier_push(&device, change.enabled).await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        let mut latest = None;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .purifier_options(home_id.clone(), generation, did.clone())
                .await
            {
                Ok(r) => {
                    let verified =
                        r.push_source == "cloud" && r.push_enabled == Some(change.enabled);
                    latest = Some(r);
                    if verified {
                        return Ok(crate::purifier_options::ChangeResult {
                            verified: true,
                            message: "冲洗提醒已由云设置回读确认；推送实际送达仍需设备冲洗后观察。"
                                .into(),
                            report: latest,
                        });
                    }
                }
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => {}
            }
        }
        Ok(crate::purifier_options::ChangeResult {
            verified: false,
            message: "冲洗提醒尚未回读确认，请重新读取；未重复发送。".into(),
            report: latest,
        })
    }
    pub async fn dispenser_dnd(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::dispenser_dnd::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        if crate::dispenser_dnd::binding(&device, &schema).is_none() {
            return Err(AppError::new(
                "unsupported",
                "此型号的勿扰模式尚未接入。",
                false,
            ));
        }
        let panel = self
            .read_panel(&cloud, &home_id, generation, schema, false)
            .await?;
        let scenes = self
            .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
            .await?;
        let inner = self.inner.lock().await;
        inner.check_panel(&home_id, generation, &panel)?;
        let owner = inner
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .is_some_and(|h| h.owner_id == cloud.credentials.user_id && !h.shared);
        crate::dispenser_dnd::project(&device, &panel, &scenes, owner)
    }
    pub async fn change_dispenser_dnd(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::dispenser_dnd::Change,
    ) -> Result<crate::dispenser_dnd::ChangeResult> {
        let _guard = self.dispenser_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let mut scenes = self
            .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
            .await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner
                .homes
                .iter()
                .any(|h| h.id == home_id && !h.shared && h.owner_id == cloud.credentials.user_id)
        };
        let prepared = crate::dispenser_dnd::prepare(&device, &panel, &scenes, owner, &change)?;
        // gxj appointment10853 saves the cloud schedule before changing 5/1. Never
        // replay a create/write on timeout, nor proceed on an unconfirmed timer.
        if let Some(body) = prepared
            .body
            .as_ref()
            .filter(|_| !crate::dispenser_dnd::confirmed(&device, &scenes, &prepared))
        {
            self.inner
                .lock()
                .await
                .check_control(&home_id, generation, &schema)?;
            match self
                .handle(
                    &cloud,
                    cloud.change_timer_scene(&device, false, body.clone()).await,
                )
                .await
            {
                Ok(_) => {}
                Err(e) if write_error_is_uncertain(&e) => {}
                Err(e) => return Err(e),
            }
            for delay in [350, 800, 1500] {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                self.inner
                    .lock()
                    .await
                    .check_control(&home_id, generation, &schema)?;
                match self
                    .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
                    .await
                {
                    Ok(value) => scenes = value,
                    Err(e) if e.kind == "authExpired" => return Err(e),
                    Err(_) => continue,
                }
                if crate::dispenser_dnd::confirmed(&device, &scenes, &prepared) {
                    break;
                }
            }
        }
        let result = |verified, message: &str, panel: &DevicePanel, scenes: &Value| {
            crate::dispenser_dnd::ChangeResult {
                verified,
                message: message.into(),
                report: crate::dispenser_dnd::project(&device, panel, scenes, owner).ok(),
            }
        };
        if !crate::dispenser_dnd::confirmed(&device, &scenes, &prepared) {
            self.inner
                .lock()
                .await
                .check_control(&home_id, generation, &schema)?;
            return Ok(result(
                false,
                "云端定时尚未确认；未修改设备勿扰属性，请重新读取，勿重复提交。",
                &panel,
                &scenes,
            ));
        }
        // Refresh the actual property after saving the timer, including when
        // the previous value already equalled the target.
        panel = match self
            .read_property_panel(&cloud, &home_id, generation, &schema, 5, 1)
            .await
        {
            Ok(p) => p,
            Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => return Err(e),
            Err(_) => {
                self.inner
                    .lock()
                    .await
                    .check_control(&home_id, generation, &schema)?;
                return Ok(result(
                    false,
                    "云端定时已确认，设备状态未能读取，请重新读取。",
                    &panel,
                    &scenes,
                ));
            }
        };
        let target = serde_json::json!(prepared.device_value);
        if crate::dispenser_dnd::binding(&device, &panel).is_none_or(|p| {
            p.code != Some(0) || p.value.as_ref().and_then(Value::as_bool).is_none()
        }) {
            self.inner
                .lock()
                .await
                .check_control(&home_id, generation, &schema)?;
            return Ok(result(
                false,
                "云端定时已确认，但设备勿扰状态未能直接读取，请重新读取。",
                &panel,
                &scenes,
            ));
        }
        if !property_matches(&panel, 5, 1, &target) {
            {
                let mut inner = self.inner.lock().await;
                inner.check_control(&home_id, generation, &schema)?;
                inner.state_revision += 1;
                let revision = inner.state_revision;
                inner
                    .property_versions
                    .insert(property_version_key(&did, 5, 1), revision);
            }
            match self
                .handle(
                    &cloud,
                    cloud
                        .write_panel_property(&schema, 5, 1, target.clone())
                        .await,
                )
                .await
            {
                Ok(_) => {}
                Err(e) if write_error_is_uncertain(&e) => {}
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {
                    self.inner
                        .lock()
                        .await
                        .check_control(&home_id, generation, &schema)?;
                    return Ok(result(
                        false,
                        "定时已保存，但设备未接受勿扰属性，请重新读取。",
                        &panel,
                        &scenes,
                    ));
                }
            }
            for delay in [350, 800, 1500] {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                match self
                    .read_property_panel(&cloud, &home_id, generation, &schema, 5, 1)
                    .await
                {
                    Ok(p) => panel = p,
                    Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                        return Err(e)
                    }
                    Err(_) => continue,
                }
                if property_matches(&panel, 5, 1, &target) {
                    break;
                }
            }
        }
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        // A second timer read prevents reporting success if another client
        // changed the schedule during the property write.
        scenes = match self
            .handle(&cloud, cloud.dispenser_dnd_scenes(&device).await)
            .await
        {
            Ok(v) => v,
            Err(e) if e.kind == "authExpired" => return Err(e),
            Err(_) => {
                self.inner
                    .lock()
                    .await
                    .check_control(&home_id, generation, &schema)?;
                return Ok(result(
                    false,
                    "设备状态已回读，定时最终状态未确认，请重新读取。",
                    &panel,
                    &scenes,
                ));
            }
        };
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let verified = property_matches(&panel, 5, 1, &target)
            && crate::dispenser_dnd::confirmed(&device, &scenes, &prepared);
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &panel)?;
            protect_runtime_panel(&mut inner, &panel);
        }
        Ok(result(
            verified,
            if verified {
                "云端定时与设备勿扰属性均已回读确认；定时执行仍需观察设备。"
            } else {
                "部分设置尚未确认，请重新读取；未重复发送。"
            },
            &panel,
            &scenes,
        ))
    }
    pub async fn purifier_dnd(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::purifier_dnd::Report> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        if crate::purifier_dnd::binding(&device, &schema).is_none() {
            return Err(AppError::new(
                "unsupported",
                "此型号的勿扰模式尚未接入。",
                false,
            ));
        }
        let panel = self
            .read_panel(&cloud, &home_id, generation, schema, false)
            .await?;
        let scenes = self
            .handle(&cloud, cloud.purifier_dnd_scenes(&device).await)
            .await?;
        let inner = self.inner.lock().await;
        inner.check_panel(&home_id, generation, &panel)?;
        let owner = inner
            .homes
            .iter()
            .find(|h| h.id == home_id)
            .is_some_and(|h| h.owner_id == cloud.credentials.user_id && !h.shared);
        crate::purifier_dnd::project(&device, &panel, &scenes, owner)
    }
    pub async fn change_purifier_dnd(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: crate::purifier_dnd::Change,
    ) -> Result<crate::purifier_dnd::ChangeResult> {
        let _guard = self.purifier_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let schema = self.specs.panel(&device).await?;
        let mut panel = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let mut scenes = self
            .handle(&cloud, cloud.purifier_dnd_scenes(&device).await)
            .await?;
        let owner = {
            let inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner
                .homes
                .iter()
                .any(|h| h.id == home_id && !h.shared && h.owner_id == cloud.credentials.user_id)
        };
        let prepared = crate::purifier_dnd::prepare(&device, &panel, &scenes, owner, &change)?;
        // Module 11870 saves the cloud schedule before changing 6/1. Never
        // replay a create/write on timeout, nor proceed on an unconfirmed timer.
        if !crate::purifier_dnd::confirmed(&device, &scenes, &prepared) {
            self.inner
                .lock()
                .await
                .check_control(&home_id, generation, &schema)?;
            match self
                .handle(
                    &cloud,
                    cloud
                        .change_timer_scene(&device, false, prepared.body.clone())
                        .await,
                )
                .await
            {
                Ok(_) => {}
                Err(e) if write_error_is_uncertain(&e) => {}
                Err(e) => return Err(e),
            }
            for delay in [350, 800, 1500] {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                self.inner
                    .lock()
                    .await
                    .check_control(&home_id, generation, &schema)?;
                match self
                    .handle(&cloud, cloud.purifier_dnd_scenes(&device).await)
                    .await
                {
                    Ok(value) => scenes = value,
                    Err(e) if e.kind == "authExpired" => return Err(e),
                    Err(_) => continue,
                }
                if crate::purifier_dnd::confirmed(&device, &scenes, &prepared) {
                    break;
                }
            }
        }
        let result = |verified, message: &str, panel: &DevicePanel, scenes: &Value| {
            crate::purifier_dnd::ChangeResult {
                verified,
                message: message.into(),
                report: crate::purifier_dnd::project(&device, panel, scenes, owner).ok(),
            }
        };
        if !crate::purifier_dnd::confirmed(&device, &scenes, &prepared) {
            return Ok(result(
                false,
                "云端定时尚未确认；未修改设备勿扰属性，请重新读取，勿重复提交。",
                &panel,
                &scenes,
            ));
        }
        // Refresh the actual property after saving the timer, including when
        // the previous value already equalled the target.
        panel = match self
            .read_property_panel(&cloud, &home_id, generation, &schema, 6, 1)
            .await
        {
            Ok(p) => p,
            Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => return Err(e),
            Err(_) => {
                return Ok(result(
                    false,
                    "云端定时已确认，设备状态未能读取，请重新读取。",
                    &panel,
                    &scenes,
                ))
            }
        };
        let target = serde_json::json!(prepared.device_value);
        if crate::purifier_dnd::binding(&device, &panel).is_none_or(|p| {
            p.code != Some(0) || p.value.as_ref().and_then(Value::as_bool).is_none()
        }) {
            return Ok(result(
                false,
                "云端定时已确认，但设备勿扰状态未能直接读取，请重新读取。",
                &panel,
                &scenes,
            ));
        }
        if !property_matches(&panel, 6, 1, &target) {
            {
                let mut inner = self.inner.lock().await;
                inner.check_control(&home_id, generation, &schema)?;
                inner.state_revision += 1;
                let revision = inner.state_revision;
                inner
                    .property_versions
                    .insert(property_version_key(&did, 6, 1), revision);
            }
            match self
                .handle(
                    &cloud,
                    cloud
                        .write(schema.control_did(), 6, 1, target.clone())
                        .await,
                )
                .await
            {
                Ok(_) => {}
                Err(e) if write_error_is_uncertain(&e) => {}
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {
                    return Ok(result(
                        false,
                        "定时已保存，但设备未接受勿扰属性，请重新读取。",
                        &panel,
                        &scenes,
                    ))
                }
            }
            for delay in [350, 800, 1500] {
                tokio::time::sleep(Duration::from_millis(delay)).await;
                match self
                    .read_property_panel(&cloud, &home_id, generation, &schema, 6, 1)
                    .await
                {
                    Ok(p) => panel = p,
                    Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                        return Err(e)
                    }
                    Err(_) => continue,
                }
                if property_matches(&panel, 6, 1, &target) {
                    break;
                }
            }
        }
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        // A second timer read prevents reporting success if another client
        // changed the schedule during the property write.
        scenes = match self
            .handle(&cloud, cloud.purifier_dnd_scenes(&device).await)
            .await
        {
            Ok(v) => v,
            Err(e) if e.kind == "authExpired" => return Err(e),
            Err(_) => {
                return Ok(result(
                    false,
                    "设备状态已回读，定时最终状态未确认，请重新读取。",
                    &panel,
                    &scenes,
                ))
            }
        };
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &schema)?;
        let verified = property_matches(&panel, 6, 1, &target)
            && crate::purifier_dnd::confirmed(&device, &scenes, &prepared);
        Ok(result(
            verified,
            if verified {
                "云端定时与设备勿扰属性均已回读确认；定时执行仍需观察设备。"
            } else {
                "部分设置尚未确认，请重新读取；未重复发送。"
            },
            &panel,
            &scenes,
        ))
    }
    pub async fn outlet_timers(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<TimerReport> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result = tokio::time::timeout(
            Duration::from_secs(20),
            crate::timers::load(&cloud, &device, &panel),
        )
        .await
        .map_err(|_| AppError::new("network", "读取定时记录超时，请重试。", true))?;
        let mut report = self.handle(&cloud, result).await?;
        let inner = self.inner.lock().await;
        inner.check_panel(&home_id, generation, &panel)?;
        let owner = inner
            .homes
            .iter()
            .find(|home| home.id == home_id)
            .is_some_and(|home| home.owner_id == cloud.credentials.user_id);
        report.write_reason = crate::timer_write::permission_reason(&device, &panel, owner);
        Ok(report)
    }
    pub async fn change_outlet_timer(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: TimerChange,
    ) -> Result<TimerChangeResult> {
        crate::timer_write::validate(&change)?;
        let _guard = self
            .timer_write
            .try_lock()
            .map_err(|_| AppError::new("busy", "正在处理另一项定时修改，请稍候。", true))?;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        {
            let inner = self.inner.lock().await;
            inner.check_panel(&home_id, generation, &panel)?;
            let owner = inner
                .homes
                .iter()
                .find(|home| home.id == home_id)
                .is_some_and(|home| home.owner_id == cloud.credentials.user_id);
            if let Some(reason) = crate::timer_write::permission_reason(&device, &panel, owner) {
                return Err(AppError::new("permissionDenied", reason, false));
            }
        }
        let scenes = self
            .handle(&cloud, cloud.timer_scenes(&device).await)
            .await?;
        let prepared =
            crate::timer_write::prepare(&device, &panel, &scenes, &change, epoch_secs())?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        // The server can accept a request even if its response is lost. Writes
        // are issued once; only the subsequent readback is retried.
        let result = crate::timer_write::commit(&cloud, &device, &panel, prepared).await;
        let result = self.handle(&cloud, result).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        Ok(result)
    }
    pub async fn change_outlet_countdown(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: CountdownChange,
    ) -> Result<CountdownChangeResult> {
        crate::countdown_write::validate(&change)?;
        let _guard = self
            .timer_write
            .try_lock()
            .map_err(|_| AppError::new("busy", "正在处理另一项定时修改，请稍候。", true))?;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        {
            let inner = self.inner.lock().await;
            inner.check_panel(&home_id, generation, &panel)?;
            let owner = inner
                .homes
                .iter()
                .find(|home| home.id == home_id)
                .is_some_and(|home| home.owner_id == cloud.credentials.user_id);
            if let Some(reason) = crate::timer_write::permission_reason(&device, &panel, owner) {
                return Err(AppError::new("permissionDenied", reason, false));
            }
        }
        let scenes = self
            .handle(&cloud, cloud.timer_scenes(&device).await)
            .await?;
        let prepared =
            crate::countdown_write::prepare(&device, &panel, &scenes, &change, epoch_secs())?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let result = crate::timer_write::commit(&cloud, &device, &panel, prepared).await;
        let result = self.handle(&cloud, result).await?;
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        if !result.verified {
            return Ok(CountdownChangeResult {
                scene_verified: false,
                preferences_verified: None,
                message: result.message,
                report: result.report,
            });
        }
        let mut report = result.report;
        let mut preferences_verified = None;
        if let CountdownChange::Set {
            on, hours, minutes, ..
        } = change
        {
            let preferences = crate::countdown_write::save_preferences(
                &cloud, &device, &panel, on, hours, minutes,
            )
            .await;
            if let Some(current) = self.handle(&cloud, preferences).await? {
                report = Some(current);
                preferences_verified = Some(true);
            } else {
                preferences_verified = Some(false);
            }
        }
        self.inner
            .lock()
            .await
            .check_panel(&home_id, generation, &panel)?;
        let message = if preferences_verified == Some(false) {
            if let Some(report) = &mut report {
                report
                    .warnings
                    .push("倒计时记录已确认，但延迟时间偏好尚未回读确认。".into());
            }
            "云端倒计时已确认；延迟时间偏好未确认，请重新读取，勿重复创建。"
        } else if preferences_verified == Some(true) {
            "云端倒计时和延迟时间偏好已回读确认，实际通断电需观察设备反馈。"
        } else {
            "指定的云端倒计时已确认删除。"
        };
        Ok(CountdownChangeResult {
            scene_verified: true,
            preferences_verified,
            message: message.into(),
            report,
        })
    }
    async fn read_panel(
        &self,
        cloud: &Arc<Cloud>,
        home_id: &str,
        generation: u64,
        mut panel: DevicePanel,
        display_records: bool,
    ) -> Result<DevicePanel> {
        let read_version = {
            let inner = self.inner.lock().await;
            inner.check_panel(home_id, generation, &panel)?;
            inner.state_revision
        };
        let params = spec::read_params(&panel);
        if !params.is_empty() {
            let rows = self
                .handle(cloud, cloud.read_panel_properties(&panel).await)
                .await?;
            spec::apply_reads(&mut panel, &rows);
        }
        if display_records {
            self.inner
                .lock()
                .await
                .check_panel(home_id, generation, &panel)?;
            let missing = spec::missing_read_params(&panel);
            if !missing.is_empty() {
                if let Ok(result) =
                    tokio::time::timeout(Duration::from_secs(5), cloud.read_cached(missing)).await
                {
                    match self.handle(cloud, result).await {
                        Ok(rows) => spec::apply_reported(&mut panel, &rows, epoch_secs()),
                        Err(error) if error.kind == "authExpired" => return Err(error),
                        Err(_) => {} // Optional records cannot hide a direct read result.
                    }
                }
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_panel(home_id, generation, &panel)?;
        if let Some(current) = inner.panels.get(&panel.did) {
            merge_newer_properties(&mut panel, current, read_version, &inner.property_versions);
        }
        crate::washer_runtime::refresh(&mut panel);
        crate::purifier::refresh(&mut panel);
        crate::dispenser_config::refresh(&mut panel);
        inner.panels.insert(panel.did.clone(), panel.clone());
        inner
            .panel_updated_at
            .insert(panel.did.clone(), epoch_secs());
        Ok(panel)
    }
    pub async fn save_purifier_cups(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        expected: String,
        cups: Vec<crate::purifier::Cup>,
    ) -> Result<ControlResult> {
        let _guard = self.purifier_write.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model != crate::purifier::MODEL || !device.online || device.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "当前设备或共享权限不允许修改杯量。",
                false,
            ));
        }
        let schema = self.specs.panel(&device).await?;
        let current = self
            .read_panel(&cloud, &home_id, generation, schema.clone(), false)
            .await?;
        let target = crate::purifier::cup_change(&current, &expected, &cups)?;
        if property_matches(&current, 7, 1, &target) {
            return Ok(ControlResult {
                verified: true,
                message: "设备当前杯量与目标一致。".into(),
                panel: current,
            });
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            inner
                .property_versions
                .insert(property_version_key(&did, 7, 1), revision);
        }
        match self
            .handle(
                &cloud,
                cloud
                    .write(schema.control_did(), 7, 1, target.clone())
                    .await,
            )
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => return Err(e),
        }
        let mut latest = current;
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_property_panel(&cloud, &home_id, generation, &schema, 7, 1)
                .await
            {
                Ok(p) => latest = p,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            if property_matches(&latest, 7, 1, &target) {
                return Ok(ControlResult {
                    verified: true,
                    message: "杯量已实时回读确认。".into(),
                    panel: latest,
                });
            }
        }
        Ok(ControlResult {
            verified: false,
            message: "杯量保存结果待确认，请重新读取；未重复发送。".into(),
            panel: latest,
        })
    }
    pub async fn set_property(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        piid: u32,
        value: Value,
    ) -> Result<ControlResult> {
        // Homepage shortcuts and the open panel share the same native queue.
        // Different properties remain independent; stale generations are
        // rechecked after waiting and before any cloud write.
        let write_key = format!("{generation}\n{home_id}\n{did}\n{siid}\n{piid}");
        let write_lock = {
            let mut locks = self.property_writes.lock().await;
            if locks.len() >= 512 {
                locks.retain(|_, lock| Arc::strong_count(lock) > 1);
            }
            locks.entry(write_key).or_default().clone()
        };
        let _write_guard = write_lock.lock().await;
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if device.model == crate::purifier::MODEL && siid == 7 && piid == 1 {
            return Err(AppError::invalid(
                "请使用杯量编辑页保存，以检查当前状态和其他客户端的修改。",
            ));
        }
        if device.model == crate::dispenser::MODEL
            && [
                (2, 7),
                (2, 6),
                (3, 1),
                (4, 1),
                (5, 1),
                (2, 9),
                (2, 10),
                (2, 11),
                (2, 12),
            ]
            .contains(&(siid, piid))
        {
            return Err(AppError::invalid(
                "请使用管线机专用设置，以核对设备上的模式和当前设置。",
            ));
        }
        let _dispenser_guard = if device.model == crate::dispenser::MODEL {
            Some(self.dispenser_write.lock().await)
        } else {
            None
        };
        if device.model == crate::fridge::MODEL {
            let p = self.specs.panel(&device).await?;
            if [
                crate::fridge::Field::Mode,
                crate::fridge::Field::Refrigerating,
                crate::fridge::Field::Freezing,
                crate::fridge::Field::Maternal,
            ]
            .into_iter()
            .filter_map(|f| crate::fridge::binding(&p, f))
            .any(|q| q.siid == siid && q.piid == piid)
            {
                return Err(AppError::invalid(
                    "请使用冰箱专用模式或调温控件，以核对当前状态并同步联动属性。",
                ));
            }
        }
        let _fridge_guard = if device.model == crate::fridge::MODEL {
            Some(self.fridge_write.lock().await)
        } else {
            None
        };
        if device.model == crate::airer::MODEL
            && ((siid == 2 && [2, 6].contains(&piid))
                || (siid == 4 && (1..=6).contains(&piid) || siid == 4 && piid == 9))
        {
            return Err(AppError::invalid("请使用晾衣机专用升降或夜灯编辑页操作。"));
        }
        let _airer_guard = if device.model == crate::airer::MODEL {
            Some(self.airer_write.lock().await)
        } else {
            None
        };
        if device.model == crate::purifier::MODEL && siid == 6 && piid == 1 {
            return Err(AppError::invalid(
                "请使用勿扰模式页设置，以同步云端定时与设备属性。",
            ));
        }
        if !device.online {
            return Err(AppError::new("offline", "设备离线，暂不能控制。", false));
        }
        if device.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享设备只有查看权限。",
                false,
            ));
        }
        // Ordinary reversible properties validate against the descriptor.
        // Model-specific dependencies below also require a fresh panel read.
        let _washer_guard = if crate::washer::supports_metadata(&device) {
            Some(self.washer_program_write.lock().await)
        } else {
            None
        };
        let purifier_setting =
            device.model == crate::purifier::MODEL && crate::purifier::is_setting(siid, piid);
        let _purifier_guard = if purifier_setting {
            Some(self.purifier_write.lock().await)
        } else {
            None
        };
        let schema = self.specs.panel(&device).await?;
        let property = schema
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .find(|p| p.siid == siid && p.piid == piid)
            .ok_or_else(|| AppError::invalid("MIoT描述中不存在此属性。"))?;
        if !crate::capabilities::property_write_allowed(&schema, siid, piid) {
            return Err(AppError::new(
                "permissionDenied",
                "此类设备在桌面仅支持读取状态。",
                false,
            ));
        }
        if !property.access.iter().any(|a| a == "write") {
            return Err(AppError::new(
                "permissionDenied",
                "此MIoT属性不允许写入。",
                false,
            ));
        }
        if let Some(reason) = &property.unsupported_reason {
            return Err(AppError::new("unsupported", reason.clone(), false));
        }
        spec::validate_value(property, &value)?;
        if crate::capabilities::resolve_device_capabilities(&schema)
            .properties
            .iter()
            .any(|p| p.siid == siid && p.piid == piid && p.kind == "command")
        {
            let mut actual = schema.clone();
            let values = cloud.read_panel_properties(&actual).await?;
            spec::apply_reads(&mut actual, &values);
            self.inner.lock().await.check(&home_id, generation)?;
            if crate::capabilities::motion_feedback(&actual, siid)
                .is_none_or(|p| p.code != Some(0) || p.value.is_none())
            {
                return Err(AppError::new(
                    "stateUnavailable",
                    "运动状态尚未读取，暂不能控制。",
                    true,
                ));
            }
        }
        if property.name == "on" && crate::switch_mode::property(&schema, siid).is_some() {
            // Fresh mode preflight also protects direct commands and non-panel
            // callers. Cached/last-reported mode never authorizes a write.
            let mode = crate::switch_mode::property(&schema, siid).unwrap();
            let rows = cloud
                .read(vec![
                    serde_json::json!({"did":schema.control_did(),"siid":siid,"piid":mode.piid}),
                ])
                .await?;
            let mut current = schema.clone();
            spec::apply_reads(&mut current, &rows);
            crate::switch_mode::validate(&current, siid)?;
        }
        if purifier_setting {
            if (siid, piid) == (2, 7)
                && crate::purifier_options::flushing_supported(&device) != Some(true)
            {
                return Err(AppError::new(
                    "unsupported",
                    "当前设备版本未确认支持滤芯冲洗设置。",
                    false,
                ));
            }
            let current = self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await?;
            crate::purifier::validate_setting(&current, siid, piid, &value)?;
            self.inner
                .lock()
                .await
                .check_control(&home_id, generation, &schema)?;
            if property_matches(&current, siid, piid, &value) {
                return Ok(ControlResult {
                    verified: true,
                    message: "设备当前设置与目标一致。".into(),
                    panel: current,
                });
            }
        }
        let runtime = if device.model == crate::washer::MODEL {
            let current = self
                .read_panel(&cloud, &home_id, generation, schema.clone(), false)
                .await?;
            crate::washer_runtime::validate_property(&current, siid, piid, &value)?
        } else {
            None
        };
        let readable = property.access.iter().any(|a| a == "read");
        let mut latest = {
            let inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner
                .panels
                .get(&did)
                .filter(|panel| {
                    panel_context_matches(&device, panel) && panel.spec_type == schema.spec_type
                })
                .cloned()
                .unwrap_or_else(|| schema.clone())
        };
        if readable
            && latest
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .find(|p| p.siid == siid && p.piid == piid)
                .is_some_and(|p| p.code.is_some_and(|c| c != 0))
        {
            return Err(AppError::new(
                "unsupported",
                "设备目前无法读取此属性，请先重新读取状态后再控制。",
                false,
            ));
        }
        {
            let mut inner = self.inner.lock().await;
            inner.check_control(&home_id, generation, &schema)?;
            inner.state_revision += 1;
            let revision = inner.state_revision;
            inner
                .property_versions
                .insert(property_version_key(&did, siid, piid), revision);
        }
        if crate::camera::category_supported(&device)
            && crate::camera::power::binding(&schema)
                .is_some_and(|p| p.siid == siid && p.piid == piid)
        {
            if let Some(awake) = value.as_bool() {
                crate::camera::power::record(
                    &device.model,
                    device.control_did(),
                    awake,
                    "submitted",
                );
            }
        }
        let sent = self
            .handle(
                &cloud,
                cloud
                    .write_panel_property(&schema, siid, piid, value.clone())
                    .await,
            )
            .await;
        let uncertain = match sent {
            Ok(_) => false,
            Err(error) if write_error_is_uncertain(&error) => true,
            Err(error) => return Err(error),
        };
        if let Some(control) = runtime {
            return self
                .read_washer_runtime_control(&cloud, &home_id, generation, latest, &control)
                .await;
        }
        if !readable {
            return Ok(ControlResult {
                verified: false,
                message: "命令已提交；此属性没有读取权限，无法确认设备实际状态。".into(),
                panel: latest,
            });
        }
        if let Some(prop) = latest
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == siid && p.piid == piid)
        {
            prop.value = None;
            prop.code = None;
            prop.last_reported = None;
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .read_property_panel(&cloud, &home_id, generation, &schema, siid, piid)
                .await
            {
                Ok(panel) => latest = panel,
                Err(error) if matches!(error.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(error)
                }
                Err(_) => continue,
            }
            if property_matches(&latest, siid, piid, &value) {
                return Ok(ControlResult {
                    verified: true,
                    message: "设备实时回读与目标值一致，请同时核实设备实际反馈。".into(),
                    panel: latest,
                });
            }
        }
        Ok(ControlResult {
            verified: false,
            message: if uncertain {
                "命令响应超时或无法识别，执行结果待确认；正在查询，未重复下发。"
            } else {
                "命令已提交，但尚未回读到目标值，仍待确认。"
            }
            .into(),
            panel: latest,
        })
    }
    pub async fn confirm_property(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        piid: u32,
        value: Value,
    ) -> Result<ControlResult> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        let property = panel
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .find(|p| p.siid == siid && p.piid == piid)
            .filter(|p| p.access.iter().any(|a| a == "read"))
            .ok_or_else(|| AppError::new("unsupported", "此属性不允许实时回读。", false))?;
        spec::validate_value(property, &value)?;
        let latest = self
            .read_property_panel(&cloud, &home_id, generation, &panel, siid, piid)
            .await?;
        let verified = property_matches(&latest, siid, piid, &value);
        Ok(ControlResult {
            verified,
            message: if verified {
                "设备实时状态已确认。"
            } else {
                "尚未回读到目标值。"
            }
            .into(),
            panel: latest,
        })
    }
    async fn read_property_panel(
        &self,
        cloud: &Arc<Cloud>,
        home_id: &str,
        generation: u64,
        schema: &DevicePanel,
        siid: u32,
        piid: u32,
    ) -> Result<DevicePanel> {
        let read_version = {
            let inner = self.inner.lock().await;
            inner.check_panel(home_id, generation, schema)?;
            inner.state_revision
        };
        let rows = self
            .handle(cloud, cloud.read_panel_property(schema, siid, piid).await)
            .await?;
        let mut inner = self.inner.lock().await;
        inner.check_panel(home_id, generation, schema)?;
        let mut panel = inner
            .panels
            .get(&schema.did)
            .filter(|panel| {
                panel.spec_type == schema.spec_type && panel.control_did() == schema.control_did()
            })
            .cloned()
            .unwrap_or_else(|| schema.clone());
        let version_key = property_version_key(&schema.did, siid, piid);
        if inner
            .property_versions
            .get(&version_key)
            .is_none_or(|version| *version <= read_version)
        {
            spec::apply_property_read(&mut panel, &rows, siid, piid);
            inner.state_revision += 1;
            let revision = inner.state_revision;
            inner.property_versions.insert(version_key, revision);
        } else {
            return Err(AppError::new(
                "stateSuperseded",
                "此属性已有更新的操作或回读，请重新确认状态。",
                true,
            ));
        }
        inner.panels.insert(panel.did.clone(), panel.clone());
        Ok(panel)
    }

    async fn read_washer_runtime_control(
        &self,
        cloud: &Arc<Cloud>,
        home_id: &str,
        generation: u64,
        mut latest: DevicePanel,
        control: &crate::washer_runtime::RuntimeControl,
    ) -> Result<ControlResult> {
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(600)).await;
            }
            match self
                .read_panel(cloud, home_id, generation, latest.clone(), false)
                .await
            {
                Ok(panel) => {
                    latest = panel;
                    if crate::washer_runtime::confirmed(control, &latest) {
                        let mut inner = self.inner.lock().await;
                        inner.check_panel(home_id, generation, &latest)?;
                        protect_runtime_panel(&mut inner, &latest);
                        return Ok(ControlResult {
                            verified: true,
                            message: "已回读确认设备运行状态变更，请结合洗衣机实际反馈核对。"
                                .into(),
                            panel: latest,
                        });
                    }
                }
                Err(e) if e.kind == "authExpired" || e.kind == "staleContext" => return Err(e),
                Err(_) => {}
            }
        }
        let mut inner = self.inner.lock().await;
        inner.check_panel(home_id, generation, &latest)?;
        protect_runtime_panel(&mut inner, &latest);
        Ok(ControlResult {
            verified: false,
            message: "操作请求已发出，但目标运行状态尚未确认。请重新读取，勿重复提交。".into(),
            panel: latest,
        })
    }
    pub async fn run_action(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        siid: u32,
        aiid: u32,
        inputs: Vec<Value>,
    ) -> Result<ControlResult> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if crate::ir_remote::supported(&device.model) {
            return Err(AppError::invalid("请使用按真实按键表生成的红外遥控页面。"));
        }
        let _dispenser_guard = if device.model == crate::dispenser::MODEL {
            Some(self.dispenser_write.lock().await)
        } else {
            None
        };
        if device.model == crate::fridge::MODEL && siid == 7 && aiid == 1 {
            return Err(AppError::invalid(
                "请使用冰箱恢复出厂设置确认框，以核对完整的当前设置。",
            ));
        }
        if device.model == crate::dispenser::MODEL && siid == 2 && matches!(aiid, 2..=4) {
            return Err(AppError::invalid(if aiid == 4 {
                "请使用喝水提醒页面，以核对云定时和当前设备状态。"
            } else {
                "请使用管路高温杀菌专页，以核对当前状态并确认操作结果。"
            }));
        }
        if device.model == crate::dispenser::MODEL && siid == 7 && matches!(aiid, 1 | 2) {
            return Err(AppError::invalid(
                "请使用设备自检页面，以核对阶段并避免重复操作。",
            ));
        }
        if device.model == crate::airer::MODEL && siid == 4 && (1..=5).contains(&aiid) {
            return Err(AppError::invalid(
                "升降请使用专用控制页；限位校准尚未接入。",
            ));
        }
        // Serialize runtime actions with program submission, without replaying
        // either operation when an acknowledgement is lost.
        let _washer_guard = if crate::washer::supports_metadata(&device) {
            Some(self.washer_program_write.lock().await)
        } else {
            None
        };
        if !device.online {
            return Err(AppError::new(
                "offline",
                "设备离线，暂不能执行动作。",
                false,
            ));
        }
        let panel = self
            .device_panel(home_id.clone(), generation, did.clone())
            .await?;
        let service = panel
            .services
            .iter()
            .find(|s| s.siid == siid)
            .ok_or_else(|| AppError::invalid("不存在此 MIoT 服务。"))?;
        if !crate::capabilities::action_write_allowed(&panel, siid, aiid) {
            return Err(AppError::new(
                "permissionDenied",
                "此类设备在桌面仅支持读取状态。",
                false,
            ));
        }
        let action = service
            .actions
            .iter()
            .find(|a| a.aiid == aiid)
            .ok_or_else(|| AppError::invalid("不存在此 MIoT 动作。"))?;
        crate::capabilities::validate_appliance_action(&panel, siid, aiid)?;
        if let Some(reason) = &action.unsupported_reason {
            return Err(AppError::new("unsupported", reason, false));
        }
        if inputs.len() != action.inputs.len() {
            return Err(AppError::invalid("动作参数数量与 MIoT 描述不符。"));
        }
        for (piid, value) in action.inputs.iter().zip(&inputs) {
            let property = service
                .properties
                .iter()
                .find(|p| p.piid == *piid)
                .ok_or_else(AppError::protocol)?;
            spec::validate_value(property, value)?;
        }
        self.inner
            .lock()
            .await
            .check_control(&home_id, generation, &panel)?;
        let runtime = crate::washer_runtime::validate_action(&panel, siid, aiid)?;
        let sent = self
            .handle(&cloud, cloud.panel_action(&panel, siid, aiid, inputs).await)
            .await;
        if let Some(control) = runtime {
            if let Err(error) = &sent {
                if error.kind == "authExpired" || error.kind == "staleContext" {
                    return Err(error.clone());
                }
            }
            return self
                .read_washer_runtime_control(&cloud, &home_id, generation, panel, &control)
                .await;
        }
        sent?;
        tokio::time::sleep(Duration::from_millis(700)).await;
        let latest = match self
            .read_panel(&cloud, &home_id, generation, panel.clone(), false)
            .await
        {
            Ok(panel) => panel,
            Err(e) if e.kind == "authExpired" || e.kind == "staleContext" => return Err(e),
            Err(_) => {
                return Ok(ControlResult {
                    verified: false,
                    message: "动作请求已被接受，但状态回读失败；请核实设备实际反馈。".into(),
                    panel,
                })
            }
        };
        Ok(ControlResult {
            verified: false,
            message:
                "动作请求已被接受并已重新读取属性；通用面板无法判断动作实际效果，请核实设备反馈。"
                    .into(),
            panel: latest,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn confirmed_dispenser_configuration_survives_older_reads() {
        let mut state = inner();
        let mut current: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        let mut incoming = current.clone();
        for (p, value) in [
            (&mut current, "[[1,常温,25,150],[5,热水,55,150]]"),
            (&mut incoming, "[[1,常温,25,150],[5,热水,50,150]]"),
        ] {
            let property = p
                .services
                .iter_mut()
                .flat_map(|s| &mut s.properties)
                .find(|p| p.siid == 2 && p.piid == 7)
                .unwrap();
            property.code = Some(0);
            property.value = Some(Value::String(value.into()));
        }
        crate::dispenser_config::refresh(&mut current);
        protect_runtime_panel(&mut state, &current);
        merge_newer_properties(&mut incoming, &current, 0, &state.property_versions);
        crate::dispenser_config::refresh(&mut incoming);
        assert_eq!(incoming.dispenser.unwrap().modes[1].temperature, 55);
    }
    fn inner() -> Inner {
        Inner {
            cloud: None,
            boot_error: None,
            login: None,
            epoch: 1,
            generation: 3,
            selected: Some("a".into()),
            homes: vec![],
            devices: vec![],
            panels: HashMap::new(),
            panel_updated_at: HashMap::new(),
            state_revision: 0,
            property_versions: HashMap::new(),
        }
    }
    #[test]
    fn switching_home_invalidates_generation_and_clears_device_state() {
        let mut state = inner();
        state
            .panel_updated_at
            .insert("old-device".into(), epoch_secs());
        state.property_versions.insert("old-device".into(), 3);
        state.clear_home();
        assert_eq!(state.generation, 4);
        assert!(state.selected.is_none());
        assert!(state.devices.is_empty());
        assert!(state.panels.is_empty());
        assert!(state.panel_updated_at.is_empty());
        assert!(state.property_versions.is_empty());
    }
    fn light_modes_context() -> (Inner, Arc<Cloud>, Device) {
        let cloud = Arc::new(
            Cloud::new(auth::Credentials {
                user_id: "0".into(),
                security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                service_token: "isolated-state-fixture".into(),
                region: "cn".into(),
                device_id: "isolated-fixture-device".into(),
                service_id: "mijia".into(),
                c_user_id: "isolated-fixture-user".into(),
            })
            .unwrap(),
        );
        let device: Device = serde_json::from_value(serde_json::json!({
            "did":"fixture-light","model":"yeelink.light.wyra01","name":"light",
            "online":true,"roomId":"room","roomName":"room"
        }))
        .unwrap();
        let mut state = inner();
        state.cloud = Some(cloud.clone());
        state.devices.push(device.clone());
        (state, cloud, device)
    }
    #[test]
    fn washer_records_reject_inflight_results_after_refresh_model_change_home_switch_and_logout() {
        let (mut state, cloud, mut device) = light_modes_context();
        device.model = crate::washer::MODEL.into();
        state.devices = vec![device.clone()];
        let context = WasherReadContext {
            cloud,
            device,
            home_id: "a".into(),
            generation: 3,
            epoch: 1,
            revision: 0,
        };
        assert!(state.check_washer_read(&context).is_ok());
        state.state_revision = 1;
        // Another property read/write invalidates an in-flight preview, but
        // must not discard a receipt and thereby permit a repeated start.
        assert!(state.check_washer_identity(&context).is_ok());
        assert_eq!(
            state.check_washer_read(&context).unwrap_err().kind,
            "staleContext"
        );
        state.state_revision = 0;
        state.devices[0].firmware_version = Some("updated-firmware".into());
        assert!(state.check_washer_identity(&context).is_err());
        state.devices[0].firmware_version = context.device.firmware_version.clone();
        state.devices[0].model = "other.washer".into();
        assert!(state.check_washer_read(&context).is_err());
        state.devices[0].model = crate::washer::MODEL.into();
        state.epoch = 2;
        assert!(state.check_washer_read(&context).is_err());
        state.epoch = 1;
        state.clear_home();
        assert!(state.check_washer_read(&context).is_err());
        state.cloud = None;
        assert_eq!(
            state.check_washer_read(&context).unwrap_err().kind,
            "authExpired"
        );
    }
    #[test]
    fn light_modes_result_rejects_old_household_generation_logout_and_relogin() {
        let (mut state, cloud, device) = light_modes_context();
        assert!(state
            .check_light_modes_context("a", 3, 1, &cloud, &device)
            .is_ok());
        assert_eq!(
            state
                .check_light_modes_context("b", 3, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert_eq!(
            state
                .check_light_modes_context("a", 2, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.epoch = 2;
        assert_eq!(
            state
                .check_light_modes_context("a", 3, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.epoch = 1;
        let (_, new_cloud, _) = light_modes_context();
        state.cloud = Some(new_cloud);
        assert_eq!(
            state
                .check_light_modes_context("a", 3, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.cloud = None;
        assert_eq!(
            state
                .check_light_modes_context("a", 3, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "authExpired"
        );
        state.cloud = Some(cloud.clone());
        state.clear_home();
        assert_eq!(
            state
                .check_light_modes_context("a", 3, 1, &cloud, &device)
                .unwrap_err()
                .kind,
            "staleContext"
        );
    }
    #[test]
    fn light_modes_result_cannot_reuse_removed_device_changed_model_or_routing() {
        let (mut state, cloud, device) = light_modes_context();
        state.devices[0].model = "other.light.v1".into();
        assert!(state
            .check_light_modes_context("a", 3, 1, &cloud, &device)
            .is_err());
        state.devices[0] = device.clone();
        state.devices[0].split_route = Some(SplitRoute {
            parent_did: "parent".into(),
            service_iid: 2,
        });
        assert!(state
            .check_light_modes_context("a", 3, 1, &cloud, &device)
            .is_err());
        state.devices[0] = device.clone();
        state.devices[0].unsupported_reason = Some("changed route".into());
        assert!(state
            .check_light_modes_context("a", 3, 1, &cloud, &device)
            .is_err());
        state.devices.clear();
        assert!(state
            .check_light_modes_context("a", 3, 1, &cloud, &device)
            .is_err());
    }
    fn settings_context() -> (Inner, LightSettingsContext) {
        let (state, cloud, device) = light_modes_context();
        let panel: DevicePanel = serde_json::from_value(serde_json::json!({
            "did":device.did,"model":device.model,"services":[{
                "siid":2,"name":"light","description":"Light","actions":[],"properties":[{
                    "siid":2,"piid":5,"name":"mode","description":"Mode","format":"uint8",
                    "access":["read","write"],"valueList":(11..=15).map(|value|serde_json::json!({"value":value,"description":"mode"})).collect::<Vec<_>>()
                }]
            }]
        })).unwrap();
        (
            state,
            LightSettingsContext {
                cloud,
                device,
                panel,
                home_id: "a".into(),
                generation: 3,
                epoch: 1,
            },
        )
    }
    #[test]
    fn settings_context_cannot_cross_account_home_epoch_or_device_after_async_work() {
        let (mut state, context) = settings_context();
        assert!(state.check_light_settings_context(&context, true).is_ok());
        state.epoch += 1;
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.epoch = context.epoch;
        let (_, new_account) = settings_context();
        state.cloud = Some(new_account.cloud);
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.cloud = Some(context.cloud.clone());
        state.selected = Some("other-home".into());
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.selected = Some("a".into());
        state.devices[0].model = "other.light.v1".into();
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "staleContext"
        );
        state.devices[0] = context.device.clone();
        state.clear_home();
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "staleContext"
        );
    }
    #[test]
    fn settings_write_boundary_rechecks_current_online_status_but_queries_remain_readonly() {
        let (mut state, mut context) = settings_context();
        state.devices[0].online = false;
        assert!(state.check_light_settings_context(&context, false).is_ok());
        assert_eq!(
            state
                .check_light_settings_context(&context, true)
                .unwrap_err()
                .kind,
            "permissionDenied"
        );
        state.devices[0].online = true;
        context.panel.services[0].properties[0].access = vec!["read".into()];
        assert!(state.check_light_settings_context(&context, false).is_ok());
        assert_eq!(
            state
                .check_light_settings_context(&context, true)
                .unwrap_err()
                .kind,
            "permissionDenied"
        );
        state.cloud = None;
        assert_eq!(
            state
                .check_light_settings_context(&context, false)
                .unwrap_err()
                .kind,
            "authExpired"
        );
    }
    #[test]
    fn opaque_or_disconnected_write_results_need_readback_instead_of_assumed_failure() {
        assert!(write_error_is_uncertain(&AppError::device(-999999)));
        assert!(write_error_is_uncertain(&AppError::device(-704042011)));
        assert!(write_error_is_uncertain(&AppError::protocol()));
        assert!(!write_error_is_uncertain(&AppError::device(-704220043)));
        assert!(!write_error_is_uncertain(&AppError::device(-704010000)));
    }
    #[test]
    fn stale_full_read_preserves_a_newer_property_without_masking_other_properties() {
        let make = |on: bool, level: u32| {
            serde_json::from_value::<DevicePanel>(serde_json::json!({"did":"test-device","model":"test.model","services":[{"siid":7,"name":"fan","description":"fan","actions":[],"properties":[{"siid":7,"piid":3,"name":"on","description":"power","format":"bool","access":["read","write"],"value":on,"code":0},{"siid":7,"piid":8,"name":"fan-level","description":"level","format":"uint8","access":["read","write"],"value":level,"code":0}]}]})).unwrap()
        };
        let current = make(true, 5);
        let mut older = make(false, 2);
        let versions = HashMap::from([(property_version_key("test-device", 7, 3), 4)]);
        merge_newer_properties(&mut older, &current, 3, &versions);
        assert_eq!(
            older.services[0].properties[0].value,
            Some(Value::Bool(true))
        );
        assert_eq!(
            older.services[0].properties[1].value,
            Some(serde_json::json!(2))
        );
        let mut fresh = make(false, 1);
        merge_newer_properties(&mut fresh, &current, 5, &versions);
        assert_eq!(
            fresh.services[0].properties[0].value,
            Some(Value::Bool(false))
        );
    }
    #[test]
    fn runtime_result_protects_all_status_fields_from_earlier_background_reads() {
        let mut state = inner();
        let mut older: DevicePanel =
            serde_json::from_str(include_str!("fixtures/washer-panel.json")).unwrap();
        let mut confirmed = older.clone();
        for p in confirmed
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
        {
            p.code = Some(0);
            p.value = Some(serde_json::json!(0));
        }
        let status = confirmed
            .services
            .iter_mut()
            .filter(|s| s.name == "washer")
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "status")
            .unwrap();
        status.value = Some(serde_json::json!(2));
        let read_version = state.state_revision;
        protect_runtime_panel(&mut state, &confirmed);
        merge_newer_properties(
            &mut older,
            &confirmed,
            read_version,
            &state.property_versions,
        );
        crate::washer_runtime::refresh(&mut older);
        assert_eq!(older.washer_runtime.as_ref().unwrap().state, "paused");
        assert!(older
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .all(|p| state
                .property_versions
                .get(&property_version_key(&older.did, p.siid, p.piid))
                == Some(&state.state_revision)));
        let mut fresh = confirmed.clone();
        let status = fresh
            .services
            .iter_mut()
            .filter(|s| s.name == "washer")
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "status")
            .unwrap();
        status.value = Some(serde_json::json!(3));
        merge_newer_properties(
            &mut fresh,
            &confirmed,
            state.state_revision,
            &state.property_versions,
        );
        crate::washer_runtime::refresh(&mut fresh);
        assert_eq!(fresh.washer_runtime.unwrap().state, "busy");
    }
    #[test]
    fn refreshed_split_mapping_cannot_reuse_a_sibling_or_previous_parent_panel() {
        let mut device: Device = serde_json::from_value(serde_json::json!({
            "did":"logical", "name":"switch", "model":"test.switch.v1", "online":true,
            "roomId":"r", "roomName":"room", "icon":null, "specType":null, "unsupportedReason":null
        }))
        .unwrap();
        device.split_route = Some(SplitRoute {
            parent_did: "physical".into(),
            service_iid: 2,
        });
        let mut panel: DevicePanel = serde_json::from_value(serde_json::json!({
            "did":"logical", "model":"test.switch.v1", "services":[{
                "siid":2,"name":"switch","description":"switch","properties":[],"actions":[]
            }],"unsupportedReason":null
        }))
        .unwrap();
        panel.route_did = Some("physical".into());
        assert!(panel_context_matches(&device, &panel));
        device.split_route.as_mut().unwrap().service_iid = 3;
        assert!(!panel_context_matches(&device, &panel));
        device.split_route.as_mut().unwrap().service_iid = 2;
        device.split_route.as_mut().unwrap().parent_did = "other".into();
        assert!(!panel_context_matches(&device, &panel));
        device.split_route = None;
        assert!(!panel_context_matches(&device, &panel));
    }
}
