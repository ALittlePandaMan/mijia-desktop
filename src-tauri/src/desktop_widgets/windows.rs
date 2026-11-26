//! WorkerW attachment is provided by the plugin. Exclusive mouse routing stays
//! here: the plugin's raw-input forwarding cannot protect Explorer's icon cells.
use super::*;
use crate::widget_layout::PixelRect;
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_wallpaper::{AttachRequest, WallpaperExt};
use windows::{
    core::{w, BOOL},
    Win32::{
        Foundation::*,
        Graphics::Gdi::*,
        System::Com::*,
        UI::{Accessibility::*, Controls::WM_MOUSELEAVE, HiDpi::*, WindowsAndMessaging::*},
    },
};

fn error(_: impl std::fmt::Display) -> AppError {
    AppError::new("desktopWidgetHost", "桌面组件宿主暂不可用。", true)
}
fn wide(s: &[u16]) -> String {
    String::from_utf16_lossy(&s[..s.iter().position(|c| *c == 0).unwrap_or(s.len())])
}
fn handle(n: isize) -> HWND {
    HWND(n as *mut _)
}
#[derive(Clone, Debug)]
pub struct Display {
    pub id: String,
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
    pub scale: f64,
    pub primary: bool,
    pub full: PixelRect,
}
static DISPLAY_CACHE: OnceLock<Mutex<Option<(Instant, Vec<Display>)>>> = OnceLock::new();
pub fn displays() -> Vec<Display> {
    let mut cache = DISPLAY_CACHE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap();
    if let Some((at, screens)) = cache
        .as_ref()
        .filter(|(at, _)| at.elapsed() < Duration::from_millis(250))
    {
        let _ = at;
        return screens.clone();
    }
    let screens = enumerate_displays();
    *cache = Some((Instant::now(), screens.clone()));
    screens
}
fn enumerate_displays() -> Vec<Display> {
    unsafe extern "system" fn visit(m: HMONITOR, _: HDC, _: *mut RECT, p: LPARAM) -> BOOL {
        let out = &mut *(p.0 as *mut Vec<Display>);
        let mut info = MONITORINFOEXW::default();
        info.monitorInfo.cbSize = std::mem::size_of::<MONITORINFOEXW>() as u32;
        if GetMonitorInfoW(m, &mut info.monitorInfo).as_bool() {
            let mut device = DISPLAY_DEVICEW::default();
            device.cb = std::mem::size_of::<DISPLAY_DEVICEW>() as u32;
            let mut name = wide(&info.szDevice);
            if EnumDisplayDevicesW(
                windows::core::PCWSTR(info.szDevice.as_ptr()),
                0,
                &mut device,
                1,
            )
            .as_bool()
            {
                name.push_str(&wide(&device.DeviceID));
            }
            let id = format!("{:x}", Sha256::digest(name.as_bytes()));
            let mut x = 96;
            let mut y = 96;
            let _ = GetDpiForMonitor(m, MDT_EFFECTIVE_DPI, &mut x, &mut y);
            let r = info.monitorInfo.rcWork;
            out.push(Display {
                id,
                full: PixelRect {
                    x: info.monitorInfo.rcMonitor.left as f64,
                    y: info.monitorInfo.rcMonitor.top as f64,
                    width: (info.monitorInfo.rcMonitor.right - info.monitorInfo.rcMonitor.left)
                        as f64,
                    height: (info.monitorInfo.rcMonitor.bottom - info.monitorInfo.rcMonitor.top)
                        as f64,
                },
                x: r.left,
                y: r.top,
                w: r.right - r.left,
                h: r.bottom - r.top,
                scale: x as f64 / 96.,
                primary: info.monitorInfo.dwFlags & 1 != 0,
            });
        }
        BOOL(1)
    }
    let mut out = vec![];
    unsafe {
        let _ = EnumDisplayMonitors(None, None, Some(visit), LPARAM(&mut out as *mut _ as isize));
    }
    out
}
impl Display {
    pub fn rect(&self) -> PixelRect {
        PixelRect {
            x: self.x as f64,
            y: self.y as f64,
            width: self.w as f64,
            height: self.h as f64,
        }
    }
}
pub fn topology() -> String {
    format!("{:?}", displays())
}
pub fn monitors() -> serde_json::Value {
    serde_json::Value::Array(displays().into_iter().map(|d|serde_json::json!({"id":d.id,"x":d.x,"y":d.y,"width":d.w,"height":d.h,"scale":d.scale,"primary":d.primary})).collect())
}
pub fn supported() -> bool {
    unsafe { FindWindowW(w!("Progman"), None).is_ok() }
}
pub fn diagnostics(window: &WebviewWindow) -> serde_json::Value {
    let host = window.hwnd().ok();
    let parent = host
        .map(|h| unsafe { GetAncestor(h, GA_PARENT) })
        .map(class);
    let topmost = host.is_some_and(|h| unsafe {
        GetWindowLongPtrW(h, GWL_EXSTYLE) & WS_EX_TOPMOST.0 as isize != 0
    });
    let input=STATE.get().map(|s|{let last=s.last_callback_ms.load(Ordering::Acquire);let rejected:serde_json::Map<String,serde_json::Value>=REJECT_REASONS.iter().enumerate().map(|(i,name)|(name.to_string(),s.rejected[i].load(Ordering::Relaxed).into())).collect();let icons=s.icons.lock().unwrap();let targets=s.targets.lock().unwrap();serde_json::json!({"iconProtectionValid":icons.valid&&icons.at.elapsed()<Duration::from_millis(1200),"protectedAreas":icons.areas.len(),"targets":targets.len(),"cachedInputRegions":s.regions.lock().unwrap().len(),"hookInstalled":s.hook_installed.load(Ordering::Acquire),"registeredInputRegions":targets.values().filter(|t|!t.regions.is_empty()).count(),"lastCallbackAgoMs":if last==0{None}else{Some((s.started.elapsed().as_millis() as u64).saturating_sub(last-1))},"rejected":rejected,"gestures":*s.trace.lock().unwrap()})});
    let child =
        host.is_some_and(|h| unsafe { GetWindowLongPtrW(h, GWL_STYLE) & WS_CHILD.0 as isize != 0 });
    serde_json::json!({"parentClass":parent,"child":child,"alwaysOnTop":topmost,"bounds":rect(window).ok().map(|r|serde_json::json!({"x":r.left,"y":r.top,"width":r.right-r.left,"height":r.bottom-r.top})),"input":input})
}
pub fn attach(window: &WebviewWindow) -> Result<()> {
    let attach = || {
        window
            .app_handle()
            .wallpaper()
            .attach(AttachRequest::new(window.label()))
    };
    if let Err(first) = attach() {
        // SetParent returns the PREVIOUS parent. A successfully attached former
        // top-level window returns NULL, which windows-rs 0.62 treats as Err.
        // Retry only after proving this exact window is already under WorkerW;
        // the plugin can then finish its own tracking/re-attachment setup.
        let attached = window
            .hwnd()
            .ok()
            .map(|hwnd| unsafe { GetAncestor(hwnd, GA_PARENT) })
            .is_some_and(|parent| class(parent) == "WorkerW");
        if !attached {
            return Err(AppError::new(
                "desktopWidgetAttach",
                format!("桌面层附着失败：{first}"),
                true,
            ));
        }
        attach().map_err(|e| {
            AppError::new("desktopWidgetAttach", format!("桌面层附着失败：{e}"), true)
        })?;
    }
    child_style(window)
}
fn child_style(window: &WebviewWindow) -> Result<()> {
    unsafe {
        let hwnd = window.hwnd().map_err(error)?;
        // SetParent does not convert WS_POPUP into WS_CHILD. GetParent would
        // otherwise return the popup's OWNER, and positioning uses the wrong
        // coordinate space. Complete the documented embedding style change.
        let kind = GetWindowLongPtrW(hwnd, GWL_STYLE);
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE);
        let desired_kind = (kind & !(WS_POPUP.0 as isize)) | WS_CHILD.0 as isize;
        let desired_style = style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize;
        if kind == desired_kind && style == desired_style {
            return Ok(());
        }
        SetWindowLongPtrW(
            hwnd,
            GWL_STYLE,
            (kind & !(WS_POPUP.0 as isize)) | WS_CHILD.0 as isize,
        );
        SetWindowLongPtrW(
            hwnd,
            GWL_EXSTYLE,
            style | WS_EX_NOACTIVATE.0 as isize | WS_EX_TOOLWINDOW.0 as isize,
        );
        SetWindowPos(
            hwnd,
            None,
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_FRAMECHANGED,
        )
        .map_err(error)?;
    }
    Ok(())
}
pub fn show(window: &WebviewWindow) -> Result<()> {
    child_style(window)?;
    unsafe {
        let _ = ShowWindow(window.hwnd().map_err(error)?, SW_SHOWNOACTIVATE);
    }
    child_style(window)
}
pub fn hide(window: &WebviewWindow) {
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            let _ = ShowWindow(hwnd, SW_HIDE);
        }
    }
}
fn set_rect(window: &WebviewWindow, x: i32, y: i32, width: i32, height: i32) -> Result<()> {
    child_style(window)?;
    unsafe {
        let hwnd = window.hwnd().map_err(error)?;
        let parent = GetParent(hwnd).map_err(error)?;
        if class(parent) != "WorkerW" {
            return Err(error("desktop attachment lost"));
        }
        let mut point = [POINT { x, y }];
        MapWindowPoints(None, Some(parent), &mut point);
        SetWindowPos(
            hwnd,
            None,
            point[0].x,
            point[0].y,
            width,
            height,
            SWP_NOACTIVATE | SWP_NOZORDER,
        )
        .map_err(error)?;
    }
    Ok(())
}
pub fn project(g: &Geometry, fit: bool) -> Option<(Display, PixelRect)> {
    project_on(g, fit, &displays())
}
pub fn project_on(g: &Geometry, fit: bool, screens: &[Display]) -> Option<(Display, PixelRect)> {
    let screen = screens.iter().find(|s| s.id == g.monitor)?.clone();
    let actual = if fit {
        g.fit(
            screen.w as f64 / screen.scale,
            screen.h as f64 / screen.scale,
        )
    } else {
        g.clone()
    };
    let r = PixelRect {
        x: screen.x as f64 + actual.x * screen.scale,
        y: screen.y as f64 + actual.y * screen.scale,
        width: actual.actual_width() * screen.scale,
        height: actual.height() * screen.scale,
    };
    Some((screen, r))
}
pub fn fit_geometry(g: &Geometry) -> Result<Geometry> {
    g.validate()?;
    let (s, r) = project(g, true).ok_or_else(|| error("display"))?;
    Ok(Geometry {
        grid: g.grid.clone(),
        size: g.size,
        monitor: s.id,
        x: (r.x - s.x as f64) / s.scale,
        y: (r.y - s.y as f64) / s.scale,
        width: if g.grid.is_some() {
            g.width
        } else if g.size == crate::preferences::CardSize::Large {
            (r.width / s.scale - 12.) / 2.
        } else {
            r.width / s.scale
        },
    })
}
pub fn apply_host(window: &WebviewWindow, r: &PixelRect) -> Result<()> {
    set_rect(
        window,
        r.x.round() as i32,
        r.y.round() as i32,
        r.width.round().max(1.) as i32,
        r.height.round().max(1.) as i32,
    )
}
fn rect(window: &WebviewWindow) -> Result<RECT> {
    let mut r = RECT::default();
    unsafe {
        GetWindowRect(window.hwnd().map_err(error)?, &mut r).map_err(error)?;
    }
    Ok(r)
}
#[derive(Clone)]
pub struct Gesture {
    base_width: f64,
    start: POINT,
    rect: PixelRect,
    scale: f64,
    size: crate::preferences::CardSize,
    sequence: Option<Arc<NativeSequence>>,
    preview: Option<PixelRect>,
    topology: String,
    monitor: String,
}
pub fn begin(geometry: &Geometry, kind: &str) -> Result<Gesture> {
    if kind != "move" {
        return Err(AppError::invalid("无效的组件手势。"));
    }
    let mut start = POINT::default();
    unsafe {
        GetCursorPos(&mut start).map_err(error)?;
    }
    let (screen, rect) = project(geometry, true).ok_or_else(|| error("display"))?;
    Ok(Gesture {
        base_width: geometry.width,
        start,
        rect,
        scale: screen.scale,
        size: geometry.size,
        sequence: None,
        preview: None,
        topology: topology(),
        monitor: geometry.monitor.clone(),
    })
}
pub fn gesture_scale(g: &Gesture) -> f64 {
    g.scale
}
pub fn gesture_sequence(g: &Gesture) -> u64 {
    g.sequence.as_ref().map(|s| s.token).unwrap_or(0)
}
fn gesture_point(g: &Gesture) -> Option<POINT> {
    // Preserve the terminal sample even if the cursor moved again after release.
    if let Some(s) = &g.sequence {
        let (x, y) = s.pointer.point();
        return Some(POINT { x, y });
    }
    // Only legacy gestures without a captured sequence sample the cursor.
    let mut p = POINT::default();
    unsafe {
        GetCursorPos(&mut p).ok()?;
    }
    Some(p)
}
pub fn grid_movement(g: &mut Gesture, layout: &crate::widget_layout::Layout, screens: &[Display]) -> Result<Geometry> {
    let p = gesture_point(g).ok_or_else(AppError::stale)?;
    grid_movement_at(g, layout, p, screens)
}
fn grid_movement_at(
    g: &mut Gesture,
    layout: &crate::widget_layout::Layout,
    p: POINT,
    screens: &[Display],
) -> Result<Geometry> {
    if format!("{:?}", screens) != g.topology {
        return Err(AppError::new(
            "desktopTopologyChanged",
            "显示配置已变化，已取消本次拖动。",
            false,
        ));
    }
    let pointed = screens.iter().find(|s| {
        let r = s.full;
        p.x as f64 >= r.x
            && (p.x as f64) < r.x + r.width
            && p.y as f64 >= r.y
            && (p.y as f64) < r.y + r.height
            && layout.display(&s.id).enabled
    });
    let screen = pointed
        .or_else(|| screens.iter().find(|s| s.id == g.monitor))
        .filter(|s| layout.display(&s.id).enabled)
        .ok_or_else(AppError::stale)?;
    g.monitor = screen.id.clone();
    let grid = super::super::Widgets::grid_for(layout, screen)?;
    let mut physical = PixelRect {
        x: p.x as f64 - (g.start.x as f64 - g.rect.x),
        y: p.y as f64 - (g.start.y as f64 - g.rect.y),
        ..g.rect
    };
    // The pointer may leave the enabled desktop; the card stays on its last screen.
    if pointed.is_none() {
        let r = screen.rect();
        physical.x = physical
            .x
            .clamp(r.x, r.x + (r.width - physical.width).max(0.));
        physical.y = physical
            .y
            .clamp(r.y, r.y + (r.height - physical.height).max(0.));
    }
    if pointed.is_some() {
        // Constrain the complete rectangle before the pointer itself crosses a
        // disabled edge. Adjacent enabled screens remain a continuous desktop.
        let work = screen.rect();
        let full = screen.full;
        let neighbors: Vec<_> = screens
            .iter()
            .filter(|s| s.id != screen.id && layout.display(&s.id).enabled)
            .collect();
        let vertical_overlap = |s: &&Display| {
            physical.y < s.full.y + s.full.height && physical.y + physical.height > s.full.y
        };
        let left = neighbors
            .iter()
            .filter(|s| vertical_overlap(s))
            .any(|s| (s.full.x + s.full.width - full.x).abs() <= 1.);
        let right = neighbors
            .iter()
            .filter(|s| vertical_overlap(s))
            .any(|s| (s.full.x - full.x - full.width).abs() <= 1.);
        if !left {
            physical.x = physical.x.max(work.x);
        }
        if !right {
            physical.x = physical
                .x
                .min(work.x + (work.width - physical.width).max(0.));
        }
        let horizontal_overlap = |s: &&Display| {
            physical.x < s.full.x + s.full.width && physical.x + physical.width > s.full.x
        };
        let top = neighbors
            .iter()
            .filter(|s| horizontal_overlap(s))
            .any(|s| (s.full.y + s.full.height - full.y).abs() <= 1.);
        let bottom = neighbors
            .iter()
            .filter(|s| horizontal_overlap(s))
            .any(|s| (s.full.y - full.y - full.height).abs() <= 1.);
        if !top {
            physical.y = physical.y.max(work.y);
        }
        if !bottom {
            physical.y = physical
                .y
                .min(work.y + (work.height - physical.height).max(0.));
        }
    }
    let mut next = grid.geometry(&screen.id, grid.nearest(g.size, 0., 0.));
    next.x = (physical.x - screen.x as f64) / screen.scale;
    next.y = (physical.y - screen.y as f64) / screen.scale;
    g.preview = Some(physical);
    Ok(next)
}
pub fn drop_allowed(g: &Gesture) -> bool {
    // A release outside enabled screens commits the last clamped candidate.
    gesture_point(g).is_some()
}
pub fn candidate(owner: &str) -> bool {
    STATE.get().is_some_and(|s| {
        s.sequence.lock().unwrap().as_ref().is_some_and(|q| {
            q.owner == owner && {
                let (down, cancel, _) = q.pointer.status(q.elapsed());
                down && !cancel
            }
        })
    })
}
pub fn gesture_preview(g: &Gesture) -> Option<PixelRect> {
    g.preview
}
#[derive(Clone)]
struct Target {
    base_width: f64,
    widget_id: String,
    owner: String,
    host: isize,
    z: usize,
    radius: f64,
    input: isize,
    rect: RECT,
    regions: Vec<(String, PixelRect)>,
}
struct NativeSequence {
    base_width: f64,
    scale: f64,
    rect: PixelRect,
    token: u64,
    owner: String,
    id: String,
    start: POINT,
    at: Instant,
    pointer: crate::widget_pointer::PointerSequence,
}
impl NativeSequence {
    fn elapsed(&self) -> u64 {
        self.at.elapsed().as_millis() as u64
    }
}
#[derive(Clone)]
pub struct PointerSession(Arc<NativeSequence>);
impl PointerSession {
    pub fn token(&self) -> u64 {
        self.0.token
    }
    pub fn status(&self) -> (bool, bool, bool) {
        if self.0.elapsed() > 60_000 && self.0.pointer.status(self.0.elapsed()).0 {
            self.0.pointer.cancel();
        }
        self.0.pointer.status(self.0.elapsed())
    }
}
pub fn activate_native(g: &mut Gesture, session: &PointerSession) -> bool {
    if !session.0.pointer.activate() {
        return false;
    }
    g.start = session.0.start;
    g.rect = session.0.rect;
    g.base_width = session.0.base_width;
    g.scale = session.0.scale;
    g.sequence = Some(session.0.clone());
    true
}
pub fn gesture_base_width(g: &Gesture) -> f64 {
    g.base_width
}
pub fn cancel_native(token: u64) {
    if let Some(state) = STATE.get() {
        trace(state, "finished", token);
        if let Some(s) = state
            .sequence
            .lock()
            .unwrap()
            .as_ref()
            .filter(|s| s.token == token)
        {
            s.pointer.cancel();
        }
    }
}
fn cancel_sequence() {
    if let Some(state) = STATE.get() {
        if let Some(s) = state.sequence.lock().unwrap().as_ref() {
            s.pointer.cancel();
            trace(state, "cancel-session", s.token);
        }
    }
}
struct Icons {
    areas: Vec<RECT>,
    at: Instant,
    valid: bool,
}
struct State {
    targets: Mutex<HashMap<String, Target>>,
    regions: Mutex<crate::desktop_widgets::input_regions::InputRegions>,
    sequence: Mutex<Option<Arc<NativeSequence>>>,
    sequence_id: std::sync::atomic::AtomicU64,
    icons: Mutex<Icons>,
    stop: AtomicBool,
    hook_installed: AtomicBool,
    dirty: AtomicBool,
    thread: std::sync::atomic::AtomicU32,
    scan_wake: std::sync::Condvar,
    scan_lock: Mutex<()>,
    has_menu: AtomicBool,
    dismiss: tokio::sync::mpsc::UnboundedSender<()>,
    gestures: tokio::sync::mpsc::UnboundedSender<(String, String, PointerSession, String)>,
    activity: tokio::sync::mpsc::Sender<()>,
    started: Instant,
    last_callback_ms: std::sync::atomic::AtomicU64,
    rejected: [std::sync::atomic::AtomicU64; 7],
    trace: Mutex<std::collections::VecDeque<InputTrace>>,
}
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct InputTrace {
    phase: &'static str,
    token: u64,
    at_ms: u64,
}
const REJECT_REASONS: [&str; 7] = [
    "covered",
    "iconProtectionUnavailable",
    "iconProtected",
    "hitTableBusy",
    "sequenceBusy",
    "noCardHit",
    "missingRegions",
];
fn reject(state: &State, reason: usize) {
    state.rejected[reason].fetch_add(1, Ordering::Relaxed);
}
fn trace(state: &State, phase: &'static str, token: u64) {
    if let Ok(mut rows) = state.trace.try_lock() {
        if rows.len() >= 64 {
            rows.pop_front();
        }
        rows.push_back(InputTrace {
            phase,
            token,
            at_ms: state.started.elapsed().as_millis() as u64,
        });
    }
}
static STATE: OnceLock<Arc<State>> = OnceLock::new();
fn class(hwnd: HWND) -> String {
    let mut c = [0u16; 128];
    let n = unsafe { GetClassNameW(hwnd, &mut c) };
    String::from_utf16_lossy(&c[..n as usize])
}
fn child(root: HWND, name: &str) -> Option<HWND> {
    struct Search<'a> {
        name: &'a str,
        found: Option<HWND>,
    }
    unsafe extern "system" fn visit(hwnd: HWND, l: LPARAM) -> BOOL {
        let s = &mut *(l.0 as *mut Search<'_>);
        if class(hwnd) == s.name {
            s.found = Some(hwnd);
            BOOL(0)
        } else {
            BOOL(1)
        }
    }
    let mut search = Search { name, found: None };
    unsafe {
        let _ = EnumChildWindows(
            Some(root),
            Some(visit),
            LPARAM(&mut search as *mut _ as isize),
        );
    }
    search.found
}
fn desktop_list() -> Option<HWND> {
    unsafe extern "system" fn visit(hwnd: HWND, l: LPARAM) -> BOOL {
        if !matches!(class(hwnd).as_str(), "Progman" | "WorkerW") {
            return BOOL(1);
        }
        let found = &mut *(l.0 as *mut Option<HWND>);
        if let Some(view) = child(hwnd, "SHELLDLL_DefView") {
            if let Some(list) = child(view, "SysListView32") {
                *found = Some(list);
                return BOOL(0);
            }
        }
        BOOL(1)
    }
    let mut found = None;
    unsafe {
        let _ = EnumWindows(Some(visit), LPARAM(&mut found as *mut _ as isize));
    }
    found
}
pub fn set_regions(
    owner: &str,
    id: &str,
    regions: Vec<(String, PixelRect)>,
    presentation: Option<PixelRect>,
) -> Result<()> {
    let state = STATE.get().ok_or_else(AppError::stale)?;
    let key = format!("{owner}#{id}");
    state
        .regions
        .lock()
        .unwrap()
        .remember(key.clone(), regions.clone());
    if let Some(t) = state.targets.lock().unwrap().get_mut(&key) {
        t.regions = regions;
        if let Some(r) = presentation {
            t.rect = RECT {
                left: r.x.round() as i32,
                top: r.y.round() as i32,
                right: (r.x + r.width).round() as i32,
                bottom: (r.y + r.height).round() as i32,
            };
        }
    }
    wake(state);
    Ok(())
}
unsafe fn covered_at(p: POINT) -> bool {
    !matches!(
        class(GetAncestor(WindowFromPoint(p), GA_ROOT)).as_str(),
        "Progman" | "WorkerW"
    )
}
pub fn set_targets(window: &WebviewWindow, rows: Vec<(String, PixelRect, f64, f64, usize)>) {
    if let Some(state) = STATE.get() {
        if let Ok(hwnd) = window.hwnd() {
            let input = child(hwnd, "Chrome_WidgetWin_1").unwrap_or(hwnd);
            // Validate the forwarding destination outside the low-level hook.
            let belongs = unsafe { input == hwnd || IsChild(hwnd, input).as_bool() };
            if !belongs {
                return;
            }
            let mut targets = state.targets.lock().unwrap();
            let was_empty = targets.is_empty();
            let regions = state.regions.lock().unwrap();
            let prefix = format!("{}#", window.label());
            targets.retain(|key, _| !key.starts_with(&prefix));
            for (id, r, radius, base_width, z) in rows {
                targets.insert(
                    format!("{prefix}{id}"),
                    Target {
                        base_width,
                        regions: regions.target(&format!("{prefix}{id}")),
                        widget_id: id,
                        owner: window.label().into(),
                        host: hwnd.0 as isize,
                        input: input.0 as isize,
                        radius,
                        z,
                        rect: RECT {
                            left: r.x.round() as i32,
                            top: r.y.round() as i32,
                            right: (r.x + r.width).round() as i32,
                            bottom: (r.y + r.height).round() as i32,
                        },
                    },
                );
            }
            state.has_menu.store(
                targets.values().any(|t| t.z == usize::MAX),
                Ordering::Release,
            );
            let scan_changed = was_empty != targets.is_empty();
            drop(regions);
            drop(targets);
            if scan_changed {
                notify_scan(state);
            }
            wake(state);
        }
    }
}
fn target_hit(t: &Target, p: POINT) -> bool {
    crate::widget_layout::rounded_hit(
        (p.x - t.rect.left) as f64,
        (p.y - t.rect.top) as f64,
        (t.rect.right - t.rect.left) as f64,
        (t.rect.bottom - t.rect.top) as f64,
        t.radius,
    )
}
fn wake(state: &State) {
    let id = state.thread.load(Ordering::Acquire);
    if id != 0 {
        unsafe {
            let _ = PostThreadMessageW(id, WM_APP + 17, WPARAM(0), LPARAM(0));
        }
    }
}
fn notify_scan(state: &State) {
    let _scan = state.scan_lock.lock().unwrap();
    state.scan_wake.notify_all();
}
pub fn forget_widget(id: &str) {
    if let Some(s) = STATE.get() {
        if let Some(seq) = s
            .sequence
            .lock()
            .unwrap()
            .as_ref()
            .filter(|seq| seq.id == id)
        {
            seq.pointer.cancel();
            trace(s, "cancel-unpinned", seq.token);
        }
        s.targets.lock().unwrap().retain(|_, t| t.widget_id != id);
        s.regions.lock().unwrap().remove_widget(id);
        notify_scan(s);
        wake(s);
    }
}
pub fn unregister(label: &str) {
    if let Some(s) = STATE.get() {
        if let Some(seq) = s
            .sequence
            .lock()
            .unwrap()
            .as_ref()
            .filter(|seq| seq.owner == label)
        {
            seq.pointer.cancel();
            trace(s, "cancel-host", seq.token);
        }
        let prefix = format!("{label}#");
        s.targets
            .lock()
            .unwrap()
            .retain(|key, _| !key.starts_with(&prefix));
        s.regions.lock().unwrap().remove_host(label);
        notify_scan(s);
        wake(s);
    }
}
/// Native desktop evidence can wake a covered/suspended renderer. No COM or
/// network work; the same icon protection and window checks gate normal input.
pub fn hover_target() -> Option<(String, String)> {
    let s = STATE.get()?;
    if s.stop.load(Ordering::Acquire) {
        return None;
    }
    let mut p = POINT::default();
    unsafe {
        GetCursorPos(&mut p).ok()?;
        if covered_at(p) {
            return None;
        }
    }
    // A press admitted on the desktop owns its entire sequence. While moving,
    // its card intentionally leaves the ordinary hit table; retain native
    // evidence so a suspended owner can still resume and render the gesture.
    if let Some(seq) = s.sequence.try_lock().ok().and_then(|seq| seq.clone()) {
        let (down, cancel, _) = seq.pointer.status(seq.elapsed());
        if down && !cancel {
            return Some((seq.owner.clone(), seq.id.clone()));
        }
    }
    let icons = s.icons.try_lock().ok()?;
    if !icons.valid
        || icons.at.elapsed() > Duration::from_millis(1200)
        || s.dirty.load(Ordering::Acquire)
        || icons.areas.iter().any(|r| contains(r, p))
    {
        return None;
    }
    drop(icons);
    let targets = s.targets.try_lock().ok()?;
    targets
        .values()
        .filter(|t| target_hit(t, p))
        .max_by_key(|t| t.z)
        .map(|t| (t.owner.clone(), t.widget_id.clone()))
}

