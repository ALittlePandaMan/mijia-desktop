//! Desktop presentation owns no credentials or independent device transports.
pub mod grid;
mod hosts;
mod input_regions;
mod motion;

mod platform;
use hosts::{Drag, Host, HostFrame};
pub fn wallpaper_plugin() -> tauri::plugin::TauriPlugin<tauri::Wry> {
    #[cfg(windows)]
    {
        tauri_plugin_wallpaper::init()
    }
    #[cfg(not(windows))]
    {
        tauri::plugin::Builder::new("desktop-widgets-platform").build()
    }
}
/// Local widget webviews cannot call the main application's broad command set.
pub fn guard(
    handler: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        if invoke.message.webview_ref().label().starts_with("widget-")
            && !matches!(
                invoke.message.command(),
                "desktop_widget_snapshot"
                    | "desktop_widget_control"
                    | "desktop_widget_card_control"
                    | "desktop_widget_switch_group"
                    | "desktop_widget_unpin"
                    | "desktop_widget_open"
                    | "desktop_widget_gesture"
                    | "desktop_widget_geometry"
                    | "desktop_widget_viewport"
                    | "desktop_widget_menu"
                    | "desktop_widget_regions"
                    | "desktop_resource_snapshot"
            )
        {
            invoke
                .resolver
                .reject("permissionDenied: device-bound widget command required");
            return true;
        }
        handler(invoke)
    }
}
use crate::{
    error::{AppError, Result},
    home_cards::{HomeCardEntry, HomeCardResult, HomeCardStatus},
    models::Device,
    state::AppState,
    widget_layout::{Geometry, Pin, Store},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Listener, Manager, WebviewWindow};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub group_intent:Option<crate::home_cards::switch_group::GroupResult>,
    pub control_intent: Option<crate::home_cards::presentation::CardControlResult>,
    pub id: String,
    pub home_id: String,
    pub revision: u64,
    pub device: Option<Device>,
    pub card: Option<HomeCardEntry>,
    pub status: Option<HomeCardStatus>,
    pub presentation: Option<crate::home_cards::presentation::HomeCardPresentation>,
    pub pending: Option<String>,
    pub origin: Option<String>,
    pub error: Option<AppError>,
    pub geometry: Geometry,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Support {
    pub supported: bool,
    pub enabled_displays: usize,
    pub reason: Option<String>,
    pub pins: Vec<PinIdentity>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PinIdentity {
    pub id: String,
    pub home_id: String,
    pub did: String,
}
struct HomeContext {
    state: Arc<AppState>,
    inventory_at: Instant,
}
struct RefreshFlight<'a> {
    key: String,
    flights: &'a Mutex<std::collections::HashSet<String>>,
}
impl Drop for RefreshFlight<'_> {
    fn drop(&mut self) {
        self.flights.lock().unwrap().remove(&self.key);
    }
}
pub struct Widgets {
    app: tauri::AppHandle,
    store: Mutex<Store>,
    views: Mutex<HashMap<String, View>>,
    scope: Mutex<Option<String>>,
    contexts: tokio::sync::Mutex<HashMap<String, HomeContext>>,
    context_flight: tokio::sync::Mutex<()>,
    revision: AtomicU64,
    stopped: AtomicBool,
    gestures: Mutex<HashMap<String, Drag>>,
    gesture_flight: tokio::sync::Mutex<()>,
    hosts: Mutex<HashMap<String, Host>>,
    previews: Mutex<motion::Previews>,
    reduced_motion: AtomicBool,
    animation_scheduled: AtomicBool,
    host_flight: tokio::sync::Mutex<()>,
    host_scheduled: AtomicBool,
    host_requested: AtomicBool,
    host_force: AtomicBool,
    operation_versions: Mutex<HashMap<String, u64>>,
    last_topology: Mutex<String>,
    failures: Mutex<HashMap<String, (Instant, u32)>>,
    lifecycle: tokio::sync::Mutex<()>,
    refresh_flights: Mutex<std::collections::HashSet<String>>,
    samples: Mutex<std::collections::VecDeque<serde_json::Value>>,
    zooms: Mutex<HashMap<String, f64>>,
    refresh_deadlines: Mutex<HashMap<String, crate::resource_policy::RefreshDeadline>>,
    refresh_wake: tokio::sync::Notify,
    started: Instant,
}
impl Widgets {
    pub(crate) fn owns_host(&self, label: &str) -> bool {
        self.hosts.lock().unwrap().contains_key(label)
    }
    pub(crate) fn resource_targets(
        &self,
    ) -> Vec<(String, Vec<(String, crate::widget_layout::PixelRect)>, bool)> {
        let hosts = self.hosts.lock().unwrap();
        let gestures = self.gestures.lock().unwrap();
        let preparing = !gestures.is_empty()
            || self.previews.lock().unwrap().active()
            || hosts.keys().any(|label| platform::candidate(label));
        hosts
            .iter()
            .map(|(label, h)| {
                let regions = h
                    .cards
                    .iter()
                    .filter(|c| c.interactive || gestures.contains_key(&c.view.id))
                    .filter_map(|c| {
                        let rect = crate::widget_layout::PixelRect {
                            x: h.bounds.x + c.x * h.viewport.scale,
                            y: h.bounds.y + c.y * h.viewport.scale,
                            width: c.width * h.viewport.scale,
                            height: c.height * h.viewport.scale,
                        };
                        let clip = crate::widget_layout::PixelRect {
                            x: h.bounds.x + h.viewport.clip.x * h.viewport.scale,
                            y: h.bounds.y + h.viewport.clip.y * h.viewport.scale,
                            width: h.viewport.clip.width * h.viewport.scale,
                            height: h.viewport.clip.height * h.viewport.scale,
                        };
                        rect.intersection(&clip).map(|r| (c.view.id.clone(), r))
                    })
                    .collect();
                let busy = preparing
                    || platform::candidate(label)
                    || h.menu.is_some()
                    || h.cards
                        .iter()
                        .any(|c| c.view.pending.is_some() || gestures.contains_key(&c.view.id));
                (label.clone(), regions, busy)
            })
            .collect()
    }
    pub(crate) fn desktop_hover_target(&self) -> Option<(String, String)> {
        platform::hover_target()
    }
    pub(crate) fn resource_changed(&self, label: &str, visible: bool) {
        if visible {
            let homes: Vec<_> = self
                .hosts
                .lock()
                .unwrap()
                .get(label)
                .map(|h| h.cards.iter().map(|c| c.view.home_id.clone()).collect())
                .unwrap_or_default();
            if let Ok(scope) = self.current_scope() {
                let mut d = self.refresh_deadlines.lock().unwrap();
                for home in homes {
                    d.entry(format!("{scope}\n{home}")).or_default().wake();
                }
            }
            self.refresh_wake.notify_one();
        }
    }
    pub(crate) fn resource_resumed(&self, label: &str) {
        let resources = self.app.state::<Arc<crate::resources::Resources>>();
        if !resources.visible(label) {
            return;
        }
        resources.mark_ready(label);
        // A state event emitted while WebView2 was suspended may never reach JS.
        // Replay after Resume, before sending the current card snapshot.
        let _ = self
            .app
            .emit_to(label, "desktop-resource-state", resources.state(label));
        if label == "main" {
            for view in self.views.lock().unwrap().values() {
                let _ = self.app.emit_to("main", "desktop-widget-state", view);
            }
            return;
        }
        let host = {
            let mut hosts = self.hosts.lock().unwrap();
            hosts.get_mut(label).map(|h| {
                h.dirty = true;
                h.clone()
            })
        };
        if let (Some(h), Some(window)) = (host, self.app.get_webview_window(label)) {
            self.register_host_targets(&window, &h);
        }
        self.schedule_hosts();
        // The started event may have been queued while WebView2 was suspended.
        // Replay presentation state only; never restart a device operation.
        let active: Vec<_> = self
            .gestures
            .lock()
            .unwrap()
            .iter()
            .filter(|(_, drag)| drag.owner == label)
            .map(|(id, d)| (id.clone(), "move", platform::gesture_sequence(&d.native)))
            .collect();
        for (id, kind, sequence) in active {
            let _=self.app.emit_to(label,"desktop-widget-gesture",serde_json::json!({"widgetId":id,"phase":"started","kind":kind,"sequence":sequence}));
        }
    }
    async fn refresh_due(&self) {
        let Ok(scope) = self.current_scope() else {
            return;
        };
        let resources = self.app.state::<Arc<crate::resources::Resources>>();
        let current = if resources.visible("main") {
            self.app
                .state::<AppState>()
                .context_identity()
                .await
                .ok()
                .map(|(h, _)| h)
        } else {
            None
        };
        let homes: std::collections::BTreeMap<String, bool> = {
            let store = self.store.lock().unwrap();
            let mut homes = std::collections::BTreeMap::new();
            for p in
                store.layout.pins.values().filter(|p| {
                    p.scope == scope && store.layout.display(&p.geometry.monitor).enabled
                })
            {
                let visible = resources.card_visible(&p.id) || current.as_ref() == Some(&p.home_id);
                *homes.entry(p.home_id.clone()).or_insert(false) |= visible;
            }
            homes
        };
        let now = self.started.elapsed().as_millis() as u64;
        for (home, visible) in homes {
            let due = self
                .refresh_deadlines
                .lock()
                .unwrap()
                .entry(format!("{scope}\n{home}"))
                .or_default()
                .due(now, visible);
            if due {
                self.refresh_home(&scope, &home).await;
            }
        }
    }
    pub fn install(app: &tauri::AppHandle) -> Result<()> {
        let path = crate::platform_paths::local_data_dir()
            .ok_or_else(|| AppError::new("localPreferences", "无法取得组件配置目录。", true))?
            .join("io.mijiadesktop.client")
            .join("desktop-widgets-v1.json");
        let widgets = Arc::new(Self {
            app: app.clone(),
            store: Mutex::new(
                Store::new(path.clone()).unwrap_or_else(|e| Store::disabled(path, e)),
            ),
            views: Mutex::new(HashMap::new()),
            scope: Mutex::new(None),
            contexts: tokio::sync::Mutex::new(HashMap::new()),
            context_flight: tokio::sync::Mutex::new(()),
            revision: AtomicU64::new(1),
            stopped: AtomicBool::new(false),
            gestures: Mutex::new(HashMap::new()),
            gesture_flight: tokio::sync::Mutex::new(()),
            hosts: Mutex::new(HashMap::new()),
            previews: Mutex::new(Default::default()),
            reduced_motion: AtomicBool::new(false),
            animation_scheduled: AtomicBool::new(false),
            host_flight: tokio::sync::Mutex::new(()),
            host_scheduled: AtomicBool::new(false),
            host_requested: AtomicBool::new(false),
            host_force: AtomicBool::new(true),
            operation_versions: Mutex::new(HashMap::new()),
            last_topology: Mutex::new(String::new()),
            failures: Mutex::new(HashMap::new()),
            lifecycle: tokio::sync::Mutex::new(()),
            refresh_flights: Mutex::new(Default::default()),
            samples: Mutex::new(Default::default()),
            zooms: Mutex::new(HashMap::new()),
            refresh_deadlines: Mutex::new(HashMap::new()),
            refresh_wake: tokio::sync::Notify::new(),
            started: Instant::now(),
        });
        app.manage(widgets.clone());
        let mut changes = app.state::<AppState>().card_changes.subscribe();
        let observer = Arc::downgrade(&widgets);
        tauri::async_runtime::spawn(async move {
            loop {
                let (home, did) = match changes.recv().await {
                    Ok(value) => value,
                    Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => {
                        if let Some(w) = observer.upgrade() {
                            w.refresh_all().await;
                        }
                        continue;
                    }
                    Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
                };
                let Some(w) = observer.upgrade() else { break };
                if w.stopped.load(Ordering::Acquire) {
                    break;
                }
                let pending = w.views.lock().unwrap().values().any(|v| {
                    v.home_id == home
                        && v.device.as_ref().is_some_and(|d| d.did == did)
                        && v.pending.is_some()
                });
                if pending {
                    continue;
                }
                if let Ok(scope) = w.current_scope() {
                    w.refresh_home(&scope, &home).await;
                }
            }
        });
        if platform::supported() {
            platform::install(app.clone());
        }
        let weak = Arc::downgrade(&widgets);
        tauri::async_runtime::spawn(async move {
            let mut interval = tokio::time::interval(Duration::from_secs(2));
            loop {
                let Some(w) = weak.upgrade() else { break };
                tokio::select! {_ = interval.tick()=>{},_ = w.refresh_wake.notified()=>{}}
                if w.stopped.load(Ordering::Acquire) {
                    break;
                }
                if let Err(error) = w.reconcile().await {
                    let _ = w.app.emit_to("main", "desktop-widget-error", error);
                }
                w.refresh_due().await;
            }
        });
        let restore = Arc::downgrade(&widgets);
        app.listen("wallpaper://reattached", move |_| {
            if let Some(w) = restore.upgrade() {
                w.restore_geometry();
            }
        });
        Ok(())
    }
    fn active_pins(&self, scope: &str) -> Vec<Pin> {
        let screens = platform::displays();
        let store = self.store.lock().unwrap();
        store
            .layout
            .pins
            .values()
            .filter(|p| {
                p.scope == scope
                    && store.layout.display(&p.geometry.monitor).enabled
                    && screens.iter().any(|s| s.id == p.geometry.monitor)
            })
            .cloned()
            .collect()
    }
    pub fn has_pins(&self) -> bool {
        self.scope
            .lock()
            .unwrap()
            .as_ref()
            .is_some_and(|s| !self.active_pins(s).is_empty())
    }
    fn next(&self) -> u64 {
        self.revision.fetch_add(1, Ordering::AcqRel) + 1
    }
    fn current_scope(&self) -> Result<String> {
        self.scope
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(AppError::auth)
    }
    async fn check_scope(&self, scope: &str) -> Result<()> {
        if self.stopped.load(Ordering::Acquire)
            || self.app.state::<AppState>().account_scope().await?.as_str() != scope
        {
            return Err(AppError::stale());
        }
        Ok(())
    }
    fn pin_for_window(&self, window: &WebviewWindow, id: Option<&str>) -> Result<Pin> {
        let scope = self.current_scope()?;
        let hosts = self.hosts.lock().unwrap();
        let host = hosts.get(window.label()).ok_or_else(AppError::stale)?;
        let allowed: Vec<_> = host
            .cards
            .iter()
            .filter(|c| c.interactive)
            .map(|c| c.view.id.as_str())
            .collect();
        let id = id
            .or_else(|| {
                if allowed.len() == 1 {
                    Some(allowed[0])
                } else {
                    None
                }
            })
            .ok_or_else(|| AppError::invalid("请指定 widgetId。"))?;
        if !allowed.contains(&id) {
            return Err(AppError::new(
                "permissionDenied",
                "组件只能访问本宿主绑定的设备。",
                false,
            ));
        }
        self.store
            .lock()
            .unwrap()
            .layout
            .pins
            .get(id)
            .filter(|p| p.scope == scope)
            .cloned()
            .ok_or_else(AppError::stale)
    }
    fn notify(&self, mut view: View) {
        let mut views = self.views.lock().unwrap();
        if let Some(old) = views.get(&view.id) {
            let mut a = serde_json::to_value(old).unwrap_or_default();
            let mut b = serde_json::to_value(&view).unwrap_or_default();
            if let Some(a) = a.as_object_mut() {
                a.remove("revision");
            }
            if let Some(b) = b.as_object_mut() {
                b.remove("revision");
            }
            if a == b {
                return;
            }
            if view.revision <= old.revision {
                view.revision = self.next();
            }
        }
        views.insert(view.id.clone(), view.clone());
        drop(views);
        if self
            .app
            .state::<Arc<crate::resources::Resources>>()
            .visible("main")
        {
            let _ = self.app.emit_to("main", "desktop-widget-state", &view);
        }
        self.schedule_hosts();
    }
    pub async fn support(&self) -> Support {
        let scope = self.app.state::<AppState>().account_scope().await.ok();
        let failure = self.store.lock().unwrap().failure.clone();
        let supported = platform::supported() && failure.is_none();
        let pins = self
            .store
            .lock()
            .unwrap()
            .layout
            .pins
            .values()
            .filter(|p| Some(&p.scope) == scope.as_ref())
            .map(|p| PinIdentity {
                id: p.id.clone(),
                home_id: p.home_id.clone(),
                did: p.did.clone(),
            })
            .collect();
        Support {
            enabled_displays: {
                let store = self.store.lock().unwrap();
                platform::displays()
                    .iter()
                    .filter(|s| store.layout.display(&s.id).enabled)
                    .count()
            },
            supported,
            reason: if let Some(error) = failure {
                Some(error.message)
            } else if supported {
                None
            } else {
                Some("当前系统暂不支持桌面组件。".into())
            },
            pins,
        }
    }
    async fn context(&self, scope: &str, home: &str) -> Result<Arc<AppState>> {
        self.check_scope(scope).await?;
        let key = format!("{scope}\n{home}");
        let _flight = self.context_flight.lock().await;
        let root = self.app.state::<AppState>();
        let cached = self
            .contexts
            .lock()
            .await
            .get(&key)
            .map(|c| (c.state.clone(), c.inventory_at));
        if let Some((state, at)) = cached {
            if state.context_identity().await.is_ok() {
                let current_home = root
                    .context_identity()
                    .await
                    .ok()
                    .is_some_and(|(h, _)| h == home);
                let root_at = if current_home {
                    root.inventory_time(home).await
                } else {
                    None
                };
                let fresh = root_at.filter(|t| t.elapsed() < Duration::from_secs(60));
                if let Some(root_at) = fresh {
                    if root_at > at {
                        state
                            .sync_widget_inventory(home, root.context_devices().await?)
                            .await?;
                    }
                } else if at.elapsed() >= Duration::from_secs(60) {
                    state.refresh_widget_inventory().await?;
                }
                let actual = fresh.or(state.inventory_time(home).await).unwrap_or(at);
                if let Some(c) = self.contexts.lock().await.get_mut(&key) {
                    c.inventory_at = actual;
                }
                return Ok(state);
            }
            self.contexts.lock().await.remove(&key);
        }
        let state = if root
            .context_identity()
            .await
            .ok()
            .is_some_and(|(h, _)| h == home)
        {
            Arc::new(root.card_context().await?)
        } else {
            Arc::new(root.fork_home(home.into()).await?)
        };
        self.check_scope(scope).await?;
        let inventory_at = state
            .inventory_time(home)
            .await
            .unwrap_or_else(Instant::now);
        self.contexts.lock().await.insert(
            key,
            HomeContext {
                state: state.clone(),
                inventory_at,
            },
        );
        Ok(state)
    }
    pub(crate) async fn reconcile(&self) -> Result<()> {
        let _lifecycle = self.lifecycle.lock().await;
        let scope = self.app.state::<AppState>().account_scope().await.ok();
        let changed = {
            let mut current = self.scope.lock().unwrap();
            let changed = *current != scope;
            if changed {
                *current = scope.clone();
            }
            changed
        };
        if changed {
            let labels: Vec<_> = self.hosts.lock().unwrap().keys().cloned().collect();
            for label in labels {
                platform::unregister(&label);
                if let Some(window) = self.app.get_webview_window(&label) {
                    let _ = window.destroy();
                }
            }
            self.hosts.lock().unwrap().clear();
            self.zooms.lock().unwrap().clear();
            self.views.lock().unwrap().clear();
            self.gestures.lock().unwrap().clear();
            *self.previews.lock().unwrap() = Default::default();
            self.operation_versions.lock().unwrap().clear();
            self.contexts.lock().await.clear();
            let _ = self.app.emit_to("main", "desktop-widgets-changed", ());
        }
        let Some(scope) = scope else { return Ok(()) };
        if !platform::supported() {
            return Ok(());
        }
        // The main bootstrap owns family discovery. Restoring widgets waits for
        // it instead of issuing a second all-family enumeration during login.
        if self
            .app
            .state::<AppState>()
            .context_identity()
            .await
            .is_err()
        {
            return Ok(());
        }
        let mut pins = self.active_pins(&scope);
        if self.gestures.lock().unwrap().is_empty()
            && (pins.iter().any(|p| p.geometry.grid.is_none())
                || *self.last_topology.lock().unwrap() != platform::topology())
        {
            if let Err(error) = self.ensure_grid() {
                let _ = self.app.emit_to("main", "desktop-widget-error", error);
            }
        }
        pins = self.active_pins(&scope);
        let ids: std::collections::HashSet<_> = pins.iter().map(|p| p.id.clone()).collect();
        self.views.lock().unwrap().retain(|id, _| ids.contains(id));
        let mut created = false;
        if pins.is_empty() {
            self.contexts.lock().await.clear();
            self.refresh_deadlines.lock().unwrap().clear();
            self.sync_hosts().await?;
            return Ok(());
        }
        for pin in pins {
            if !self.views.lock().unwrap().contains_key(&pin.id) {
                self.create(&pin).await?;
                created = true;
            }
        }
        let topology = platform::topology();
        let changed = {
            let mut previous = self.last_topology.lock().unwrap();
            let changed = *previous != topology;
            *previous = topology;
            changed
        };
        if changed {
            self.restore_geometry();
        }
        let missing_host = self
            .hosts
            .lock()
            .unwrap()
            .keys()
            .any(|label| self.app.get_webview_window(label).is_none());
        if created || changed || missing_host {
            self.sync_hosts().await?;
        }
        Ok(())
    }
    async fn create(&self, pin: &Pin) -> Result<()> {
        self.views
            .lock()
            .unwrap()
            .entry(pin.id.clone())
            .or_insert_with(|| View {
                id: pin.id.clone(),
                home_id: pin.home_id.clone(),
                revision: self.next(),
                device: None,
                card: None,
                status: None,
                presentation: None,
                control_intent:None,
                group_intent:None,
                pending: None,
                origin: None,
                error: None,
                geometry: pin.geometry.clone(),
            });
        self.schedule_refresh(&pin.scope, &pin.home_id);
        Ok(())
    }
    fn restore_geometry(&self) {
        self.host_force.store(true, Ordering::Release);
        self.schedule_hosts();
    }
    pub async fn pin(&self, home: String, generation: u64, did: String) -> Result<Support> {
        let _lifecycle = self.lifecycle.lock().await;
        if !platform::supported() {
            return Err(AppError::new(
                "desktopWidgetsUnsupported",
                "当前系统暂不支持桌面组件。",
                false,
            ));
        }
        let root = self.app.state::<AppState>();
        if root.context_identity().await? != (home.clone(), generation) {
            return Err(AppError::stale());
        }
        let scope = root.account_scope().await?;
        let device = root
            .context_devices()
            .await?
            .into_iter()
            .find(|d| d.did == did)
            .ok_or_else(AppError::stale)?;
        *self.scope.lock().unwrap() = Some(scope.clone());
        let exists = self
            .store
            .lock()
            .unwrap()
            .layout
            .existing(&scope, &home, &did)
            .is_some();
        if exists {
            return Ok(self.support().await);
        }
        let mut pin = Pin {
            layouts: Default::default(),
            id: uuid::Uuid::new_v4().to_string(),
            scope: scope.clone(),
            home_id: home.clone(),
            did,
            fingerprint: crate::widget_layout::device_fingerprint(&device),
            name: device.name.clone(),
            geometry: Geometry::default(),
        };
        self.ensure_grid()?;
        let screens: Vec<_> = {
            let store = self.store.lock().unwrap();
            platform::displays()
                .into_iter()
                .filter(|s| store.layout.display(&s.id).enabled)
                .collect()
        };
        if screens.is_empty() {
            return Err(AppError::new(
                "desktopDisabled",
                "请先在设置 → 桌面卡片中开启至少一个屏幕。",
                false,
            ));
        }
        let main_point = self
            .app
            .get_webview_window("main")
            .and_then(|w| w.outer_position().ok());
        let screen = main_point
            .and_then(|p| {
                screens.iter().find(|s| {
                    let r = s.rect();
                    p.x as f64 >= r.x
                        && (p.x as f64) < r.x + r.width
                        && p.y as f64 >= r.y
                        && (p.y as f64) < r.y + r.height
                })
            })
            .or_else(|| screens.iter().find(|s| s.primary))
            .or(screens.first())
            .ok_or_else(AppError::stale)?;
        {
            let store = self.store.lock().unwrap();
            let grid = Self::grid_for(&store.layout, screen)?;
            let occupied: Vec<_> = store
                .layout
                .pins
                .values()
                .filter(|p| p.scope == scope && p.geometry.monitor == screen.id)
                .filter_map(|p| crate::widget_grid::anchor(&p.geometry))
                .collect();
            let a = grid
                .place(crate::preferences::CardSize::Medium, 0., 0., &occupied)
                .ok_or_else(|| {
                    AppError::new(
                        "desktopGridFull",
                        "此显示器没有可用位置，请先移动卡片或调整栅格。",
                        false,
                    )
                })?;
            pin.geometry = grid.geometry(&screen.id, a);
            pin.layouts
                .entry(screen.id.clone())
                .or_default()
                .insert(grid.preset.key().into(), a);
        }
        self.create(&pin).await?;
        // Attach requires membership, but the public pin is committed only after
        // a host has been built. Roll back both memory and disk on failure.
        let before = self.store.lock().unwrap().layout.clone();
        {
            let mut store = self.store.lock().unwrap();
            let mut next = store.layout.clone();
            next.pins.insert(pin.id.clone(), pin.clone());
            store.save(next)?;
        }
        if let Err(error) = self.sync_hosts().await {
            self.views.lock().unwrap().remove(&pin.id);
            let _ = self.store.lock().unwrap().save(before);
            let _ = self.sync_hosts().await;
            return Err(error);
        }
        self.schedule_refresh(&scope, &home);
        let _ = self.app.emit_to("main", "desktop-widgets-changed", ());
        Ok(self.support().await)
    }
    pub async fn unpin(&self, id: &str) -> Result<()> {
        let _lifecycle = self.lifecycle.lock().await;
        let scope = self.app.state::<AppState>().account_scope().await?;
        let pin = {
            let mut store = self.store.lock().unwrap();
            let p = store
                .layout
                .pins
                .get(id)
                .filter(|p| p.scope == scope)
                .cloned()
                .ok_or_else(AppError::stale)?;
            let mut next = store.layout.clone();
            next.pins.remove(id);
            store.save(next)?;
            p
        };
        platform::forget_widget(&pin.id);
        self.views.lock().unwrap().remove(&pin.id);
        self.gestures.lock().unwrap().remove(&pin.id);
        let homes: std::collections::HashSet<_> = self
            .store
            .lock()
            .unwrap()
            .layout
            .pins
            .values()
            .filter(|p| p.scope == scope)
            .map(|p| format!("{}\n{}", scope, p.home_id))
            .collect();
        self.contexts
            .lock()
            .await
            .retain(|key, _| homes.contains(key));
        self.refresh_deadlines
            .lock()
            .unwrap()
            .retain(|key, _| homes.contains(key));
        self.failures
            .lock()
            .unwrap()
            .retain(|key, _| homes.contains(key));
        let _ = self.app.emit_to("main", "desktop-widgets-changed", ());
        self.schedule_hosts();
        Ok(())
    }
    fn schedule_refresh(&self, scope: &str, home: &str) {
        let w = self.app.state::<Arc<Widgets>>().inner().clone();
        let scope = scope.to_string();
        let home = home.to_string();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            w.refresh_home(&scope, &home).await;
        });
    }
    async fn refresh_all(&self) {
        let Ok(scope) = self.current_scope() else {
            return;
        };
        let homes: std::collections::BTreeSet<_> = self
            .store
            .lock()
            .unwrap()
            .layout
            .pins
            .values()
            .filter(|p| p.scope == scope)
            .map(|p| p.home_id.clone())
            .collect();
        for home in homes {
            self.refresh_home(&scope, &home).await;
        }
    }
    pub async fn refresh_home(&self, scope: &str, home: &str) {
        let retry_key = format!("{scope}\n{home}");
        if !self
            .refresh_flights
            .lock()
            .unwrap()
            .insert(retry_key.clone())
        {
            return;
        }
        let _flight = RefreshFlight {
            key: retry_key.clone(),
            flights: &self.refresh_flights,
        };
        if self
            .failures
            .lock()
            .unwrap()
            .get(&retry_key)
            .is_some_and(|(next, _)| *next > Instant::now())
        {
            return;
        }
        let pins: Vec<_> = self
            .active_pins(scope)
            .into_iter()
            .filter(|p| p.home_id == home)
            .collect();
        if pins.is_empty() {
            return;
        }
        let revision = self.revision.load(Ordering::Acquire);
        let trace = crate::mcp_core::metrics::Trace::new("desktop_card_refresh");
        let result = trace
            .scope(async {
                let context = self.context(scope, home).await?;
                let devices = context.context_devices().await?;
                let (_, generation) = context.context_identity().await?;
                let ids: Vec<_> = pins.iter().map(|p| p.did.clone()).collect();
                let report = context.home_cards_for(home, generation, &ids).await?;
                let resources=self.app.state::<Arc<crate::resources::Resources>>();
                let large_ids=pins.iter().filter(|p|p.geometry.size==crate::preferences::CardSize::Large && resources.card_visible(&p.id)).map(|p|p.did.clone()).collect();
                let mut report=report;
                report.presentations=context.home_card_presentations(home.into(),generation,large_ids).await.unwrap_or_default();
                self.check_scope(scope).await?;
                Ok::<_, AppError>((devices, report))
            })
            .await;
        self.sample(trace.result("refresh", None));
        {
            let now = self.started.elapsed().as_millis() as u64;
            let mut deadlines = self.refresh_deadlines.lock().unwrap();
            let d = deadlines.entry(retry_key.clone()).or_default();
            if result.is_ok() {
                d.success(now);
            } else {
                d.failed(now, 1);
            }
        }
        {
            let mut failures = self.failures.lock().unwrap();
            if result.is_ok() {
                failures.remove(&retry_key);
            } else {
                let attempts = failures
                    .get(&retry_key)
                    .map(|(_, n)| n + 1)
                    .unwrap_or(1)
                    .min(4);
                failures.insert(
                    retry_key,
                    (
                        Instant::now() + Duration::from_secs((30u64 << attempts).min(300)),
                        attempts,
                    ),
                );
            }
        }
        if self.check_scope(scope).await.is_err() {
            return;
        }
        for pin in pins {
            if !self.store.lock().unwrap().layout.pins.contains_key(&pin.id) {
                continue;
            }
            let previous = self.views.lock().unwrap().get(&pin.id).cloned();
            if previous
                .as_ref()
                .is_some_and(|p| p.revision > revision || p.pending.is_some())
            {
                continue;
            }
            let mut view = previous.unwrap_or(View {
                id: pin.id.clone(),
                home_id: home.into(),
                revision: 0,
                device: None,
                card: None,
                status: None,
                presentation: None,
                control_intent:None,
                group_intent:None,
                pending: None,
                origin: None,
                error: None,
                geometry: pin.geometry.clone(),
            });
            view.revision = self.next();
            match &result {
                Ok((devices, report)) => {
                    let device = devices
                        .iter()
                        .find(|d| {
                            d.did == pin.did
                                && crate::widget_layout::device_fingerprint(d) == pin.fingerprint
                        })
                        .cloned();
                    view.error = if device.is_none() {
                        Some(AppError::new(
                            "deviceUnavailable",
                            "设备不可用，请重新固定。",
                            false,
                        ))
                    } else {
                        None
                    };
                    view.device = device;
                    view.card = report.cards.iter().find(|c| c.did == pin.did).cloned();
                    view.status = report.statuses.iter().find(|s| s.did == pin.did).cloned();
                    view.presentation=report.presentations.iter().find(|p|p.did==pin.did).cloned();
                }
                Err(e) => {
                    view.error = Some(e.clone());
                    if let Some(card) = &mut view.card {
                        card.enabled = false;
                    }
                }
            }
            self.notify(view);
        }
    }
    pub fn publish_presentation(&self,result:&crate::home_cards::presentation::CardControlResult) {
        let views:Vec<_>=self.views.lock().unwrap().values().filter(|v|v.home_id==result.home_id && v.device.as_ref().is_some_and(|d|d.did==result.did)).cloned().collect();
        for mut view in views {
            if result.submitted {view.control_intent=Some(result.clone());view.revision=self.next();self.notify(view);continue;}
            if view.presentation.as_ref().zip(result.presentation.as_ref()).is_some_and(|(a,b)|a.revision>b.revision) {continue;}
            view.presentation=result.presentation.clone();view.card=result.card.clone();view.status=result.status.clone();view.error=None;view.revision=self.next();self.notify(view);
        }
        let _=self.app.emit_to("main","home-card-presentation",result);
    }
    pub fn publish_switch_group(&self,result:&crate::home_cards::switch_group::GroupResult){
        let views:Vec<_>=self.views.lock().unwrap().values().filter(|v|v.home_id==result.home_id&&v.device.as_ref().is_some_and(|d|d.did==result.card.did)).cloned().collect();
        for mut view in views{view.card=Some(result.card.clone());view.group_intent=Some(result.clone());view.revision=self.next();self.notify(view);}
        let _=self.app.emit_to("main","switch-group-result",result);
    }
    pub async fn control(
        &self,
        home: &str,
        did: &str,
        intent: String,
        confirm: bool,
        origin: String,
        pin_binding: Option<Pin>,
    ) -> Result<HomeCardResult> {
        let scope = self.app.state::<AppState>().account_scope().await?;
        let context = self.context(&scope, home).await?;
        let (_, generation) = context.context_identity().await?;
        let device = context
            .context_devices()
            .await?
            .into_iter()
            .find(|d| d.did == did)
            .ok_or_else(AppError::stale)?;
        if pin_binding.as_ref().is_some_and(|p| {
            p.scope != scope
                || p.home_id != home
                || p.did != did
                || p.fingerprint != crate::widget_layout::device_fingerprint(&device)
        }) {
            return Err(AppError::new(
                "deviceUnavailable",
                "设备路由已变化，请重新固定。",
                false,
            ));
        }
        let target = context
            .home_cards_for(home, generation, &[did.into()])
            .await?
            .cards
            .into_iter()
            .find(|c| c.did == did);
        let related = |v: &View| {
            v.home_id == home
                && v.device
                    .as_ref()
                    .is_some_and(|d| d.control_did() == device.control_did())
                && v.card.as_ref().zip(target.as_ref()).is_some_and(|(a, b)| {
                    a.binding.siid == b.binding.siid && a.binding.piid == b.binding.piid
                })
        };
        let key = format!(
            "{scope}\n{home}\n{}\n{:?}",
            device.control_did(),
            target.as_ref().map(|c| (&c.binding.siid, &c.binding.piid))
        );
        // A confirmation is an observation of an existing intent, not a new
        // write. It must never take ownership from a newer queued operation.
        let version = {
            let mut versions = self.operation_versions.lock().unwrap();
            if confirm {
                versions.get(&key).copied().unwrap_or(0)
            } else {
                let version = self.next();
                versions.insert(key.clone(), version);
                version
            }
        };
        let may_publish = !confirm
            || !self
                .views
                .lock()
                .unwrap()
                .values()
                .any(|v| related(v) && v.pending.is_some());
        if !confirm {
            let views: Vec<_> = self
                .views
                .lock()
                .unwrap()
                .values()
                .filter(|v| related(v))
                .cloned()
                .collect();
            for mut view in views {
                if related(&view) {
                    view.pending = Some(intent.clone());
                    view.origin = Some(origin.clone());
                    view.revision = version;
                    self.notify(view);
                }
            }
            if self
                .app
                .state::<Arc<crate::resources::Resources>>()
                .visible("main")
            {
                let _ = self.app.emit_to(
                "main",
                "desktop-card-intent",
                serde_json::json!({"homeId":home,"did":did,"intent":intent,"revision":version,"origin":origin}),
            );
            }
        }
        let confirmation_fields=target.as_ref().map(|c|vec![format!("{}:{}",c.binding.siid,c.binding.piid)]).unwrap_or_default();
        let future = async {
            if crate::camera::category_supported(&device) && matches!(intent.as_str(), "on" | "off")
            {
                let state = context
                    .camera_power(home.into(), generation, did.into())
                    .await?;
                let desired = intent == "on";
                let (verified, actual) = if confirm {
                    (state.awake == Some(desired), state.awake)
                } else {
                    let expected = state.awake.ok_or_else(|| {
                        AppError::new("unavailable", "摄像机状态暂不可用。", true)
                    })?;
                    let changed = context
                        .change_camera_power(home.into(), generation, did.into(), desired, expected)
                        .await?;
                    (changed.confirmed, changed.report.awake)
                };
                context.invalidate_home_card(home, generation, did).await?;
                let report = context
                    .home_cards_for(home, generation, &[did.into()])
                    .await?;
                Ok(HomeCardResult {
                    verified,
                    message: if verified {
                        "设备回读与目标一致。"
                    } else {
                        "操作仍待确认。"
                    }
                    .into(),
                    card: report.cards.into_iter().find(|c| c.did == did),
                    status: report.statuses.into_iter().find(|s| s.did == did),
                    actual: actual.map(|on| if on { "on" } else { "off" }.into()),
                })
            } else {
                context
                    .change_home_card(home.into(), generation, did.into(), intent, confirm)
                    .await
            }
        };
        let trace = crate::mcp_core::metrics::Trace::new("desktop_card_control");
        // UI submissions share a physical-device lane; verification runs outside it.
        // Separate key targets remain independent and no action is replayed.
        let future = Box::pin(future);
        let result = if confirm{trace.scope(context.with_ui_readback(home,generation,did,confirmation_fields,future)).await}else{trace.scope(context.with_ui_control(home,generation,did,future)).await};
        self.sample(trace.result("control", None));
        if self.check_scope(&scope).await.is_err() {
            return Err(AppError::stale());
        }
        if may_publish
            && self
                .operation_versions
                .lock()
                .unwrap()
                .get(&key)
                .copied()
                .unwrap_or(0)
                == version
        {
            let views: Vec<_> = self
                .views
                .lock()
                .unwrap()
                .values()
                .filter(|v| related(v))
                .cloned()
                .collect();
            for mut view in views {
                view.revision = self.next();
                view.pending = None;
                view.origin = Some(origin.clone());
                match &result {
                    Ok(reply) => {
                        if view.device.as_ref().is_some_and(|d| d.did == did) {
                            view.card = reply.card.clone().or(view.card);
                            view.status = reply.status.clone().or(view.status);
                        } else if let Some((own, source)) =
                            view.card.as_mut().zip(reply.card.as_ref())
                        {
                            own.selected = source.selected;
                            own.highlight = source.highlight;
                        }
                        view.error = None;
                    }
                    Err(e) => {
                        view.error = Some(e.clone());
                    }
                }
                self.notify(view);
            }
            if self
                .app
                .state::<Arc<crate::resources::Resources>>()
                .visible("main")
            {
                let _=self.app.emit_to("main","desktop-card-result",serde_json::json!({"homeId":home,"did":did,"revision":version,"result":result.as_ref().ok(),"error":result.as_ref().err()}));
            }
        }
        result
    }
    fn sample(&self, value: serde_json::Value) {
        let mut samples = self.samples.lock().unwrap();
        samples.push_back(value);
        while samples.len() > 32 {
            samples.pop_front();
        }
    }
    pub async fn open(&self, pin: &Pin) -> Result<()> {
        self.check_scope(&pin.scope).await?;
        crate::app_runtime::Runtime::show_async(&self.app, "open").await?;
        self.app
            .emit_to(
                "main",
                "desktop-widget-open",
                serde_json::json!({"homeId":pin.home_id,"did":pin.did}),
            )
            .map_err(crate::app_settings::storage)
    }
    pub fn shutdown(&self) {
        self.stopped.store(true, Ordering::Release);
        platform::stop();
        let labels: Vec<_> = self.hosts.lock().unwrap().keys().cloned().collect();
        for label in labels {
            if let Some(window) = self.app.get_webview_window(&label) {
                let _ = window.destroy();
            }
        }
    }
}

