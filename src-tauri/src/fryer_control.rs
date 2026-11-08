//! maf16 v48: modules 10019, 10280, 10493 and 10496, inspected as inert text.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{DevicePanel, Property},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Mode {
    pub mode: u8,
    pub recipe_id: String,
    pub minutes: u32,
    pub temperature: u16,
    pub temperature_range: [u16; 3],
    pub max_minutes: u32,
    pub reservation: bool,
    pub keep_warm: bool,
    pub measure: u8,
    pub weight: u16,
    pub texture: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profile {
    model: String,
    spec_type: String,
    modes: Vec<Mode>,
}
fn profile() -> Profile {
    serde_json::from_str(include_str!("../../src/fryer-profile.json"))
        .expect("bundled fryer profile")
}
pub fn mode(value: u8) -> Result<Mode> {
    profile()
        .modes
        .into_iter()
        .find(|m| m.mode == value)
        .ok_or_else(|| AppError::invalid("此模式未适配。"))
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub revision: String,
    pub status: u8,
    pub fault: u8,
    pub mode: u8,
    pub minutes: u32,
    pub temperature: u16,
    pub left_minutes: u32,
    pub auto_keep_warm: bool,
    pub keep_warm: Option<bool>,
    pub recipe_id: Option<String>,
    pub reservation_minutes: Option<u32>,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Start {
        mode: u8,
        minutes: u32,
        temperature: u16,
        #[serde(rename = "keepWarm")]
        keep_warm: bool,
        #[serde(rename = "finishAt")]
        finish_at: Option<u64>,
    },
    Adjust {
        minutes: u32,
        temperature: u16,
        #[serde(rename = "keepWarm")]
        keep_warm: bool,
    },
    Pause,
    Resume,
    Stop,
}
#[derive(Serialize)]
pub struct Changed {
    pub report: Snapshot,
    pub confirmed: bool,
}
#[derive(Debug, PartialEq)]
pub enum Command {
    Write(u32, Value),
    Action(u32, Vec<Value>),
}
const EXTRA: [(u32, &str); 3] = [
    (24, "current-keep-warm"),
    (26, "recipe-id"),
    (33, "reservation-left-time"),
];

