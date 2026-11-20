use super::*;

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

fn config() -> preview::Config {
    preview::Config::load().unwrap()
}

fn scenario(config: &preview::Config, device: &Device, panel: &DevicePanel, state: &str) -> Value {
    let state = serde_json::from_value(json!(state)).unwrap();
    let preview = preview::render(&config.0, device.clone(), panel.clone(), state, &mut Default::default(), None).unwrap();
    serde_json::to_value(preview).unwrap()
}

#[test]
fn climate_partner_large_card_never_writes_or_depends_on_the_socket_relay() {
    let spec: Value = serde_json::from_str(include_str!("fixtures/catalog/air-condition-outlet--cuco.acpartner.cp6.json")).unwrap();
    let (device, panel) = sample("cuco.acpartner.cp6", &spec);
    let config = config();
    let plan = compile(&config.0, &device, &panel).unwrap();
    assert_eq!(plan.controls[0].gate.primary.siid, 3);
    assert_eq!(plan.controls[0].gate.target.siid, 3);
    assert_eq!(plan.controls[1].gate.primary.name, "target-temperature");
    assert_eq!(plan.controls[1].appearance, Some("temperature"));
    let dependency = &plan.controls[1].gate.dependencies[0].property;
    assert_eq!((dependency.siid, dependency.piid), (3, 1));
    for (state, enabled) in [("on", true), ("off", false), ("readonly", false)] {
        assert_eq!(scenario(&config, &device, &panel, state)["presentation"]["controls"][1]["enabled"], enabled);
    }

    let mut relay_only = panel.clone();
    relay_only.services.retain(|service| service.name != "air-conditioner");
    assert!(compile(&config.0, &device, &relay_only).is_none());
    let mut ambiguous = panel.clone();
    ambiguous.services.push(panel.services.iter().find(|service| service.name == "air-conditioner").unwrap().clone());
    assert!(compile(&config.0, &device, &ambiguous).is_none());
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
    let on = scenario(&config, &device, &panel, "on");
    assert_eq!(on["presentation"]["controls"][1]["label"], "风速");
    assert_eq!(on["presentation"]["controls"][1]["enabled"], true);
    for state in ["off", "offline", "readonly", "missing"] {
        let other = scenario(&config, &device, &panel, state);
        assert_eq!(other["presentation"]["templateId"], on["presentation"]["templateId"], "{state}");
        assert_eq!(other["presentation"]["controls"][1]["enabled"], false, "{state}");
    }

    let spec = serde_json::from_str(include_str!("fixtures/catalog/air-monitor--blink.airmonitor.bs0001.json")).unwrap();
    let (device, panel) = sample("blink.airmonitor.bs0001", &spec);
    let reading = scenario(&config, &device, &panel, "readonly");
    let controls = reading["presentation"]["controls"].as_array().unwrap();
    assert!(controls.len() >= 2 && controls.iter().all(|c| c["kind"] == "reading" && c["enabled"] == false && c["state"].is_string()));
    let unplugged = scenario(&config, &device, &panel, "offline");
    assert!(unplugged["presentation"]["controls"].as_array().unwrap().iter().all(|c| c["state"].is_null()));

    let spec = serde_json::from_str(include_str!("fixtures/expansion/cuco.plug.cp1.json")).unwrap();
    let (device, panel) = sample("cuco.plug.cp1", &spec);
    assert!(compile(&config.0, &device, &panel).is_none());
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
    let plan = compile(&config.0, &device, &panel).expect("each switch has its own schema");
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
    let plan = compile(&config.0, &device, &panel).unwrap();
    for c in &plan.controls {
        assert!(property_write(c, &describe_control(c, &Values::new()), &json!(20)).is_err());
    }
}
