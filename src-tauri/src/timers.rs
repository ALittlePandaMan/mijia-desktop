//! Read-only projection of the APK's cloud countdown/timer adapter.
//! Scene identifiers, raw settings and write payloads never cross IPC.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, CountdownView, Device, DevicePanel, Property, TimerEntry, TimerReport},
};
use chrono::{FixedOffset, NaiveDate, TimeZone};
use serde_json::Value;
use sha2::{Digest, Sha256};

pub fn binding<'a>(device: &Device, panel: &'a DevicePanel) -> Option<&'a Property> {
    // Other models have native delay services or alternate methods/values.
    if device.model != "cuco.plug.v3"
        || device.did != panel.did
        || device.model != panel.model
        || device.split_route.is_some()
        || panel.unsupported_reason.is_some()
        || !panel
            .spec_type
            .as_deref()?
            .starts_with("urn:miot-spec-v2:device:outlet:")
    {
        return None;
    }
    let mut props = panel
        .services
        .iter()
        .filter(|s| s.name == "switch")
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == "on" && p.format == "bool" && p.access.iter().any(|a| a == "read"));
    let prop = props.next()?;
    props.next().is_none().then_some(prop)
}

pub async fn load(cloud: &Cloud, device: &Device, panel: &DevicePanel) -> Result<TimerReport> {
    let prop = binding(device, panel)
        .ok_or_else(|| AppError::new("unsupported", "此型号的云端定时读取尚未接入。", false))?;
    let (scenes, preferences) = tokio::join!(
        cloud.timer_scenes(device),
        cloud.timer_preferences(device, prop.siid, prop.piid)
    );
    // Optional preferences may fail, but authentication failure must invalidate
    // the session even when scene inventory succeeded.
    if let Err(error) = &preferences {
        if error.kind == "authExpired" {
            return Err(error.clone());
        }
    }
    let scenes = scenes?;
    let mut report = project(
        device,
        prop,
        &scenes,
        preferences.as_ref().ok(),
        epoch_secs(),
    )?;
    if let Err(error) = preferences {
        report
            .warnings
            .push(format!("延迟时间偏好读取失败：{}", error.message));
    }
    Ok(report)
}

pub(crate) fn flag(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(v) => Some(*v),
        Value::String(v) if v == "1" => Some(true),
        Value::String(v) if v == "0" => Some(false),
        _ => None,
    }
}

struct Cron {
    time: String,
    repeat: String,
    due_at: Option<u64>,
    weekdays: Vec<u8>,
}
fn number(value: &str, max: u32) -> Option<u32> {
    (!value.is_empty() && value.bytes().all(|b| b.is_ascii_digit())).then_some(())?;
    value.parse::<u32>().ok().filter(|v| *v <= max)
}
fn cron(value: &str) -> Option<Cron> {
    let mut parts: Vec<&str> = value.split_whitespace().collect();
    match parts.len() {
        5 => {
            parts.insert(0, "0");
            parts.push("*");
        }
        6 if parts[5] == "*" || parts[5].contains(',') || number(parts[5], 6).is_some() => {
            parts.push("*")
        }
        6 => parts.insert(0, "0"),
        7 => {}
        _ => return None,
    }
    let second = number(parts[0], 59)?;
    let minute = number(parts[1], 59)?;
    let hour = number(parts[2], 23)?;
    let time = if second == 0 {
        format!("{hour:02}:{minute:02}")
    } else {
        format!("{hour:02}:{minute:02}:{second:02}")
    };
    if parts[3] == "*" && parts[4] == "*" && parts[6] == "*" {
        let mut days = if parts[5] == "*" {
            (0..7).collect::<Vec<_>>()
        } else {
            parts[5]
                .split(',')
                .map(|p| number(p, 6))
                .collect::<Option<Vec<_>>>()?
        };
        let count = days.len();
        days.sort_unstable();
        days.dedup();
        if days.is_empty() || days.len() != count {
            return None;
        }
        let repeat = match days.as_slice() {
            [0, 1, 2, 3, 4, 5, 6] => "每天".into(),
            [1, 2, 3, 4, 5] => "周一至周五".into(),
            [0, 6] => "周六、周日".into(),
            _ => days
                .iter()
                .map(|day| ["周日", "周一", "周二", "周三", "周四", "周五", "周六"][*day as usize])
                .collect::<Vec<_>>()
                .join("、"),
        };
        return Some(Cron {
            time,
            repeat,
            due_at: None,
            weekdays: days.iter().map(|day| *day as u8).collect(),
        });
    }
    if parts[5] != "*" {
        return None;
    }
    let year = number(parts[6], 2100)?;
    if year < 1970 {
        return None;
    }
    let date = NaiveDate::from_ymd_opt(year as i32, number(parts[4], 12)?, number(parts[3], 31)?)?;
    let local = date.and_hms_opt(hour, minute, second)?;
    let stamp = FixedOffset::east_opt(8 * 3600)?
        .from_local_datetime(&local)
        .single()?
        .timestamp();
    Some(Cron {
        time,
        repeat: format!("{}（仅一次）", date.format("%Y-%m-%d")),
        due_at: Some(u64::try_from(stamp).ok()?),
        weekdays: vec![],
    })
}

