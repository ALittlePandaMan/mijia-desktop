//! Public, signed application releases. No Xiaomi session or device data is sent.
use crate::{
    app_runtime::Runtime,
    error::{AppError, Result},
};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{Arc, Mutex},
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};

pub mod portable;
pub mod result;
const REPOSITORY: &str = "ALittlePandaMan/mijia-desktop";
const MAX_PACKAGE: u64 = 256 * 1024 * 1024;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub revision: u64,
    pub state: &'static str,
    pub current_version: String,
    pub latest_version: Option<String>,
    pub notes: Option<String>,
    pub checked_at: Option<String>,
    pub downloaded_bytes: u64,
    pub total_bytes: Option<u64>,
    pub message: String,
    pub package_kind: &'static str,
    pub supported: bool,
    pub can_install: bool,
    pub can_download: bool,
}
struct Ready {
    update: Update,
    bytes: Vec<u8>,
}
pub struct Updates {
    status: Mutex<Status>,
    candidate: Mutex<Option<Update>>,
    ready: Mutex<Option<Ready>>,
    operation: tokio::sync::Mutex<()>,
    client: reqwest::Client,
}
fn issue(message: &str) -> AppError {
    AppError::new("appUpdate", message, true)
}
fn package_kind() -> &'static str {
    if std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_owned()))
        .is_some_and(|p| {
            !p.join(".mijia-desktop-portable").exists() && p.join("uninstall.exe").is_file()
        })
    {
        "installer"
    } else {
        "portable"
    }
}
fn client() -> Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("mijia-desktop/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(300))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            let url = attempt.url();
            if attempt.previous().len() < 6
                && url.scheme() == "https"
                && matches!(
                    url.host_str(),
                    Some(
                        "github.com"
                            | "api.github.com"
                            | "release-assets.githubusercontent.com"
                            | "objects.githubusercontent.com"
                    )
                )
            {
                attempt.follow()
            } else {
                attempt.stop()
            }
        }))
        .build()
        .map_err(|_| issue("无法初始化更新服务。"))
}
#[derive(Deserialize)]
struct Release {
    tag_name: String,
    draft: bool,
    prerelease: bool,
    assets: Vec<Asset>,
}
#[derive(Deserialize)]
struct Asset {
    name: String,
    browser_download_url: String,
    size: u64,
}

fn release_asset(url: &url::Url, tag: &str, name: &str) -> bool {
    url.scheme() == "https"
        && url.host_str() == Some("github.com")
        && url.port().is_none()
        && url.username().is_empty()
        && url.password().is_none()
        && url.query().is_none()
        && url.fragment().is_none()
        && url.path() == format!("/{REPOSITORY}/releases/download/{tag}/{name}")
}
async fn json_get<T: serde::de::DeserializeOwned>(
    client: &reqwest::Client,
    url: &str,
) -> Result<T> {
    let mut response = client
        .get(url)
        .timeout(Duration::from_secs(25))
        .send()
        .await
        .map_err(|_| issue("无法连接更新服务，请检查网络后重试。"))?;
    if response.status() == reqwest::StatusCode::FORBIDDEN
        || response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS
    {
        return Err(issue("更新服务暂时限制请求，请稍后再试。"));
    }
    if !response.status().is_success() {
        return Err(issue("更新信息暂时不可用，请稍后重试。"));
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| issue("更新信息读取失败，请重试。"))?
    {
        if bytes.len() + chunk.len() > 1024 * 1024 {
            return Err(issue("更新信息超出允许大小。"));
        }
        bytes.extend_from_slice(&chunk);
    }
    serde_json::from_slice(&bytes).map_err(|_| issue("更新信息格式无效。"))
}

