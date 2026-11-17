//! Typed cloud timer changes. Payloads and scene IDs stay behind AppState.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::*,
    timers,
};
use chrono::{DateTime, Datelike, Days, FixedOffset, Timelike};
use serde_json::{json, Value};
use std::time::Duration;

pub fn permission_reason(device: &Device, panel: &DevicePanel, owner: bool) -> Option<String> {
    if !owner {
        return Some("当前仅支持家庭所有者修改云端定时。".into());
    }
    let Some(prop) = timers::binding(device, panel) else {
        return Some("此型号的定时写入尚未接入。".into());
    };
    if !prop.access.iter().any(|v| v == "write") || prop.unsupported_reason.is_some() {
        return Some("设备描述不允许修改此开关的定时。".into());
    }
    None
}
fn conflict() -> AppError {
    AppError::new(
        "timerConflict",
        "定时记录已经变化，请重新读取后再操作。",
        true,
    )
}
fn clock(text: &str) -> Result<(u32, u32)> {
    let bytes = text.as_bytes();
    if bytes.len() != 5
        || bytes[2] != b':'
        || ![0, 1, 3, 4].iter().all(|i| bytes[*i].is_ascii_digit())
    {
        return Err(AppError::invalid("请选择有效的24小时时间。"));
    }
    let hour = u32::from(bytes[0] - b'0') * 10 + u32::from(bytes[1] - b'0');
    let minute = u32::from(bytes[3] - b'0') * 10 + u32::from(bytes[4] - b'0');
    if hour > 23 || minute > 59 {
        return Err(AppError::invalid("请选择有效的24小时时间。"));
    }
    Ok((hour, minute))
}
pub fn validate(change: &TimerChange) -> Result<()> {
    let key = match change {
        TimerChange::Save { draft } => draft.key.as_deref(),
        TimerChange::SetEnabled { key, .. } | TimerChange::Delete { key } => Some(key.as_str()),
    };
    if key.is_some_and(|key| {
        key.len() != 129
            || key.as_bytes()[64] != b':'
            || !key
                .bytes()
                .enumerate()
                .all(|(i, v)| i == 64 || v.is_ascii_hexdigit())
    }) {
        return Err(AppError::invalid("定时引用无效，请重新读取。"));
    }
    if let TimerChange::Save { draft } = change {
        let on = draft.mode != TimerMode::Off;
        let off = draft.mode != TimerMode::On;
        if draft.on_time.is_some() != on || draft.off_time.is_some() != off {
            return Err(AppError::invalid("请设置所选定时模式的时间。"));
        }
        for time in [&draft.on_time, &draft.off_time].into_iter().flatten() {
            clock(time)?;
        }
        if on && off && draft.on_time == draft.off_time {
            return Err(AppError::invalid("开启与关闭时间不能相同。"));
        }
        let mut days = draft.weekdays.clone();
        days.sort_unstable();
        days.dedup();
        if days.len() != draft.weekdays.len() || days.len() > 7 || days.iter().any(|day| *day > 6) {
            return Err(AppError::invalid("重复星期无效。"));
        }
    }
    Ok(())
}
pub(crate) fn scene_id(row: &Value) -> Option<String> {
    let id = id(&row["us_id"]);
    (!id.is_empty() && id != "0" && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()))
        .then_some(id)
}
pub(crate) fn editable(device: &Device, row: &Value) -> bool {
    row["identify"] == "Timing100" && binding_matches(device, row)
}
pub(crate) fn binding_matches(device: &Device, row: &Value) -> bool {
    let setting = &row["setting"];
    let params = setting["on_param"]
        .as_array()
        .zip(setting["off_param"].as_array());
    let params_match = params.is_some_and(|(on, off)| {
        on.len() == 1
            && off.len() == 1
            && on[0]["did"].as_str() == Some(device.control_did())
            && off[0]["did"] == on[0]["did"]
            && on[0]["siid"] == off[0]["siid"]
            && on[0]["piid"] == off[0]["piid"]
            && on[0]["value"] == true
            && off[0]["value"] == false
            && on[0].get("miid").is_none()
            && off[0].get("miid").is_none()
    });
    scene_id(row).is_some()
        && params_match
        && setting["on_method"] == "set_properties"
        && setting["off_method"] == "set_properties"
        && row["authed"]
            .as_array()
            .is_some_and(|ids| ids.len() == 1 && id(&ids[0]) == device.control_did())
}
fn existing<'a>(
    device: &Device,
    panel: &DevicePanel,
    scenes: &'a Value,
    key: &str,
) -> Result<&'a Value> {
    let prop = timers::binding(device, panel).ok_or_else(AppError::stale)?;
    let row = timers::rows(scenes)?
        .into_iter()
        .find(|row| timers::scene_key(device, row) == key)
        .ok_or_else(conflict)?;
    let parsed = timers::project(device, prop, &json!([row]), None, epoch_secs())?;
    if !editable(device, row)
        || parsed.unsupported_count != 0
        || parsed.entries.len() != 1
        || parsed.entries[0].edit_reason.is_some()
    {
        return Err(AppError::new(
            "unsupported",
            "此定时包含尚未支持的规则或设备绑定，不能修改。",
            false,
        ));
    }
    Ok(row)
}
fn schedules(draft: &TimerDraft, now: u64) -> Result<(String, String)> {
    let tz = FixedOffset::east_opt(8 * 3600).unwrap();
    let now = DateTime::from_timestamp(i64::try_from(now).map_err(|_| AppError::protocol())?, 0)
        .ok_or_else(AppError::protocol)?
        .with_timezone(&tz);
    let on = draft.on_time.as_deref().map(clock).transpose()?;
    let off = draft.off_time.as_deref().map(clock).transpose()?;
    let mut days = draft.weekdays.clone();
    days.sort_unstable();
    if !days.is_empty() {
        let cron = |time: (u32, u32), days: &[u8]| {
            format!(
                "0 {} {} * * {} *",
                time.1,
                time.0,
                days.iter().map(u8::to_string).collect::<Vec<_>>().join(",")
            )
        };
        let first = on.or(off).ok_or_else(AppError::protocol)?;
        let mut off_days = days.clone();
        if on.zip(off).is_some_and(|(on, off)| off < on) {
            for day in &mut off_days {
                *day = (*day + 1) % 7;
            }
            off_days.sort_unstable();
        }
        return Ok((
            cron(on.unwrap_or(first), &days),
            cron(off.unwrap_or(first), &off_days),
        ));
    }
    let first = on.or(off).ok_or_else(AppError::protocol)?;
    let mut date = now.date_naive();
    if first <= (now.hour(), now.minute()) {
        date = date
            .checked_add_days(Days::new(1))
            .ok_or_else(AppError::protocol)?;
    }
    let make = |date: chrono::NaiveDate, time: (u32, u32)| {
        format!(
            "0 {} {} {} {} * {}",
            time.1,
            time.0,
            date.day(),
            date.month(),
            date.year()
        )
    };
    let off_date = if on.zip(off).is_some_and(|(on, off)| off < on) {
        date.checked_add_days(Days::new(1))
            .ok_or_else(AppError::protocol)?
    } else {
        date
    };
    Ok((
        make(date, on.unwrap_or(first)),
        make(off_date, off.unwrap_or(first)),
    ))
}

