//! APK 14891 countdown scenes and 10058 JSON-encoded duration preferences.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::*,
    timer_write, timers,
};
use chrono::{DateTime, Datelike, FixedOffset, Timelike};
use serde_json::{json, Value};
use std::time::Duration;

pub(crate) fn validate(change: &CountdownChange) -> Result<()> {
    let key = match change {
        CountdownChange::Set {
            key,
            hours,
            minutes,
            ..
        } => {
            if *hours > 23 || *minutes > 59 || *hours == 0 && *minutes == 0 {
                return Err(AppError::invalid("延迟时间必须为1分钟至23小时59分钟。"));
            }
            key.as_ref()
        }
        CountdownChange::Cancel { key, .. } => Some(key),
    };
    if let Some(key) = key {
        timer_write::validate(&TimerChange::Delete { key: key.clone() })?;
    }
    Ok(())
}
fn direction(change: &CountdownChange) -> bool {
    match change {
        CountdownChange::Set { on, .. } | CountdownChange::Cancel { on, .. } => *on,
    }
}
pub(crate) fn editable(device: &Device, prop: &Property, row: &Value) -> bool {
    let setting = &row["setting"];
    let on = timers::flag(&setting["enable_timer_on"]);
    let off = timers::flag(&setting["enable_timer_off"]);
    let Some(on) = on.filter(|on| off == Some(!on)) else {
        return false;
    };
    timer_write::binding_matches(device, row)
        && row["identify"]
            == format!(
                "{}.{}.{}",
                if on { "on" } else { "off" },
                prop.siid,
                prop.piid
            )
        && setting["timer_type"] == "1"
        && timers::flag(&setting["enable_timer"]).is_some()
        && [true, false]
            .into_iter()
            .all(|on| timers::matches_param(setting, on, device, prop))
        && setting["on_time"] == setting["off_time"]
        && timers::absolute_time(&setting["on_time"]).is_some()
        && ["on_filter", "off_filter"]
            .into_iter()
            .all(|key| matches!(setting[key].as_str(), Some("" | "support_second")))
}
pub(crate) fn prepare(
    device: &Device,
    panel: &DevicePanel,
    scenes: &Value,
    change: &CountdownChange,
    now: u64,
) -> Result<timer_write::Prepared> {
    validate(change)?;
    let prop = timers::binding(device, panel)
        .ok_or_else(|| AppError::new("unsupported", "此型号的倒计时尚未接入。", false))?;
    let on = direction(change);
    let report = timers::project(device, prop, scenes, None, now)?;
    let view = report
        .countdowns
        .iter()
        .find(|view| view.on == on)
        .ok_or_else(AppError::protocol)?;
    if view.active.is_none() || view.write_reason.is_some() {
        return Err(AppError::new(
            "unsupported",
            view.write_reason
                .clone()
                .unwrap_or("倒计时状态尚未确认，请先重新读取。".into()),
            false,
        ));
    }
    let key = match change {
        CountdownChange::Set { key, .. } => key.as_ref(),
        CountdownChange::Cancel { key, .. } => Some(key),
    };
    // A missing key is a create precondition, never permission to overwrite a
    // timer another client created after this UI loaded.
    if key != view.key.as_ref() {
        return Err(AppError::new(
            "timerConflict",
            "倒计时记录已经变化，请重新读取。",
            true,
        ));
    }
    let row = key
        .map(|key| {
            timers::rows(scenes)?
                .into_iter()
                .find(|row| timers::scene_key(device, row) == *key)
                .ok_or_else(|| {
                    AppError::new("timerConflict", "倒计时记录已经变化，请重新读取。", true)
                })
        })
        .transpose()?;
    let original_id = row.and_then(timer_write::scene_id);
    if matches!(change, CountdownChange::Cancel { .. }) {
        return Ok(timer_write::Prepared {
            body: json!({"us_id":[original_id.as_ref().ok_or_else(AppError::stale)?]}),
            delete: true,
            original_id,
        });
    }
    let CountdownChange::Set { hours, minutes, .. } = change else {
        unreachable!()
    };
    let due = now
        .checked_add(u64::from(*hours) * 3600 + u64::from(*minutes) * 60)
        .ok_or_else(AppError::protocol)?;
    let date = DateTime::from_timestamp(i64::try_from(due).map_err(|_| AppError::protocol())?, 0)
        .ok_or_else(AppError::protocol)?
        .with_timezone(&FixedOffset::east_opt(8 * 3600).unwrap());
    let cron = format!(
        "{} {} {} {} {} * {}",
        date.second(),
        date.minute(),
        date.hour(),
        date.day(),
        date.month(),
        date.year()
    );
    let mut setting=row.map(|row|row["setting"].clone()).unwrap_or_else(||json!({"on_method":"set_properties","off_method":"set_properties","on_param":[{"did":device.control_did(),"siid":prop.siid,"piid":prop.piid,"value":true}],"off_param":[{"did":device.control_did(),"siid":prop.siid,"piid":prop.piid,"value":false}]}));
    for (key, value) in [
        ("timer_type", json!("1")),
        ("enable_timer", json!(true)),
        ("enable_timer_on", json!(on)),
        ("enable_timer_off", json!(!on)),
        ("on_time", json!(cron)),
        ("off_time", json!(cron)),
        ("on_filter", json!("support_second")),
        ("off_filter", json!("support_second")),
    ] {
        setting[key] = value;
    }
    let body = json!({"us_id":original_id.as_deref().unwrap_or("0"),"st_id":8,"identify":format!("{}.{}.{}",if on{"on"}else{"off"},prop.siid,prop.piid),"name":row.map(|row|row["name"].clone()).filter(Value::is_string).unwrap_or(json!(format!("{}-延时{}",device.name,if on{"开启"}else{"关闭"}))),"authed":[device.control_did()],"setting":setting});
    Ok(timer_write::Prepared {
        body,
        delete: false,
        original_id,
    })
}
pub(crate) fn preference_body(
    device: &Device,
    prop: &Property,
    on: bool,
    hours: u32,
    minutes: u32,
) -> Value {
    let prefix = format!(
        "prop.s_{}.{}.{}",
        prop.siid,
        prop.piid,
        if on { "on" } else { "off" }
    );
    json!([{"did":device.control_did(),"props":{format!("{prefix}Hour"):hours.to_string(),format!("{prefix}Minute"):minutes.to_string()}}])
}
/// Called only after scene readback and a second AppState context check. Write
/// once, then read independently even when the write response is lost.
pub(crate) async fn save_preferences(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
    on: bool,
    hours: u32,
    minutes: u32,
) -> Result<Option<TimerReport>> {
    let prop = timers::binding(device, panel).ok_or_else(AppError::stale)?;
    if let Err(error) = cloud
        .set_timer_preferences(device, preference_body(device, prop, on, hours, minutes))
        .await
    {
        if error.kind == "authExpired" {
            return Err(error);
        }
    }
    for delay in [200, 600, 1200] {
        tokio::time::sleep(Duration::from_millis(delay)).await;
        let report =
            match tokio::time::timeout(Duration::from_secs(6), timers::load(cloud, device, panel))
                .await
            {
                Ok(Ok(report)) => report,
                Ok(Err(error)) if error.kind == "authExpired" => return Err(error),
                _ => continue,
            };
        if report.countdowns.iter().any(|view| {
            view.on == on
                && view.hours == Some(hours)
                && view.minutes == Some(minutes)
                && view.duration_source == "stored"
        }) {
            return Ok(Some(report));
        }
    }
    Ok(None)
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
    fn change() -> CountdownChange {
        CountdownChange::Set {
            on: false,
            key: None,
            hours: 0,
            minutes: 5,
        }
    }
    fn now() -> u64 {
        FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 12, 31, 23, 59, 37)
            .unwrap()
            .timestamp() as u64
    }
    fn row(device: &Device, panel: &DevicePanel) -> Value {
        let mut row = prepare(device, panel, &json!([]), &change(), now())
            .unwrap()
            .body;
        row["us_id"] = json!("123");
        row
    }
    #[test]
    fn seconds_year_rollover_and_real_binding() {
        let (d, p) = context();
        let prepared = prepare(&d, &p, &json!([]), &change(), now()).unwrap();
        assert_eq!(prepared.body["identify"], "off.17.9");
        assert_eq!(prepared.body["setting"]["off_time"], "37 4 0 1 1 * 2027");
        assert_eq!(prepared.body["setting"]["on_param"][0]["siid"], 17);
        assert_eq!(
            timers::absolute_time(&prepared.body["setting"]["off_time"]),
            Some(now() + 300)
        );
    }
    #[test]
    fn stale_create_and_changed_record_cannot_overwrite() {
        let (d, p) = context();
        let row = row(&d, &p);
        let scenes = json!([row]);
        assert_eq!(
            prepare(&d, &p, &scenes, &change(), now())
                .err()
                .unwrap()
                .kind,
            "timerConflict"
        );
        let key = timers::scene_key(&d, &row);
        let update = CountdownChange::Set {
            on: false,
            key: Some(key),
            hours: 1,
            minutes: 0,
        };
        let mut changed = row.clone();
        changed["setting"]["extra"] = json!(true);
        assert_eq!(
            prepare(&d, &p, &json!([changed]), &update, now())
                .err()
                .unwrap()
                .kind,
            "timerConflict"
        );
    }
    #[test]
    fn cancellation_is_exact_and_preserves_other_scenes() {
        let (d, p) = context();
        let row = row(&d, &p);
        let key = timers::scene_key(&d, &row);
        let prepared = prepare(
            &d,
            &p,
            &json!([row]),
            &CountdownChange::Cancel { on: false, key },
            now(),
        )
        .unwrap();
        assert!(prepared.delete);
        assert_eq!(prepared.body, json!({"us_id":["123"]}));
    }
    #[test]
    fn duration_and_foreign_inactive_binding_are_rejected() {
        let (d, p) = context();
        for (hours, minutes) in [(0, 0), (24, 0), (0, 60)] {
            assert!(validate(&CountdownChange::Set {
                on: true,
                key: None,
                hours,
                minutes
            })
            .is_err());
        }
        let prop = timers::binding(&d, &p).unwrap();
        let mut row = row(&d, &p);
        row["setting"]["on_param"][0]["piid"] = json!(100);
        assert!(!editable(&d, prop, &row));
        let key = timers::scene_key(&d, &row);
        assert!(prepare(
            &d,
            &p,
            &json!([row]),
            &CountdownChange::Cancel { on: false, key },
            now()
        )
        .is_err());
    }
    #[test]
    fn preferences_are_json_encoded_and_direction_specific() {
        let (d, p) = context();
        let prop = timers::binding(&d, &p).unwrap();
        assert_eq!(
            preference_body(&d, prop, true, 2, 7),
            json!([{"did":"test-device","props":{"prop.s_17.9.onHour":"2","prop.s_17.9.onMinute":"7"}}])
        );
    }
}
