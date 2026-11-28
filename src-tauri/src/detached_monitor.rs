use crate::{
    app_runtime::Runtime,
    app_settings::StartupTarget,
    error::{AppError, Result},
    state::AppState,
};
use std::{
    ops::Deref,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
};
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder};

pub(crate) struct Viewer {
    label: String,
    pub(crate) home_id: Option<String>,
    account_epoch: u64,
    alive: Arc<AtomicBool>,
    state: Arc<AppState>,
}

#[derive(Default)]
pub(crate) struct DetachedMonitor {
    active: Mutex<Option<Arc<Viewer>>>,
    opening: tokio::sync::Mutex<()>,
}

impl DetachedMonitor {
    pub(crate) fn is_label(label: &str) -> bool {
        label.starts_with("monitor-")
    }

    pub(crate) async fn enter_inline(&self, runtime: &Runtime) -> Result<()> {
        let _opening = self.opening.lock().await;
        self.check_inline(runtime)?;
        runtime.monitor.store(true, Ordering::Release);
        Ok(())
    }

    pub(crate) fn check_inline(&self, runtime: &Runtime) -> Result<()> {
        if self.label().is_some() || runtime.is_exiting() {
            return Err(AppError::new("monitorWindowOpen", "监控窗口已打开。", false));
        }
        Ok(())
    }

    pub(crate) fn label(&self) -> Option<String> {
        self.active.lock().ok()?.as_ref().map(|view| view.label.clone())
    }

    pub(crate) fn viewer(&self, label: &str) -> Result<Arc<Viewer>> {
        self.active.lock().map_err(|_| AppError::stale())?
            .as_ref().filter(|v| v.label == label).cloned().ok_or_else(AppError::stale)
    }

    pub(crate) fn set_background(&self, label: &str, background: bool) {
        if let Ok(viewer) = self.viewer(label) {
            viewer.state.set_monitor_background(background);
        }
    }

    pub(crate) fn focus(&self, app: &AppHandle) -> Option<String> {
        let label = self.label()?;
        focus_window(&app.get_webview_window(&label)?).ok()?;
        Some(label)
    }

    // Called from asynchronous commands and deferred tray callbacks. On Windows
    // WebView2 creation must not block the native event loop that creates it.
    pub(crate) async fn open(&self, app: &AppHandle, target: StartupTarget) -> Result<Option<String>> {
        let _opening = self.opening.lock().await;
        let runtime = app.state::<Runtime>();
        if runtime.is_exiting() {
            return Err(AppError::stale());
        }
        if let Some(label) = self.focus(app) {
            return Ok(Some(label));
        }
        if let Some(label) = self.label() {
            if app.get_webview_window(&label).is_some() {
                return Err(unavailable());
            }
            self.remove(app, |view| view.label == label);
        }
        if !runtime.settings.desktop_options().monitor_separate_window
            || runtime.monitor.load(Ordering::Acquire)
        {
            return Ok(None);
        }
        let (scope, home_id) = match target {
            StartupTarget::Home(home) if !home.home_id.is_empty() && home.home_id.len() <= 256 => {
                (home.scope, Some(home.home_id))
            }
            StartupTarget::All { scope, all_homes: true } => (scope, None),
            _ => return Err(AppError::invalid("请选择要监控的家庭。")),
        };
        let label = format!("monitor-{}", uuid::Uuid::new_v4());
        let alive = Arc::new(AtomicBool::new(true));
        let (state, account_epoch) = Box::pin(app.state::<AppState>()
            .detached_monitor_context(&label, &scope, home_id.as_deref(), alive.clone())).await?;
        let viewer = Arc::new(Viewer {
            label: label.clone(),
            home_id,
            account_epoch,
            alive,
            state: Arc::new(state),
        });
        *self.active.lock().map_err(|_| AppError::stale())? = Some(viewer.clone());
        let result = async {
            viewer.state.sync_detached_monitor_login().await?;
            if runtime.is_exiting() || !viewer.alive.load(Ordering::Acquire) {
                return Err(AppError::stale());
            }
            let (width, height) = initial_size(app);
            let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::App("monitor.html".into()))
                .title("米家监控")
                .inner_size(width, height)
                .min_inner_size(width.min(480.0), height.min(360.0))
                .center()
                .decorations(false)
                .visible(false);
            let window = builder.build().map_err(|_| unavailable())?;
            if let Some(icon) = app.default_window_icon() {
                let _ = window.set_icon(icon.clone());
            }
            #[cfg(windows)]
            if crate::monitor_window::set(&window, true).await.is_err() {
                let _ = window.destroy();
                return Err(unavailable());
            }
            if runtime.is_exiting() || !viewer.alive.load(Ordering::Acquire) {
                let _ = window.destroy();
                return Err(AppError::stale());
            }
            let _ = app.emit_to("main", "desktop-monitor-window-changed", ());
            app.state::<Arc<crate::resources::Resources>>().wake_hint();
            Ok(Some(label.clone()))
        }.await;
        if result.is_err() {
            self.remove(app, |v| v.label == label);
        }
        result
    }

    fn remove(&self, app: &AppHandle, matches: impl FnOnce(&Viewer) -> bool) -> Option<Arc<Viewer>> {
        let view = {
            let mut active = self.active.lock().ok()?;
            if !active.as_ref().is_some_and(|v| matches(v)) {
                return None;
            }
            let view = active.take()?;
            view.alive.store(false, Ordering::Release);
            view
        };
        view.state.stop_camera_sessions();
        crate::camera_decode::close_for_window(&view.label);
        if let Some(resources) = app.try_state::<Arc<crate::resources::Resources>>() {
            resources.forget(&view.label);
        }
        let _ = app.emit_to("main", "desktop-monitor-window-changed", ());
        Some(view)
    }

    pub(crate) fn destroyed(&self, app: &AppHandle, label: &str) {
        self.remove(app, |v| v.label == label);
    }

    pub(crate) fn account_ended(&self, app: &AppHandle, epoch: u64) {
        if let Some(view) = self.remove(app, |v| v.account_epoch == epoch) {
            if let Some(window) = app.get_webview_window(&view.label) {
                let _ = window.destroy();
            }
        }
    }

    pub(crate) async fn shutdown(&self, app: &AppHandle) {
        if let Some(view) = self.remove(app, |_| true) {
            if let Some(window) = app.get_webview_window(&view.label) {
                let _ = window.destroy();
            }
            view.state.finish_camera_sessions().await;
        }
    }
}

