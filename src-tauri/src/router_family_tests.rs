use super::*;
fn device() -> Device {
    serde_json::from_value(json!({"did":"miwifi.fixture","model":router::MODEL,"online":true,"name":"fixture","roomId":"","roomName":""})).unwrap()
}
fn apps() -> Vec<Category> {
    parse_apps(&json!({"code":0,"list":[{"class_name":"game","enable":false,"time_quota":120,"app_list":[{"name":"one","enable":true},{"name":"two","enable":false}]}]})).unwrap()
}
fn report() -> Report {
    let mut r = Report {
        did: device().did,
        model: router::MODEL.into(),
        mac: "aa:bb:cc:00:00:01".into(),
        revision: String::new(),
        supported: true,
        write_reason: None,
        users: vec![],
        current: None,
        clients: vec![Client {
            mac: "aa:bb:cc:00:00:01".into(),
            name: "fixture".into(),
            online: Some(true),
            connection: Some(1),
            icon: None,
            owner: None,
            owner_name: None,
            event_time: None,
        }],
        apps: apps(),
        labels: HashMap::new(),
        icons: HashMap::new(),
    };
    r.revision = revision(&r).unwrap();
    r
}
fn draft() -> Draft {
    Draft {
        user_id: None,
        name: "儿子".into(),
        icon: "0".into(),
        devices: vec!["aa:bb:cc:00:00:01".into()],
        times: vec![Time {
            id: None,
            start: 1320,
            end: 1800,
            enable: [1, 1, 1, 1, 1, 0, 0],
            deleted: false,
        }],
        urls: vec!["example.com".into()],
        apps: apps(),
    }
}
fn change(r: &Report, d: Draft) -> Change {
    Change {
        baseline: r.revision.clone(),
        mac: r.mac.clone(),
        operation: Operation::Save { draft: d },
    }
}
#[test]
fn exact_batch_post_and_read_allowlist() {
    let r = report();
    let (payload, _) = prepare(&device(), &r, &change(&r, draft())).unwrap();
    assert_eq!(payload["method"], "POST");
    let opts = payload["params"]["opt_list"].as_array().unwrap();
    assert_eq!(
        opts.iter()
            .map(|o| o["opt"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec![
            "mipctl_add_user",
            "mipctl_set_device",
            "mipctl_set_deny_time",
            "mipctl_set_filting_net",
            "mipctl_set_app_antiaddict"
        ]
    );
    assert_eq!(
        opts[2]["time_list"][0],
        json!({"start":1320,"end":1800,"enable":[1,1,1,1,1,0,0]})
    );
    assert_eq!(
        opts[4]["list"][0]["app_list"][0],
        json!({"name":"one","enable":true})
    );
    for path in [USERS, DEVICES, TIMES, URLS, APPS, APP_CONFIG] {
        assert!(router::is_read_path(path));
    }
    assert!(!router::is_read_path(SET));
    assert!(router::is_gateway_path(SET));
}
#[test]
fn profile_ownership_merges_wire_id_types_without_duplicate_targets() {
    let users = json!({"code":0,"user_list":[{"user_id":1,"user_name":"儿子","icon":"0"},{"user_id":"2","user_name":"女儿","icon":1}]});
    let mapping = json!({"code":0,"list":[{"user_id":"1","devices":["AA:BB:CC:00:00:01"]},{"user_id":2,"devices":[]}]});
    let parsed = parse_users(&users, &mapping).unwrap();
    assert_eq!(parsed[0].user_id, json!(1));
    assert_eq!(parsed[0].devices, vec!["aa:bb:cc:00:00:01"]);
    let mut bad = mapping;
    bad["list"][1]["devices"] = json!(["AA:BB:CC:00:00:01"]);
    assert!(parse_users(&users, &bad).is_err());
}
#[test]
fn invalid_user_and_record_shapes_do_not_become_empty_success() {
    for v in [
        json!({"code":0}),
        json!({"code":1,"user_list":[]}),
        json!({"code":0,"user_list":[{"user_id":0,"user_name":"n","icon":0}]}),
    ] {
        assert!(parse_users(&v, &json!({"code":0,"list":[]})).is_err());
    }
    assert!(parse_apps(
        &json!({"code":0,"list":[{"class_name":"game","enable":1,"time_quota":120,"app_list":[]}]})
    )
    .is_err());
}
#[test]
fn native_name_width_and_url_rules() {
    assert!(valid_name("一二三四五六"));
    assert!(!valid_name("一二三四五六七"));
    assert!(valid_name("abcdefghijkl"));
    assert!(!valid_name("abcdefghijklm"));
    assert!(!valid_name("bad\nname"));
    for s in ["example.com", "www.example.cn", "example:443"] {
        assert!(valid_url(s));
    }
    for s in [
        "http://example.com",
        "a-b.com",
        "中文.com",
        "a.com b.com",
        "",
        "a.com\nb.com",
    ] {
        assert!(!valid_url(s));
    }
}
#[test]
fn newly_created_id_must_not_match_a_preexisting_same_name() {
    let r = report();
    let (_, p) = prepare(&device(), &r, &change(&r, draft())).unwrap();
    assert!(!confirmed(&r, &p));
    let mut after = r.clone();
    after.current = Some(draft_profile(&draft(), json!(7)));
    after.users = vec![after.current.as_ref().unwrap().user.clone()];
    assert!(confirmed(&after, &p));
    let mut before = p;
    before.before_ids = vec![json!(7)];
    assert!(!confirmed(&after, &before));
}
#[test]
fn independent_confirmation_checks_all_five_groups() {
    let r = report();
    let (_, p) = prepare(&device(), &r, &change(&r, draft())).unwrap();
    let mut after = r;
    after.current = Some(draft_profile(&draft(), json!(7)));
    assert!(confirmed(&after, &p));
    after.current.as_mut().unwrap().apps[0].apps[0].enable = false;
    assert!(!confirmed(&after, &p));
    after.current.as_mut().unwrap().apps = apps();
    after.current.as_mut().unwrap().times[0].end = 1801;
    assert!(!confirmed(&after, &p));
    after.current.as_mut().unwrap().times = draft().times;
    after
        .current
        .as_mut()
        .unwrap()
        .urls
        .push("other.com".into());
    assert!(!confirmed(&after, &p));
}
#[test]
fn stale_permission_foreign_client_and_profile_capacity_are_rejected() {
    let r = report();
    let mut c = change(&r, draft());
    c.baseline = "stale".into();
    assert!(prepare(&device(), &r, &c).is_err());
    let mut d = device();
    d.shared_read_only = true;
    assert!(prepare(&d, &r, &change(&r, draft())).is_err());
    let mut occupied = r.clone();
    occupied.clients[0].owner = Some(json!(3));
    assert!(prepare(&device(), &occupied, &change(&occupied, draft())).is_err());
    let mut full = r;
    full.users = (1..=8)
        .map(|i| User {
            user_id: json!(i),
            name: i.to_string(),
            icon: "0".into(),
            devices: vec![],
        })
        .collect();
    assert!(prepare(&device(), &full, &change(&full, draft())).is_err());
}
#[test]
fn cannot_forge_app_catalog_ids_or_quota_and_device_list() {
    let r = report();
    let mut d = draft();
    d.devices.push(d.devices[0].clone());
    assert!(prepare(&device(), &r, &change(&r, d)).is_err());
    let mut d = draft();
    d.apps[0].apps[0].name = "forged".into();
    assert!(prepare(&device(), &r, &change(&r, d)).is_err());
    let mut d = draft();
    d.apps[0].time_quota = 721;
    assert!(prepare(&device(), &r, &change(&r, d)).is_err());
    let mut d = draft();
    d.apps.clear();
    assert!(prepare(&device(), &r, &change(&r, d)).is_err());
}
#[test]
fn time_limits_and_id_only_deletion_preserve_original_profile() {
    let mut r = report();
    let mut d = draft();
    d.user_id = Some(json!(1));
    d.times[0].id = Some(json!(5));
    let current = draft_profile(&d, json!(1));
    let mut current = current;
    current.times[0].id = Some(json!(5));
    r.current = Some(current.clone());
    r.users = vec![current.user.clone()];
    d.times[0].deleted = true;
    let (payload, _) = prepare(&device(), &r, &change(&r, d.clone())).unwrap();
    assert_eq!(payload["params"]["opt_list"][0]["user_id"], json!(1));
    assert_eq!(
        payload["params"]["opt_list"][2]["time_list"][0],
        json!({"id":5})
    );
    d.times.clear();
    assert!(prepare(&device(), &r, &change(&r, d)).is_err());
    let mut d = draft();
    d.times[0].end = 100;
    assert!(prepare(&device(), &report(), &change(&report(), d)).is_err());
}
#[test]
fn delete_requires_exact_existing_profile_and_independent_absence() {
    let mut r = report();
    let current = draft_profile(&draft(), json!(1));
    r.current = Some(current.clone());
    r.users = vec![current.user];
    let c = Change {
        baseline: r.revision.clone(),
        mac: r.mac.clone(),
        operation: Operation::Delete { user_id: json!(1) },
    };
    let (payload, p) = prepare(&device(), &r, &c).unwrap();
    assert_eq!(
        payload["params"]["opt_list"],
        json!([{"opt":"mipctl_del_user","user_id":1}])
    );
    assert!(!confirmed(&r, &p));
    r.users.clear();
    r.current = None;
    assert!(confirmed(&r, &p));
    let parsed: Operation = serde_json::from_value(json!({"kind":"delete","userId":1})).unwrap();
    assert!(matches!(parsed, Operation::Delete { .. }));
}
#[test]
fn catalog_parses_native_tsv_and_ignores_unsafe_icons() {
    let (labels, icons) = parse_catalog(
        "[display_config]\napp\tx\tgood.png\nbad\tx\t../bad.png\n[term_table]\napp\t应用\n",
    );
    assert_eq!(labels.get("app").map(String::as_str), Some("应用"));
    assert_eq!(
        icons.get("app").map(String::as_str),
        Some("https://s.miwifi.com/icon/good.png")
    );
    assert!(!icons.contains_key("bad"));
}
#[test]
fn creation_candidate_ambiguity_never_selects_an_arbitrary_profile() {
    let r = report();
    let (_, p) = prepare(&device(), &r, &change(&r, draft())).unwrap();
    let mut actual = r;
    actual.users = vec![
        draft_profile(&draft(), json!(1)).user,
        draft_profile(&draft(), json!(2)).user,
    ];
    assert!(hint(&p, &actual).is_none());
    actual.users.pop();
    assert_eq!(hint(&p, &actual), Some(json!(1)));
}
