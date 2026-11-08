//! Current-state projection and runtime control bindings from standard washer
//! 16745/16736/17384 and the authenticated MIoT schema. No historical fallback.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStep {
    pub id: u32,
    pub label: String,
    pub progress: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeControl {
    pub key: String,
    pub label: String,
    pub kind: String,
    pub siid: u32,
    pub piid: Option<u32>,
    pub aiid: Option<u32>,
    pub value: Option<Value>,
    pub enabled: bool,
    pub reason: Option<String>,
    pub confirmation: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub state: String,
    pub active: bool,
    pub mode: Option<i64>,
    pub stage: Option<String>,
    pub remaining_minutes: Option<u32>,
    pub reservation_minutes: Option<u32>,
    pub weighing: bool,
    pub has_drying: bool,
    pub cleaning: bool,
    pub locked: Option<bool>,
    pub steps: Vec<RuntimeStep>,
    pub controls: Vec<RuntimeControl>,
}
fn property<'a>(panel: &'a DevicePanel, service: &str, name: &str) -> Option<&'a Property> {
    let mut props = panel
        .services
        .iter()
        .filter(|s| s.name == service)
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == name);
    let p = props.next()?;
    if props.next().is_some() {
        None
    } else {
        Some(p)
    }
}
fn live<'a>(panel: &'a DevicePanel, service: &str, name: &str) -> Option<&'a Value> {
    let p = property(panel, service, name)?;
    if p.code != Some(0) || !p.access.iter().any(|a| a == "read") {
        return None;
    }
    let value = p.value.as_ref()?;
    spec::validate_value(p, value).ok()?;
    Some(value)
}
fn meaning(panel: &DevicePanel, name: &str) -> Option<String> {
    let p = property(panel, "washer", name)?;
    let value = live(panel, "washer", name)?;
    let mut rows = p
        .value_list
        .as_ref()?
        .iter()
        .filter(|v| spec::values_equal(&v.value, value));
    let row = rows.next()?;
    if rows.next().is_some() {
        None
    } else {
        Some(row.description.trim().to_lowercase())
    }
}
fn number(panel: &DevicePanel, service: &str, name: &str) -> Option<u32> {
    u32::try_from(live(panel, service, name)?.as_u64()?).ok()
}
fn label(meaning: &str) -> &str {
    match meaning {
        "performing scheduled task" => "预约",
        "weighing" => "称重",
        "steam sterilization" => "蒸汽除菌",
        "soaking" => "浸泡",
        "washing" => "洗涤",
        "rinsing" => "漂洗",
        "anti-crease soaking" => "防皱浸泡",
        "spinning" => "脱水",
        "drying" => "烘干",
        "cooling after drying" => "烘干冷却",
        "waiting blow and shake" => "等待吹风抖散",
        "blowing and shaking" => "吹风抖散",
        "prewashing" => "预洗",
        "clothing care" => "衣物护理",
        "washing completed" => "洗涤完成",
        _ => meaning,
    }
}
fn reason(panel: &DevicePanel, lock_control: bool) -> Option<String> {
    if property(panel, "dryer-channel-clean", "clean-lefttime").is_some()
        && number(panel, "dryer-channel-clean", "clean-lefttime").is_none()
    {
        return Some("风道清洁状态尚未确认，请重新读取。".into());
    }
    if meaning(panel, "fault").as_deref() != Some("no faults") {
        return Some("故障状态尚未确认或设备存在故障。".into());
    }
    let child = live(panel, "washer", "child-protected-enabled").and_then(Value::as_bool);
    if child.is_none()
        || child == Some(true)
            && live(panel, "washer", "child-protected-status").and_then(Value::as_bool)
                != Some(true)
    {
        return Some("儿童安全状态尚未确认，请先在设备上检查。".into());
    }
    if !lock_control
        && live(
            panel,
            "physical-controls-locked",
            "physical-controls-locked",
        )
        .and_then(Value::as_bool)
            != Some(false)
    {
        return Some("请先确认并解除童锁。".into());
    }
    None
}
fn action(
    panel: &DevicePanel,
    service: &str,
    name: &str,
    key: &str,
    text: &str,
    confirm: Option<&str>,
) -> Option<RuntimeControl> {
    let mut rows = panel
        .services
        .iter()
        .filter(|s| s.name == service)
        .flat_map(|s| &s.actions)
        .filter(|a| a.name == name && a.inputs.is_empty() && a.unsupported_reason.is_none());
    let a = rows.next()?;
    if rows.next().is_some() {
        return None;
    }
    let reason = reason(panel, false);
    Some(RuntimeControl {
        key: key.into(),
        label: text.into(),
        kind: "action".into(),
        siid: a.siid,
        piid: None,
        aiid: Some(a.aiid),
        value: None,
        enabled: reason.is_none(),
        reason,
        confirmation: confirm.map(str::to_owned),
    })
}
fn control_property(
    panel: &DevicePanel,
    service: &str,
    name: &str,
    key: &str,
    text: &str,
    value: Value,
    confirm: Option<&str>,
) -> Option<RuntimeControl> {
    let p = property(panel, service, name)?;
    if !p.access.iter().any(|a| a == "write")
        || p.unsupported_reason.is_some()
        || spec::validate_value(p, &value).is_err()
    {
        return None;
    }
    let reason = reason(panel, key == "lock").or_else(|| {
        live(panel, service, name)
            .is_none()
            .then(|| "当前属性尚未确认，请重新读取。".into())
    });
    Some(RuntimeControl {
        key: key.into(),
        label: text.into(),
        kind: "property".into(),
        siid: p.siid,
        piid: Some(p.piid),
        aiid: None,
        value: Some(value),
        enabled: reason.is_none(),
        reason,
        confirmation: confirm.map(str::to_owned),
    })
}
pub fn snapshot(panel: &DevicePanel) -> Option<RuntimeSnapshot> {
    if panel.model != crate::washer::MODEL {
        return None;
    }
    let state = meaning(panel, "status").unwrap_or_else(|| "unknown".into());
    let cleaning = number(panel, "dryer-channel-clean", "clean-lefttime").is_some_and(|v| v > 0);
    let mode = live(panel, "washer", "mode").and_then(Value::as_i64);
    let stage = meaning(panel, "run-status");
    // Detail 16745 returns to the home for the separate blow/shake workflow.
    let active = cleaning
        || stage.as_deref() != Some("blowing and shaking")
            && matches!(state.as_str(), "busy" | "paused" | "delay" | "completed");
    let mask = number(panel, "washer", "run-status-list");
    let phases = property(panel, "washer", "run-status")
        .and_then(|p| p.value_list.as_ref())
        .map(|rows| {
            let mut rows = rows
                .iter()
                .filter_map(|r| {
                    let id = u32::try_from(r.value.as_u64()?).ok()?;
                    if id == 0 || id >= 32 || mask? & (1u32 << id) == 0 {
                        return None;
                    }
                    Some((id, r.description.trim().to_lowercase()))
                })
                .collect::<Vec<_>>();
            rows.sort_by_key(|r| r.0);
            rows
        })
        .unwrap_or_default();
    let current = phases
        .iter()
        .position(|(_, meaning)| Some(meaning) == stage.as_ref());
    let steps = if matches!(state.as_str(), "busy" | "paused" | "delay") && !cleaning {
        phases
            .iter()
            .enumerate()
            .map(|(i, (id, meaning))| RuntimeStep {
                id: *id,
                label: label(meaning).into(),
                progress: if state == "delay" {
                    "pending"
                } else if current == Some(i) {
                    "current"
                } else if current.is_some_and(|n| i < n) {
                    "done"
                } else {
                    "pending"
                }
                .into(),
            })
            .collect()
    } else {
        Vec::new()
    };
    let locked = live(
        panel,
        "physical-controls-locked",
        "physical-controls-locked",
    )
    .and_then(Value::as_bool);
    let mut controls = Vec::new();
    if matches!(state.as_str(), "busy" | "paused") {
        if let Some(c) = if cleaning {
            action(
                panel,
                "dryer-channel-clean",
                "clean-dryer-stop",
                "stop",
                "终止",
                Some("确定要终止风道清洁吗？"),
            )
        } else {
            action(
                panel,
                "washer",
                "stop-washing",
                "stop",
                "终止",
                Some("确定要终止洗涤吗？"),
            )
        } {
            controls.push(c);
        }
        if let Some(c) = if state == "busy" {
            action(panel, "washer", "pause", "pause", "暂停", None)
        } else {
            action(panel, "washer", "start-wash", "resume", "继续", None)
        } {
            controls.push(c);
        }
        if state == "busy" && !cleaning {
            if let Some(value) = locked {
                if let Some(c) = control_property(
                    panel,
                    "physical-controls-locked",
                    "physical-controls-locked",
                    "lock",
                    "童锁",
                    json!(!value),
                    None,
                ) {
                    controls.push(c);
                }
            }
        }
    } else if state == "delay" {
        // Standard interceptor 15293 cancelDelay proxies washer.on -> false.
        if let Some(c) = control_property(
            panel,
            "washer",
            "on",
            "cancel",
            "取消预约",
            json!(false),
            Some("确定要取消预约吗？"),
        ) {
            controls.push(c);
        }
    } else if state == "completed"
        && live(panel, "washer", "on").and_then(Value::as_bool) == Some(true)
    {
        if let Some(c) = control_property(panel, "washer", "on", "off", "关机", json!(false), None)
        {
            controls.push(c);
        }
    }
    Some(RuntimeSnapshot {
        state,
        active,
        mode,
        stage: stage.clone(),
        remaining_minutes: if cleaning {
            number(panel, "dryer-channel-clean", "clean-lefttime")
        } else {
            number(panel, "washer", "left-time")
        },
        reservation_minutes: number(panel, "washer", "reservation-left-time"),
        weighing: stage.as_deref() == Some("weighing")
            && meaning(panel, "mode").as_deref() == Some("smart"),
        has_drying: phases.iter().any(|(_, s)| s == "drying"),
        cleaning,
        locked,
        steps,
        controls,
    })
}
pub fn refresh(panel: &mut DevicePanel) {
    panel.washer_runtime = snapshot(panel);
}
pub fn validate_action(
    panel: &DevicePanel,
    siid: u32,
    aiid: u32,
) -> Result<Option<RuntimeControl>> {
    if panel.model != crate::washer::MODEL {
        return Ok(None);
    }
    let targeted = panel.services.iter().flat_map(|s| &s.actions).any(|a| {
        a.siid == siid
            && a.aiid == aiid
            && ["pause", "start-wash", "stop-washing", "clean-dryer-stop"]
                .contains(&a.name.as_str())
    });
    if !targeted {
        return Ok(None);
    }
    let c = snapshot(panel)
        .and_then(|s| {
            s.controls
                .into_iter()
                .find(|c| c.siid == siid && c.aiid == Some(aiid))
        })
        .ok_or_else(|| AppError::invalid("当前运行状态不支持此操作。"))?;
    if !c.enabled {
        return Err(AppError::new(
            "stateUnavailable",
            c.reason.as_deref().unwrap_or("请先重新读取状态。"),
            true,
        ));
    }
    Ok(Some(c))
}
pub fn confirmed(control: &RuntimeControl, panel: &DevicePanel) -> bool {
    let Some(s) = snapshot(panel) else {
        return false;
    };
    match control.key.as_str() {
        "pause" => s.state == "paused",
        "resume" => s.state == "busy",
        "stop" if s.cleaning => false,
        "stop" => {
            matches!(s.state.as_str(), "idle" | "off")
                && number(panel, "dryer-channel-clean", "clean-lefttime") == Some(0)
        }
        "cancel" | "off" => {
            matches!(s.state.as_str(), "idle" | "off")
                && live(panel, "washer", "on").and_then(Value::as_bool) == Some(false)
        }
        "lock" => control.value.as_ref().and_then(Value::as_bool) == s.locked && s.locked.is_some(),
        _ => false,
    }
}

