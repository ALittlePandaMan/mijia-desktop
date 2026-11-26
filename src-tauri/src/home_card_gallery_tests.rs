use super::*;
use super::tests::config;

fn sample(model: &str, spec: &Value) -> (Device, DevicePanel) {
    let device: Device = serde_json::from_value(json!({
        "did": "gallery-device", "name": model, "model": model, "specType": spec["type"],
        "online": true, "roomId": "gallery-room", "roomName": "示例房间"
    })).unwrap();
    let panel = crate::spec::parse_panel(&device, spec).unwrap_or_else(|_| {
        serde_json::from_value(json!({"did":device.did,"model":model,"specType":spec["type"],
            "services":[], "unsupportedReason":"此公开型号的 Spec 无法绑定"})).unwrap()
    });
    (device, panel)
}

fn readings(plan: &PresentationPlan, powered: bool) -> Values {
    let mut values = Values::new();
    for control in &plan.controls {
        let gate = &control.gate;
        for property in std::iter::once(&gate.primary).chain(gate.dependencies.iter().map(|d| &d.property)) {
            let value = if property.name == "on" {
                power_value(property, powered)
            } else {
                property.value_list.as_ref().and_then(|list| list.first()).map(|entry| entry.value.clone())
                    .or_else(|| property.value_range.as_ref().and_then(|range| range.first()).map(|v| {
                        if property.format == "float" { json!(v) } else { json!(*v as i64) }
                    }))
                    .or_else(|| match property.format.as_str() {
                        "bool" => Some(json!(false)),
                        "uint8" | "uint16" | "uint32" | "int8" | "int16" | "int32" | "float" => Some(json!(0)),
                        _ => None,
                    })
            };
            if let Some(value) = value { values.insert(key(&gate.device, property), value); }
        }
    }
    values
}

#[test]
fn climate_partner_large_card_never_writes_or_depends_on_the_socket_relay() {
    let spec: Value = serde_json::from_str(include_str!("fixtures/catalog/air-condition-outlet--cuco.acpartner.cp6.json")).unwrap();
    let (device, panel) = sample("cuco.acpartner.cp6", &spec);
    let config = config();
    let plan = compile(&config, &device, &panel).unwrap();
    assert_eq!(plan.controls[0].gate.primary.siid, 3);
    assert_eq!(plan.controls[0].gate.target.siid, 3);
    assert_eq!(plan.controls[1].gate.primary.name, "target-temperature");
    assert_eq!(plan.controls[1].appearance, Some("temperature"));
    let dependency = &plan.controls[1].gate.dependencies[0].property;
    assert_eq!((dependency.siid, dependency.piid), (3, 1));
    let on = describe_control(&plan.controls[1], &readings(&plan, true));
    assert!(on.enabled, "{:?}", on.reason);
    assert!(!describe_control(&plan.controls[1], &readings(&plan, false)).enabled);
    let shared = Device { shared_read_only: true, ..device.clone() };
    let shared_plan = compile(&config, &shared, &panel).unwrap();
    assert!(!describe_control(&shared_plan.controls[1], &readings(&shared_plan, true)).enabled);

    let mut relay_only = panel.clone();
    relay_only.services.retain(|service| service.name != "air-conditioner");
    assert!(compile(&config, &device, &relay_only).is_none());
    let mut ambiguous = panel.clone();
    ambiguous.services.push(panel.services.iter().find(|service| service.name == "air-conditioner").unwrap().clone());
    assert!(compile(&config, &device, &ambiguous).is_none());
    assert!(!crate::energy::supported(&device, &panel));
    let spec: Value = serde_json::from_str(include_str!("fixtures/gallery/air-conditioner--lumi.acpartner.mcn02.json")).unwrap();
    let (device, panel) = sample("lumi.acpartner.mcn02", &spec);
    assert!(crate::energy::supported(&device, &panel));
    assert!(!crate::energy::supported(&Device { model: "other.airc".into(), ..device }, &DevicePanel { model: "other.airc".into(), ..panel }));
}