pub(crate) struct Prepared {
    pub body: Value,
    pub delete: bool,
    pub original_id: Option<String>,
}
pub(crate) fn prepare(
    device: &Device,
    panel: &DevicePanel,
    scenes: &Value,
    change: &TimerChange,
    now: u64,
) -> Result<Prepared> {
    validate(change)?;
    let prop = timers::binding(device, panel)
        .ok_or_else(|| AppError::new("unsupported", "此型号的定时写入尚未接入。", false))?;
    let key = match change {
        TimerChange::Save { draft } => draft.key.as_deref(),
        TimerChange::SetEnabled { key, .. } | TimerChange::Delete { key } => Some(key.as_str()),
    };
    let row = key
        .map(|key| existing(device, panel, scenes, key))
        .transpose()?;
    let original_id = row.and_then(scene_id);
    if let TimerChange::Delete { .. } = change {
        return Ok(Prepared {
            body: json!({"us_id":[original_id.as_ref().ok_or_else(conflict)?]}),
            delete: true,
            original_id,
        });
    }
    let mut setting=row.map(|row|row["setting"].clone()).unwrap_or_else(||json!({"timer_type":"0","enable_push":"0","on_method":"set_properties","off_method":"set_properties","on_param":[{"did":device.control_did(),"siid":prop.siid,"piid":prop.piid,"value":true}],"off_param":[{"did":device.control_did(),"siid":prop.siid,"piid":prop.piid,"value":false}],"on_filter":"","off_filter":""}));
    match change {
        TimerChange::Save { draft } => {
            let (on, off) = schedules(draft, now)?;
            setting["timer_type"] = json!("0");
            setting["enable_timer"] = json!(if draft.enabled { "1" } else { "0" });
            setting["enable_timer_on"] = json!(if draft.mode != TimerMode::Off {
                "1"
            } else {
                "0"
            });
            setting["enable_timer_off"] = json!(if draft.mode != TimerMode::On {
                "1"
            } else {
                "0"
            });
            setting["on_time"] = json!(on);
            setting["off_time"] = json!(off);
            // The editor handles plain calendar/weekdays; other filter profiles
            // were rejected before editing, and are never silently retained.
            setting["on_filter"] = json!("");
            setting["off_filter"] = json!("");
        }
        TimerChange::SetEnabled { enabled, .. } => {
            setting["enable_timer"] = json!(if *enabled { "1" } else { "0" })
        }
        TimerChange::Delete { .. } => unreachable!(),
    }
    let body = json!({"us_id":original_id.as_deref().unwrap_or("0"),"st_id":8,"identify":row.map(|row|row["identify"].clone()).unwrap_or(json!("Timing100")),"name":row.map(|row|row["name"].clone()).filter(Value::is_string).unwrap_or(json!(format!("{}-定时",device.name))),"authed":[device.control_did()],"setting":setting});
    Ok(Prepared {
        body,
        delete: false,
        original_id,
    })
}
fn matches_saved(row: &Value, expected: &Value, device: &Device) -> bool {
    if !editable(device, row) {
        return false;
    }
    matches_settings(row, expected)
}
pub(crate) fn matches_settings(row: &Value, expected: &Value) -> bool {
    if row["identify"] != expected["identify"] || row["name"] != expected["name"] {
        return false;
    }
    let Some(settings) = expected["setting"].as_object() else {
        return false;
    };
    settings.iter().all(|(key, value)| {
        if matches!(
            key.as_str(),
            "enable_timer" | "enable_timer_on" | "enable_timer_off" | "enable_push"
        ) {
            let parse = |v: &Value| match v {
                Value::Bool(v) => Some(*v),
                Value::String(v) if v == "0" => Some(false),
                Value::String(v) if v == "1" => Some(true),
                _ => None,
            };
            parse(value).is_some() && parse(value) == parse(&row["setting"][key])
        } else {
            row["setting"][key] == *value
        }
    })
}
pub(crate) async fn commit(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
    prepared: Prepared,
) -> Result<TimerChangeResult> {
    let response = cloud
        .change_timer_scene(device, prepared.delete, prepared.body.clone())
        .await
        .map_err(|error| {
            if matches!(error.kind.as_str(), "network" | "protocol") {
                AppError::new(
                    "timerWriteUncertain",
                    "定时请求结果尚不确定，请先重新读取，勿重复提交。",
                    true,
                )
            } else {
                error
            }
        })?;
    let target = prepared.original_id.clone().or_else(|| scene_id(&response));
    let Some(target) = target else {
        return Ok(TimerChangeResult {
            verified: false,
            message: "云端已接受请求，但没有返回可核对的定时标识。请重新读取，勿重复提交。".into(),
            report: None,
            changed_key: None,
        });
    };
    for delay in [350, 800, 1500] {
        tokio::time::sleep(Duration::from_millis(delay)).await;
        let scenes =
            match tokio::time::timeout(Duration::from_secs(6), cloud.timer_scenes(device)).await {
                Ok(Ok(value)) => value,
                Ok(Err(error)) if error.kind == "authExpired" => return Err(error),
                _ => continue,
            };
        let Ok(rows) = timers::rows(&scenes) else {
            continue;
        };
        let row = rows
            .into_iter()
            .find(|row| scene_id(row).as_deref() == Some(target.as_str()));
        let verified = if prepared.delete {
            row.is_none()
        } else {
            row.is_some_and(|row| {
                if prepared.body["setting"]["timer_type"] == "1" {
                    timers::binding(device, panel)
                        .is_some_and(|prop| crate::countdown_write::editable(device, prop, row))
                        && matches_settings(row, &prepared.body)
                } else {
                    matches_saved(row, &prepared.body, device)
                }
            })
        };
        if verified {
            let prop = timers::binding(device, panel).ok_or_else(AppError::stale)?;
            let preferences = tokio::time::timeout(
                Duration::from_secs(3),
                cloud.timer_preferences(device, prop.siid, prop.piid),
            )
            .await;
            if let Ok(Err(error)) = &preferences {
                if error.kind == "authExpired" {
                    return Err(error.clone());
                }
            }
            let preferences = preferences.ok().and_then(std::result::Result::ok);
            let report =
                timers::project(device, prop, &scenes, preferences.as_ref(), epoch_secs())?;
            return Ok(TimerChangeResult {
                verified: true,
                message: if prepared.delete {
                    "云端已确认删除定时记录。".into()
                } else {
                    "云端定时记录已回读确认；实际执行效果需观察设备反馈。".into()
                },
                report: Some(report),
                changed_key: if prepared.delete {
                    None
                } else {
                    row.map(|row| timers::scene_key(device, row))
                },
            });
        }
    }
    Ok(TimerChangeResult {
        verified: false,
        message: "请求已提交，但未确认云端记录。请先重新读取，勿重复提交。".into(),
        report: None,
        changed_key: None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    fn context() -> (Device, DevicePanel) {
        let device:Device=serde_json::from_value(json!({"did":"test-device","name":"test","model":"cuco.plug.v3","online":true,"roomId":"","roomName":""})).unwrap();
        let panel=serde_json::from_value(json!({"did":device.did,"model":device.model,"specType":"urn:miot-spec-v2:device:outlet:test","services":[{"siid":17,"name":"switch","description":"power","actions":[],"properties":[{"siid":17,"piid":9,"name":"on","description":"","format":"bool","access":["read","write"]}]}]})).unwrap();
        (device, panel)
    }
    fn draft() -> TimerDraft {
        TimerDraft {
            key: None,
            mode: TimerMode::Period,
            on_time: Some("23:30".into()),
            off_time: Some("01:00".into()),
            weekdays: vec![6],
            enabled: false,
        }
    }
    #[test]
    fn payload_uses_actual_binding_and_cross_midnight_weekdays() {
        let (device, panel) = context();
        let result = prepare(
            &device,
            &panel,
            &json!({}),
            &TimerChange::Save { draft: draft() },
            1793000000,
        )
        .unwrap();
        assert_eq!(result.body["identify"], "Timing100");
        assert_eq!(result.body["setting"]["on_time"], "0 30 23 * * 6 *");
        assert_eq!(result.body["setting"]["off_time"], "0 0 1 * * 0 *");
        assert_eq!(result.body["setting"]["enable_timer"], "0");
        assert_eq!(result.body["setting"]["on_param"][0]["siid"], 17);
        assert_eq!(result.body["setting"]["on_param"][0]["piid"], 9);
    }
    #[test]
    fn once_rollover_keeps_year_and_period_off_date() {
        let mut draft = draft();
        draft.weekdays.clear();
        let now = FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 12, 31, 23, 40, 0)
            .unwrap()
            .timestamp() as u64;
        let (on, off) = schedules(&draft, now).unwrap();
        assert_eq!(on, "0 30 23 1 1 * 2027");
        assert_eq!(off, "0 0 1 2 1 * 2027");
    }
    #[test]
    fn invalid_times_modes_and_duplicate_weekdays_reject_before_cloud() {
        for value in ["24:00", "23:60", "1:00", "00:0a", "00:00:00"] {
            let mut d = draft();
            d.on_time = Some(value.into());
            assert!(validate(&TimerChange::Save { draft: d }).is_err());
        }
        let mut d = draft();
        d.weekdays = vec![1, 1];
        assert!(validate(&TimerChange::Save { draft: d }).is_err());
        let mut d = draft();
        d.mode = TimerMode::Off;
        assert!(validate(&TimerChange::Save { draft: d }).is_err());
        assert!(serde_json::from_value::<TimerDraft>(json!({"mode":"off","offTime":"06:00","onTime":null,"weekdays":[],"enabled":false,"did":"injected"})).is_err());
    }
    fn existing_row(device: &Device, panel: &DevicePanel) -> Value {
        let mut d = draft();
        d.mode = TimerMode::Off;
        d.on_time = None;
        d.off_time = Some("06:00".into());
        d.weekdays = (0..7).collect();
        let mut row = prepare(
            device,
            panel,
            &json!({}),
            &TimerChange::Save { draft: d },
            1,
        )
        .unwrap()
        .body;
        row["us_id"] = json!("123");
        row["name"] = json!("preserve-name");
        row["setting"]["extra_setting"] = json!("preserve");
        row
    }
    #[test]
    fn enable_preserves_settings_and_rejects_stale_or_foreign_handles() {
        let (device, panel) = context();
        let row = existing_row(&device, &panel);
        let key = timers::scene_key(&device, &row);
        let prepared = prepare(
            &device,
            &panel,
            &json!([row]),
            &TimerChange::SetEnabled {
                key: key.clone(),
                enabled: true,
            },
            1,
        )
        .unwrap();
        assert_eq!(prepared.body["name"], "preserve-name");
        assert_eq!(prepared.body["setting"]["extra_setting"], "preserve");
        assert_eq!(
            prepared.body["setting"]["off_time"],
            "0 0 6 * * 0,1,2,3,4,5,6 *"
        );
        let changed = prepared.body;
        assert_eq!(
            prepare(
                &device,
                &panel,
                &json!([changed]),
                &TimerChange::Delete { key },
                1
            )
            .err()
            .unwrap()
            .kind,
            "timerConflict"
        );
        let mut foreign = existing_row(&device, &panel);
        foreign["setting"]["off_param"][0]["did"] = json!("foreign");
        let key = timers::scene_key(&device, &foreign);
        assert!(prepare(
            &device,
            &panel,
            &json!([foreign]),
            &TimerChange::Delete { key },
            1
        )
        .is_err());
    }
    #[test]
    fn delete_is_exact_array_contract_and_never_accepts_arbitrary_ids() {
        let (device, panel) = context();
        let row = existing_row(&device, &panel);
        let key = timers::scene_key(&device, &row);
        let result = prepare(
            &device,
            &panel,
            &json!([row]),
            &TimerChange::Delete { key },
            1,
        )
        .unwrap();
        assert!(result.delete);
        assert_eq!(result.body, json!({"us_id":["123"]}));
        assert!(validate(&TimerChange::Delete { key: "123".into() }).is_err());
        assert!(permission_reason(&device, &panel, false).is_some());
    }
    #[test]
    fn successful_edit_response_alone_cannot_pass_readback() {
        let (device, panel) = context();
        let expected = existing_row(&device, &panel);
        let mut actual = expected.clone();
        actual["setting"]["enable_timer"] = json!(true);
        let mut expected_enabled = expected.clone();
        expected_enabled["setting"]["enable_timer"] = json!("1");
        assert!(matches_saved(&actual, &expected_enabled, &device));
        actual["setting"]["off_time"] = json!("0 1 6 * * 0,1,2,3,4,5,6 *");
        assert!(!matches_saved(&actual, &expected_enabled, &device));
    }
}
