//! App-owned visibility policy. No device writes and no independent device cache.
use crate::{
    error::{AppError, Result},
    idle_policy::IdlePolicy,
    resource_policy::{keep_main_webview_awake, monitor_background, ResourceState},
    widget_layout::PixelRect,
};
use std::{
    collections::{HashMap, HashSet},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager, WebviewWindow};
#[cfg(windows)]
#[path = "resource_windows.rs"]
mod native;

struct Entry {
    state: ResourceState,
    idle: Arc<Mutex<IdlePolicy>>,
    cards: HashSet<String>,
    ready: bool,
    waking: bool,
}
pub struct Resources {
    states: Mutex<HashMap<String, Entry>>,
    started: Instant,
    revision: AtomicU64,
    pub(crate) changed: tokio::sync::Notify,
    scans: AtomicU64,
    transitions: AtomicU64,
    stopped: AtomicBool,
}
impl Resources {
    pub fn install(app: &tauri::AppHandle) {
        let this = Arc::new(Self {
            states: Mutex::new(HashMap::new()),
            started: Instant::now(),
            revision: AtomicU64::new(1),
            changed: tokio::sync::Notify::new(),
            scans: AtomicU64::new(0),
            transitions: AtomicU64::new(0),
            stopped: AtomicBool::new(false),
        });
        app.manage(this.clone());
        #[cfg(windows)]
        native::events(Arc::downgrade(&this));
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut timer = tokio::time::interval(Duration::from_secs(1));
            timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
            loop {
                tokio::select! {
                    _ = timer.tick() => {},
                    _ = this.changed.notified() => {
                        tokio::time::sleep(Duration::from_millis(60)).await;
                        // A scan consumes the entire burst, including hints
                        // queued during the debounce window.
                        use std::future::Future;
                        let pending = this.changed.notified();
                        tokio::pin!(pending);
                        let _ = std::future::poll_fn(|cx| std::task::Poll::Ready(pending.as_mut().poll(cx))).await;
                        timer.reset();
                    }
                }
                if this.stopped.load(Ordering::Acquire) {
                    break;
                }
                this.tick(&app);
            }
        });
    }
    pub fn visible(&self, label: &str) -> bool {
        self.states
            .lock()
            .unwrap()
            .get(label)
            .is_none_or(|e| e.state.visible)
    }
    pub fn ready(&self, label: &str) -> bool {
        self.states
            .lock()
            .unwrap()
            .get(label)
            .is_none_or(|e| e.state.visible && e.ready)
    }
    pub fn mark_ready(&self, label: &str) {
        if let Some(e) = self.states.lock().unwrap().get_mut(label) {
            e.ready = e.state.visible;
            e.waking = false;
        }
    }
    fn claim_host_wake(&self, label: &str) -> Option<Arc<Mutex<IdlePolicy>>> {
        let mut states = self.states.lock().unwrap();
        let entry = states.get_mut(label)?;
        if !entry.state.visible || entry.ready || entry.waking { return None; }
        entry.waking = true;
        Some(entry.idle.clone())
    }
    fn finish_host_wake(&self, label: &str, token: &Arc<Mutex<IdlePolicy>>, ready: bool) -> bool {
        let mut states = self.states.lock().unwrap();
        let Some(entry) = states.get_mut(label) else { return false; };
        if !Arc::ptr_eq(token, &entry.idle) { return false; }
        entry.waking = false;
        ready && entry.state.visible
    }
    pub fn forget(&self, label: &str) {
        self.states.lock().unwrap().remove(label);
        self.changed.notify_one();
    }
    pub fn card_visible(&self, id: &str) -> bool {
        self.states
            .lock()
            .unwrap()
            .values()
            .find(|e| e.cards.contains(id))
            .is_none_or(|e| {
                e.state
                    .visible_cards
                    .as_ref()
                    .is_none_or(|ids| ids.iter().any(|i| i == id))
            })
    }
    pub fn state(&self, label: &str) -> ResourceState {
        self.states
            .lock()
            .unwrap()
            .get(label)
            .map(|e| e.state.clone())
            .unwrap_or_else(|| ResourceState::new(0, true))
    }
    pub fn diagnostics(&self) -> serde_json::Value {
        let entries = self.states.lock().unwrap();
        serde_json::json!({"scans":self.scans.load(Ordering::Relaxed),"transitions":self.transitions.load(Ordering::Relaxed),"windows":entries.iter().map(|(label,e)|serde_json::json!({"label":label,"inputReady":e.ready,"policy":e.state,"idle":*e.idle.lock().unwrap()})).collect::<Vec<_>>()})
    }
    pub fn prepare_widgets(self: &Arc<Self>, app: &tauri::AppHandle) {
        self.tick(app);
    }
    pub fn wake_hint(&self) {
        self.changed.notify_one();
    }
    pub fn stop(&self) {
        self.stopped.store(true, Ordering::Release);
        self.changed.notify_one();
        #[cfg(windows)]
        native::stop();
    }
    fn tick(self: &Arc<Self>, app: &tauri::AppHandle) {
        self.scans.fetch_add(1, Ordering::Relaxed);
        let widgets = app.try_state::<Arc<crate::desktop_widgets::Widgets>>();
        let mut targets = widgets
            .as_ref()
            .map(|w| w.resource_targets())
            .unwrap_or_default();
        if let Some(main) = app.get_webview_window("main") {
            targets.push(("main".into(), vec![], false));
            drop(main);
        }
        let runtime = app.state::<crate::app_runtime::Runtime>();
        if let Some(label) = runtime.detached_monitor.label() {
            targets.push((label, vec![], false));
        }
        let labels: HashSet<_> = targets.iter().map(|(l, _, _)| l.clone()).collect();
        self.states
            .lock()
            .unwrap()
            .retain(|l, _| labels.contains(l));
        #[cfg(windows)]
        let scene = if targets.iter().any(|(label, _, _)| {
            app.get_webview_window(label).is_some_and(|w| {
                w.is_visible().unwrap_or(true) && !w.is_minimized().unwrap_or(false)
            })
        }) {
            let regions: Vec<_> = targets
                .iter()
                .flat_map(|(label, rects, _)| {
                    if rects.is_empty() {
                        app.get_webview_window(label)
                            .and_then(|w| native::Scene::target(&w))
                            .into_iter()
                            .collect::<Vec<_>>()
                    } else {
                        rects.iter().map(|(_, r)| *r).collect()
                    }
                })
                .collect();
            native::Scene::capture_for(&regions)
        } else {
            native::Scene::unknown()
        };
        let desktop_hover = widgets.as_ref().and_then(|w| w.desktop_hover_target());
        for (label, rects, busy) in targets {
            let Some(window) = app.get_webview_window(&label) else {
                continue;
            };
            let regions: Vec<_> = rects.iter().map(|(_, r)| *r).collect();
            #[cfg(windows)]
            let hovered = desktop_hover
                .as_ref()
                .is_some_and(|(owner, _)| owner == &label);
            #[cfg(windows)]
            let visible = (label != "main" && busy) || hovered || scene.visible(&window, &regions);
            #[cfg(not(windows))]
            let visible =
                window.is_visible().unwrap_or(true) && !window.is_minimized().unwrap_or(false);
            let detached = crate::detached_monitor::DetachedMonitor::is_label(&label);
            let monitor_background = (label == "main" || detached).then(|| {
                #[cfg(windows)]
                let locked = scene.locked();
                #[cfg(not(windows))]
                let locked = false;
                monitor_background(
                    window.is_visible().unwrap_or(true),
                    window.is_minimized().unwrap_or(false),
                    locked,
                )
            });
            let visible_cards = if label == "main" || detached {
                None
            } else {
                Some(
                    rects
                        .iter()
                        .filter(|(_id, r)| {
                            #[cfg(windows)]
                            {
                                (busy && label != "main")
                                    || desktop_hover
                                        .as_ref()
                                        .is_some_and(|(owner, id)| owner == &label && id == _id)
                                    || scene.visible(&window, &[*r])
                            }
                            #[cfg(not(windows))]
                            {
                                visible
                            }
                        })
                        .map(|(id, _)| id.clone())
                        .collect::<Vec<_>>(),
                )
            };
            let now = self.started.elapsed().as_millis() as u64;
            let card_ids: HashSet<_> = rects.iter().map(|(id, _)| id.clone()).collect();
            let (changed, idle) = {
                let mut states = self.states.lock().unwrap();
                let entry = states.entry(label.clone()).or_insert_with(|| Entry {
                    state: ResourceState::new(0, true),
                    idle: Arc::new(Mutex::new(IdlePolicy::default())),
                    cards: HashSet::new(),
                    ready: true,
                    waking: false,
                });
                let changed = entry.state.revision == 0
                    || entry.state.visible != visible
                    || entry.state.visible_cards != visible_cards
                    || entry.state.monitor_background != monitor_background;
                if changed {
                    if !visible {
                        entry.ready = false;
                    }
                    entry.state =
                        ResourceState::new(self.revision.fetch_add(1, Ordering::AcqRel), visible);
                    entry.state.visible_cards = visible_cards;
                    entry.state.monitor_background = monitor_background;
                }
                entry.cards = card_ids;
                (changed, entry.idle.clone())
            };
            if let Some(background) = monitor_background {
                if detached {
                    runtime.detached_monitor.set_background(&label, background);
                } else if let Some(state) = app.try_state::<crate::state::AppState>() {
                    state.set_monitor_background(background);
                }
            }
            if changed {
                self.transitions.fetch_add(1, Ordering::Relaxed);
                let _ = app.emit_to(&label, "desktop-resource-state", self.state(&label));
            }
            if let Some(background) = monitor_background {
                if detached { continue; }
                let monitoring = app
                    .state::<crate::app_runtime::Runtime>()
                    .monitor
                    .load(Ordering::Acquire);
                crate::desktop_idle::Idle::observe(
                    app,
                    keep_main_webview_awake(visible, monitoring, background),
                );
                if changed && visible {
                    if let Some(w) = widgets.as_ref() {
                        w.resource_resumed(&label);
                    }
                }
                continue;
            }
            let (wake, attempt) = {
                let mut p = idle.lock().unwrap();
                let wake = p.visibility(visible, now);
                p.report(!busy, now);
                (wake, p.attempt(now))
            };
            if wake || visible && !self.ready(&label) {
                if let Some(token) = self.claim_host_wake(&label) {
                    resume_host(app, &window, token);
                }
            }
            if let Some(epoch) = attempt {
                suspend_host(app, &window, idle, epoch);
            }
            if changed {
                if let Some(w) = widgets.as_ref() {
                    w.resource_changed(&label, visible);
                }
            }
        }
    }
}

