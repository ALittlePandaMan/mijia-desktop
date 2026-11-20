//! Conservative, bounded occlusion inspection. Hooks only signal the worker.
use super::*;
use std::sync::{OnceLock, Weak};
use windows::{
    core::BOOL,
    Win32::{
        Foundation::*,
        Graphics::{Dwm::*, Gdi::*},
        UI::{Accessibility::*, WindowsAndMessaging::*},
    },
};
static WATCH: OnceLock<Weak<Resources>> = OnceLock::new();
static THREAD: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
struct Window {
    hwnd: isize,
    opaque: Option<PixelRect>,
}
pub struct Scene {
    windows: Vec<Window>,
    locked: bool,
    valid: bool,
}
fn class(h: HWND) -> String {
    let mut b = [0u16; 96];
    let n = unsafe { GetClassNameW(h, &mut b) };
    String::from_utf16_lossy(&b[..n.max(0) as usize])
}
fn rectangle(r: RECT) -> PixelRect {
    PixelRect {
        x: r.left as f64,
        y: r.top as f64,
        width: (r.right - r.left) as f64,
        height: (r.bottom - r.top) as f64,
    }
}
fn bounds(h: HWND) -> Option<PixelRect> {
    let mut r = RECT::default();
    unsafe {
        GetWindowRect(h, &mut r).ok()?;
    }
    Some(rectangle(r))
}
impl Scene {
    pub fn unknown() -> Self {
        Self {
            windows: vec![],
            locked: false,
            valid: false,
        }
    }
    pub fn capture() -> Self {
        Self::capture_for(&[])
    }
    pub fn target(window: &WebviewWindow) -> Option<PixelRect> {
        window.hwnd().ok().and_then(bounds)
    }
    pub fn capture_for(targets: &[PixelRect]) -> Self {
        struct Capture<'a> {
            windows: Vec<Window>,
            targets: &'a [PixelRect],
        }
        unsafe extern "system" fn visit(h: HWND, p: LPARAM) -> BOOL {
            let capture = &mut *(p.0 as *mut Capture<'_>);
            let list = &mut capture.windows;
            if list.len() >= 512 {
                return BOOL(0);
            };
            if !IsWindowVisible(h).as_bool() || IsIconic(h).as_bool() {
                return BOOL(1);
            };
            // Preserve Z order and the main HWND marker, but avoid DWM/region
            // work for windows that cannot cover any application content.
            let rect = bounds(h);
            if !capture.targets.is_empty()
                && rect.is_none_or(|r| !capture.targets.iter().any(|t| r.intersection(t).is_some()))
            {
                list.push(Window {
                    hwnd: h.0 as isize,
                    opaque: None,
                });
                return BOOL(1);
            }
            let kind = class(h);
            if matches!(
                kind.as_str(),
                "WorkerW"
                    | "Progman"
                    | "SHELLDLL_DefView"
                    | "Shell_TrayWnd"
                    | "Shell_SecondaryTrayWnd"
            ) {
                return BOOL(1);
            };
            let mut cloaked = 0u32;
            if DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut _ as *mut _, 4).is_ok()
                && cloaked != 0
            {
                return BOOL(1);
            };
            let ex = GetWindowLongPtrW(h, GWL_EXSTYLE);
            let region = CreateRectRgn(0, 0, 0, 0);
            let region_valid = !region.0.is_null();
            let custom = GetWindowRgn(h, region);
            let _ = DeleteObject(region.into());
            let opaque = if ex & (WS_EX_LAYERED.0 | WS_EX_TRANSPARENT.0) as isize == 0
                && region_valid
                && custom == GDI_REGION_TYPE(0)
            {
                rect.map(|r| PixelRect {
                    x: r.x + 2.,
                    y: r.y + 2.,
                    width: (r.width - 4.).max(0.),
                    height: (r.height - 4.).max(0.),
                })
            } else {
                None
            };
            list.push(Window {
                hwnd: h.0 as isize,
                opaque,
            });
            BOOL(1)
        }
        let mut capture = Capture {
            windows: vec![],
            targets,
        };
        let valid =
            unsafe { EnumWindows(Some(visit), LPARAM(&mut capture as *mut _ as isize)).is_ok() };
        Self {
            windows: capture.windows,
            locked: !crate::app_runtime::desktop_unlocked(),
            valid,
        }
    }
    pub(super) fn locked(&self) -> bool {
        self.locked
    }

    pub fn visible(&self, window: &WebviewWindow, rects: &[PixelRect]) -> bool {
        if self.locked {
            return false;
        };
        if !window.is_visible().unwrap_or(true) || window.is_minimized().unwrap_or(false) {
            return false;
        };
        if !self.valid {
            return true;
        };
        let Ok(h) = window.hwnd() else { return true };
        let own = h.0 as isize;
        let covers: Vec<_> = self
            .windows
            .iter()
            .take_while(|w| w.hwnd != own)
            .filter_map(|w| w.opaque)
            .collect();
        if rects.is_empty() {
            if !self.windows.iter().any(|w| w.hwnd == own) {
                return true;
            };
            return bounds(h).is_none_or(|r| crate::resource_policy::exposed(r, &covers));
        }
        rects
            .iter()
            .any(|r| crate::resource_policy::exposed(*r, &covers))
    }
    pub fn diagnostics(&self, window: &WebviewWindow) -> serde_json::Value {
        let own = window.hwnd().ok().map(|h| h.0 as isize);
        let covers = self
            .windows
            .iter()
            .take_while(|w| Some(w.hwnd) != own)
            .filter(|w| w.opaque.is_some())
            .count();
        serde_json::json!({"valid":self.valid,"locked":self.locked,"ownFound":self.windows.iter().any(|w|Some(w.hwnd)==own),"opaqueRegionCountAbove":covers})
    }
}
unsafe extern "system" fn event(
    _: HWINEVENTHOOK,
    _: u32,
    _: HWND,
    object: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    if object != 0 {
        return;
    };
    if let Some(w) = WATCH.get().and_then(Weak::upgrade) {
        w.changed.notify_one();
    }
}
pub fn events(resources: Weak<Resources>) {
    let _ = WATCH.set(resources);
    std::thread::Builder::new()
        .name("resource-events".into())
        .spawn(|| unsafe {
            let mut msg = MSG::default();
            let _ = PeekMessageW(&mut msg, None, 0, 0, PM_NOREMOVE);
            THREAD.store(
                windows_sys::Win32::System::Threading::GetCurrentThreadId(),
                Ordering::Release,
            );
            let hooks = [
                (EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND),
                (EVENT_SYSTEM_MINIMIZESTART, EVENT_SYSTEM_MINIMIZEEND),
                (EVENT_SYSTEM_MOVESIZEEND, EVENT_SYSTEM_MOVESIZEEND),
                (EVENT_OBJECT_SHOW, EVENT_OBJECT_HIDE),
                (EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_LOCATIONCHANGE),
                (EVENT_SYSTEM_DESKTOPSWITCH, EVENT_SYSTEM_DESKTOPSWITCH),
            ]
            .map(|(a, b)| SetWinEventHook(a, b, None, Some(event), 0, 0, WINEVENT_OUTOFCONTEXT));
            while GetMessageW(&mut msg, None, 0, 0).0 > 0 {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            for h in hooks {
                let _ = UnhookWinEvent(h);
            }
        })
        .ok();
}
pub fn stop() {
    let id = THREAD.load(Ordering::Acquire);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, WM_QUIT, WPARAM(0), LPARAM(0));
        }
    }
}
