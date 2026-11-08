use crate::{
    error::{AppError, Result},
    metadata_cache::{Key, MetadataCache},
    models::{Action, Device, DevicePanel, Property, Service, ValueLabel},
};
use serde_json::Value;
use std::{collections::HashMap, sync::Arc};
use tokio::sync::Mutex;

type ModelIndex = (Arc<Value>, Arc<HashMap<String, String>>);
type Template = (Arc<Value>, DevicePanel);
pub struct SpecRepository {
    metadata: MetadataCache,
    models: Mutex<Option<ModelIndex>>,
    templates: Mutex<HashMap<String, Template>>,
}
impl SpecRepository {
    #[cfg(test)]
    pub(crate) fn from_test_metadata(metadata: MetadataCache) -> Self {
        Self {
            metadata,
            models: Mutex::new(None),
            templates: Mutex::new(HashMap::new()),
        }
    }
    pub fn new() -> Result<Self> {
        Ok(Self {
            metadata: MetadataCache::new()?,
            models: Mutex::new(None),
            templates: Mutex::new(HashMap::new()),
        })
    }
    /// The UI compiler consumes the same authenticated-model description used
    /// by controls. No live values or device identity enter this public cache.
    pub(crate) async fn instance(&self, typ: &str) -> Result<Arc<Value>> {
        if !typ.starts_with("urn:miot-spec-v2:device:") {
            return Err(AppError::invalid("设备描述版本尚未支持。"));
        }
        self.metadata.get(Key::Instance(typ.to_owned())).await
    }
    pub async fn panel(&self, device: &Device) -> Result<DevicePanel> {
        if let Some(reason) = &device.unsupported_reason {
            return Ok(unsupported(device, reason));
        }
        let typ = if let Some(typ) = &device.spec_type {
            Some(typ.clone())
        } else {
            let body = self.metadata.get(Key::Registry).await?;
            let mut cached = self.models.lock().await;
            if cached
                .as_ref()
                .is_none_or(|(source, _)| !Arc::ptr_eq(source, &body))
            {
                let models = released_models(&body)?;
                *cached = Some((
                    body,
                    Arc::new(
                        models
                            .into_iter()
                            .map(|(model, (_, typ))| (model, typ))
                            .collect(),
                    ),
                ));
            }
            cached
                .as_ref()
                .and_then(|(_, models)| models.get(&device.model).cloned())
        };
        let Some(typ) = typ else {
            return Ok(unsupported(
                device,
                "此型号没有公开的MIoT描述，需要设备插件协议适配；当前无法提供可靠控制。",
            ));
        };
        if !typ.starts_with("urn:miot-spec-v2:device:") {
            return Ok(unsupported(
                device,
                "此设备描述类型不受当前MIoT通用控制器支持。",
            ));
        }
        let instance = self.instance(&typ).await?;
        let key = format!(
            "{}\n{}\n{}",
            typ,
            device.model,
            device
                .split_route
                .as_ref()
                .map_or(0, |route| route.service_iid)
        );
        let mut templates = self.templates.lock().await;
        if templates
            .get(&key)
            .is_none_or(|(body, _)| !Arc::ptr_eq(body, &instance))
        {
            let template = parse_panel(device, &instance)?;
            if templates.len() >= 256 {
                if let Some(old) = templates.keys().next().cloned() {
                    templates.remove(&old);
                }
            }
            templates.insert(key.clone(), (instance, template));
        }
        let mut panel = templates[&key].1.clone();
        // Shared public templates never retain the previous caller's identity.
        panel.did = device.did.clone();
        panel.model = device.model.clone();
        panel.route_did = device
            .split_route
            .as_ref()
            .map(|route| route.parent_did.clone());
        Ok(panel)
    }
}

