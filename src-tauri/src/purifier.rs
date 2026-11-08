//! Exact lx32 profile from vendor plugin 1014586 / package 1796431 v39.
//! A cup row edits the faucet preset, never dispenses water. Only direct,
//! schema-valid readings participate in this projection or authorize changes.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashSet;

pub const MODEL: &str = "xiaomi.waterpuri.lx32";
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Cup {
    pub id: u32,
    pub volume_ml: u32,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Filter {
    pub siid: u32,
    pub name: String,
    pub description: String,
    pub percent: Option<u32>,
    pub days: Option<u32>,
    pub anti_fake: Option<bool>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub status: String,
    pub tds: Option<u32>,
    pub temperature: Option<i32>,
    pub fault: Option<u32>,
    pub cups: Vec<Cup>,
    pub cup_source: Option<String>,
    pub cup_error: Option<String>,
    pub can_edit_cups: bool,
    pub edit_reason: Option<String>,
    pub filters: Vec<Filter>,
}
fn property<'a>(panel: &'a DevicePanel, siid: u32, name: &str) -> Option<&'a Property> {
    let mut found = panel
        .services
        .iter()
        .filter(|s| s.siid == siid)
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == name && p.siid == siid);
    let p = found.next()?;
    if found.next().is_some() {
        None
    } else {
        Some(p)
    }
}
fn live<'a>(panel: &'a DevicePanel, siid: u32, name: &str) -> Option<&'a Value> {
    let p = property(panel, siid, name)?;
    if p.code != Some(0) || !p.access.iter().any(|a| a == "read") {
        return None;
    }
    let v = p.value.as_ref()?;
    spec::validate_value(p, v).ok()?;
    Some(v)
}
fn number(panel: &DevicePanel, siid: u32, name: &str) -> Option<u32> {
    u32::try_from(live(panel, siid, name)?.as_u64()?).ok()
}
pub fn valid_volume(v: u32) -> bool {
    (300..=950).contains(&v) && v % 50 == 0
        || (1000..=20900).contains(&v) && v % 100 == 0
        || v == 999000
}
fn valid_cups(cups: &[Cup]) -> bool {
    let mut ids = HashSet::new();
    (1..=6).contains(&cups.len())
        && cups
            .iter()
            .all(|c| (1..=6).contains(&c.id) && ids.insert(c.id) && valid_volume(c.volume_ml))
}
pub fn parse_cups(raw: &str) -> Result<Vec<Cup>> {
    if raw.len() > 256 {
        return Err(AppError::protocol());
    }
    let rows: Vec<[u32; 2]> = serde_json::from_str(&format!("[{raw}]"))
        .map_err(|_| AppError::invalid("杯量数据格式无法识别，请重新读取。"))?;
    let cups = rows
        .into_iter()
        .map(|[id, volume_ml]| Cup { id, volume_ml })
        .collect::<Vec<_>>();
    if !valid_cups(&cups) {
        return Err(AppError::invalid(
            "杯量、编号或数量不符合此型号的原版配置。",
        ));
    }
    Ok(cups)
}
pub fn encode_cups(cups: &[Cup]) -> Result<String> {
    if !valid_cups(cups) {
        return Err(AppError::invalid(
            "杯量、编号或数量不符合此型号的原版配置。",
        ));
    }
    Ok(cups
        .iter()
        .map(|c| format!("[{},{}]", c.id, c.volume_ml))
        .collect::<Vec<_>>()
        .join(","))
}
pub fn snapshot(panel: &DevicePanel) -> Option<Snapshot> {
    if panel.model != MODEL || panel.unsupported_reason.is_some() {
        return None;
    }
    let fault = number(panel, 2, "fault");
    let p = property(panel, 2, "status");
    let status = live(panel, 2, "status")
        .and_then(|v| {
            p?.value_list
                .as_ref()?
                .iter()
                .find(|r| spec::values_equal(&r.value, v))
        })
        .map(|r| r.description.trim().to_lowercase());
    let tds = number(panel, 4, "tds-out");
    let status = match status.as_deref() {
        Some("idle") => "idle",
        Some("busy") => "busy",
        _ if tds == Some(10000) => "waiting",
        _ => "unknown",
    }
    .to_owned();
    let raw = live(panel, 7, "cup-setting").and_then(Value::as_str);
    let parsed = raw.map(parse_cups);
    let cup_error = match &parsed {
        Some(Err(e)) => Some(e.message.clone()),
        _ => None,
    };
    let cups = parsed.and_then(std::result::Result::ok).unwrap_or_default();
    let writable = property(panel, 7, "cup-setting").is_some_and(|p| {
        p.piid == 1
            && p.format == "string"
            && p.unsupported_reason.is_none()
            && p.access.iter().any(|a| a == "write")
    });
    let edit_reason = if status == "busy" {
        Some("请在制水结束后操作。")
    } else if status != "idle" || fault.is_none() {
        Some("请先读取当前待机和故障状态。")
    } else if fault != Some(0) {
        Some("设备存在故障，请先检查设备。")
    } else if !writable || raw.is_none() || cups.is_empty() {
        Some("杯量数据或写入权限尚未确认，请重新读取。")
    } else {
        None
    }
    .map(str::to_owned);
    let filters = [(3, "复合滤芯"), (5, "RO滤芯")]
        .into_iter()
        .map(|(siid, name)| {
            let anti_fake = live(panel, siid, "anti-fake").and_then(Value::as_bool);
            Filter {
                siid,
                name: name.into(),
                description: if siid==3 {"过滤精度可达0.01~0.1微米，有效地拦截水中的胶体、颗粒物、肉眼可见物和细菌等杂质。"} else {"理论过滤精度可达到0.0001微米，有效地过滤掉水中的重金属、细菌、水垢、有机物等物质。"}.into(),
                percent: if anti_fake == Some(false) {
                    number(panel, siid, "filter-life-level")
                } else {
                    None
                },
                days: number(panel, siid, "filter-left-time"),
                anti_fake,
            }
        })
        .collect();
    Some(Snapshot {
        status,
        tds: tds.filter(|v| *v != 10000),
        temperature: live(panel, 2, "temperature")
            .and_then(Value::as_i64)
            .and_then(|v| i32::try_from(v).ok()),
        fault,
        cups,
        cup_source: raw.map(str::to_owned),
        cup_error,
        can_edit_cups: edit_reason.is_none(),
        edit_reason,
        filters,
    })
}
pub fn refresh(panel: &mut DevicePanel) {
    panel.purifier = snapshot(panel);
}
pub fn cup_change(panel: &DevicePanel, expected: &str, cups: &[Cup]) -> Result<Value> {
    let state =
        snapshot(panel).ok_or_else(|| AppError::invalid("此设备不是已核实的净水器型号。"))?;
    if !state.can_edit_cups {
        return Err(AppError::invalid(&state.edit_reason.unwrap_or_default()));
    }
    if state.cup_source.as_deref() != Some(expected) {
        return Err(AppError::new(
            "stateSuperseded",
            "杯量已被其他操作修改，请重新读取后再编辑。",
            true,
        ));
    }
    let encoded = encode_cups(cups)?;
    let p = property(panel, 7, "cup-setting").ok_or_else(AppError::protocol)?;
    let value = Value::String(encoded);
    spec::validate_value(p, &value)?;
    Ok(value)
}