pub fn validate_property(
    panel: &DevicePanel,
    siid: u32,
    piid: u32,
    value: &Value,
) -> Result<Option<RuntimeControl>> {
    if panel.model != crate::washer::MODEL {
        return Ok(None);
    }
    let targeted = panel.services.iter().flat_map(|s| &s.properties).any(|p| {
        p.siid == siid
            && p.piid == piid
            && (p.name == "physical-controls-locked" || p.name == "on" && value == &json!(false))
    });
    if !targeted {
        return Ok(None);
    }
    let control = snapshot(panel)
        .and_then(|s| {
            s.controls.into_iter().find(|c| {
                c.siid == siid
                    && c.piid == Some(piid)
                    && c.value
                        .as_ref()
                        .is_some_and(|v| spec::values_equal(v, value))
            })
        })
        .ok_or_else(|| AppError::invalid("当前运行状态不支持此操作。"))?;
    if !control.enabled {
        return Err(AppError::new(
            "stateUnavailable",
            control.reason.as_deref().unwrap_or("请先重新读取状态。"),
            true,
        ));
    }
    Ok(Some(control))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> DevicePanel {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/washer-panel.json")).unwrap();
        for prop in p.services.iter_mut().flat_map(|s| &mut s.properties) {
            prop.code = Some(0);
            prop.value = Some(if prop.format == "bool" {
                json!(false)
            } else {
                json!(0)
            });
        }
        set(&mut p, "washer", "on", json!(true));
        en(&mut p, "status", "Busy");
        en(&mut p, "mode", "Smart");
        en(&mut p, "run-status", "Washing");
        set(&mut p, "washer", "left-time", json!(42));
        set(
            &mut p,
            "washer",
            "run-status-list",
            json!((1 << 2) | (1 << 5) | (1 << 6) | (1 << 8) | (1 << 9)),
        );
        p
    }
    fn set(p: &mut DevicePanel, s: &str, name: &str, v: Value) {
        let x = p
            .services
            .iter_mut()
            .filter(|s0| s0.name == s)
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == name)
            .unwrap();
        x.value = Some(v);
        x.code = Some(0);
    }
    fn en(p: &mut DevicePanel, name: &str, text: &str) {
        let v = property(p, "washer", name)
            .unwrap()
            .value_list
            .as_ref()
            .unwrap()
            .iter()
            .find(|v| v.description.eq_ignore_ascii_case(text))
            .unwrap()
            .value
            .clone();
        set(p, "washer", name, v);
    }
    #[test]
    fn phase_bitmap_controls_are_actual_schema_bindings_and_follow_runtime_state() {
        let mut p = fixture();
        let s = snapshot(&p).unwrap();
        assert!(s.active);
        assert_eq!(s.remaining_minutes, Some(42));
        assert_eq!(
            s.steps
                .iter()
                .map(|p| (p.id, p.progress.as_str()))
                .collect::<Vec<_>>(),
            [
                (2, "done"),
                (5, "current"),
                (6, "pending"),
                (8, "pending"),
                (9, "pending")
            ]
        );
        assert_eq!(
            s.controls
                .iter()
                .map(|c| c.key.as_str())
                .collect::<Vec<_>>(),
            ["stop", "pause", "lock"]
        );
        assert!(s.controls.iter().all(|c| c.enabled));
        en(&mut p, "status", "Paused");
        let s = snapshot(&p).unwrap();
        assert_eq!(
            s.controls
                .iter()
                .map(|c| c.key.as_str())
                .collect::<Vec<_>>(),
            ["stop", "resume"]
        );
        assert!(validate_action(&p, 2, 3).is_err());
        assert_eq!(validate_action(&p, 2, 2).unwrap().unwrap().key, "resume");
        en(&mut p, "status", "Completed");
        let s = snapshot(&p).unwrap();
        assert!(s.steps.is_empty());
        assert!(s.has_drying);
        assert_eq!(s.controls[0].key, "off");
    }
    #[test]
    fn enum_values_are_semantic_and_missing_current_phase_does_not_invent_a_completed_stage() {
        let mut p = fixture();
        let prop = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "status")
            .unwrap();
        let busy = prop
            .value_list
            .as_mut()
            .unwrap()
            .iter_mut()
            .find(|v| v.description == "Busy")
            .unwrap();
        busy.value = json!(33);
        prop.value = Some(json!(33));
        assert_eq!(snapshot(&p).unwrap().state, "busy");
        en(&mut p, "run-status", "Prewashing");
        assert!(snapshot(&p)
            .unwrap()
            .steps
            .iter()
            .all(|s| s.progress == "pending"));
        en(&mut p, "run-status", "Weighing");
        assert!(snapshot(&p).unwrap().weighing);
    }
    #[test]
    fn cached_unknown_or_faulted_values_cannot_authorize_runtime_controls() {
        let mut p = fixture();
        en(&mut p, "status", "Delay");
        let s = snapshot(&p).unwrap();
        assert!(s.steps.iter().all(|s| s.progress == "pending"));
        assert_eq!(s.controls.len(), 1);
        let c = &s.controls[0];
        assert_eq!(
            (&c.key, c.siid, c.piid, c.value.as_ref()),
            (&"cancel".into(), 2, Some(1), Some(&json!(false)))
        );
        let status = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "status")
            .unwrap();
        status.code = Some(-1);
        assert!(!snapshot(&p).unwrap().active);
        assert!(snapshot(&p).unwrap().controls.is_empty());
        en(&mut p, "status", "Busy");
        let fault = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "fault")
            .unwrap();
        fault.code = Some(-704220043);
        assert!(snapshot(&p).unwrap().controls.iter().all(|c| !c.enabled));
        assert!(validate_action(&p, 2, 3).is_err());
    }
    #[test]
    fn cancel_and_stop_require_target_state_not_just_accepted_property_or_action() {
        let mut p = fixture();
        en(&mut p, "status", "Delay");
        let c = validate_property(&p, 2, 1, &json!(false)).unwrap().unwrap();
        set(&mut p, "washer", "on", json!(false));
        assert!(!confirmed(&c, &p));
        en(&mut p, "status", "Off");
        assert!(confirmed(&c, &p));
        let mut p = fixture();
        set(&mut p, "dryer-channel-clean", "clean-lefttime", json!(5));
        let c = snapshot(&p)
            .unwrap()
            .controls
            .into_iter()
            .find(|c| c.key == "stop")
            .unwrap();
        assert_eq!((c.siid, c.aiid), (11, Some(2)));
        en(&mut p, "status", "Idle");
        assert!(!confirmed(&c, &p));
        set(&mut p, "dryer-channel-clean", "clean-lefttime", json!(0));
        assert!(confirmed(&c, &p));
    }
    #[test]
    fn lock_can_be_released_but_locks_and_child_protection_disable_other_controls() {
        let mut p = fixture();
        set(
            &mut p,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(true),
        );
        let s = snapshot(&p).unwrap();
        assert!(s
            .controls
            .iter()
            .filter(|c| c.key != "lock")
            .all(|c| !c.enabled));
        let c = s.controls.iter().find(|c| c.key == "lock").unwrap();
        assert!(c.enabled);
        assert_eq!(c.value, Some(json!(false)));
        set(
            &mut p,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(false),
        );
        assert!(confirmed(c, &p));
        set(&mut p, "washer", "child-protected-enabled", json!(true));
        assert!(snapshot(&p).unwrap().controls.iter().all(|c| !c.enabled));
    }
}
