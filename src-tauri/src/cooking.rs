use crate::{
    error::{AppError, Result},
    models::{Action, DevicePanel, Property, Service},
};
use serde::Deserialize;
use serde_json::Value;
use std::{collections::HashMap, sync::OnceLock};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Policy {
    ready: Vec<String>,
    cooking: Vec<String>,
    warming: Vec<String>,
    scheduled: Vec<String>,
    paused: Vec<String>,
    standard_fryer: HashMap<String, Vec<String>>,
    recipe_reservation_limit_minutes: u16,
    recipe_reservations: HashMap<String, String>,
    pressure_lids: HashMap<String, Lid>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Lid {
    spec_type: String,
    service: String,
    property: String,
    siid: u32,
    piid: u32,
    closed: Value,
}

fn policy() -> &'static Policy {
    static POLICY: OnceLock<Policy> = OnceLock::new();
    POLICY.get_or_init(|| serde_json::from_str(include_str!("../../src/cooking-policy.json")).expect("cooking policy"))
}

fn key(label: &str) -> String {
    label.chars().filter(|c| !c.is_whitespace() && !matches!(c, '_' | '-')).flat_map(char::to_lowercase).collect()
}

fn property<'a>(service: &'a Service, name: &str) -> Option<&'a Property> {
    let mut matches = service.properties.iter().filter(|p| p.name == name);
    let p = matches.next()?;
    (matches.next().is_none() && p.siid == service.siid && p.piid > 0
        && service.properties.iter().filter(|other| other.piid == p.piid).count() == 1
        && p.unsupported_reason.is_none() && p.access.iter().any(|a| a == "read"))
        .then_some(p)
}

fn reading(property: &Property) -> Option<&Value> {
    (property.code == Some(0)).then_some(property.value.as_ref()).flatten()
}

fn labels(property: &Property) -> impl Iterator<Item = String> + '_ {
    property.value_list.iter().flatten()
        .filter(|entry| Some(&entry.value) == reading(property))
        .flat_map(|entry| [Some(entry.description.as_str()), entry.localized_description.as_deref()])
        .flatten().map(key)
}

fn pressure_closed(panel: &DevicePanel) -> bool {
    let Some(lid) = policy().pressure_lids.get(&panel.model) else { return false };
    if panel.spec_type.as_deref() != Some(lid.spec_type.as_str())
        || panel.services.iter().filter(|s| s.siid == lid.siid).count() != 1 { return false }
    panel.services.iter().find(|s| s.siid == lid.siid && s.name == lid.service)
        .and_then(|s| property(s, &lid.property)).filter(|p| p.piid == lid.piid)
        .and_then(reading) == Some(&lid.closed)
}

fn decode_hex(value: &str) -> Option<Vec<u8>> {
    if value.is_empty() || value.len() % 2 != 0 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    (0..value.len()).step_by(2).map(|i| u8::from_str_radix(&value[i..i+2], 16).ok()).collect()
}

fn recipe(value: &Value) -> Option<Vec<u8>> {
    let value = value.as_str().filter(|value| value.len() == 364)?;
    let bytes = decode_hex(value)?;
    (recipe_crc(&bytes[..180]).to_be_bytes() == bytes[180..]).then_some(bytes)
}

fn recipe_crc(bytes: &[u8]) -> u16 {
    let mut crc = 0u16;
    for &byte in bytes {
        crc ^= u16::from(byte) << 8;
        for _ in 0..8 {
            crc = (crc << 1) ^ if crc & 0x8000 != 0 { 0x1021 } else { 0 };
        }
    }
    crc
}

