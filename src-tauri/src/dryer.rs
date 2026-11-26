use crate::{
    error::{AppError, Result},
    models::{Action, Device, DevicePanel, Property, Service},
    spec,
    washer_programs::{ProgramDraft, ProgramPlan, ProgramWrite},
    washer_runtime::{RuntimeControl, RuntimeSnapshot, RuntimeStep},
};
use serde_json::{json, Value};

fn category(spec: Option<&str>) -> bool {
    spec.is_some_and(|urn| {
        ["urn:miot-spec-v2:device:", "urn:miot-spec-v3:device:"]
            .iter()
            .any(|prefix| {
                urn.strip_prefix(*prefix)
                    .and_then(|s| s.split(':').next())
                    .is_some_and(|kind| matches!(kind, "dryer" | "clothes-dryer"))
            })
    })
}
pub(crate) fn device_kind(device: &Device) -> bool {
    category(device.spec_type.as_deref())
        || device.spec_type.is_none() && device.model.split('.').nth(1) == Some("dry")
}
pub(crate) fn panel_kind(panel: &DevicePanel) -> bool {
    category(panel.spec_type.as_deref())
}

fn unavailable() -> AppError {
    AppError::new("stateUnavailable", "干衣机当前状态无法确认。", true)
}

pub(crate) fn property<'a>(service: &'a Service, name: &str) -> Option<&'a Property> {
    let mut matches = service.properties.iter().filter(|p| {
        p.siid == service.siid && p.piid > 0 && p.name == name && p.unsupported_reason.is_none()
    });
    let p = matches.next()?;
    (matches.next().is_none()
        && service
            .properties
            .iter()
            .filter(|other| other.piid == p.piid)
            .count()
            == 1)
        .then_some(p)
}
fn live(p: &Property) -> Option<&Value> {
    if p.code != Some(0) || !readable(p) {
        return None;
    }
    let value = p.value.as_ref()?;
    spec::validate_value(p, value).ok()?;
    Some(value)
}
fn readable(p: &Property) -> bool {
    p.access.iter().any(|a| a == "read")
}
fn writable(p: &Property) -> bool {
    readable(p) && p.access.iter().any(|a| a == "write")
}
fn choice(p: &Property) -> Option<&crate::models::ValueLabel> {
    let value = live(p)?;
    let mut matching = p
        .value_list
        .as_ref()?
        .iter()
        .filter(|c| spec::values_equal(&c.value, value));
    let found = matching.next()?;
    matching.next().is_none().then_some(found)
}
pub(crate) fn service(panel: &DevicePanel) -> Option<&Service> {
    if !panel_kind(panel) || panel.unsupported_reason.is_some() {
        return None;
    }
    let mut services = panel.services.iter().filter(|s| {
        matches!(
            s.name.as_str(),
            "dryer" | "clothes-dryer" | "cleanfly-dryer"
        ) && s.siid > 0
            && (property(s, "mode").is_some() || property(s, "status").is_some())
    });
    let s = services.next()?;
    (services.next().is_none()
        && panel
            .services
            .iter()
            .filter(|other| other.siid == s.siid)
            .count()
            == 1)
        .then_some(s)
}
pub(crate) fn action<'a>(service: &'a Service, name: &str) -> Option<&'a Action> {
    let mut actions = service.actions.iter().filter(|a| {
        a.siid == service.siid
            && a.aiid > 0
            && a.name == name
            && a.inputs.is_empty()
            && a.unsupported_reason.is_none()
    });
    let a = actions.next()?;
    (actions.next().is_none()
        && service
            .actions
            .iter()
            .filter(|other| other.aiid == a.aiid)
            .count()
            == 1)
        .then_some(a)
}
pub(crate) fn state_label(description: &str) -> Option<&'static str> {
    match description.trim().to_ascii_lowercase().as_str() {
        "run" | "busy" | "running" | "drying" | "运行中" | "烘干中" => Some("busy"),
        "idle" | "standby" | "open" | "待机" | "已开启" => Some("idle"),
        "paused" | "pause" | "puse" | "暂停中" => Some("paused"),
        "delay" | "order" | "预约中" => Some("delay"),
        "finish" | "finished" | "completed" | "eoc" | "烘干完成" => Some("completed"),
        "off" | "关闭" => Some("off"),
        "fault" | "error" | "故障" => Some("fault"),
        _ => None,
    }
}
pub(crate) fn state(p: &Property) -> Option<&'static str> {
    let c = choice(p)?;
    state_label(&c.description).or_else(|| c.localized_description.as_deref().and_then(state_label))
}

