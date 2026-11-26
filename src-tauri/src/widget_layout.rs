//! Account-scoped desktop layout. No credentials or observed values are persisted.
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use std::{collections::BTreeMap, path::PathBuf};

pub const MIN_WIDTH: f64 = 160.;
pub const MAX_WIDTH: f64 = 480.;
/// Physical desktop pixels. Screen origins may be negative; never mix these
/// with the per-card DIP coordinates persisted in Geometry.
#[derive(Clone, Copy, Debug, Serialize, PartialEq)]
pub struct PixelRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MenuRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}
impl MenuRect {
    pub fn validate(&self, width: f64, height: f64) -> Result<()> {
        if ![self.x, self.y, self.width, self.height]
            .iter()
            .all(|v| v.is_finite())
            || self.x < 0.
            || self.y < 0.
            || self.width <= 0.
            || self.height <= 0.
            || self.x + self.width > width + 1.
            || self.y + self.height > height + 1.
        {
            return Err(AppError::invalid("组件菜单区域无效。"));
        }
        Ok(())
    }
}
impl PixelRect {
    pub fn intersection(&self, other: &Self) -> Option<Self> {
        let x = self.x.max(other.x);
        let y = self.y.max(other.y);
        let right = (self.x + self.width).min(other.x + other.width);
        let bottom = (self.y + self.height).min(other.y + other.height);
        (right > x && bottom > y).then_some(Self {
            x,
            y,
            width: right - x,
            height: bottom - y,
        })
    }
    pub fn union(&self, other: &Self) -> Self {
        let x = self.x.min(other.x);
        let y = self.y.min(other.y);
        Self {
            x,
            y,
            width: (self.x + self.width).max(other.x + other.width) - x,
            height: (self.y + self.height).max(other.y + other.height) - y,
        }
    }
    pub fn rounded(&self) -> Self {
        Self {
            x: self.x.floor(),
            y: self.y.floor(),
            width: (self.x + self.width).ceil() - self.x.floor(),
            height: (self.y + self.height).ceil() - self.y.floor(),
        }
    }
}
/// Names/rooms may change; physical routing identities must not be silently rebound.
pub fn device_fingerprint(d: &crate::models::Device) -> String {
    crate::mcp_core::fingerprint(&(
        &d.did,
        &d.model,
        &d.spec_type,
        d.control_did(),
        d.control_service_id,
        d.split_route.as_ref().map(|r| r.service_iid),
        &d.group_members,
    ))
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Geometry {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub grid: Option<crate::widget_grid::Placement>,
    #[serde(default)]
    pub size: crate::preferences::CardSize,
    pub monitor: String,
    pub x: f64,
    pub y: f64,
    pub width: f64,
}
impl Default for Geometry {
    fn default() -> Self {
        Self {
            grid: None,
            size: crate::preferences::CardSize::Medium,
            monitor: String::new(),
            x: 40.,
            y: 40.,
            width: 240.,
        }
    }
}
impl Geometry {
    pub fn validate(&self) -> Result<()> {
        if !self.x.is_finite()
            || !self.y.is_finite()
            || !self.width.is_finite()
            || !(if self.grid.is_some() { 120. } else { MIN_WIDTH }..=if self.grid.is_some() {
                8192.
            } else {
                MAX_WIDTH
            })
                .contains(&self.width)
            || self.monitor.len() > 512
            || self.x.abs() > 100000.
            || self.y.abs() > 100000.
        {
            return Err(AppError::invalid("组件位置或尺寸无效。"));
        }
        if let Some(p) = &self.grid {
            let (c, r) = p.preset.dimensions();
            if p.column >= c
                || p.half_row >= r * 2
                || !p.step.is_finite()
                || p.step < self.width
                || p.step > 16384.
            {
                return Err(AppError::invalid("组件栅格位置无效。"));
            }
        }
        Ok(())
    }
    pub fn actual_width(&self) -> f64 {
        if self.size == crate::preferences::CardSize::Large {
            self.width
                + self
                    .grid
                    .as_ref()
                    .map(|p| p.step)
                    .unwrap_or(self.width + 12.)
        } else {
            self.width
        }
    }
    pub fn height(&self) -> f64 {
        if self.size == crate::preferences::CardSize::Small {
            (self.width * 0.8 - 12.) / 2.
        } else {
            self.width * 0.8
        }
    }
    pub fn fit(&self, width: f64, height: f64) -> Self {
        if self.grid.is_some() {
            let mut result = self.clone();
            result.x = result.x.clamp(0., (width - result.actual_width()).max(0.));
            result.y = result.y.clamp(0., (height - result.height()).max(0.));
            return result;
        }
        let mut result = self.clone();
        result.width = result.width.min(
            (if self.size == crate::preferences::CardSize::Large {
                (width - 12.) / 2.
            } else {
                width
            })
            .min(if self.size == crate::preferences::CardSize::Small {
                (height * 2. + 12.) / 0.8
            } else {
                height / 0.8
            })
            .clamp(MIN_WIDTH, MAX_WIDTH),
        );
        result.x = result.x.clamp(0., (width - result.actual_width()).max(0.));
        result.y = result.y.clamp(0., (height - result.height()).max(0.));
        result
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Pin {
    #[serde(default)]
    pub layouts: BTreeMap<String, BTreeMap<String, crate::widget_grid::Anchor>>,
    pub id: String,
    pub scope: String,
    pub home_id: String,
    pub did: String,
    pub fingerprint: String,
    pub name: String,
    pub geometry: Geometry,
}
impl Pin {
    pub fn label(&self) -> String {
        format!("widget-{}", self.id)
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Padding {
    pub top: f64,
    pub right: f64,
    pub bottom: f64,
    pub left: f64,
}
impl Padding {
    pub fn validate(self) -> Result<()> {
        if [self.top, self.right, self.bottom, self.left]
            .iter()
            .any(|v| !v.is_finite() || *v < 0. || v.fract() != 0. || *v > 100000.)
        {
            return Err(AppError::invalid("留白请输入非负整数。"));
        }
        Ok(())
    }
}
#[derive(Clone, Copy, Debug, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DisplayPreferences {
    #[serde(default)]
    pub enabled: bool,
    #[serde(default)]
    pub padding: Padding,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Layout {
    #[serde(default)]
    pub grids: BTreeMap<String, crate::widget_grid::Preset>,
    #[serde(default)]
    pub displays: BTreeMap<String, DisplayPreferences>,
    pub version: u32,
    pub pins: BTreeMap<String, Pin>,
}
impl Default for Layout {
    fn default() -> Self {
        Self {
            grids: BTreeMap::new(),
            displays: BTreeMap::new(),
            version: 3,
            pins: BTreeMap::new(),
        }
    }
}
impl Layout {
    pub fn display(&self, id: &str) -> DisplayPreferences {
        self.displays.get(id).copied().unwrap_or_default()
    }
    pub fn validate(&self) -> Result<()> {
        if ![1, 2, 3].contains(&self.version)
            || self.pins.len() > 512
            || self.grids.len() > 128
            || self.displays.len() > 128
        {
            return Err(AppError::invalid("不支持的桌面组件配置。"));
        }
        for (id, preferences) in &self.displays {
            if id.is_empty() || id.len() > 512 {
                return Err(AppError::invalid("显示器设置无效。"));
            }
            preferences.padding.validate()?;
        }
        for (key, pin) in &self.pins {
            if key != &pin.id
                || uuid::Uuid::parse_str(key).is_err()
                || pin.scope.is_empty()
                || pin.home_id.is_empty()
                || pin.did.is_empty()
                || pin.scope.len() > 256
                || pin.home_id.len() > 256
                || pin.did.len() > 256
                || pin.fingerprint.len() > 256
                || pin.name.len() > 1024
            {
                return Err(AppError::invalid("桌面组件身份无效。"));
            }
            pin.geometry.validate()?;
            if pin.layouts.len() > 128
                || pin.layouts.iter().any(|(monitor, profiles)| {
                    monitor.len() > 512
                        || profiles.len() > 2
                        || profiles.iter().any(|(key, a)| {
                            let p = match key.as_str() {
                                "6x4" => crate::widget_grid::Preset::Six,
                                "8x6" => crate::widget_grid::Preset::Eight,
                                _ => return true,
                            };
                            let (c, r) = p.dimensions();
                            a.column >= c
                                || a.half_row >= r * 2
                                || (a.size != crate::preferences::CardSize::Small
                                    && a.half_row % 2 != 0)
                                || (a.size == crate::preferences::CardSize::Large
                                    && a.column + 1 >= c)
                        })
                })
            {
                return Err(AppError::invalid("组件布局记录无效。"));
            }
        }
        let mut identities = std::collections::HashSet::new();
        if self
            .pins
            .values()
            .any(|p| !identities.insert((&p.scope, &p.home_id, &p.did)))
        {
            return Err(AppError::invalid("重复的桌面组件。"));
        }
        Ok(())
    }
    pub fn existing(&self, scope: &str, home: &str, did: &str) -> Option<&Pin> {
        self.pins
            .values()
            .find(|p| p.scope == scope && p.home_id == home && p.did == did)
    }
}
pub struct Store {
    path: PathBuf,
    pub layout: Layout,
    pub failure: Option<AppError>,
}
impl Store {
    pub fn new(path: PathBuf) -> Result<Self> {
        let layout = if path.exists() {
            let parsed = std::fs::read(&path)
                .ok()
                .filter(|b| b.len() <= 2 * 1024 * 1024)
                .and_then(|b| serde_json::from_slice::<Layout>(&b).ok())
                .filter(|l| l.validate().is_ok());
            match parsed {
                Some(l) => {
                    if l.version == 1 {
                        let backup = path.with_extension("before-grid-v1.json");
                        if !backup.exists() {
                            std::fs::copy(&path, backup).map_err(crate::app_settings::storage)?;
                        }
                    }
                    l
                }
                None => {
                    let backup =
                        path.with_extension(format!("damaged-{}.json", uuid::Uuid::new_v4()));
                    std::fs::copy(&path, backup).map_err(crate::app_settings::storage)?;
                    Layout::default()
                }
            }
        } else {
            Layout::default()
        };
        Ok(Self {
            path,
            layout,
            failure: None,
        })
    }
    pub fn disabled(path: PathBuf, error: AppError) -> Self {
        Self {
            path,
            layout: Layout::default(),
            failure: Some(error),
        }
    }
    pub fn save(&mut self, mut next: Layout) -> Result<()> {
        if let Some(error) = &self.failure {
            return Err(error.clone());
        }
        next.validate()?;
        next.version = 3;
        let parent = self
            .path
            .parent()
            .ok_or_else(|| AppError::invalid("组件配置目录无效。"))?;
        std::fs::create_dir_all(parent).map_err(crate::app_settings::storage)?;
        if self.layout.version < 3 && self.path.exists() {
            let backup = self
                .path
                .with_extension(format!("before-displays-v{}.json", self.layout.version));
            if !backup.exists() {
                std::fs::copy(&self.path, backup).map_err(crate::app_settings::storage)?;
            }
        }
        let temp = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            use std::io::Write;
            let mut file = std::fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(&temp)
                .map_err(crate::app_settings::storage)?;
            file.write_all(&serde_json::to_vec(&next).map_err(crate::app_settings::storage)?)
                .map_err(crate::app_settings::storage)?;
            file.sync_all().map_err(crate::app_settings::storage)?;
            drop(file);
            std::fs::rename(&temp, &self.path).map_err(crate::app_settings::storage)
        })();
        if result.is_err() {
            let _ = std::fs::remove_file(temp);
        } else {
            self.layout = next;
        }
        result
    }
}

/// Hit-testing includes the rounded card, not its transparent corner pixels.
pub fn rounded_hit(x: f64, y: f64, width: f64, height: f64, radius: f64) -> bool {
    if x < 0. || y < 0. || x >= width || y >= height {
        return false;
    }
    let r = radius.min(width / 2.).min(height / 2.);
    let dx = (r - x).max(x - (width - r)).max(0.);
    let dy = (r - y).max(y - (height - r)).max(0.);
    dx * dx + dy * dy <= r * r
}
#[cfg(test)]
mod tests {
    use super::*;
    fn pin(scope: &str, home: &str, did: &str) -> Pin {
        Pin {
            layouts: BTreeMap::new(),
            id: uuid::Uuid::new_v4().to_string(),
            scope: scope.into(),
            home_id: home.into(),
            did: did.into(),
            fingerprint: "route".into(),
            name: "灯".into(),
            geometry: Geometry::default(),
        }
    }
    #[test]
    fn persistence_is_scoped_and_idempotent() {
        let path = std::env::temp_dir().join(format!("widget-test-{}.json", uuid::Uuid::new_v4()));
        let mut store = Store::new(path.clone()).unwrap();
        let mut next = store.layout.clone();
        for p in [
            pin("a", "h", "d"),
            pin("b", "h", "d"),
            pin("a", "other", "d"),
        ] {
            next.pins.insert(p.id.clone(), p);
        }
        store.save(next).unwrap();
        let restored = Store::new(path.clone()).unwrap();
        assert_eq!(restored.layout.pins.len(), 3);
        assert!(restored.layout.existing("a", "h", "d").is_some());
        assert!(restored.layout.existing("a", "h", "x").is_none());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn grid_profiles_survive_restart_and_unpin_removes_all_profiles() {
        use crate::preferences::CardSize;
        use crate::widget_grid::{Anchor, Grid, Preset};
        let path = std::env::temp_dir().join(format!("widget-grid-{}.json", uuid::Uuid::new_v4()));
        let mut store = Store::new(path.clone()).unwrap();
        let mut next = store.layout.clone();
        let mut p = pin("account", "home", "device");
        let six = Grid::new(Preset::Six, 1600., 900.).unwrap();
        let eight = Grid::new(Preset::Eight, 1600., 900.).unwrap();
        for (g, a) in [
            (
                six,
                Anchor {
                    column: 1,
                    half_row: 2,
                    size: CardSize::Medium,
                },
            ),
            (
                eight,
                Anchor {
                    column: 5,
                    half_row: 7,
                    size: CardSize::Small,
                },
            ),
        ] {
            p.layouts
                .entry("screen".into())
                .or_default()
                .insert(g.preset.key().into(), a);
            p.geometry = g.geometry("screen", a);
        }
        let id = p.id.clone();
        next.pins.insert(id.clone(), p);
        next.grids.insert("screen".into(), Preset::Eight);
        store.save(next).unwrap();
        let mut restored = Store::new(path.clone()).unwrap();
        assert_eq!(restored.layout.pins[&id].layouts["screen"].len(), 2);
        assert_eq!(restored.layout.grids["screen"], Preset::Eight);
        let mut next = restored.layout.clone();
        next.pins.remove(&id);
        restored.save(next).unwrap();
        assert!(Store::new(path.clone()).unwrap().layout.pins.is_empty());
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn invalid_write_keeps_previous_layout() {
        let path = std::env::temp_dir().join(format!("widget-test-{}.json", uuid::Uuid::new_v4()));
        let mut store = Store::new(path.clone()).unwrap();
        store.save(Layout::default()).unwrap();
        let before = std::fs::read(&path).unwrap();
        let mut next = store.layout.clone();
        let mut p = pin("a", "h", "d");
        p.geometry.width = f64::NAN;
        next.pins.insert(p.id.clone(), p);
        assert!(store.save(next).is_err());
        assert_eq!(std::fs::read(&path).unwrap(), before);
        std::fs::remove_file(path).unwrap();
    }
    #[test]
    fn duplicate_identity_and_invalid_geometry_rejected() {
        let mut l = Layout::default();
        for p in [pin("a", "h", "d"), pin("a", "h", "d")] {
            l.pins.insert(p.id.clone(), p);
        }
        assert!(l.validate().is_err());
        let mut g = Geometry::default();
        g.width = 481.;
        assert!(g.validate().is_err());
        g.width = 160.;
        assert_eq!(g.height(), 128.);
    }
    #[test]
    fn missing_monitor_fit_does_not_change_preferred_geometry() {
        let g = Geometry {
            grid: None,
            size: crate::preferences::CardSize::Medium,
            monitor: "removed".into(),
            x: 1300.,
            y: 900.,
            width: 240.,
        };
        let fit = g.fit(1000., 700.);
        assert_eq!((fit.x, fit.y), (760., 508.));
        assert_eq!((g.x, g.y), (1300., 900.));
    }
    #[test]
    fn legacy_geometry_defaults_medium_and_preserves_base_width() {
        let mut g: Geometry =
            serde_json::from_value(serde_json::json!({"monitor":"old","x":40,"y":50,"width":300}))
                .unwrap();
        assert_eq!(g.size, crate::preferences::CardSize::Medium);
        assert_eq!((g.actual_width(), g.height()), (300., 240.));
        g.size = crate::preferences::CardSize::Small;
        assert_eq!(g.height(), 114.);
        g.size = crate::preferences::CardSize::Large;
        assert_eq!((g.actual_width(), g.height()), (612., 240.));
        assert_eq!(g.fit(1000., 700.).width, 300.);
        g.validate().unwrap();
        let temporary = g.fit(500., 700.);
        assert_eq!(temporary.actual_width(), 500.);
        assert_eq!(g.width, 300.);
    }
    #[test]
    fn transparent_corners_pass_through() {
        assert!(!rounded_hit(1., 1., 240., 192., 20.));
        assert!(rounded_hit(20., 1., 240., 192., 20.));
        assert!(rounded_hit(120., 90., 240., 192., 20.));
        assert!(!rounded_hit(240., 90., 240., 192., 20.));
    }
    #[test]
    fn host_bounds_preserve_negative_monitor_coordinates() {
        let a = PixelRect {
            x: -1800.,
            y: 40.,
            width: 300.,
            height: 240.,
        };
        let b = PixelRect {
            x: -1400.,
            y: 100.,
            width: 240.,
            height: 192.,
        };
        assert_eq!(
            a.union(&b),
            PixelRect {
                x: -1800.,
                y: 40.,
                width: 640.,
                height: 252.
            }
        );
        assert!(a.intersection(&b).is_none());
    }
    #[test]
    fn crossing_card_is_clipped_without_changing_physical_geometry() {
        let card = PixelRect {
            x: -50.,
            y: 10.,
            width: 300.,
            height: 240.,
        };
        let right = PixelRect {
            x: 0.,
            y: 0.,
            width: 1920.,
            height: 1080.,
        };
        assert_eq!(
            card.intersection(&right),
            Some(PixelRect {
                x: 0.,
                y: 10.,
                width: 250.,
                height: 240.
            })
        );
        assert_eq!(card.x, -50.);
    }
    #[test]
    fn menu_regions_cannot_expand_outside_the_host_or_use_nonfinite_values() {
        assert!(MenuRect {
            x: 0.,
            y: 0.,
            width: 140.,
            height: 50.
        }
        .validate(240., 192.)
        .is_ok());
        assert!(MenuRect {
            x: 230.,
            y: 0.,
            width: 140.,
            height: 50.
        }
        .validate(240., 192.)
        .is_err());
        assert!(MenuRect {
            x: f64::NAN,
            y: 0.,
            width: 140.,
            height: 50.
        }
        .validate(240., 192.)
        .is_err());
    }
}
#[cfg(test)]
mod display_settings_tests {
    use super::*;
    #[test]
    fn old_layouts_default_off_and_backup_only_before_first_write() {
        let path =
            std::env::temp_dir().join(format!("widget-display-{}.json", uuid::Uuid::new_v4()));
        let old = br#"{"version":2,"grids":{"screen":"6x4"},"pins":{}}"#;
        std::fs::write(&path, old).unwrap();
        let mut store = Store::new(path.clone()).unwrap();
        assert!(!store.layout.display("screen").enabled);
        assert_eq!(std::fs::read(&path).unwrap(), old);
        assert!(!path.with_extension("before-displays-v2.json").exists());
        let mut next = store.layout.clone();
        next.displays.entry("screen".into()).or_default().enabled = true;
        store.save(next).unwrap();
        assert_eq!(store.layout.version, 3);
        assert_eq!(
            std::fs::read(path.with_extension("before-displays-v2.json")).unwrap(),
            old
        );
        let restored = Store::new(path.clone()).unwrap();
        assert!(restored.layout.display("screen").enabled);
        assert!(!restored.layout.display("new-screen").enabled);
        let _ = std::fs::remove_file(path.with_extension("before-displays-v2.json"));
        let _ = std::fs::remove_file(path);
    }
}