/// The registry URL is explicitly filtered to released models. Some server
/// versions omit the redundant per-row status; explicit debug rows stay out.
fn released_models(body: &Value) -> Result<HashMap<String, (u64, String)>> {
    let mut models: HashMap<String, (u64, String)> = HashMap::new();
    for row in body["instances"]
        .as_array()
        .ok_or_else(AppError::protocol)?
    {
        if row["status"]
            .as_str()
            .is_some_and(|status| status != "released")
        {
            continue;
        }
        if let (Some(model), Some(typ)) = (row["model"].as_str(), row["type"].as_str()) {
            let version = row["version"]
                .as_u64()
                .or_else(|| row["version"].as_str().and_then(|v| v.parse().ok()))
                .unwrap_or(0);
            if models.get(model).is_none_or(|(old, _)| version >= *old) {
                models.insert(model.into(), (version, typ.into()));
            }
        }
    }
    Ok(models)
}
fn unsupported(device: &Device, reason: &str) -> DevicePanel {
    DevicePanel {
        did: device.did.clone(),
        model: device.model.clone(),
        spec_type: device.spec_type.clone(),
        services: vec![],
        unsupported_reason: Some(reason.into()),
        washer_runtime: None,
        purifier: None,
        dispenser: None,
        capabilities: None,
        route_did: None,
    }
}
fn name(v: &Value) -> String {
    v["type"]
        .as_str()
        .and_then(|s| s.split(':').nth(3))
        .unwrap_or("unknown")
        .to_owned()
}
fn description(v: &Value) -> String {
    v["description"].as_str().unwrap_or("未命名").to_owned()
}
fn iid(v: &Value) -> Result<u32> {
    v["iid"]
        .as_u64()
        .and_then(|n| u32::try_from(n).ok())
        .filter(|n| *n > 0)
        .ok_or_else(AppError::protocol)
}

pub fn parse_panel(device: &Device, spec: &Value) -> Result<DevicePanel> {
    let mut services = vec![];
    for raw in spec["services"].as_array().ok_or_else(AppError::protocol)? {
        // Some published BLE descriptors (qicyc.bike.tdp02z) put metadata
        // under IID 0. It is not an addressable service; never query or remap it.
        if raw["iid"] == 0 && name(raw) == "device-information" {
            continue;
        }
        let siid = iid(raw)?;
        // SPEC_V2 split.moduleId is the service IID, not a channel index.
        // Never expose other services (including sibling relays) on this panel.
        if device
            .split_route
            .as_ref()
            .is_some_and(|route| route.service_iid != siid)
        {
            continue;
        }
        let mut properties = vec![];
        for p in raw["properties"]
            .as_array()
            .map(Vec::as_slice)
            .unwrap_or(&[])
        {
            let access = p["access"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_str)
                        .map(str::to_owned)
                        .collect()
                })
                .unwrap_or_default();
            let value_list = p["value-list"].as_array().map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        Some(ValueLabel {
                            value: item.get("value")?.clone(),
                            description: description(item),
                        })
                    })
                    .collect()
            });
            let value_range = p["value-range"]
                .as_array()
                .map(|r| r.iter().filter_map(Value::as_f64).collect());
            properties.push(Property {
                siid,
                piid: iid(p)?,
                name: name(p),
                description: description(p),
                format: p["format"].as_str().unwrap_or("unknown").into(),
                access,
                unit: p["unit"].as_str().map(str::to_owned),
                value: None,
                code: None,
                last_reported: None,
                value_list,
                value_range,
                unsupported_reason: management_reason(&name(p)),
            });
        }
        let mut actions = vec![];
        for a in raw["actions"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
            let inputs: Vec<u32> = a["in"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_u64)
                        .filter_map(|v| u32::try_from(v).ok())
                        .collect()
                })
                .unwrap_or_default();
            let out = a["out"]
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter_map(Value::as_u64)
                        .filter_map(|v| u32::try_from(v).ok())
                        .collect()
                })
                .unwrap_or_default();
            let unsupported_reason = if let Some(reason) = management_reason(&name(a)) {
                Some(reason)
            } else if inputs.iter().any(|piid| {
                !properties
                    .iter()
                    .any(|p| p.piid == *piid && supported_format(&p.format))
            }) {
                Some("动作输入包含缺失或暂不支持的类型，无法可靠构造参数。".into())
            } else {
                None
            };
            actions.push(Action {
                siid,
                aiid: iid(a)?,
                name: name(a),
                description: description(a),
                inputs,
                out,
                unsupported_reason,
            });
        }
        services.push(Service {
            siid,
            name: name(raw),
            description: description(raw),
            properties,
            actions,
            events: raw["events"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
                .iter()
                .filter_map(|e| {
                    (|| -> Result<crate::models::DeviceEvent> {
                        Ok(crate::models::DeviceEvent {
                            siid,
                            eiid: iid(e)?,
                            name: name(e),
                            description: description(e),
                            arguments: e["arguments"]
                                .as_array()
                                .map(Vec::as_slice)
                                .unwrap_or(&[])
                                .iter()
                                .map(|v| {
                                    v.as_u64()
                                        .and_then(|n| u32::try_from(n).ok())
                                        .filter(|n| *n > 0)
                                        .ok_or_else(AppError::protocol)
                                })
                                .collect::<Result<Vec<_>>>()?,
                        })
                    })()
                    .ok()
                })
                .collect(),
        });
    }
    if device.split_route.is_some() && services.is_empty() {
        return Ok(unsupported(
            device,
            "MIoT 描述中没有拆分设备指定的服务，无法可靠控制。",
        ));
    }
    let mut panel = DevicePanel {
        did: device.did.clone(),
        model: device.model.clone(),
        spec_type: spec["type"].as_str().map(str::to_owned),
        services,
        unsupported_reason: None,
        washer_runtime: None,
        purifier: None,
        dispenser: None,
        capabilities: None,
        route_did: device
            .split_route
            .as_ref()
            .map(|route| route.parent_did.clone()),
    };
    panel.capabilities = Some(crate::capabilities::resolve_device_capabilities(&panel));
    Ok(panel)
}

