//! Public standard daily capabilities. The policy is shared verbatim with the
//! frontend; a manifest is presentation metadata, never authorization to write.
use crate::models::{DevicePanel, Property};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::sync::OnceLock;

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityProperty {
    pub role: String,
    pub siid: u32,
    pub piid: u32,
    pub service: String,
    pub name: String,
    pub label: String,
    pub kind: String,
    pub unit: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityAction {
    pub role: String,
    pub siid: u32,
    pub aiid: u32,
    pub service: String,
    pub name: String,
    pub label: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PrivateFeature {
    pub feature: String,
    pub reason: String,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCapabilities {
    pub version: u8,
    pub family: String,
    pub read_only: bool,
    pub category: Option<String>,
    pub profile: String,
    pub properties: Vec<CapabilityProperty>,
    pub actions: Vec<CapabilityAction>,
    pub private_features: Vec<PrivateFeature>,
    #[serde(default)]
    pub events: Vec<CapabilityEvent>,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CapabilityEvent {
    pub role: String,
    pub siid: u32,
    pub eiid: u32,
    pub service: String,
    pub name: String,
    pub arguments: Vec<u32>,
}

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct CategoryRule {
    #[serde(default)]
    family: String,
    #[serde(default)]
    read_only: bool,
    #[serde(default)]
    readings: HashMap<String, Vec<String>>,
    primary: Vec<String>,
    properties: HashMap<String, Vec<String>>,
    actions: HashMap<String, Vec<String>>,
    private_features: Vec<PrivateFeature>,
    #[serde(default)]
    safe_settings: HashMap<String, Vec<String>>,
    #[serde(default)]
    events: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ModelRule {
    spec_types: Vec<String>,
    primary: Vec<String>,
    properties: HashMap<String, Vec<String>>,
    readings: HashMap<String, Vec<String>>,
    events: HashMap<String, Vec<String>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rules {
    #[serde(default)]
    models: HashMap<String, ModelRule>,
    parameterized_actions: Vec<String>,
    action_input_names: Vec<String>,
    aliases: HashMap<String, String>,
    readings: Vec<String>,
    reading_services: Vec<String>,
    excluded_services: Vec<String>,
    labels: HashMap<String, String>,
    action_labels: HashMap<String, String>,
    categories: HashMap<String, CategoryRule>,
}

fn rules() -> &'static Rules {
    static RULES: OnceLock<Rules> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/device-capability-rules.json"))
            .expect("bundled daily capability policy must be valid")
    })
}

fn category(typ: Option<&str>) -> Option<String> {
    let mut parts = typ?.split(':');
    if !matches!(parts.next(), Some("urn"))
        || !matches!(parts.next(), Some("miot-spec-v2" | "miot-spec-v3"))
        || parts.next() != Some("device")
    {
        return None;
    }
    let name = parts.next()?;
    if name.is_empty()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        || parts.next().is_none()
    {
        return None;
    }
    Some(
        rules()
            .aliases
            .get(name)
            .map_or(name, String::as_str)
            .to_owned(),
    )
}
pub fn read_only_category(typ: Option<&str>) -> bool {
    category(typ)
        .and_then(|category| rules().categories.get(&category))
        .is_some_and(|rule| rule.read_only)
}

fn numeric(format: &str) -> bool {
    matches!(
        format,
        "uint8"
            | "uint16"
            | "uint32"
            | "uint64"
            | "int8"
            | "int16"
            | "int32"
            | "int64"
            | "float"
            | "double"
    )
}

/// A partial settings adapter never grants access to the remaining private
/// commands on a lock or stove. This check is independent of the renderer.
pub fn property_write_allowed(panel: &DevicePanel, siid: u32, piid: u32) -> bool {
    let caps = resolve_device_capabilities(panel);
    if caps.category.as_deref() == Some("washer") && panel.model != crate::washer::MODEL {
        return caps
            .properties
            .iter()
            .any(|p| p.siid == siid && p.piid == piid && p.kind != "reading");
    }
    !caps.read_only
        && (!matches!(
            caps.category.as_deref(),
            Some("lock" | "integrated-stove" | "smart-stove")
        ) || caps
            .properties
            .iter()
            .any(|p| p.siid == siid && p.piid == piid && p.kind != "reading"))
}

pub fn action_write_allowed(panel: &DevicePanel, _siid: u32, _aiid: u32) -> bool {
    let caps = resolve_device_capabilities(panel);
    !caps.read_only
        && !matches!(
            caps.category.as_deref(),
            Some("lock" | "integrated-stove" | "smart-stove")
        )
}
pub fn validate_appliance_action(
    panel: &DevicePanel,
    siid: u32,
    aiid: u32,
) -> crate::error::Result<()> {
    if panel.model == crate::washer::MODEL
        || category(panel.spec_type.as_deref()).as_deref() != Some("washer")
    {
        return Ok(());
    }
    let invalid = || {
        crate::error::AppError::invalid("当前洗衣状态不支持此操作，请检查故障、童锁及运行状态。")
    };
    let s = panel
        .services
        .iter()
        .find(|s| s.siid == siid && s.name == "washer")
        .ok_or_else(invalid)?;
    let a = s
        .actions
        .iter()
        .find(|a| a.aiid == aiid && a.inputs.is_empty())
        .ok_or_else(invalid)?;
    let meaning = |name: &str| {
        s.properties
            .iter()
            .find(|p| p.name == name && p.code == Some(0) && p.access.iter().any(|a| a == "read"))
            .and_then(|p| {
                p.value_list
                    .as_ref()?
                    .iter()
                    .find(|v| p.value.as_ref() == Some(&v.value))
            })
            .map(|v| v.description.trim().to_lowercase())
    };
    if !matches!(meaning("fault").as_deref(), Some("no faults" | "no fault")) {
        return Err(invalid());
    }
    if panel
        .services
        .iter()
        .filter(|s| s.name == "physical-controls-locked")
        .flat_map(|s| &s.properties)
        .any(|p| {
            p.name == "physical-controls-locked"
                && (p.code != Some(0) || p.value != Some(Value::Bool(false)))
        })
    {
        return Err(invalid());
    }
    let status = meaning("status");
    let allowed = match a.name.as_str() {
        "pause" => status.as_deref() == Some("busy"),
        "start-wash" => status.as_deref() == Some("paused"),
        "stop-washing" => matches!(status.as_deref(), Some("busy" | "paused")),
        _ => false,
    };
    if allowed {
        Ok(())
    } else {
        Err(invalid())
    }
}
pub fn motion_feedback(panel: &DevicePanel, siid: u32) -> Option<&Property> {
    panel
        .services
        .iter()
        .find(|s| s.siid == siid)?
        .properties
        .iter()
        .find(|p| {
            p.access.iter().any(|a| a == "read")
                && (p.name == "current-position" && valid_range(p)
                    || p.name == "status" && valid_choices(p))
        })
}
fn motion_command(panel: &DevicePanel, p: &Property) -> bool {
    matches!(
        category(panel.spec_type.as_deref()).as_deref(),
        Some("airer" | "curtain")
    ) && p.name == "motor-control"
        && p.access.iter().any(|a| a == "write")
        && !p.access.iter().any(|a| a == "read")
        && valid_choices(p)
        && motion_feedback(panel, p.siid).is_some()
        && p.value_list.as_ref().is_some_and(|vs| {
            vs.iter().all(|v| {
                matches!(
                    v.description.trim().to_lowercase().as_str(),
                    "up" | "down" | "open" | "close" | "pause" | "stop" | "raise" | "lower"
                )
            })
        })
}

fn scalar(value: &Value, format: &str) -> bool {
    match format {
        "bool" => value.is_boolean(),
        "string" => value.is_string(),
        _ => numeric(format) && value.as_f64().is_some_and(f64::is_finite),
    }
}

fn kind(property: &Property) -> Option<&'static str> {
    if property.unsupported_reason.is_some()
        || !matches!(property.format.as_str(), "bool" | "string") && !numeric(&property.format)
    {
        return None;
    }
    if property.name == "on" && property.format != "bool" {
        return None;
    }
    if [
        "temperature",
        "target-temperature",
        "refrigerator-temperature",
        "freezer-temperature",
        "refrigerating-room",
        "freezing-room",
        "refrigerator-temperature-set",
        "freezer-temperature-set",
    ]
    .contains(&property.name.as_str())
        && (!numeric(&property.format)
            || !matches!(
                property.unit.as_deref(),
                Some("celsius" | "fahrenheit" | "kelvin")
            ))
    {
        return None;
    }
    if ["relative-humidity", "target-humidity"].contains(&property.name.as_str())
        && (!numeric(&property.format)
            || !matches!(property.unit.as_deref(), Some("percentage" | "percent")))
    {
        return None;
    }
    let readable = property.access.iter().any(|access| access == "read");
    if readable && property.access.iter().any(|access| access == "write") {
        if property.format == "bool"
            && property.value_list.is_none()
            && property.value_range.is_none()
        {
            return Some(if property.name == "on" {
                "power"
            } else {
                "toggle"
            });
        }
        if let Some(choices) = &property.value_list {
            if !choices.is_empty()
                && property.value_range.is_none()
                && choices
                    .iter()
                    .all(|choice| scalar(&choice.value, &property.format))
                && choices.iter().enumerate().all(|(index, choice)| {
                    choices[..index]
                        .iter()
                        .all(|other| other.value != choice.value)
                })
            {
                return Some("enum");
            }
        }
        if numeric(&property.format) && property.value_list.is_none() {
            if let Some(range) = &property.value_range {
                if range.len() == 3
                    && range.iter().all(|value| value.is_finite())
                    && range[1] > range[0]
                    && range[2] > 0.0
                {
                    return Some("range");
                }
            }
        }
    }
    readable.then_some("reading")
}

fn valid_choices(p: &Property) -> bool {
    p.value_range.is_none()
        && p.value_list.as_ref().is_some_and(|v| {
            !v.is_empty()
                && v.iter().all(|c| scalar(&c.value, &p.format))
                && v.iter()
                    .enumerate()
                    .all(|(i, c)| v[..i].iter().all(|other| other.value != c.value))
        })
}
fn valid_range(p: &Property) -> bool {
    numeric(&p.format)
        && p.value_list.is_none()
        && p.value_range.as_ref().is_some_and(|r| {
            r.len() == 3 && r.iter().all(|v| v.is_finite()) && r[1] > r[0] && r[2] > 0.0
        })
}
pub fn resolve_device_capabilities(panel: &DevicePanel) -> DeviceCapabilities {
    let mut result = DeviceCapabilities {
        version: 2,
        family: "other".into(),
        read_only: false,
        category: category(panel.spec_type.as_deref()),
        profile: "none".into(),
        properties: vec![],
        actions: vec![],
        private_features: vec![],
        events: vec![],
    };
    let rules = rules();
    let Some(rule) = result
        .category
        .as_ref()
        .and_then(|name| rules.categories.get(name))
        .cloned()
    else {
        return result;
    };
    let mut rule = rule;
    if let Some(model) = rules.models.get(&panel.model).filter(|m| {
        panel
            .spec_type
            .as_ref()
            .is_some_and(|t| m.spec_types.contains(t))
    }) {
        rule.primary.extend(model.primary.clone());
        rule.properties.extend(model.properties.clone());
        rule.readings.extend(model.readings.clone());
        rule.events.extend(model.events.clone());
    }
    result.family = if rule.family.is_empty() {
        "other".into()
    } else {
        rule.family.clone()
    };
    result.read_only = rule.read_only;
    if panel.unsupported_reason.is_some() {
        return result;
    }
    result.private_features = rule.private_features.clone();
    if result.category.as_deref() == Some("television")
        && panel
            .services
            .iter()
            .any(|service| service.name == "ir-tv-control")
    {
        result.private_features.push(PrivateFeature {
            feature: "ir-remote".into(),
            reason: "此型号的电视按键采用红外专用协议，需已验证的码库与编码适配器，不能套用其他电视指令。".into(),
        });
    }
    if !panel
        .services
        .iter()
        .any(|service| service.siid > 0 && rule.primary.contains(&service.name))
    {
        return result;
    }
    let mut services = HashMap::<u32, usize>::new();
    let mut properties = HashMap::<(u32, u32), usize>::new();
    let mut actions = HashMap::<(u32, u32), usize>::new();
    for service in &panel.services {
        *services.entry(service.siid).or_default() += 1;
        for property in &service.properties {
            *properties
                .entry((property.siid, property.piid))
                .or_default() += 1;
        }
        for action in &service.actions {
            if result.category.as_deref() == Some("washer") && panel.model != crate::washer::MODEL {
                let choices = |name: &str| {
                    service
                        .properties
                        .iter()
                        .find(|p| p.name == name && p.access.iter().any(|a| a == "read"))
                        .and_then(|p| p.value_list.as_ref())
                        .map(|v| {
                            v.iter()
                                .map(|v| v.description.trim().to_lowercase())
                                .collect::<Vec<_>>()
                        })
                        .unwrap_or_default()
                };
                if !choices("fault")
                    .iter()
                    .any(|v| matches!(v.as_str(), "no fault" | "no faults"))
                    || !choices("status").iter().any(|v| {
                        v == if action.name == "start-wash" {
                            "paused"
                        } else {
                            "busy"
                        }
                    })
                {
                    continue;
                }
            }
            *actions.entry((action.siid, action.aiid)).or_default() += 1;
        }
    }
    for service in &panel.services {
        if service.siid == 0
            || services.get(&service.siid) != Some(&1)
            || rules.excluded_services.contains(&service.name)
        {
            continue;
        }
        for property in &service.properties {
            if property.siid != service.siid
                || property.piid == 0
                || properties.get(&(property.siid, property.piid)) != Some(&1)
            {
                continue;
            }
            let Some(kind) =
                kind(property).or_else(|| motion_command(panel, property).then_some("command"))
            else {
                if property.name == "motor-control"
                    && rule
                        .properties
                        .get(&service.name)
                        .is_some_and(|names| names.contains(&property.name))
                    && property.access.iter().any(|access| access == "write")
                    && !property.access.iter().any(|access| access == "read")
                    && !result
                        .private_features
                        .iter()
                        .any(|feature| feature.feature == "movement-readback")
                {
                    result.private_features.push(PrivateFeature {
                        feature: "movement-readback".into(),
                        reason: "此型号的升降或开合指令没有属性回读能力；需验证独立运动状态后才能提供可靠控制。".into(),
                    });
                }
                continue;
            };
            let control = (!rule.read_only
                || rule
                    .safe_settings
                    .get(&service.name)
                    .is_some_and(|ps| ps.contains(&property.name)))
                && rule
                    .properties
                    .get(&service.name)
                    .is_some_and(|names| names.contains(&property.name));
            let reading_service = rule.primary.contains(&service.name)
                || rule.properties.contains_key(&service.name)
                || rules.reading_services.contains(&service.name);
            let reading = property.access.iter().any(|access| access == "read")
                && (rule
                    .readings
                    .get(&service.name)
                    .is_some_and(|names| names.contains(&property.name))
                    || reading_service
                        && !property.access.iter().any(|access| access == "write")
                        && rules.readings.contains(&property.name));
            if result.category.as_deref() == Some("switch")
                && !(service.name == "switch" && property.name == "on")
            {
                continue;
            }
            if result.category.as_deref() == Some("camera")
                && !(service.name == "camera-control"
                    && ["on", "status", "fault"].contains(&property.name.as_str())
                    || service.name == "battery" && property.name == "battery-level")
            {
                continue;
            }
            if !control && !reading {
                continue;
            }
            result.properties.push(CapabilityProperty {
                role: format!("{}.{}", service.name, property.name),
                siid: property.siid,
                piid: property.piid,
                service: service.name.clone(),
                name: property.name.clone(),
                label: rules
                    .labels
                    .get(&property.name)
                    .unwrap_or(&property.description)
                    .clone(),
                kind: if control { kind } else { "reading" }.into(),
                unit: property.unit.clone(),
            });
        }
        for event in &service.events {
            if event.siid != service.siid
                || event.eiid == 0
                || !rule
                    .events
                    .get(&service.name)
                    .is_some_and(|names| names.contains(&event.name))
                || service
                    .events
                    .iter()
                    .filter(|e| e.eiid == event.eiid)
                    .count()
                    != 1
            {
                continue;
            }
            let mut seen = std::collections::HashSet::new();
            if !event.arguments.iter().all(|id| {
                seen.insert(*id) && service.properties.iter().filter(|p| p.piid == *id).count() == 1
            }) {
                continue;
            }
            result.events.push(CapabilityEvent {
                role: format!("{}.{}", service.name, event.name),
                siid: service.siid,
                eiid: event.eiid,
                service: service.name.clone(),
                name: event.name.clone(),
                arguments: event.arguments.clone(),
            });
        }
        for action in &service.actions {
            if action.siid != service.siid
                || action.aiid == 0
                || actions.get(&(action.siid, action.aiid)) != Some(&1)
                || action.unsupported_reason.is_some()
                || rule.read_only
                || !rule
                    .actions
                    .get(&service.name)
                    .is_some_and(|names| names.contains(&action.name))
            {
                continue;
            }
            if !action.inputs.is_empty() {
                let role = format!(
                    "{}.{}",
                    result.category.as_deref().unwrap_or(""),
                    action.name
                );
                let mut seen = std::collections::HashSet::new();
                if !rules.parameterized_actions.contains(&role)
                    || !action.inputs.iter().all(|iid| {
                        if !seen.insert(*iid) {
                            return false;
                        }
                        let props: Vec<_> = service
                            .properties
                            .iter()
                            .filter(|p| p.piid == *iid && p.siid == service.siid)
                            .collect();
                        props.len() == 1
                            && rules.action_input_names.contains(&props[0].name)
                            && (valid_choices(props[0]) || valid_range(props[0]))
                    })
                {
                    continue;
                }
            }
            result.actions.push(CapabilityAction {
                role: format!("{}.{}", service.name, action.name),
                siid: action.siid,
                aiid: action.aiid,
                service: service.name.clone(),
                name: action.name.clone(),
                label: rules
                    .action_labels
                    .get(&action.name)
                    .unwrap_or(&action.description)
                    .clone(),
            });
        }
    }
    result.read_only = rule.read_only && !result.properties.iter().any(|p| p.kind != "reading");
    if !result.properties.is_empty() || !result.actions.is_empty() || !result.events.is_empty() {
        result.profile = "standard".into();
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::Device, spec::parse_panel};
    use serde_json::json;
    use sha2::{Digest, Sha256};

    fn panel(raw: &str, model: &str) -> DevicePanel {
        let raw: Value = serde_json::from_str(raw).unwrap();
        let device: Device = serde_json::from_value(json!({"did":"public-fixture","name":model,"model":model,"online":true,"roomId":"","roomName":"","icon":null,"specType":raw["type"],"unsupportedReason":null})).unwrap();
        parse_panel(&device, &raw).unwrap_or_else(|e| panic!("{model}: {e:?}"))
    }

    #[test]
    fn published_multiple_fridge_compartments_keep_their_real_ids() {
        let panel = panel(
            include_str!("fixtures/compatibility/fridge--viomi.fridge.b1.json"),
            "viomi.fridge.b1",
        );
        let caps = resolve_device_capabilities(&panel);
        let targets: Vec<_> = caps
            .properties
            .iter()
            .filter(|p| p.name == "target-temperature")
            .map(|p| (p.siid, p.piid))
            .collect();
        assert_eq!(targets, vec![(3, 2), (4, 2)]);
        assert!(!caps
            .properties
            .iter()
            .any(|p| p.service == "fridge-factory"));
    }

    #[test]
    fn private_network_is_not_inferred_from_public_router_fields() {
        let panel = panel(
            include_str!("fixtures/compatibility/router--isa.router.mr01hl.json"),
            "isa.router.mr01hl",
        );
        let caps = resolve_device_capabilities(&panel);
        assert!(caps.properties.iter().all(|p| p.kind == "reading"));
        assert!(caps.actions.is_empty());
        assert!(caps
            .private_features
            .iter()
            .any(|p| p.feature == "router-network"));
    }

    #[test]
    fn write_only_movement_does_not_masquerade_as_readable_target() {
        let panel = panel(
            include_str!("fixtures/compatibility/airer--dooya.airer.2m.json"),
            "dooya.airer.2m",
        );
        let caps = resolve_device_capabilities(&panel);
        assert!(caps
            .properties
            .iter()
            .any(|p| p.siid == 3 && p.piid == 1 && p.kind == "power"));
        assert!(caps
            .properties
            .iter()
            .any(|p| p.name == "motor-control" && p.kind == "command"));
        let mut missing = panel.clone();
        for service in &mut missing.services {
            service
                .properties
                .retain(|p| p.name != "status" && p.name != "current-position");
        }
        assert!(!resolve_device_capabilities(&missing)
            .properties
            .iter()
            .any(|p| p.name == "motor-control"));
    }

    #[test]
    fn published_model_matrix_is_identical_to_the_typescript_resolver() {
        let report: Value = serde_json::from_str(include_str!(
            "fixtures/regression/device-capabilities-matrix.json"
        ))
        .unwrap();
        assert_eq!(report["passed"], true);
        assert_eq!(report["models"], 74);
        let hash = |bytes: &[u8]| format!("{:x}", Sha256::digest(bytes));
        assert_eq!(
            report["policySha256"],
            hash(include_bytes!("../../src/device-capability-rules.json"))
        );
        assert_eq!(
            report["resolverSha256"],
            hash(include_bytes!("../../src/device-capabilities.ts"))
        );
        let fixtures =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/fixtures/compatibility");
        for record in report["records"].as_array().unwrap() {
            let model = record["model"].as_str().unwrap();
            let raw =
                std::fs::read_to_string(fixtures.join(record["file"].as_str().unwrap())).unwrap();
            assert_eq!(
                record["sha256"],
                hash(raw.as_bytes()),
                "published fixture changed: {model}"
            );
            let actual = resolve_device_capabilities(&panel(&raw, model));
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                record["capabilities"],
                "frontend/backend semantic binding mismatch: {model}"
            );
        }
    }
    #[test]
    fn complete_catalog_matches_the_frontend_without_private_inference() {
        let report: Value =
            serde_json::from_str(include_str!("fixtures/regression/device-catalog-matrix.json"))
                .unwrap();
        assert_eq!(report["passed"], true);
        assert_eq!(report["models"], 303);
        assert_eq!(
            report["policySha256"],
            format!(
                "{:x}",
                Sha256::digest(include_bytes!("../../src/device-capability-rules.json"))
            )
        );
        let fixtures =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/fixtures/catalog");
        for row in report["records"].as_array().unwrap() {
            let raw =
                std::fs::read_to_string(fixtures.join(row["file"].as_str().unwrap())).unwrap();
            assert_eq!(
                row["sha256"],
                format!("{:x}", Sha256::digest(raw.as_bytes()))
            );
            let actual = resolve_device_capabilities(&panel(&raw, row["model"].as_str().unwrap()));
            assert_eq!(
                serde_json::to_value(actual).unwrap(),
                row["capabilities"],
                "{}",
                row["model"]
            );
        }
    }
}

#[cfg(test)]
mod expansion_tests {
    use super::*;
    use serde_json::json;
    fn panel(model: &str, file: &str) -> DevicePanel {
        let device:crate::models::Device=serde_json::from_value(json!({"did":"fixture","name":"fixture","model":model,"online":true,"roomId":"","roomName":""})).unwrap();
        let raw = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("src/fixtures/expansion")
                .join(file),
        )
        .unwrap();
        crate::spec::parse_panel(&device, &serde_json::from_str(&raw).unwrap()).unwrap()
    }
    #[test]
    fn all_pinned_new_families_match_the_frontend() {
        let report: Value =
            serde_json::from_str(include_str!("fixtures/regression/device-expansion-matrix.json"))
                .unwrap();
        for row in report["records"].as_array().unwrap() {
            let p = panel(
                row["model"].as_str().unwrap(),
                row["file"].as_str().unwrap(),
            );
            assert_eq!(
                serde_json::to_value(resolve_device_capabilities(&p)).unwrap(),
                row["capabilities"],
                "{}",
                p.model
            );
        }
    }
    #[test]
    fn ordinary_lock_settings_never_authorize_credentials_or_unlock() {
        let p = panel("xiaomi.lock.m40", "xiaomi.lock.m40.json");
        let c = resolve_device_capabilities(&p);
        let setting = c
            .properties
            .iter()
            .find(|b| b.role == "lock-volume-management.door-operation-volume")
            .unwrap();
        assert!(property_write_allowed(&p, setting.siid, setting.piid));
        for service in &p.services {
            for action in &service.actions {
                assert!(!action_write_allowed(&p, action.siid, action.aiid));
            }
            for prop in &service.properties {
                if ["credential", "anti-lock", "child-lock"].contains(&prop.name.as_str()) {
                    assert!(!property_write_allowed(&p, prop.siid, prop.piid));
                }
            }
        }
    }
    #[test]
    fn stove_actions_remain_unavailable_even_when_the_spec_declares_them() {
        let p = panel("chunmi.i_stove.x1", "chunmi.i_stove.x1.json");
        for s in &p.services {
            for a in &s.actions {
                assert!(!action_write_allowed(&p, a.siid, a.aiid));
            }
        }
        assert!(resolve_device_capabilities(&p)
            .properties
            .iter()
            .all(|p| p.kind == "reading"));
    }
}
