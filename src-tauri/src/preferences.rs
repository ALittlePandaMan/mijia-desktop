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

#[derive(
    Clone, Copy, Debug, Default, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema,
)]
#[serde(rename_all = "camelCase")]
pub enum CardSize {
    Small,
    #[default]
    Medium,
    Large,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct MonitorPreferences {
    pub enabled: bool,
    pub excluded_device_ids: Vec<String>,
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SceneShortcutLayout {
    pub scene_ids: Vec<String>,
    pub hidden_scene_ids: Vec<String>,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreferenceView {
    #[serde(default)]
    pub monitor_all_homes: bool,
    #[serde(default)]
    pub card_sizes: BTreeMap<String, CardSize>,
    #[serde(default)]
    pub scene_shortcuts: BTreeMap<String, SceneShortcutLayout>,
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

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum PreferenceChange {
    SetCardSize {
        did: String,
        size: CardSize,
    },
    SetCardLayout {
        room_id: String,
        device_ids: Vec<String>,
        card_sizes: BTreeMap<String, CardSize>,
        scenes: Option<SceneShortcutLayout>,
    },
    SetSceneShortcuts {
        room_id: String,
        scene_ids: Vec<String>,
        hidden_scene_ids: Vec<String>,
    },
    SetCameraPrimaryLens {
        did: String,
        lens_id: u8,
    },
    SetMonitorAllHomes { value: bool },
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
}

#[derive(Default, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct HomePreferences {
    #[serde(default)]
    card_sizes: BTreeMap<String, CardSize>,
    #[serde(default)]
    scene_shortcuts: BTreeMap<String, SceneShortcutLayout>,
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

#[derive(Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Document {
    #[serde(default)]
    monitor_all_homes: bool,
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
            directory: PathBuf::from(
                crate::platform_paths::local_data_dir().ok_or_else(storage_error)?,
            )
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
                    monitor_all_homes: false,
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
                    || home.card_sizes.len() > MAX_IDS
                    || home.card_sizes.keys().any(|id| !valid_id(id))
                    || home.scene_shortcuts.len() > 512
                    || home.scene_shortcuts.iter().any(|(room, layout)| {
                        !valid_id(room)
                            || !valid_ids(&layout.scene_ids)
                            || !valid_ids(&layout.hidden_scene_ids)
                    })
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
        if destination.exists() {
            let previous=std::fs::read(&destination).map_err(|_|storage_error())?;
            let legacy=serde_json::from_slice::<serde_json::Value>(&previous).map_err(|_|storage_error())?;
            let backup=destination.with_extension("before-all-home-monitor.json");
            if legacy.get("monitorAllHomes").is_none() && !backup.exists() {std::fs::write(&backup,previous).map_err(|_|storage_error())?;}
        }
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
            monitor_all_homes: document.monitor_all_homes,
            card_sizes: home.map(|h| h.card_sizes.clone()).unwrap_or_default(),
            scene_shortcuts: home.map(|h| h.scene_shortcuts.clone()).unwrap_or_default(),
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
            PreferenceChange::SetCardSize { did, size } => {
                if !valid_id(&did) || !devices.iter().any(|d| d.did == did) {
                    return Err(AppError::stale());
                }
                let home = document.homes.entry(home_id.into()).or_default();
                if size == CardSize::Medium {
                    home.card_sizes.remove(&did);
                } else {
                    home.card_sizes.insert(did, size);
                }
                if home.card_sizes.len() > MAX_IDS {
                    return Err(storage_error());
                }
            }
            PreferenceChange::SetCardLayout {
                room_id,
                device_ids,
                card_sizes,
                scenes,
            } => {
                if document.drag_locked {
                    return Err(AppError::invalid("设备位置已锁定，请先在设置中解锁。"));
                }
                if !valid_id(&room_id)
                    || !(room_id == "*"
                        || room_id == "?"
                        || rooms.contains(&room_id)
                        || room_id == "@scenes" && device_ids.is_empty() && card_sizes.is_empty())
                    || !valid_ids(&device_ids)
                    || card_sizes.len() > MAX_IDS
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
                    || card_sizes
                        .keys()
                        .any(|id| !valid_id(id) || !device_ids.contains(id))
                    || scenes.as_ref().is_some_and(|s| {
                        !valid_ids(&s.scene_ids) || !valid_ids(&s.hidden_scene_ids)
                    })
                {
                    return Err(AppError::invalid("设备列表或房间已变化，请重新调整。"));
                }
                let home = document.homes.entry(home_id.into()).or_default();
                if home.room_orders.len() >= 512 && !home.room_orders.contains_key(&room_id) {
                    return Err(storage_error());
                }
                if scenes.is_some()
                    && home.scene_shortcuts.len() >= 512
                    && !home.scene_shortcuts.contains_key(&room_id)
                {
                    return Err(storage_error());
                }
                for (id, size) in card_sizes {
                    if size == CardSize::Medium {
                        home.card_sizes.remove(&id);
                    } else {
                        home.card_sizes.insert(id, size);
                    }
                }
                if home.card_sizes.len() > MAX_IDS {
                    return Err(storage_error());
                }
                home.room_orders.insert(room_id.clone(), device_ids);
                if let Some(s) = scenes {
                    home.scene_shortcuts.insert(room_id, s);
                }
            }
            PreferenceChange::SetSceneShortcuts {
                room_id,
                scene_ids,
                hidden_scene_ids,
            } => {
                if !valid_id(&room_id)
                    || !(room_id == "*"
                        || room_id == "?"
                        || room_id == "@scenes"
                        || rooms.contains(&room_id))
                    || !valid_ids(&scene_ids)
                    || !valid_ids(&hidden_scene_ids)
                {
                    return Err(AppError::invalid("自动化入口或房间无效，请重新调整。"));
                }
                let home = document.homes.entry(home_id.into()).or_default();
                if home.scene_shortcuts.len() >= 512 && !home.scene_shortcuts.contains_key(&room_id)
                {
                    return Err(storage_error());
                }
                home.scene_shortcuts.insert(
                    room_id,
                    SceneShortcutLayout {
                        scene_ids,
                        hidden_scene_ids,
                    },
                );
            }
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
            PreferenceChange::SetMonitorAllHomes { value } => { document.monitor_all_homes = value; }
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
            mac.len() == 17
                && mac.bytes().enumerate().all(|(i, b)| {
                    if i % 3 == 2 {
                        b == b':'
                    } else {
                        b.is_ascii_hexdigit()
                    }
                })
                && *mac == mac.to_ascii_uppercase()
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
    #[test]
    fn whole_home_scope_is_account_wide_without_changing_household_exclusions() {
        let f=Fixture::new();let scope=PreferenceStore::scope("monitor-account","cn");let mut camera=devices()[0].clone();camera.model="test.camera.a".into();
        f.0.change(&scope,"h",PreferenceChange::SetMonitorExcluded{did:camera.did.clone(),excluded:true},&[camera],&[]).unwrap();
        f.0.change(&scope,"h",PreferenceChange::SetMonitorAllHomes{value:true},&[],&[]).unwrap();
        assert!(f.0.view(&scope,"other").unwrap().monitor_all_homes);assert_eq!(f.0.view(&scope,"h").unwrap().monitor.excluded_device_ids,vec!["a"]);
        assert!(!f.0.view(&PreferenceStore::scope("other-account","cn"),"h").unwrap().monitor_all_homes);
        f.0.change(&scope,"other",PreferenceChange::SetMonitorAllHomes{value:false},&[],&[]).unwrap();assert!(!f.0.view(&scope,"h").unwrap().monitor_all_homes);
    }
    #[test]
    fn card_size_saves_directly_while_locked_without_changing_order_or_scene_layout() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("size", "cn");
        let rooms = vec!["r".into()];
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetOrder {
                room_id: "r".into(),
                device_ids: vec!["b".into(), "a".into()],
            },
            &devices(),
            &rooms,
        )
        .unwrap();
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetDragLocked { value: true },
            &devices(),
            &rooms,
        )
        .unwrap();
        for size in [CardSize::Small, CardSize::Large, CardSize::Medium] {
            let view =
                f.0.change(
                    &scope,
                    "h",
                    PreferenceChange::SetCardSize {
                        did: "a".into(),
                        size,
                    },
                    &devices(),
                    &rooms,
                )
                .unwrap();
            assert_eq!(view.card_sizes.get("a").copied().unwrap_or_default(), size);
            assert!(view.drag_locked);
            assert_eq!(view.room_orders["r"], vec!["b", "a"]);
            assert!(view.scene_shortcuts.is_empty());
            assert_eq!(f.0.view(&scope, "h").unwrap().card_sizes, view.card_sizes);
        }
        assert!(f.0.view(&scope, "h").unwrap().card_sizes.is_empty());
        assert!(f.0.view(&scope, "other").unwrap().card_sizes.is_empty());
        assert!(f
            .0
            .view(&PreferenceStore::scope("other", "cn"), "h")
            .unwrap()
            .card_sizes
            .is_empty());
    }
    #[test]
    fn stale_card_size_request_keeps_the_saved_file_unchanged() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("size-stale", "cn");
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetCardSize {
                did: "a".into(),
                size: CardSize::Small,
            },
            &devices(),
            &[],
        )
        .unwrap();
        let before = std::fs::read(f.0.path(&scope).unwrap()).unwrap();
        assert!(f
            .0
            .change(
                &scope,
                "h",
                PreferenceChange::SetCardSize {
                    did: "missing".into(),
                    size: CardSize::Large
                },
                &devices(),
                &[]
            )
            .is_err());
        assert!(f
            .0
            .change(
                &scope,
                "h",
                PreferenceChange::SetCardSize {
                    did: "a".into(),
                    size: CardSize::Large
                },
                &[],
                &[]
            )
            .is_err());
        assert_eq!(std::fs::read(f.0.path(&scope).unwrap()).unwrap(), before);
    }
    #[test]
    fn card_layout_is_atomic_scoped_and_rejects_stale_or_locked_edits() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("layout", "cn");
        let room = vec!["r".into()];
        let change = PreferenceChange::SetCardLayout {
            room_id: "r".into(),
            device_ids: vec!["b".into(), "a".into()],
            card_sizes: BTreeMap::from([
                ("a".into(), CardSize::Small),
                ("b".into(), CardSize::Large),
            ]),
            scenes: Some(SceneShortcutLayout {
                scene_ids: vec!["task".into()],
                hidden_scene_ids: vec![],
            }),
        };
        let view =
            f.0.change(&scope, "h", change.clone(), &devices(), &room)
                .unwrap();
        assert_eq!(view.card_sizes["a"], CardSize::Small);
        assert_eq!(view.room_orders["r"], vec!["b", "a"]);
        assert_eq!(view.scene_shortcuts["r"].scene_ids, vec!["task"]);
        assert!(f.0.view(&scope, "other").unwrap().card_sizes.is_empty());
        assert!(f
            .0
            .view(&PreferenceStore::scope("other", "cn"), "h")
            .unwrap()
            .card_sizes
            .is_empty());
        assert!(f
            .0
            .change(&scope, "h", change.clone(), &devices()[..1], &room)
            .is_err());
        assert_eq!(f.0.view(&scope, "h").unwrap().card_sizes, view.card_sizes);
        f.0.change(
            &scope,
            "h",
            PreferenceChange::SetDragLocked { value: true },
            &devices(),
            &room,
        )
        .unwrap();
        assert!(f.0.change(&scope, "h", change, &devices(), &room).is_err());
    }
    #[test]
    fn scene_shortcuts_are_local_scoped_and_reload_in_saved_order() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("one", "cn");
        let other = PreferenceStore::scope("two", "cn");
        let rooms = vec!["living".into(), "bed".into()];
        let change = PreferenceChange::SetSceneShortcuts {
            room_id: "living".into(),
            scene_ids: vec!["bed-task".into(), "living-task".into()],
            hidden_scene_ids: vec!["hidden-task".into()],
        };
        f.0.change(&scope, "home", change, &[], &rooms).unwrap();
        let view = f.0.view(&scope, "home").unwrap();
        assert_eq!(
            view.scene_shortcuts["living"].scene_ids,
            vec!["bed-task", "living-task"]
        );
        assert_eq!(
            view.scene_shortcuts["living"].hidden_scene_ids,
            vec!["hidden-task"]
        );
        assert!(f
            .0
            .view(&scope, "other-home")
            .unwrap()
            .scene_shortcuts
            .is_empty());
        assert!(f.0.view(&other, "home").unwrap().scene_shortcuts.is_empty());
        for (room, ids) in [
            ("missing", vec!["a".into()]),
            ("living", vec!["a".into(), "a".into()]),
        ] {
            assert!(f
                .0
                .change(
                    &scope,
                    "home",
                    PreferenceChange::SetSceneShortcuts {
                        room_id: room.into(),
                        scene_ids: ids,
                        hidden_scene_ids: vec![]
                    },
                    &[],
                    &rooms
                )
                .is_err());
        }
        assert_eq!(
            f.0.view(&scope, "home").unwrap().scene_shortcuts["living"].scene_ids,
            vec!["bed-task", "living-task"]
        );
    }
    #[test]
    fn whole_home_starts_empty_but_accepts_and_reloads_manual_scene_shortcuts() {
        let f = Fixture::new();
        let scope = PreferenceStore::scope("one", "cn");
        assert!(f.0.view(&scope, "home").unwrap().scene_shortcuts.is_empty());
        f.0.change(
            &scope,
            "home",
            PreferenceChange::SetSceneShortcuts {
                room_id: "*".into(),
                scene_ids: vec!["living-task".into(), "bed-task".into()],
                hidden_scene_ids: vec![],
            },
            &[],
            &["living".into(), "bed".into()],
        )
        .unwrap();
        let view = f.0.view(&scope, "home").unwrap();
        assert_eq!(
            view.scene_shortcuts["*"].scene_ids,
            vec!["living-task", "bed-task"]
        );
        assert!(!view.scene_shortcuts.contains_key("living"));
        assert!(!view.scene_shortcuts.contains_key("bed"));
    }
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