pub fn supported_format(format: &str) -> bool {
    matches!(
        format,
        "bool"
            | "uint8"
            | "uint16"
            | "uint32"
            | "uint64"
            | "int8"
            | "int16"
            | "int32"
            | "int64"
            | "float"
            | "double"
            | "string"
    )
}

fn management_reason(name: &str) -> Option<String> {
    if [
        "factory-reset",
        "restore-factory-settings",
        "delete-device",
        "unbind",
        "unpair",
        "reset-wifi",
    ]
    .contains(&name)
    {
        Some("此能力涉及恢复出厂、解绑或配网，不在当前客户端的设备控制范围内。".into())
    } else {
        None
    }
}

pub fn validate_value(property: &Property, value: &Value) -> Result<()> {
    let valid = match property.format.as_str() {
        "bool" => value.is_boolean(),
        "string" => value.as_str().is_some_and(|s| s.len() <= 16384),
        "uint8" => value.as_u64().is_some_and(|v| v <= u8::MAX as u64),
        "uint16" => value.as_u64().is_some_and(|v| v <= u16::MAX as u64),
        "uint32" => value.as_u64().is_some_and(|v| v <= u32::MAX as u64),
        "uint64" => value.as_u64().is_some_and(|v| v <= 9_007_199_254_740_991),
        "int8" => value.as_i64().is_some_and(|v| i8::try_from(v).is_ok()),
        "int16" => value.as_i64().is_some_and(|v| i16::try_from(v).is_ok()),
        "int32" => value.as_i64().is_some_and(|v| i32::try_from(v).is_ok()),
        "int64" => value
            .as_i64()
            .is_some_and(|v| v.unsigned_abs() <= 9_007_199_254_740_991),
        "float" | "double" => value.as_f64().is_some_and(|v| v.is_finite()),
        _ => false,
    };
    if !valid {
        return Err(AppError::invalid("属性值与 MIoT 数据类型不匹配。"));
    }
    if let Some(list) = &property.value_list {
        if !list.iter().any(|item| values_equal(&item.value, value)) {
            return Err(AppError::invalid("属性值不在设备允许的选项中。"));
        }
    }
    if let (Some(range), Some(v)) = (&property.value_range, value.as_f64()) {
        if range.len() != 3
            || !range.iter().all(|v| v.is_finite())
            || range[2] <= 0.0
            || v < range[0] - 1e-8
            || v > range[1] + 1e-8
        {
            return Err(AppError::invalid("属性值超出 MIoT 范围。"));
        }
        let steps = (v - range[0]) / range[2];
        if (steps - steps.round()).abs() > 1e-6 {
            return Err(AppError::invalid("属性值不符合 MIoT 步长。"));
        }
    }
    Ok(())
}

pub fn values_equal(a: &Value, b: &Value) -> bool {
    if a == b {
        return true;
    }
    // Integers must compare exactly even for large counters and enumerations.
    if a.is_i64() || a.is_u64() || b.is_i64() || b.is_u64() {
        return match (a.as_f64(), b.as_f64()) {
            (Some(a), Some(b))
                if a.abs() <= 9_007_199_254_740_991.0 && b.abs() <= 9_007_199_254_740_991.0 =>
            {
                a == b
            }
            _ => false,
        };
    }
    match (a.as_f64(), b.as_f64()) {
        (Some(a), Some(b)) => a == b,
        _ => false,
    }
}