#[test]
fn standard_layout_identity_and_unavailable_reads() {
    let spec = serde_json::from_str(include_str!("fixtures/expansion/zhimi.fan.za1.json")).unwrap();
    let (device, panel) = sample("zhimi.fan.za1", &spec);
    let config = config();
    let plan = compile(&config, &device, &panel).unwrap();
    let on = describe_control(&plan.controls[1], &readings(&plan, true));
    assert_eq!(on.label, "风速");
    assert!(on.enabled, "{:?}", on.reason);
    assert!(!describe_control(&plan.controls[1], &readings(&plan, false)).enabled);
    assert!(!describe_control(&plan.controls[1], &Values::new()).enabled);
    for (online, shared_read_only) in [(false, false), (true, true)] {
        let other = Device { online, shared_read_only, ..device.clone() };
        let other = compile(&config, &other, &panel).unwrap();
        assert_eq!(other.template, plan.template);
        assert!(!describe_control(&other.controls[1], &readings(&other, true)).enabled);
    }

    let spec = serde_json::from_str(include_str!("fixtures/catalog/air-monitor--blink.airmonitor.bs0001.json")).unwrap();
    let (mut device, panel) = sample("blink.airmonitor.bs0001", &spec);
    device.shared_read_only = true;
    let plan = compile(&config, &device, &panel).unwrap();
    let controls = describe_plan(&plan, &readings(&plan, true), &device.did, 1).controls;
    assert!(controls.len() >= 2 && controls.iter().all(|c| c.kind == "reading" && !c.enabled && c.state.is_some()));
    let unplugged = describe_plan(&plan, &Values::new(), &device.did, 1);
    assert!(unplugged.controls.iter().all(|c| c.state.is_none()));

    let spec = serde_json::from_str(include_str!("fixtures/expansion/cuco.plug.cp1.json")).unwrap();
    let (device, panel) = sample("cuco.plug.cp1", &spec);
    assert!(compile(&config, &device, &panel).is_none());
}

#[test]
fn switch_card_checks_each_channel_mode_and_sensor_controls_cannot_write() {
    let mut spec: Value = serde_json::from_str(include_str!("fixtures/catalog/switch--roome.switch.v2.json")).unwrap();
    for service in spec["services"].as_array_mut().unwrap().iter_mut().filter(|s| s["iid"] == 2 || s["iid"] == 3) {
        service["properties"].as_array_mut().unwrap().push(json!({
            "iid": 9, "type":"urn:miot-spec-v2:property:mode:00000008:roome-v2:1", "format":"uint8", "description":"Mode", "access":["read"],
            "value-list":[{"value":0,"description":"Wired And Wireless"},{"value":1,"description":"Wireless"},{"value":2,"description":"Flex"}]
        }));
    }
    let (device, panel) = sample("roome.switch.v2", &spec);
    let config = config();
    let plan = compile(&config, &device, &panel).expect("each switch has its own schema");
    let mut values = Values::new();
    for c in &plan.controls { values.insert(key(&device, &c.gate.primary), json!(true)); }
    let c = &plan.controls[0];
    let mode = &c.gate.dependencies[0].property;
    for (value, enabled) in [(0, true), (1, false), (2, false), (42, false)] {
        values.insert(key(&device, mode), json!(value));
        assert_eq!(describe_control(c, &values).enabled, enabled);
        assert!(describe_control(&plan.controls[2], &values).enabled);
    }
    values.remove(&key(&device, mode));
    assert!(!describe_control(c, &values).enabled);

    let spec = serde_json::from_str(include_str!("fixtures/catalog/air-monitor--blink.airmonitor.bs0001.json")).unwrap();
    let (device, panel) = sample("blink.airmonitor.bs0001", &spec);
    let plan = compile(&config, &device, &panel).unwrap();
    for c in &plan.controls {
        assert!(property_write(c, &describe_control(c, &Values::new()), &json!(20)).is_err());
    }
}