fn unavailable() -> AppError {
    AppError::new("windowUnavailable", "无法打开监控窗口，请重试。", true)
}

fn initial_size(app: &AppHandle) -> (f64, f64) {
    let monitor = app.primary_monitor().ok().flatten();
    let width = monitor.as_ref().map_or(1120.0_f64, |monitor| {
        let work = monitor.work_area().size;
        let scale = monitor.scale_factor();
        (f64::from(work.width).min(f64::from(work.height) * 16.0 / 9.0) / scale - 24.0)
            .clamp(1.0, 1120.0)
    });
    (width, (width * 9.0 / 16.0).max(1.0))
}

fn focus_window(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_minimized()? {
        window.unminimize()?;
    }
    window.show()?;
    window.set_focus()
}

pub(crate) enum MediaState<'a> {
    Main(tauri::State<'a, AppState>),
    Detached(Arc<AppState>),
}

impl Deref for MediaState<'_> {
    type Target = AppState;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Main(state) => state.inner(),
            Self::Detached(state) => state,
        }
    }
}

pub(crate) async fn media_state<'a>(app: &'a AppHandle, label: &str) -> Result<MediaState<'a>> {
    match label {
        "main" => Ok(MediaState::Main(app.state())),
        label if DetachedMonitor::is_label(label) => {
            let state = app.state::<Runtime>().detached_monitor.viewer(label)?.state.clone();
            state.sync_detached_monitor_login().await?;
            Ok(MediaState::Detached(state))
        }
        _ => Err(AppError::stale()),
    }
}

#[tauri::command]
pub async fn open_detached_monitor(window: WebviewWindow, target: StartupTarget) -> Result<Option<String>> {
    let app = window.app_handle();
    app.state::<Runtime>().detached_monitor.open(app, target).await
}

#[tauri::command]
pub fn detached_monitor_status(app: AppHandle) -> Option<String> {
    app.state::<Runtime>().detached_monitor.label()
}

