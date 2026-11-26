//! Current-state projection and runtime control bindings from standard washer
//! 16745/16736/17384 and the authenticated MIoT schema. No historical fallback.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property, Service},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeStep {
    pub id: u32,
    pub label: String,
    pub progress: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
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
#[derive(Clone, Debug, Serialize, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSnapshot {
    pub state: String,
    pub active: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub service_id: Option<u32>,
    pub mode: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mode_label: Option<String>,
    pub stage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub phase_label: Option<String>,
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
    live_value(property(panel, service, name)?)
}
pub(crate) fn live_value(p: &Property) -> Option<&Value> {
    if p.code != Some(0) || !p.access.iter().any(|a| a == "read") {
        return None;
    }
    let value = p.value.as_ref()?;
    spec::validate_value(p, value).ok()?;
    Some(value)
}
pub(crate) fn choice(p: &Property) -> Option<&str> {
    let value = live_value(p)?;
    let mut rows = p
        .value_list
        .as_ref()?
        .iter()
        .filter(|v| spec::values_equal(&v.value, value));
    let row = rows.next()?;
    rows.next()
        .is_none()
        .then_some(row.description.trim())
        .filter(|v| !v.is_empty())
}
fn meaning(panel: &DevicePanel, name: &str) -> Option<String> {
    choice(property(panel, "washer", name)?).map(str::to_lowercase)
}
pub(crate) fn live_state(status: &Property) -> Option<&'static str> {
    choice(status).and_then(state_label).map(|(state, _)| state)
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
fn phased(panel: &DevicePanel) -> bool {
    panel.model == crate::washer::MODEL
        || panel.model == "midjd8.washer.42a"
            && status_binding(panel).is_some()
            && property(panel, "washer", "run-status").is_some()
            && property(panel, "washer", "run-status-list").is_some()
}

pub(crate) fn is_washer(panel: &DevicePanel) -> bool {
    panel.model == crate::washer::MODEL
        || panel.spec_type.as_deref().is_some_and(|t| {
            t.starts_with("urn:miot-spec-v2:device:washer:")
                || t.starts_with("urn:miot-spec-v3:device:washer:")
        })
}
pub(crate) fn is_laundry(panel:&DevicePanel)->bool { is_washer(panel)||crate::dryer::panel_kind(panel) }

fn service_property<'a>(service: &'a Service, name: &str) -> Option<&'a Property> {
    let mut rows = service
        .properties
        .iter()
        .filter(|p| p.name == name && p.siid == service.siid);
    let row = rows.next()?;
    (row.piid > 0
        && rows.next().is_none()
        && service
            .properties
            .iter()
            .filter(|p| p.piid == row.piid)
            .count()
            == 1)
        .then_some(row)
}

pub(crate) fn status_binding(panel: &DevicePanel) -> Option<(&Service, &Property)> {
    if !is_washer(panel) || panel.unsupported_reason.is_some() {
        return None;
    }
    let mut rows = panel
        .services
        .iter()
        .filter(|s| s.name == "washer")
        .filter_map(|s| {
            let p = service_property(s, "status")?;
            (p.access.iter().any(|a| a == "read")
                && p.value_list.as_ref().is_some_and(|v| !v.is_empty()))
            .then_some((s, p))
        });
    let (service, status) = rows.next()?;
    (service.siid > 0
        && rows.next().is_none()
        && panel
            .services
            .iter()
            .filter(|s| s.siid == service.siid)
            .count()
            == 1)
        .then_some((service, status))
}

