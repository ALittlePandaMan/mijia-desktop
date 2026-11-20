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
pub struct Store {
    value: RwLock<AppSettings>,
    pub revision: AtomicU64,
    pub grant_epoch: AtomicU64,
    path: PathBuf,
}
impl Store {
    pub fn new() -> Result<Self> {
        let path = directory()?.join("app-settings-v1.json");
        archive_retired_memory(path.parent().ok_or_else(|| storage("path"))?)?;
        let value = if path.exists() {
            if std::fs::metadata(&path).map_err(storage)?.len() > 2 * 1024 * 1024 {
                return Err(AppError::invalid("应用设置文件过大。"));
            }
            let bytes = std::fs::read(&path).map_err(storage)?;
            let (stored, migrated) = migrate(&bytes)?;
            let value: AppSettings = serde_json::from_value(stored).map_err(storage)?;
            value.validate()?;
            if migrated {
                let backup = path.with_file_name("app-settings-before-family-mcp-v1.json");
                if !backup.exists() {
                    std::fs::write(&backup, &bytes).map_err(storage)?;
                }
                atomic_write(&path, &serde_json::to_vec_pretty(&value).map_err(storage)?)?;
            }
            value
        } else {
            AppSettings::default()
        };
        value.validate()?;
        Ok(Self {
            value: RwLock::new(value),
            revision: AtomicU64::new(0),
            grant_epoch: AtomicU64::new(0),
            path,
        })
    }
    pub fn get(&self) -> AppSettings {
        self.value.read().unwrap_or_else(|e| e.into_inner()).clone()
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
