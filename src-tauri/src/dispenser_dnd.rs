//! gxj v29 appointment10853 / page11777 / clocks11087, plus APK SDK10032.
//! Cloud schedule and actual 5/1 state are independent confirmation surfaces.
pub use crate::purifier_dnd::{clock, Change, ChangeResult, Report};
use crate::{
    dispenser, dispenser_config,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel, Property},
    timer_write, timers,
};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub(crate) struct Prepared {
    pub body: Option<Value>,
    pub device_value: bool,
}
pub fn binding<'a>(device: &Device, panel: &'a DevicePanel) -> Option<&'a Property> {
    if device.model != dispenser::MODEL || panel.did != device.did || device.split_route.is_some() {
        return None;
    }
    let p = dispenser_config::property(panel, 5, 1, "no-disturb", "bool")?;
    p.access.iter().any(|s| s == "read").then_some(p)
}
fn current(device: &Device, panel: &DevicePanel) -> Option<bool> {
    let p = binding(device, panel)?;
    (p.code == Some(0)).then_some(())?;
    p.value.as_ref()?.as_bool()
}
fn cron(v: &Value) -> Option<String> {
    let p = v.as_str()?.split(' ').collect::<Vec<_>>();
    if p.len() != 5
        || p[2..] != ["*", "*", "*"]
        || p[..2]
            .iter()
            .any(|s| s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()))
    {
        return None;
    }
    let m = p[0].parse::<u8>().ok()?;
    let h = p[1].parse::<u8>().ok()?;
    (m < 60 && h < 24).then(|| format!("{h:02}:{m:02}"))
}
fn touches(r: &Value, d: &Device) -> bool {
    r["identify"] == "not_disturb"
        || ["on_param", "off_param"].into_iter().any(|k| {
            r["setting"][k].as_array().is_some_and(|a| {
                a.iter()
                    .any(|p| id(&p["did"]) == d.control_did() && p["siid"] == 5 && p["piid"] == 1)
            })
        })
}
fn valid(r: &Value, d: &Device) -> bool {
    let s = &r["setting"];
    r["identify"] == "not_disturb"
        && timer_write::scene_id(r).is_some()
        && r["authed"]
            .as_array()
            .is_some_and(|a| a.len() == 1 && id(&a[0]) == d.control_did())
        && s["timer_type"] == "0"
        && timers::flag(&s["enable_timer"]).is_some()
        && cron(&s["on_time"]).is_some()
        && cron(&s["off_time"]).is_some()
        && cron(&s["on_time"]) != cron(&s["off_time"])
        && ["on", "off"].into_iter().all(|prefix| {
            s[format!("{prefix}_method")] == "set_properties"
                && timers::flag(&s[format!("enable_timer_{prefix}")]) == Some(true)
                && s.get(format!("{prefix}_filter")).is_none_or(|v| v == "")
                && s[format!("{prefix}_param")].as_array().is_some_and(|a| {
                    a.len() == 1
                        && id(&a[0]["did"]) == d.control_did()
                        && a[0]["siid"] == 5
                        && a[0]["piid"] == 1
                        && a[0]["value"] == json!(prefix == "on")
                        && a[0].as_object().is_some_and(|p| {
                            p.keys()
                                .all(|k| ["did", "siid", "piid", "value"].contains(&k.as_str()))
                        })
                })
        })
}
fn selected<'a>(d: &Device, scenes: &'a Value) -> Result<Option<&'a Value>> {
    let found = timers::rows(scenes)?
        .into_iter()
        .filter(|r| touches(r, d))
        .collect::<Vec<_>>();
    if found.len() > 1 || found.first().is_some_and(|r| !valid(r, d)) {
        return Err(AppError::new(
            "unsupported",
            "已有无法识别或重复的勿扰定时，请先在米家中检查。",
            true,
        ));
    }
    Ok(found.first().copied())
}
pub fn project(d: &Device, p: &DevicePanel, scenes: &Value, owner: bool) -> Result<Report> {
    let prop = binding(d, p)
        .ok_or_else(|| AppError::new("unsupported", "此型号的勿扰绑定尚未核实。", false))?;
    let now = current(d, p);
    let mut warnings = Vec::new();
    let row = match selected(d, scenes) {
        Ok(row) => row,
        Err(e) => {
            warnings.push(e.message);
            None
        }
    };
    let scheduled = row
        .and_then(|r| timers::flag(&r["setting"]["enable_timer"]))
        .unwrap_or(false);
    let enabled = if warnings.is_empty() {
        now.map(|v| v || scheduled)
    } else {
        None
    };
    let reason = if !owner {
        Some("共享家庭暂不支持修改勿扰定时。".into())
    } else if d.shared_read_only || !prop.access.iter().any(|a| a == "write") {
        Some("当前权限不允许修改勿扰设置。".into())
    } else if !d.online {
        Some("设备离线，恢复在线后再操作。".into())
    } else if now.is_none() {
        Some("请先读取当前勿扰状态。".into())
    } else {
        warnings.first().cloned()
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(d.did.as_str(), now, row, &warnings))
                .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: d.did.clone(),
        fetched_at: epoch_secs(),
        current: now,
        enabled,
        all_day: enabled.map(|_| !scheduled),
        start_time: row
            .and_then(|r| cron(&r["setting"]["on_time"]))
            .unwrap_or("22:00".into()),
        end_time: row
            .and_then(|r| cron(&r["setting"]["off_time"]))
            .unwrap_or("07:00".into()),
        revision,
        can_edit: reason.is_none(),
        reason,
        warnings,
    })
}
pub(crate) fn prepare(
    d: &Device,
    p: &DevicePanel,
    scenes: &Value,
    owner: bool,
    c: &Change,
) -> Result<Prepared> {
    let r = project(d, p, scenes, owner)?;
    if let Some(reason) = r.reason {
        return Err(AppError::new("permissionDenied", reason, false));
    }
    if r.revision != c.revision {
        return Err(AppError::new(
            "dndConflict",
            "勿扰设置已经变化，请重新读取。",
            true,
        ));
    }
    let start = clock(&c.start_time).ok_or_else(|| AppError::invalid("开始时间无效。"))?;
    let end = clock(&c.end_time).ok_or_else(|| AppError::invalid("结束时间无效。"))?;
    if start == end {
        return Err(AppError::invalid("开始时间和结束时间不能相同。"));
    }
    let row = selected(d, scenes)?;
    let enabled = c.enabled && !c.all_day;
    let body = if row.is_none() && !enabled {
        None
    } else {
        let mut setting = row
            .map(|r| r["setting"].clone())
            .unwrap_or_else(|| json!({}));
        let values = json!({"identify":"not_disturb","timer_type":"0","enable_timer_on":"1","enable_timer_off":"1","enable_timer":if enabled{"1"}else{"0"},"on_time":format!("{} {} * * *",start.1,start.0),"off_time":format!("{} {} * * *",end.1,end.0),"on_method":"set_properties","off_method":"set_properties","on_param":[{"did":d.control_did(),"siid":5,"piid":1,"value":true}],"off_param":[{"did":d.control_did(),"siid":5,"piid":1,"value":false}],"on_filter":"","off_filter":""});
        for (k, v) in values.as_object().ok_or_else(AppError::protocol)? {
            setting[k] = v.clone();
        }
        Some(
            json!({"us_id":row.and_then(timer_write::scene_id).unwrap_or("0".into()),"st_id":8,"identify":"not_disturb","name":row.map(|r|r["name"].clone()).unwrap_or(json!("")),"authed":[d.control_did()],"setting":setting}),
        )
    };
    Ok(Prepared {
        body,
        device_value: c.enabled && c.all_day,
    })
}
pub(crate) fn confirmed(d: &Device, scenes: &Value, prepared: &Prepared) -> bool {
    match (&prepared.body, selected(d, scenes)) {
        (None, Ok(None)) => true,
        (Some(body), Ok(Some(row))) => {
            (body["us_id"] == "0" || id(&row["us_id"]) == id(&body["us_id"]))
                && timer_write::matches_settings(row, body)
        }
        _ => false,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn context() -> (Device, DevicePanel) {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        p.did = "123".into();
        let q = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 5 && p.piid == 1)
            .unwrap();
        q.value = Some(json!(false));
        q.code = Some(0);
        let d=serde_json::from_value(json!({"did":"123","model":p.model,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap();
        (d, p)
    }
    fn change(r: &Report) -> Change {
        Change {
            revision: r.revision.clone(),
            enabled: true,
            all_day: false,
            start_time: "22:00".into(),
            end_time: "07:00".into(),
        }
    }
    fn saved(p: &Prepared) -> Value {
        let mut row = p.body.clone().unwrap();
        row["us_id"] = json!("1234");
        row
    }
    #[test]
    fn distinct_native_identifier_default_clock_and_two_part_custom_plan() {
        let (d, p) = context();
        let empty = json!([]);
        let r = project(&d, &p, &empty, true).unwrap();
        assert_eq!(r.start_time, "22:00");
        assert_eq!(r.enabled, Some(false));
        let plan = prepare(&d, &p, &empty, true, &change(&r)).unwrap();
        assert!(!plan.device_value);
        let b = plan.body.as_ref().unwrap();
        assert_eq!(b["identify"], "not_disturb");
        assert_eq!(b["setting"]["on_param"][0]["siid"], 5);
        assert_eq!(b["setting"]["on_time"], "0 22 * * *");
        assert!(confirmed(&d, &json!([saved(&plan)]), &plan));
    }
    #[test]
    fn all_day_without_timer_does_not_create_a_cloud_record() {
        let (d, p) = context();
        let empty = json!([]);
        let mut c = change(&project(&d, &p, &empty, true).unwrap());
        c.all_day = true;
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        assert!(plan.body.is_none());
        assert!(plan.device_value);
        assert!(confirmed(&d, &empty, &plan));
        c.enabled = false;
        assert!(!prepare(&d, &p, &empty, true, &c).unwrap().device_value);
    }
    #[test]
    fn disabling_preserves_existing_timer_and_unknown_metadata() {
        let (d, p) = context();
        let empty = json!([]);
        let plan = prepare(
            &d,
            &p,
            &empty,
            true,
            &change(&project(&d, &p, &empty, true).unwrap()),
        )
        .unwrap();
        let mut row = saved(&plan);
        row["setting"]["vendor_metadata"] = json!({"x":1});
        let scenes = json!([row]);
        let mut c = change(&project(&d, &p, &scenes, true).unwrap());
        c.enabled = false;
        let off = prepare(&d, &p, &scenes, true, &c).unwrap();
        assert_eq!(off.body.as_ref().unwrap()["us_id"], "1234");
        assert_eq!(
            off.body.as_ref().unwrap()["setting"]["vendor_metadata"],
            json!({"x":1})
        );
        assert_eq!(off.body.as_ref().unwrap()["setting"]["enable_timer"], "0");
        assert!(!off.device_value);
    }
    #[test]
    fn rejects_conflicts_duplicates_and_foreign_effects() {
        let (d, p) = context();
        let empty = json!([]);
        let c = change(&project(&d, &p, &empty, true).unwrap());
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        let row = saved(&plan);
        assert!(prepare(&d, &p, &json!([row.clone()]), true, &c).is_err());
        assert!(
            !project(&d, &p, &json!([row.clone(), row.clone()]), true)
                .unwrap()
                .can_edit
        );
        for (key, value) in [
            ("on_filter", json!("cn_workday")),
            ("on_method", json!("action")),
            ("enable_timer_on", json!(false)),
        ] {
            let mut wrong = row.clone();
            wrong["setting"][key] = value;
            assert!(!project(&d, &p, &json!([wrong]), true).unwrap().can_edit);
        }
        let mut wrong = row;
        wrong["authed"] = json!(["456"]);
        assert!(!project(&d, &p, &json!([wrong]), true).unwrap().can_edit);
    }
    #[test]
    fn unread_permissions_bad_clocks_and_partial_confirmation_never_succeed() {
        let (d, mut p) = context();
        let empty = json!([]);
        let mut c = change(&project(&d, &p, &empty, true).unwrap());
        assert!(prepare(&d, &p, &empty, false, &c).is_err());
        let plan = prepare(&d, &p, &empty, true, &c).unwrap();
        let mut wrong = saved(&plan);
        wrong["setting"]["off_time"] = json!("1 7 * * *");
        assert!(!confirmed(&d, &json!([wrong]), &plan));
        c.end_time = c.start_time.clone();
        assert!(prepare(&d, &p, &empty, true, &c).is_err());
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 5 && p.piid == 1)
            .unwrap()
            .code = Some(-1);
        assert!(!project(&d, &p, &empty, true).unwrap().can_edit);
    }
}