pub(crate) fn matches_param(setting: &Value, on: bool, device: &Device, prop: &Property) -> bool {
    let prefix = if on { "on" } else { "off" };
    if setting[format!("{prefix}_method")] != "set_properties" {
        return false;
    }
    let Some(params) = setting[format!("{prefix}_param")].as_array() else {
        return false;
    };
    params.len() == 1
        && params[0]["did"].as_str() == Some(device.control_did())
        && params[0]["siid"].as_u64() == Some(u64::from(prop.siid))
        && params[0]["piid"].as_u64() == Some(u64::from(prop.piid))
        && params[0]["value"].as_bool() == Some(on)
        && params[0].get("miid").is_none()
}

fn duration(
    preferences: Option<&Value>,
    device: &Device,
    prop: &Property,
    on: bool,
) -> (Option<u32>, Option<u32>, String) {
    let Some(values) = preferences
        .and_then(|p| p.get(device.control_did()))
        .and_then(Value::as_object)
    else {
        return (None, None, "unknown".into());
    };
    let key = |suffix: &str| {
        format!(
            "prop.s_{}.{}.{}{suffix}",
            prop.siid,
            prop.piid,
            if on { "on" } else { "off" }
        )
    };
    let (Some(hours), Some(minutes)) = (values.get(&key("Hour")), values.get(&key("Minute")))
    else {
        return (None, None, "unknown".into());
    };
    let read = |v: &Value, default, max| -> Option<u32> {
        if v.is_null() {
            return Some(default);
        }
        let v = if let Some(s) = v.as_str() {
            serde_json::from_str::<Value>(s).ok()?
        } else {
            v.clone()
        };
        u32::try_from(v.as_u64()?).ok().filter(|v| *v <= max)
    };
    let (Some(h), Some(m)) = (read(hours, 0, 23), read(minutes, 5, 59)) else {
        return (None, None, "unknown".into());
    };
    if h == 0 && m == 0 {
        return (None, None, "unknown".into());
    }
    (
        Some(h),
        Some(m),
        if hours.is_null() || minutes.is_null() {
            "default"
        } else {
            "stored"
        }
        .into(),
    )
}

pub(crate) fn absolute_time(value: &Value) -> Option<u64> {
    cron(value.as_str()?)?.due_at
}

