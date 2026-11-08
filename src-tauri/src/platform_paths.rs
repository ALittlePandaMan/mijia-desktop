//! Platform directories only; never derive private paths from frontend input.
use crate::error::{AppError, Result};
use std::path::{Path, PathBuf};

pub(crate) fn local_data_dir() -> Option<PathBuf> {
    #[cfg(windows)]
    { std::env::var_os("LOCALAPPDATA").map(PathBuf::from) }
    #[cfg(not(windows))]
    { dirs::data_local_dir() }
}

pub(crate) fn media_dir() -> Result<PathBuf> {
    dirs::video_dir()
        .or_else(|| dirs::home_dir().map(|home| home.join("Videos")))
        .map(|directory| directory.join("米家Desktop"))
        .ok_or_else(|| AppError::new("mediaStorage", "无法取得本机视频目录。", true))
}

pub(crate) fn open_directory(directory: &Path) -> Result<()> {
    if !directory.is_absolute() || !directory.is_dir() {
        return Err(AppError::new("mediaStorage", "无法打开保存目录。", true));
    }
    #[cfg(windows)]
    let mut command = {
        use std::os::windows::process::CommandExt;
        let mut command = std::process::Command::new("explorer.exe");
        command.creation_flags(0x08000000);
        command
    };
    #[cfg(target_os = "macos")]
    let mut command = std::process::Command::new("open");
    #[cfg(target_os = "linux")]
    let mut command = std::process::Command::new("xdg-open");
    command.arg(directory).spawn()
        .map(|_| ())
        .map_err(|_| AppError::new("mediaStorage", "无法打开保存目录。", true))
}
