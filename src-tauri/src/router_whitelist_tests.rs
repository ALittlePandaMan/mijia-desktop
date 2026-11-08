use super::*;
fn device() -> Device {
    serde_json::from_value(json!({"did":"miwifi.fixture-route","name":"fixture","model":router::MODEL,"online":true,"roomId":"","roomName":""})).unwrap()
}
fn report() -> access::Report {
    access::parse(
        &device(),
        (
            &json!({}),
            &json!({"work_mode":0,"capabilities":{"whitelist":1}}),
        ),
        &json!({"code":0,"open":1,"level":3,"wifimode":1}),
        &json!({"code":0,"enable":1,"model":0,"macfilter":[]}),
        None,
        &[],
        Some(&["aa:bb:cc:00:00:01".into()]),
    )
    .unwrap()
}
fn record(r: &access::Report) -> access::Pending {
    pending(
        r,
        &access::Change {
            baseline: r.revision.clone(),
            operation: access::Operation::WhiteMode,
        },
        "aa:bb:cc:00:00:01",
    )
    .unwrap()
}
#[test]
fn local_url_is_exact_and_never_accepts_public_hosts_or_injected_paths() {
    let ip = Ipv4Addr::new(192, 168, 31, 1);
    let u = local_url(
        ip,
        true,
        Some("synthetic_token"),
        "/api/xqsystem/device_mac",
    )
    .unwrap();
    assert_eq!(
        u.as_str(),
        "https://192.168.31.1/cgi-bin/luci/;stok=synthetic_token/api/xqsystem/device_mac"
    );
    assert!(u.query().is_none());
    assert!(local_url(
        Ipv4Addr::new(8, 8, 8, 8),
        false,
        None,
        "/api/xqsystem/init_info"
    )
    .is_err());
    assert!(local_url(ip, true, Some("abc?leak=x"), "/api/xqsystem/device_mac").is_err());
    assert!(local_url(ip, true, Some("a"), "/api/reboot").is_err());
}
#[test]
fn https_capability_accepts_native_boolean_and_rom_feature_encodings() {
    assert!(supports_https(&json!({"secAcc":true}), &json!({})));
    assert!(supports_https(
        &json!({"features":{"system":{"secAcc":"1"}}}),
        &json!({})
    ));
    assert!(supports_https(
        &json!({}),
        &json!({"capabilities":{"secAcc":1}})
    ));
    assert!(!supports_https(
        &json!({"secAcc":false}),
        &json!({"capabilities":{"secAcc":0}})
    ));
}
#[test]
fn local_write_matches_native_form_encoding_and_both_device_id_spellings() {
    let c = reqwest::Client::new();
    let r = white_request(
        &c,
        Ipv4Addr::new(192, 168, 31, 1),
        true,
        "synthetic-token",
        "fixture-route",
    )
    .unwrap();
    assert_eq!(r.method(), reqwest::Method::POST);
    assert_eq!(
        r.headers()[reqwest::header::CONTENT_TYPE],
        "application/x-www-form-urlencoded"
    );
    assert_eq!(r.body().unwrap().as_bytes().unwrap(),b"deviceId=fixture-route&deviceID=fixture-route&open=1&mode=1&allow_private_certificates=true");
    assert!(r.url().query().is_none());
}
#[test]
fn credentials_have_a_closed_character_set_and_are_not_in_readiness_json() {
    assert!(token(&json!("synthetic-token_1")).is_ok());
    for s in ["", "a/b", "a\r\n", "a?token=x", "../x"] {
        assert!(token(&json!(s)).is_err());
    }
    let view = serde_json::to_string(&Readiness {
        ready: true,
        reason: None,
    })
    .unwrap();
    assert!(!view.contains("synthetic"));
    assert!(!view.contains("mac"));
    assert!(!view.contains("gateway"));
}
#[test]
fn local_and_cloud_baselines_must_match_before_any_write() {
    let r = report();
    let status = json!({"open":1,"level":3,"wifimode":1});
    let filter = json!({"enable":1,"model":0,"macfilter":[]});
    assert!(matches_report(&r, &status, &filter));
    let mut mismatch = filter;
    mismatch["macfilter"] = json!(["aa:bb:cc:00:00:02"]);
    assert!(!matches_report(&r, &status, &mismatch));
    assert!(!matches_report(
        &r,
        &json!({"open":1,"level":2,"wifimode":1}),
        &mismatch
    ));
}
#[test]
fn white_mode_requires_local_prepare_instead_of_a_cloud_mode_one_request() {
    let r = report();
    let c = access::Change {
        baseline: r.revision.clone(),
        operation: access::Operation::WhiteMode,
    };
    assert!(access::prepare(&device(), &r, &c).is_err());
    assert!(pending(&r, &c, "not-a-mac").is_err());
    let mut old = c;
    old.baseline = "old".into();
    assert_eq!(
        pending(&r, &old, "aa:bb:cc:00:00:01").unwrap_err().kind,
        "conflict"
    );
}
#[test]
fn observing_an_uncertain_mode_never_starts_self_retention() {
    let mut r = report();
    let p = record(&r);
    assert_eq!(decision(&r, &p, false, false), Decision::Wait);
    r.mode = 1;
    assert!(progress(&r, &p).unwrap().can_finish);
    assert_eq!(decision(&r, &p, false, false), Decision::Wait);
    assert_eq!(decision(&r, &p, false, true), Decision::Wait);
    assert_eq!(decision(&r, &p, true, false), Decision::RetainSelf);
}
#[test]
fn acknowledged_mode_advances_once_after_independent_mode_read() {
    let mut r = report();
    let mut p = record(&r);
    p.white.as_mut().unwrap().phase = Phase::SelfReady;
    assert_eq!(decision(&r, &p, false, true), Decision::Wait);
    r.mode = 1;
    assert_eq!(decision(&r, &p, false, true), Decision::RetainSelf);
    p.white.as_mut().unwrap().phase = Phase::SelfPending;
    assert_eq!(decision(&r, &p, true, true), Decision::Wait);
    assert!(!progress(&r, &p).unwrap().can_finish);
}
#[test]
fn confirmation_requires_the_router_verified_mac_not_another_local_adapter() {
    let mut r = report();
    let p = record(&r);
    r.mode = 1;
    r.entries.push(access::Entry {
        mac: "aa:bb:cc:00:00:02".into(),
        name: "other".into(),
        member: true,
        protected: true,
        connection: Some(1),
        online: Some(true),
    });
    assert!(!access::confirmed(&r, &p));
    r.entries[0].mac = "AA:BB:CC:00:00:01".into();
    assert!(access::confirmed(&r, &p));
    assert_eq!(decision(&r, &p, false, false), Decision::Confirmed);
}
#[test]
fn completion_payload_can_only_retain_the_private_transaction_identity() {
    let r = report();
    let p = record(&r);
    let v = self_payload(&device(), &p).unwrap();
    assert_eq!(
        v,
        json!({"method":"GET","params":{"deviceId":"fixture-route","mac":"aa:bb:cc:00:00:01","option":"0","model":"1"}})
    );
    let view = serde_json::to_string(&progress(&r, &p)).unwrap();
    assert!(!view.contains("aa:bb"));
    assert!(!view.contains("token"));
}