#[tauri::command]
pub async fn close_detached_monitor(window: WebviewWindow, label: String) -> Result<()> {
    let app = window.app_handle();
    if app.state::<Runtime>().detached_monitor.viewer(&label).is_ok() {
        if let Some(view) = app.get_webview_window(&label) {
            view.close().map_err(|_| unavailable())?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn focus_camera_view(window: WebviewWindow, home_id: String, generation: u64, did: String) -> Result<bool> {
    let app = window.app_handle();
    let state = media_state(app, window.label()).await?;
    state.validate_camera_decoder(&home_id, generation, &did).await?;
    let Some(owner) = state.current_media_owner(&did).filter(|owner| owner != window.label()) else {
        return Ok(false);
    };
    let Some(view) = app.get_webview_window(&owner) else {
        return Ok(false);
    };
    media_state(app, &owner).await?;
    if state.current_media_owner(&did).as_deref() != Some(owner.as_str()) {
        return Ok(false);
    }
    if DetachedMonitor::is_label(&owner) {
        focus_window(&view).map_err(|_| unavailable())?;
        let _ = app.emit_to(&owner, "desktop-monitor-focus-camera", did);
    } else {
        Runtime::show_async(app, "open").await?;
    }
    Ok(true)
}

// The separate page has no ordinary account, device, desktop-card or update IPC.
fn allows(command: &str) -> bool {
    matches!(command,
        "desktop_resource_snapshot" | "monitor_catalog" | "create_monitor_all" |
        "read_monitor_all" | "retry_monitor_all" | "stop_monitor_all" |
        "monitor_detail_open" | "monitor_detail_command" | "monitor_detail_microphone" |
        "monitor_detail_close" | "monitor_command" | "monitor_screenshot" |
        "camera_power" | "change_camera_power" | "camera_auxiliary" | "change_camera_auxiliary" |
        "camera_care" | "camera_care_thumbnail" | "camera_care_video" | "camera_care_video_part" |
        "camera_care_video_close" | "camera_cloud_save" | "camera_media_folder" | "focus_camera_view" |
        "camera_decode_open" | "camera_decode_viewport" | "camera_decode_feed" |
        "camera_decode_finish" | "camera_decode_ack" | "camera_decode_close")
}

pub(crate) fn guard(
    handler: impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static,
) -> impl Fn(tauri::ipc::Invoke) -> bool + Send + Sync + 'static {
    move |invoke| {
        if DetachedMonitor::is_label(invoke.message.webview_ref().label()) && !allows(invoke.message.command()) {
            invoke.resolver.reject(AppError::invalid("此窗口无法执行该操作。"));
            return true;
        }
        handler(invoke)
    }
}

#[cfg(test)]
mod tests {
    use super::allows;
    #[test]
    fn only_scoped_monitor_and_media_commands_are_admitted() {
        for command in ["monitor_catalog", "create_monitor_all", "camera_decode_open", "focus_camera_view"] {
            assert!(allows(command));
        }
        for command in ["select_home", "logout", "set_property", "start_camera", "application_settings",
            "change_desktop_option", "open_detached_monitor", "change_monitor_selection", "start_app_update"] {
            assert!(!allows(command));
        }
    }

    #[cfg(windows)]
    #[test]
    #[ignore = "requires a Windows desktop and WebView2"]
    fn separate_window_survives_main_close_in_native_webview() {
        use super::*;
        use crate::app_settings::{DesktopOption, HomeTarget, Store};
        use std::{borrow::Cow, time::Duration};

        struct OfflineAssets;
        impl tauri::Assets<tauri::Wry> for OfflineAssets {
            fn get(&self, key: &tauri::utils::assets::AssetKey) -> Option<Cow<'_, [u8]>> {
                matches!(key.as_ref(), "index.html" | "monitor.html")
                    .then_some(Cow::Borrowed(b"<!doctype html><title>Offline window test</title>" as &[u8]))
            }
            fn iter(&self) -> Box<tauri::utils::assets::AssetsIter<'_>> {
                Box::new(std::iter::empty())
            }
            fn csp_hashes(&self, _: &tauri::utils::assets::AssetKey)
                -> Box<dyn Iterator<Item = tauri::utils::assets::CspHash<'_>> + '_>
            {
                Box::new(std::iter::empty())
            }
        }
        let cloud = crate::cloud::Cloud::new(crate::auth::Credentials {
            user_id: "1".into(), security: "AAECAwQFBgcICQoLDA0ODw==".into(),
            service_token: "offline-test".into(), region: "cn".into(), device_id: "mock".into(),
            service_id: "mijia".into(), c_user_id: "mock".into(),
        }).unwrap();
        let settings = std::env::temp_dir().join(format!("mijia-monitor-window-{}", uuid::Uuid::new_v4()));
        let store = Arc::new(Store::open(settings.join("app-settings-v1.json")).unwrap());
        let mut options = store.get();
        options.close_to_tray = false;
        store.save(options).unwrap();
        store.change_desktop_option(DesktopOption::MonitorSeparateWindow, true).unwrap();
        let mut context = tauri::generate_context!();
        context.config_mut().identifier = "io.mijiadesktop.offline-monitor-test".into();
        context.config_mut().build.dev_url = None;
        context.config_mut().app.windows.clear();
        context.set_assets(Box::new(OfflineAssets));
        let outcome = Arc::new(Mutex::new(None));
        let report = outcome.clone();
        let desktop = tauri::Builder::default().any_thread()
            .on_window_event(Runtime::event)
            .manage(AppState::with_session(Some(Arc::new(cloud)), None).unwrap())
            .setup(move |app| {
                Runtime::manage(app.handle(), store);
                crate::desktop_idle::Idle::install(app.handle());
                crate::resources::Resources::install(app.handle());
                let main = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
                    .visible(false).build()?;
                let app = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let result = tokio::time::timeout(Duration::from_secs(20), async {
                        let runtime = app.state::<Runtime>();
                        let root = app.state::<AppState>();
                        let target = StartupTarget::Home(HomeTarget {
                            scope: root.account_scope().await?, home_id: "offline-home".into(),
                        });
                        let host = &runtime.detached_monitor;
                        main.show().map_err(|_| unavailable())?;
                        let original_size = main.inner_size().map_err(|_| unavailable())?;
                        let original_position = main.outer_position().map_err(|_| unavailable())?;
                        let label = host.open(&app, target.clone()).await?.ok_or_else(unavailable)?;
                        let window = app.get_webview_window(&label).ok_or_else(unavailable)?;
                        window.show().map_err(|_| unavailable())?;
                        {
                            use windows_sys::Win32::{
                                Foundation::{HWND, RECT},
                                UI::WindowsAndMessaging::{GetClientRect, GetWindowRect, SendMessageW, WMSZ_RIGHT, WM_SIZING},
                            };
                            let hwnd = window.hwnd().map_err(|_| unavailable())?.0 as HWND;
                            let (mut outer, mut client) = (RECT::default(), RECT::default());
                            let resized = unsafe {
                                if GetWindowRect(hwnd, &mut outer) == 0 || GetClientRect(hwnd, &mut client) == 0 {
                                    return Err(unavailable());
                                }
                                let border_width = outer.right - outer.left - client.right;
                                let border_height = outer.bottom - outer.top - client.bottom;
                                outer.right += 80;
                                SendMessageW(hwnd, WM_SIZING, WMSZ_RIGHT as usize, &mut outer as *mut RECT as isize) == 1
                                    && ((outer.right - outer.left - border_width) * 9
                                        - (outer.bottom - outer.top - border_height) * 16).abs() <= 8
                            };
                            if !resized { return Err(AppError::invalid("The independent monitor did not keep the 16:9 ratio during resize.")); }
                        }
                        let display = window.current_monitor().map_err(|_| unavailable())?;
                        if let Some(other) = window.available_monitors().map_err(|_| unavailable())?
                            .into_iter().find(|m| display.as_ref().is_some_and(|current| current.position() != m.position()))
                        {
                            let original_scale = window.scale_factor().map_err(|_| unavailable())?;
                            let work = other.work_area();
                            window.set_size(tauri::LogicalSize::new(640.0, 360.0)).map_err(|_| unavailable())?;
                            window.set_position(tauri::PhysicalPosition::new(work.position.x + 16, work.position.y + 16))
                                .map_err(|_| unavailable())?;
                            tokio::time::sleep(Duration::from_millis(300)).await;
                            let moved = window.current_monitor().map_err(|_| unavailable())?;
                            let moved_scale = window.scale_factor().map_err(|_| unavailable())?;
                            if !moved.as_ref().is_some_and(|m| m.position() == other.position())
                                || (moved_scale - other.scale_factor()).abs() > 0.001
                            {
                                return Err(AppError::invalid("Moving the separate window did not adopt the target display."));
                            }
                            println!("Native monitor moved between displays at scales {original_scale:.2} and {moved_scale:.2}.");
                        }
                        let repeated = host.open(&app, target).await?;
                        main.close().map_err(|_| unavailable())?;
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        window.minimize().map_err(|_| unavailable())?;
                        Runtime::show_async(&app, "monitor").await?;
                        let independent = host.label().as_deref() == Some(label.as_str())
                            && repeated.as_deref() == Some(label.as_str())
                            && !main.is_visible().map_err(|_| unavailable())?
                            && window.is_visible().map_err(|_| unavailable())?
                            && original_size == main.inner_size().map_err(|_| unavailable())?
                            && original_position == main.outer_position().map_err(|_| unavailable())?;
                        let mut options = runtime.settings.get();
                        options.close_to_tray = true;
                        runtime.settings.save(options)?;
                        window.close().map_err(|_| unavailable())?;
                        tokio::time::sleep(Duration::from_millis(300)).await;
                        Ok::<_, AppError>(independent && host.label().is_none() && app.get_webview_window("main").is_some())
                    }).await;
                    *report.lock().unwrap() = Some(result);
                    app.exit(0);
                });
                Ok(())
            }).build(context).unwrap();
        desktop.run_return(|_, _| {});
        assert!(outcome.lock().unwrap().take().expect("native test completed").unwrap().unwrap());
    }
}
