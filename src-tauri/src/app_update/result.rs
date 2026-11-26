//! A receipt is written before installation, and is shown only by the matching
//! new executable. An interrupted or rejected installation cannot report success.
use super::{cache_directory, issue, Result};
use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf};
use tauri_plugin_updater::Update;

#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateResult {
    pub id: String,
    pub previous_version: String,
    pub version: String,
    pub notes: String,
}
fn path() -> Result<PathBuf> {
    Ok(cache_directory()?.join("pending-result.json"))
}
pub fn prepare(update: &Update) -> Result<()> {
    let result = UpdateResult {
        id: uuid::Uuid::new_v4().to_string(),
        previous_version: env!("CARGO_PKG_VERSION").into(),
        version: update.version.clone(),
        notes: update
            .body
            .clone()
            .unwrap_or_default()
            .chars()
            .take(16000)
            .collect(),
    };
    crate::app_settings::atomic_write(
        &path()?,
        &serde_json::to_vec(&result).map_err(|_| issue("无法保存更新结果。"))?,
    )
}
pub fn read() -> Result<Option<UpdateResult>> {
    if cfg!(debug_assertions) {
        return Ok(None);
    }
    let path = path()?;
    let bytes = match fs::read(&path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(_) => return Err(issue("无法读取更新结果。")),
    };
    if bytes.len() > 128 * 1024 {
        return Err(issue("更新结果超出大小限制。"));
    }
    let result: UpdateResult =
        serde_json::from_slice(&bytes).map_err(|_| issue("更新结果格式无效。"))?;
    let current = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
    let previous = semver::Version::parse(&result.previous_version)
        .map_err(|_| issue("更新结果版本无效。"))?;
    let target =
        semver::Version::parse(&result.version).map_err(|_| issue("更新结果版本无效。"))?;
    if current != target || current <= previous || uuid::Uuid::parse_str(&result.id).is_err() {
        return Ok(None);
    }
    Ok(Some(result))
}
pub fn acknowledge(id: &str) -> Result<()> {
    if read()?.is_some_and(|result| result.id == id) {
        fs::remove_file(path()?).map_err(|_| issue("无法保存已读状态，请重试。"))?;
    }
    Ok(())
}
pub fn clear_failed() {
    if let Ok(path) = path() {
        let _ = fs::remove_file(path);
    }
}

#[tauri::command]
pub fn app_update_result() -> Result<Option<UpdateResult>> {
    read()
}
#[tauri::command]
pub fn acknowledge_app_update(id: String) -> Result<()> {
    acknowledge(&id)
}
#[tauri::command]
pub fn open_app_release_notes() -> Result<()> {
    open_project_url("https://github.com/ALittlePandaMan/mijia-desktop/releases")
}
#[tauri::command]
pub fn open_app_project(page: String) -> Result<()> {
    open_project_url(match page.as_str() {
        "github" => "https://github.com/ALittlePandaMan/mijia-desktop",
        "issues" => "https://github.com/ALittlePandaMan/mijia-desktop/issues",
        _ => return Err(issue("无效的项目链接。")),
    })
}
fn open_project_url(url: &str) -> Result<()> {
    crate::platform_paths::open_browser(url).map_err(|_| issue("无法打开更新日志。"))
}
