//! Local presentation preferences. This module has no cloud/network interface.
use crate::{
    error::{AppError, Result},
    models::Device,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    path::PathBuf,
};

const MAX_BYTES: u64 = 2 * 1024 * 1024;
const MAX_IDS: usize = 10000;

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonitorPreferences {
    pub enabled: bool,
    pub excluded_device_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceView {
    #[serde(default)]
    pub camera_primary_lenses: BTreeMap<String, u8>,
    #[serde(default)]
    pub monitor: MonitorPreferences,
    pub hide_offline: bool,
    pub drag_locked: bool,
    #[serde(default)]
    pub split_switches: bool,
    pub hidden_device_ids: Vec<String>,
    #[serde(default)]
    pub home_hidden_device_ids: Vec<String>,
    pub room_orders: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    pub router_common_devices: BTreeMap<String, Vec<String>>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PreferenceChange {
    SetCameraPrimaryLens {
        did: String,
        lens_id: u8,
    },
    SetMonitorEnabled {
        value: bool,
    },
    SetMonitorExcluded {
        did: String,
        excluded: bool,
    },
    SetHideOffline {
        value: bool,
    },
    SetDragLocked {
        value: bool,
    },
    SetSplitSwitches {
        value: bool,
    },
    SetHidden {
        did: String,
        hidden: bool,
    },
    SetHomeHidden {
        did: String,
        hidden: bool,
    },
    SetOrder {
        room_id: String,
        device_ids: Vec<String>,
    },
    ResetOrder,
    SetRouterCommon {
        did: String,
        expected: Vec<String>,
        macs: Vec<String>,
    },
}

#[derive(Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HomePreferences {
    #[serde(default)]
    camera_primary_lenses: BTreeMap<String, u8>,
    #[serde(default)]
    monitor: MonitorPreferences,
    hidden_device_ids: BTreeSet<String>,
    #[serde(default)]
    home_hidden_device_ids: BTreeSet<String>,
    room_orders: BTreeMap<String, Vec<String>>,
    #[serde(default)]
    router_common_devices: BTreeMap<String, Vec<String>>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    version: u32,
    scope: String,
    hide_offline: bool,
    drag_locked: bool,
    #[serde(default)]
    split_switches: bool,
    homes: BTreeMap<String, HomePreferences>,
}

pub(crate) struct PreferenceStore {
    directory: PathBuf,
}
impl PreferenceStore {
    pub fn new() -> Result<Self> {
        Ok(Self {
            directory: PathBuf::from(crate::platform_paths::local_data_dir().ok_or_else(storage_error)?)
                .join("io.mijiadesktop.client")
                .join("preferences-v1"),
        })
    }
    pub fn scope(user: &str, region: &str) -> String {
        let mut digest = Sha256::new();
        digest.update(b"mijia-desktop-presentation-v1\0");
        digest.update(region.as_bytes());
        digest.update(b"\0");
        digest.update(user.as_bytes());
        format!("{:x}", digest.finalize())
    }
    fn path(&self, scope: &str) -> Result<PathBuf> {
        if scope.len() != 64 || !scope.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(storage_error());
        }
        Ok(self.directory.join(format!("{scope}.json")))
    }
    fn load(&self, scope: &str) -> Result<Document> {
        let path = self.path(scope)?;
        let metadata = match std::fs::metadata(&path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                return Ok(Document {
                    version: 1,
                    scope: scope.into(),
                    hide_offline: false,
                    drag_locked: false,
                    split_switches: false,
                    homes: BTreeMap::new(),
                })
            }
            Err(_) => return Err(storage_error()),
        };
        if metadata.len() > MAX_BYTES {
            return Err(storage_error());
        }
        let document: Document =
            serde_json::from_slice(&std::fs::read(path).map_err(|_| storage_error())?)
                .map_err(|_| storage_error())?;
        if document.version != 1
            || document.scope != scope
            || document.homes.len() > 256
            || document.homes.iter().any(|(id, home)| {
                !valid_id(id)
                    || home.camera_primary_lenses.len() > MAX_IDS
                    || home
                        .camera_primary_lenses
                        .iter()
                        .any(|(did, lens)| !valid_id(did) || *lens > 63)
                    || !valid_ids(&home.monitor.excluded_device_ids)
                    || home.hidden_device_ids.len() > MAX_IDS
                    || home.hidden_device_ids.iter().any(|id| !valid_id(id))
                    || home.home_hidden_device_ids.len() > MAX_IDS
                    || home.home_hidden_device_ids.iter().any(|id| !valid_id(id))
                    || home.room_orders.len() > 512
                    || home.router_common_devices.len() > MAX_IDS
                    || home
                        .router_common_devices
                        .iter()
                        .any(|(did, macs)| !valid_id(did) || !valid_common(macs))
                    || home
                        .room_orders
                        .iter()
                        .any(|(room, ids)| !valid_id(room) || !valid_ids(ids))
            })
        {
            return Err(storage_error());
        }
        Ok(document)
    }
    fn save(&self, document: &Document) -> Result<()> {
        let bytes = serde_json::to_vec(document).map_err(|_| storage_error())?;
        if bytes.len() as u64 > MAX_BYTES {
            return Err(storage_error());
        }
        std::fs::create_dir_all(&self.directory).map_err(|_| storage_error())?;
        let destination = self.path(&document.scope)?;
        let temporary = destination.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temporary)
                .map_err(|_| storage_error())?;
            file.write_all(&bytes)
                .and_then(|()| file.sync_all())
                .map_err(|_| storage_error())?;
            drop(file);
            std::fs::rename(&temporary, destination).map_err(|_| storage_error())
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temporary);
        }
        result
    }
    pub fn view(&self, scope: &str, home_id: &str) -> Result<PreferenceView> {
        Ok(Self::project(&self.load(scope)?, home_id))
    }
    fn project(document: &Document, home_id: &str) -> PreferenceView {
        let home = document.homes.get(home_id);
        PreferenceView {
            camera_primary_lenses: home
                .map(|h| h.camera_primary_lenses.clone())
                .unwrap_or_default(),
            monitor: home.map(|h| h.monitor.clone()).unwrap_or_default(),
            hide_offline: document.hide_offline,
            drag_locked: document.drag_locked,
            split_switches: document.split_switches,
            hidden_device_ids: home
                .map(|h| h.hidden_device_ids.iter().cloned().collect())
                .unwrap_or_default(),
            home_hidden_device_ids: home
                .map(|h| h.home_hidden_device_ids.iter().cloned().collect())
                .unwrap_or_default(),
            room_orders: home.map(|h| h.room_orders.clone()).unwrap_or_default(),
            router_common_devices: home
                .map(|h| h.router_common_devices.clone())
                .unwrap_or_default(),
        }
    }
    pub fn change(
        &self,
        scope: &str,
        home_id: &str,
        change: PreferenceChange,
        devices: &[Device],
        rooms: &[String],
    ) -> Result<PreferenceView> {
        if !valid_id(home_id) {
            return Err(AppError::stale());
        }
        let mut document = self.load(scope)?;
        match change {
            PreferenceChange::SetCameraPrimaryLens { did, lens_id } => {
                if !valid_id(&did)
                    || !devices.iter().any(|d| {
                        d.did == did
                            && crate::camera::media_control::features(&d.model)
                                .lenses
                                .as_ref()
                                .is_some_and(|ls| ls.iter().any(|l| l.id == lens_id))
                    })
                {
                    return Err(AppError::invalid("此摄像机没有所选镜头。"));
                }
                let lenses = &mut document
                    .homes
                    .entry(home_id.into())
                    .or_default()
                    .camera_primary_lenses;
                if lenses.len() >= MAX_IDS && !lenses.contains_key(&did) {
                    return Err(storage_error());
                }
                lenses.insert(did, lens_id);
            }
            PreferenceChange::SetMonitorEnabled { value } => {
                let monitor = &mut document.homes.entry(home_id.into()).or_default().monitor;
                if value
                    && !devices.iter().any(|d| {
                        crate::monitor::eligible(d) && !monitor.excluded_device_ids.contains(&d.did)
                    })
                {
                    return Err(AppError::invalid("请至少选择一台摄像头。"));
                }
                monitor.enabled = value;
            }
            PreferenceChange::SetMonitorExcluded { did, excluded } => {
                if !valid_id(&did)
                    || (excluded
                        && !devices
                            .iter()
                            .any(|d| d.did == did && crate::monitor::eligible(d)))
                {
                    return Err(AppError::stale());
                }
                let monitor = &mut document.homes.entry(home_id.into()).or_default().monitor;
                monitor.excluded_device_ids.retain(|id| id != &did);
                if excluded {
                    monitor.excluded_device_ids.push(did);
                }
                if !valid_ids(&monitor.excluded_device_ids) {
                    return Err(storage_error());
                }
            }
            PreferenceChange::SetHideOffline { value } => document.hide_offline = value,
            PreferenceChange::SetDragLocked { value } => document.drag_locked = value,
            PreferenceChange::SetSplitSwitches { value } => document.split_switches = value,
            PreferenceChange::SetHomeHidden { did, hidden } => {
                if !valid_id(&did) || (hidden && !devices.iter().any(|d| d.did == did)) {
                    return Err(AppError::stale());
                }
                let home = document.homes.entry(home_id.into()).or_default();
                if hidden {
                    home.home_hidden_device_ids.insert(did);
                } else {
                    home.home_hidden_device_ids.remove(&did);
                }
                if home.home_hidden_device_ids.len() > MAX_IDS {
                    return Err(storage_error());
                }
            }
            PreferenceChange::SetHidden { did, hidden } => {
                let home = document.homes.entry(home_id.into()).or_default();
                if !valid_id(&did) || (hidden && !devices.iter().any(|d| d.did == did)) {
                    return Err(AppError::stale());
                }
                if hidden {
                    home.hidden_device_ids.insert(did);
                } else {
                    home.hidden_device_ids.remove(&did);
                }
                if home.hidden_device_ids.len() > MAX_IDS {
                    return Err(storage_error());
                }
            }
            PreferenceChange::SetOrder {
                room_id,
                device_ids,
            } => {
                if document.drag_locked {
                    return Err(AppError::invalid("设备位置已锁定，请先在设置中解锁。"));
                }
                if !valid_ids(&device_ids)
                    || !valid_id(&room_id)
                    || !(room_id == "*" || room_id == "?" || rooms.contains(&room_id))
                    || device_ids.iter().any(|id| {
                        !devices.iter().any(|d| {
                            &d.did == id
                                && (room_id == "*"
                                    || if room_id == "?" {
                                        !rooms.contains(&d.room_id)
                                    } else {
                                        d.room_id == room_id
                                    })
                        })
                    })
                {
                    return Err(AppError::invalid("设备列表或房间已变化，请重新调整。"));
                }
                let home = document.homes.entry(home_id.into()).or_default();
                if home.room_orders.len() >= 512 && !home.room_orders.contains_key(&room_id) {
                    return Err(storage_error());
                }
                home.room_orders.insert(room_id, device_ids);
            }
            PreferenceChange::ResetOrder => {
                if let Some(home) = document.homes.get_mut(home_id) {
                    home.room_orders.clear();
                }
            }
            PreferenceChange::SetRouterCommon {
                did,
                expected,
                macs,
            } => {
                if !valid_id(&did)
                    || !devices.iter().any(|d| {
                        d.did == did && d.model == crate::router::MODEL && d.split_route.is_none()
                    })
                    || !valid_common(&expected)
                    || !valid_common(&macs)
                {
                    return Err(AppError::invalid("路由器或常用设备列表无效。"));
                }
                let home = document.homes.entry(home_id.into()).or_default();
                let current = home
                    .router_common_devices
                    .get(&did)
                    .map(Vec::as_slice)
                    .unwrap_or(&[]);
                if current != expected {
                    return Err(AppError::new(
                        "conflict",
                        "常用设备列表已改变，请重新打开。",
                        false,
                    ));
                }
                if macs.is_empty() {
                    home.router_common_devices.remove(&did);
                } else {
                    home.router_common_devices.insert(did, macs);
                }
                if home.router_common_devices.len() > MAX_IDS {
                    return Err(storage_error());
                }
            }
        }
        if document.homes.len() > 256 {
            return Err(storage_error());
        }
        self.save(&document)?;
        Ok(Self::project(&self.load(scope)?, home_id))
    }
}
fn valid_id(id: &str) -> bool {
    !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control)
}
fn valid_common(macs: &[String]) -> bool {
    macs.len() <= 5
        && macs.iter().all(|mac| {
            crate::router_client_name::valid_mac(mac) && *mac == mac.to_ascii_uppercase()
        })
        && macs.iter().collect::<BTreeSet<_>>().len() == macs.len()
}
fn valid_ids(ids: &[String]) -> bool {
    ids.len() <= MAX_IDS
        && ids.iter().all(|id| valid_id(id))
        && ids.iter().collect::<BTreeSet<_>>().len() == ids.len()
}
fn storage_error() -> AppError {
    AppError::new("localPreferences", "本地设置无法读取或保存，请重试。", true)
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Fixture(PreferenceStore);
    impl Fixture {
        fn new() -> Self {
            Self(PreferenceStore {
                directory: std::env::temp_dir().join(format!(
                    "mijia-local-preferences-test-{}",
                    uuid::Uuid::new_v4()
                )),
            })
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0.directory);
        }
    }
    fn devices() -> Vec<Device> {
        serde_json::from_value(serde_json::json!([{"did":"a","name":"same","model":"test","online":true,"roomId":"r","roomName":"room"},{"did":"b","name":"same","model":"test","online":false,"roomId":"r","roomName":"room"}])).unwrap()
    }
    #[test]
    fn monitor_defaults_restore_and_account_home_isolation_without_device_changes() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        let mut camera = devices()[0].clone();
        camera.model = "xiaomi.camera.c302".into();
        assert!(!f.0.view(&scope, "h").unwrap().monitor.enabled);
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetMonitorEnabled { value: true },
            &[camera.clone()],
            &[],
        )
        .unwrap();
        assert!(f.0.view(&scope, "h").unwrap().monitor.enabled);
        assert!(!f.0.view(&scope, "other").unwrap().monitor.enabled);
        assert!(
            !f.0.view(&PreferenceStore::scope("2", "cn"), "h")
                .unwrap()
                .monitor
                .enabled
        );
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetMonitorExcluded {
                did: camera.did.clone(),
                excluded: true,
            },
            &[camera.clone()],
            &[],
        )
        .unwrap();
        assert!(f
            .0
            .change(
                &scope,
                "h",
                PreferenceChange::SetMonitorEnabled { value: true },
                &[camera.clone()],
                &[]
            )
            .is_err());
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetMonitorEnabled { value: false },
            &[camera],
            &[],
        )
        .unwrap();
        let p = f.0.view(&scope, "h").unwrap();
        assert!(!p.monitor.enabled);
        assert_eq!(p.monitor.excluded_device_ids, ["a"]);
    }
    #[test]
    fn router_common_is_bounded_context_scoped_and_uses_a_stale_baseline_guard() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("one", "cn");
        let other = PreferenceStore::scope("two", "cn");
        let routers:Vec<Device>=serde_json::from_value(serde_json::json!([{"did":"r1","name":"router","model":crate::router::MODEL,"online":true,"roomId":"room","roomName":"room"},{"did":"r2","name":"router","model":crate::router::MODEL,"online":true,"roomId":"room","roomName":"room"}])).unwrap();
        let macs = vec![
            "AA:BB:CC:00:00:01".to_string(),
            "AA:BB:CC:00:00:02".to_string(),
        ];
        let set = |did: &str, expected: Vec<String>, macs: Vec<String>| {
            PreferenceChange::SetRouterCommon {
                did: did.into(),
                expected,
                macs,
            }
        };
        let view =
            f.0.change(
                &scope,
                "home",
                set("r1", vec![], macs.clone()),
                &routers,
                &[],
            )
            .unwrap();
        assert_eq!(view.router_common_devices["r1"], macs);
        assert!(f
            .0
            .view(&scope, "elsewhere")
            .unwrap()
            .router_common_devices
            .is_empty());
        assert!(f
            .0
            .view(&other, "home")
            .unwrap()
            .router_common_devices
            .is_empty());
        assert!(!view.router_common_devices.contains_key("r2"));
        assert_eq!(
            f.0.change(&scope, "home", set("r1", vec![], vec![]), &routers, &[])
                .unwrap_err()
                .kind,
            "conflict"
        );
        for invalid in [
            vec!["invalid".into()],
            vec!["aa:bb:cc:00:00:01".into()],
            vec![macs[0].clone(), macs[0].clone()],
            (1..=6).map(|i| format!("AA:BB:CC:00:00:{i:02X}")).collect(),
        ] {
            assert!(f
                .0
                .change(
                    &scope,
                    "home",
                    set("r1", macs.clone(), invalid),
                    &routers,
                    &[]
                )
                .is_err());
        }
        assert!(f
            .0
            .change(
                &scope,
                "home",
                set("unknown", vec![], macs.clone()),
                &routers,
                &[]
            )
            .is_err());
        assert_eq!(
            f.0.view(&scope, "home").unwrap().router_common_devices["r1"],
            macs
        );
        f.0.change(&scope, "home", set("r1", macs, vec![]), &routers, &[])
            .unwrap();
        assert!(f
            .0
            .view(&scope, "home")
            .unwrap()
            .router_common_devices
            .is_empty());
    }
    #[test]
    fn old_documents_migrate_without_losing_order_or_existing_hidden_devices() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        std::fs::create_dir_all(&f.0.directory).unwrap();
        let old = serde_json::json!({"version":1,"scope":scope,"hideOffline":true,"dragLocked":false,"homes":{"h":{"hiddenDeviceIds":["b"],"roomOrders":{"r":["b","a"]}}}});
        std::fs::write(f.0.path(&scope).unwrap(), serde_json::to_vec(&old).unwrap()).unwrap();
        let view = f.0.view(&scope, "h").unwrap();
        assert!(!view.split_switches);
        assert!(view.home_hidden_device_ids.is_empty());
        assert_eq!(view.hidden_device_ids, vec!["b"]);
        assert_eq!(view.room_orders["r"], vec!["b", "a"]);
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHomeHidden {
                did: "a".into(),
                hidden: true,
            },
            &devices(),
            &["r".into()],
        )
        .unwrap();
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetSplitSwitches { value: true },
            &devices(),
            &[],
        )
        .unwrap();
        let reloaded = f.0.view(&scope, "h").unwrap();
        assert!(reloaded.split_switches && reloaded.hide_offline);
        assert_eq!(reloaded.hidden_device_ids, view.hidden_device_ids);
        assert_eq!(reloaded.room_orders, view.room_orders);
        assert_eq!(reloaded.home_hidden_device_ids, vec!["a"]);
        assert!(f
            .0
            .view(&scope, "other-home")
            .unwrap()
            .home_hidden_device_ids
            .is_empty());
        assert!(f.0.view(&scope, "other-home").unwrap().split_switches);
        assert_eq!(
            f.0.view(&PreferenceStore::scope("2", "cn"), "h").unwrap(),
            PreferenceView::default()
        );
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHomeHidden {
                did: "a".into(),
                hidden: false,
            },
            &[],
            &[],
        )
        .unwrap();
        assert!(f
            .0
            .view(&scope, "h")
            .unwrap()
            .home_hidden_device_ids
            .is_empty());
    }
    #[test]
    fn home_only_visibility_rejects_foreign_devices_and_corrupt_ids() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        for did in ["foreign", "", "bad\nidentifier"] {
            assert!(f
                .0
                .change(
                    &scope,
                    "h",
                    PreferenceChange::SetHomeHidden {
                        did: did.into(),
                        hidden: true
                    },
                    &devices(),
                    &[]
                )
                .is_err());
        }
        assert!(!f.0.path(&scope).unwrap().exists());
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHomeHidden {
                did: "a".into(),
                hidden: true,
            },
            &devices(),
            &[],
        )
        .unwrap();
        let mut document: serde_json::Value =
            serde_json::from_slice(&std::fs::read(f.0.path(&scope).unwrap()).unwrap()).unwrap();
        document["homes"]["h"]["homeHiddenDeviceIds"] = serde_json::json!(["bad\nidentifier"]);
        std::fs::write(
            f.0.path(&scope).unwrap(),
            serde_json::to_vec(&document).unwrap(),
        )
        .unwrap();
        assert!(f.0.view(&scope, "h").is_err());
    }
    #[test]
    fn persists_local_settings_order_and_hidden_ids_without_mutating_inventory() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        let devices = devices();
        let rooms = vec!["r".into()];
        assert_eq!(f.0.view(&scope, "h").unwrap(), PreferenceView::default());
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetOrder {
                room_id: "r".into(),
                device_ids: vec!["b".into(), "a".into()],
            },
            &devices,
            &rooms,
        )
        .unwrap();
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHidden {
                did: "a".into(),
                hidden: true,
            },
            &devices,
            &rooms,
        )
        .unwrap();
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHideOffline { value: true },
            &devices,
            &rooms,
        )
        .unwrap();
        let reloaded = PreferenceStore {
            directory: f.0.directory.clone(),
        }
        .view(&scope, "h")
        .unwrap();
        assert!(reloaded.hide_offline);
        assert_eq!(reloaded.hidden_device_ids, vec!["a"]);
        assert_eq!(reloaded.room_orders["r"], vec!["b", "a"]);
        assert_eq!(devices[0].did, "a");
        assert!(f
            .0
            .view(&scope, "other-home")
            .unwrap()
            .hidden_device_ids
            .is_empty());
        assert!(f.0.view(&scope, "other-home").unwrap().hide_offline);
        for other in [
            PreferenceStore::scope("2", "cn"),
            PreferenceStore::scope("1", "de"),
        ] {
            assert_eq!(f.0.view(&other, "h").unwrap(), PreferenceView::default());
        }
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHidden {
                did: "a".into(),
                hidden: false,
            },
            &[],
            &rooms,
        )
        .unwrap();
        f.0.change(&scope, "h", PreferenceChange::ResetOrder, &devices, &rooms)
            .unwrap();
        assert!(f.0.view(&scope, "h").unwrap().room_orders.is_empty());
        assert!(f.0.view(&scope, "h").unwrap().hidden_device_ids.is_empty());
    }
    #[test]
    fn validates_lock_membership_room_duplicates_and_malformed_requests() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        let devices = devices();
        let rooms = vec!["r".into()];
        for (room, ids) in [
            ("r", vec!["a", "a"]),
            ("r", vec!["foreign"]),
            ("foreign", vec!["a"]),
            ("?", vec!["a"]),
        ] {
            assert!(f
                .0
                .change(
                    &scope,
                    "h",
                    PreferenceChange::SetOrder {
                        room_id: room.into(),
                        device_ids: ids.into_iter().map(String::from).collect()
                    },
                    &devices,
                    &rooms
                )
                .is_err());
        }
        assert!(f
            .0
            .change(
                &scope,
                "h",
                PreferenceChange::SetHidden {
                    did: "foreign".into(),
                    hidden: true
                },
                &devices,
                &rooms
            )
            .is_err());
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetDragLocked { value: true },
            &devices,
            &rooms,
        )
        .unwrap();
        assert!(f
            .0
            .change(
                &scope,
                "h",
                PreferenceChange::SetOrder {
                    room_id: "r".into(),
                    device_ids: vec!["b".into(), "a".into()]
                },
                &devices,
                &rooms
            )
            .is_err());
        assert!(serde_json::from_value::<PreferenceChange>(
            serde_json::json!({"operation":"setHidden","did":"a","hidden":true,"cloud":true})
        )
        .is_err());
    }
    #[test]
    fn rejects_wrong_scope_corruption_and_invalid_paths_without_overwriting() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("1", "cn");
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetHideOffline { value: true },
            &[],
            &[],
        )
        .unwrap();
        let other = PreferenceStore::scope("2", "cn");
        std::fs::copy(f.0.path(&scope).unwrap(), f.0.path(&other).unwrap()).unwrap();
        assert!(f.0.view(&other, "h").is_err());
        assert!(f.0.view("../unsafe", "h").is_err());
        std::fs::write(f.0.path(&scope).unwrap(), b"invalid json").unwrap();
        assert!(f
            .0
            .change(&scope, "h", PreferenceChange::ResetOrder, &[], &[])
            .is_err());
        assert_eq!(
            std::fs::read(f.0.path(&scope).unwrap()).unwrap(),
            b"invalid json"
        );
    }
}
