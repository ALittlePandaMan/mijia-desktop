//! Explicit, descriptor-bound camera alarm and fill-light controls.
//!
//! Evidence: standard camera plugin PluginInstanceProvider.audibleSoundTime /
//! whiteLightSwitch, OriginalAlarmBtn and useWhiteLight. Alarm sound previews,
//! detection rules, night vision and status LEDs are deliberately not controls.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Alarm,
    Light,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Control {
    pub supported: bool,
    pub active: Option<bool>,
    pub remaining_seconds: Option<u32>,
    pub writable: bool,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub alarm: Control,
    pub light: Control,
}
#[derive(Serialize)]
pub struct Changed {
    pub report: Snapshot,
    pub confirmed: bool,
}

/// This module never sends writes. The authenticated state layer sends exactly
/// this property once, then performs independent read-only observation.
pub enum Prepared {
    Property { siid: u32, piid: u32, value: Value },
}

#[derive(Clone, Copy)]
enum Meaning {
    Boolean,
    Seconds,
}

struct Binding<'a> {
    property: &'a Property,
    meaning: Meaning,
}

fn unique_property<'a>(
    panel: &'a DevicePanel,
    service_name: &str,
    property_name: &str,
) -> Option<&'a Property> {
    let mut candidates = panel
        .services
        .iter()
        .filter(|s| s.name == service_name)
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == property_name);
    let first = candidates.next()?;
    candidates.next().is_none().then_some(first)
}

fn has_property(panel: &DevicePanel, service_name: &str, property_name: &str) -> bool {
    panel
        .services
        .iter()
        .filter(|s| s.name == service_name)
        .flat_map(|s| &s.properties)
        .any(|p| p.name == property_name)
}

fn raw_property(panel: &DevicePanel, kind: Kind) -> Option<&Property> {
    match kind {
        Kind::Alarm => {
            // The original hlc8 branch takes precedence over the generic path.
            if panel.model == "isa.camera.hlc8" {
                return unique_property(panel, "other-functions", "hl-audible-alarm");
            }
            if has_property(panel, "camera-control-sub", "audible-sound-time") {
                return unique_property(panel, "camera-control-sub", "audible-sound-time");
            }
            super::power::global_service(panel)
                .and_then(|service| {
                    let mut candidates = service
                        .properties
                        .iter()
                        .filter(|p| p.name == "manual-sound-and-light-warning");
                    let first = candidates.next()?;
                    candidates.next().is_none().then_some(first)
                })
                // These official ISA descriptors expose the same bool control
                // as hlc8; unknown vendor properties are never inferred here.
                .or_else(|| {
                    matches!(
                        panel.model.as_str(),
                        "isa.camera.cw500"
                            | "isa.camera.500dh"
                            | "isa.camera.hlmax"
                            | "isa.camera.hlzoom"
                    )
                    .then(|| unique_property(panel, "other-functions", "hl-audible-alarm"))
                    .flatten()
                })
        }
        Kind::Light => {
            for (service, property) in [
                ("camera-control-sub", "white-light-switch"),
                ("other-functions", "hl-filllight-switch"),
                ("white-light", "on"),
            ] {
                if has_property(panel, service, property) {
                    return unique_property(panel, service, property);
                }
            }
            None
        }
    }
}

fn seconds_property(panel: &DevicePanel, property: &Property, kind: Kind) -> bool {
    // These private properties have no unit in the official description. Their
    // exact model/schema pairing and the original plugin establish seconds.
    let verified_private = match panel.model.as_str() {
        "mxiang.camera.mod11" => panel
            .spec_type
            .as_deref()
            .is_some_and(|s| s.contains(":mxiang-mod11:")),
        "mxiang.camera.mod13" => panel
            .spec_type
            .as_deref()
            .is_some_and(|s| s.contains(":mxiang-mod13:")),
        _ => false,
    };
    let expected_name = match kind {
        Kind::Alarm => "audible-sound-time",
        Kind::Light => "white-light-switch",
    };
    let explicit_seconds =
        property.unit.as_deref() == Some("seconds") || property.unit.as_deref() == Some("second");
    property.name == expected_name
        && (verified_private || explicit_seconds)
        && matches!(
            property.format.as_str(),
            "uint8" | "uint16" | "uint32" | "int8" | "int16" | "int32"
        )
        && property.value_range.as_ref().is_some_and(|range| {
            range.len() == 3
                && range.iter().all(|v| v.is_finite())
                && range[0] == 0.0
                && range[1] >= 30.0
                && range[1] <= u32::MAX as f64
                && range[2] > 0.0
                && (30.0 / range[2] - (30.0 / range[2]).round()).abs() < 1e-8
        })
}