pub(crate) fn state_label(description: &str) -> Option<(&'static str, Option<&'static str>)> {
    Some(match description.trim().to_ascii_lowercase().as_str() {
        "busy" | "running" | "working" | "工作中" | "运行中" => ("busy", None),
        "paused" | "pause" | "暂停" | "暂停中" => ("paused", None),
        "delay" | "scheduled" | "预约中" => ("delay", None),
        "completed" | "done" | "end of cycle" | "finished" | "已完成" => ("completed", None),
        "idle" | "standby" | "待机" => ("idle", None),
        "off" | "关机" => ("off", None),
        "fault" | "error" | "故障" => ("fault", None),
        "weighing" | "weight" | "称重" => ("busy", Some("称重")),
        "washing" | "wash" | "洗涤" => ("busy", Some("洗涤")),
        "rinsing" | "rinse" | "漂洗" => ("busy", Some("漂洗")),
        "spinning" | "spin" | "脱水" => ("busy", Some("脱水")),
        "drying" | "dry" | "烘干" => ("busy", Some("烘干")),
        "soaking" | "soak" | "浸泡" => ("busy", Some("浸泡")),
        "prewashing" | "预洗" => ("busy", Some("预洗")),
        "water" | "filling" | "进水" => ("busy", Some("进水")),
        "drain" | "draining" | "排水" => ("busy", Some("排水")),
        _ => return None,
    })
}

fn read_minutes(p: &Property) -> Option<u32> {
    let value = u32::try_from(live_value(p)?.as_u64()?).ok()?;
    match p.unit.as_deref()? {
        "minutes" => Some(value),
        "seconds" => Some(value.div_ceil(60)),
        _ => None,
    }
}

fn standard_controls(
    panel: &DevicePanel,
    service: &Service,
    status: &Property,
    state: &str,
) -> Vec<RuntimeControl> {
    let fault = service_property(service, "fault").filter(|p| {
        p.access.iter().any(|a| a == "read")
            && p.value_list
                .as_ref()
                .is_some_and(|v| v.iter().any(|c| healthy(&c.description)))
    });
    let can_observe = |expected| {
        status.value_list.as_ref().is_some_and(|choices| {
            choices.iter().enumerate().any(|(i, c)| {
                state_label(&c.description).is_some_and(|(s, _)| s == expected)
                    && spec::validate_value(status, &c.value).is_ok()
                    && !choices.iter().enumerate().any(|(j, other)| {
                        i != j && spec::values_equal(&c.value, &other.value)
                    })
            })
        })
    };
    // Some published washer services report faults through the same status
    // enum as Busy and Pause. A declared separate fault still needs its own read.
    if fault.is_none()
        && (service.properties.iter().any(|p| p.name == "fault") || !can_observe("fault"))
    {
        return vec![];
    }
    let reason = if fault.is_some_and(|p| !choice(p).is_some_and(healthy)) {
        Some("故障状态尚未确认或设备存在故障。")
    } else if panel
        .services
        .iter()
        .filter(|s| s.name == "physical-controls-locked" || s.siid == service.siid)
        .flat_map(|s| &s.properties)
        .any(|p| {
            matches!(p.name.as_str(), "physical-controls-locked" | "child-lock")
                && live_value(p).and_then(Value::as_bool) != Some(false)
        })
    {
        Some("请先确认并解除童锁。")
    } else if service_property(service, "child-protected-enabled").is_some_and(
        |p| match live_value(p).and_then(Value::as_bool) {
            Some(false) => false,
            Some(true) => {
                service_property(service, "child-protected-status")
                    .and_then(live_value)
                    .and_then(Value::as_bool)
                    != Some(true)
            }
            None => true,
        },
    ) {
        Some("儿童安全状态尚未确认，请先在设备上检查。")
    } else {
        None
    };
    let mut controls = Vec::new();
    let mut add = |name, key: &str, label: &str, confirmation: Option<&str>| {
        let mut actions = service.actions.iter().filter(|a| a.name == name);
        let Some(a) = actions.next() else {
            return;
        };
        if actions.next().is_some()
            || a.siid != service.siid
            || a.aiid == 0
            || !a.inputs.is_empty()
            || a.unsupported_reason.is_some()
            || service
                .actions
                .iter()
                .filter(|row| row.aiid == a.aiid)
                .count()
                != 1
        {
            return;
        }
        controls.push(RuntimeControl {
            key: key.into(),
            label: label.into(),
            kind: "action".into(),
            siid: service.siid,
            piid: None,
            aiid: Some(a.aiid),
            value: None,
            enabled: reason.is_none(),
            reason: reason.map(str::to_owned),
            confirmation: confirmation.map(str::to_owned),
        });
    };
    if matches!(state, "busy" | "paused") {
        if can_observe("idle") || can_observe("off") || can_observe("completed") {
            add("stop-washing", "stop", "终止", Some("确定要终止洗涤吗？"));
        }
        if state == "busy" && can_observe("paused") {
            add("pause", "pause", "暂停", None);
        }
        if state == "paused" && can_observe("busy") {
            add("start-wash", "resume", "继续", None);
        }
    }
    controls
}

