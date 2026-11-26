use crate::{
    error::{AppError, Result},
    models::{Device, DevicePanel, Property, Service},
    spec,
    washer_programs::{ProgramDraft, ProgramPlan, ProgramWrite},
    washer_runtime,
};
use serde_json::{json, Value};

pub(crate) fn device_kind(device: &Device) -> bool {
    matches!(
        device.model.as_str(),
        "mibx2.washer.v10"
            | "mibx2.washer.v10d"
            | "mibx2.washer.x11"
            | "mibx2.washer.x17"
            | "mibx2.washer.x20"
            | "mibx2.washer.x26"
            | "mibx5.washer.s15"
            | "mibx5.washer.s19"
            | "mibx5.washer.v05"
            | "mibx5.washer.x06"
            | "mibx5.washer.x13"
            | "mibx5.washer.x15"
            | "mibx5.washer.x15d"
            | "mibx5.washer.x23d"
            | "mibx5.washer.x24"
            | "mibx5.washer.x31j"
            | "midjd4.washer.s14"
            | "midjd4.washer.s21"
    )
}

fn label(service: &Service) -> Option<&'static str> {
    match service.description.trim().to_ascii_lowercase().as_str() {
        "upper drum" => Some("upper"),
        "lower drum" => Some("lower"),
        "left drum" => Some("left"),
        "right drum" => Some("right"),
        _ => None,
    }
}

pub(crate) fn drums(panel: &DevicePanel) -> Vec<&Service> {
    if !washer_runtime::is_washer(panel)
        || panel.unsupported_reason.is_some()
        || panel.route_did.is_some()
    {
        return vec![];
    }
    let drums: Vec<_> = panel
        .services
        .iter()
        .filter(|service| service.name == "washer" && label(service).is_some())
        .collect();
    let mut labels: Vec<_> = drums.iter().filter_map(|s| label(s)).collect();
    labels.sort_unstable();
    if !matches!(
        labels.as_slice(),
        ["lower", "upper"] | ["left", "right"] | ["left", "lower", "right"]
    ) || drums.iter().any(|s| {
        s.siid == 0
            || panel.services.iter().filter(|o| o.siid == s.siid).count() != 1
            || property(s, "status")
                .is_none_or(|p| !p.access.iter().any(|a| a == "read") || p.value_list.is_none())
    }) {
        return vec![];
    }
    drums
}

fn property<'a>(service: &'a Service, name: &str) -> Option<&'a Property> {
    crate::dryer::property(service, name)
}

fn live(p: &Property) -> Option<&Value> {
    washer_runtime::live_value(p)
}

pub(crate) fn power(panel: &DevicePanel) -> Option<&Property> {
    let mut matches = panel
        .services
        .iter()
        .filter(|s| s.name == "washer" && label(s).is_none())
        .filter_map(|s| {
            property(s, "on")
                .filter(|p| p.format == "bool" && p.access.iter().any(|a| a == "write"))
        });
    let power = matches.next()?;
    (matches.next().is_none()
        && panel
            .services
            .iter()
            .filter(|s| s.siid == power.siid)
            .count()
            == 1)
        .then_some(power)
}

fn available(panel: &DevicePanel, service: &Service, starting: bool) -> bool {
    let master = power(panel).and_then(|p| panel.services.iter().find(|s| s.siid == p.siid));
    let no_fault = |p: &Property| live(p).and_then(Value::as_u64) == Some(0);
    if !property(service, "fault").is_some_and(no_fault)
        || master
            .and_then(|s| property(s, "fault"))
            .is_some_and(|p| !no_fault(p))
    {
        return false;
    }
    let settings = panel.services.iter().filter(|s| {
        s.siid == service.siid
            || master.is_some_and(|m| m.siid == s.siid)
            || matches!(
                s.name.as_str(),
                "physical-controls-locked" | "recommended-standard"
            )
    });
    settings
        .clone()
        .flat_map(|s| &s.properties)
        .filter(|p| p.access.iter().any(|a| a == "read"))
        .all(|p| match p.name.as_str() {
            "physical-controls-locked" | "current-physical-control-lock" | "child-lock" => {
                live(p).and_then(Value::as_bool) == Some(false)
            }
            "remote-controllable" => live(p).and_then(Value::as_bool) == Some(true),
            _ => true,
        })
        && settings.clone().all(|s| {
            property(s, "child-protected-enabled").is_none_or(|p| {
                match live(p).and_then(Value::as_bool) {
                    Some(false) => true,
                    Some(true) => {
                        property(s, "child-protected-status")
                            .or_else(|| property(service, "child-protected-status"))
                            .and_then(live)
                            .and_then(Value::as_bool)
                            == Some(true)
                    }
                    None => false,
                }
            })
        })
        && (!starting
            || property(service, "door-state")
                .and_then(washer_runtime::choice)
                .is_some_and(|meaning| {
                    matches!(
                        meaning.to_ascii_lowercase().as_str(),
                        "closed" | "closed and can be opened" | "closed and can not be opened"
                    )
                }))
}