#[tauri::command]
pub fn desktop_resource_snapshot(
    window: WebviewWindow,
    app: tauri::AppHandle,
) -> Result<ResourceState> {
    if window.label() != "main"
        && app.state::<crate::app_runtime::Runtime>().detached_monitor.viewer(window.label()).is_err()
        && !app
            .state::<Arc<crate::desktop_widgets::Widgets>>()
            .owns_host(window.label())
    {
        return Err(AppError::new(
            "permissionDenied",
            "窗口不可访问资源策略。",
            false,
        ));
    }
    Ok(app.state::<Arc<Resources>>().state(window.label()))
}
#[cfg(windows)]
pub fn visibility_diagnostics(window: &WebviewWindow) -> serde_json::Value {
    native::Scene::capture().diagnostics(window)
}
#[cfg(not(windows))]
pub fn visibility_diagnostics(_: &WebviewWindow) -> serde_json::Value {
    serde_json::json!({"nativeOcclusion":false})
}

#[cfg(windows)]
fn resume_host(app: &tauri::AppHandle, window: &WebviewWindow, token: Arc<Mutex<IdlePolicy>>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let label = window.label().to_owned();
    if window
        .with_webview(move |w| unsafe {
            if let Ok(c) = w.controller().CoreWebView2() {
                if let Ok(m) = c.cast::<ICoreWebView2_19>() {
                    let _ =
                        m.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
                }
                if let Ok(s) = c.cast::<ICoreWebView2_3>() {
                    let _ = s.Resume();
                }
            }
            let _ = w.controller().SetIsVisible(true);
            let _ = tx.send(());
        })
        .is_ok()
    {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let received = matches!(tokio::time::timeout(Duration::from_secs(4), rx).await, Ok(Ok(())));
            if app.state::<Arc<Resources>>().finish_host_wake(&label, &token, received) {
                if let Some(w) = app.try_state::<Arc<crate::desktop_widgets::Widgets>>() {
                    w.resource_resumed(&label);
                }
            }
        });
    } else {
        app.state::<Arc<Resources>>().finish_host_wake(window.label(), &token, false);
    }
}
#[cfg(not(windows))]
fn resume_host(app: &tauri::AppHandle, window: &WebviewWindow, token: Arc<Mutex<IdlePolicy>>) {
    if app.state::<Arc<Resources>>().finish_host_wake(window.label(), &token, true) {
        if let Some(w) = app.try_state::<Arc<crate::desktop_widgets::Widgets>>() {
            w.resource_resumed(window.label());
        }
    }
}
#[cfg(windows)]
fn suspend_host(
    app: &tauri::AppHandle,
    window: &WebviewWindow,
    idle: Arc<Mutex<IdlePolicy>>,
    epoch: u64,
) {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, TrySuspendCompletedHandler};
    use windows::core::Interface;
    let app = app.clone();
    let label = window.label().to_owned();
    let on_error = idle.clone();
    let started = app.state::<Arc<Resources>>().started;
    if window.with_webview(move |w| unsafe {
        if idle.lock().unwrap().epoch != epoch || app.state::<Arc<Resources>>().visible(&label) {
            return;
        }
        let result = (|| -> windows::core::Result<()> {
            let core = w.controller().CoreWebView2()?;
            if let Ok(memory) = core.cast::<ICoreWebView2_19>() {
                let _ =
                    memory.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
            }
            let lifecycle = match core.cast::<ICoreWebView2_3>() {
                Ok(lifecycle) => lifecycle,
                Err(error) => {
                    idle.lock().unwrap().unsupported = true;
                    return Err(error);
                }
            };
            w.controller().SetIsVisible(false)?;
            let p = idle.clone();
            let recovery = lifecycle.clone();
            let started = app.state::<Arc<Resources>>().started;
            let callback =
                TrySuspendCompletedHandler::create(Box::new(move |result, suspended| {
                    let accepted = p.lock().unwrap().complete(
                        epoch,
                        result.is_ok() && suspended,
                        started.elapsed().as_millis() as u64,
                    );
                    if !accepted {
                        let _ = recovery.Resume();
                    }
                    Ok(())
                }));
            lifecycle.TrySuspend(&callback)
        })();
        if result.is_err() {
            idle.lock().unwrap().complete(
                epoch,
                false,
                app.state::<Arc<Resources>>().started.elapsed().as_millis() as u64,
            );
        }
    }).is_err() {
        on_error.lock().unwrap().complete(epoch, false, started.elapsed().as_millis() as u64);
    }
}
#[cfg(not(windows))]
fn suspend_host(_: &tauri::AppHandle, _: &WebviewWindow, _: Arc<Mutex<IdlePolicy>>, _: u64) {}