pub fn read_params(panel: &DevicePanel) -> Vec<Value> {
    panel
        .services
        .iter()
        .flat_map(|s| &s.properties)
        .filter(|p| p.access.iter().any(|a| a == "read"))
        .map(|p| serde_json::json!({"did":panel.control_did(),"siid":p.siid,"piid":p.piid}))
        .collect()
}

pub fn apply_reads(panel: &mut DevicePanel, rows: &[Value]) {
    apply_selected_reads(panel, rows, None);
}
pub fn apply_property_read(panel: &mut DevicePanel, rows: &[Value], siid: u32, piid: u32) {
    apply_selected_reads(panel, rows, Some((siid, piid)));
}
fn apply_selected_reads(panel: &mut DevicePanel, rows: &[Value], target: Option<(u32, u32)>) {
    let route_did = panel.control_did().to_owned();
    for property in panel.services.iter_mut().flat_map(|s| &mut s.properties) {
        if target.is_some_and(|(siid, piid)| property.siid != siid || property.piid != piid) {
            continue;
        }
        if !property.access.iter().any(|a| a == "read") {
            continue;
        }
        property.value = None;
        property.last_reported = None;
        let row = rows.iter().find(|row| {
            crate::models::id(&row["did"]) == route_did
                && row["siid"] == property.siid
                && row["piid"] == property.piid
        });
        property.code = Some(row.and_then(|r| r["code"].as_i64()).unwrap_or(-1));
        if property.code == Some(0) {
            property.value = row.and_then(|r| r.get("value")).cloned();
        }
    }
    crate::washer_runtime::refresh(panel);
    crate::purifier::refresh(panel);
    crate::dispenser_config::refresh(panel);
}

pub fn missing_read_params(panel: &DevicePanel) -> Vec<Value> {
    panel
        .services
        .iter()
        .flat_map(|s| &s.properties)
        .filter(|p| {
            p.access.iter().any(|a| a == "read")
                && (p.code != Some(0) || p.value.is_none())
                && (panel.model != crate::fryer::MODEL || crate::fryer::is_daily_property(p))
        })
        .map(|p| serde_json::json!({"did":panel.control_did(),"siid":p.siid,"piid":p.piid}))
        .collect()
}