fn binding(panel: &DevicePanel, kind: Kind) -> Option<Binding<'_>> {
    let property = raw_property(panel, kind)?;
    if property.unsupported_reason.is_some() || !property.access.iter().any(|a| a == "read") {
        return None;
    }
    let meaning = if property.format == "bool" {
        Meaning::Boolean
    } else if seconds_property(panel, property, kind) {
        Meaning::Seconds
    } else {
        return None;
    };
    Some(Binding { property, meaning })
}

fn control(panel: &DevicePanel, kind: Kind, read_only: bool, online: bool) -> Control {
    let binding = binding(panel, kind);
    let property = binding.as_ref().map(|b| b.property);
    let current = property
        .filter(|_| online)
        .filter(|p| p.code == Some(0))
        .and_then(|p| p.value.as_ref())
        .filter(|v| property.is_some_and(|p| spec::validate_value(p, v).is_ok()));
    let remaining_seconds = binding.as_ref().and_then(|b| match b.meaning {
        Meaning::Boolean => None,
        Meaning::Seconds => current
            .and_then(Value::as_u64)
            .and_then(|v| u32::try_from(v).ok()),
    });
    let active = binding.as_ref().and_then(|b| match b.meaning {
        Meaning::Boolean => current.and_then(Value::as_bool),
        Meaning::Seconds => remaining_seconds.map(|v| v > 0),
    });
    let writable =
        online && !read_only && property.is_some_and(|p| p.access.iter().any(|a| a == "write"));
    let reason = if binding.is_none() {
        Some(match kind {
            Kind::Alarm => "此型号未提供可核实的即时警报控制。",
            Kind::Light => "此型号未提供可核实的补光灯控制。",
        })
    } else if !online {
        Some("摄像机离线。")
    } else if read_only {
        Some("此共享设备只有读取权限。")
    } else if !writable {
        Some("此功能仅支持读取。")
    } else if active.is_none() {
        Some("尚未读到设备的实际状态。")
    } else {
        None
    };
    Control {
        supported: binding.is_some(),
        active,
        remaining_seconds,
        writable,
        reason: reason.map(str::to_owned),
    }
}

pub fn snapshot(panel: &DevicePanel, read_only: bool, online: bool) -> Snapshot {
    Snapshot {
        alarm: control(panel, Kind::Alarm, read_only, online),
        light: control(panel, Kind::Light, read_only, online),
    }
}

pub fn read_properties(panel: &DevicePanel) -> Vec<(u32, u32)> {
    let mut properties = Vec::new();
    for kind in [Kind::Alarm, Kind::Light] {
        if let Some(b) = binding(panel, kind) {
            let key = (b.property.siid, b.property.piid);
            if !properties.contains(&key) {
                properties.push(key);
            }
        }
    }
    properties
}

pub async fn read(
    cloud: &Cloud,
    panel: &DevicePanel,
    read_only: bool,
    online: bool,
) -> Result<Snapshot> {
    if !online {
        return Ok(snapshot(panel, read_only, false));
    }
    let mut actual = panel.clone();
    for (siid, piid) in read_properties(panel) {
        let rows = cloud.read_panel_property(panel, siid, piid).await?;
        spec::apply_property_read(&mut actual, &rows, siid, piid);
    }
    Ok(snapshot(&actual, read_only, true))
}

pub fn prepare(
    panel: &DevicePanel,
    kind: Kind,
    active: bool,
    read_only: bool,
    online: bool,
) -> Result<Prepared> {
    if read_only {
        return Err(AppError::new(
            "permissionDenied",
            "此共享设备只有读取权限。",
            false,
        ));
    }
    if !online {
        return Err(AppError::new("offline", "摄像机离线。", true));
    }
    let b = binding(panel, kind)
        .ok_or_else(|| AppError::new("unsupported", "此型号没有已核实的此项控制。", false))?;
    if !b.property.access.iter().any(|a| a == "write") {
        return Err(AppError::new(
            "permissionDenied",
            "此功能仅支持读取。",
            false,
        ));
    }
    let value = match b.meaning {
        Meaning::Boolean => Value::Bool(active),
        Meaning::Seconds => Value::from(if active { 30u32 } else { 0u32 }),
    };
    spec::validate_value(b.property, &value)?;
    Ok(Prepared::Property {
        siid: b.property.siid,
        piid: b.property.piid,
        value,
    })
}