pub fn stop() {
    if let Some(s) = STATE.get() {
        cancel_sequence();
        s.stop.store(true, Ordering::Release);
        s.targets.lock().unwrap().clear();
        s.regions.lock().unwrap().clear();
        notify_scan(s);
        wake(s);
    }
}
fn contains(r: &RECT, p: POINT) -> bool {
    p.x >= r.left && p.x < r.right && p.y >= r.top && p.y < r.bottom
}
unsafe fn icon_snapshot(automation: &IUIAutomation) -> windows::core::Result<Vec<RECT>> {
    let list = desktop_list().ok_or_else(windows::core::Error::from_thread)?;
    if !IsWindowVisible(list).as_bool() {
        return Ok(vec![]);
    }
    let mut expected = 0usize;
    if SendMessageTimeoutW(
        list,
        0x1004,
        WPARAM(0),
        LPARAM(0),
        SMTO_ABORTIFHUNG,
        100,
        Some(&mut expected),
    )
    .0 == 0
    {
        return Err(windows::core::Error::from_thread());
    }
    if expected > 10000 {
        return Err(windows::core::Error::from_thread());
    }
    let root = automation.ElementFromHandle(list)?;
    let items = root.FindAll(TreeScope_Children, &automation.CreateTrueCondition()?)?;
    let mut result = vec![];
    for index in 0..items.Length()?.min(10000) {
        let item = items.GetElement(index)?;
        if item.CurrentControlType()? == UIA_ListItemControlTypeId {
            let mut r = item.CurrentBoundingRectangle()?;
            r.left -= 2;
            r.top -= 2;
            r.right += 2;
            r.bottom += 2;
            result.push(r);
        }
    }
    if result.len() < expected {
        return Err(windows::core::Error::from_thread());
    }
    Ok(result)
}
unsafe extern "system" fn changed(
    _: HWINEVENTHOOK,
    event: u32,
    hwnd: HWND,
    _: i32,
    _: i32,
    _: u32,
    _: u32,
) {
    if event == EVENT_SYSTEM_DESKTOPSWITCH {
        cancel_sequence();
        CAPTURE.with(|c| {
            if let Some((target, _, sequence)) = c.borrow_mut().take() {
                if let Some(sequence) = sequence {
                    sequence.pointer.cancel();
                }
                let _ = PostMessageW(
                    Some(handle(target.input)),
                    WM_CANCELMODE,
                    WPARAM(0),
                    LPARAM(0),
                );
            }
        });
    }
    if let Some(s) = STATE.get() {
        if event == EVENT_SYSTEM_DESKTOPSWITCH
            || matches!(
                class(hwnd).as_str(),
                "SysListView32" | "SHELLDLL_DefView" | "Progman" | "WorkerW"
            )
        {
            s.dirty.store(true, Ordering::Release);
            s.scan_wake.notify_one();
        }
    }
}
thread_local! {static HOVER:std::cell::RefCell<Option<Target>>=const{std::cell::RefCell::new(None)};}
thread_local! {static CAPTURE:std::cell::RefCell<Option<(Target,u32,Option<Arc<NativeSequence>>)>>=const{std::cell::RefCell::new(None)};}
struct HoverUpdate(Option<Target>);
impl Drop for HoverUpdate {
    fn drop(&mut self) {
        let changed = HOVER.with(|h| {
            let mut old = h.borrow_mut();
            let both_empty = old.is_none() && self.0.is_none();
            let same = both_empty
                || old
                    .as_ref()
                    .zip(self.0.as_ref())
                    .is_some_and(|(a, b)| a.host == b.host && a.widget_id == b.widget_id);
            if !same {
                if let Some(t) = old.as_ref() {
                    unsafe {
                        let _ = post(
                            t,
                            WM_MOUSEMOVE,
                            POINT {
                                x: t.rect.left - 40,
                                y: t.rect.top - 40,
                            },
                            0,
                        );
                        let _ = PostMessageW(
                            Some(handle(t.input)),
                            WM_MOUSELEAVE,
                            WPARAM(0),
                            LPARAM(0),
                        );
                    }
                }
            }
            *old = self.0.take();
            !same
        });
        if changed {
            if let Some(s) = STATE.get() {
                let _ = s.activity.try_send(());
            }
        }
    }
}
unsafe fn post(target: &Target, msg: u32, p: POINT, buttons: usize) -> bool {
    let mut local = p;
    let _ = ScreenToClient(handle(target.input), &mut local);
    let packed = ((local.y as u32 & 0xffff) << 16) | (local.x as u32 & 0xffff);
    PostMessageW(
        Some(handle(target.input)),
        msg,
        WPARAM(buttons),
        LPARAM(packed as i32 as isize),
    )
    .is_ok()
}
unsafe extern "system" fn mouse(code: i32, msg: WPARAM, data: LPARAM) -> LRESULT {
    if code < 0 {
        return CallNextHookEx(None, code, msg, data);
    }
    let Some(state) = STATE.get() else {
        return CallNextHookEx(None, code, msg, data);
    };
    state.last_callback_ms.store(
        state.started.elapsed().as_millis() as u64 + 1,
        Ordering::Release,
    );
    let event = &*(data.0 as *const MSLLHOOKSTRUCT);
    let message = msg.0 as u32;
    if matches!(message, WM_LBUTTONDOWN | WM_RBUTTONDOWN) && state.has_menu.load(Ordering::Acquire)
    {
        let on_desktop = matches!(
            class(GetAncestor(WindowFromPoint(event.pt), GA_ROOT)).as_str(),
            "Progman" | "WorkerW"
        );
        let inside = state.targets.try_lock().ok().is_some_and(|targets| {
            targets
                .values()
                .any(|t| t.z == usize::MAX && contains(&t.rect, event.pt))
        });
        if (!on_desktop || !inside) && state.has_menu.swap(false, Ordering::AcqRel) {
            let _ = state.dismiss.send(());
        }
    }
    if state.stop.load(Ordering::Acquire) {
        CAPTURE.with(|c| *c.borrow_mut() = None);
        return CallNextHookEx(None, code, msg, data);
    }
    let mut hover = if message == WM_MOUSEMOVE && CAPTURE.with(|c| c.borrow().is_none()) {
        Some(HoverUpdate(None))
    } else {
        None
    };
    // Continue the sequence even outside the card, so drag release is not lost.
    let captured = CAPTURE.with(|c| c.borrow().clone());
    if let Some((target, button, captured_sequence)) = captured {
        if matches!(message, WM_LBUTTONDOWN | WM_RBUTTONDOWN) {
            return LRESULT(1);
        }
        if message == WM_MOUSEMOVE || message == WM_LBUTTONUP || message == WM_RBUTTONUP {
            let released = message == WM_LBUTTONUP && button == WM_LBUTTONDOWN
                || message == WM_RBUTTONUP && button == WM_RBUTTONDOWN;
            if message != WM_MOUSEMOVE && !released {
                return LRESULT(1);
            }
            let native_active = captured_sequence.as_ref().is_some_and(|s| {
                s.pointer.sample((event.pt.x, event.pt.y), s.elapsed());
                // The worker can retire a sequence as soon as release is
                // published. Preserve the tap/drag decision before that race.
                let suppress = s.pointer.suppress_click(s.elapsed());
                if released {
                    if covered_at(event.pt) {
                        s.pointer.cancel();
                        trace(state, "cancel-covered", s.token);
                    }
                    s.pointer.release((event.pt.x, event.pt.y));
                    trace(state, "released", s.token);
                }
                suppress
            });
            let covered = released
                && !matches!(
                    class(GetAncestor(WindowFromPoint(event.pt), GA_ROOT)).as_str(),
                    "Progman" | "WorkerW"
                );
            let point = if covered {
                POINT {
                    x: target.rect.left - 2,
                    y: target.rect.top - 2,
                }
            } else {
                event.pt
            };
            let sent = if native_active && released {
                // Retire Chromium's pressed state without generating a card click.
                post(
                    &target,
                    message,
                    POINT {
                        x: target.rect.left - 40,
                        y: target.rect.top - 40,
                    },
                    0,
                )
            } else {
                post(
                    &target,
                    message,
                    point,
                    if released {
                        0
                    } else if button == WM_LBUTTONDOWN {
                        1
                    } else {
                        2
                    },
                )
            };
            let owns_native = captured_sequence.as_ref().is_some_and(|s| {
                let (down, cancel, _) = s.pointer.status(s.elapsed());
                down && !cancel
            });
            if released || (!sent && !owns_native) {
                if !sent && !owns_native {
                    if let Some(s) = &captured_sequence {
                        s.pointer.cancel();
                    }
                }
                CAPTURE.with(|c| *c.borrow_mut() = None);
            }
            if sent || owns_native || native_active {
                // Never suppress physical movement. WH_MOUSE_LL runs before the
                // cursor advances; swallowing it freezes the cursor and makes
                // subsequent relative packets oscillate around the press point.
                // Explorer never received our button-down, so passing movement
                // through cannot start its selection/drag sequence.
                if message == WM_MOUSEMOVE {
                    return CallNextHookEx(None, code, msg, data);
                }
                return LRESULT(1);
            }
        }
    }
    if state.stop.load(Ordering::Acquire) {
        return CallNextHookEx(None, code, msg, data);
    }
    if !matches!(message, WM_LBUTTONDOWN | WM_RBUTTONDOWN | WM_MOUSEMOVE) {
        return CallNextHookEx(None, code, msg, data);
    }
    let hit = WindowFromPoint(event.pt);
    let root = GetAncestor(hit, GA_ROOT);
    if !matches!(class(root).as_str(), "Progman" | "WorkerW") {
        reject(state, 0);
        return CallNextHookEx(None, code, msg, data);
    }
    let Ok(icons) = state.icons.try_lock() else {
        reject(state, 1);
        return CallNextHookEx(None, code, msg, data);
    };
    if !icons.valid
        || icons.at.elapsed() > Duration::from_millis(1200)
        || state.dirty.load(Ordering::Acquire)
    {
        reject(state, 1);
        return CallNextHookEx(None, code, msg, data);
    }
    if icons.areas.iter().any(|r| contains(r, event.pt)) {
        reject(state, 2);
        return CallNextHookEx(None, code, msg, data);
    }
    drop(icons);
    let Ok(targets) = state.targets.try_lock() else {
        reject(state, 3);
        return CallNextHookEx(None, code, msg, data);
    };
    let target = targets
        .values()
        .filter(|t| target_hit(t, event.pt))
        // One interactive host per display; mirrors are noninteractive. Its
        // card z-order is already computed outside the hook.
        .max_by_key(|t| t.z)
        .cloned();
    drop(targets);
    if target.is_none() {
        reject(state, 5);
    }
    if let Some(target) = target {
        let mut native_request = None;
        let mut captured_sequence = None;
        if message == WM_LBUTTONDOWN && target.widget_id != "menu" {
            let x = (event.pt.x - target.rect.left) as f64
                / (target.rect.right - target.rect.left) as f64;
            let y = (event.pt.y - target.rect.top) as f64
                / (target.rect.bottom - target.rect.top) as f64;
            let excluded = target.regions.iter().any(|(kind, r)| {
                kind == "control" && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height
            });
            if !excluded && target.regions.is_empty() {
                reject(state, 6);
            }
            if !excluded && !target.regions.is_empty() {
                let token = state.sequence_id.fetch_add(1, Ordering::Relaxed) + 1;
                let Ok(mut sequence) = state.sequence.try_lock() else {
                    reject(state, 4);
                    return CallNextHookEx(None, code, msg, data);
                };
                if let Some(previous) = sequence.as_ref() {
                    if previous.pointer.status(previous.elapsed()).0 {
                        previous.pointer.cancel();
                    }
                }
                let current = Arc::new(NativeSequence {
                    base_width: target.base_width,
                    scale: target.radius / 20.,
                    token,
                    rect: PixelRect {
                        x: target.rect.left as f64,
                        y: target.rect.top as f64,
                        width: (target.rect.right - target.rect.left) as f64,
                        height: (target.rect.bottom - target.rect.top) as f64,
                    },
                    owner: target.owner.clone(),
                    id: target.widget_id.clone(),
                    start: event.pt,
                    at: Instant::now(),
                    pointer: crate::widget_pointer::PointerSequence::new(
                        (event.pt.x, event.pt.y),
                        target.radius / 20.,
                    ),
                });
                *sequence = Some(current.clone());
                captured_sequence = Some(current.clone());
                drop(sequence);
                native_request = Some((
                    target.owner.clone(),
                    target.widget_id.clone(),
                    PointerSession(current),
                    "move".into(),
                ));
            }
        }
        let native_owned = native_request.is_some();
        if let Some(request) = native_request {
            trace(state, "candidate", request.2.token());
            let _ = state.activity.try_send(());
            let _ = state.gestures.send(request);
        }
        let sent = post(
            &target,
            message,
            event.pt,
            if message == WM_LBUTTONDOWN {
                1
            } else if message == WM_RBUTTONDOWN {
                2
            } else {
                0
            },
        );
        if sent || native_owned {
            if message == WM_MOUSEMOVE {
                let _ = state.activity.try_send(());
                if let Some(h) = hover.as_mut() {
                    h.0 = Some(target.clone());
                }
            }
            if message != WM_MOUSEMOVE {
                CAPTURE.with(|c| *c.borrow_mut() = Some((target, message, captured_sequence)));
                return LRESULT(1);
            }
        }
    }
    CallNextHookEx(None, code, msg, data)
}
pub fn install(app: tauri::AppHandle) {
    let (dismiss, mut dismissed) = tokio::sync::mpsc::unbounded_channel();
    let menu_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while dismissed.recv().await.is_some() {
            let _ = menu_app.emit("desktop-widget-menu-dismiss", ());
        }
    });
    let (gestures, mut incoming) = tokio::sync::mpsc::unbounded_channel();
    let gesture_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while let Some((owner, id, session, kind)) = incoming.recv().await {
            super::super::start_native_gesture(gesture_app.clone(), owner, id, session, kind);
        }
    });
    let (activity, mut activity_events) = tokio::sync::mpsc::channel(1);
    let activity_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while activity_events.recv().await.is_some() {
            activity_app
                .state::<Arc<crate::resources::Resources>>()
                .wake_hint();
            tokio::time::sleep(Duration::from_millis(100)).await;
        }
    });
    let state = Arc::new(State {
        targets: Mutex::new(HashMap::new()),
        regions: Mutex::new(Default::default()),
        sequence: Mutex::new(None),
        sequence_id: std::sync::atomic::AtomicU64::new(0),
        icons: Mutex::new(Icons {
            areas: vec![],
            at: Instant::now(),
            valid: false,
        }),
        stop: AtomicBool::new(false),
        hook_installed: AtomicBool::new(false),
        dirty: AtomicBool::new(true),
        thread: std::sync::atomic::AtomicU32::new(0),
        scan_wake: std::sync::Condvar::new(),
        scan_lock: Mutex::new(()),
        has_menu: AtomicBool::new(false),
        dismiss,
        gestures,
        activity,
        trace: Mutex::new(std::collections::VecDeque::with_capacity(64)),
        started: Instant::now(),
        last_callback_ms: std::sync::atomic::AtomicU64::new(0),
        rejected: std::array::from_fn(|_| std::sync::atomic::AtomicU64::new(0)),
    });
    if STATE.set(state.clone()).is_err() {
        return;
    }
    let scan = state.clone();
    std::thread::spawn(move || unsafe {
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let mut automation: Option<IUIAutomation> = None;
        while !scan.stop.load(Ordering::Acquire) {
            let mut lock = scan.scan_lock.lock().unwrap();
            while scan.targets.lock().unwrap().is_empty() && !scan.stop.load(Ordering::Acquire) {
                automation = None;
                scan.icons.lock().unwrap().valid = false;
                lock = scan.scan_wake.wait(lock).unwrap();
            }
            drop(lock);
            if scan.stop.load(Ordering::Acquire) {
                break;
            }
            if automation.is_none() {
                automation = CoCreateInstance(&CUIAutomation, None, CLSCTX_INPROC_SERVER).ok();
            }
            scan.dirty.store(false, Ordering::Release);
            let result = automation.as_ref().and_then(|a| icon_snapshot(a).ok());
            {
                let mut icons = scan.icons.lock().unwrap();
                icons.valid = result.is_some();
                icons.areas = result.unwrap_or_default();
                icons.at = Instant::now();
            }
            wake(&scan);
            let lock = scan.scan_lock.lock().unwrap();
            if !scan.targets.lock().unwrap().is_empty() && !scan.stop.load(Ordering::Acquire) {
                let _ = scan.scan_wake.wait_timeout(lock, Duration::from_secs(1));
            }
        }
        drop(automation);
        CoUninitialize();
    });
    std::thread::spawn(move || unsafe {
        let mut initial = MSG::default();
        let _ = PeekMessageW(&mut initial, None, 0, 0, PM_NOREMOVE);
        state.thread.store(
            windows_sys::Win32::System::Threading::GetCurrentThreadId(),
            Ordering::Release,
        );
        let mut hook = None;
        let mut events = None;
        let mut desktop = None;
        while !state.stop.load(Ordering::Acquire) {
            let active =
                !state.targets.lock().unwrap().is_empty() || CAPTURE.with(|c| c.borrow().is_some());
            if active && events.is_none() {
                events = Some(SetWinEventHook(
                    EVENT_OBJECT_CREATE,
                    EVENT_OBJECT_LOCATIONCHANGE,
                    None,
                    Some(changed),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                ));
                desktop = Some(SetWinEventHook(
                    EVENT_SYSTEM_DESKTOPSWITCH,
                    EVENT_SYSTEM_DESKTOPSWITCH,
                    None,
                    Some(changed),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT,
                ));
            }
            if active && hook.is_none() {
                match SetWindowsHookExW(WH_MOUSE_LL, Some(mouse), None, 0) {
                    Ok(h) => {
                        hook = Some(h);
                        state.hook_installed.store(true, Ordering::Release);
                    }
                    Err(_) => {
                        let _ =
                            app.emit_to("main", "desktop-widget-error", "桌面组件输入暂不可用。");
                    }
                }
            }
            if !active {
                if let Some(h) = events.take() {
                    let _ = UnhookWinEvent(h);
                }
                if let Some(h) = desktop.take() {
                    let _ = UnhookWinEvent(h);
                }
                if let Some(h) = hook.take() {
                    let _ = UnhookWindowsHookEx(h);
                    state.hook_installed.store(false, Ordering::Release);
                }
            }
            let mut msg = MSG::default();
            CAPTURE.with(|capture| {
                let mut capture = capture.borrow_mut();
                if capture.as_ref().is_some_and(|(_, _, s)| {
                    s.as_ref().is_some_and(|s| s.pointer.status(s.elapsed()).1)
                }) {
                    if let Some((target, _, _)) = capture.take() {
                        let _ = PostMessageW(
                            Some(handle(target.input)),
                            WM_CANCELMODE,
                            WPARAM(0),
                            LPARAM(0),
                        );
                    }
                }
            });
            while PeekMessageW(&mut msg, None, 0, 0, PM_REMOVE).as_bool() {
                let _ = TranslateMessage(&msg);
                DispatchMessageW(&msg);
            }
            let _ = MsgWaitForMultipleObjectsEx(
                None,
                if active { 1000 } else { u32::MAX },
                QS_ALLINPUT,
                MWMO_INPUTAVAILABLE,
            );
        }
        if let Some(hook) = hook {
            let _ = UnhookWindowsHookEx(hook);
        }
        if let Some(h) = events {
            let _ = UnhookWinEvent(h);
        }
        if let Some(h) = desktop {
            let _ = UnhookWinEvent(h);
        }
    });
}
#[cfg(test)]
mod display_tests {
    use super::*;
    use crate::{preferences::CardSize, widget_grid::Anchor, widget_layout::Layout};
    fn screen(id: &str, x: i32, scale: f64) -> Display {
        Display {
            id: id.into(),
            x,
            y: 0,
            w: 1920,
            h: 1040,
            scale,
            primary: x == 0,
            full: PixelRect {
                x: x as f64,
                y: 0.,
                width: 1920.,
                height: 1080.,
            },
        }
    }
    fn setup() -> (Gesture, Layout, Vec<Display>) {
        let screens = vec![screen("a", 0, 1.25), screen("b", 1920, 1.5)];
        let mut layout = Layout::default();
        for s in &screens {
            layout.displays.entry(s.id.clone()).or_default().enabled = true;
        }
        let grid = super::super::super::Widgets::grid_for(&layout, &screens[0]).unwrap();
        let geometry = grid.geometry(
            "a",
            Anchor {
                column: 2,
                half_row: 2,
                size: CardSize::Medium,
            },
        );
        let (_, rect) = project_on(&geometry, false, &screens).unwrap();
        let g = Gesture {
            base_width: geometry.width,
            start: POINT {
                x: rect.x as i32 + 50,
                y: rect.y as i32 + 40,
            },
            rect,
            scale: 1.25,
            size: CardSize::Medium,
            sequence: None,
            preview: None,
            topology: format!("{:?}", screens),
            monitor: "a".into(),
        };
        (g, layout, screens)
    }
    #[test]
    fn crossing_keeps_one_physical_rectangle_and_grab_offset() {
        let (mut g, layout, screens) = setup();
        let size = (g.rect.width, g.rect.height);
        for x in [1800, 1919, 1920, 1950, 2100, 1950, 1919, 1800] {
            let next = grid_movement_at(&mut g, &layout, POINT { x, y: 400 }, &screens).unwrap();
            let r = g.preview.unwrap();
            assert_eq!((r.width, r.height), size);
            assert!((r.x - (x as f64 - 50.)).abs() < 1.);
            assert_eq!(next.monitor, if x < 1920 { "a" } else { "b" });
            let widths: f64 = screens
                .iter()
                .filter_map(|s| r.intersection(&s.rect()))
                .map(|r| r.width)
                .sum();
            assert!((widths - r.width).abs() < 1e-6);
        }
    }
    #[test]
    fn disabled_display_clamps_and_hotplug_cancels() {
        let (mut g, mut layout, screens) = setup();
        layout.displays.get_mut("b").unwrap().enabled = false;
        for x in [1895, 1910, 1919, 1920, 2400] {
            let next = grid_movement_at(&mut g, &layout, POINT { x, y: 400 }, &screens).unwrap();
            assert_eq!(next.monitor, "a");
            let r = g.preview.unwrap();
            assert!((r.x + r.width - 1920.).abs() < 1e-6);
            assert!(r.intersection(&screens[1].rect()).is_none());
        }
        assert!(
            grid_movement_at(&mut g, &layout, POINT { x: 200, y: 200 }, &screens[..1]).is_err()
        );
    }
    #[test]
    fn redrag_inherits_visible_cross_screen_rectangle_and_content_basis() {
        let (mut g, _, _) = setup();
        let rect = PixelRect {
            x: 1800.,
            y: 180.,
            width: 300.,
            height: 240.,
        };
        let session = PointerSession(Arc::new(NativeSequence {
            base_width: 240.,
            scale: 1.25,
            rect,
            token: 2,
            owner: "target-host".into(),
            id: "drag".into(),
            start: POINT { x: 1940, y: 200 },
            at: Instant::now(),
            pointer: crate::widget_pointer::PointerSequence::new((1940, 200), 1.25),
        }));
        session.0.pointer.release((1960, 200));
        assert!(activate_native(&mut g, &session));
        assert_eq!(g.rect, rect);
        assert_eq!(gesture_base_width(&g), 240.);
        assert_eq!(gesture_scale(&g), 1.25);
        assert_eq!(gesture_point(&g).unwrap().x, 1960);
    }
}
