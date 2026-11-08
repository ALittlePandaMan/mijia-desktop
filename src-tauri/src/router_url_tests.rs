use super::*;
#[test]
fn family_protection_replaces_legacy_controls_only_when_supported() {
    assert!(family_protection(&json!({"features":{"system":{"mipctlv2":1}}}), &json!({})).unwrap());
    for (rom, expected) in [("2.0.9", false), ("2.1", true), ("2.1.1", true)] {
        assert_eq!(
            family_protection(
                &json!({}),
                &json!({"rom":rom,"capabilities":{"parental_control":"2.1.0"}})
            )
            .unwrap(),
            expected
        );
    }
    assert!(!family_protection(&json!({}), &json!({"capabilities":{}})).unwrap());
    assert!(family_protection(
        &json!({}),
        &json!({"capabilities":{"parental_control":"2.1"}})
    )
    .is_err());
}
fn device() -> Device {
    serde_json::from_value(json!({"did":"miwifi.fixture","model":router::MODEL,"online":true,"name":"fixture","roomId":"","roomName":""})).unwrap()
}
fn report() -> Report {
    parse(
        &device(),
        "AA:BB:CC:00:00:01",
        &json!({"code":0,"status":{"urlfilter":{"mode":"none","count":0}}}),
        &json!({"code":0,"list":["www.a.com","www.b.com"]}),
        &json!({"code":0,"list":["www.c.com"]}),
        None,
    )
    .unwrap()
}
fn change(r: &Report, operation: Operation) -> Change {
    Change {
        baseline: r.revision.clone(),
        mac: r.mac.clone(),
        operation,
    }
}
#[test]
fn domain_validation_matches_native_pattern_with_batch_boundary() {
    for s in [
        "www.baidu.com",
        "a.com",
        "music.163.com",
        "sub-domain.test",
        "www.a:443",
        "www.a?b",
    ] {
        assert!(valid_domain(s), "{s}");
    }
    for s in [
        "www.",
        "",
        "https://example.com",
        "a,b.com",
        "a.com\nx.com",
        "域名.cn",
        " a.com",
        &"a".repeat(254),
    ] {
        assert!(!valid_domain(s), "{s}");
    }
}
#[test]
fn routes_and_exact_native_payloads() {
    let r = report();
    assert!(router::is_read_path(STATUS));
    assert!(router::is_read_path(LIST));
    for p in [SET_MODE, EDIT] {
        assert!(!router::is_read_path(p));
        assert!(router::is_gateway_path(p));
    }
    for (mode, wire) in [
        (Mode::None, "none"),
        (Mode::Black, "black"),
        (Mode::White, "white"),
    ] {
        let (path, payload, _) =
            prepare(&device(), &r, &change(&r, Operation::Mode { value: mode })).unwrap();
        assert_eq!(path, SET_MODE);
        assert_eq!(
            payload,
            json!({"method":"GET","params":{"deviceId":"fixture","mac":r.mac,"mode":wire}})
        );
    }
}
#[test]
fn add_update_and_batch_delete_have_exact_options() {
    let r = report();
    let ops = [
        Operation::Add {
            list: Mode::Black,
            url: "www.new.com".into(),
        },
        Operation::Update {
            list: Mode::Black,
            url: "www.a.com".into(),
            new_url: "www.new.com".into(),
        },
        Operation::Delete {
            list: Mode::Black,
            urls: vec!["www.a.com".into(), "www.b.com".into()],
        },
    ];
    for (op, opt, url) in ops
        .into_iter()
        .zip(["0", "2", "1"])
        .zip(["www.new.com", "www.a.com", "www.a.com,www.b.com"])
        .map(|((a, b), c)| (a, b, c))
    {
        let (path, payload, _) = prepare(&device(), &r, &change(&r, op)).unwrap();
        assert_eq!(path, EDIT);
        assert_eq!(payload["method"], "GET");
        assert_eq!(payload["params"]["opt"], opt);
        assert_eq!(payload["params"]["url"], url);
        if opt == "2" {
            assert_eq!(payload["params"]["newurl"], "www.new.com");
        }
    }
    let c:Change=serde_json::from_value(json!({"baseline":r.revision,"mac":r.mac,"operation":{"kind":"update","list":"white","url":"www.c.com","newUrl":"www.d.com"}})).unwrap();
    assert!(matches!(c.operation, Operation::Update { .. }));
}
#[test]
fn independent_confirmation_requires_full_target_and_unchanged_other_list() {
    let r = report();
    let (_, _, p) = prepare(
        &device(),
        &r,
        &change(
            &r,
            Operation::Add {
                list: Mode::Black,
                url: "www.new.com".into(),
            },
        ),
    )
    .unwrap();
    assert!(!confirmed(&r, &p));
    let mut actual = r.clone();
    actual.black.push("www.new.com".into());
    assert!(confirmed(&actual, &p));
    actual.white.push("www.other.com".into());
    assert!(!confirmed(&actual, &p));
    actual.white.pop();
    actual.black.reverse();
    assert!(confirmed(&actual, &p));
    actual.write_reason = Some("unconfirmed".into());
    assert!(!confirmed(&actual, &p));
}
#[test]
fn rejects_stale_target_permission_duplicate_and_batch_injection() {
    let r = report();
    let base = change(
        &r,
        Operation::Add {
            list: Mode::Black,
            url: "www.a.com".into(),
        },
    );
    assert!(prepare(&device(), &r, &base).is_err());
    for op in [
        Operation::Add {
            list: Mode::None,
            url: "www.new.com".into(),
        },
        Operation::Add {
            list: Mode::Black,
            url: "www.a.com,www.new.com".into(),
        },
        Operation::Update {
            list: Mode::Black,
            url: "missing.com".into(),
            new_url: "www.new.com".into(),
        },
        Operation::Delete {
            list: Mode::Black,
            urls: vec!["www.a.com".into(), "www.a.com".into()],
        },
    ] {
        assert!(prepare(&device(), &r, &change(&r, op)).is_err());
    }
    let mut c = change(&r, Operation::Mode { value: Mode::Black });
    c.baseline = "stale".into();
    assert!(prepare(&device(), &r, &c).is_err());
    c.baseline = r.revision.clone();
    c.mac = "AA:BB:CC:00:00:02".into();
    assert!(prepare(&device(), &r, &c).is_err());
    let mut d = device();
    d.shared_read_only = true;
    assert!(prepare(&d, &r, &change(&r, Operation::Mode { value: Mode::Black })).is_err());
}
#[test]
fn malformed_or_error_lists_never_become_valid_empty() {
    let d = device();
    let status = json!({"code":0,"status":{"urlfilter":{"mode":"none","count":0}}});
    for black in [
        json!({"code":0}),
        json!({"code":1,"list":[]}),
        json!({"code":0,"list":["a.com","a.com"]}),
        json!({"code":0,"list":[3]}),
        json!({"code":0,"list":["a.com,b.com"]}),
    ] {
        assert!(parse(
            &d,
            "aa:bb:cc:00:00:01",
            &status,
            &black,
            &json!({"code":0,"list":[]}),
            None
        )
        .is_err());
    }
    let mut bad = status;
    bad["status"]["urlfilter"]["mode"] = json!("unknown");
    assert!(parse(
        &d,
        "aa:bb:cc:00:00:01",
        &bad,
        &json!({"code":0,"list":[]}),
        &json!({"code":0,"list":[]}),
        None
    )
    .is_err());
}
#[test]
fn count_mismatch_blocks_write_and_revision_is_order_independent() {
    let mut r = report();
    let original = r.revision.clone();
    r.black.reverse();
    assert_eq!(revision(&r).unwrap(), original);
    let r = parse(
        &device(),
        &r.mac,
        &json!({"code":"0","status":{"urlfilter":{"mode":"black","count":7}}}),
        &json!({"code":0,"list":[]}),
        &json!({"code":0,"list":[]}),
        None,
    )
    .unwrap();
    assert!(r.write_reason.is_some());
}