/// Vendor 10565 / 11741 / 11744. Preset selection is not dispensing.
pub fn is_setting(siid: u32, piid: u32) -> bool {
    matches!((siid, piid), (2, 4 | 5 | 7) | (7, 2))
}
pub fn validate_setting(panel: &DevicePanel, siid: u32, piid: u32, value: &Value) -> Result<()> {
    if panel.model != MODEL || panel.unsupported_reason.is_some() || !is_setting(siid, piid) {
        return Err(AppError::invalid("此净水器设置绑定尚未确认。"));
    }
    let name = match (siid, piid) {
        (2, 4) => "no-old-water-mode",
        (2, 5) => "pipeline-connection",
        (2, 7) => "holiday-mode",
        (7, 2) => "out-water-cup",
        _ => return Err(AppError::protocol()),
    };
    let p = property(panel, siid, name)
        .filter(|p| {
            p.piid == piid
                && p.unsupported_reason.is_none()
                && p.access.iter().any(|a| a == "write")
        })
        .ok_or_else(|| AppError::invalid("此设置缺少有效的读写描述。"))?;
    if live(panel, siid, name).is_none() {
        return Err(AppError::invalid("请先读取此设置的当前状态。"));
    }
    spec::validate_value(p, value)?;
    if (siid, piid) == (2, 7) {
        if !crate::purifier_options::can_handle(panel) {
            return Err(AppError::invalid("请先读取当前设备水质状态。"));
        }
        if p.format != "bool"
            || value.as_bool().is_none()
            || live(panel, siid, name).and_then(Value::as_bool).is_none()
        {
            return Err(AppError::invalid("滤芯冲洗需要实时布尔状态。"));
        }
        return Ok(());
    }
    if (siid, piid) == (2, 4) {
        if !value.as_u64().is_some_and(|v| v <= 2) {
            return Err(AppError::invalid("无陈水模式无效。"));
        }
        return Ok(());
    }
    // The original checks isPurifying before changing pipeline/default cup.
    // The verified lx32 descriptor exposes Idle/Busy; missing reads cannot
    // authorize a write. Do not add a made-up instantaneous flush action.
    let status = property(panel, 2, "status")
        .and_then(|p| {
            live(panel, 2, "status")
                .and_then(|v| p.value_list.as_ref()?.iter().find(|x| &x.value == v))
        })
        .map(|v| v.description.to_ascii_lowercase());
    if status.as_deref() != Some("idle") {
        return Err(AppError::invalid(if status.as_deref() == Some("busy") {
            "请在制水结束后操作。"
        } else {
            "请先读取当前制水状态。"
        }));
    }
    if (siid, piid) == (7, 2) {
        let id = value.as_u64().ok_or_else(AppError::protocol)?;
        let cups = live(panel, 7, "cup-setting")
            .and_then(Value::as_str)
            .map(parse_cups)
            .transpose()?
            .ok_or_else(|| AppError::invalid("请先读取当前杯量。"))?;
        if id != 0 && !cups.iter().any(|c| u64::from(c.id) == id) {
            return Err(AppError::new(
                "stateSuperseded",
                "该杯量已不存在，请重新读取后选择。",
                true,
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn panel() -> DevicePanel {
        serde_json::from_str(include_str!("fixtures/purifier-panel.json")).unwrap()
    }
    fn set(p: &mut DevicePanel, siid: u32, name: &str, v: Value) {
        let prop = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == siid && p.name == name)
            .unwrap();
        prop.value = Some(v);
        prop.code = Some(0);
    }
    #[test]
    fn settings_require_real_bindings_current_values_and_existing_cup_ids() {
        let mut p = panel();
        assert!(validate_setting(&p, 2, 4, &json!(2)).is_ok());
        assert!(validate_setting(&p, 2, 5, &json!(false)).is_ok());
        assert!(validate_setting(&p, 7, 2, &json!(0)).is_ok());
        assert!(validate_setting(&p, 7, 2, &json!(1)).is_ok());
        assert!(validate_setting(&p, 7, 2, &json!(6)).is_err());
        set(&mut p, 7, "cup-setting", json!("[2,300],[5,1200]"));
        assert!(validate_setting(&p, 7, 2, &json!(5)).is_ok());
        assert!(validate_setting(&p, 7, 2, &json!(1)).is_err());
        assert!(validate_setting(&p, 2, 4, &json!(3)).is_err());
        assert!(validate_setting(&p, 2, 5, &json!(1)).is_err());
        set(&mut p, 2, "status", json!(2));
        assert!(validate_setting(&p, 7, 2, &json!(0)).is_err());
        assert!(validate_setting(&p, 2, 5, &json!(false)).is_err());
        assert!(validate_setting(&p, 2, 4, &json!(0)).is_ok());
        set(&mut p, 2, "status", json!(1));
        let target = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 5)
            .unwrap();
        target.code = Some(-1);
        assert!(validate_setting(&p, 2, 5, &json!(false)).is_err());
        p.model = "other".into();
        assert!(validate_setting(&p, 2, 4, &json!(0)).is_err());
    }
    #[test]
    fn parses_only_the_verified_preset_grammar() {
        assert_eq!(
            encode_cups(&parse_cups("[1,300],[4,1200],[6,999000]").unwrap()).unwrap(),
            "[1,300],[4,1200],[6,999000]"
        );
        for raw in [
            "",
            "[]",
            "[1,300],[1,500]",
            "[7,300]",
            "[1,250]",
            "[1,975]",
            "[1,21000]",
            "[1,301]",
            "[1,300,4]",
            "[1,\"300\"]",
            "[1,300],null",
            "[1,300];alert(1)",
        ] {
            assert!(parse_cups(raw).is_err(), "{raw}");
        }
    }
    #[test]
    fn projects_real_schema_and_hides_reset() {
        let p = panel();
        let s = snapshot(&p).unwrap();
        assert_eq!(s.status, "idle");
        assert_eq!(s.tds, Some(21));
        assert_eq!(s.filters[0].percent, Some(91));
        assert_eq!(s.filters[1].percent, Some(58));
        assert!(s.can_edit_cups);
        let mut other = p.clone();
        other.model.push('x');
        assert!(snapshot(&other).is_none());
    }
    #[test]
    fn busy_fault_unread_and_historical_values_never_authorize() {
        let mut p = panel();
        set(&mut p, 2, "status", json!(2));
        assert!(!snapshot(&p).unwrap().can_edit_cups);
        set(&mut p, 2, "status", json!(1));
        set(&mut p, 2, "fault", json!(1));
        assert!(!snapshot(&p).unwrap().can_edit_cups);
        set(&mut p, 2, "fault", json!(0));
        let prop = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 7 && p.piid == 1)
            .unwrap();
        prop.code = Some(-1);
        assert!(snapshot(&p).unwrap().cups.is_empty());
        assert!(!snapshot(&p).unwrap().can_edit_cups);
    }
    #[test]
    fn stale_draft_is_rejected_before_encoding() {
        let p = panel();
        let cups = parse_cups("[2,1200],[1,500]").unwrap();
        assert!(cup_change(&p, "[1,500]", &cups).is_err());
        let current = snapshot(&p).unwrap().cup_source.unwrap();
        assert_eq!(
            cup_change(&p, &current, &cups).unwrap(),
            json!("[2,1200],[1,500]")
        );
    }
}
