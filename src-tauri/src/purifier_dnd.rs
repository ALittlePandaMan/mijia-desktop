//! Vendor v39 10976 / 11870 / 11771. DND combines a cloud timer and 6/1;
//! neither side alone substitutes for the complete configuration.
use crate::{
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel, Property},
    purifier, timer_write, timers,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub fetched_at: u64,
    pub current: Option<bool>,
    pub enabled: Option<bool>,
    pub all_day: Option<bool>,
    pub start_time: String,
    pub end_time: String,
    pub revision: String,
    pub can_edit: bool,
    pub reason: Option<String>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub revision: String,
    pub enabled: bool,
    pub all_day: bool,
    pub start_time: String,
    pub end_time: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub verified: bool,
    pub message: String,
    pub report: Option<Report>,
}
pub(crate) struct Prepared {
    pub body: Value,
    pub device_value: bool,
}
/// The UI supplies only a revision and semantic settings, never a scene ID or
/// an arbitrary MIoT payload. Disabled timers are retained as in module 11870.
pub(crate) fn prepare(
    device: &Device,
    panel: &DevicePanel,
    scenes: &Value,
    owner: bool,
    change: &Change,
) -> Result<Prepared> {
    let report = project(device, panel, scenes, owner)?;
    if let Some(reason) = report.reason {
        return Err(AppError::new("permissionDenied", reason, false));
    }
    if change.revision != report.revision {
        return Err(AppError::new(
            "dndConflict",
            "勿扰设置已经变化，请重新读取。",
            true,
        ));
    }
    let start = clock(&change.start_time).ok_or_else(|| AppError::invalid("开始时间无效。"))?;
    let end = clock(&change.end_time).ok_or_else(|| AppError::invalid("结束时间无效。"))?;
    if start == end {
        return Err(AppError::invalid("开始时间和结束时间不能相同。"));
    }
    let row = selected_scene(device, scenes)?;
    let mut setting = row
        .map(|r| r["setting"].clone())
        .unwrap_or_else(|| json!({}));
    let value = json!({"timer_type":"0","enable_timer_on":"1","enable_timer_off":"1","enable_timer":if change.enabled && !change.all_day {"1"} else {"0"},"on_time":format!("{} {} * * *",start.1,start.0),"off_time":format!("{} {} * * *",end.1,end.0),"on_method":"set_properties","off_method":"set_properties","on_param":[{"did":device.control_did(),"siid":6,"piid":1,"value":true}],"off_param":[{"did":device.control_did(),"siid":6,"piid":1,"value":false}]});
    for (key, value) in value.as_object().ok_or_else(AppError::protocol)? {
        setting[key] = value.clone();
    }
    Ok(Prepared {
        body: json!({"us_id":row.and_then(timer_write::scene_id).unwrap_or("0".into()),"st_id":8,"identify":"timer","name":row.map(|r|r["name"].clone()).unwrap_or(json!("not_disturb")),"authed":[device.control_did()],"setting":setting}),
        device_value: change.enabled && change.all_day,
    })
}
pub(crate) fn confirmed(device: &Device, scenes: &Value, prepared: &Prepared) -> bool {
    selected_scene(device, scenes)
        .ok()
        .flatten()
        .is_some_and(|row| {
            (prepared.body["us_id"] == "0" || id(&row["us_id"]) == id(&prepared.body["us_id"]))
                && timer_write::matches_settings(row, &prepared.body)
        })
}
pub fn binding<'a>(device: &Device, panel: &'a DevicePanel) -> Option<&'a Property> {
    if device.model != purifier::MODEL
        || panel.model != device.model
        || panel.did != device.did
        || device.split_route.is_some()
        || panel.unsupported_reason.is_some()
    {
        return None;
    }
    let mut props = panel
        .services
        .iter()
        .filter(|s| s.siid == 6 && s.name == "no-disturb")
        .flat_map(|s| &s.properties)
        .filter(|p| {
            p.siid == 6
                && p.piid == 1
                && p.name == "no-disturb"
                && p.format == "bool"
                && p.access.iter().any(|s| s == "read")
        });
    let p = props.next()?;
    props.next().is_none().then_some(p)
}
fn current(device: &Device, panel: &DevicePanel) -> Option<bool> {
    let p = binding(device, panel)?;
    (p.code == Some(0) && p.unsupported_reason.is_none()).then_some(p.value.as_ref()?.as_bool()?)
}
pub fn clock(value: &str) -> Option<(u32, u32)> {
    let b = value.as_bytes();
    if b.len() != 5 || b[2] != b':' || ![0, 1, 3, 4].into_iter().all(|i| b[i].is_ascii_digit()) {
        return None;
    }
    let h = u32::from(b[0] - b'0') * 10 + u32::from(b[1] - b'0');
    let m = u32::from(b[3] - b'0') * 10 + u32::from(b[4] - b'0');
    (h < 24 && m < 60).then_some((h, m))
}
fn cron_time(value: &Value) -> Option<String> {
    let text = value.as_str()?;
    let p = text.split(' ').collect::<Vec<_>>();
    if p.len() != 5 || p[2..] != ["*", "*", "*"] {
        return None;
    }
    let m = p[0].parse::<u32>().ok()?;
    let h = p[1].parse::<u32>().ok()?;
    if h > 23
        || m > 59
        || p[..2]
            .iter()
            .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    Some(format!("{h:02}:{m:02}"))
}
fn touches_binding(row: &Value, device: &Device) -> bool {
    ["on_param", "off_param"].into_iter().any(|k| {
        row["setting"][k].as_array().is_some_and(|a| {
            a.iter()
                .any(|p| id(&p["did"]) == device.control_did() && p["siid"] == 6 && p["piid"] == 1)
        })
    }) || row["name"]
        .as_str()
        .is_some_and(|s| s.contains("not_disturb"))
}
fn valid_scene(row: &Value, device: &Device) -> bool {
    let setting = &row["setting"];
    row["identify"] == "timer"
        && row["name"]
            .as_str()
            .is_some_and(|s| s.len() <= 200 && s.contains("not_disturb"))
        && timer_write::scene_id(row).is_some()
        && setting["timer_type"] == "0"
        && row["authed"]
            .as_array()
            .is_some_and(|a| a.len() == 1 && id(&a[0]) == device.control_did())
        && ["on", "off"].into_iter().all(|prefix| {
            setting[format!("{prefix}_method")] == "set_properties"
                && timers::flag(&setting[format!("enable_timer_{prefix}")]) == Some(true)
                && setting
                    .get(format!("{prefix}_filter"))
                    .is_none_or(|f| f == "")
                && setting[format!("{prefix}_param")]
                    .as_array()
                    .is_some_and(|a| {
                        a.len() == 1
                            && id(&a[0]["did"]) == device.control_did()
                            && a[0]["siid"] == 6
                            && a[0]["piid"] == 1
                            && a[0]["value"] == json!(prefix == "on")
                            && a[0].as_object().is_some_and(|p| {
                                p.keys()
                                    .all(|k| ["did", "siid", "piid", "value"].contains(&k.as_str()))
                            })
                    })
        })
        && timers::flag(&setting["enable_timer"]).is_some()
        && cron_time(&setting["on_time"]).is_some()
        && cron_time(&setting["off_time"]).is_some()
        && cron_time(&setting["on_time"]) != cron_time(&setting["off_time"])
}
pub(crate) fn selected_scene<'a>(device: &Device, scenes: &'a Value) -> Result<Option<&'a Value>> {
    let rows = timers::rows(scenes)?;
    let found = rows
        .into_iter()
        .filter(|r| touches_binding(r, device))
        .collect::<Vec<_>>();
    if found.len() > 1 || found.first().is_some_and(|r| !valid_scene(r, device)) {
        return Err(AppError::new(
            "unsupported",
            "已有无法识别或重复的勿扰定时，请先在米家中检查。",
            true,
        ));
    }
    Ok(found.first().copied())
}
pub fn project(
    device: &Device,
    panel: &DevicePanel,
    scenes: &Value,
    owner: bool,
) -> Result<Report> {
    let prop = binding(device, panel)
        .ok_or_else(|| AppError::new("unsupported", "此型号的勿扰模式绑定尚未确认。", false))?;
    let raw_current = current(device, panel);
    let selected = selected_scene(device, scenes);
    let mut warnings = Vec::new();
    let scene = match selected {
        Ok(s) => s,
        Err(e) => {
            warnings.push(e.message);
            None
        }
    };
    let scheduled = scene
        .and_then(|s| timers::flag(&s["setting"]["enable_timer"]))
        .unwrap_or(false);
    let enabled = if warnings.is_empty() {
        raw_current.map(|v| v || scheduled)
    } else {
        None
    };
    let reason = if !owner {
        Some("共享家庭暂不支持设置勿扰定时。".into())
    } else if device.shared_read_only || !prop.access.iter().any(|a| a == "write") {
        Some("当前权限不允许修改勿扰设置。".into())
    } else if !device.online {
        Some("设备离线，恢复在线后再操作。".into())
    } else if raw_current.is_none() {
        Some("请先读取当前勿扰状态。".into())
    } else {
        warnings.first().cloned()
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(device.did.as_str(), raw_current, scene, &warnings))
                .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: device.did.clone(),
        fetched_at: epoch_secs(),
        current: raw_current,
        enabled,
        all_day: enabled.map(|_| !scheduled),
        start_time: scene
            .and_then(|s| cron_time(&s["setting"]["on_time"]))
            .unwrap_or("23:00".into()),
        end_time: scene
            .and_then(|s| cron_time(&s["setting"]["off_time"]))
            .unwrap_or("07:00".into()),
        revision,
        can_edit: reason.is_none(),
        reason,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> (Device, DevicePanel) {
        let panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/purifier-panel.json")).unwrap();
        let device=serde_json::from_value(json!({"did":panel.did,"model":panel.model,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap();
        (device, panel)
    }
    fn change(report: &Report) -> Change {
        Change {
            revision: report.revision.clone(),
            enabled: true,
            all_day: false,
            start_time: "23:00".into(),
            end_time: "07:00".into(),
        }
    }
    fn saved(prepared: &Prepared) -> Value {
        let mut body = prepared.body.clone();
        body["us_id"] = json!("1234");
        body
    }
    #[test]
    fn scheduled_all_day_and_disabled_preserve_the_two_part_protocol() {
        let (d, p) = context();
        let empty = json!([]);
        let report = project(&d, &p, &empty, true).unwrap();
        let mut c = change(&report);
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        assert!(!plan.device_value);
        assert_eq!(plan.body["setting"]["on_time"], "0 23 * * *");
        assert_eq!(plan.body["setting"]["off_time"], "0 7 * * *");
        assert_eq!(plan.body["setting"]["enable_timer"], "1");
        assert_eq!(plan.body["setting"]["on_param"][0]["siid"], 6);
        let row = saved(&plan);
        let scenes = json!([row]);
        assert!(confirmed(&d, &scenes, &plan));
        let r = project(&d, &p, &scenes, true).unwrap();
        assert_eq!(r.enabled, Some(true));
        assert_eq!(r.all_day, Some(false));
        c.revision = r.revision;
        c.all_day = true;
        let all = prepare(&d, &p, &scenes, true, &c).unwrap();
        assert!(all.device_value);
        assert_eq!(all.body["setting"]["enable_timer"], "0");
        assert_eq!(all.body["us_id"], "1234");
        c.enabled = false;
        let off = prepare(&d, &p, &scenes, true, &c).unwrap();
        assert!(!off.device_value);
        assert_eq!(off.body["setting"]["enable_timer"], "0");
    }
    #[test]
    fn conflicts_unknown_scenes_and_unread_values_never_authorize() {
        let (d, mut p) = context();
        let empty = json!([]);
        let report = project(&d, &p, &empty, true).unwrap();
        let mut c = change(&report);
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        let row = saved(&plan);
        assert!(prepare(&d, &p, &json!([row.clone()]), true, &c).is_err());
        assert!(
            !project(&d, &p, &json!([row.clone(), row.clone()]), true)
                .unwrap()
                .can_edit
        );
        let mut unknown = row.clone();
        unknown["setting"]["on_filter"] = json!("unknown");
        assert!(!project(&d, &p, &json!([unknown]), true).unwrap().can_edit);
        let mut other = row.clone();
        other["name"] = json!("other");
        other["setting"]["on_param"][0]["piid"] = json!(2);
        other["setting"]["off_param"][0]["piid"] = json!(2);
        assert!(project(&d, &p, &json!([other]), true).unwrap().can_edit);
        assert!(prepare(&d, &p, &empty, false, &c).is_err());
        c.end_time = c.start_time.clone();
        assert!(prepare(&d, &p, &empty, true, &c).is_err());
        c.end_time = "07:00".into();
        c.start_time = "24:00".into();
        assert!(prepare(&d, &p, &empty, true, &c).is_err());
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|v| v.siid == 6 && v.piid == 1)
            .unwrap()
            .code = None;
        assert!(!project(&d, &p, &empty, true).unwrap().can_edit);
    }
    #[test]
    fn confirmation_requires_identity_unique_scene_and_every_target_field() {
        let (d, p) = context();
        let empty = json!([]);
        let c = change(&project(&d, &p, &empty, true).unwrap());
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        let row = saved(&plan);
        let mut wrong = row.clone();
        wrong["setting"]["off_time"] = json!("1 7 * * *");
        assert!(!confirmed(&d, &json!([wrong]), &plan));
        let mut booleans = row.clone();
        for k in ["enable_timer", "enable_timer_on", "enable_timer_off"] {
            booleans["setting"][k] = json!(true);
        }
        assert!(confirmed(&d, &json!([booleans]), &plan));
        assert!(!confirmed(&d, &json!([row.clone(), row]), &plan));
        for s in ["7:00", "-1:00", "12:60", "12:3a", "00:00x"] {
            assert!(clock(s).is_none());
        }
    }
}
