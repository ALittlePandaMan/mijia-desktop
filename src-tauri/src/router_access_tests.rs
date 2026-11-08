use super::*;
fn device() -> Device {
    serde_json::from_value(json!({"did":"miwifi.fixture-route","model":router::MODEL,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap()
}
fn report() -> Report {
    parse(&device(), (&json!({}),&json!({"work_mode":0,"capabilities":{"whitelist":1}})), &json!({"code":0,"open":1,"wifimode":1,"level":3,"wifilevel":2,"adminlevel":2}),&json!({"code":0,"enable":1,"model":0,"macfilter":[{"mac":"aa:bb:cc:00:00:01","name":"One"},"aa:bb:cc:00:00:02"]}),Some(&json!({"code":0,"protection_enabled":true,"duration":1000})),&[],Some(&["aa:bb:cc:00:00:03".into()])).unwrap()
}
fn change(r: &Report, op: Operation) -> Change {
    Change {
        baseline: r.revision.clone(),
        operation: op,
    }
}
#[test]
fn exact_routes_and_wire_types() {
    for p in [SWITCH, EDIT] {
        assert!(is_write_path(p));
        assert!(!router::is_read_path(p));
        assert!(router::is_gateway_path(p));
    }
    let r = report();
    let (path, wire, p) = prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: r.entries[0].mac.clone(),
                add: false,
            },
        ),
    )
    .unwrap();
    assert_eq!(path, EDIT);
    assert_eq!(
        wire,
        json!({"method":"GET","params":{"deviceId":"fixture-route","mac":"aa:bb:cc:00:00:01","option":"1","model":"0"}})
    );
    assert!(!confirmed(&r, &p));
    let mut after = r;
    after.entries[0].member = false;
    assert!(confirmed(&after, &p));
    after.mode = 1;
    assert!(!confirmed(&after, &p));
}
#[test]
fn handles_string_members_and_deduplicates_case() {
    let r = report();
    assert_eq!(r.entries.len(), 2);
    assert!(r.entries.iter().all(|e| e.member));
    assert_eq!(r.entries[0].name, "One");
    let duplicate = json!({"code":0,"enable":1,"model":0,"macfilter":["aa:bb:cc:00:00:01","AA:BB:CC:00:00:01"]});
    assert!(parse(
        &device(),
        (&json!({}), &json!({"work_mode":0})),
        &json!({"code":0,"open":1,"wifimode":1,"level":3}),
        &duplicate,
        None,
        &[],
        None
    )
    .is_err());
}
#[test]
fn missing_or_disagreeing_switch_does_not_enable_writes() {
    let d = device();
    let status = json!({"code":0,"open":1,"wifimode":1,"level":3});
    let f = json!({"code":0,"enable":0,"model":0,"macfilter":[]});
    let r = parse(
        &d,
        (&json!({}), &json!({"work_mode":0})),
        &status,
        &f,
        None,
        &[],
        None,
    )
    .unwrap();
    assert!(r.write_reason.is_some());
    assert!(parse(
        &d,
        (&json!({}), &json!({"work_mode":0})),
        &json!({"code":0,"wifimode":1,"level":3}),
        &f,
        None,
        &[],
        None
    )
    .is_err());
}
#[test]
fn permissions_work_mode_and_baseline_are_checked() {
    let r = report();
    let mut d = device();
    d.shared_read_only = true;
    assert!(prepare(&d, &r, &change(&r, Operation::Switch { on: false })).is_err());
    let mut c = change(&r, Operation::Level { value: 2 });
    c.baseline = "old".into();
    assert_eq!(prepare(&device(), &r, &c).unwrap_err().kind, "conflict");
    let mut r = r;
    r.write_reason = Some("relay".into());
    assert!(prepare(&device(), &r, &change(&r, Operation::Switch { on: false })).is_err());
}
#[test]
fn refuses_self_wired_and_unknown_local_identity() {
    let mut r = report();
    let mac = r.entries[0].mac.clone();
    r.entries[0].protected = true;
    assert!(prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: mac.clone(),
                add: true
            }
        )
    )
    .is_err());
    r.entries[0].protected = false;
    r.entries[0].connection = Some(4);
    assert!(prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: mac.clone(),
                add: false
            }
        )
    )
    .is_err());
    r.entries[0].connection = None;
    r.local_checked = false;
    assert!(prepare(
        &device(),
        &r,
        &change(&r, Operation::Membership { mac, add: false })
    )
    .is_err());
}
#[test]
fn last_white_member_cannot_be_removed_and_manual_white_add_is_supported() {
    let mut r = report();
    r.mode = 1;
    r.entries.truncate(1);
    assert!(prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: r.entries[0].mac.clone(),
                add: false
            }
        )
    )
    .is_err());
    let (_, wire, _) = prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: "aa:bb:cc:00:00:04".into(),
                add: true,
            },
        ),
    )
    .unwrap();
    assert_eq!(wire["params"]["model"], "1");
    assert_eq!(wire["params"]["option"], "0");
}
#[test]
fn global_switch_explicitly_resets_black_mode_and_preserves_level() {
    let mut r = report();
    r.mode = 1;
    let (_, wire, p) =
        prepare(&device(), &r, &change(&r, Operation::Switch { on: false })).unwrap();
    assert_eq!(
        wire["params"],
        json!({"deviceId":"fixture-route","open":"0","mode":"0","level":3})
    );
    r.on = false;
    assert!(!confirmed(&r, &p));
    r.mode = 0;
    assert!(confirmed(&r, &p));
}
#[test]
fn level_has_original_three_choices_and_needs_enabled_black_mode() {
    let mut r = report();
    assert!(prepare(&device(), &r, &change(&r, Operation::Level { value: 4 })).is_err());
    let (_, wire, p) = prepare(&device(), &r, &change(&r, Operation::Level { value: 2 })).unwrap();
    assert_eq!(wire["params"]["level"], 2);
    r.level = 2;
    assert!(confirmed(&r, &p));
    r.mode = 1;
    assert!(prepare(&device(), &r, &change(&r, Operation::Level { value: 2 })).is_err());
}
#[test]
fn no_unknown_black_mac_is_accepted_from_frontend() {
    let r = report();
    assert!(prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Membership {
                mac: "aa:bb:cc:00:00:04".into(),
                add: true
            }
        )
    )
    .is_err());
}
#[test]
fn live_duration_and_names_are_excluded_from_write_revision() {
    let r = report();
    let r2=parse(&device(), (&json!({}),&json!({"work_mode":0,"capabilities":{"whitelist":1}})), &json!({"code":0,"open":1,"wifimode":1,"level":3,"wifilevel":2,"adminlevel":2}),&json!({"code":0,"enable":1,"model":0,"macfilter":[{"mac":"aa:bb:cc:00:00:01","name":"Renamed"},"aa:bb:cc:00:00:02"]}),Some(&json!({"code":0,"protection_enabled":true,"duration":999999})),&[],Some(&["aa:bb:cc:00:00:03".into()])).unwrap();
    assert_eq!(r.revision, r2.revision);
    let status = json!({"code":0,"open":1,"wifimode":1,"level":3});
    let f = json!({"code":0,"enable":1,"model":0,"macfilter":[]});
    let r3 = parse(
        &device(),
        (
            &json!({}),
            &json!({"work_mode":0,"capabilities":{"whitelist":1}}),
        ),
        &status,
        &f,
        None,
        &[],
        Some(&[]),
    )
    .unwrap();
    assert_ne!(r.revision, r3.revision);
}