fn validate_recipe_reservation(panel: &DevicePanel, service: &Service, action: &Action, inputs: &[Value]) -> Option<()> {
    if service.siid != 2 || action.aiid != 4 || action.inputs != [15,17] || inputs.len() != 2 {
        return None;
    }
    let read = |name, piid| property(service, name).filter(|p| p.piid == piid).and_then(reading);
    let stage = read("temperature", 19)?.as_u64()?;
    let remote = panel.services.iter().find(|s| s.siid == 8 && s.name == "recommended-standard")?;
    if read("recipe-type", 13)?.as_u64()? != 0 || stage > 10 || (6..=8).contains(&stage)
        || panel.services.iter().filter(|s| s.siid == 8).count() != 1
        || property(remote, "remote-controllable").filter(|p| p.piid == 1).and_then(reading).and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let source = recipe(read("recipe-command", 15)?)?;
    let requested = recipe(&inputs[0])?;
    let id = read("recipe-id", 12)?.as_str()?;
    let id = id.strip_prefix("0x").or_else(|| id.strip_prefix("0X")).unwrap_or(id);
    if id.is_empty() || id.len() > 8 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let id = u32::from_str_radix(id, 16).ok()?;
    let name = read("recipe-name", 17)?.as_str()?;
    let mode = property(service, "cook-mode").filter(|p| p.piid == 3)?;
    let mode = mode.value_list.iter().flatten().find(|entry| Some(&entry.value) == reading(mode))?;
    if name.len() > 256 || id == 0 || id != u32::from_be_bytes(source[3..7].try_into().ok()?)
        || inputs[1].as_str()? != name || source[7] & 0x40 == 0 || requested[14] & 0x80 == 0
        || source[..14] != requested[..14] || source[16..180] != requested[16..180] {
        return None;
    }
    let name = String::from_utf8(decode_hex(name)?).ok()?;
    if name != mode.localized_description.as_deref().unwrap_or(&mode.description).trim() {
        return None;
    }
    // The recipe embeds the finish delay with venting time subtracted.
    let duration = u16::from(source[8]) * 60 + u16::from(source[9]);
    let delay = u16::from(requested[14] & 0x7f) * 60 + u16::from(requested[15]);
    (source[9] < 60 && requested[15] < 60 && duration > 0 && delay > duration
        && delay + u16::from(source[28]) <= policy().recipe_reservation_limit_minutes).then_some(())
}