pub(crate) fn runtime_allowed(panel: &DevicePanel, service: &Service, key: &str) -> bool {
    available(panel, service, key == "resume")
}

pub(crate) fn ready(device: &Device, panel: &DevicePanel, siid: u32) -> Result<bool> {
    let unavailable = || AppError::new("stateUnavailable", "洗衣筒当前状态无法确认。", true);
    if !device_kind(device)
        || device.did != panel.did
        || device.model != panel.model
        || !device.online
        || device.shared_read_only
        || device.split_route.is_some()
    {
        return Err(AppError::stale());
    }
    let drums = drums(panel);
    let service = drums
        .iter()
        .find(|s| s.siid == siid)
        .ok_or_else(unavailable)?;
    let state = |s: &Service| property(s, "status").and_then(washer_runtime::live_state);
    let on = power(panel)
        .and_then(live)
        .and_then(Value::as_bool)
        .ok_or_else(unavailable)?;
    if !matches!(state(service), Some("idle" | "off" | "completed"))
        || !available(panel, service, true)
        || (!on
            && drums
                .iter()
                .any(|s| !matches!(state(s), Some("idle" | "off" | "completed"))))
    {
        return Err(unavailable());
    }
    Ok(on)
}

pub(crate) fn prepare(panel: &DevicePanel, draft: &ProgramDraft) -> Result<ProgramPlan> {
    let invalid = || AppError::invalid("程序与当前洗衣筒的规格不匹配。");
    if draft.reservation_at.is_some() {
        return Err(invalid());
    }
    let mut pieces = draft.program.split('-');
    if pieces.next() != Some("drum") {
        return Err(invalid());
    }
    let siid: u32 = pieces
        .next()
        .and_then(|v| v.parse().ok())
        .ok_or_else(invalid)?;
    let piid: u32 = pieces
        .next()
        .and_then(|v| v.parse().ok())
        .ok_or_else(invalid)?;
    let program: u32 = pieces
        .next()
        .and_then(|v| v.parse().ok())
        .ok_or_else(invalid)?;
    if pieces.next().is_some() {
        return Err(invalid());
    }
    let drums = drums(panel);
    let s = drums.iter().find(|s| s.siid == siid).ok_or_else(invalid)?;
    let writable = |p: &Property| {
        p.access.iter().any(|a| a == "write") && p.access.iter().any(|a| a == "read")
    };
    let mode = property(s, "mode")
        .filter(|p| p.piid == piid && writable(p))
        .ok_or_else(invalid)?;
    let value = json!(program);
    let choices: Vec<_> = mode
        .value_list
        .iter()
        .flatten()
        .filter(|c| c.value == value)
        .collect();
    if choices.len() != 1
        || choices[0].description.trim().is_empty()
        || matches!(
            choices[0].description.trim().to_ascii_lowercase().as_str(),
            "invalid" | "illegal" | "none" | "off" | "unselected" | "standby" | "idle"
        )
    {
        return Err(invalid());
    }
    spec::validate_value(mode, &value)?;
    let start = crate::dryer::action(s, "start-wash").ok_or_else(invalid)?;
    let mut writes = vec![ProgramWrite {
        siid,
        piid,
        value: value.clone(),
    }];
    let fields = [
        "target-temperature",
        "rinsh-times",
        "spin-speed",
        "soak-time",
    ];
    if draft
        .values
        .keys()
        .any(|key| !fields.contains(&key.as_str()))
    {
        return Err(invalid());
    }
    for name in fields {
        if let Some(target) = draft.values.get(name) {
            let p = property(s, name)
                .filter(|p| writable(p) && live(p).is_some())
                .ok_or_else(invalid)?;
            spec::validate_value(p, target)?;
            writes.push(ProgramWrite {
                siid,
                piid: p.piid,
                value: target.clone(),
            });
        }
    }
    if let Some(p) = property(s, "reservation-wash-status").filter(|p| writable(p)) {
        let mut choices = p
            .value_list
            .iter()
            .flatten()
            .filter(|c| c.description.trim().eq_ignore_ascii_case("none"));
        let none = choices
            .next()
            .filter(|_| choices.next().is_none())
            .ok_or_else(invalid)?;
        spec::validate_value(p, &none.value)?;
        writes.push(ProgramWrite {
            siid,
            piid: p.piid,
            value: none.value.clone(),
        });
    }
    Ok(ProgramPlan {
        did: panel.did.clone(),
        mode: value,
        writes,
        estimated_minutes: 0,
        reservation_minutes: None,
        start_siid: siid,
        start_aiid: start.aiid,
    })
}