fn main_only(window: &WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err(AppError::new(
            "permissionDenied",
            "此操作仅供主窗口使用。",
            false,
        ))
    }
}
/// Reconcile the host's actual CSS viewport with its monitor's DIP space.
#[tauri::command]
pub async fn desktop_widget_viewport(
    window: WebviewWindow,
    app: tauri::AppHandle,
    css_width: f64,
    reduced_motion: Option<bool>,
) -> Result<hosts::Viewport> {
    let w = app.state::<Arc<Widgets>>();
    w.check_scope(&w.current_scope()?).await?;
    if let Some(reduced) = reduced_motion {
        if w.reduced_motion.swap(reduced, Ordering::AcqRel) != reduced {
            w.schedule_hosts();
        }
    }
    let viewport = w.host_snapshot(&window)?.viewport;
    if !css_width.is_finite() || !(1. ..=32768.).contains(&css_width) {
        return Err(AppError::invalid("组件视口尺寸无效。"));
    }
    if (css_width - viewport.width).abs() > 1.25 {
        let next = (w
            .zooms
            .lock()
            .unwrap()
            .get(window.label())
            .copied()
            .unwrap_or(1.)
            * css_width
            / viewport.width)
            .clamp(0.2, 5.);
        window
            .set_zoom(next)
            .map_err(crate::app_settings::storage)?;
        w.zooms.lock().unwrap().insert(window.label().into(), next);
    }
    if (css_width - viewport.width).abs() <= 1.25 {
        if let Some(host) = w.hosts.lock().unwrap().get_mut(window.label()) {
            host.ready = true;
        }
        platform::show(&window)?;
        let host = w.hosts.lock().unwrap().get(window.label()).cloned();
        if let Some(host) = host {
            w.register_host_targets(&window, &host);
        }
    }
    Ok(viewport)
}
#[tauri::command]
pub async fn desktop_widget_geometry(
    window: WebviewWindow,
    app: tauri::AppHandle,
    widget_id: Option<String>,
    geometry: Option<Geometry>,
    size: Option<crate::preferences::CardSize>,
) -> Result<Geometry> {
    let w = app.state::<Arc<Widgets>>();
    let pin = w.pin_for_window(&window, widget_id.as_deref())?;
    w.check_scope(&pin.scope).await?;
    if w.gestures.lock().unwrap().contains_key(&pin.id) {
        return Err(AppError::new("busy", "请先结束拖动。", true));
    }
    let mut geometry = geometry.unwrap_or_else(|| pin.geometry.clone());
    if let Some(size) = size {
        geometry.size = size;
    }
    let resize = size.is_some() || geometry.size != pin.geometry.size;
    w.commit_drop(&pin.id, &geometry, resize)?;
    let actual = w.store.lock().unwrap().layout.pins[&pin.id]
        .geometry
        .clone();
    w.schedule_hosts();
    if actual.size==crate::preferences::CardSize::Large {w.schedule_refresh(&pin.scope,&pin.home_id);}
    Ok(actual)
}
#[tauri::command]
pub async fn desktop_widget_menu(
    window: WebviewWindow,
    app: tauri::AppHandle,
    rect: Option<crate::widget_layout::MenuRect>,
) -> Result<()> {
    let w = app.state::<Arc<Widgets>>();
    w.check_scope(&w.current_scope()?).await?;
    {
        let mut hosts = w.hosts.lock().unwrap();
        let host = hosts.get_mut(window.label()).ok_or_else(AppError::stale)?;
        host.menu = match rect {
            Some(r) => {
                r.validate(host.viewport.width, host.viewport.height)?;
                Some(crate::widget_layout::PixelRect {
                    x: host.bounds.x + r.x * host.viewport.scale,
                    y: host.bounds.y + r.y * host.viewport.scale,
                    width: r.width * host.viewport.scale,
                    height: r.height * host.viewport.scale,
                })
            }
            None => None,
        };
    }
    let host = w
        .hosts
        .lock()
        .unwrap()
        .get(window.label())
        .cloned()
        .ok_or_else(AppError::stale)?;
    w.register_host_targets(&window, &host);
    Ok(())
}
#[tauri::command]
pub async fn desktop_widget_diagnostics(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<serde_json::Value> {
    main_only(&window)?;
    let w = app.state::<Arc<Widgets>>();
    let support = w.support().await;
    let hosts:Vec<_>=w.hosts.lock().unwrap().iter().filter_map(|(label,h)|app.get_webview_window(label).map(|window|serde_json::json!({"label":label,"cards":h.cards.len(),"viewport":h.viewport,"host":platform::diagnostics(&window)}))).collect();
    Ok(
        serde_json::json!({"supported":support.supported,"hosts":hosts,"monitors":platform::monitors(),"cache":app.state::<AppState>().home_card_metrics(),"samples":*w.samples.lock().unwrap(),"frontend":app.state::<crate::desktop_idle::Idle>().status(),"visibility":crate::resources::visibility_diagnostics(&window),"resources":app.state::<Arc<crate::resources::Resources>>().diagnostics()}),
    )
}
#[tauri::command]
pub async fn desktop_widget_support(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<Support> {
    main_only(&window)?;
    Ok(app.state::<Arc<Widgets>>().support().await)
}
#[tauri::command]
pub async fn desktop_widget_pin(
    window: WebviewWindow,
    app: tauri::AppHandle,
    home_id: String,
    generation: u64,
    did: String,
) -> Result<Support> {
    main_only(&window)?;
    app.state::<Arc<Widgets>>()
        .pin(home_id, generation, did)
        .await
}
#[tauri::command]
pub async fn desktop_widget_unpin(
    window: WebviewWindow,
    app: tauri::AppHandle,
    id: Option<String>,
    widget_id: Option<String>,
) -> Result<()> {
    let w = app.state::<Arc<Widgets>>();
    let id = if window.label() == "main" {
        id.ok_or_else(|| AppError::invalid("请选择组件。"))?
    } else {
        w.pin_for_window(&window, widget_id.as_deref().or(id.as_deref()))?
            .id
    };
    w.unpin(&id).await
}
#[tauri::command]
pub async fn desktop_widget_snapshot(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<HostFrame> {
    let w = app.state::<Arc<Widgets>>();
    w.check_scope(&w.current_scope()?).await?;
    w.host_snapshot(&window)
}
#[tauri::command]
pub async fn desktop_widget_control(
    window: WebviewWindow,
    app: tauri::AppHandle,
    intent: String,
    confirm: Option<bool>,
    home_id: Option<String>,
    did: Option<String>,
    widget_id: Option<String>,
) -> Result<HomeCardResult> {
    let w = app.state::<Arc<Widgets>>();
    let pin = if window.label() == "main" {
        None
    } else {
        Some(w.pin_for_window(&window, widget_id.as_deref())?)
    };
    let (home, did, origin) = if let Some(p) = &pin {
        let view = w
            .views
            .lock()
            .unwrap()
            .get(&p.id)
            .cloned()
            .ok_or_else(AppError::stale)?;
        if view.error.is_some() && !confirm.unwrap_or(false) {
            return Err(AppError::stale());
        }
        (
            p.home_id.clone(),
            p.did.clone(),
            format!("{}:{}", window.label(), p.id),
        )
    } else {
        (
            home_id.ok_or_else(AppError::stale)?,
            did.ok_or_else(AppError::stale)?,
            "main".into(),
        )
    };
    if !matches!(intent.as_str(), "on" | "off" | "open" | "close" | "pause") {
        return Err(AppError::invalid("不支持的卡片操作。"));
    }
    w.control(&home, &did, intent, confirm.unwrap_or(false), origin, pin)
        .await
}
#[tauri::command]
pub async fn desktop_widget_open(
    window: WebviewWindow,
    app: tauri::AppHandle,
    widget_id: Option<String>,
) -> Result<()> {
    let w = app.state::<Arc<Widgets>>();
    let pin = w.pin_for_window(&window, widget_id.as_deref())?;
    w.open(&pin).await
}
#[tauri::command]
pub async fn desktop_widget_switch_group(window:WebviewWindow,app:tauri::AppHandle,widget_id:String,group_id:String,on:bool,request_id:String,confirm_only:Option<bool>)->Result<crate::home_cards::switch_group::GroupResult>{
    let w=app.state::<Arc<Widgets>>();let pin=w.pin_for_window(&window,Some(&widget_id))?;w.check_scope(&pin.scope).await?;
    let context=w.context(&pin.scope,&pin.home_id).await?;let (_,generation)=context.context_identity().await?;
    if !context.context_devices().await?.iter().any(|d|d.did==pin.did&&crate::widget_layout::device_fingerprint(d)==pin.fingerprint){return Err(AppError::stale());}
    let result=if confirm_only.unwrap_or(false){context.confirm_switch_group(pin.home_id.clone(),generation,pin.did.clone(),group_id,on,request_id).await?}else{context.with_ui_control_key(&pin.home_id,generation,&pin.did,Some(format!("group:{group_id}")),async{context.change_switch_group(pin.home_id.clone(),generation,pin.did.clone(),group_id,on,request_id).await}).await?};
    w.check_scope(&pin.scope).await?;w.publish_switch_group(&result);Ok(result)
}
#[tauri::command]
pub async fn desktop_widget_card_control(window:WebviewWindow,app:tauri::AppHandle,widget_id:String,change:crate::home_cards::presentation::CardControlChange)->Result<crate::home_cards::presentation::CardControlResult>{
    let w=app.state::<Arc<Widgets>>();let pin=w.pin_for_window(&window,Some(&widget_id))?;
    if pin.geometry.size!=crate::preferences::CardSize::Large {return Err(AppError::stale());}
    if !change.confirm_only&&w.views.lock().unwrap().get(&pin.id).is_none_or(|v|v.error.is_some()) {return Err(AppError::stale());}
    w.check_scope(&pin.scope).await?;
    let context=w.context(&pin.scope,&pin.home_id).await?;let (_,generation)=context.context_identity().await?;
    if !context.context_devices().await?.iter().any(|d|d.did==pin.did&&crate::widget_layout::device_fingerprint(d)==pin.fingerprint){return Err(AppError::stale());}
    let field=if change.value.is_boolean()||change.value.is_number(){Some(format!("template:{}:{}",change.template_id,change.control_id))}else{None};
    let result=if change.confirm_only{context.change_home_card_control(pin.home_id.clone(),generation,pin.did.clone(),change).await?}else{context.with_ui_control_key(&pin.home_id,generation,&pin.did,field,async{context.change_home_card_control(pin.home_id.clone(),generation,pin.did.clone(),change).await}).await?};
    w.check_scope(&pin.scope).await?;
    if w.store.lock().unwrap().layout.pins.get(&widget_id).is_none_or(|current|current.scope!=pin.scope||current.home_id!=pin.home_id||current.fingerprint!=pin.fingerprint){return Err(AppError::stale());}
    w.publish_presentation(&result);Ok(result)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct GestureChange {
    phase: String,
    #[serde(rename = "kind")]
    _kind: Option<String>,
}
pub(super) fn start_native_gesture(
    app: tauri::AppHandle,
    owner: String,
    id: String,
    session: platform::PointerSession,
    kind: String,
) {
    let token = session.token();
    let w = app.state::<Arc<Widgets>>();
    let pin = w.store.lock().unwrap().layout.pins.get(&id).cloned();
    let Some(pin) = pin.filter(|p| w.current_scope().ok().as_ref() == Some(&p.scope)) else {
        platform::cancel_native(token);
        return;
    };
    tauri::async_runtime::spawn(async move {
        let w = app.state::<Arc<Widgets>>();
        let _flight = w.gesture_flight.lock().await;
        let initial = w
            .hosts
            .lock()
            .unwrap()
            .get(&owner)
            .and_then(|h| {
                h.cards
                    .iter()
                    .find(|c| c.interactive && c.view.id == id)
                    .map(|c| c.view.geometry.clone())
            })
            .unwrap_or_else(|| {
                w.store
                    .lock()
                    .unwrap()
                    .layout
                    .pins
                    .get(&id)
                    .map(|p| p.geometry.clone())
                    .unwrap_or_else(|| pin.geometry.clone())
            });
        app.state::<Arc<crate::resources::Resources>>()
            .prepare_widgets(&app);
        let layout = w.store.lock().unwrap().layout.clone();
        let mut active = false;
        let mut cancelled = false;
        let mut last = None;
        let mut cadence = tokio::time::interval(Duration::from_millis(16));
        cadence.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        loop {
            cadence.tick().await;
            let (down, cancel, held) = session.status();
            if cancel
                || w.stopped.load(Ordering::Acquire)
                || w.check_scope(&pin.scope).await.is_err()
                || !w.store.lock().unwrap().layout.pins.contains_key(&id)
            {
                cancelled = true;
                break;
            }
            if !down && !held {
                break;
            }
            if !active && held {
                let mut gestures = w.gestures.lock().unwrap();
                if !gestures.is_empty() {
                    cancelled = true;
                    break;
                }
                let Ok(geometry) = platform::fit_geometry(&initial) else {
                    cancelled = true;
                    break;
                };
                let Ok(mut native) = platform::begin(&geometry, &kind) else {
                    cancelled = true;
                    break;
                };
                if !platform::activate_native(&mut native, &session) {
                    break;
                }
                gestures.insert(
                    id.clone(),
                    Drag {
                        owner: owner.clone(),
                        native,
                        geometry,
                    },
                );
                active = true;
                let _ = app.emit_to(
                    &owner,
                    "desktop-widget-gesture",
                    serde_json::json!({"widgetId":id,"phase":"started","kind":kind,"sequence":token}),
                );
            }
            if !down {
                break;
            }
            if active {
                let next = {
                    let mut gestures = w.gestures.lock().unwrap();
                    gestures
                        .get_mut(&id)
                        .filter(|d| d.owner == owner)
                        .and_then(|d| {
                            let g = match platform::grid_movement(&mut d.native, &layout) {
                                Ok(g) => g,
                                Err(e) => {
                                    let _ = app.emit_to("main", "desktop-widget-error", e);
                                    return None;
                                }
                            };
                            d.geometry = g.clone();
                            Some((g, platform::gesture_preview(&d.native)))
                        })
                };
                let Some(next) = next else {
                    cancelled = true;
                    break;
                };
                if last.as_ref() != Some(&next) || w.previews.lock().unwrap().active() {
                    last = Some(next);
                    // The pointer cadence already coalesces movement. Do not
                    // add the ordinary host scheduler's second 16 ms delay.
                    if let Err(e) = w.sync_hosts().await {
                        let _ = app.emit_to("main", "desktop-widget-error", e);
                    }
                }
            }
        }
        if active {
            let drag = w.gestures.lock().unwrap().remove(&id);
            if !cancelled {
                if let Some(mut d) = drag.filter(|d| platform::drop_allowed(&d.native)) {
                    if let Ok(g) = platform::grid_movement(&mut d.native, &layout) {
                        if let Err(e) = w.commit_drop(&id, &g, false) {
                            if e.kind != "desktopGridOccupied" {
                                let _ = app.emit_to("main", "desktop-widget-error", e);
                            }
                        }
                    }
                }
            }
            // Publish the committed/rolled-back terminal position before the
            // renderer releases its drag state or another press can start.
            if let Err(e) = w.sync_hosts().await {
                let _ = app.emit_to("main", "desktop-widget-error", e);
            }
        }
        platform::cancel_native(token);
        let _ = app.emit_to(
            &owner,
            "desktop-widget-gesture",
            serde_json::json!({"widgetId":id,"phase":if active{"ended"}else{"tap"},"kind":kind,"sequence":token}),
        );
    });
}
#[tauri::command]
pub async fn desktop_widget_gesture(
    window: WebviewWindow,
    app: tauri::AppHandle,
    widget_id: Option<String>,
    change: GestureChange,
) -> Result<Geometry> {
    let w = app.state::<Arc<Widgets>>();
    let pin = w.pin_for_window(&window, widget_id.as_deref())?;
    w.check_scope(&pin.scope).await?;
    if change.phase == "cancel" {
        w.gestures.lock().unwrap().remove(&pin.id);
        w.schedule_hosts();
    } else if change.phase != "arm" {
        return Err(AppError::invalid("桌面拖动由原生输入接管。"));
    }
    Ok(pin.geometry)
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct InputRegion {
    kind: String,
    x: f64,
    y: f64,
    width: f64,
    height: f64,
}
#[tauri::command]
pub async fn desktop_widget_regions(
    window: WebviewWindow,
    app: tauri::AppHandle,
    widget_id: String,
    width: f64,
    height: f64,
    regions: Vec<InputRegion>,
    presentation: Option<crate::widget_layout::MenuRect>,
) -> Result<()> {
    let w = app.state::<Arc<Widgets>>();
    w.pin_for_window(&window, Some(&widget_id))?;
    if !width.is_finite()
        || !height.is_finite()
        || width <= 0.
        || height <= 0.
        || regions.len() > 16
    {
        return Err(AppError::invalid("卡片输入区域无效。"));
    }
    let mut normalized = vec![];
    for r in regions {
        if !["body", "control"].contains(&r.kind.as_str())
            || ![r.x, r.y, r.width, r.height].iter().all(|v| v.is_finite())
            || r.x < 0.
            || r.y < 0.
            || r.width < 0.
            || r.height < 0.
            || r.x + r.width > width + 1.
            || r.y + r.height > height + 1.
        {
            return Err(AppError::invalid("卡片输入区域无效。"));
        }
        normalized.push((
            r.kind,
            crate::widget_layout::PixelRect {
                x: r.x / width,
                y: r.y / height,
                width: r.width / width,
                height: r.height / height,
            },
        ));
    }
    let physical = if let Some(r) = presentation {
        let hosts = w.hosts.lock().unwrap();
        let h = hosts.get(window.label()).ok_or_else(AppError::stale)?;
        r.validate(h.viewport.width, h.viewport.height)?;
        Some(crate::widget_layout::PixelRect {
            x: h.bounds.x + r.x * h.viewport.scale,
            y: h.bounds.y + r.y * h.viewport.scale,
            width: r.width * h.viewport.scale,
            height: r.height * h.viewport.scale,
        })
    } else {
        None
    };
    platform::set_regions(window.label(), &widget_id, normalized, physical)
}