/// Cache-only records never replace direct values or direct response codes.
pub fn apply_reported(panel: &mut DevicePanel, rows: &[Value], now: u64) {
    let route_did = panel.control_did().to_owned();
    let daily_fryer = panel.model == crate::fryer::MODEL;
    for p in panel.services.iter_mut().flat_map(|s| &mut s.properties) {
        if !p.access.iter().any(|a| a == "read")
            || p.code == Some(0) && p.value.is_some()
            || daily_fryer && !crate::fryer::is_daily_property(p)
        {
            continue;
        }
        let Some(row) = rows.iter().find(|row| {
            crate::models::id(&row["did"]) == route_did
                && row["siid"] == p.siid
                && row["piid"] == p.piid
                && row["code"] == 0
        }) else {
            continue;
        };
        let Some(value) = row.get("value").filter(|v| !v.is_null()) else {
            continue;
        };
        let valid = match p.format.as_str() {
            "bool" => value.is_boolean(),
            "string" => value.as_str().is_some_and(|s| s.len() <= 16384),
            "float" | "double" | "uint8" | "uint16" | "uint32" | "uint64" | "int8" | "int16"
            | "int32" | "int64" => value.as_f64().is_some_and(f64::is_finite),
            _ => false,
        };
        if !valid {
            continue;
        }
        p.last_reported = Some(crate::models::ReportedValue {
            value: value.clone(),
            // Actual cloud samples use epoch seconds. Do not reinterpret an
            // undocumented timestamp unit as a fresh device observation.
            updated_at: row["updateTime"]
                .as_u64()
                .filter(|t| *t >= 946_684_800 && *t <= now.saturating_add(300)),
            retrieved_at: now,
        });
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn released_registry_omitting_status_retains_real_models_and_excludes_debug() {
        let rows = serde_json::json!({"instances":[{"model":"xiaomi.airc.1r04r1","type":"old","version":1},{"model":"xiaomi.airc.1r04r1","type":"latest","version":2},{"model":"debug.device.x","type":"debug","status":"debug","version":4}]});
        let index = super::released_models(&rows).unwrap();
        assert_eq!(index["xiaomi.airc.1r04r1"].1, "latest");
        assert!(!index.contains_key("debug.device.x"));
    }

    use super::*;
    use serde_json::json;
    fn p() -> Property {
        Property {
            siid: 2,
            piid: 1,
            name: "x".into(),
            description: "x".into(),
            format: "uint8".into(),
            access: vec!["read".into(), "write".into()],
            unit: None,
            value: Some(json!(10)),
            code: Some(0),
            last_reported: None,
            value_list: None,
            value_range: Some(vec![0.0, 100.0, 5.0]),
            unsupported_reason: None,
        }
    }
    #[test]
    fn validates_type_bounds_and_step() {
        assert!(validate_value(&p(), &json!(25)).is_ok());
        for value in [json!(26), json!(105), json!(-5), json!(true), json!(25.5)] {
            assert!(validate_value(&p(), &value).is_err());
        }
    }
    #[test]
    fn missing_and_other_device_readings_cannot_reuse_old_value() {
        let mut panel = DevicePanel {
            did: "a".into(),
            model: "test".into(),
            spec_type: None,
            services: vec![Service {
                siid: 2,
                name: "s".into(),
                description: "s".into(),
                properties: vec![p()],
                actions: vec![],
                events: vec![],
            }],
            unsupported_reason: None,
            washer_runtime: None,
            purifier: None,
            dispenser: None,
            capabilities: None,
            route_did: None,
        };
        apply_reads(
            &mut panel,
            &[json!({"did":"other","siid":2,"piid":1,"code":0,"value":50})],
        );
        assert_eq!(panel.services[0].properties[0].value, None);
        assert_eq!(panel.services[0].properties[0].code, Some(-1));
        apply_reads(
            &mut panel,
            &[json!({"did":"a","siid":2,"piid":1,"code":1,"value":50})],
        );
        assert_eq!(panel.services[0].properties[0].value, None);
    }
    #[test]
    fn distinct_large_integer_readbacks_are_not_verified() {
        assert!(!values_equal(&json!(100000000), &json!(100000001)));
        assert!(values_equal(&json!(10), &json!(10.0)));
    }
    #[test]
    fn cached_records_preserve_live_failure_and_exact_physical_route() {
        let mut panel = DevicePanel {
            did: "logical".into(),
            model: "test".into(),
            spec_type: None,
            services: vec![Service {
                siid: 2,
                name: "sensor".into(),
                description: "sensor".into(),
                properties: vec![p()],
                actions: vec![],
                events: vec![],
            }],
            unsupported_reason: None,
            washer_runtime: None,
            purifier: None,
            dispenser: None,
            capabilities: None,
            route_did: Some("physical".into()),
        };
        apply_reads(
            &mut panel,
            &[json!({"did":"physical","siid":2,"piid":1,"code":-704010000})],
        );
        assert_eq!(
            missing_read_params(&panel),
            vec![json!({"did":"physical","siid":2,"piid":1})]
        );
        apply_reported(
            &mut panel,
            &[
                json!({"did":"logical","siid":2,"piid":1,"code":0,"value":25,"updateTime":1_793_000_000}),
            ],
            1_793_001_000,
        );
        assert!(panel.services[0].properties[0].last_reported.is_none());
        apply_reported(
            &mut panel,
            &[
                json!({"did":"physical","siid":2,"piid":1,"code":0,"value":25,"updateTime":1_793_000_000}),
            ],
            1_793_001_000,
        );
        let prop = &panel.services[0].properties[0];
        assert_eq!(prop.code, Some(-704010000));
        assert!(prop.value.is_none());
        assert_eq!(prop.last_reported.as_ref().unwrap().value, json!(25));
        assert_eq!(
            prop.last_reported.as_ref().unwrap().updated_at,
            Some(1_793_000_000)
        );
        apply_reads(
            &mut panel,
            &[json!({"did":"physical","siid":2,"piid":1,"code":0,"value":30})],
        );
        assert!(panel.services[0].properties[0].last_reported.is_none());
        apply_reported(
            &mut panel,
            &[json!({"did":"physical","siid":2,"piid":1,"code":0,"value":25})],
            1_793_001_000,
        );
        assert_eq!(panel.services[0].properties[0].value, Some(json!(30)));
        assert!(panel.services[0].properties[0].last_reported.is_none());
        assert!(missing_read_params(&panel).is_empty());
    }
    #[test]
    fn cached_record_rejects_wrong_type_and_does_not_invent_timestamp_units() {
        let mut panel = DevicePanel {
            did: "d".into(),
            model: "test".into(),
            spec_type: None,
            services: vec![Service {
                siid: 2,
                name: "sensor".into(),
                description: "sensor".into(),
                properties: vec![p()],
                actions: vec![],
                events: vec![],
            }],
            unsupported_reason: None,
            washer_runtime: None,
            purifier: None,
            dispenser: None,
            capabilities: None,
            route_did: None,
        };
        apply_reads(&mut panel, &[]);
        apply_reported(
            &mut panel,
            &[json!({"did":"d","siid":2,"piid":1,"code":0,"value":true})],
            1_793_001_000,
        );
        assert!(panel.services[0].properties[0].last_reported.is_none());
        apply_reported(
            &mut panel,
            &[
                json!({"did":"d","siid":2,"piid":1,"code":0,"value":12,"updateTime":1_793_000_000_000_u64}),
            ],
            1_793_001_000,
        );
        assert_eq!(
            panel.services[0].properties[0]
                .last_reported
                .as_ref()
                .unwrap()
                .updated_at,
            None
        );
        assert!(panel.services[0].properties[0].value.is_none());
    }
    #[test]
    fn split_panel_uses_exact_service_iid_and_physical_readbacks() {
        let device = Device {
            did: "logical.s2".into(),
            name: "split".into(),
            model: "test.switch.v1".into(),
            online: true,
            partner_id: None,
            firmware_version: None,
            plugin_version: None,
            hidden_on_home: false,
            split_display_available: false,
            shared_read_only: false,
            room_id: "room".into(),
            room_name: "room".into(),
            icon: None,
            product_icon: None,
            spec_type: None,
            unsupported_reason: None,
            control_group: None,
            control_group_name: None,
            control_service_id: Some(2),
            group_members: None,
            split_route: Some(crate::models::SplitRoute {
                parent_did: "physical".into(),
                service_iid: 2,
            }),
        };
        let spec_type = "urn:miot-spec-v2:device:switch:0000A000:test:1";
        let spec = json!({"type":spec_type,"services":[
            {"iid":2,"type":"urn:miot-spec-v2:service:switch:0000780C:test:1","description":"Left Switch","properties":[{"iid":1,"type":"urn:miot-spec-v2:property:on:00000006:test:1","description":"Switch","format":"bool","access":["read","write"]}],"actions":[{"iid":1,"type":"urn:miot-spec-v2:action:toggle:00002811:test:1","in":[],"out":[]}]},
            {"iid":3,"type":"urn:miot-spec-v2:service:switch:0000780C:test:1","description":"Other Switch","properties":[{"iid":1,"type":"urn:miot-spec-v2:property:on:00000006:test:1","format":"bool","access":["read","write"]}]}
        ]});
        let mut panel = parse_panel(&device, &spec).unwrap();
        assert_eq!(panel.did, "logical.s2");
        assert_eq!(panel.spec_type.as_deref(), Some(spec_type));
        assert_eq!(panel.services.len(), 1);
        assert_eq!(panel.services[0].siid, 2);
        assert_eq!(panel.services[0].actions.len(), 1);
        assert_eq!(
            read_params(&panel),
            vec![json!({"did":"physical","siid":2,"piid":1})]
        );
        apply_reads(
            &mut panel,
            &[json!({"did":"logical.s2","siid":2,"piid":1,"code":0,"value":true})],
        );
        assert_eq!(panel.services[0].properties[0].value, None);
        apply_reads(
            &mut panel,
            &[
                json!({"did":"physical","siid":3,"piid":1,"code":0,"value":true}),
                json!({"did":"physical","siid":2,"piid":1,"code":0,"value":false}),
            ],
        );
        assert_eq!(panel.services[0].properties[0].value, Some(json!(false)));
        let serialized = serde_json::to_string(&panel).unwrap();
        assert!(!serialized.contains("physical"));
        assert!(serialized.contains("specType"));
        let mut absent = device;
        absent.split_route.as_mut().unwrap().service_iid = 99;
        let unsupported = parse_panel(&absent, &spec).unwrap();
        assert!(unsupported.unsupported_reason.is_some());
        assert!(read_params(&unsupported).is_empty());
    }
    #[test]
    fn targeted_read_does_not_clear_unrelated_confirmed_properties() {
        let mut panel:DevicePanel=serde_json::from_value(serde_json::json!({"did":"test-device","model":"test.model","services":[{"siid":7,"name":"fan","description":"fan","actions":[],"properties":[{"siid":7,"piid":3,"name":"on","description":"power","format":"bool","access":["read","write"],"value":false,"code":0},{"siid":7,"piid":8,"name":"fan-level","description":"level","format":"uint8","access":["read","write"],"value":5,"code":0}]}]})).unwrap();
        apply_property_read(
            &mut panel,
            &[serde_json::json!({"did":"test-device","siid":7,"piid":3,"code":0,"value":true})],
            7,
            3,
        );
        assert_eq!(
            panel.services[0].properties[0].value,
            Some(serde_json::json!(true))
        );
        assert_eq!(
            panel.services[0].properties[1].value,
            Some(serde_json::json!(5))
        );
        apply_property_read(&mut panel, &[], 7, 3);
        assert_eq!(panel.services[0].properties[0].value, None);
        assert_eq!(
            panel.services[0].properties[1].value,
            Some(serde_json::json!(5))
        );
    }
    #[test]
    fn real_unowned_model_contracts_keep_permissions_enums_ranges_and_action_inputs() {
        use sha2::{Digest, Sha256};
        let numeric = |prop: &Property, value: f64| {
            if prop.format == "float" {
                serde_json::json!(value)
            } else if prop.format.starts_with("uint") {
                serde_json::json!(value as u64)
            } else {
                serde_json::json!(value as i64)
            }
        };
        let provenance: Value =
            serde_json::from_str(include_str!("fixtures/miot/provenance.json")).unwrap();
        for (category, raw, projected) in [
            (
                "air-purifier",
                include_str!("fixtures/miot/air-purifier.json"),
                include_str!("fixtures/miot/air-purifier.panel.json"),
            ),
            (
                "humidifier",
                include_str!("fixtures/miot/humidifier.json"),
                include_str!("fixtures/miot/humidifier.panel.json"),
            ),
            (
                "water-purifier",
                include_str!("fixtures/miot/water-purifier.json"),
                include_str!("fixtures/miot/water-purifier.panel.json"),
            ),
            (
                "vacuum",
                include_str!("fixtures/miot/vacuum.json"),
                include_str!("fixtures/miot/vacuum.panel.json"),
            ),
        ] {
            let source: Value = serde_json::from_str(raw).unwrap();
            let expected: DevicePanel = serde_json::from_str(projected).unwrap();
            let proof = provenance["records"]
                .as_array()
                .unwrap()
                .iter()
                .find(|r| r["category"] == category)
                .unwrap();
            assert_eq!(
                proof["sha256"],
                format!("{:x}", Sha256::digest(raw.as_bytes()))
            );
            assert_eq!(proof["physicalDeviceVerified"], false);
            let device:Device=serde_json::from_value(serde_json::json!({"did":"independent-model-fixture","name":category,"model":expected.model,"online":true,"roomId":"fixture","roomName":"fixture","specType":source["type"]})).unwrap();
            let panel = parse_panel(&device, &source).unwrap();
            assert!(panel.unsupported_reason.is_none());
            assert_eq!(panel.services.len(), expected.services.len());
            for prop in panel
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .filter(|p| p.access.iter().any(|a| a == "write") && p.unsupported_reason.is_none())
            {
                let value = prop
                    .value_list
                    .as_ref()
                    .and_then(|values| values.first())
                    .map(|item| item.value.clone())
                    .unwrap_or_else(|| {
                        if prop.format == "bool" {
                            serde_json::json!(false)
                        } else if prop.format == "string" {
                            serde_json::json!("model-contract-only")
                        } else {
                            numeric(prop, prop.value_range.as_ref().map_or(0.0, |r| r[0]))
                        }
                    });
                assert!(
                    validate_value(prop, &value).is_ok(),
                    "{category} {}",
                    prop.name
                );
                if let Some(range) = &prop.value_range {
                    assert!(validate_value(prop, &numeric(prop, range[1] + range[2])).is_err());
                }
            }
            for service in &panel.services {
                for action in &service.actions {
                    for input in &action.inputs {
                        assert!(
                            service.properties.iter().any(|p| p.piid == *input)
                                || action.unsupported_reason.is_some()
                        );
                    }
                }
            }
        }
    }
}
