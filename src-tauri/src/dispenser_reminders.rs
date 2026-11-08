//! gxj v29 10700/10853/10970/11822/11837. Cloud preferences and reminder
//! timers are separate from immediate device actions; all mutations need reads.
use crate::{
    dispenser, dispenser_config,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel},
    timer_write, timers,
};
use chrono::{DateTime, Datelike, Days, Local, NaiveDate, TimeZone, Timelike};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum PushField {
    CleanFinish,
    LackWater,
}
impl PushField {
    pub fn key(self) -> &'static str {
        match self {
            Self::CleanFinish => "push_enable_20622",
            Self::LackWater => "push_enable_20623",
        }
    }
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Repeat {
    Once,
    EveryDay,
    Workday,
    Freeday,
    Custom,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(
    tag = "kind",
    rename_all = "lowercase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Draft {
    Point {
        time: String,
        repeat: Repeat,
        weekdays: Vec<u8>,
    },
    Period {
        start_time: String,
        end_time: String,
        interval_hours: f64,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Reminder {
    pub key: String,
    pub enabled: bool,
    pub draft: Draft,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushState {
    pub value: Option<bool>,
    pub source: String,
    pub can_edit: bool,
    pub reason: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Active {
    pub enabled: Option<bool>,
    pub interval_hours: Option<f64>,
    pub orphaned: bool,
    pub can_stop: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub fetched_at: u64,
    pub revision: String,
    pub cycle: Option<u8>,
    pub cycle_can_edit: bool,
    pub cycle_reason: Option<String>,
    pub clean_finish: PushState,
    pub lack_water: PushState,
    pub reminders: Vec<Reminder>,
    pub can_edit_schedules: bool,
    pub schedule_reason: Option<String>,
    pub active: Active,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Push {
        revision: String,
        field: PushField,
        enabled: bool,
    },
    Cycle {
        revision: String,
        value: u8,
    },
    Save {
        revision: String,
        key: Option<String>,
        draft: Draft,
    },
    Toggle {
        revision: String,
        key: String,
        enabled: bool,
    },
    Delete {
        revision: String,
        key: String,
    },
    StopActive {
        revision: String,
    },
}
impl Change {
    pub fn revision(&self) -> &str {
        match self {
            Self::Push { revision, .. }
            | Self::Cycle { revision, .. }
            | Self::Save { revision, .. }
            | Self::Toggle { revision, .. }
            | Self::Delete { revision, .. }
            | Self::StopActive { revision } => revision,
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub verified: bool,
    pub message: String,
    pub report: Option<Report>,
}
pub(crate) struct Loaded {
    pub panel: DevicePanel,
    pub push: Option<Value>,
    pub scenes: Option<Value>,
    pub report: Report,
}
#[derive(Clone)]
struct Parsed {
    row: Value,
    reminder: Reminder,
    union: u32,
    interval: f64,
}
pub(crate) enum Plan {
    Noop,
    Push {
        field: PushField,
        enabled: bool,
        no_op: bool,
    },
    Cycle {
        value: u8,
        no_op: bool,
    },
    Schedule {
        body: Value,
        delete: bool,
        pause: Option<Value>,
        cleanup: Option<(f64, u32)>,
        baseline: Vec<Value>,
    },
    StopActive {
        interval: f64,
        union: u32,
    },
}
fn invalid(s: &str) -> AppError {
    AppError::invalid(s)
}
fn hash(value: impl Serialize) -> Result<String> {
    Ok(format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&value).map_err(|_| AppError::protocol())?)
    ))
}
fn clock(s: &str) -> Option<(u8, u8)> {
    let b = s.as_bytes();
    if b.len() != 5 || b[2] != b':' || ![0, 1, 3, 4].iter().all(|i| b[*i].is_ascii_digit()) {
        return None;
    }
    let h = (b[0] - b'0') * 10 + b[1] - b'0';
    let m = (b[3] - b'0') * 10 + b[4] - b'0';
    (h < 24 && m < 60).then_some((h, m))
}
fn minutes(s: &str) -> Option<i32> {
    let (h, m) = clock(s)?;
    Some(h as i32 * 60 + m as i32)
}
pub fn validate(draft: &Draft) -> Result<()> {
    match draft {
        Draft::Point {
            time,
            repeat,
            weekdays,
        } => {
            if clock(time).is_none() {
                return Err(invalid("请选择有效的提醒时间。"));
            }
            let set = weekdays.iter().copied().collect::<HashSet<_>>();
            if *repeat == Repeat::Custom {
                if weekdays.is_empty()
                    || set.len() != weekdays.len()
                    || weekdays.iter().any(|d| *d > 6)
                {
                    return Err(invalid("请选择有效且不重复的星期。"));
                }
            } else if !weekdays.is_empty() {
                return Err(invalid("此重复类型不能附带自定义星期。"));
            }
        }
        Draft::Period {
            start_time,
            end_time,
            interval_hours,
        } => {
            let start = minutes(start_time).ok_or_else(|| invalid("请选择开始时间。"))?;
            let end = minutes(end_time).ok_or_else(|| invalid("请选择结束时间。"))?;
            let duration = (end - start).rem_euclid(1440);
            if duration == 0
                || !interval_hours.is_finite()
                || !(0.5..=12.0).contains(interval_hours)
                || (interval_hours * 2.0).fract() != 0.0
                || (duration as f64) < interval_hours * 60.0
            {
                return Err(invalid("提醒间隔应为0.5至12小时，且不能大于所选时段。"));
            }
        }
    }
    Ok(())
}
fn current<'a>(p: &'a DevicePanel, piid: u32, name: &str, format: &str) -> Option<&'a Value> {
    let v = dispenser_config::property(p, 2, piid, name, format)?;
    (v.code == Some(0) && v.access.iter().any(|a| a == "read")).then_some(())?;
    v.value.as_ref()
}
pub fn cycle(p: &DevicePanel) -> Option<u8> {
    current(p, 9, "sterilization-remind-cycle", "uint8")?
        .as_u64()
        .filter(|v| *v <= 60 && *v % 15 == 0)
        .map(|v| v as u8)
}
pub fn active_values(p: &DevicePanel) -> Option<(f64, bool, u32)> {
    let interval = current(p, 10, "interval-reminder-time", "float")?
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=24.0).contains(v) && (v * 2.0).fract() == 0.0)?;
    let enabled = current(p, 11, "interval-reminder-switch", "bool")?.as_bool()?;
    let union = current(p, 12, "cloud-timing-id", "uint32")?
        .as_u64()
        .filter(|v| *v <= 2147483647)? as u32;
    Some((interval, enabled, union))
}
fn action_bound(p: &DevicePanel) -> bool {
    p.services
        .iter()
        .filter(|s| s.siid == 2 && s.name == "water-dispenser")
        .flat_map(|s| &s.actions)
        .filter(|a| {
            a.siid == 2
                && a.aiid == 4
                && a.name == "set-drink-reminder"
                && a.inputs == [10, 11, 12]
                && a.out.is_empty()
                && a.unsupported_reason.is_none()
        })
        .count()
        == 1
}
fn push_state(raw: Option<&Value>, field: PushField) -> PushState {
    let (value, source) = match raw.and_then(|v| v["settings"].as_object()) {
        None => (None, "unknown"),
        Some(s) if s.is_empty() => (None, "unset"),
        Some(s) => match s.get(field.key()) {
            Some(Value::String(v)) if v == "1" => (Some(true), "cloud"),
            Some(Value::String(v)) if v == "0" => (Some(false), "cloud"),
            None => (Some(false), "vendorDefault"),
            _ => (None, "unknown"),
        },
    };
    PushState {
        value,
        source: source.into(),
        can_edit: source != "unknown",
        reason: (source == "unknown").then(|| "通知设置未能读取，请重新读取。".into()),
    }
}
fn action_param(s: &Value, prefix: &str, d: &Device, on: bool) -> Option<(f64, u32)> {
    if s[format!("{prefix}_method")] != "action" {
        return None;
    }
    let p = &s[format!("{prefix}_param")];
    if id(&p["did"]) != d.control_did()
        || p["siid"] != 2
        || p["aiid"] != 4
        || p.as_object()?
            .keys()
            .any(|k| !["did", "siid", "aiid", "in"].contains(&k.as_str()))
    {
        return None;
    }
    let args = p["in"].as_array().filter(|a| a.len() == 3)?;
    let one = |piid: u64| {
        let a = args
            .iter()
            .filter(|a| a["piid"].as_u64() == Some(piid))
            .collect::<Vec<_>>();
        if a.len() != 1
            || id(&a[0]["did"]) != d.control_did()
            || a[0]["siid"] != 2
            || a[0]
                .as_object()?
                .keys()
                .any(|k| !["did", "siid", "piid", "value"].contains(&k.as_str()))
        {
            None
        } else {
            Some(&a[0]["value"])
        }
    };
    let interval = one(10)?
        .as_f64()
        .filter(|v| v.is_finite() && (0.0..=12.0).contains(v) && (v * 2.0).fract() == 0.0)?;
    if one(11)?.as_bool() != Some(on) {
        return None;
    }
    let union = one(12)?.as_u64().filter(|v| (1..=2147483647).contains(v))? as u32;
    Some((interval, union))
}
fn cron(s: &str, filter: &str) -> Option<(String, Repeat, Vec<u8>)> {
    let p = s.split_whitespace().collect::<Vec<_>>();
    if p.len() != 5 {
        return None;
    }
    let number = |s: &str, max: u8| -> Option<u8> {
        if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) {
            return None;
        }
        s.parse::<u8>().ok().filter(|v| *v <= max)
    };
    let h = number(p[1], 23)?;
    let m = number(p[0], 59)?;
    let time = format!("{h:02}:{m:02}");
    if p[2] == "*" && p[3] == "*" {
        let repeat = match filter {
            "cn_workday" if p[4] == "*" => Repeat::Workday,
            "cn_freeday" if p[4] == "*" => Repeat::Freeday,
            "" if p[4] == "*" => Repeat::EveryDay,
            "" => Repeat::Custom,
            _ => return None,
        };
        let days = if repeat == Repeat::Custom {
            let days = p[4]
                .split(',')
                .map(|d| number(d, 6))
                .collect::<Option<Vec<_>>>()?;
            let unique = days.iter().collect::<HashSet<_>>();
            if days.is_empty() || unique.len() != days.len() {
                return None;
            }
            days
        } else {
            vec![]
        };
        Some((time, repeat, days))
    } else {
        let day = number(p[2], 31)?;
        let month = number(p[3], 12)?;
        if !filter.is_empty()
            || p[4] != "*"
            || NaiveDate::from_ymd_opt(2024, month as u32, day as u32).is_none()
        {
            return None;
        }
        Some((time, Repeat::Once, vec![]))
    }
}
fn touches(r: &Value, d: &Device) -> bool {
    r["identify"] == "drink_remind"
        || ["on_param", "off_param"].iter().any(|k| {
            let p = &r["setting"][*k];
            id(&p["did"]) == d.control_did() && p["siid"] == 2 && p["aiid"] == 4
        })
}
fn parse(r: &Value, d: &Device) -> Option<Parsed> {
    let scene = timer_write::scene_id(r)?;
    let s = &r["setting"];
    if r["identify"] != "drink_remind"
        || !r["authed"]
            .as_array()
            .is_some_and(|a| a.len() == 1 && id(&a[0]) == d.control_did())
        || s["timer_type"] != "0"
        || timers::flag(&s["enable_timer_on"]) != Some(true)
    {
        return None;
    }
    let enabled = timers::flag(&s["enable_timer"])?;
    let on = action_param(s, "on", d, true)?;
    let off = action_param(s, "off", d, false)?;
    if on != off {
        return None;
    }
    let filter = s.get("on_filter").and_then(Value::as_str).unwrap_or("");
    let off_filter = s.get("off_filter").and_then(Value::as_str).unwrap_or("");
    if filter != off_filter {
        return None;
    }
    let (time, repeat, weekdays) = cron(s["on_time"].as_str()?, filter)?;
    let draft = if on.0 == 0.0 {
        if timers::flag(&s["enable_timer_off"]) != Some(false) {
            return None;
        }
        cron(s["off_time"].as_str()?, "")?;
        Draft::Point {
            time,
            repeat,
            weekdays,
        }
    } else {
        if repeat != Repeat::EveryDay || timers::flag(&s["enable_timer_off"]) != Some(true) {
            return None;
        }
        let (end, rpt, _) = cron(s["off_time"].as_str()?, "")?;
        if rpt != Repeat::EveryDay {
            return None;
        }
        Draft::Period {
            start_time: time,
            end_time: end,
            interval_hours: on.0,
        }
    };
    validate(&draft).ok()?;
    Some(Parsed {
        row: r.clone(),
        reminder: Reminder {
            key: hash((&d.did, scene)).ok()?,
            enabled,
            draft,
        },
        union: on.1,
        interval: on.0,
    })
}
fn selected(d: &Device, raw: Option<&Value>) -> Result<Vec<Parsed>> {
    let rows = timers::rows(raw.ok_or_else(|| invalid("喝水定时未能读取，请重新读取。"))?)?;
    let mut seen = HashSet::new();
    let mut unions = HashSet::new();
    let mut found = Vec::new();
    for r in rows.into_iter().filter(|r| touches(r, d)) {
        let p = parse(r, d).ok_or_else(|| invalid("存在无法识别的喝水定时，请先在米家中检查。"))?;
        if !seen.insert(p.reminder.key.clone()) || !unions.insert(p.union) {
            return Err(invalid("存在重复的喝水提醒编号，请先在米家中检查。"));
        }
        found.push(p);
    }
    if found.len() > 5 {
        return Err(invalid("喝水提醒超过原版支持的5条，暂不能编辑。"));
    }
    Ok(found)
}
pub fn project(
    d: &Device,
    p: &DevicePanel,
    push: Option<&Value>,
    scenes: Option<&Value>,
    owner: bool,
) -> Result<Report> {
    if d.model != dispenser::MODEL
        || d.did != p.did
        || d.model != p.model
        || d.split_route.is_some()
    {
        return Err(AppError::stale());
    }
    let mut clean = push_state(push, PushField::CleanFinish);
    let mut lack = push_state(push, PushField::LackWater);
    if p.unsupported_reason.is_some() {
        for field in [&mut clean, &mut lack] {
            field.can_edit = false;
            field.reason = Some("设备访问权限或描述不可用。".into());
        }
    }
    let cyc = cycle(p);
    let cycle_reason = if !d.online {
        Some("设备离线，暂不能修改周期。".into())
    } else if d.shared_read_only {
        Some("此共享设备只有查看权限。".into())
    } else if cyc.is_none()
        || dispenser_config::property(p, 2, 9, "sterilization-remind-cycle", "uint8")
            .is_none_or(|p| !p.access.iter().any(|a| a == "write"))
    {
        Some("杀菌提醒周期未能直接读取或不支持修改。".into())
    } else {
        None
    };
    let active = active_values(p);
    let parsed = selected(d, scenes);
    let mut warnings = Vec::new();
    let (records, rawrows) = match &parsed {
        Ok(rows) => (
            rows.iter().map(|p| p.reminder.clone()).collect(),
            rows.iter().map(|p| p.row.clone()).collect::<Vec<_>>(),
        ),
        Err(e) => {
            warnings.push(e.message.clone());
            (vec![], vec![])
        }
    };
    let reason = if !owner {
        Some("当前仅支持家庭所有者编辑喝水定时。".into())
    } else if !d.online {
        Some("设备离线，恢复在线后可编辑喝水提醒。".into())
    } else if d.shared_read_only {
        Some("此共享设备只有查看权限。".into())
    } else if !action_bound(p) || active.is_none() {
        Some("设备提醒状态或动作未能完整读取。".into())
    } else {
        parsed.err().map(|e| e.message)
    };
    let orphaned = active.is_some_and(|(hours, on, union)| {
        on && hours > 0.0
            && !records
                .iter()
                .any(|r: &Reminder| r.enabled && parsed_union(&rawrows, &r.key, d) == Some(union))
    });
    let revision = hash((
        &d.did,
        cyc,
        &clean.value,
        &clean.source,
        &lack.value,
        &lack.source,
        active,
        &rawrows,
        &warnings,
        owner,
        d.online,
        d.shared_read_only,
    ))?;
    Ok(Report {
        did: d.did.clone(),
        fetched_at: epoch_secs(),
        revision,
        cycle: cyc,
        cycle_can_edit: cycle_reason.is_none(),
        cycle_reason,
        clean_finish: clean,
        lack_water: lack,
        reminders: records,
        can_edit_schedules: reason.is_none(),
        schedule_reason: reason,
        active: Active {
            enabled: active.map(|v| v.1),
            interval_hours: active.map(|v| v.0),
            orphaned,
            can_stop: owner
                && d.online
                && !d.shared_read_only
                && action_bound(p)
                && active.is_some_and(|v| v.1 && v.0 > 0.0 && v.2 > 0),
        },
        warnings,
    })
}
fn parsed_union(rows: &[Value], key: &str, d: &Device) -> Option<u32> {
    rows.iter()
        .filter_map(|r| parse(r, d))
        .find(|p| p.reminder.key == key)
        .map(|p| p.union)
}
pub fn interval_value(value: f64) -> Value {
    if value.fract() == 0.0 {
        json!(value as u32)
    } else {
        json!(value)
    }
}
fn action_input(d: &Device, interval: f64, union: u32, on: bool) -> Value {
    json!({"did":d.control_did(),"siid":2,"aiid":4,"in":[{"did":d.control_did(),"siid":2,"piid":10,"value":interval_value(interval)},{"did":d.control_did(),"siid":2,"piid":11,"value":on},{"did":d.control_did(),"siid":2,"piid":12,"value":union}]})
}
fn body(d: &Device, old: Option<&Parsed>, setting: Value) -> Value {
    json!({"us_id":old.and_then(|o|timer_write::scene_id(&o.row)).unwrap_or("0".into()),"st_id":8,"identify":"drink_remind","name":old.map(|p|p.row["name"].clone()).unwrap_or(json!("")),"authed":[d.control_did()],"setting":setting})
}
fn setting<T: TimeZone>(
    d: &Device,
    old: Option<&Parsed>,
    draft: &Draft,
    enabled: bool,
    union: u32,
    now: DateTime<T>,
) -> Result<Value> {
    validate(draft)?;
    let (on, off, filter, interval) = match draft {
        Draft::Point {
            time,
            repeat,
            weekdays,
        } => {
            let (h, m) = clock(time).ok_or_else(|| invalid("提醒时间无效。"))?;
            let on = match repeat {
                Repeat::Once => {
                    let mut day = now.date_naive();
                    let candidate = now
                        .timezone()
                        .from_local_datetime(
                            &day.and_hms_opt(h as u32, m as u32, 0)
                                .ok_or_else(|| invalid("提醒日期无效。"))?,
                        )
                        .earliest()
                        .ok_or_else(|| invalid("提醒时间无效。"))?;
                    if candidate <= now {
                        day = day
                            .checked_add_days(Days::new(1))
                            .ok_or_else(|| invalid("提醒日期无效。"))?
                    }
                    format!("{m} {h} {} {} *", day.day(), day.month())
                }
                Repeat::Custom => {
                    let mut days = weekdays.clone();
                    days.sort_unstable();
                    format!(
                        "{m} {h} * * {}",
                        days.iter().map(u8::to_string).collect::<Vec<_>>().join(",")
                    )
                }
                _ => format!("{m} {h} * * *"),
            };
            (
                on,
                format!(
                    "{} {} {} {} *",
                    now.minute(),
                    now.hour(),
                    now.day(),
                    now.month()
                ),
                match repeat {
                    Repeat::Workday => "cn_workday",
                    Repeat::Freeday => "cn_freeday",
                    _ => "",
                },
                0.0,
            )
        }
        Draft::Period {
            start_time,
            end_time,
            interval_hours,
        } => {
            let (sh, sm) = clock(start_time).ok_or_else(|| invalid("开始时间无效。"))?;
            let (eh, em) = clock(end_time).ok_or_else(|| invalid("结束时间无效。"))?;
            (
                format!("{sm} {sh} * * *"),
                format!("{em} {eh} * * *"),
                "",
                *interval_hours,
            )
        }
    };
    let mut value = old
        .map(|o| o.row["setting"].clone())
        .unwrap_or_else(|| json!({}));
    let fields = json!({"identify":"drink_remind","enable_timer_on":"1","enable_timer_off":if interval>0.0{"1"}else{"0"},"enable_timer":if enabled{"1"}else{"0"},"on_time":on,"off_time":off,"on_method":"action","off_method":"action","on_param":action_input(d,interval,union,true),"off_param":action_input(d,interval,union,false),"on_filter":filter,"off_filter":filter,"timer_type":"0"});
    for (k, v) in fields.as_object().ok_or_else(AppError::protocol)? {
        value[k] = v.clone()
    }
    Ok(value)
}
pub(crate) fn prepare(
    d: &Device,
    p: &DevicePanel,
    push: Option<&Value>,
    scenes: Option<&Value>,
    owner: bool,
    change: &Change,
) -> Result<Plan> {
    let r = project(d, p, push, scenes, owner)?;
    if change.revision() != r.revision {
        return Err(AppError::new(
            "reminderConflict",
            "提醒设置已经变化，请重新读取。",
            true,
        ));
    }
    match change {
        Change::Push { field, enabled, .. } => {
            let state = match field {
                PushField::CleanFinish => r.clean_finish,
                PushField::LackWater => r.lack_water,
            };
            if !state.can_edit {
                return Err(invalid(
                    state.reason.as_deref().unwrap_or("通知设置不可用。"),
                ));
            }
            Ok(Plan::Push {
                field: *field,
                enabled: *enabled,
                no_op: state.source == "cloud" && state.value == Some(*enabled),
            })
        }
        Change::Cycle { value, .. } => {
            if !r.cycle_can_edit {
                return Err(invalid(
                    r.cycle_reason.as_deref().unwrap_or("提醒周期不可用。"),
                ));
            }
            if ![0, 15, 30, 60].contains(value) {
                return Err(invalid("请选择关闭、15天、30天或60天。"));
            }
            Ok(Plan::Cycle {
                value: *value,
                no_op: r.cycle == Some(*value),
            })
        }
        Change::StopActive { .. } => {
            if !r.active.can_stop {
                return Err(invalid("当前没有可直接停止的设备时段提醒。"));
            }
            let (hours, _, union) =
                active_values(p).ok_or_else(|| invalid("设备提醒状态未能读取。"))?;
            Ok(Plan::StopActive {
                interval: hours,
                union,
            })
        }
        _ => {
            if let Some(reason) = r.schedule_reason {
                return Err(invalid(&reason));
            }
            let parsed = selected(d, scenes)?;
            let key = match change {
                Change::Save { key, .. } => key.as_deref(),
                Change::Toggle { key, .. } | Change::Delete { key, .. } => Some(key.as_str()),
                _ => None,
            };
            let old = if let Some(key) = key {
                Some(
                    parsed
                        .iter()
                        .find(|p| p.reminder.key == key)
                        .ok_or_else(|| invalid("提醒记录已经变化，请重新读取。"))?,
                )
            } else {
                None
            };
            if old.is_none() && parsed.len() >= 5 {
                return Err(invalid("最多设置5条喝水提醒。"));
            }
            if let (Some(old), Change::Toggle { enabled, .. }) = (old, change) {
                if old.reminder.enabled == *enabled {
                    return Ok(Plan::Noop);
                }
            }
            let union = if let Some(old) = old {
                old.union
            } else {
                let mut used = parsed.iter().map(|p| p.union).collect::<HashSet<_>>();
                if let Some((_, _, id)) = active_values(p) {
                    used.insert(id);
                }
                (1..=2147483647)
                    .find(|v| !used.contains(v))
                    .ok_or_else(|| invalid("无法生成提醒编号。"))?
            };
            let delete = matches!(change, Change::Delete { .. });
            let final_setting = match change {
                Change::Save { draft, .. } => setting(d, old, draft, true, union, Local::now())?,
                Change::Toggle { enabled, .. } => {
                    let old = old.ok_or_else(AppError::stale)?;
                    if *enabled
                        && matches!(
                            old.reminder.draft,
                            Draft::Point {
                                repeat: Repeat::Once,
                                ..
                            }
                        )
                    {
                        setting(d, Some(old), &old.reminder.draft, true, union, Local::now())?
                    } else {
                        let mut s = old.row["setting"].clone();
                        s["enable_timer"] = json!(if *enabled { "1" } else { "0" });
                        s
                    }
                }
                Change::Delete { .. } => old.ok_or_else(AppError::stale)?.row["setting"].clone(),
                _ => return Err(AppError::protocol()),
            };
            let pause = old
                .filter(|o| o.interval > 0.0 && o.reminder.enabled)
                .map(|o| {
                    let mut s = o.row["setting"].clone();
                    s["enable_timer"] = json!("0");
                    body(d, Some(o), s)
                });
            let cleanup = old
                .filter(|o| o.interval > 0.0)
                .map(|o| (o.interval, o.union));
            let final_body = if delete {
                json!({"us_id":old.and_then(|o|timer_write::scene_id(&o.row)).ok_or_else(AppError::stale)?,"st_id":8})
            } else {
                body(d, old, final_setting)
            };
            Ok(Plan::Schedule {
                body: final_body,
                delete,
                pause,
                cleanup,
                baseline: parsed.iter().map(|p| p.row.clone()).collect(),
            })
        }
    }
}
pub(crate) fn confirmed(d: &Device, raw: &Value, body: &Value, delete: bool) -> bool {
    let Ok(rows) = selected(d, Some(raw)) else {
        return false;
    };
    if delete {
        return timers::rows(raw)
            .is_ok_and(|all| !all.iter().any(|r| id(&r["us_id"]) == id(&body["us_id"])));
    }
    let found = rows
        .into_iter()
        .filter(|r| {
            (body["us_id"] == "0" || id(&r.row["us_id"]) == id(&body["us_id"]))
                && timer_write::matches_settings(&r.row, body)
        })
        .count();
    found == 1
}
pub(crate) fn unchanged(
    d: &Device,
    raw: &Value,
    baseline: &[Value],
    pause: Option<&Value>,
) -> bool {
    let Ok(current) = selected(d, Some(raw)) else {
        return false;
    };
    current.len() == baseline.len()
        && baseline.iter().all(|original| {
            let expected = pause
                .filter(|p| id(&p["us_id"]) == id(&original["us_id"]))
                .unwrap_or(original);
            current.iter().any(|p| {
                id(&p.row["us_id"]) == id(&expected["us_id"])
                    && timer_write::matches_settings(&p.row, expected)
                    && timer_write::matches_settings(expected, &p.row)
            })
        })
}
pub(crate) fn cleanup_target(p: &DevicePanel, interval: f64, union: u32) -> bool {
    active_values(p).is_some_and(|(h, on, id)| !on && id == union && (h - interval).abs() < 0.001)
}

#[cfg(test)]
#[path = "dispenser_reminders_tests.rs"]
mod tests;
