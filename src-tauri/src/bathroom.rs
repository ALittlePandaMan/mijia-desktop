use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

use crate::error::{AppError, Result};
use crate::models::{Action, DevicePanel, Property, Service};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ToiletInterlocks {
    seats: Vec<String>,
    seated: Vec<String>,
    modes: HashMap<String, Vec<String>>,
    seated_actions: HashMap<String, Vec<String>>,
    seated_properties: HashMap<String, Vec<String>>,
    flush_status: Vec<String>,
    flush_actions: Vec<String>,
    flush_properties: Vec<String>,
}

fn toilet_rules() -> &'static ToiletInterlocks {
    static RULES: OnceLock<ToiletInterlocks> = OnceLock::new();
    RULES.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/bathroom-interlocks.json"))
            .expect("toilet interlocks")
    })
}

fn is_toilet(panel: &DevicePanel) -> bool {
    crate::capabilities::category(panel.spec_type.as_deref()).as_deref() == Some("toilet")
}

fn normalize(label: &str) -> String {
    label
        .to_lowercase()
        .chars()
        .filter(|c| !c.is_whitespace() && !matches!(c, '-' | '_' | '.'))
        .collect()
}

fn labeled_value(property: &Property, value: &Value, labels: &[String]) -> bool {
    property.value_list.iter().flatten().any(|option| {
        &option.value == value
            && [
                Some(option.description.as_str()),
                option.localized_description.as_deref(),
            ]
            .into_iter()
            .flatten()
            .any(|label| labels.contains(&normalize(label)))
    })
}

fn state_property<'a>(panel: &'a DevicePanel, paths: &[String]) -> Option<&'a Property> {
    for path in paths {
        let (service, name) = path.split_once('.')?;
        if let Some(property) = panel
            .services
            .iter()
            .filter(|s| s.name == service)
            .flat_map(|s| s.properties.iter().filter(|p| p.siid == s.siid))
            .find(|p| {
                p.name == name
                    && p.unsupported_reason.is_none()
                    && p.access.iter().any(|a| a == "read")
            })
        {
            return Some(property);
        }
    }
    None
}

pub fn seating_property(panel: &DevicePanel) -> Option<&Property> {
    state_property(panel, &toilet_rules().seats)
}

pub fn flush_status(panel: &DevicePanel) -> Option<&Property> {
    state_property(panel, &toilet_rules().flush_status)
}

pub fn require_flush_ready(panel: &DevicePanel) -> Result<()> {
    if let Some(property) = flush_status(panel) {
        let idle = property.code == Some(0)
            && property.value.as_ref().is_some_and(|value| {
                property.value_list.iter().flatten().any(|choice| {
                    &choice.value == value && normalize(&choice.description) == "idle"
                })
            });
        if !idle {
            return Err(AppError::new("unavailable", "设备尚未确认可冲水。", true));
        }
    }
    Ok(())
}

pub fn require_seated(panel: &DevicePanel) -> Result<()> {
    let allowed = seating_property(panel)
        .filter(|p| p.code == Some(0))
        .and_then(|p| {
            let value = p.value.as_ref()?;
            crate::spec::validate_value(p, value).ok()?;
            Some(
                value == &Value::Bool(true)
                    || labeled_value(p, value, &toilet_rules().seated)
                    || (p.value_list.is_none()
                        && p.value_range.as_deref() == Some(&[0., 1., 1.])
                        && value.as_u64() == Some(1)),
            )
        });
    if allowed == Some(true) {
        return Ok(());
    }
    Err(AppError::new("unavailable", "设备尚未确认着座。", true))
}

pub fn action_requires_seat(panel: &DevicePanel, service: &Service, action: &Action) -> bool {
    is_toilet(panel)
        && toilet_rules()
            .seated_actions
            .values()
            .flatten()
            .any(|path| path == &format!("{}.{}", service.name, action.name))
}

pub fn flush_action(panel: &DevicePanel, service: &Service, action: &Action) -> bool {
    is_toilet(panel)
        && toilet_rules()
            .flush_actions
            .contains(&format!("{}.{}", service.name, action.name))
}

pub fn flush_property(panel: &DevicePanel, property: &Property) -> bool {
    is_toilet(panel)
        && panel
            .services
            .iter()
            .find(|s| s.siid == property.siid)
            .is_some_and(|service| {
                toilet_rules()
                    .flush_properties
                    .contains(&format!("{}.{}", service.name, property.name))
            })
}

pub fn property_requires_seat(panel: &DevicePanel, property: &Property, target: &Value) -> bool {
    if !is_toilet(panel) {
        return false;
    }
    let Some(service) = panel.services.iter().find(|s| s.siid == property.siid) else {
        return false;
    };
    let path = format!("{}.{}", service.name, property.name);
    let rules = toilet_rules();
    if matches!(path.as_str(), "toilet.mode" | "toilet-jomoo.work-mode") {
        return rules.modes.iter().any(|(role, labels)| {
            rules.seated_actions.contains_key(role) && labeled_value(property, target, labels)
        });
    }
    target == &Value::Bool(true)
        && rules
            .seated_properties
            .values()
            .flatten()
            .any(|p| p == &path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn public_601_bindings_gate_cleaning_and_flushing_on_direct_readings() {
        let device = serde_json::from_value(json!({
            "did": "fixture", "model": "nanmg.toilet.601", "name": "fixture",
            "online": true, "roomId": "fixture", "roomName": "fixture",
        }))
        .unwrap();
        let spec = serde_json::from_str(include_str!(
            "fixtures/catalog/toilet--nanmg.toilet.601.json"
        ))
        .unwrap();
        let mut panel = crate::spec::parse_panel(&device, &spec).unwrap();
        let function = panel
            .services
            .iter()
            .find(|s| s.name == "function")
            .unwrap();
        let wash = function
            .actions
            .iter()
            .find(|a| a.name == "ass-cleaning")
            .unwrap();
        let flush = function
            .actions
            .iter()
            .find(|a| a.name == "flushing")
            .unwrap();
        assert!(action_requires_seat(&panel, function, wash));
        assert!(!action_requires_seat(&panel, function, flush));
        assert!(flush_action(&panel, function, flush));
        let seat = seating_property(&panel).unwrap();
        let (ss, sp) = (seat.siid, seat.piid);
        let status = flush_status(&panel).unwrap();
        let (fs, fp) = (status.siid, status.piid);
        crate::spec::apply_reads(
            &mut panel,
            &[
                json!({"did":"fixture","siid":ss,"piid":sp,"code":0,"value":true}),
                json!({"did":"fixture","siid":fs,"piid":fp,"code":0,"value":2}),
            ],
        );
        assert!(require_seated(&panel).is_ok());
        assert!(require_flush_ready(&panel).is_err());
        crate::spec::apply_reads(
            &mut panel,
            &[
                json!({"did":"fixture","siid":ss,"piid":sp,"code":-1,"value":true}),
                json!({"did":"fixture","siid":fs,"piid":fp,"code":0,"value":0}),
            ],
        );
        assert!(require_seated(&panel).is_err());
        assert!(require_flush_ready(&panel).is_ok());
    }
}
