//! The constraint exists only while the monitor wall owns the window.
#[cfg(windows)]
mod platform {
    use std::cell::Cell;
    use tauri::PhysicalSize;
    use windows_sys::Win32::{
        Foundation::*,
        UI::{HiDpi::GetDpiForWindow, WindowsAndMessaging::*},
    };
    const KEY: &[u16] = &[
        77, 105, 106, 105, 97, 77, 111, 110, 105, 116, 111, 114, 65, 115, 112, 101, 99, 116, 0,
    ];
    struct Policy {
        enabled: Cell<bool>,
        placement: Cell<WINDOWPLACEMENT>,
        previous: Cell<WNDPROC>,
    }
    unsafe extern "system" fn hook(hwnd: HWND, msg: u32, w: WPARAM, l: LPARAM) -> LRESULT {
        let data = GetPropW(hwnd, KEY.as_ptr());
        if data.is_null() {
            return DefWindowProcW(hwnd, msg, w, l);
        }
        let policy = &*(data as *const Policy);
        let previous = policy.previous.get();
        if msg == WM_NCDESTROY {
            RemovePropW(hwnd, KEY.as_ptr());
            let result = CallWindowProcW(previous, hwnd, msg, w, l);
            drop(Box::from_raw(data as *mut Policy));
            return result;
        }
        if policy.enabled.get() && msg == WM_SIZING && l != 0 {
            let r = &mut *(l as *mut RECT);
            let mut outer = RECT::default();
            let mut client = RECT::default();
            GetWindowRect(hwnd, &mut outer);
            GetClientRect(hwnd, &mut client);
            let border_w = outer.right - outer.left - client.right;
            let border_h = outer.bottom - outer.top - client.bottom;
            let scale = GetDpiForWindow(hwnd) as f64 / 96.;
            let min_w = (720. * scale).ceil() as i32;
            let min_h = (405. * scale).ceil() as i32;
            let vertical = w as u32 == WMSZ_TOP || w as u32 == WMSZ_BOTTOM;
            let width = if vertical {
                ((r.bottom - r.top - border_h).max(min_h) as f64 * 16. / 9.).round() as i32
            } else {
                (r.right - r.left - border_w).max(min_w)
            };
            let height = (width as f64 * 9. / 16.).round() as i32;
            if matches!(w as u32, WMSZ_LEFT | WMSZ_TOPLEFT | WMSZ_BOTTOMLEFT) {
                r.left = r.right - width - border_w;
            } else {
                r.right = r.left + width + border_w;
            }
            if matches!(w as u32, WMSZ_TOP | WMSZ_TOPLEFT | WMSZ_TOPRIGHT) {
                r.top = r.bottom - height - border_h;
            } else {
                r.bottom = r.top + height + border_h;
            }
            return 1;
        }
        CallWindowProcW(previous, hwnd, msg, w, l)
    }
    pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
        unsafe {
            let hwnd = window.hwnd().map_err(|e| e.to_string())?.0 as HWND;
            let mut data = GetPropW(hwnd, KEY.as_ptr());
            if data.is_null() {
                let state = Box::new(Policy {
                    enabled: Cell::new(false),
                    placement: Cell::new(std::mem::zeroed()),
                    previous: Cell::new(None),
                });
                data = Box::into_raw(state) as *mut std::ffi::c_void;
                if SetPropW(hwnd, KEY.as_ptr(), data) == 0 {
                    drop(Box::from_raw(data as *mut Policy));
                    return Err("window property".into());
                }
                let previous = SetWindowLongPtrW(hwnd, GWLP_WNDPROC, hook as *const () as isize);
                if previous == 0 {
                    RemovePropW(hwnd, KEY.as_ptr());
                    drop(Box::from_raw(data as *mut Policy));
                    return Err("window hook".into());
                }
                (&*(data as *const Policy))
                    .previous
                    .set(Some(std::mem::transmute::<
                        isize,
                        unsafe extern "system" fn(HWND, u32, WPARAM, LPARAM) -> LRESULT,
                    >(previous)));
            }
            let policy = &*(data as *const Policy);
            if policy.enabled.get() == enabled {
                return Ok(());
            }
            if enabled {
                let mut placement = policy.placement.get();
                placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
                if GetWindowPlacement(hwnd, &mut placement) == 0 {
                    return Err("window placement".into());
                }
                policy.placement.set(placement);
                window
                    .set_min_size(Some(tauri::LogicalSize::new(720., 405.)))
                    .map_err(|e| e.to_string())?;
                policy.enabled.set(true);
                if IsZoomed(hwnd) == 0 && !window.is_fullscreen().unwrap_or(false) {
                    let size = window.inner_size().map_err(|e| e.to_string())?;
                    let scale = window.scale_factor().map_err(|e| e.to_string())?;
                    let width = (size.width as f64)
                        .min(size.height as f64 * 16. / 9.)
                        .max(720. * scale)
                        .round() as u32;
                    window
                        .set_size(PhysicalSize::new(
                            width,
                            (width as f64 * 9. / 16.).round() as u32,
                        ))
                        .map_err(|e| e.to_string())?;
                }
            } else {
                policy.enabled.set(false);
                let _ = window.set_fullscreen(false);
                window
                    .set_min_size(Some(tauri::LogicalSize::new(720., 420.)))
                    .map_err(|e| e.to_string())?;
                SetWindowPlacement(hwnd, &policy.placement.get());
            }
            Ok(())
        }
    }
}
// Tauri provides portable enter/leave geometry. Wayland may control window placement.
#[cfg(not(windows))]
mod platform {
    use std::sync::Mutex;
    use tauri::{PhysicalPosition, PhysicalSize};
    struct Saved { position: Option<PhysicalPosition<i32>>, size: PhysicalSize<u32>, maximized: bool, fullscreen: bool }
    static SAVED: Mutex<Option<Saved>> = Mutex::new(None);
    pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
        let mut saved = SAVED.lock().map_err(|_| "window state".to_string())?;
        if enabled {
            if saved.is_some() { return Ok(()); }
            let state = Saved {
                position: window.outer_position().ok(),
                size: window.inner_size().map_err(|e| e.to_string())?,
                maximized: window.is_maximized().map_err(|e| e.to_string())?,
                fullscreen: window.is_fullscreen().map_err(|e| e.to_string())?,
            };
            window.set_min_size(Some(tauri::LogicalSize::new(720., 405.))).map_err(|e| e.to_string())?;
            if !state.maximized && !state.fullscreen {
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                let width = (state.size.width as f64).min(state.size.height as f64 * 16. / 9.).max(720. * scale).round() as u32;
                window.set_size(PhysicalSize::new(width, (width as f64 * 9. / 16.).round() as u32)).map_err(|e| e.to_string())?;
            }
            *saved = Some(state);
        } else if let Some(state) = saved.take() {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window.set_min_size(Some(tauri::LogicalSize::new(720., 420.))).map_err(|e| e.to_string())?;
            if state.maximized { window.maximize().map_err(|e| e.to_string())?; }
            else {
                window.unmaximize().map_err(|e| e.to_string())?;
                window.set_size(state.size).map_err(|e| e.to_string())?;
                // Some Wayland compositors reject client positioning; size still restores.
                if let Some(position) = state.position { let _ = window.set_position(position); }
            }
            if state.fullscreen { window.set_fullscreen(true).map_err(|e| e.to_string())?; }
        }
        Ok(())
    }
}
pub async fn set(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
    let (send, receive) = tokio::sync::oneshot::channel();
    let w = window.clone();
    window
        .run_on_main_thread(move || {
            let result = platform::apply(&w, enabled);
            let _ = send.send(result);
        })
        .map_err(|e| e.to_string())?;
    receive.await.map_err(|e| e.to_string())?
}
