use super::*;
fn device() -> Device {
    serde_json::from_value(
        json!({"did":"miwifi.fixture-route","name":"Fixture","model":router::MODEL,"online":true,"roomId":"","roomName":""}),
    )
    .unwrap()
}
fn report() -> Report {
    parse(&device(),&json!({"features":{}}),&json!({"work_mode":0,"capabilities":{"qos_device_switch":1}}),Some(false),
        &json!({"code":0,"status":{"on":1,"mode":3},"band":{"upload":80,"download":800},"guest":{"percent_up":0.5,"percent":0.25}}),
        Some(("aa:bb:cc:00:00:01",&json!({"code":0,"band":{"upload":80,"download":800},"limit":{"flag":"on","upmax":5120,"downmax":25600}})))).unwrap()
}
fn change(r: &Report, operation: Operation) -> Change {
    Change {
        baseline: r.revision.clone(),
        mac: matches!(
            operation,
            Operation::Device { .. } | Operation::Limit { .. }
        )
        .then(|| r.client.as_ref().unwrap().mac.clone()),
        operation,
    }
}
#[test]
fn read_and_write_routes_are_disjoint() {
    for p in [FLAG, LIMIT, SWITCH, MODE, BAND, GUEST] {
        assert!(is_write_path(p));
        assert!(!router::is_read_path(p));
        assert!(router::is_gateway_path(p));
    }
    for p in [INFO, DEVICE, DUAL] {
        assert!(is_read_path(p));
        assert!(!is_write_path(p));
    }
    assert!(!is_write_path("/api/qos_switch"));
}
#[test]
fn bandwidth_uses_mbps_bounds_and_strict_two_decimal_text() {
    assert!(bandwidth("0.01", "8").is_ok());
    assert!(bandwidth("10000", "10000").is_ok());
    for (u, d) in [
        ("0", "8"),
        ("1", "7.99"),
        ("1e2", "8"),
        ("1.001", "8"),
        ("1", "10000.01"),
        (" 1", "8"),
        ("1", "8abc"),
        ("01", "8"),
        ("1.", "8"),
    ] {
        assert!(bandwidth(u, d).is_err());
    }
}
#[test]
fn missing_readings_never_create_an_enabled_switch() {
    let d = device();
    assert!(parse(
        &d,
        &json!({}),
        &json!({"work_mode":0}),
        None,
        &json!({"code":0,"status":{"on":1,"mode":3}}),
        None
    )
    .is_err());
}
#[test]
fn display_uses_plugin_binary_units_and_zero_limit_means_full_band() {
    assert_eq!(percentage(5120.0, 80.0), 50.0);
    assert_eq!(percentage(0.0, 80.0), 100.0);
    assert_eq!(percentage(5120.0, 0.0), 100.0);
    assert_eq!(client_rate(0.0, 80.0, Some(500)), 5120.0);
    assert_eq!(fixed(client_rate(0.0, 33.33, Some(333))), "1420.288");
}
#[test]
fn directional_write_preserves_other_limit_and_uses_fixed_strings() {
    let r = report();
    let c = change(
        &r,
        Operation::Limit {
            direction: Direction::Upload,
            ticks: 100,
        },
    );
    let (p, v, pending) = prepare(&device(), &r, &c).unwrap();
    assert_eq!(p, LIMIT);
    assert_eq!(
        v,
        json!({"method":"GET","params":{"deviceId":"fixture-route","mac":"aa:bb:cc:00:00:01","upload":"1024.000","download":"25600.000"}})
    );
    assert!(!confirmed(&r, &pending));
    let mut after = r.clone();
    after.client.as_mut().unwrap().limit.upload = 1024.0;
    assert!(confirmed(&after, &pending));
    after.client.as_mut().unwrap().limit.download = 25601.0;
    assert!(!confirmed(&after, &pending));
}
#[test]
fn zero_opposite_limit_is_preserved() {
    let mut r = report();
    r.client.as_mut().unwrap().limit.download = 0.0;
    let c = change(
        &r,
        Operation::Limit {
            direction: Direction::Upload,
            ticks: 100,
        },
    );
    let (_, v, _) = prepare(&device(), &r, &c).unwrap();
    assert_eq!(v["params"]["download"], "0.000");
}
#[test]
fn parent_switch_and_band_are_required_and_never_implicitly_written() {
    let mut r = report();
    r.on = false;
    let c = change(&r, Operation::Device { on: true });
    assert!(prepare(&device(), &r, &c).is_err());
    r.band.download = 0.0;
    let c = change(&r, Operation::Switch { on: true });
    assert!(prepare(&device(), &r, &c).is_err());
    let c = change(
        &r,
        Operation::Band {
            upload: "20".into(),
            download: "200".into(),
        },
    );
    let (p, v, _) = prepare(&device(), &r, &c).unwrap();
    assert_eq!(p, BAND);
    assert_eq!(v["params"]["manual"], 1);
    assert!(v["params"].get("on").is_none());
}
#[test]
fn caps_modes_and_permissions_gate_all_writes() {
    let mut r = report();
    let c = change(&r, Operation::Mode { value: 4 });
    r.ai = true;
    assert!(prepare(&device(), &r, &c).is_err());
    r.ai = false;
    r.write_reason = Some("dual WAN".into());
    assert!(prepare(&device(), &r, &c).is_err());
    r.write_reason = None;
    let mut d = device();
    d.shared_read_only = true;
    assert!(prepare(&d, &r, &c).is_err());
    r.client_supported = false;
    let c = change(&r, Operation::Device { on: false });
    assert!(prepare(&device(), &r, &c).is_err());
}
#[test]
fn baseline_and_client_identity_are_checked_before_writes() {
    let r = report();
    let mut c = change(&r, Operation::Device { on: false });
    c.baseline = "outdated".into();
    assert_eq!(prepare(&device(), &r, &c).unwrap_err().kind, "conflict");
    c.baseline = r.revision.clone();
    c.mac = Some("aa:bb:cc:00:00:02".into());
    assert!(prepare(&device(), &r, &c).is_err());
}
#[test]
fn guest_direction_preserves_its_counterpart_and_is_readback_confirmed() {
    let r = report();
    let c = change(
        &r,
        Operation::Guest {
            direction: Direction::Download,
            ticks: 400,
        },
    );
    let (p, v, pending) = prepare(&device(), &r, &c).unwrap();
    assert_eq!(p, GUEST);
    assert_eq!(v["params"]["percent_up"], 0.5);
    assert_eq!(v["params"]["percent"], 0.4);
    assert!(!confirmed(&r, &pending));
    let mut after = r;
    after.guest.as_mut().unwrap().download = 0.4;
    assert!(confirmed(&after, &pending));
}