pub(crate) fn readable_run_state(panel: &DevicePanel) -> bool {
    service(panel).is_some_and(|service| {
        property(service, "status").and_then(state).is_some()
            && property(service, "mode").and_then(choice).is_some()
    })
}
fn no_fault(service: &Service) -> bool {
    property(service, "fault")
        .and_then(live)
        .is_some_and(|v| v.as_i64() == Some(0))
}
fn locked(panel: &DevicePanel, service: &Service) -> bool {
    panel
        .services
        .iter()
        .filter(|s| s.siid == service.siid || s.name == "physical-controls-locked")
        .flat_map(|s| &s.properties)
        .filter(|p| {
            readable(p)
                && matches!(
                    p.name.as_str(),
                    "physical-controls-locked" | "current-physical-control-lock" | "child-lock"
                )
        })
        .any(|p| live(p).and_then(Value::as_bool) != Some(false))
}
fn remote_allowed(panel: &DevicePanel, service: &Service) -> bool {
    let remote = panel
        .services
        .iter()
        .filter(|s| s.siid == service.siid || s.name == "recommended-standard")
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == "remote-controllable" && readable(p))
        .all(|p| live(p).and_then(Value::as_bool) == Some(true));
    remote
        && property(service, "child-protected-enabled").is_none_or(|p| {
            match live(p).and_then(Value::as_bool) {
                Some(false) => true,
                Some(true) => {
                    property(service, "child-protected-status")
                        .and_then(live)
                        .and_then(Value::as_bool)
                        == Some(true)
                }
                None => false,
            }
        })
}
fn door_closed(service: &Service) -> bool {
    property(service, "door-state")
        .filter(|p| readable(p) && p.value_list.is_some())
        .is_none_or(|p| {
            choice(p).is_some_and(|c| {
                let label = c.description.trim().to_ascii_lowercase();
                label == "closed"
                    || label.starts_with("closed and ")
                    || label == "unopenable and dry"
            })
        })
}
fn minutes(p: &Property) -> Option<u32> {
    let value = u32::try_from(live(p)?.as_u64()?).ok()?;
    match p.unit.as_deref()? {
        "minutes" => Some(value),
        "seconds" => Some(value.div_ceil(60)),
        _ => None,
    }
}
fn stage(c: &crate::models::ValueLabel) -> Option<&'static str> {
    match c.description.trim().to_ascii_lowercase().as_str() {
        "ready" => Some("准备"),
        "pre drying" => Some("预热"),
        "drying" | "dry" => Some("烘干"),
        "cooling after drying" | "cooling" => Some("冷却"),
        "blowing and shaking" => Some("抖散"),
        _ => None,
    }
}
pub(crate) fn snapshot(panel: &DevicePanel) -> Option<RuntimeSnapshot> {
    let s = service(panel)?;
    let status = property(s, "status").filter(|p| readable(p) && p.value_list.is_some())?;
    let current = state(status).unwrap_or("unknown");
    let mode = property(s, "mode");
    let run = property(s, "run-status");
    let phase = run.and_then(choice).and_then(stage);
    let steps = run
        .zip(property(s, "run-status-list"))
        .and_then(|(run, list)| {
            let active = live(run)?.as_u64()?;
            let mask = live(list)?.as_u64()?;
            if active >= 32 || mask & (1 << active) == 0 {
                return None;
            }
            let mut steps = run
                .value_list
                .as_ref()?
                .iter()
                .filter_map(|c| {
                    let id = c.value.as_u64()?;
                    (id < 32 && mask & (1 << id) != 0).then_some(RuntimeStep {
                        id: id as u32,
                        label: stage(c)?.into(),
                        progress: if id < active {
                            "done"
                        } else if id == active {
                            "current"
                        } else {
                            "pending"
                        }
                        .into(),
                    })
                })
                .collect::<Vec<_>>();
            steps.sort_by_key(|step| step.id);
            (steps.iter().any(|step| step.progress == "current")
                && steps.windows(2).all(|steps| steps[0].id != steps[1].id))
            .then_some(steps)
        })
        .unwrap_or_default();
    let lock = locked(panel, s);
    let mut controls = Vec::new();
    for (valid, name, key, label, expected) in [
        (current == "busy", "pause", "pause", "暂停", "paused"),
        (
            current == "paused",
            "start-drying",
            "resume",
            "继续",
            "busy",
        ),
        (
            matches!(current, "busy" | "paused"),
            "stop-dry",
            "stop",
            "终止",
            "idle",
        ),
    ] {
        let observes = status.value_list.as_ref().is_some_and(|choices| {
            choices
                .iter()
                .any(|c| state_label(&c.description) == Some(expected))
        });
        if valid && observes {
            if let Some(action) = action(s, name) {
                controls.push(RuntimeControl {
                    key: key.into(),
                    label: label.into(),
                    kind: "action".into(),
                    siid: s.siid,
                    piid: None,
                    aiid: Some(action.aiid),
                    value: None,
                    enabled: no_fault(s)
                        && !lock
                        && (key != "resume" || remote_allowed(panel, s) && door_closed(s)),
                    reason: None,
                    confirmation: (key == "stop").then(|| "确定要终止烘干吗？".into()),
                });
            }
        }
    }
    Some(RuntimeSnapshot {
        state: current.into(),
        active: matches!(current, "busy" | "paused" | "delay" | "completed"),
        service_id: Some(s.siid),
        mode: mode.and_then(live).and_then(Value::as_i64),
        mode_label: mode.and_then(choice).map(|c| {
            c.localized_description
                .clone()
                .unwrap_or_else(|| c.description.clone())
        }),
        stage: None,
        phase_label: phase.map(str::to_owned),
        remaining_minutes: property(s, "left-time").and_then(minutes),
        reservation_minutes: (current == "delay")
            .then(|| property(s, "reservation-left-time").and_then(minutes))
            .flatten(),
        weighing: false,
        has_drying: true,
        cleaning: false,
        locked: Some(lock),
        steps,
        controls,
    })
}