pub(crate) fn scene_key(device: &Device, row: &Value) -> String {
    let mut identity = Sha256::new();
    identity.update(device.control_did());
    identity.update(b"\nscene\n");
    identity.update(crate::models::id(&row["us_id"]));
    let mut hash = Sha256::new();
    hash.update(device.control_did());
    hash.update(b"\n");
    hash.update(row.to_string());
    format!("{:x}:{:x}", identity.finalize(), hash.finalize())
}
pub(crate) fn rows(scenes: &Value) -> Result<Vec<&Value>> {
    let rows: Vec<_> = match scenes {
        Value::Object(map) => map.values().collect(),
        Value::Array(rows) => rows.iter().collect(),
        _ => return Err(AppError::protocol()),
    };
    if rows.len() > 1000 {
        return Err(AppError::protocol());
    }
    Ok(rows)
}
pub(crate) fn project(
    device: &Device,
    prop: &Property,
    scenes: &Value,
    preferences: Option<&Value>,
    now: u64,
) -> Result<TimerReport> {
    let rows = rows(scenes)?;
    let mut report = TimerReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: now,
        entries: vec![],
        countdowns: [false, true]
            .into_iter()
            .map(|on| {
                let (hours, minutes, duration_source) = duration(preferences, device, prop, on);
                CountdownView {
                    on,
                    key: None,
                    write_reason: None,
                    active: Some(false),
                    due_at: None,
                    hours,
                    minutes,
                    duration_source,
                }
            })
            .collect(),
        unsupported_count: 0,
        warnings: vec![],
        write_reason: None,
    };
    let mut unknown_countdown = false;
    for row in rows {
        let setting = &row["setting"];
        let kind = setting["timer_type"].as_str();
        let parse = || -> Option<Vec<(bool, bool, Cron)>> {
            if !matches!(kind, Some("0" | "1")) {
                return None;
            }
            let enabled = flag(&setting["enable_timer"])?;
            let mut entries = vec![];
            for on in [false, true] {
                let prefix = if on { "on" } else { "off" };
                if !flag(&setting[format!("enable_timer_{prefix}")])? {
                    continue;
                }
                if !matches_param(setting, on, device, prop) {
                    return None;
                }
                // Holiday/calendar filters change the meaning of a daily cron.
                // Only the observed plain/seconds-capable profiles are decoded.
                if !matches!(
                    setting[format!("{prefix}_filter")].as_str(),
                    Some("" | "support_second")
                ) {
                    return None;
                }
                entries.push((
                    on,
                    enabled,
                    cron(setting[format!("{prefix}_time")].as_str()?)?,
                ));
            }
            Some(entries)
        };
        let Some(entries) = parse() else {
            report.unsupported_count += 1;
            // Unknown/foreign settings must never be interpreted as inactive.
            unknown_countdown |= kind != Some("0");
            continue;
        };
        if kind == Some("0") && !entries.is_empty() {
            let primary = entries.iter().find(|v| v.0).unwrap_or(&entries[0]);
            let secondary = if entries.len() == 2 {
                entries.iter().find(|v| !v.0)
            } else {
                None
            };
            let compatible = secondary.is_none_or(|off| {
                if primary.2.weekdays.is_empty() {
                    return primary
                        .2
                        .due_at
                        .zip(off.2.due_at)
                        .is_some_and(|(on, off)| off > on && off - on <= 86400);
                }
                let mut expected = primary.2.weekdays.clone();
                if off.2.time < primary.2.time {
                    for day in &mut expected {
                        *day = (*day + 1) % 7;
                    }
                    expected.sort_unstable();
                }
                expected == off.2.weekdays
            });
            let edit_reason = if !crate::timer_write::editable(device, row) || !compatible {
                Some("此记录的组合规则或设备绑定尚不支持编辑。".into())
            } else {
                None
            };
            report.entries.push(TimerEntry {
                key: scene_key(device, row),
                on: primary.0,
                enabled: primary.1,
                time: primary.2.time.clone(),
                repeat: primary.2.repeat.clone(),
                due_at: primary.2.due_at,
                end_time: secondary.map(|off| off.2.time.clone()),
                weekdays: primary.2.weekdays.clone(),
                edit_reason,
            });
        }
        for (on, enabled, value) in entries {
            if kind == Some("1") && enabled {
                match value.due_at {
                    Some(time) if time > now => {
                        let countdown = report.countdowns.iter_mut().find(|v| v.on == on).unwrap();
                        if countdown.due_at.is_none_or(|current| time < current) {
                            countdown.due_at = Some(time);
                            countdown.active = Some(true);
                            if crate::countdown_write::editable(device, prop, row) {
                                countdown.key = Some(scene_key(device, row));
                                countdown.write_reason = None;
                            } else {
                                countdown.key = None;
                                countdown.write_reason =
                                    Some("此倒计时的规则或设备绑定尚不支持修改。".into());
                            }
                        }
                    }
                    Some(_) => {} // Expired one-shot records are not active.
                    None => unknown_countdown = true,
                }
            }
        }
    }
    report
        .entries
        .sort_by(|a, b| a.time.cmp(&b.time).then(a.on.cmp(&b.on)));
    if unknown_countdown {
        for view in &mut report.countdowns {
            view.write_reason = Some("存在未识别的倒计时，请先在米家中核对记录。".into());
            if view.active != Some(true) {
                view.active = None;
            }
        }
    }
    if report.unsupported_count > 0 {
        report.warnings.push(format!(
            "另有 {} 条记录的格式或设备绑定尚不支持，未显示为已关闭。",
            report.unsupported_count
        ));
    }
    if report
        .countdowns
        .iter()
        .any(|v| v.duration_source == "unknown")
    {
        report.warnings.push("部分延迟时间偏好未能识别。".into());
    }
    Ok(report)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Device, Property) {
        let device = serde_json::from_value(json!({"did":"test-device","name":"test","model":"cuco.plug.v3","online":true,"roomId":"","roomName":""})).unwrap();
        let prop = serde_json::from_value(json!({"siid":17,"piid":9,"name":"on","description":"","format":"bool","access":["read","write"]})).unwrap();
        (device, prop)
    }
    fn scene(kind: &str, on: bool, time: &str) -> Value {
        json!({"us_id":"private-scene","setting":{"timer_type":kind,"enable_timer":"1","enable_timer_on":on,"enable_timer_off":!on,"on_method":"set_properties","off_method":"set_properties","on_time":time,"off_time":time,"on_filter":"support_second","off_filter":"support_second","on_param":[{"did":"test-device","siid":17,"piid":9,"value":true}],"off_param":[{"did":"test-device","siid":17,"piid":9,"value":false}]}})
    }
    #[test]
    fn cron_validates_dates_seconds_weekdays_and_beijing_offset() {
        assert_eq!(cron("0 5 6 * * 0,1,2,3,4,5,6 *").unwrap().repeat, "每天");
        assert_eq!(cron("5 6 * * 1,2,3,4,5").unwrap().repeat, "周一至周五");
        assert_eq!(
            cron("15 0 6 27 10 * 2026").unwrap().due_at,
            Some(1793052015)
        );
        assert_eq!(cron("0 6 27 10 * 2026").unwrap().due_at, Some(1793052000));
        for text in [
            "0 0 24 * * * *",
            "0 0 6 30 2 * 2026",
            "0 0 6 * * 7 *",
            "0 0 6 * * 1,1 *",
            "0 0 6 */2 * * *",
        ] {
            assert!(cron(text).is_none(), "{text}");
        }
    }
    #[test]
    fn disabled_regular_timers_are_retained_separately_from_countdown() {
        let (device, prop) = fixture();
        let mut off = scene("0", false, "0 0 6 * * 0,1,2,3,4,5,6 *");
        off["setting"]["enable_timer"] = json!("0");
        let report = project(&device, &prop, &json!([off]), None, 1).unwrap();
        assert_eq!(report.entries.len(), 1);
        assert!(!report.entries[0].enabled);
        assert!(report.countdowns.iter().all(|v| v.active == Some(false)));
        assert!(!serde_json::to_string(&report)
            .unwrap()
            .contains("private-scene"));
    }
    #[test]
    fn countdown_chooses_earliest_future_matching_direction() {
        let (device, prop) = fixture();
        let report = project(
            &device,
            &prop,
            &json!([
                scene("1", false, "0 0 6 27 10 * 2026"),
                scene("1", false, "0 0 5 27 10 * 2026"),
                scene("1", true, "0 0 6 20 10 * 2026")
            ]),
            None,
            1793000000,
        )
        .unwrap();
        assert_eq!(report.countdowns[0].due_at, Some(1793048400));
        assert_eq!(report.countdowns[0].active, Some(true));
        assert_eq!(report.countdowns[1].active, Some(false));
    }
    #[test]
    fn foreign_bindings_and_unrecognized_enabled_flags_never_become_false() {
        let (device, prop) = fixture();
        for key in ["did", "siid", "piid", "value", "miid"] {
            let mut row = scene("1", false, "0 0 6 27 10 * 2026");
            row["setting"]["off_param"][0][key] = json!(123);
            let report = project(&device, &prop, &json!([row]), None, 1).unwrap();
            assert_eq!(report.unsupported_count, 1);
            assert_eq!(report.countdowns[0].active, None);
        }
        let mut row = scene("1", false, "0 0 6 27 10 * 2026");
        row["setting"]["enable_timer"] = json!(1);
        assert_eq!(
            project(&device, &prop, &json!([row]), None, 1)
                .unwrap()
                .countdowns[0]
                .active,
            None
        );
        assert!(project(&device, &prop, &Value::Null, None, 1).is_err());
    }
    #[test]
    fn special_calendar_filters_and_extra_actions_cannot_be_shown_as_plain_daily_timers() {
        let (device, prop) = fixture();
        let mut filtered = scene("0", true, "0 0 6 * * * *");
        filtered["setting"]["on_filter"] = json!("china_workday");
        let mut combined = scene("0", true, "0 0 6 * * * *");
        combined["setting"]["on_param"]
            .as_array_mut()
            .unwrap()
            .push(json!({"did":"other-device","siid":17,"piid":9,"value":true}));
        let report = project(&device, &prop, &json!([filtered, combined]), None, 1).unwrap();
        assert!(report.entries.is_empty());
        assert_eq!(report.unsupported_count, 2);
    }
    #[test]
    fn binding_uses_real_property_ids_and_rejects_ambiguous_or_split_panels() {
        let (device, prop) = fixture();
        let mut panel: DevicePanel = serde_json::from_value(json!({"did":device.did,"model":device.model,"specType":"urn:miot-spec-v2:device:outlet:test","services":[{"siid":17,"name":"switch","description":"power","properties":[prop],"actions":[]}]})).unwrap();
        assert_eq!(binding(&device, &panel).unwrap().piid, 9);
        panel.services.push(panel.services[0].clone());
        assert!(binding(&device, &panel).is_none());
        panel.services.pop();
        panel.did = "another".into();
        assert!(binding(&device, &panel).is_none());
        panel.did = device.did.clone();
        let mut split = device.clone();
        split.split_route = Some(crate::models::SplitRoute {
            parent_did: "parent".into(),
            service_iid: 17,
        });
        assert!(binding(&split, &panel).is_none());
    }
    #[test]
    fn absent_preferences_use_marked_defaults_and_malformed_values_stay_unknown() {
        let (device, prop) = fixture();
        let prefs = json!({"test-device":{"prop.s_17.9.offHour":null,"prop.s_17.9.offMinute":null,"prop.s_17.9.onHour":"2","prop.s_17.9.onMinute":"30"}});
        let report = project(&device, &prop, &json!({}), Some(&prefs), 1).unwrap();
        assert_eq!(report.countdowns[0].duration_source, "default");
        assert_eq!(report.countdowns[0].minutes, Some(5));
        assert_eq!(report.countdowns[1].duration_source, "stored");
        assert_eq!(report.countdowns[1].hours, Some(2));
        for value in [
            json!("60"),
            json!(true),
            json!("-1"),
            json!("0.5"),
            json!("[5]"),
        ] {
            let mut invalid = prefs.clone();
            invalid["test-device"]["prop.s_17.9.offMinute"] = value;
            assert_eq!(
                project(&device, &prop, &json!({}), Some(&invalid), 1)
                    .unwrap()
                    .countdowns[0]
                    .duration_source,
                "unknown"
            );
        }
    }
}