fn healthy(description: &str) -> bool {
    matches!(
        description.trim().to_ascii_lowercase().as_str(),
        "no fault" | "no faults" | "无故障"
    )
}

fn standard_snapshot(panel: &DevicePanel) -> Option<RuntimeSnapshot> {
    let (service, status) = status_binding(panel)?;
    Some(snapshot_service(panel,service,status,false))
}

pub(crate) fn drum_status(panel:&DevicePanel, siid:u32)->Option<(&Service,&Property)> {
    let service=crate::washer_zones::drums(panel).into_iter().find(|s|s.siid==siid)?;
    Some((service,service_property(service,"status")?))
}

pub(crate) fn snapshot_for(panel:&DevicePanel, siid:u32)->Option<RuntimeSnapshot> {
    if let Some((s,p))=drum_status(panel,siid) {
        return Some(snapshot_service(panel,s,p,true));
    }
    snapshot(panel)
}

fn snapshot_service(panel:&DevicePanel,service:&Service,status:&Property,drum:bool)->RuntimeSnapshot {
    let (state, phase) = choice(status)
        .and_then(state_label)
        .unwrap_or(("unknown", None));
    let mode = service_property(service, "mode");
    let remaining = service_property(service, "left-time")
        .or_else(|| service_property(service, "remaining-time"))
        .and_then(read_minutes)
        .or_else(|| {
            // This model publishes the time of its only washer status channel in the time service.
            (panel.model == "minij.washer.v17")
                .then(|| property(panel, "time", "timeremain").and_then(read_minutes))
                .flatten()
        });
    let stage=drum.then(||service_property(service,"run-status").and_then(choice).map(str::to_ascii_lowercase)).flatten();
    let phase=stage.as_deref().filter(|name|*name!="not run").map(label).filter(|s|s.chars().any(|c| ('\u{3400}'..='\u{9fff}').contains(&c))).or(phase);
    let mut controls=standard_controls(panel,service,status,state);
    if drum {
        for control in &mut controls {
            control.enabled &= crate::washer_zones::runtime_allowed(panel,service,&control.key);
        }
    }
    RuntimeSnapshot {
        state: state.into(),
        active: matches!(state, "busy" | "paused" | "delay" | "completed"),
        service_id: Some(service.siid),
        mode: mode.and_then(live_value).and_then(Value::as_i64),
        mode_label: mode.and_then(choice).map(str::to_owned),
        stage: stage.clone(),
        phase_label: phase.map(str::to_owned),
        remaining_minutes: remaining,
        reservation_minutes: drum.then(||service_property(service,"reservation-left-time").and_then(read_minutes)).flatten(),
        weighing: phase == Some("称重"),
        has_drying: stage.as_deref().is_some_and(|stage|stage.contains("drying")),
        cleaning: false,
        locked: live(
            panel,
            "physical-controls-locked",
            "physical-controls-locked",
        )
        .and_then(Value::as_bool),
        steps: Vec::new(),
        controls,
    }
}

