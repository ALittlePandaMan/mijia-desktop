//! Main WebView memory policy. Rust workers stay active; desktop hosts have their own policy.
use crate::{
    error::{AppError, Result},
    idle_policy::IdlePolicy,
};
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex,
};
use std::time::Instant;
use tauri::{Manager, WebviewWindow};
pub struct Idle {
    policy: Mutex<IdlePolicy>,
    started: Instant,
    waking: AtomicBool,
}
impl Idle {
    pub fn install(app: &tauri::AppHandle) {
        app.manage(Self {
            policy: Mutex::new(IdlePolicy::default()),
            started: Instant::now(),
            waking: AtomicBool::new(false),
        });
    }
    fn now(&self) -> u64 {
        self.started.elapsed().as_millis() as u64
    }
    pub fn observe(app: &tauri::AppHandle, visible: bool) {
        let idle = app.state::<Self>();
        if idle.waking.load(Ordering::Acquire) {
            return;
        }
        let (wake, attempt) = {
            let mut p = idle.policy.lock().unwrap();
            let wake = p.visibility(visible, idle.now());
            (wake, p.attempt(idle.now()))
        };
        if wake {
            resume(app, None);
        }
        if let Some(epoch) = attempt {
            suspend(app, epoch);
        }
    }
    pub fn show(app: &tauri::AppHandle, action: &str) {
        let idle = app.state::<Self>();
        idle.waking.store(true, Ordering::Release);
        idle.policy.lock().unwrap().wake();
        resume(app, Some(action.into()));
    }
    pub fn status(&self) -> serde_json::Value {
        serde_json::to_value(&*self.policy.lock().unwrap()).unwrap_or_default()
    }
    pub async fn wait_awake(app: &tauri::AppHandle) -> Result<()> {
        for _ in 0..500 {
            if !app.state::<Self>().waking.load(Ordering::Acquire) {
                return Ok(());
            }
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        }
        Err(AppError::new("windowUnavailable", "主窗口正在恢复。", true))
    }
}
#[tauri::command]
pub fn desktop_frontend_idle(
    window: WebviewWindow,
    app: tauri::AppHandle,
    idle: bool,
) -> Result<()> {
    if window.label() != "main" {
        return Err(AppError::new(
            "permissionDenied",
            "仅主窗口可更新空闲状态。",
            false,
        ));
    }
    let state = app.state::<Idle>();
    state.policy.lock().unwrap().report(idle, state.now());
    Ok(())
}
fn finish_resume(app: &tauri::AppHandle, action: Option<String>) {
    if let Some(action) = action {
        crate::app_runtime::Runtime::show_resumed(app, &action);
    }
    app.state::<Idle>().waking.store(false, Ordering::Release);
}
#[cfg(windows)]
fn resume(app: &tauri::AppHandle, action: Option<String>) {
    use webview2_com::Microsoft::Web::WebView2::Win32::*;
    use windows::core::Interface;
    let Some(window) = app.get_webview_window("main") else {
        finish_resume(app, action);
        return;
    };
    let (done, receive) = tokio::sync::oneshot::channel();
    if window
        .with_webview(move |native| unsafe {
            if let Ok(core) = native.controller().CoreWebView2() {
                if let Ok(memory) = core.cast::<ICoreWebView2_19>() {
                    let _ = memory
                        .SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL);
                }
                if let Ok(lifecycle) = core.cast::<ICoreWebView2_3>() {
                    let _ = lifecycle.Resume();
                }
            }
            let _ = native.controller().SetIsVisible(true);
            // Tauri holds the originating webview dispatcher while this
            // callback runs. Emitting to it here would reenter that mutex.
            let _ = done.send(());
        })
        .is_err()
    {
        finish_resume(app, action);
    } else {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if receive.await.is_ok() {
                finish_resume(&app, action);
            }
        });
    }
}
#[cfg(not(windows))]
fn resume(app: &tauri::AppHandle, action: Option<String>) {
    finish_resume(app, action);
}
#[cfg(windows)]
fn suspend(app: &tauri::AppHandle, epoch: u64) {
    use webview2_com::{Microsoft::Web::WebView2::Win32::*, TrySuspendCompletedHandler};
    use windows::core::Interface;
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let main_handle = window.hwnd().ok().map(|h| h.0 as isize);
    let app = app.clone();
    let _ = window.with_webview(move |native| unsafe {
        let state = app.state::<Idle>();
        if state.policy.lock().unwrap().epoch != epoch {
            return;
        }
        if app
            .state::<std::sync::Arc<crate::resources::Resources>>()
            .visible("main")
            || main_handle.is_some_and(|h| {
                use windows::Win32::UI::WindowsAndMessaging::{IsIconic, IsWindowVisible};
                let hwnd = windows::Win32::Foundation::HWND(h as *mut _);
                IsWindowVisible(hwnd).as_bool()
                    && !IsIconic(hwnd).as_bool()
                    && windows::Win32::UI::WindowsAndMessaging::GetForegroundWindow() == hwnd
            })
        {
            state.policy.lock().unwrap().wake();
            return;
        }
        let Ok(core) = native.controller().CoreWebView2() else {
            state
                .policy
                .lock()
                .unwrap()
                .complete(epoch, false, state.now());
            return;
        };
        if let Ok(memory) = core.cast::<ICoreWebView2_19>() {
            let _ = memory.SetMemoryUsageTargetLevel(COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW);
        }
        let Ok(lifecycle) = core.cast::<ICoreWebView2_3>() else {
            state.policy.lock().unwrap().unsupported = true;
            return;
        };
        // WebView2 requires the controller itself to be invisible. Hiding or
        // minimizing only its parent HWND does not establish that condition.
        let _ = native.controller().SetIsVisible(false);
        let callback_app = app.clone();
        let recovery = lifecycle.clone();
        let callback = TrySuspendCompletedHandler::create(Box::new(move |result, suspended| {
            let state = callback_app.state::<Idle>();
            let accepted = state.policy.lock().unwrap().complete(
                epoch,
                result.is_ok() && suspended,
                state.now(),
            );
            if !accepted {
                let _ = recovery.Resume();
            }
            Ok(())
        }));
        if lifecycle.TrySuspend(&callback).is_err() {
            state
                .policy
                .lock()
                .unwrap()
                .complete(epoch, false, state.now());
        }
    });
}
#[cfg(not(windows))]
fn suspend(app: &tauri::AppHandle, _: u64) {
    app.state::<Idle>().policy.lock().unwrap().unsupported = true;
}
