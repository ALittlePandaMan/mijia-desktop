use crate::{
    error::{AppError, Result},
    widget_layout::Geometry,
};
use tauri::WebviewWindow;
#[cfg(windows)]
#[path = "windows.rs"]
mod native;
#[cfg(windows)]
pub use native::*;
#[cfg(not(windows))]
mod fallback {
    use super::*;
    use crate::widget_layout::PixelRect;
    pub fn show(_: &WebviewWindow) -> Result<()> {
        Err(unavailable())
    }
    pub fn hide(_: &WebviewWindow) {}
    pub fn monitors() -> serde_json::Value {
        serde_json::json!([])
    }
    pub fn diagnostics(_: &WebviewWindow) -> serde_json::Value {
        serde_json::json!({"supported":false})
    }
    #[derive(Clone)]
    pub struct Gesture;
    pub fn supported() -> bool {
        false
    }
    pub fn install(_: tauri::AppHandle) {}
    pub fn stop() {}
    pub fn set_targets(_: &WebviewWindow, _: Vec<(String, PixelRect, f64, f64, usize)>) {}
    pub fn forget_widget(_: &str) {}
    pub fn unregister(_: &str) {}
    pub fn attach(_: &WebviewWindow) -> Result<()> {
        Err(unavailable())
    }
    pub fn apply_host(_: &WebviewWindow, _: &PixelRect) -> Result<()> {
        Err(unavailable())
    }
    pub fn fit_geometry(_: &Geometry) -> Result<Geometry> {
        Err(unavailable())
    }
    pub fn begin(_: &Geometry, _: &str) -> Result<Gesture> {
        Err(unavailable())
    }
    pub fn arm(_: &str, _: &str) -> Result<u64> {
        Err(unavailable())
    }
    #[derive(Clone)]
    pub struct PointerSession;
    impl PointerSession {
        pub fn token(&self) -> u64 {
            0
        }
        pub fn status(&self) -> (bool, bool, bool) {
            (false, true, false)
        }
    }
    pub fn activate_native(_: &mut Gesture, _: &PointerSession) -> bool {
        false
    }
    pub fn cancel_native(_: u64) {}
    pub fn movement(_: &mut Gesture) -> Result<Geometry> {
        Err(unavailable())
    }
    pub fn drop_allowed(_: &Gesture) -> bool {
        false
    }
    pub fn hover_target() -> Option<(String, String)> {
        None
    }
    pub fn candidate(_: &str) -> bool {
        false
    }
    pub fn set_regions(
        _: &str,
        _: &str,
        _: Vec<(String, PixelRect)>,
        _: Option<PixelRect>,
    ) -> Result<()> {
        Err(unavailable())
    }
    pub fn grid_movement(_: &mut Gesture, _: &crate::widget_layout::Layout) -> Result<Geometry> {
        Err(unavailable())
    }
    pub fn gesture_base_width(_: &Gesture) -> f64 {
        240.
    }
    pub fn gesture_scale(_: &Gesture) -> f64 {
        1.
    }
    pub fn gesture_sequence(_: &Gesture) -> u64 {
        0
    }
    pub fn project_on(g: &Geometry, fit: bool, _: &[Display]) -> Option<(Display, PixelRect)> {
        project(g, fit)
    }
    pub fn gesture_preview(_: &Gesture) -> Option<PixelRect> {
        None
    }
    #[derive(Clone)]
    pub struct Display {
        pub id: String,
        pub scale: f64,
        pub primary: bool,
    }
    impl Display {
        pub fn rect(&self) -> PixelRect {
            PixelRect {
                x: 0.,
                y: 0.,
                width: 0.,
                height: 0.,
            }
        }
    }
    pub fn displays() -> Vec<Display> {
        vec![]
    }
    pub fn project(_: &Geometry, _: bool) -> Option<(Display, PixelRect)> {
        None
    }
    pub fn topology() -> String {
        String::new()
    }
    fn unavailable() -> AppError {
        AppError::new(
            "desktopWidgetsUnsupported",
            "当前系统暂不支持桌面组件。",
            false,
        )
    }
}
#[cfg(not(windows))]
pub use fallback::*;
