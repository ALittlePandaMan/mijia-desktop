//! Application settings are independent of account presentation preferences.
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicU64, Ordering},
        RwLock,
    },
};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HomeTarget {
    pub scope: String,
    pub home_id: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(untagged,deny_unknown_fields)]
pub enum StartupTarget {
    Home(HomeTarget),
    All { scope: String, #[serde(rename="allHomes")] all_homes: bool },
}
impl StartupTarget {
    fn valid(&self) -> bool {
        let scope = match self { Self::Home(h) => &h.scope, Self::All {scope,..} => scope };
        scope.len()==64 && scope.bytes().all(|c|c.is_ascii_hexdigit()) && match self {
            Self::Home(h) => !h.home_id.is_empty() && h.home_id.len()<=256,
            Self::All {all_homes,..} => *all_homes,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct McpSettings {
    pub enabled: bool,
    pub excluded_homes: Vec<HomeTarget>,
    pub local_port: u16,
}
impl Default for McpSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            excluded_homes: vec![],
            local_port: 8765,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct AppSettings {
    pub version: u32,
    pub startup_monitor: bool,
    pub startup_home: Option<StartupTarget>,
    pub close_to_tray: bool,
    pub keep_awake: bool,
    pub mcp: McpSettings,
}
impl Default for AppSettings {
    fn default() -> Self {
        Self {
            version: 1,
            startup_monitor: false,
            startup_home: None,
            close_to_tray: true,
            keep_awake: true,
            mcp: McpSettings::default(),
        }
    }
}
impl AppSettings {
    pub fn validate(&self) -> Result<()> {
        if self.version != 1 || self.mcp.local_port < 1024 || self.mcp.excluded_homes.len() > 10000
        {
            return Err(AppError::invalid("应用设置无效。"));
        }
        let mut identities = std::collections::HashSet::new();
        for home in &self.mcp.excluded_homes {
            if home.scope.len() != 64
                || !home.scope.bytes().all(|c| c.is_ascii_hexdigit())
                || home.home_id.is_empty()
                || home.home_id.len() > 256
                || !identities.insert((&home.scope, &home.home_id))
            {
                return Err(AppError::invalid("MCP 家庭选择无效。"));
            }
        }
        if self.startup_home.as_ref().is_some_and(|target| !target.valid()) {
            return Err(AppError::invalid("启动家庭无效。"));
        }
        Ok(())
    }
}
// Keep the original settings file readable by the released 0.1.0 client.
#[derive(Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(default, rename_all = "camelCase", deny_unknown_fields)]
pub struct DesktopOptions {
    pub auto_check_updates: bool,
    pub monitor_separate_window: bool,
}

#[derive(Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum DesktopOption {
    AutoCheckUpdates,
    MonitorSeparateWindow,
}

pub struct Store {
    value: RwLock<AppSettings>,
    desktop: RwLock<DesktopOptions>,
    pub revision: AtomicU64,
    pub grant_epoch: AtomicU64,
    path: PathBuf,
}
impl Store {
    pub fn new() -> Result<Self> {
        let root = directory()?;
        archive_retired_memory(&root)?;
        Self::open(root.join("app-settings-v1.json"))
    }
    pub(crate) fn open(path: PathBuf) -> Result<Self> {
        let desktop_path = path.with_file_name("desktop-options-v1.json");
        let saved_desktop = match std::fs::read(&desktop_path) {
            Ok(bytes) => Some(serde_json::from_slice(&bytes).map_err(storage)?),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => None,
            Err(error) => return Err(storage(error)),
        };
        let mut desktop = saved_desktop.unwrap_or_default();
        let value = if path.exists() {
            if std::fs::metadata(&path).map_err(storage)?.len() > 2 * 1024 * 1024 {
                return Err(AppError::invalid("应用设置文件过大。"));
            }
            let bytes = std::fs::read(&path).map_err(storage)?;
            let (mut stored, migrated) = migrate(&bytes)?;
            let old_desktop = take_desktop_options(&mut stored)?;
            let value: AppSettings = serde_json::from_value(stored).map_err(storage)?;
            value.validate()?;
            if let (None, Some(options)) = (saved_desktop, old_desktop) {
                atomic_write(&desktop_path, &serde_json::to_vec_pretty(&options).map_err(storage)?)?;
                desktop = options;
            }
            if migrated {
                let backup = path.with_file_name("app-settings-before-family-mcp-v1.json");
                if !backup.exists() {
                    std::fs::write(&backup, &bytes).map_err(storage)?;
                }
            }
            if migrated || old_desktop.is_some() {
                atomic_write(&path, &serde_json::to_vec_pretty(&value).map_err(storage)?)?;
            }
            value
        } else {
            AppSettings::default()
        };
        value.validate()?;
        Ok(Self {
            value: RwLock::new(value),
            desktop: RwLock::new(desktop),
            revision: AtomicU64::new(0),
            grant_epoch: AtomicU64::new(0),
            path,
        })
    }
    pub fn get(&self) -> AppSettings {
        self.value.read().unwrap_or_else(|e| e.into_inner()).clone()
    }
    pub fn desktop_options(&self) -> DesktopOptions {
        *self.desktop.read().unwrap_or_else(|e| e.into_inner())
    }
    pub fn change_desktop_option(&self, option: DesktopOption, enabled: bool) -> Result<()> {
        let mut guard = self.desktop.write().map_err(storage)?;
        let mut next = *guard;
        match option {
            DesktopOption::AutoCheckUpdates => next.auto_check_updates = enabled,
            DesktopOption::MonitorSeparateWindow => next.monitor_separate_window = enabled,
        }
        if next != *guard {
            atomic_write(&self.path.with_file_name("desktop-options-v1.json"), &serde_json::to_vec_pretty(&next).map_err(storage)?)?;
            *guard = next;
        }
        Ok(())
    }
    pub fn save(&self, value: AppSettings) -> Result<()> {
        let mut guard = self.value.write().map_err(storage)?;
        value.validate()?;
        if matches!(value.startup_home,Some(StartupTarget::All{..})) && self.path.exists() {
            let backup=self.path.with_file_name("app-settings-before-all-home-monitor-v1.json");
            if !backup.exists(){std::fs::copy(&self.path,backup).map_err(storage)?;}
        }
        atomic_write(
            &self.path,
            &serde_json::to_vec_pretty(&value).map_err(storage)?,
        )?;
        if guard.mcp.excluded_homes != value.mcp.excluded_homes
            || guard.mcp.enabled != value.mcp.enabled
        {
            self.grant_epoch.fetch_add(1, Ordering::AcqRel);
        }
        *guard = value;
        self.revision.fetch_add(1, Ordering::AcqRel);
        Ok(())
    }
    pub fn home_selected(&self, scope: &str, home: &str) -> bool {
        !self
            .get()
            .mcp
            .excluded_homes
            .iter()
            .any(|h| h.scope == scope && h.home_id == home)
    }
}
fn archive_retired_memory(root: &std::path::Path) -> Result<()> {
    let source = root.join("mcp/memories");
    if !source.exists() {
        return Ok(());
    }
    let base = root.canonicalize().map_err(storage)?;
    let actual = source.canonicalize().map_err(storage)?;
    if !actual.starts_with(&base) {
        return Err(storage("retired memory path escapes application directory"));
    }
    let parent = root.join("mcp/retired");
    std::fs::create_dir_all(&parent).map_err(storage)?;
    if !parent.canonicalize().map_err(storage)?.starts_with(&base) {
        return Err(storage("archive path escapes application directory"));
    }
    let destination = parent.join(format!("memories-{}", uuid::Uuid::new_v4()));
    std::fs::rename(source, destination).map_err(storage)?;
    Ok(())
}
fn migrate(bytes: &[u8]) -> Result<(serde_json::Value, bool)> {
    let mut stored: serde_json::Value = serde_json::from_slice(bytes).map_err(storage)?;
    let mut changed = false;
    if let Some(object) = stored.as_object_mut() {
        changed |= object.remove("autoUpdate").is_some();
    }
    if let Some(mcp) = stored.get_mut("mcp").and_then(|v| v.as_object_mut()) {
        for key in [
            "home",
            "grants",
            "lightingChannels",
            "lanEnabled",
            "lanPort",
            "interface",
        ] {
            changed |= mcp.remove(key).is_some();
        }
    }
    Ok((stored, changed))
}

fn take_desktop_options(stored: &mut serde_json::Value) -> Result<Option<DesktopOptions>> {
    let Some(object) = stored.as_object_mut() else { return Ok(None) };
    let migrated: serde_json::Map<_, _> = ["autoCheckUpdates", "monitorSeparateWindow"]
        .into_iter()
        .filter_map(|key| object.remove(key).map(|value| (key.to_owned(), value)))
        .collect();
    if migrated.is_empty() { return Ok(None) }
    serde_json::from_value(serde_json::Value::Object(migrated)).map(Some).map_err(storage)
}

pub fn directory() -> Result<PathBuf> {
    Ok(crate::platform_paths::local_data_dir()
        .ok_or_else(|| AppError::new("storage", "无法取得用户目录。", false))?
        .join("io.mijiadesktop.client"))
}
pub fn storage(_: impl std::fmt::Display) -> AppError {
    AppError::new("storage", "无法读取或保存应用设置。", true)
}
pub fn atomic_write(path: &std::path::Path, bytes: &[u8]) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(storage)?;
    }
    let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
    std::fs::write(&temporary, bytes).map_err(storage)?;
    std::fs::rename(&temporary, path).map_err(storage)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn startup_target_reads_legacy_and_all_households_without_virtual_home_id() {
        let scope="a".repeat(64);
        for target in [serde_json::json!({"scope":scope,"homeId":"1"}),serde_json::json!({"scope":scope,"allHomes":true})] {
            let value:AppSettings=serde_json::from_value(serde_json::json!({"startupHome":target})).unwrap();value.validate().unwrap();assert_eq!(serde_json::to_value(value).unwrap()["startupHome"],target);
        }
        let value:AppSettings=serde_json::from_value(serde_json::json!({"startupHome":{"scope":scope,"allHomes":false}})).unwrap();assert!(value.validate().is_err());
        assert!(serde_json::from_value::<AppSettings>(serde_json::json!({"startupHome":{"scope":scope,"homeId":"1","allHomes":true}})).is_err());
    }
    #[test]
    fn homes_default_selected_and_exclusions_are_account_scoped() {
        let mut value = AppSettings::default();
        assert!(!value.mcp.enabled && value.mcp.excluded_homes.is_empty());
        value.mcp.excluded_homes.push(HomeTarget {
            scope: "a".repeat(64),
            home_id: "1".into(),
        });
        let store = Store {
            value: RwLock::new(value),
            desktop: RwLock::new(DesktopOptions::default()),
            revision: AtomicU64::new(0),
            grant_epoch: AtomicU64::new(0),
            path: PathBuf::new(),
        };
        assert!(!store.home_selected(&"a".repeat(64), "1"));
        assert!(store.home_selected(&"b".repeat(64), "1"));
        assert!(store.home_selected(&"a".repeat(64), "new-home"));
    }
    #[test]
    fn migration_discards_device_grants_but_preserves_enable_port_and_other_settings() {
        let (v,changed)=migrate(br#"{"version":1,"closeToTray":false,"mcp":{"enabled":true,"localPort":9020,"home":{"scope":"old","homeId":"1"},"grants":[{"did":"old"}],"lightingChannels":[]}}"#).unwrap();
        assert!(changed);
        let s: AppSettings = serde_json::from_value(v).unwrap();
        assert!(
            s.mcp.enabled
                && !s.close_to_tray
                && s.mcp.local_port == 9020
                && s.mcp.excluded_homes.is_empty()
        );
        let (_, again) = migrate(&serde_json::to_vec(&s).unwrap()).unwrap();
        assert!(!again);
    }
    #[test]
    fn duplicate_exclusions_and_unknown_ipc_fields_rejected() {
        let mut s = AppSettings::default();
        let h = HomeTarget {
            scope: "a".repeat(64),
            home_id: "1".into(),
        };
        s.mcp.excluded_homes = vec![h.clone(), h];
        assert!(s.validate().is_err());
        assert!(serde_json::from_value::<McpSettings>(serde_json::json!({"grants":[]})).is_err());
    }
    #[test]
    fn desktop_options_migrate_without_changing_the_released_settings_schema() {
        let root = std::env::temp_dir().join(format!("mijia-desktop-options-{}", uuid::Uuid::new_v4()));
        let path = root.join("app-settings-v1.json");
        atomic_write(&path, br#"{"version":1,"closeToTray":false,"autoUpdate":true}"#).unwrap();
        assert_eq!(Store::open(path.clone()).unwrap().desktop_options(), DesktopOptions::default());
        let early = br#"{"version":1,"closeToTray":false,"autoCheckUpdates":true}"#;
        atomic_write(&path, early).unwrap();
        let store = Store::open(path.clone()).unwrap();
        assert!(store.desktop_options().auto_check_updates);
        assert!(!store.desktop_options().monitor_separate_window);
        store.change_desktop_option(DesktopOption::MonitorSeparateWindow, true).unwrap();
        assert!(serde_json::from_slice::<AppSettings>(&std::fs::read(&path).unwrap()).is_ok());
        assert!(!store.get().close_to_tray);
        // Simulate restarting after the sidecar was written, before cleanup.
        store.change_desktop_option(DesktopOption::AutoCheckUpdates, false).unwrap();
        atomic_write(&path, early).unwrap();
        let reopened = Store::open(path).unwrap();
        assert!(!reopened.desktop_options().auto_check_updates);
        assert!(reopened.desktop_options().monitor_separate_window);
    }
    #[test]
    fn retired_memories_are_archived_once_without_changing_other_preferences() {
        let root =
            std::env::temp_dir().join(format!("mijia-family-migration-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(root.join("mcp/memories")).unwrap();
        std::fs::write(root.join("mcp/memories/old.json"), b"old memory").unwrap();
        std::fs::write(root.join("desktop-widgets-v3.json"), b"layout unchanged").unwrap();
        archive_retired_memory(&root).unwrap();
        archive_retired_memory(&root).unwrap();
        assert!(!root.join("mcp/memories").exists());
        let archives = std::fs::read_dir(root.join("mcp/retired"))
            .unwrap()
            .collect::<std::io::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(archives.len(), 1);
        assert_eq!(
            std::fs::read(archives[0].path().join("old.json")).unwrap(),
            b"old memory"
        );
        assert_eq!(
            std::fs::read(root.join("desktop-widgets-v3.json")).unwrap(),
            b"layout unchanged"
        );
    }
}
