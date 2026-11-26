//! The constraint exists only while the monitor wall owns the window.
#[cfg(any(windows, test))]
fn track_width(work_width: i32, work_height: i32, scale: f64) -> (i32, i32) {
    let maximum = work_width.min((f64::from(work_height) * 16. / 9.).floor() as i32).max(1);
    let minimum = ((720. * scale).ceil() as i32).clamp(1, maximum);
    (minimum, maximum)
}

#[cfg(windows)]
mod platform {
    use std::cell::Cell;
    use windows_sys::Win32::{
        Foundation::*,
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
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
    fn fitted_height(width: i32) -> i32 { (f64::from(width) * 9. / 16.).round().max(1.) as i32 }

    unsafe fn monitor(rect: &RECT) -> Option<MONITORINFO> {
        let handle = MonitorFromRect(rect, MONITOR_DEFAULTTONEAREST);
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        (!handle.is_null() && GetMonitorInfoW(handle, &mut info) != 0).then_some(info)
    }

    unsafe fn border(hwnd: HWND, rect: &RECT) -> (i32, i32) {
        let mut client = RECT::default();
        GetClientRect(hwnd, &mut client);
        ((rect.right - rect.left - client.right).max(0), (rect.bottom - rect.top - client.bottom).max(0))
    }

    unsafe fn limits(hwnd: HWND, rect: &RECT, border: (i32, i32)) -> Option<(i32, i32)> {
        let work = monitor(rect)?.rcWork;
        let scale = f64::from(GetDpiForWindow(hwnd).max(96)) / 96.;
        Some(super::track_width(work.right - work.left - border.0, work.bottom - work.top - border.1, scale))
    }

    unsafe fn fit_window(hwnd: HWND, entering: bool) {
        if IsZoomed(hwnd) != 0 || IsIconic(hwnd) != 0 { return; }
        let mut rect = RECT::default();
        if GetWindowRect(hwnd, &mut rect) == 0 { return; }
        let Some(info) = monitor(&rect) else { return };
        let screen = info.rcMonitor;
        if (rect.left, rect.top, rect.right, rect.bottom) == (screen.left, screen.top, screen.right, screen.bottom) { return; }
        let work = info.rcWork;
        let (border_w, border_h) = border(hwnd, &rect);
        let (min, max) = super::track_width(work.right - work.left - border_w, work.bottom - work.top - border_h,
            f64::from(GetDpiForWindow(hwnd).max(96)) / 96.);
        let current_width = rect.right - rect.left - border_w;
        let current_height = rect.bottom - rect.top - border_h;
        if !entering && current_width <= max && current_height <= fitted_height(max) { return; }
        let width = current_width.min((f64::from(current_height) * 16. / 9.).round() as i32).clamp(min, max);
        let (width, height) = (width + border_w, fitted_height(width) + border_h);
        SetWindowPos(hwnd, std::ptr::null_mut(),
            rect.left.clamp(work.left, (work.right - width).max(work.left)),
            rect.top.clamp(work.top, (work.bottom - height).max(work.top)),
            width, height, SWP_NOZORDER | SWP_NOACTIVATE);
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
        if !policy.enabled.get() {
            return CallWindowProcW(previous, hwnd, msg, w, l);
        }
        if matches!(msg, WM_DPICHANGED | WM_EXITSIZEMOVE | WM_DISPLAYCHANGE) {
            let result = CallWindowProcW(previous, hwnd, msg, w, l);
            fit_window(hwnd, false);
            return result;
        }
        if msg == WM_GETMINMAXINFO && l != 0 {
            let result = CallWindowProcW(previous, hwnd, msg, w, l);
            let mut rect = RECT::default();
            if GetWindowRect(hwnd, &mut rect) != 0 {
                let (border_w, border_h) = border(hwnd, &rect);
                if let Some((min, max)) = limits(hwnd, &rect, (border_w, border_h)) {
                    let track = &mut *(l as *mut MINMAXINFO);
                    track.ptMinTrackSize = POINT { x: min + border_w, y: fitted_height(min) + border_h };
                    track.ptMaxTrackSize = POINT { x: max + border_w, y: fitted_height(max) + border_h };
                }
            }
            return result;
        }
        if msg == WM_SIZING && l != 0 {
            let r = &mut *(l as *mut RECT);
            let mut outer = RECT::default();
            GetWindowRect(hwnd, &mut outer);
            let (border_w, border_h) = border(hwnd, &outer);
            let Some((min, max)) = limits(hwnd, r, (border_w, border_h)) else {
                return CallWindowProcW(previous, hwnd, msg, w, l);
            };
            let vertical = w as u32 == WMSZ_TOP || w as u32 == WMSZ_BOTTOM;
            let width = if vertical {
                (f64::from(r.bottom - r.top - border_h) * 16. / 9.).round() as i32
            } else {
                r.right - r.left - border_w
            }.clamp(min, max);
            let height = fitted_height(width);
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
                    .set_min_size(None::<tauri::LogicalSize<f64>>)
                    .map_err(|e| e.to_string())?;
                policy.enabled.set(true);
                if !window.is_fullscreen().unwrap_or(false) {
                    fit_window(hwnd, true);
                }
            } else {
                policy.enabled.set(false);
                let _ = window.set_fullscreen(false);
                window
                    .set_min_size(Some(tauri::LogicalSize::new(480., 420.)))
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
    struct Saved {
        position: Option<PhysicalPosition<i32>>,
        size: PhysicalSize<u32>,
        maximized: bool,
        fullscreen: bool,
    }
    static SAVED: Mutex<Option<Saved>> = Mutex::new(None);
    pub fn apply(window: &tauri::WebviewWindow, enabled: bool) -> Result<(), String> {
        let mut saved = SAVED.lock().map_err(|_| "window state".to_string())?;
        if enabled {
            if saved.is_some() {
                return Ok(());
            }
            let state = Saved {
                position: window.outer_position().ok(),
                size: window.inner_size().map_err(|e| e.to_string())?,
                maximized: window.is_maximized().map_err(|e| e.to_string())?,
                fullscreen: window.is_fullscreen().map_err(|e| e.to_string())?,
            };
            window
                .set_min_size(Some(tauri::LogicalSize::new(720., 405.)))
                .map_err(|e| e.to_string())?;
            if !state.maximized && !state.fullscreen {
                let scale = window.scale_factor().map_err(|e| e.to_string())?;
                let width = (state.size.width as f64)
                    .min(state.size.height as f64 * 16. / 9.)
                    .max(720. * scale)
                    .round() as u32;
                window
                    .set_size(PhysicalSize::new(
                        width,
                        (width as f64 * 9. / 16.).round() as u32,
                    ))
                    .map_err(|e| e.to_string())?;
            }
            *saved = Some(state);
        } else if let Some(state) = saved.take() {
            window.set_fullscreen(false).map_err(|e| e.to_string())?;
            window
                .set_min_size(Some(tauri::LogicalSize::new(480., 420.)))
                .map_err(|e| e.to_string())?;
            if state.maximized {
                window.maximize().map_err(|e| e.to_string())?;
            } else {
                window.unmaximize().map_err(|e| e.to_string())?;
                window.set_size(state.size).map_err(|e| e.to_string())?;
                // Some Wayland compositors reject client positioning; size still restores.
                if let Some(position) = state.position {
                    let _ = window.set_position(position);
                }
            }
            if state.fullscreen {
                window.set_fullscreen(true).map_err(|e| e.to_string())?;
            }
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

#[cfg(test)]
mod tests {
    #[test]
    fn monitor_track_fits_compact_high_dpi_work_area() {
        assert_eq!(super::track_width(1366, 688, 2.), (1223, 1223));
        assert_eq!(super::track_width(1920, 1040, 1.5), (1080, 1848));
        assert_eq!(super::track_width(1440, 900, 1.25), (900, 1440));
    }
}
