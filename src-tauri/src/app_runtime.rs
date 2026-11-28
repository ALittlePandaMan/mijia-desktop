use crate::{
    app_settings::{AppSettings, DesktopOption, Store},
    detached_monitor::DetachedMonitor,
    error::Result,
    mcp::transport,
    state::AppState,
};
use serde_json::{json, Value};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use tauri::{Emitter, Manager};
use tauri_plugin_autostart::ManagerExt;
pub struct Runtime {
    pub settings: Arc<Store>,
    pub mcp: Arc<transport::Manager>,
    exiting: AtomicBool,
    pub monitor: AtomicBool,
    pub(crate) detached_monitor: DetachedMonitor,
    hidden: AtomicBool,
    power: Mutex<Option<PowerRequest>>,
}
impl Runtime {
    pub fn install(app: &tauri::AppHandle) -> Result<()> {
        crate::desktop_idle::Idle::install(app);
        let settings = Arc::new(Store::new()?);
        let mcp = Self::manage(app, settings);
        crate::resources::Resources::install(app);
        let _ = rustls::crypto::ring::default_provider().install_default();
        if app.autolaunch().is_enabled().unwrap_or(false) {
            let _ = app.autolaunch().enable();
        }
        tray(app).map_err(crate::app_settings::storage)?;
        tauri::async_runtime::spawn(async move {
            mcp.apply().await;
        });
        let handle = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut previous = Value::Null;
            let mut previous_detached = Value::Null;
            loop {
                tokio::time::sleep(std::time::Duration::from_secs(1)).await;
                let rt = handle.state::<Runtime>();
                if rt.exiting.load(Ordering::Acquire) {
                    break;
                }
                rt.mcp.engine.watch_account().await;
                let mut monitor_awake = false;
                if let Some(window) = handle.get_webview_window("main") {
                    let (state, fullscreen_visible) = window_state(&window, rt.hidden.load(Ordering::Acquire));
                    if state != previous {
                        let _ = handle.emit_to("main", "desktop-native-state", &state);
                        previous = state;
                    }
                    monitor_awake = fullscreen_visible && rt.monitor.load(Ordering::Acquire);
                }
                if let Some(window) = rt.detached_monitor.label().and_then(|label| handle.get_webview_window(&label)) {
                    let (state, fullscreen_visible) = window_state(&window, false);
                    let identified = json!([window.label(), state]);
                    if identified != previous_detached {
                        let _ = handle.emit_to(window.label(), "desktop-native-state", &identified[1]);
                        previous_detached = identified;
                    }
                    monitor_awake |= fullscreen_visible;
                }
                let awake = monitor_awake && rt.settings.get().keep_awake && desktop_unlocked();
                let mut power = rt.power.lock().unwrap();
                if awake && power.is_none() {
                    *power = PowerRequest::new();
                } else if !awake {
                    *power = None;
                }
            }
        });
        Ok(())
    }
    pub(crate) fn manage(app: &tauri::AppHandle, settings: Arc<Store>) -> Arc<transport::Manager> {
        let mcp = transport::Manager::new(app.clone(), settings.clone());
        app.manage(Self {
            settings,
            mcp: mcp.clone(),
            exiting: AtomicBool::new(false),
            monitor: AtomicBool::new(false),
            detached_monitor: DetachedMonitor::default(),
            hidden: AtomicBool::new(false),
            power: Mutex::new(None),
        });
        mcp
    }
    pub(crate) fn is_exiting(&self) -> bool {
        self.exiting.load(Ordering::Acquire)
    }
    pub fn show(app: &tauri::AppHandle, action: &str) {
        // Activation may run inside a native single-instance/tray callback.
        // Defer it so WebView2 is never reentered from that window procedure.
        let app = app.clone();
        let action = action.to_owned();
        tauri::async_runtime::spawn(async move {
            let _ = Self::show_async(&app, &action).await;
        });
    }
    pub(crate) async fn show_async(app: &tauri::AppHandle, action: &str) -> Result<()> {
        for _ in 0..250 {
            if app.try_state::<Self>().is_some()
                && app.try_state::<crate::desktop_idle::Idle>().is_some()
            {
                let rt = app.state::<Self>();
                if rt.is_exiting() {
                    return Err(crate::error::AppError::stale());
                }
                if action == "monitor" {
                    if rt.detached_monitor.focus(app).is_some() { return Ok(()); }
                    if rt.settings.desktop_options().monitor_separate_window {
                        let state = app.state::<AppState>();
                        if let Ok(target) = state.monitor_tray_target(rt.settings.get().startup_home).await {
                            if matches!(Box::pin(rt.detached_monitor.open(app, target)).await, Ok(Some(_))) {
                                return Ok(());
                            }
                        }
                    }
                }
                crate::desktop_idle::Idle::show(app, action);
                return crate::desktop_idle::Idle::wait_awake(app).await;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        Err(crate::error::AppError::new(
            "windowUnavailable",
            "主窗口尚未就绪。",
            true,
        ))
    }
    pub(crate) fn show_resumed(app: &tauri::AppHandle, action: &str) {
        let Some(rt) = app.try_state::<Self>() else {
            return;
        };
        rt.hidden.store(false, Ordering::Release);
        if let Some(w) = app.get_webview_window("main") {
            let _ = w.unminimize();
            let _ = w.show();
            let _ = w.set_focus();
        }
        let _ = app.emit("desktop-action", action);
        app.state::<Arc<crate::resources::Resources>>().wake_hint();
    }
    pub fn quit(app: &tauri::AppHandle) {
        Self::shutdown(app, false);
    }
    pub fn quit_for_update(app: &tauri::AppHandle) {
        Self::shutdown(app, true);
    }
    fn shutdown(app: &tauri::AppHandle, install_update: bool) {
        let rt = app.state::<Self>();
        if rt.exiting.swap(true, Ordering::AcqRel) {
            return;
        }
        *rt.power.lock().unwrap() = None;
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            let rt = app.state::<Self>();
            rt.mcp.stop().await;
            rt.detached_monitor.shutdown(&app).await;
            app.state::<AppState>().finish_camera_sessions().await;
            if install_update {
                if let Err(_error) = app
                    .state::<Arc<crate::app_update::Updates>>()
                    .apply(&app, true)
                {
                    rt.exiting.store(false, Ordering::Release);
                    rt.mcp.apply().await;
                    Self::show(&app, "open");
                    return;
                }
            }
            if let Some(widgets) = app.try_state::<Arc<crate::desktop_widgets::Widgets>>() {
                widgets.shutdown();
            }
            app.state::<Arc<crate::resources::Resources>>().stop();
            app.exit(0);
        });
    }
    pub fn event(window: &tauri::Window, event: &tauri::WindowEvent) {
        let app = window.app_handle();
        let Some(rt) = app.try_state::<Self>() else {
            return;
        };
        if DetachedMonitor::is_label(window.label()) {
            if matches!(event, tauri::WindowEvent::Destroyed) {
                rt.detached_monitor.destroyed(app, window.label());
                if rt.hidden.load(Ordering::Acquire) && !rt.keep_background(app) {
                    Self::quit(app);
                }
            }
            return;
        }
        if window.label() != "main" {
            return;
        }
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if rt.exiting.load(Ordering::Acquire) {
                    return;
                }
                if !rt.keep_background(app) {
                    Self::quit(app);
                    return;
                }
                if rt.hidden.swap(true, Ordering::AcqRel) {
                    return;
                }
                if rt.detached_monitor.label().is_none() {
                    *rt.power.lock().unwrap() = None;
                }
                let _ = app.emit("desktop-action", "background");
                let _ = window.hide();
                app.state::<Arc<crate::resources::Resources>>().wake_hint();
            }
            tauri::WindowEvent::Destroyed => {
                rt.monitor.store(false, Ordering::Release);
                crate::desktop_idle::Idle::destroyed(app);
                app.state::<Arc<crate::resources::Resources>>().forget("main");
                app.state::<AppState>().stop_camera_sessions();
            }
            _ => {}
        }
    }
    fn keep_background(&self, app: &tauri::AppHandle) -> bool {
        self.settings.get().close_to_tray || self.detached_monitor.label().is_some()
            || app.try_state::<Arc<crate::desktop_widgets::Widgets>>().is_some_and(|w| w.has_pins())
    }
}