impl Updates {
    pub fn install(app: &tauri::AppHandle) -> Result<()> {
        let supported =
            cfg!(all(target_os = "windows", target_arch = "x86_64")) && !cfg!(debug_assertions);
        let status = Status {
            revision: 0,
            state: "idle",
            current_version: env!("CARGO_PKG_VERSION").into(),
            latest_version: None,
            notes: None,
            checked_at: None,
            downloaded_bytes: 0,
            total_bytes: None,
            message: if supported {
                "尚未检查更新"
            } else {
                "此运行环境暂不支持应用内更新"
            }
            .into(),
            package_kind: package_kind(),
            supported,
            can_install: false,
            can_download: false,
        };
        let updates = Arc::new(Self {
            status: Mutex::new(status),
            candidate: Mutex::new(None),
            ready: Mutex::new(None),
            operation: tokio::sync::Mutex::new(()),
            client: client()?,
        });
        app.manage(updates.clone());
        if let Some(message) = portable::previous_failure() {
            updates.change(app, |s| {
                s.state = "error";
                s.message = message;
            });
        }
        Ok(())
    }
    pub fn status(&self) -> Status {
        self.status.lock().unwrap().clone()
    }
    fn change(&self, app: &tauri::AppHandle, change: impl FnOnce(&mut Status)) {
        let mut status = self.status.lock().unwrap();
        change(&mut status);
        status.revision += 1;
        let _ = app.emit("desktop-update-state", &*status);
    }
    fn failed(&self, app: &tauri::AppHandle, error: &AppError) {
        self.change(app, |s| {
            s.state = "error";
            s.message = error.message.clone();
        });
    }
    async fn discover(&self, app: &tauri::AppHandle) -> Result<Option<Update>> {
        let release: Release = json_get(
            &self.client,
            &format!("https://api.github.com/repos/{REPOSITORY}/releases/latest"),
        )
        .await?;
        let remote = semver::Version::parse(release.tag_name.trim_start_matches('v'))
            .map_err(|_| issue("发布版本号无效。"))?;
        let local = semver::Version::parse(env!("CARGO_PKG_VERSION")).unwrap();
        if release.draft || release.prerelease || !remote.pre.is_empty() {
            return Err(issue("没有可用的稳定版更新信息。"));
        }
        self.change(app, |s| {
            s.latest_version = Some(remote.to_string());
        });
        if remote <= local {
            return Ok(None);
        }
        let tag = format!("v{remote}");
        if release.tag_name != tag {
            return Err(issue("更新标签与版本号不一致。"));
        }
        let metadata = release
            .assets
            .iter()
            .find(|a| a.name == "latest.json" && a.size <= 1024 * 1024)
            .ok_or_else(|| issue("发现新版本，但尚未提供签名更新包，请稍后再试。"))?;
        let manifest_url =
            url::Url::parse(&metadata.browser_download_url).map_err(|_| issue("更新地址无效。"))?;
        if !release_asset(&manifest_url, &tag, "latest.json") {
            return Err(issue("更新信息来源不可信。"));
        }
        let manifest: serde_json::Value = json_get(&self.client, manifest_url.as_str()).await?;
        let kind = self.status().package_kind;
        let target = if kind == "portable" {
            "windows-x86_64-portable"
        } else {
            "windows-x86_64"
        };
        let update = app
            .updater_builder()
            .target(target)
            .build()
            .map_err(|_| issue("更新配置无效。"))?
            .restore_update(manifest)
            .map_err(|_| issue("更新清单或签名信息无效。"))?
            .ok_or_else(|| issue("更新版本信息不一致。"))?;
        let name = format!(
            "mijia-desktop-v{remote}-windows-x64-{}",
            if kind == "portable" {
                "portable.zip"
            } else {
                "setup.exe"
            }
        );
        if update.version.trim_start_matches('v') != remote.to_string()
            || !release_asset(&update.download_url, &tag, &name)
            || !release.assets.iter().any(|a| {
                a.name == name
                    && a.size > 0
                    && a.size <= MAX_PACKAGE
                    && a.browser_download_url == update.download_url.as_str()
            })
        {
            return Err(issue("更新包与当前版本或平台不匹配。"));
        }
        Ok(Some(update))
    }
    pub async fn check(&self, app: &tauri::AppHandle) -> Result<Status> {
        let Ok(_guard) = self.operation.try_lock() else {
            return Ok(self.status());
        };
        if !self.status().supported {
            return Err(issue("此运行环境暂不支持应用内更新。"));
        }
        if self.ready.lock().unwrap().is_some() {
            return Ok(self.status());
        }
        self.change(app, |s| {
            s.state = "checking";
            s.message = "正在检查更新…".into();
            s.downloaded_bytes = 0;
            s.total_bytes = None;
            s.can_download = false;
            s.latest_version = None;
            s.notes = None;
        });
        *self.candidate.lock().unwrap() = None;
        match self.discover(app).await {
            Ok(update) => {
                self.change(app, |s| {
                    s.checked_at = Some(chrono::Utc::now().to_rfc3339());
                    if let Some(u) = &update {
                        s.state = "available";
                        s.can_download = true;
                        s.notes = u.body.clone().map(|v| v.chars().take(16000).collect());
                        s.message = format!("发现新版本 {}", u.version);
                    } else {
                        s.state = "current";
                        s.notes = None;
                        s.message = "当前已是最新版本".into();
                    }
                });
                *self.candidate.lock().unwrap() = update;
                Ok(self.status())
            }
            Err(error) => {
                self.failed(app, &error);
                Err(error)
            }
        }
    }
    pub async fn download(&self, app: &tauri::AppHandle) -> Result<Status> {
        let Ok(_guard) = self.operation.try_lock() else {
            return Ok(self.status());
        };
        if self.ready.lock().unwrap().is_some() {
            return Ok(self.status());
        }
        let update = self
            .candidate
            .lock()
            .unwrap()
            .clone()
            .ok_or_else(|| issue("请先检查更新。"))?;
        self.change(app, |s| {
            s.state = "downloading";
            s.downloaded_bytes = 0;
            s.total_bytes = None;
            s.message = "正在下载更新…".into();
        });
        let result = self.download_bytes(app, &update).await;
        match result {
            Ok(bytes) => {
                *self.ready.lock().unwrap() = Some(Ready { update, bytes });
                self.change(app, |s| {
                    s.state = "ready";
                    s.can_install = true;
                    s.can_download = false;
                    s.message = "下载完成，正在准备安装…".into();
                });
                Ok(self.status())
            }
            Err(error) => {
                self.failed(app, &error);
                Err(error)
            }
        }
    }
    async fn download_bytes(&self, app: &tauri::AppHandle, update: &Update) -> Result<Vec<u8>> {
        let mut response = self
            .client
            .get(update.download_url.clone())
            .send()
            .await
            .map_err(|_| issue("更新下载失败，请检查网络后重试。"))?;
        if !response.status().is_success() {
            return Err(issue("更新包暂时无法下载。"));
        }
        let total = response.content_length();
        if total.is_some_and(|n| n > MAX_PACKAGE) {
            return Err(issue("更新包超过允许大小。"));
        }
        self.change(app, |s| s.total_bytes = total);
        let mut bytes = Vec::new();
        let mut emitted = Instant::now();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| issue("更新下载中断，请重试。"))?
        {
            if bytes.len() as u64 + chunk.len() as u64 > MAX_PACKAGE {
                return Err(issue("更新包超过允许大小。"));
            }
            bytes.extend_from_slice(&chunk);
            if emitted.elapsed() >= Duration::from_millis(250) {
                self.change(app, |s| s.downloaded_bytes = bytes.len() as u64);
                emitted = Instant::now();
            }
        }
        update
            .verify(&bytes)
            .map_err(|_| issue("更新包签名校验失败，已阻止安装。"))?;
        self.change(app, |s| s.downloaded_bytes = bytes.len() as u64);
        Ok(bytes)
    }
    pub fn ready(&self) -> bool {
        self.ready.lock().unwrap().is_some()
    }
    pub fn apply(&self, app: &tauri::AppHandle, restart: bool) -> Result<bool> {
        let Ok(_guard) = self.operation.try_lock() else {
            return Err(issue("更新任务仍在进行，请稍后再试。"));
        };
        let Some(ready) = self.ready.lock().unwrap().take() else {
            return Ok(false);
        };
        if let Err(error) = result::prepare(&ready.update) {
            *self.ready.lock().unwrap() = Some(ready);
            self.failed(app, &error);
            return Err(error);
        }
        self.change(app, |s| {
            s.state = "installing";
            s.message = "正在静默安装，即将重启…".into();
        });
        let result = if self.status().package_kind == "portable" {
            portable::launch(&ready.update, &ready.bytes, restart)
        } else {
            ready
                .update
                .clone()
                .restart_after_install(restart)
                .install(&ready.bytes)
                .map_err(|_| issue("更新安装未启动，请重试。"))
        };
        if let Err(error) = result {
            result::clear_failed();
            *self.ready.lock().unwrap() = Some(ready);
            self.failed(app, &error);
            return Err(error);
        }
        Ok(true)
    }
}
pub fn cache_directory() -> Result<PathBuf> {
    Ok(crate::app_settings::directory()?.join("updates"))
}

#[tauri::command]
pub fn app_update_status(app: tauri::AppHandle) -> Status {
    app.state::<Arc<Updates>>().status()
}
#[tauri::command]
pub async fn check_app_update(app: tauri::AppHandle) -> Result<Status> {
    app.state::<Arc<Updates>>().check(&app).await
}
#[tauri::command]
pub async fn start_app_update(app: tauri::AppHandle) -> Result<Status> {
    let status = app.state::<Arc<Updates>>().download(&app).await?;
    if app.state::<Arc<Updates>>().ready() {
        Runtime::quit_for_update(&app);
    }
    Ok(status)
}
