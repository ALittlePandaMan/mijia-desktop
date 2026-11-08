//! Independent gxj v29 mode/settings translation:10739/10850/10706/11123.
//! Parsing is inert; the vendor's unquoted configuration is never evaluated.
use crate::{
    dispenser::MODEL,
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Mode {
    pub id: u8,
    pub name: String,
    pub temperature: u8,
    pub volumes: Vec<u16>,
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Setting {
    ChildLock,
    Screen,
    DefaultMode,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Setting {
        field: Setting,
        expected: Value,
        value: Value,
    },
    Modes {
        expected: String,
        modes: Vec<Mode>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: Option<u8>,
    pub fault: Option<u32>,
    pub temperature: Option<f64>,
    pub modes: Vec<Mode>,
    pub mode_source: Option<String>,
    pub mode_error: Option<String>,
    pub child_lock: Option<u8>,
    pub screen: Option<u8>,
    pub default_mode: Option<u8>,
    pub dnd: Option<bool>,
    pub dnd_period: Option<String>,
    pub progress: Option<u8>,
    pub sterilization_cycle: Option<u8>,
}
pub struct Plan {
    pub siid: u32,
    pub piid: u32,
    pub value: Value,
    pub no_op: bool,
}

pub fn property<'a>(
    panel: &'a DevicePanel,
    siid: u32,
    piid: u32,
    name: &str,
    format: &str,
) -> Option<&'a Property> {
    if panel.model != MODEL
        || panel.unsupported_reason.is_some()
        || !panel
            .spec_type
            .as_ref()
            .is_some_and(|s| s.starts_with("urn:miot-spec-v2:device:water-dispenser:"))
    {
        return None;
    }
    let mut values = panel
        .services
        .iter()
        .filter(|s| s.siid == siid)
        .flat_map(|s| &s.properties)
        .filter(|p| {
            p.siid == siid
                && p.piid == piid
                && p.name == name
                && p.format == format
                && p.unsupported_reason.is_none()
        });
    let p = values.next()?;
    values.next().is_none().then_some(p)
}
fn current<'a>(
    panel: &'a DevicePanel,
    siid: u32,
    piid: u32,
    name: &str,
    format: &str,
) -> Option<&'a Value> {
    let p = property(panel, siid, piid, name, format)?;
    (p.code == Some(0) && p.access.iter().any(|a| a == "read")).then_some(())?;
    p.value.as_ref()
}
fn number(panel: &DevicePanel, siid: u32, piid: u32, name: &str) -> Option<u8> {
    u8::try_from(current(panel, siid, piid, name, "uint8")?.as_u64()?).ok()
}
pub fn profile(panel: &DevicePanel) -> bool {
    property(panel, 2, 2, "status", "uint8").is_some()
        && property(panel, 2, 7, "local-mode-config", "string").is_some()
}
pub fn setting_binding(panel: &DevicePanel, field: Setting) -> Option<&Property> {
    let (s, p, n) = match field {
        Setting::ChildLock => (3, 1, "mode"),
        Setting::Screen => (4, 1, "auto-screen-off-time"),
        Setting::DefaultMode => (2, 6, "tap-default-mode"),
    };
    property(panel, s, p, n, "uint8")
}
pub fn setting_current(panel: &DevicePanel, field: Setting) -> Option<&Value> {
    let p = setting_binding(panel, field)?;
    if p.code != Some(0) || !p.access.iter().any(|a| a == "read") {
        return None;
    }
    let value = p.value.as_ref()?;
    let n = value.as_u64()?;
    let valid = match field {
        Setting::ChildLock => n <= 2,
        Setting::Screen => n <= 3,
        // A removed mode may still be referenced by the device. Preserve the
        // actual uint8 baseline so the user can choose an existing mode/0.
        Setting::DefaultMode => n <= u64::from(u8::MAX),
    };
    valid.then_some(value)
}
pub fn mode_source(panel: &DevicePanel) -> Option<&str> {
    current(panel, 2, 7, "local-mode-config", "string")?.as_str()
}
pub fn snapshot(panel: &DevicePanel) -> Option<Snapshot> {
    if !profile(panel) {
        return None;
    }
    let mode_source = mode_source(panel).map(str::to_owned);
    let (modes, mode_error) = match mode_source.as_deref() {
        Some(s) => match parse_modes(s) {
            Ok(m) => (m, None),
            Err(e) => (Vec::new(), Some(e.message)),
        },
        None => (Vec::new(), Some("设备模式尚未实时读取。".into())),
    };
    Some(Snapshot {
        status: number(panel, 2, 2, "status"),
        fault: current(panel, 2, 1, "fault", "uint32")
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok()),
        temperature: current(panel, 2, 3, "temperature", "float").and_then(Value::as_f64),
        modes,
        mode_source,
        mode_error,
        child_lock: setting_current(panel, Setting::ChildLock)
            .and_then(Value::as_u64)
            .map(|v| v as u8),
        screen: setting_current(panel, Setting::Screen)
            .and_then(Value::as_u64)
            .map(|v| v as u8),
        default_mode: setting_current(panel, Setting::DefaultMode)
            .and_then(Value::as_u64)
            .map(|v| v as u8),
        dnd: current(panel, 5, 1, "no-disturb", "bool").and_then(Value::as_bool),
        dnd_period: current(panel, 5, 2, "enable-time-period", "string")
            .and_then(Value::as_str)
            .map(str::to_owned),
        progress: number(panel, 2, 8, "progress"),
        sterilization_cycle: number(panel, 2, 9, "sterilization-remind-cycle"),
    })
}
pub fn refresh(panel: &mut DevicePanel) {
    panel.dispenser = snapshot(panel);
}
fn invalid_modes() -> AppError {
    AppError::new(
        "unsupported",
        "设备模式配置无法可靠解析，请重新读取或在米家中检查。",
        false,
    )
}
pub fn parse_modes(source: &str) -> Result<Vec<Mode>> {
    if source.len() > 4096 {
        return Err(invalid_modes());
    }
    let body = source
        .strip_prefix('[')
        .and_then(|s| s.strip_suffix(']'))
        .ok_or_else(invalid_modes)?
        .strip_suffix(',')
        .unwrap_or_else(|| &source[1..source.len() - 1]);
    if body.is_empty() {
        return Ok(Vec::new());
    }
    let mut modes = Vec::new();
    let mut seen = HashSet::new();
    for (i, row) in body.split(",[").enumerate() {
        let row = if i == 0 {
            row.strip_prefix('[').ok_or_else(invalid_modes)?
        } else {
            row
        };
        let row = row.strip_suffix(']').ok_or_else(invalid_modes)?;
        let fields = row.split(',').collect::<Vec<_>>();
        if fields.len() < 4 || fields.len() > 9 {
            return Err(invalid_modes());
        }
        let id = fields[0].parse::<u8>().map_err(|_| invalid_modes())?;
        let name = fields[1].to_owned();
        let temperature = fields[2].parse::<u8>().map_err(|_| invalid_modes())?;
        let volumes = fields[3..]
            .iter()
            .map(|v| v.parse::<u16>().map_err(|_| invalid_modes()))
            .collect::<Result<Vec<_>>>()?;
        if !(1..=11).contains(&id)
            || !seen.insert(id)
            || name.is_empty()
            || name.chars().any(|c| c.is_control() || "[]".contains(c))
            || temperature > 100
        {
            return Err(invalid_modes());
        }
        modes.push(Mode {
            id,
            name,
            temperature,
            volumes,
        });
    }
    if modes.len() > 8 {
        return Err(invalid_modes());
    }
    Ok(modes)
}
pub fn serialize_modes(modes: &[Mode]) -> String {
    format!(
        "[{}]",
        modes
            .iter()
            .map(|m| format!(
                "[{},{},{},{}]",
                m.id,
                m.name,
                m.temperature,
                m.volumes
                    .iter()
                    .map(u16::to_string)
                    .collect::<Vec<_>>()
                    .join(",")
            ))
            .collect::<Vec<_>>()
            .join(",")
    )
}
pub fn valid_volume(v: u16) -> bool {
    (80..=300).contains(&v) && v % 10 == 0 || (350..=950).contains(&v) && v % 50 == 0 || v == 999
}
fn name_weight(s: &str) -> usize {
    s.encode_utf16().map(|c| if c <= 255 { 1 } else { 2 }).sum()
}
pub fn validate_modes(previous: &[Mode], next: &[Mode]) -> Result<()> {
    let bad = || AppError::invalid("模式名称、温度或杯量不符合设备要求。");
    if next.is_empty() || next.len() > 8 {
        return Err(bad());
    }
    let mut ids = HashSet::new();
    let mut names = HashSet::new();
    for m in next {
        if !(1..=11).contains(&m.id)
            || !ids.insert(m.id)
            || m.name.trim().is_empty()
            || name_weight(&m.name) > 12
            || !names.insert(m.name.as_str())
            || m.name.chars().any(|c| c.is_control() || ",[]".contains(c))
            || m.volumes.is_empty()
            || m.volumes.len() > 6
            || !m.volumes.iter().all(|v| valid_volume(*v))
        {
            return Err(bad());
        }
        let old = previous.iter().find(|p| p.id == m.id);
        if m.id == 1 {
            let old = old.ok_or_else(bad)?;
            if old.name != m.name || old.temperature != m.temperature {
                return Err(AppError::invalid(
                    "常温模式名称与温度由设备提供，不能修改。",
                ));
            }
        } else if !(40..=100).contains(&m.temperature) {
            return Err(bad());
        }
        if m.id <= 4 && old.is_none() {
            return Err(bad());
        }
        if m.id <= 4 && old.is_some_and(|p| p.volumes.len() != m.volumes.len()) {
            return Err(AppError::invalid("原厂模式不能增减杯量挡位。"));
        }
    }
    if previous.iter().any(|m| m.id == 1) && !next.iter().any(|m| m.id == 1) {
        return Err(AppError::invalid("常温模式不能删除。"));
    }
    Ok(())
}
pub fn plan(panel: &DevicePanel, change: &Change) -> Result<Plan> {
    match change {
        Change::Setting {
            field,
            expected,
            value,
        } => {
            let p = setting_binding(panel, *field).ok_or_else(AppError::protocol)?;
            if setting_current(panel, *field) != Some(expected) {
                return Err(AppError::new(
                    "stateChanged",
                    "设备设置已变化，请重新读取后再编辑。",
                    false,
                ));
            }
            if !p.access.iter().any(|a| a == "write") {
                return Err(AppError::invalid("此设置不可写入。"));
            }
            spec::validate_value(p, value)?;
            let n = value
                .as_u64()
                .ok_or_else(|| AppError::invalid("设置值无效。"))?;
            let valid = match field {
                Setting::ChildLock => n <= 2,
                Setting::Screen => n <= 3,
                Setting::DefaultMode => {
                    n == 0
                        || mode_source(panel)
                            .and_then(|s| parse_modes(s).ok())
                            .is_some_and(|m| m.iter().any(|m| u64::from(m.id) == n))
                }
            };
            if !valid {
                return Err(AppError::invalid("此设备未提供该设置选项。"));
            }
            Ok(Plan {
                siid: p.siid,
                piid: p.piid,
                value: value.clone(),
                no_op: expected == value,
            })
        }
        Change::Modes { expected, modes } => {
            let source = mode_source(panel).ok_or_else(invalid_modes)?;
            if source != expected {
                return Err(AppError::new(
                    "stateChanged",
                    "设备上的模式已被修改，请重新读取后再编辑。",
                    false,
                ));
            }
            let old = parse_modes(source)?;
            validate_modes(&old, modes)?;
            let p = property(panel, 2, 7, "local-mode-config", "string")
                .ok_or_else(AppError::protocol)?;
            let value = json!(serialize_modes(modes));
            if !p.access.iter().any(|a| a == "write") {
                return Err(AppError::invalid("设备上的模式不可写入。"));
            }
            spec::validate_value(p, &value)?;
            Ok(Plan {
                siid: 2,
                piid: 7,
                value,
                no_op: old == *modes,
            })
        }
    }
}
pub fn target_matches(panel: &DevicePanel, change: &Change) -> bool {
    match change {
        Change::Setting { field, value, .. } => setting_current(panel, *field) == Some(value),
        Change::Modes { modes, .. } => {
            mode_source(panel)
                .and_then(|s| parse_modes(s).ok())
                .as_ref()
                == Some(modes)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const SOURCE: &str = "[[1,常温,25,150],[2,泡奶,45,150],[5,50度,50,150,350]]";
    fn panel() -> DevicePanel {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        p.did = "123".into();
        for q in p.services.iter_mut().flat_map(|s| &mut s.properties) {
            q.code = Some(0);
            q.value = match (q.siid, q.piid) {
                (2, 7) => Some(json!(SOURCE)),
                (2, 3) => Some(json!(25.0)),
                (2, 2) => Some(json!(1)),
                (3, 1) => Some(json!(2)),
                (4, 1) => Some(json!(0)),
                (2, 6) => Some(json!(0)),
                _ => None,
            };
        }
        p
    }
    #[test]
    fn config_parsing_is_inert_and_preserves_mode_order_and_gears() {
        let m = parse_modes(SOURCE).unwrap();
        assert_eq!(m.len(), 3);
        assert_eq!(m[2].volumes, [150, 350]);
        assert_eq!(serialize_modes(&m), SOURCE);
        assert_eq!(
            parse_modes(&format!("{},]", &SOURCE[..SOURCE.len() - 1])).unwrap(),
            m
        );
        for s in [
            "globalThis.x=1",
            "[[1,常温,25]]",
            "[[1,a,25,150],[1,b,50,150]]",
            "[[1,a,25,150],[2,a,b,150]]",
        ] {
            assert!(parse_modes(s).is_err());
        }
    }
    #[test]
    fn mode_validation_enforces_native_ranges_and_protects_ordinary_mode() {
        let old = parse_modes(SOURCE).unwrap();
        let mut m = old.clone();
        m[0].temperature = 50;
        assert!(validate_modes(&old, &m).is_err());
        m = old.clone();
        m.remove(0);
        assert!(validate_modes(&old, &m).is_err());
        m = old.clone();
        m[1].volumes.push(200);
        assert!(validate_modes(&old, &m).is_err());
        for v in [80, 150, 300, 350, 950, 999] {
            assert!(valid_volume(v));
        }
        for v in [0, 79, 301, 325, 951, 1000] {
            assert!(!valid_volume(v));
        }
    }
    #[test]
    fn names_and_new_modes_cannot_corrupt_the_unquoted_protocol() {
        let old = parse_modes(SOURCE).unwrap();
        for name in ["a,b", "a[b]", "", "七个汉字七个字", "line\nbreak"] {
            let mut m = old.clone();
            m[2].name = name.into();
            assert!(validate_modes(&old, &m).is_err());
        }
        let mut m = old.clone();
        m.push(Mode {
            id: 6,
            name: "新模式".into(),
            temperature: 50,
            volumes: vec![150],
        });
        assert!(validate_modes(&old, &m).is_ok());
        m.last_mut().unwrap().id = 3;
        assert!(validate_modes(&old, &m).is_err());
    }
    #[test]
    fn fresh_baselines_are_required_and_control_receipts_do_not_change_current_values() {
        let mut p = panel();
        let mut m = parse_modes(SOURCE).unwrap();
        m[1].temperature = 46;
        let c = Change::Modes {
            expected: SOURCE.into(),
            modes: m,
        };
        let request = plan(&p, &c).unwrap();
        assert!(!request.no_op);
        assert_eq!((request.siid, request.piid), (2, 7));
        assert!(!target_matches(&p, &c));
        let q = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 7)
            .unwrap();
        q.value = Some(request.value);
        assert!(target_matches(&p, &c));
        assert!(plan(&p, &c).is_err());
    }
    #[test]
    fn setting_choices_follow_current_config_and_require_real_reads() {
        let mut p = panel();
        let c = Change::Setting {
            field: Setting::DefaultMode,
            expected: json!(0),
            value: json!(5),
        };
        assert!(plan(&p, &c).is_ok());
        let absent = Change::Setting {
            field: Setting::DefaultMode,
            expected: json!(0),
            value: json!(6),
        };
        assert!(plan(&p, &absent).is_err());
        let q = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 6)
            .unwrap();
        q.code = Some(-1);
        assert!(plan(&p, &c).is_err());
        assert!(setting_current(&p, Setting::DefaultMode).is_none());
    }
    #[test]
    fn partial_snapshot_has_no_invented_status_or_settings() {
        let mut p = panel();
        let q = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 2)
            .unwrap();
        q.code = Some(-1);
        let s = snapshot(&p).unwrap();
        assert_eq!(s.status, None);
        assert_eq!(s.child_lock, Some(2));
        assert_eq!(s.modes.len(), 3);
        p.model = "xiaomi.ysj.gxj2".into();
        assert!(snapshot(&p).is_none());
    }
    #[test]
    fn removed_default_mode_can_be_changed_to_memory_without_inventing_a_read_failure() {
        let mut p = panel();
        let q = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 6)
            .unwrap();
        q.value = Some(json!(6));
        assert_eq!(snapshot(&p).unwrap().default_mode, Some(6));
        assert!(plan(
            &p,
            &Change::Setting {
                field: Setting::DefaultMode,
                expected: json!(6),
                value: json!(0)
            }
        )
        .is_ok());
        assert!(plan(
            &p,
            &Change::Setting {
                field: Setting::DefaultMode,
                expected: json!(6),
                value: json!(6)
            }
        )
        .is_err());
    }
}