fn window_state(window: &tauri::WebviewWindow, hidden: bool) -> (Value, bool) {
    let fullscreen = window.is_fullscreen().unwrap_or(false);
    let minimized = window.is_minimized().unwrap_or(true);
    let visible = window.is_visible().unwrap_or(false) && !hidden;
    (json!({"fullscreen":fullscreen,"minimized":minimized,"visible":visible}), fullscreen && visible && !minimized)
}
fn tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    use tauri::{
        menu::{Menu, MenuItem},
        tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    };
    let open = MenuItem::with_id(app, "open", "打开软件", true, None::<&str>)?;
    let monitor = MenuItem::with_id(app, "monitor", "进入监控", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "设置", true, None::<&str>)?;
    let exit = MenuItem::with_id(app, "exit", "退出", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &monitor, &settings, &exit])?;
    let mut builder = TrayIconBuilder::with_id("mijia-main")
        .tooltip("米家Desktop")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| {
            let action = event.id.as_ref();
            if action == "exit" {
                Runtime::quit(app);
            } else {
                Runtime::show(app, action);
            }
        })
        .on_tray_icon_event(|tray, event| {
            if matches!(
                event,
                TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                }
            ) {
                Runtime::show(tray.app_handle(), "open");
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}
#[tauri::command]
pub async fn application_settings(app: tauri::AppHandle) -> Result<Value> {
    let rt = app.state::<Runtime>();
    Ok(
        json!({"settings":rt.settings.get(),"desktopOptions":rt.settings.desktop_options(),"autostart":app.autolaunch().is_enabled().map_err(crate::app_settings::storage)?,"scope":app.state::<AppState>().account_scope().await.ok(),"mcpStatus":rt.mcp.status(),"update":app.state::<Arc<crate::app_update::Updates>>().status()}),
    )
}
#[tauri::command]
pub async fn change_desktop_option(app: tauri::AppHandle, option: DesktopOption, enabled: bool) -> Result<Value> {
    app.state::<Runtime>().settings.change_desktop_option(option, enabled)?;
    application_settings(app).await
}
#[tauri::command]
pub async fn change_application_settings(
    app: tauri::AppHandle,
    value: AppSettings,
    autostart: Option<bool>,
) -> Result<Value> {
    value.validate()?;
    let rt = app.state::<Runtime>();
    let before = rt.settings.get();
    rt.mcp.engine.validate_settings(&before, &value).await?;
    let previous_autostart = app
        .autolaunch()
        .is_enabled()
        .map_err(crate::app_settings::storage)?;
    if let Some(enabled) = autostart {
        if enabled {
            app.autolaunch().enable()
        } else {
            app.autolaunch().disable()
        }
        .map_err(crate::app_settings::storage)?;
    }
    if let Err(error) = rt.settings.save(value.clone()) {
        if autostart.is_some() {
            let _ = if previous_autostart {
                app.autolaunch().enable()
            } else {
                app.autolaunch().disable()
            };
        }
        return Err(error);
    }
    if before.mcp.excluded_homes != value.mcp.excluded_homes { rt.mcp.engine.stop().await; }
    if before.mcp.enabled != value.mcp.enabled || before.mcp.local_port != value.mcp.local_port {
        rt.mcp.apply().await;
    }
    application_settings(app.clone()).await
}
#[tauri::command]
pub async fn mcp_connection_config(app: tauri::AppHandle) -> Result<String> {
    let settings = app.state::<Runtime>().settings.get().mcp;
    let url = format!("http://127.0.0.1:{}/mcp", settings.local_port);
    serde_json::to_string_pretty(&json!({"mcpServers":{"mijia-desktop":{"url":url,"headers":{"Authorization":format!("Bearer {}",crate::local_secret::access_key()?)}}}})).map_err(crate::app_settings::storage)
}
#[tauri::command]
pub async fn mcp_rotate_key(app: tauri::AppHandle) -> Result<Value> {
    crate::local_secret::rotate_key()?;
    app.state::<Runtime>()
        .mcp
        .engine
        .key_epoch
        .fetch_add(1, Ordering::AcqRel);
    app.state::<Runtime>().mcp.apply().await;
    application_settings(app.clone()).await
}
#[tauri::command]
pub fn application_exit(app: tauri::AppHandle) {
    Runtime::quit(&app);
}
#[cfg(windows)]
struct PowerRequest(usize);
#[cfg(windows)]
impl PowerRequest {
    fn new() -> Option<Self> {
        unsafe {
            use windows_sys::Win32::System::{Power::*, Threading::*};
            let mut reason = "米家Desktop 全屏监控\0".encode_utf16().collect::<Vec<_>>();
            let context = REASON_CONTEXT {
                Version: 0,
                Flags: POWER_REQUEST_CONTEXT_SIMPLE_STRING,
                Reason: REASON_CONTEXT_0 {
                    SimpleReasonString: reason.as_mut_ptr(),
                },
            };
            let handle = PowerCreateRequest(&context);
            if handle.is_null() || handle as isize == -1 {
                return None;
            }
            if PowerSetRequest(handle, PowerRequestDisplayRequired) == 0
                || PowerSetRequest(handle, PowerRequestSystemRequired) == 0
            {
                windows_sys::Win32::Foundation::CloseHandle(handle);
                return None;
            }
            Some(Self(handle as usize))
        }
    }
}
#[cfg(windows)]
impl Drop for PowerRequest {
    fn drop(&mut self) {
        unsafe {
            use windows_sys::Win32::System::Power::*;
            PowerClearRequest(self.0 as _, PowerRequestDisplayRequired);
            PowerClearRequest(self.0 as _, PowerRequestSystemRequired);
            windows_sys::Win32::Foundation::CloseHandle(self.0 as _);
        }
    }
}
#[cfg(not(windows))]
struct PowerRequest;
#[cfg(not(windows))]
impl PowerRequest {
    fn new() -> Option<Self> {
        None
    }
}
#[cfg(windows)]
pub(crate) fn desktop_unlocked() -> bool {
    unsafe {
        use windows_sys::Win32::System::StationsAndDesktops::*;
        let desktop = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
        if desktop.is_null() {
            false
        } else {
            CloseDesktop(desktop);
            true
        }
    }
}
#[cfg(not(windows))]
pub(crate) fn desktop_unlocked() -> bool {
    true
}
