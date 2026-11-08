//! Exact midjd8.washer.42 declarative program validation and wire conversion.
//! Program names bind the model's enum descriptions, never frontend addresses.
use crate::{
    error::{AppError, Result},
    models::{Device, DevicePanel, Property},
    spec,
    washer::{self, WasherConfigReport},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProgramDraft {
    pub program: String,
    pub values: BTreeMap<String, Value>,
    pub reservation_at: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
pub struct ProgramWrite {
    pub siid: u32,
    pub piid: u32,
    pub value: Value,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramPlan {
    pub did: String,
    pub mode: Value,
    pub writes: Vec<ProgramWrite>,
    pub estimated_minutes: u32,
    pub reservation_minutes: Option<u32>,
    pub start_siid: u32,
    pub start_aiid: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProgramPreview {
    pub estimated_minutes: u32,
    pub can_start: bool,
    pub reason: Option<String>,
    pub request_id: Option<String>,
    pub panel: DevicePanel,
}
fn invalid() -> AppError {
    AppError::invalid("洗涤参数与当前型号或固件的程序配置不匹配。")
}
fn obj(v: &Value) -> Map<String, Value> {
    v.as_object().cloned().unwrap_or_default()
}
fn merge(a: &Value, b: &Value) -> Value {
    let mut result = obj(a);
    result.extend(obj(b));
    for key in ["timeObj", "dataDesc", "dataLabel"] {
        let mut nested = obj(&a[key]);
        nested.extend(obj(&b[key]));
        if !nested.is_empty() {
            result.insert(key.into(), Value::Object(nested));
        }
    }
    Value::Object(result)
}
fn number(v: &Value) -> Option<f64> {
    if let Some(n) = v.as_f64() {
        Some(n)
    } else {
        v.as_bool().map(|v| if v { 1.0 } else { 0.0 })
    }
}
fn equal(a: &Value, b: &Value) -> bool {
    a == b || a.is_number() && b.is_number() && number(a) == number(b)
}
fn conditions(raw: &Value, values: &BTreeMap<String, Value>, defs: &Value) -> Value {
    let rows = if let Some(array) = raw.as_array() {
        array.clone()
    } else if raw.is_null() {
        vec![]
    } else {
        vec![raw.clone()]
    };
    let mut prior = Vec::<bool>::new();
    let mut output = Value::Object(Map::new());
    for row in rows {
        let row = if let Some(key) = row.as_str() {
            &defs[key]
        } else {
            &row
        };
        let key = &row["key"];
        let desired = &row["keyValue"];
        let op = row["operator"].as_str().unwrap_or("inculde");
        let yes = if op == "&" {
            let keys = if let Some(n) = key.as_u64() {
                vec![json!(n)]
            } else {
                key.as_array().cloned().unwrap_or_default()
            };
            !keys.is_empty()
                && keys.iter().enumerate().all(|(i, k)| {
                    k.as_u64()
                        .and_then(|n| prior.get(n as usize))
                        .is_some_and(|actual| {
                            Some(*actual)
                                == if desired.is_array() {
                                    desired[i].as_bool()
                                } else {
                                    desired.as_bool()
                                }
                        })
                })
        } else if let Some(value) = key.as_str().and_then(|k| values.get(k)) {
            match op {
                "=" | "===" => equal(value, desired),
                "!" | "!==" => !equal(value, desired),
                "==" => number(value).is_some() && number(value) == number(desired),
                "!=" => number(value).is_none() || number(value) != number(desired),
                ">" | ">=" | "<" | "<=" => match (number(value), number(desired)) {
                    (Some(a), Some(b)) => match op {
                        ">" => a > b,
                        ">=" => a >= b,
                        "<" => a < b,
                        _ => a <= b,
                    },
                    _ => false,
                },
                "inculde" => desired
                    .as_array()
                    .map(|a| a.iter().any(|v| equal(value, v)))
                    .unwrap_or_else(|| equal(value, desired)),
                _ => false,
            }
        } else {
            matches!(op, "!" | "!=" | "!==")
        };
        prior.push(yes);
        if !yes {
            continue;
        }
        if row["stop"] == true {
            break;
        }
        let mut update = obj(row);
        for key in ["key", "keyValue", "operator", "next", "stop", "merge"] {
            update.remove(key);
        }
        if row["merge"] == true {
            let mut merged = obj(&output);
            merged.extend(update);
            output = Value::Object(merged);
        } else {
            output = Value::Object(update);
        }
        if row["next"] != true {
            break;
        }
    }
    output
}
fn binding(name: &str) -> Option<&'static str> {
    match name {
        "temperature" => Some("target-temperature"),
        "rinsh" => Some("rinsh-times"),
        "speed" => Some("spin-speed"),
        "dry" => Some("drying-level"),
        "shakeTime" => Some("shake-time"),
        "soak" => Some("soak-time"),
        "sterilization" => Some("steam-sterilization"),
        "highWaterLevel" => Some("high-water-switch"),
        "night" => Some("sleep-mode"),
        "pleasedWash" | "mainWash" => Some("wash-time"),
        "pleasedDry" | "regularDry" => Some("drying-time"),
        _ => None,
    }
}
pub(crate) fn property<'a>(
    panel: &'a DevicePanel,
    service: &str,
    name: &str,
) -> Result<&'a Property> {
    let matches = panel
        .services
        .iter()
        .filter(|s| s.name == service)
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == name)
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(invalid());
    }
    Ok(matches[0])
}
fn emit(
    panel: &DevicePanel,
    name: &str,
    value: Value,
    writes: &mut Vec<ProgramWrite>,
) -> Result<()> {
    let p = property(panel, "washer", name)?;
    if !p.access.iter().any(|a| a == "write")
        || p.unsupported_reason.is_some()
        || writes.iter().any(|w| w.siid == p.siid && w.piid == p.piid)
    {
        return Err(invalid());
    }
    let value = if value.is_number() {
        let n = value.as_f64().ok_or_else(invalid)?;
        if n.fract() != 0.0 || n < 0.0 {
            return Err(invalid());
        }
        json!(n as u64)
    } else {
        value
    };
    spec::validate_value(p, &value)?;
    writes.push(ProgramWrite {
        siid: p.siid,
        piid: p.piid,
        value,
    });
    Ok(())
}
fn live<'a>(panel: &'a DevicePanel, service: &str, name: &str) -> Result<&'a Value> {
    let p = property(panel, service, name)?;
    if p.code != Some(0) || !p.access.iter().any(|a| a == "read") {
        return Err(AppError::new(
            "stateUnavailable",
            "洗衣机实时状态尚未确认，请重新读取。",
            true,
        ));
    }
    p.value.as_ref().filter(|v| !v.is_null()).ok_or_else(|| {
        AppError::new(
            "stateUnavailable",
            "洗衣机实时状态尚未确认，请重新读取。",
            true,
        )
    })
}
fn meaning(panel: &DevicePanel, name: &str, value: &Value) -> Result<String> {
    let p = property(panel, "washer", name)?;
    let meanings = p
        .value_list
        .as_ref()
        .ok_or_else(invalid)?
        .iter()
        .filter(|v| spec::values_equal(&v.value, value))
        .collect::<Vec<_>>();
    if meanings.len() != 1 {
        return Err(invalid());
    }
    Ok(meanings[0].description.to_lowercase())
}
/// Direct code=0 values only. Cached lastReported never authorizes a start.
pub fn ready(device: &Device, panel: &DevicePanel) -> Result<bool> {
    if !washer::supports_metadata(device)
        || panel.model != device.model
        || panel.did != device.did
        || device.shared_read_only
        || device.split_route.is_some()
    {
        return Err(AppError::new(
            "permissionDenied",
            "此设备当前不能提交洗涤程序。",
            false,
        ));
    }
    if !device.online {
        return Err(AppError::new("offline", "洗衣机离线，暂不能开始。", true));
    }
    let on = live(panel, "washer", "on")?.as_bool().ok_or_else(invalid)?;
    if !matches!(
        meaning(panel, "status", live(panel, "washer", "status")?)?.as_str(),
        "off" | "idle" | "completed"
    ) {
        return Err(AppError::new(
            "busy",
            "洗衣机正在运行、暂停或预约中。",
            false,
        ));
    }
    if meaning(panel, "fault", live(panel, "washer", "fault")?)? != "no faults" {
        return Err(AppError::new(
            "device",
            "洗衣机存在故障，请先在设备上处理。",
            false,
        ));
    }
    // Standard ModeEdit 16748 handle()/onStart()/doFn() does not gate start on
    // door-state. Door interlocks and opening prompts are device/runtime states;
    // adding a local closed-door prerequisite changes the original workflow.
    if property(
        panel,
        "physical-controls-locked",
        "physical-controls-locked",
    )
    .is_ok()
        && live(
            panel,
            "physical-controls-locked",
            "physical-controls-locked",
        )?
        .as_bool()
            != Some(false)
    {
        return Err(AppError::new("device", "请先解除洗衣机童锁。", false));
    }
    if (device.model == washer::MODEL
        || property(panel, "washer", "child-protected-enabled").is_ok())
        && live(panel, "washer", "child-protected-enabled")?
            .as_bool()
            .ok_or_else(invalid)?
        && !live(panel, "washer", "child-protected-status")?
            .as_bool()
            .ok_or_else(invalid)?
    {
        return Err(AppError::new(
            "device",
            "请先完成洗衣机儿童安全检查。",
            false,
        ));
    }
    if let Ok(p) = property(panel, "dryer-channel-clean", "clean-lefttime") {
        if p.code != Some(0) || p.value.as_ref().and_then(Value::as_u64) != Some(0) {
            return Err(AppError::new(
                "stateUnavailable",
                "风道清洁状态尚未确认或正在进行。",
                true,
            ));
        }
    }
    Ok(on)
}
/// No network and no writes. The backend reloads its own authenticated config
/// and spec before preparing a command; frontend supplied metadata is ignored.
pub fn prepare(
    device: &Device,
    panel: &DevicePanel,
    config: &WasherConfigReport,
    draft: &ProgramDraft,
    now_ms: u64,
) -> Result<ProgramPlan> {
    washer::query(device)?;
    if device.did != panel.did
        || device.model != panel.model
        || config.did != device.did
        || config.model != device.model
        || Some(&config.firmware) != device.firmware_version.as_ref()
        || panel.unsupported_reason.is_some()
        || draft.values.len() > 32
        || draft.program.len() > 96
    {
        return Err(invalid());
    }
    let meanings: Value =
        serde_json::from_str(include_str!("fixtures/washer-program-meanings.json"))
            .map_err(|_| AppError::protocol())?;
    let meaning = meanings[&draft.program].as_str().ok_or_else(invalid)?;
    let mode = property(panel, "washer", "mode")?
        .value_list
        .as_ref()
        .ok_or_else(invalid)?
        .iter()
        .filter(|v| v.description.trim().eq_ignore_ascii_case(meaning))
        .collect::<Vec<_>>();
    if mode.len() != 1 {
        return Err(invalid());
    }
    let mode = mode[0].value.clone();
    let modes = config.config["modesData"].as_array().ok_or_else(invalid)?;
    let matched = modes
        .iter()
        .filter(|v| v["modeName"] == draft.program)
        .collect::<Vec<_>>();
    if matched.len() != 1 {
        return Err(invalid());
    }
    let program = matched[0];
    let items = program["items"].as_array().ok_or_else(invalid)?;
    let allowed = items
        .iter()
        .filter_map(|i| i["propertyName"].as_str())
        .collect::<HashSet<_>>();
    if draft.values.keys().any(|k| !allowed.contains(k.as_str())) {
        return Err(invalid());
    }
    let mut writes = Vec::new();
    emit(panel, "mode", mode.clone(), &mut writes)?;
    let mut minutes = 0.0;
    for item in items {
        let name = item["propertyName"].as_str().ok_or_else(invalid)?;
        let base = merge(&config.config["itemsConfig"][name], item);
        let effective = merge(
            &base,
            &conditions(
                &base["conditions"],
                &draft.values,
                &config.config["conditionsConfig"],
            ),
        );
        let value = draft.values.get(name).ok_or_else(invalid)?;
        let scalar = value.is_boolean() || value.as_f64().is_some_and(f64::is_finite);
        if !scalar {
            return Err(invalid());
        }
        let value_key = if let Some(v) = value.as_f64() {
            v.to_string()
        } else {
            value.to_string()
        };
        minutes += effective["timeObj"][&value_key]
            .as_f64()
            .or_else(|| effective["time"].as_f64())
            .unwrap_or(0.0);
        if effective["isHide"] == true {
            continue;
        }
        if let Some(data) = effective["data"].as_array() {
            if !data.iter().any(|v| equal(value, v)) {
                return Err(invalid());
            }
        } else if !value.is_boolean() {
            return Err(invalid());
        }
        let prop = binding(name).ok_or_else(invalid)?;
        if name == "dry" {
            let dry = value.as_f64().ok_or_else(invalid)?;
            if dry == 0.0 || dry == 1.0 {
                emit(panel, prop, value.clone(), &mut writes)?;
            } else if dry > 1.0 && dry < 2.0 {
                let degree = (dry * 10.0).round() - 10.0;
                if !(1.0..=3.0).contains(&degree) {
                    return Err(invalid());
                }
                emit(panel, prop, json!(1), &mut writes)?;
                emit(panel, "drying-degree", json!(degree), &mut writes)?;
            } else if dry > 2.0 {
                emit(panel, prop, json!(2), &mut writes)?;
                emit(panel, "drying-time", value.clone(), &mut writes)?;
            } else {
                return Err(AppError::invalid("请为定时烘干选择具体时长。"));
            }
        } else if name == "shakeTime" && effective["unitType"] != "min" {
            emit(
                panel,
                prop,
                json!(value.as_f64().ok_or_else(invalid)? * 60.0),
                &mut writes,
            )?;
        } else {
            emit(panel, prop, value.clone(), &mut writes)?;
        }
    }
    if minutes == 0.0 {
        minutes = program["modeTime"].as_f64().unwrap_or(0.0);
    }
    if !minutes.is_finite() || !(0.0..=2880.0).contains(&minutes) {
        return Err(invalid());
    }
    let reservation_minutes = if let Some(at) = draft.reservation_at {
        if program["isOrder"] == false || at <= now_ms || at - now_ms > 86_400_000 {
            return Err(AppError::invalid("请选择24小时内可预约的洗涤时间。"));
        }
        let remaining = (at - now_ms).div_ceil(60_000) as u32;
        // New standard 15293 includes six minutes for this exact model family.
        if (remaining as f64) < minutes + 6.0 {
            return Err(AppError::invalid("预约时间早于当前程序所需时长。"));
        }
        let prop = property(panel, "washer", "reservation-wash-status")?;
        let finish = prop
            .value_list
            .as_ref()
            .and_then(|v| {
                v.iter()
                    .find(|v| v.description.eq_ignore_ascii_case("Finish Wash"))
            })
            .ok_or_else(invalid)?;
        emit(
            panel,
            "reservation-wash-status",
            finish.value.clone(),
            &mut writes,
        )?;
        emit(
            panel,
            "reservation-left-time",
            json!(remaining),
            &mut writes,
        )?;
        Some(remaining)
    } else {
        None
    };
    let actions = panel
        .services
        .iter()
        .filter(|s| s.name == "washer")
        .flat_map(|s| &s.actions)
        .filter(|a| a.name == "start-wash" && a.inputs.is_empty() && a.unsupported_reason.is_none())
        .collect::<Vec<_>>();
    if actions.len() != 1 {
        return Err(invalid());
    }
    Ok(ProgramPlan {
        did: device.did.clone(),
        mode,
        writes,
        estimated_minutes: minutes.ceil() as u32,
        reservation_minutes,
        start_siid: actions[0].siid,
        start_aiid: actions[0].aiid,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Device, DevicePanel, WasherConfigReport) {
        let mut panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/washer-panel.json")).unwrap();
        for service in &mut panel.services {
            for p in &mut service.properties {
                p.code = Some(0);
                p.value = Some(match (service.name.as_str(), p.name.as_str()) {
                    ("washer", "on")
                    | ("physical-controls-locked", _)
                    | ("washer", "child-protected-enabled") => json!(false),
                    ("washer", "door-state") => json!(2),
                    _ => json!(0),
                });
            }
        }
        let mut device:Device=serde_json::from_value(json!({"did":panel.did,"model":washer::MODEL,"name":"washer","online":true,"roomId":"r","roomName":"r"})).unwrap();
        device.firmware_version = Some("2.2.5".into());
        let report = WasherConfigReport {
            did: device.did.clone(),
            model: device.model.clone(),
            firmware: "2.2.5".into(),
            fetched_at: 1,
            config: serde_json::from_str(include_str!("fixtures/washer-config.json")).unwrap(),
        };
        (device, panel, report)
    }
    fn defaults(config: &WasherConfigReport, name: &str) -> ProgramDraft {
        let program = config.config["modesData"]
            .as_array()
            .unwrap()
            .iter()
            .find(|m| m["modeName"] == name)
            .unwrap();
        let values = program["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                let key = item["propertyName"].as_str().unwrap();
                let merged = merge(&config.config["itemsConfig"][key], item);
                (
                    key.into(),
                    merged.get("defaultValue").cloned().unwrap_or(json!(false)),
                )
            })
            .collect();
        ProgramDraft {
            program: name.into(),
            values,
            reservation_at: None,
        }
    }
    #[test]
    fn all_26_captured_programs_generate_exact_read_write_service_bindings_from_authenticated_spec()
    {
        let (d, p, c) = fixture();
        for m in c.config["modesData"].as_array().unwrap() {
            let name = m["modeName"].as_str().unwrap();
            let draft = defaults(&c, name);
            let plan = prepare(&d, &p, &c, &draft, 1_793_000_000_000)
                .unwrap_or_else(|e| panic!("{name}: {e:?}"));
            assert_eq!(plan.writes[0].piid, 3);
            assert!(plan.writes.iter().all(|w| w.siid == 2));
            assert_eq!((plan.start_siid, plan.start_aiid), (2, 2));
        }
    }
    #[test]
    fn forged_program_values_missing_fields_and_wrong_firmware_fail_without_control() {
        let (d, p, mut c) = fixture();
        let mut draft = defaults(&c, "quickWash");
        draft.values.insert("speed".into(), json!(1200));
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
        let mut draft = defaults(&c, "smart");
        draft.values.insert("plugin-connect".into(), json!(true));
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
        draft.values.remove("plugin-connect");
        draft.values.remove("temperature");
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
        let draft = defaults(&c, "smart");
        c.firmware = "2.2.6".into();
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
    }
    #[test]
    fn timed_drying_and_fractional_hours_become_integer_wire_values_and_must_obey_mode_conditions()
    {
        let (d, p, c) = fixture();
        let mut draft = defaults(&c, "quickWash");
        draft.values.insert("dry".into(), json!(60));
        draft.values.insert("shakeTime".into(), json!(0.5));
        let plan = prepare(&d, &p, &c, &draft, 1).unwrap();
        let value = |piid| {
            plan.writes
                .iter()
                .find(|w| w.piid == piid)
                .unwrap()
                .value
                .clone()
        };
        assert_eq!(value(26), 2);
        assert_eq!(value(27), 60);
        assert_eq!(value(24), 30);
        draft.values.insert("shakeTime".into(), json!(12));
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
        draft.values.insert("shakeTime".into(), json!(0));
        draft.values.insert("dry".into(), json!(2));
        assert!(prepare(&d, &p, &c, &draft, 1).is_err());
    }
    #[test]
    fn reservation_uses_new_six_minute_margin_and_model_semantic_finish_value() {
        let (d, p, c) = fixture();
        let now = 1_793_000_000_000;
        let mut draft = defaults(&c, "quickWash");
        let plan = prepare(&d, &p, &c, &draft, now).unwrap();
        draft.reservation_at = Some(now + (u64::from(plan.estimated_minutes) + 5) * 60_000);
        assert!(prepare(&d, &p, &c, &draft, now).is_err());
        draft.reservation_at = Some(now + (u64::from(plan.estimated_minutes) + 6) * 60_000);
        let plan = prepare(&d, &p, &c, &draft, now).unwrap();
        assert_eq!(plan.reservation_minutes, Some(plan.estimated_minutes + 6));
        assert!(plan.writes.iter().any(|w| w.piid == 16 && w.value == 3));
        draft.reservation_at = Some(now + 86_400_001);
        assert!(prepare(&d, &p, &c, &draft, now).is_err());
        let mut clean = defaults(&c, "drumClean");
        clean.reservation_at = Some(now + 86_000_000);
        assert!(prepare(&d, &p, &c, &clean, now).is_err());
    }
    #[test]
    fn running_or_unknown_required_live_values_never_authorize_start() {
        let (d, mut p, _) = fixture();
        assert!(!ready(&d, &p).unwrap());
        let set = |p: &mut DevicePanel, name: &str, value: Value, code| {
            let property = p
                .services
                .iter_mut()
                .flat_map(|s| &mut s.properties)
                .find(|p| p.name == name)
                .unwrap();
            property.value = Some(value);
            property.code = Some(code);
        };
        set(&mut p, "status", json!(3), 0);
        assert!(ready(&d, &p).is_err());
        set(&mut p, "status", json!(0), 0);
        set(&mut p, "door-state", json!(0), 0);
        assert!(!ready(&d, &p).unwrap());
        set(&mut p, "door-state", json!(2), 0);
        set(&mut p, "on", Value::Null, -704220043);
        assert_eq!(ready(&d, &p).unwrap_err().kind, "stateUnavailable");
    }
    #[test]
    fn apk_preflight_checks_locks_faults_and_child_protection_without_a_local_door_gate() {
        let (mut d, mut p, _) = fixture();
        let set = |p: &mut DevicePanel, name: &str, value: Value| {
            let property = p
                .services
                .iter_mut()
                .flat_map(|s| &mut s.properties)
                .find(|p| p.name == name)
                .unwrap();
            property.value = Some(value);
            property.code = Some(0);
        };
        set(&mut p, "door-state", Value::Null);
        assert!(ready(&d, &p).is_ok());
        set(&mut p, "physical-controls-locked", json!(true));
        assert_eq!(ready(&d, &p).unwrap_err().message, "请先解除洗衣机童锁。");
        set(&mut p, "physical-controls-locked", json!(false));
        set(&mut p, "fault", json!(1));
        assert_eq!(ready(&d, &p).unwrap_err().kind, "device");
        set(&mut p, "fault", json!(0));
        set(&mut p, "child-protected-enabled", json!(true));
        set(&mut p, "child-protected-status", json!(false));
        assert_eq!(
            ready(&d, &p).unwrap_err().message,
            "请先完成洗衣机儿童安全检查。"
        );
        set(&mut p, "child-protected-status", json!(true));
        assert!(ready(&d, &p).is_ok());
        set(&mut p, "clean-lefttime", json!(1));
        assert!(ready(&d, &p).is_err());
        set(&mut p, "clean-lefttime", json!(0));
        d.shared_read_only = true;
        assert_eq!(ready(&d, &p).unwrap_err().kind, "permissionDenied");
    }
}