pub fn snapshot(panel: &DevicePanel) -> Option<RuntimeSnapshot> {
    if panel.unsupported_reason.is_some() {
        return None;
    }
    if crate::dryer::panel_kind(panel) { return crate::dryer::snapshot(panel); }
    if !phased(panel) {
        return standard_snapshot(panel);
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
    let steps = if (state == "delay"
        || matches!(state.as_str(), "busy" | "paused") && current.is_some())
        && !cleaning
    {
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
        service_id: status_binding(panel).map(|(service, _)| service.siid),
        mode,
        mode_label: property(panel, "washer", "mode")
            .and_then(choice)
            .map(str::to_owned),
        stage: stage.clone(),
        phase_label: stage
            .as_deref()
            .filter(|s| !matches!(*s, "not run" | "washing completed"))
            .map(label)
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
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
    panel.washer_drums = crate::washer_zones::drums(panel).into_iter()
        .filter_map(|s|Some(snapshot_service(panel,s,service_property(s,"status")?,true))).collect();
}
pub fn validate_action(
    panel: &DevicePanel,
    siid: u32,
    aiid: u32,
) -> Result<Option<RuntimeControl>> {
    if !is_laundry(panel) {
        return Ok(None);
    }
    if crate::dryer::panel_kind(panel) && !crate::dryer::service(panel).is_some_and(|s|s.siid==siid&&s.actions.iter().any(|a|
        a.aiid==aiid&&["pause","start-drying","stop-dry"].contains(&a.name.as_str()))) { return Ok(None); }
    let targeted = panel.services.iter().flat_map(|s| &s.actions).any(|a| {
        a.siid == siid
            && a.aiid == aiid
            && ["pause", "start-wash", "stop-washing", "clean-dryer-stop"]
                .contains(&a.name.as_str())
    });
    if !targeted && panel.model == crate::washer::MODEL {
        return Ok(None);
    }
    let c = snapshot_for(panel,siid)
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
    let Some(s) = snapshot_for(panel,control.siid) else {
        return false;
    };
    match control.key.as_str() {
        "pause" => s.state == "paused",
        "resume" => s.state == "busy",
        "stop" if s.cleaning => false,
        "stop" => {
            if phased(panel) {
                matches!(s.state.as_str(), "idle" | "off")
                    && number(panel, "dryer-channel-clean", "clean-lefttime") == Some(0)
            } else {
                matches!(s.state.as_str(), "idle" | "off" | "completed")
            }
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
    fn published(model: &str, raw: &str) -> DevicePanel {
        let spec: Value = serde_json::from_str(raw).unwrap();
        let device = serde_json::from_value(json!({
            "did":"fixture", "name":"洗衣机", "model":model, "online":true,
            "roomId":"r", "roomName":"r", "specType":spec["type"]
        }))
        .unwrap();
        spec::parse_panel(&device, &spec).unwrap()
    }
    #[test]
    fn published_program_label_keeps_protocol_description_and_chinese_name() {
        let panel = published(
            "whp.washer.wgf80870bi",
            include_str!("fixtures/catalog/washer--whp.washer.wgf80870bi.json"),
        );
        let mode = property(&panel, "washer", "mode").unwrap();
        let program = mode.value_list.as_ref().unwrap().iter()
            .find(|choice| choice.description == "Wash Dry").unwrap();
        let wire = serde_json::to_value(program).unwrap();
        assert_eq!(wire["description"], "Wash Dry");
        assert_eq!(wire["localizedDescription"], "智能洗烘");
    }
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
    fn published_bindings_allow_controls_without_inventing_a_timeline() {
        let mut p = published(
            "whp.washer.wgf80870bi",
            include_str!("fixtures/catalog/washer--whp.washer.wgf80870bi.json"),
        );
        en(&mut p, "status", "Busy");
        en(&mut p, "fault", "No faults");
        set(&mut p, "washer", "left-time", json!(25));
        set(
            &mut p,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(false),
        );
        let s = snapshot(&p).unwrap();
        assert_eq!(s.remaining_minutes, Some(25));
        assert!(s.active && s.steps.is_empty());
        let [pause] = s.controls.as_slice() else {
            panic!("expected a single pause binding")
        };
        assert_eq!(pause.key, "pause");
        assert!(
            validate_action(&p, pause.siid, pause.aiid.unwrap())
                .unwrap()
                .unwrap()
                .enabled
        );
        en(&mut p, "status", "Pause");
        let s = snapshot(&p).unwrap();
        assert_eq!(s.state, "paused");
        assert_eq!(s.controls[0].key, "resume");
        set(
            &mut p,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(true),
        );
        assert!(!snapshot(&p).unwrap().controls[0].enabled);
    }

    #[test]
    fn phase_only_specs_report_real_phase_and_mode_without_runtime_actions() {
        let mut p = published(
            "viomi.washer.s1",
            include_str!("fixtures/compatibility/washer--viomi.washer.s1.json"),
        );
        en(&mut p, "status", "Rinse");
        en(&mut p, "mode", "Super Quick");
        set(&mut p, "washer", "left-time", json!(18));
        let s = snapshot(&p).unwrap();
        assert_eq!(s.phase_label.as_deref(), Some("漂洗"));
        assert_eq!(s.mode_label.as_deref(), Some("Super Quick"));
        assert_eq!(s.remaining_minutes, Some(18));
        assert!(s.active && s.steps.is_empty() && s.controls.is_empty());
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == "left-time")
            .unwrap()
            .code = Some(-1);
        assert_eq!(snapshot(&p).unwrap().remaining_minutes, None);
    }

    #[test]
    fn published_combined_status_can_guard_pause_and_resume_without_a_separate_fault_property() {
        let mut panel = published(
            "minij.washer.v1",
            include_str!("fixtures/compatibility/washer--minij.washer.v1.json"),
        );
        set(
            &mut panel,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(false),
        );
        en(&mut panel, "status", "Busy");
        let runtime = snapshot(&panel).unwrap();
        assert!(runtime.active && runtime.remaining_minutes.is_none() && runtime.steps.is_empty());
        let pause = validate_action(&panel, 2, 2).unwrap().unwrap();
        assert_eq!(pause.key, "pause");
        assert!(!confirmed(&pause, &panel));
        assert!(validate_action(&panel, 2, 1).is_err());

        en(&mut panel, "status", "Pause");
        assert!(confirmed(&pause, &panel));
        assert_eq!(validate_action(&panel, 2, 1).unwrap().unwrap().key, "resume");
        set(
            &mut panel,
            "physical-controls-locked",
            "physical-controls-locked",
            json!(true),
        );
        assert!(validate_action(&panel, 2, 1).is_err());

        en(&mut panel, "status", "Fault");
        assert!(snapshot(&panel).unwrap().controls.is_empty());
        assert!(validate_action(&panel, 2, 2).is_err());
    }
    #[test]
    fn secondary_fault_service_does_not_steal_status_or_time_binding() {
        let mut p = published(
            "minij.washer.v17",
            include_str!("fixtures/catalog/washer--minij.washer.v17.json"),
        );
        en(&mut p, "status", "Busy");
        set(&mut p, "time", "timeremain", json!(14));
        assert_eq!(snapshot(&p).unwrap().remaining_minutes, Some(14));
        let mut ambiguous = status_binding(&p).unwrap().0.clone();
        ambiguous.siid = 80;
        for property in &mut ambiguous.properties {
            property.siid = 80;
        }
        p.services.push(ambiguous);
        assert!(snapshot(&p).is_none());
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
        let phase = p.services.iter_mut().flat_map(|s| &mut s.properties)
            .find(|p| p.name == "run-status").unwrap();
        phase.code = Some(-1);
        let s = snapshot(&p).unwrap();
        assert!(s.active && s.steps.is_empty() && !s.weighing);
        assert_eq!(validate_action(&p, 2, 1).unwrap().unwrap().key, "stop");
        assert_eq!(validate_action(&p, 2, 3).unwrap().unwrap().key, "pause");
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