fn property(p: &DevicePanel, id: u32, name: &str) -> Result<Property> {
    let all = p
        .services
        .iter()
        .filter(|s| s.siid == 2 && s.name == "air-fryer")
        .flat_map(|s| &s.properties)
        .filter(|v| v.piid == id)
        .collect::<Vec<_>>();
    if all.len() != 1 || all[0].name != name {
        return Err(AppError::invalid("炸锅属性与已核实描述不一致。"));
    }
    Ok(all[0].clone())
}
pub fn validate(p: &DevicePanel) -> Result<()> {
    let profile = profile();
    if p.model != profile.model
        || p.spec_type.as_deref() != Some(&profile.spec_type)
        || p.route_did.is_some()
    {
        return Err(AppError::invalid("炸锅型号或描述与已核实协议不一致。"));
    }
    crate::fryer::read_params(p)?;
    for (id, name) in EXTRA {
        if !property(p, id, name)?.access.iter().any(|v| v == "read") {
            return Err(AppError::invalid("炸锅属性不可读取。"));
        }
    }
    for (id, name) in [
        (27, "recipe-name"),
        (29, "target-cooking-measure"),
        (32, "texture"),
        (34, "cooking-weight"),
    ] {
        if !property(p, id, name)?.access.iter().any(|v| v == "write") {
            return Err(AppError::invalid("炸锅启动参数描述不一致。"));
        }
    }
    for (id, name, inputs) in [
        (
            9,
            "start-recipe-cook",
            vec![5, 7, 24, 26, 27, 29, 32, 33, 34],
        ),
        (6, "cancel-cooking", vec![]),
        (7, "pause", vec![]),
        (8, "resume-cook", vec![]),
    ] {
        let actions = p
            .services
            .iter()
            .flat_map(|s| &s.actions)
            .filter(|a| a.siid == 2 && a.aiid == id)
            .collect::<Vec<_>>();
        if actions.len() != 1 || actions[0].name != name || actions[0].inputs != inputs {
            return Err(AppError::invalid("炸锅动作与已核实描述不一致。"));
        }
    }
    Ok(())
}
pub fn extra_params(p: &DevicePanel) -> Result<Vec<Value>> {
    validate(p)?;
    Ok(EXTRA
        .into_iter()
        .map(|(id, _)| json!({"did":p.control_did(),"siid":2,"piid":id}))
        .collect())
}
pub fn parse(p: &DevicePanel, rows: &[Value], now: u64) -> Result<Snapshot> {
    validate(p)?;
    let value = |id: u32| -> Option<&Value> {
        let r = rows
            .iter()
            .filter(|r| {
                r["did"].as_str() == Some(p.control_did()) && r["siid"] == 2 && r["piid"] == id
            })
            .collect::<Vec<_>>();
        if r.len() == 1 && r[0]["code"] == 0 {
            r[0].get("value")
        } else {
            None
        }
    };
    let num = |id: u32, min: u64, max: u64| -> Result<u64> {
        value(id)
            .and_then(Value::as_f64)
            .filter(|v| v.is_finite() && v.fract() == 0.0 && *v >= min as f64 && *v <= max as f64)
            .map(|v| v as u64)
            .ok_or_else(AppError::protocol)
    };
    let boolean = |id: u32| value(id).and_then(Value::as_bool);
    let status = num(2, 0, 18)? as u8;
    let fault = num(3, 0, 3)? as u8;
    let minutes = num(5, 1, 1440)? as u32;
    let temperature = num(7, 40, 230)? as u16;
    let left_minutes = num(22, 0, 1440)? as u32;
    let auto_keep_warm = boolean(23).ok_or_else(AppError::protocol)?;
    let mode = num(25, 0, 14)? as u8;
    let keep_warm = boolean(24);
    let recipe_id = value(26)
        .and_then(Value::as_str)
        .filter(|s| s.len() <= 128)
        .map(str::to_owned);
    let reservation_minutes = value(33)
        .and_then(Value::as_u64)
        .filter(|v| *v <= 1440)
        .map(|v| v as u32);
    // Countdown changes do not invalidate a settings transaction. Status and
    // recipe identity do: an external start/stop may never be overwritten.
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([
                status,
                fault,
                minutes,
                temperature,
                auto_keep_warm,
                mode,
                keep_warm,
                recipe_id
            ]))
            .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Snapshot {
        did: p.did.clone(),
        model: p.model.clone(),
        fetched_at: now,
        revision,
        status,
        fault,
        mode,
        minutes,
        temperature,
        left_minutes,
        auto_keep_warm,
        keep_warm,
        recipe_id,
        reservation_minutes,
    })
}
pub async fn read(c: &Cloud, p: &DevicePanel) -> Result<Snapshot> {
    let extra = extra_params(p)?;
    let mut rows = c.read_panel_properties(p).await?;
    // Preserve the successful seven-property request; additions are a separate
    // request and missing additions never masquerade as confirmed values.
    match c.read(extra).await {
        Ok(more) => rows.extend(more),
        Err(e) if e.kind == "authExpired" => return Err(e),
        Err(_) => {}
    }
    parse(p, &rows, crate::models::epoch_secs())
}
pub fn cooking(status: u8) -> bool {
    matches!(status, 4 | 13..=16)
}
pub fn active(status: u8) -> bool {
    matches!(status,2..=5|8..=11|13..=17)
}
pub fn max_minutes(m: &Mode, temp: u16) -> u32 {
    if m.mode == 0 && temp >= 80 {
        60
    } else {
        m.max_minutes
    }
}
fn settings(p: &DevicePanel, m: &Mode, time: u32, temp: u16, warm: bool, auto: bool) -> Result<()> {
    let r = m.temperature_range;
    if temp < r[0]
        || temp > r[1]
        || (temp - r[0]) % r[2] != 0
        || time == 0
        || time > max_minutes(m, temp)
        || warm && (!m.keep_warm || temp <= 80 || !auto)
    {
        return Err(AppError::invalid("温度、时间或保温设置不符合此模式范围。"));
    }
    crate::spec::validate_value(&property(p, 5, "target-time")?, &json!(time))?;
    crate::spec::validate_value(&property(p, 7, "target-temperature")?, &json!(temp))?;
    Ok(())
}
pub fn commands(p: &DevicePanel, r: &Snapshot, c: &Change, now: u64) -> Result<Vec<Command>> {
    validate(p)?;
    if r.did != p.did || r.model != p.model || now.saturating_sub(r.fetched_at) > 30 {
        return Err(AppError::stale());
    }
    if r.fault != 0 && !matches!(c, Change::Stop) {
        return Err(AppError::invalid("请先处理设备故障。"));
    }
    let writable = |id, name, value: Value| -> Result<Command> {
        let prop = property(p, id, name)?;
        if !prop.access.iter().any(|a| a == "write") {
            return Err(AppError::invalid("此设置不可写入。"));
        }
        crate::spec::validate_value(&prop, &value)?;
        Ok(Command::Write(id, value))
    };
    match c {
        Change::Start {
            mode: code,
            minutes,
            temperature,
            keep_warm,
            finish_at,
        } => {
            if !matches!(r.status, 0 | 1 | 6 | 12) {
                return Err(AppError::invalid("请先结束当前任务。"));
            }
            let m = mode(*code)?;
            let mode_property = property(p, 25, "mode")?;
            if !mode_property
                .value_list
                .as_ref()
                .is_some_and(|list| list.iter().any(|v| v.value == json!(code)))
            {
                return Err(AppError::invalid("设备描述未提供此模式。"));
            }
            settings(p, &m, *minutes, *temperature, *keep_warm, r.auto_keep_warm)?;
            let wait = if let Some(end) = finish_at {
                if !m.reservation || *end > now + 86400 || *end < now + u64::from(*minutes) * 60 {
                    return Err(AppError::invalid(
                        "预约完成时间须预留完整烹饪时长，且在未来24小时内。",
                    ));
                }
                (*end - now).div_ceil(60) - u64::from(*minutes)
            } else {
                0
            };
            let inputs = vec![
                json!(minutes),
                json!(temperature),
                json!(keep_warm),
                json!(m.recipe_id),
                json!("u0064u0065u006du006f"),
                json!(m.measure),
                json!(m.texture),
                json!(wait),
                json!(m.weight),
            ];
            for (id, v) in [5, 7, 24, 26, 27, 29, 32, 33, 34].into_iter().zip(&inputs) {
                let prop = p
                    .services
                    .iter()
                    .flat_map(|s| &s.properties)
                    .find(|v| v.siid == 2 && v.piid == id)
                    .ok_or_else(AppError::protocol)?;
                crate::spec::validate_value(prop, v)?;
            }
            Ok(vec![Command::Action(9, inputs)])
        }
        Change::Adjust {
            minutes,
            temperature,
            keep_warm,
        } => {
            if !cooking(r.status) && r.status != 2 && r.status != 9 && r.status != 3 {
                return Err(AppError::invalid("当前任务不支持调整。"));
            }
            if r.keep_warm.is_none() {
                return Err(AppError::invalid("当次保温状态尚未读取。"));
            }
            let m = mode(r.mode)?;
            if r.recipe_id.as_deref() != Some(m.recipe_id.as_str()) {
                return Err(AppError::invalid("当前食谱尚未适配参数修改。"));
            }
            settings(p, &m, *minutes, *temperature, *keep_warm, r.auto_keep_warm)?;
            if i64::from(r.left_minutes) + i64::from(*minutes) - i64::from(r.minutes) <= 0 {
                return Err(AppError::invalid("新总时长必须大于已运行时长。"));
            }
            let mut out = vec![];
            if *minutes != r.minutes {
                out.push(writable(5, "target-time", json!(minutes))?);
            }
            if *temperature != r.temperature {
                out.push(writable(7, "target-temperature", json!(temperature))?);
            }
            if r.keep_warm != Some(*keep_warm) {
                out.push(writable(24, "current-keep-warm", json!(keep_warm))?);
            }
            Ok(out)
        }
        Change::Pause if cooking(r.status) => Ok(vec![Command::Action(7, vec![])]),
        Change::Resume if r.status == 2 => Ok(vec![Command::Action(8, vec![])]),
        Change::Stop if active(r.status) => Ok(vec![Command::Action(6, vec![])]),
        _ => Err(AppError::invalid("当前设备状态不支持此操作。")),
    }
}
pub fn matches(r: &Snapshot, c: &Change) -> bool {
    match c {
        Change::Start {
            mode,
            minutes,
            temperature,
            keep_warm,
            finish_at,
            ..
        } => {
            r.mode == *mode
                && r.recipe_id.as_deref() == Some(format!("M{mode}").as_str())
                && r.minutes == *minutes
                && r.temperature == *temperature
                && r.keep_warm == Some(*keep_warm)
                && if finish_at.is_some() {
                    let expected = finish_at
                        .unwrap()
                        .saturating_sub(r.fetched_at)
                        .div_ceil(60)
                        .saturating_sub(u64::from(*minutes));
                    if expected > 1 {
                        r.status == 3
                            && r.reservation_minutes
                                .is_some_and(|v| u64::from(v).abs_diff(expected) <= 1)
                    } else {
                        r.status == 3 || cooking(r.status)
                    }
                } else {
                    cooking(r.status)
                }
        }
        Change::Adjust {
            minutes,
            temperature,
            keep_warm,
        } => {
            r.minutes == *minutes
                && r.temperature == *temperature
                && r.keep_warm == Some(*keep_warm)
        }
        Change::Pause => r.status == 2,
        Change::Resume => cooking(r.status),
        Change::Stop => !active(r.status),
    }
}

#[cfg(test)]
#[path = "fryer_control_tests.rs"]
mod tests;