pub(crate) fn validate_command(panel: &DevicePanel, service: &Service, action: &Action, inputs: &[Value]) -> Result<()> {
    let category = crate::capabilities::category(panel.spec_type.as_deref());
    let Some(category) = category.as_deref() else { return Ok(()) };
    let standard = matches!(category, "air-fryer" | "multifunction-cooking-pot" | "electric-steamer");
    let reserve = category == "cooker" && action.name == "start-recipe-cook"
        && policy().recipe_reservations.get(&panel.model).is_some_and(|spec| Some(spec.as_str()) == panel.spec_type.as_deref());
    if (!standard && !matches!(category, "cooker" | "pressure-cooker")) || service.name != category
        || !(matches!(action.name.as_str(), "start-cook" | "cancel-cooking" | "resume-cook" | "pause") || reserve) {
        return Ok(());
    }
    let denied = || AppError::new("conflict", "设备当前状态不允许此操作。", false);
    if panel.services.iter().filter(|s| s.name == category || s.siid == service.siid).count() != 1
        || service.actions.iter().filter(|a| a.aiid == action.aiid || a.name == action.name).count() != 1 {
        return Err(denied());
    }
    let status = property(service, "status").ok_or_else(denied)?;
    let policy = policy();
    let phase = |phase: &str, list: &[String], state: &String| list.contains(state) || standard
        && policy.standard_fryer.get(phase).is_some_and(|aliases| aliases.contains(state));
    let accepted = match action.name.as_str() {
        "start-cook" | "start-recipe-cook" => labels(status).any(|state| phase("ready", &policy.ready, &state)),
        "resume-cook" => labels(status).any(|state| phase("paused", &policy.paused, &state)),
        "pause" => labels(status).any(|state| phase("cooking", &policy.cooking, &state)),
        _ => labels(status).any(|state| [("cooking", &policy.cooking), ("warming", &policy.warming),
            ("scheduled", &policy.scheduled), ("paused", &policy.paused)].iter().any(|(name, list)| phase(name, list, &state))),
    };
    if !accepted { return Err(denied()) }
    if matches!(action.name.as_str(), "cancel-cooking" | "pause") { return Ok(()) }
    if service.properties.iter().any(|p| p.name == "fault") {
        let fault = property(service, "fault").ok_or_else(denied)?;
        let clear = if fault.value_list.is_some() {
            labels(fault).any(|label| matches!(label.as_str(), "nofault" | "nofaults" | "无故障"))
        } else {
            reading(fault).and_then(Value::as_f64) == Some(0.0)
        };
        if !clear { return Err(denied()) }
    }
    if standard {
        for name in ["door-state", "lid-status", "pan-status"] {
            if service.properties.iter().any(|p| p.name == name) && !property(service, name)
                .is_some_and(|p| labels(p).any(|label| matches!(label.as_str(), "closed" | "close" | "closedinplace" | "已关闭" | "关闭" | "已合盖"))) {
                return Err(denied());
            }
        }
    }
    for lock in panel.services.iter().filter(|s| s.name == "physical-controls-locked") {
        for name in ["current-physical-control-lock", "physical-controls-locked"] {
            if lock.properties.iter().any(|p| p.name == name && p.access.iter().any(|a| a == "read"))
                && property(lock, name).and_then(reading).and_then(Value::as_bool) != Some(false) {
                return Err(denied());
            }
        }
    }
    if category == "pressure-cooker" && !pressure_closed(panel) { return Err(denied()) }
    if reserve { validate_recipe_reservation(panel, service, action, inputs).ok_or_else(denied)?; }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(model: &str) -> DevicePanel {
        let spec: Value = serde_json::from_str(include_str!("../../src/fixtures/cooking-detail-specs.json")).unwrap();
        let device = serde_json::from_value(json!({"did":"fixture","name":"fixture","model":model,
            "online":true,"roomId":"","roomName":""})).unwrap();
        let mut panel = crate::spec::parse_panel(&device, &spec[model]).unwrap();
        let primary = crate::capabilities::category(panel.spec_type.as_deref()).unwrap();
        for service in &mut panel.services {
            for p in &mut service.properties {
                let sample = match (service.name.as_str(), p.name.as_str()) {
                    (name, "status") if name == primary => Some(json!(1)),
                    (name, "fault") if name == primary => Some(json!(0)),
                    ("custom", "lid-status") | ("physical-controls-locked", "current-physical-control-lock") => Some(json!(false)),
                    _ => None,
                };
                if let Some(value) = sample { p.value = Some(value); p.code = Some(0); }
            }
        }
        panel
    }

    fn command(panel: &DevicePanel, name: &str) -> Result<()> {
        let service = panel.services.iter().find(|s| matches!(s.name.as_str(), "cooker" | "pressure-cooker")).unwrap();
        validate_command(panel, service, service.actions.iter().find(|a| a.name == name).unwrap(), &[])
    }

    #[test]
    fn pressure_start_requires_live_verified_closed_lid() {
        let mut panel = fixture("xiaomi.pre_cooker.eh2");
        assert!(command(&panel, "start-cook").is_ok());
        let lid = panel.services.iter_mut().flat_map(|s| &mut s.properties).find(|p| p.name == "lid-status").unwrap();
        lid.code = Some(-1);
        assert!(command(&panel, "start-cook").is_err());
        let lid = panel.services.iter_mut().flat_map(|s| &mut s.properties).find(|p| p.name == "lid-status").unwrap();
        lid.code = Some(0);
        lid.value = Some(json!(true));
        assert!(command(&panel, "start-cook").is_err());
    }

    #[test]
    fn cooker_requires_idle_to_start_and_active_to_cancel() {
        let mut panel = fixture("xiaomi.cooker.cmft3");
        assert!(command(&panel, "start-cook").is_ok());
        assert!(command(&panel, "cancel-cooking").is_err());
        let status = panel.services.iter_mut().flat_map(|s| &mut s.properties).find(|p| p.name == "status").unwrap();
        status.value = Some(json!(2));
        assert!(command(&panel, "start-cook").is_err());
        assert!(command(&panel, "cancel-cooking").is_ok());
    }

    #[test]
    fn cooker_reservation_requires_the_live_recipe_and_remote_interlocks() {
        let mut panel = fixture("xiaomi.cooker.cmby4");
        let sample: HashMap<String, Value> = serde_json::from_str(include_str!("../../src/fixtures/cooker-reservation-sample.json")).unwrap();
        for property in panel.services.iter_mut().flat_map(|s| &mut s.properties) {
            if let Some(value) = sample.get(&format!("{}:{}", property.siid, property.piid)) {
                property.value = Some(value.clone());
                property.code = Some(0);
            }
        }
        let validate = |panel: &DevicePanel, inputs: &[Value]| {
            let service = panel.services.iter().find(|s| s.siid == 2).unwrap();
            let action = service.actions.iter().find(|a| a.name == "start-recipe-cook").unwrap();
            validate_command(panel, service, action, inputs)
        };
        let mut bytes = recipe(&sample["2:15"]).unwrap();
        let encode = |data: &mut [u8]| {
            let crc = recipe_crc(&data[..180]).to_be_bytes();
            data[180..].copy_from_slice(&crc);
            json!(data.iter().map(|byte| format!("{byte:02x}")).collect::<String>())
        };
        bytes[14] = 0x82;
        let inputs = [encode(&mut bytes), sample["2:17"].clone()];
        assert!(validate(&panel, &inputs).is_ok());
        bytes[14] = 0x81;
        assert!(validate(&panel, &[encode(&mut bytes), inputs[1].clone()]).is_err());
        bytes[14] = 0x97;
        bytes[15] = 55;
        assert!(validate(&panel, &[encode(&mut bytes), inputs[1].clone()]).is_err());
        bytes[14] = 0x82;
        bytes[15] = 0;
        bytes[28] = 0;
        assert!(validate(&panel, &[encode(&mut bytes), inputs[1].clone()]).is_err());
        let remote = panel.services.iter_mut().find(|s| s.siid == 8).unwrap();
        remote.properties[0].code = Some(-1);
        assert!(validate(&panel, &inputs).is_err());
    }
}