pub(crate) fn ready(device: &Device, panel: &DevicePanel) -> Result<bool> {
    let s = service(panel).ok_or_else(unavailable)?;
    if device.did != panel.did
        || device.model != panel.model
        || !device.online
        || device.shared_read_only
        || device.split_route.is_some()
    {
        return Err(AppError::stale());
    }
    let on = property(s, "on")
        .filter(|p| writable(p) && p.format == "bool")
        .and_then(live)
        .and_then(Value::as_bool)
        .ok_or_else(unavailable)?;
    if !matches!(
        property(s, "status").and_then(state),
        Some("off" | "idle" | "completed")
    ) || !no_fault(s)
        || locked(panel, s)
        || !remote_allowed(panel, s)
        || !door_closed(s)
    {
        return Err(unavailable());
    }
    Ok(on)
}
fn text(p: &Property, value: &Value) -> Option<String> {
    p.value_list
        .as_ref()?
        .iter()
        .find(|c| spec::values_equal(&c.value, value))
        .map(|c| c.description.trim().to_ascii_lowercase())
}
fn timed(s: &Service, mode: &Property, value: &Value, draft: &ProgramDraft) -> bool {
    text(mode, value).is_some_and(|name| matches!(name.as_str(), "timing" | "timed" | "timed dry"))
        || property(s, "drying-level").is_some_and(|p| {
            draft
                .values
                .get("drying-level")
                .or_else(|| live(p))
                .and_then(|value| text(p, value))
                .is_some_and(|name| matches!(name.as_str(), "timed" | "timed dry" | "timing dry"))
        })
}
pub(crate) fn prepare(
    device: &Device,
    panel: &DevicePanel,
    draft: &ProgramDraft,
    now_ms: u64,
) -> Result<ProgramPlan> {
    let invalid = || AppError::invalid("烘干程序与当前设备规格不匹配。");
    let s = service(panel).ok_or_else(invalid)?;
    let mode = property(s, "mode")
        .filter(|p| writable(p))
        .ok_or_else(invalid)?;
    let mut choices = mode.value_list.iter().flatten().filter_map(|choice| {
        let value = choice.value.as_i64()?;
        (draft.program == format!("dryer-{}-{}-{value}", s.siid, mode.piid))
            .then_some((choice, json!(value)))
    });
    let (choice, value) = choices.next().ok_or_else(invalid)?;
    if choices.next().is_some()
        || ["off", "none", "idle", "standby", "unselected"]
            .contains(&choice.description.trim().to_ascii_lowercase().as_str())
    {
        return Err(invalid());
    }
    spec::validate_value(mode, &value)?;
    let start = action(s, "start-drying").ok_or_else(invalid)?;
    let mut writes = vec![ProgramWrite {
        siid: s.siid,
        piid: mode.piid,
        value: value.clone(),
    }];
    let fields = [
        "drying-level",
        "drying-degree",
        "drying-time",
        "auto-shake-disperse",
        "shake-time",
    ];
    if draft
        .values
        .keys()
        .any(|name| !fields.contains(&name.as_str()))
    {
        return Err(invalid());
    }
    let timed = timed(s, mode, &value, draft);
    for name in fields {
        let Some(target) = draft.values.get(name) else {
            continue;
        };
        let p = property(s, name)
            .filter(|p| writable(p) && live(p).is_some())
            .ok_or_else(invalid)?;
        if name == "drying-time"
            && (!timed || p.unit.as_deref() != Some("minutes") || device.model == "pgkj.dry.300pzr")
        {
            return Err(invalid());
        }
        spec::validate_value(p, target)?;
        writes.push(ProgramWrite {
            siid: s.siid,
            piid: p.piid,
            value: target.clone(),
        });
    }
    let estimated_minutes = if timed {
        property(s, "drying-time")
            .filter(|p| p.unit.as_deref() == Some("minutes"))
            .and_then(|p| draft.values.get("drying-time").or_else(|| live(p)))
            .and_then(Value::as_u64)
            .and_then(|n| u32::try_from(n).ok())
            .unwrap_or(0)
    } else {
        0
    };
    let mut reservation_minutes = None;
    if let (Some(reserve), Some(remaining)) = (
        property(s, "reservation-dry-status").filter(|p| writable(p)),
        property(s, "reservation-left-time")
            .filter(|p| writable(p) && p.unit.as_deref() == Some("minutes")),
    ) {
        let expected = if draft.reservation_at.is_some() {
            "finish dry"
        } else {
            "none"
        };
        let choice = reserve
            .value_list
            .iter()
            .flatten()
            .find(|v| v.description.trim().eq_ignore_ascii_case(expected))
            .ok_or_else(invalid)?;
        spec::validate_value(reserve, &choice.value)?;
        writes.push(ProgramWrite {
            siid: s.siid,
            piid: reserve.piid,
            value: choice.value.clone(),
        });
        if let Some(at) = draft.reservation_at {
            let delta = at.checked_sub(now_ms).ok_or_else(invalid)?.div_ceil(60000);
            if estimated_minutes == 0 || delta < u64::from(estimated_minutes) + 6 || delta > 1440 {
                return Err(invalid());
            }
            spec::validate_value(remaining, &json!(delta))?;
            writes.push(ProgramWrite {
                siid: s.siid,
                piid: remaining.piid,
                value: json!(delta),
            });
            reservation_minutes = Some(delta as u32);
        }
    } else if draft.reservation_at.is_some() {
        return Err(invalid());
    }
    Ok(ProgramPlan {
        did: device.did.clone(),
        mode: value,
        writes,
        estimated_minutes,
        reservation_minutes,
        start_siid: s.siid,
        start_aiid: start.aiid,
    })
}
