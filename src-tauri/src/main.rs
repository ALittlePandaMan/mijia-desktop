#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
fn main() {
    if let Some(code) = mijia_desktop::app_update::portable::helper_argument() {
        std::process::exit(code);
    }
    mijia_desktop::run();
}
