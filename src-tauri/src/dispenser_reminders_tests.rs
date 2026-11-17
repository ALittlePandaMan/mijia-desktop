use super::*;
use chrono::FixedOffset;
fn context() -> (Device, DevicePanel) {
    let mut p: DevicePanel =
        serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
    p.did = "123".into();
    for q in p.services.iter_mut().flat_map(|s| &mut s.properties) {
        q.code = Some(0);
        q.value = match (q.siid, q.piid) {
            (2, 9) => Some(json!(60)),
            (2, 10) => Some(json!(0)),
            (2, 11) => Some(json!(false)),
            (2, 12) => Some(json!(0)),
            _ => q.value.clone(),
        }
    }
    let d=serde_json::from_value(json!({"did":"123","model":dispenser::MODEL,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap();
    (d, p)
}
fn now() -> DateTime<FixedOffset> {
    FixedOffset::east_opt(8 * 3600)
        .unwrap()
        .with_ymd_and_hms(2026, 12, 31, 23, 0, 0)
        .unwrap()
}
fn point() -> Draft {
    Draft::Point {
        time: "18:00".into(),
        repeat: Repeat::EveryDay,
        weekdays: vec![],
    }
}
fn period() -> Draft {
    Draft::Period {
        start_time: "22:00".into(),
        end_time: "08:00".into(),
        interval_hours: 0.5,
    }
}
fn push() -> Value {
    json!({"settings":{"push_enable_20622":"1","push_enable_20623":"0"}})
}
fn row(d: &Device, draft: &Draft, union: u32) -> Value {
    let mut b = body(
        d,
        None,
        setting(d, None, draft, true, union, now()).unwrap(),
    );
    b["us_id"] = json!(union.to_string());
    b
}
fn report(d: &Device, p: &DevicePanel, raw: &Value) -> Report {
    project(d, p, Some(&push()), Some(raw), true).unwrap()
}
#[test]
fn push_exact_keys_and_unknown_empty_values_are_distinct() {
    let (d, p) = context();
    let r = project(
        &d,
        &p,
        Some(&json!({"settings":{}})),
        Some(&json!([])),
        true,
    )
    .unwrap();
    assert_eq!(r.clean_finish.value, None);
    assert_eq!(r.clean_finish.source, "unset");
    assert!(r.clean_finish.can_edit);
    let r = project(
        &d,
        &p,
        Some(&json!({"settings":{"push_enable_20622":"1"}})),
        Some(&json!([])),
        true,
    )
    .unwrap();
    assert_eq!(r.clean_finish.value, Some(true));
    assert_eq!(r.lack_water.value, Some(false));
    assert_eq!(r.lack_water.source, "vendorDefault");
    let r = project(
        &d,
        &p,
        Some(&json!({"settings":{"push_enable_20622":true}})),
        Some(&json!([])),
        true,
    )
    .unwrap();
    assert!(!r.clean_finish.can_edit);
}
#[test]
fn original_cycle_choices_reject_schema_only_45_and_stale_revision() {
    let (d, p) = context();
    let raw = json!([]);
    let r = report(&d, &p, &raw);
    assert!(matches!(
        prepare(
            &d,
            &p,
            Some(&push()),
            Some(&raw),
            true,
            &Change::Cycle {
                revision: r.revision.clone(),
                value: 60
            }
        )
        .unwrap(),
        Plan::Cycle { no_op: true, .. }
    ));
    for value in [1, 45, 61] {
        assert!(prepare(
            &d,
            &p,
            Some(&push()),
            Some(&raw),
            true,
            &Change::Cycle {
                revision: r.revision.clone(),
                value
            }
        )
        .is_err())
    }
    assert!(prepare(
        &d,
        &p,
        None,
        Some(&raw),
        true,
        &Change::Cycle {
            revision: "old".into(),
            value: 15
        }
    )
    .is_err());
}
#[test]
fn point_repeats_keep_workday_filters_and_roll_once_to_next_year() {
    let (d, _) = context();
    let once = Draft::Point {
        time: "18:00".into(),
        repeat: Repeat::Once,
        weekdays: vec![],
    };
    let s = setting(&d, None, &once, true, 1, now()).unwrap();
    assert_eq!(s["on_time"], "0 18 1 1 *");
    for repeat in [Repeat::EveryDay, Repeat::Workday, Repeat::Freeday] {
        let draft = Draft::Point {
            time: "08:30".into(),
            repeat: repeat.clone(),
            weekdays: vec![],
        };
        let r = row(&d, &draft, 1);
        assert_eq!(parse(&r, &d).unwrap().reminder.draft, draft);
        assert_eq!(
            r["setting"]["on_filter"],
            match repeat {
                Repeat::Workday => "cn_workday",
                Repeat::Freeday => "cn_freeday",
                _ => "",
            }
        );
    }
    let custom = Draft::Point {
        time: "08:00".into(),
        repeat: Repeat::Custom,
        weekdays: vec![5, 1, 3],
    };
    assert_eq!(
        setting(&d, None, &custom, true, 1, now()).unwrap()["on_time"],
        "0 8 * * 1,3,5"
    );
}
#[test]
fn period_validates_midnight_and_half_hour_bounds() {
    for draft in [
        Draft::Period {
            start_time: "22:00".into(),
            end_time: "08:00".into(),
            interval_hours: 10.5,
        },
        Draft::Period {
            start_time: "08:00".into(),
            end_time: "08:00".into(),
            interval_hours: 1.0,
        },
        Draft::Period {
            start_time: "08:00".into(),
            end_time: "18:00".into(),
            interval_hours: 0.25,
        },
    ] {
        assert!(validate(&draft).is_err())
    }
    let (d, _) = context();
    assert_eq!(
        parse(&row(&d, &period(), 1), &d).unwrap().reminder.draft,
        period()
    );
}
#[test]
fn ambiguous_cross_device_duplicate_union_and_bad_fields_block_schedule_edit() {
    let (d, p) = context();
    let valid = row(&d, &period(), 1);
    for raw in [
        json!([valid.clone(), valid.clone()]),
        {
            let mut v = valid.clone();
            v["authed"] = json!(["other"]);
            json!([v])
        },
        {
            let mut v = valid.clone();
            v["setting"]["on_param"]["in"][0]["piid"] = json!(11);
            json!([v])
        },
    ] {
        let r = report(&d, &p, &raw);
        assert!(!r.can_edit_schedules);
        assert!(!r.warnings.is_empty())
    }
}
#[test]
fn modifying_period_prepares_pause_then_device_cleanup_and_stable_union() {
    let (d, p) = context();
    let raw = json!([row(&d, &period(), 1)]);
    let r = report(&d, &p, &raw);
    let plan = prepare(
        &d,
        &p,
        Some(&push()),
        Some(&raw),
        true,
        &Change::Save {
            revision: r.revision,
            key: Some(r.reminders[0].key.clone()),
            draft: point(),
        },
    )
    .unwrap();
    let Plan::Schedule {
        body,
        pause,
        cleanup,
        ..
    } = plan
    else {
        panic!()
    };
    assert_eq!(pause.unwrap()["setting"]["enable_timer"], "0");
    assert_eq!(cleanup, Some((0.5, 1)));
    assert_eq!(body["setting"]["on_param"]["in"][2]["value"], 1);
    assert_eq!(body["setting"]["enable_timer_off"], "0");
}
#[test]
fn new_schedule_reserves_active_orphan_id_and_five_record_limit() {
    let (d, mut p) = context();
    for q in p.services.iter_mut().flat_map(|s| &mut s.properties) {
        if (q.siid, q.piid) == (2, 12) {
            q.value = Some(json!(1))
        }
    }
    let raw = json!([]);
    let r = report(&d, &p, &raw);
    let plan = prepare(
        &d,
        &p,
        Some(&push()),
        Some(&raw),
        true,
        &Change::Save {
            revision: r.revision,
            key: None,
            draft: point(),
        },
    )
    .unwrap();
    let Plan::Schedule { body, .. } = plan else {
        panic!()
    };
    assert_eq!(body["setting"]["on_param"]["in"][2]["value"], 2);
    let raw = Value::Array((1..=5).map(|n| row(&d, &point(), n)).collect());
    let r = report(&d, &p, &raw);
    assert!(prepare(
        &d,
        &p,
        Some(&push()),
        Some(&raw),
        true,
        &Change::Save {
            revision: r.revision,
            key: None,
            draft: point()
        }
    )
    .is_err());
}
#[test]
fn confirmation_requires_unique_matching_row_and_delete_absence() {
    let (d, _) = context();
    let mut b = row(&d, &period(), 1);
    assert!(confirmed(&d, &json!([b.clone()]), &b, false));
    assert!(!confirmed(&d, &json!([b.clone(), b.clone()]), &b, false));
    let id = b["us_id"].clone();
    b["setting"]["enable_timer"] = json!("0");
    assert!(!confirmed(&d, &json!([row(&d, &period(), 1)]), &b, false));
    let delete = json!({"us_id":id,"st_id":8});
    assert!(confirmed(&d, &json!([]), &delete, true));
    assert!(!confirmed(
        &d,
        &json!([row(&d, &period(), 1)]),
        &delete,
        true
    ));
}
#[test]
fn owner_offline_and_missing_reads_preserve_separate_permissions() {
    let (mut d, p) = context();
    let r = project(
        &d,
        &p,
        Some(&json!({"settings":{}})),
        Some(&json!([])),
        false,
    )
    .unwrap();
    assert!(!r.can_edit_schedules);
    assert!(r.clean_finish.can_edit);
    d.online = false;
    let r = project(
        &d,
        &p,
        Some(&json!({"settings":{}})),
        Some(&json!([])),
        true,
    )
    .unwrap();
    assert!(!r.cycle_can_edit);
    assert!(r.clean_finish.can_edit);
}

#[test]
fn preflight_detects_changes_to_any_reminder_and_allows_only_our_pause() {
    let (d, _) = context();
    let first = row(&d, &period(), 1);
    let second = row(&d, &point(), 2);
    let baseline = vec![first.clone(), second.clone()];
    assert!(unchanged(
        &d,
        &json!([second.clone(), first.clone()]),
        &baseline,
        None
    ));
    let mut pause = first.clone();
    pause["setting"]["enable_timer"] = json!("0");
    let mut actual = pause.clone();
    actual["setting"]["enable_timer"] = json!(false);
    assert!(unchanged(
        &d,
        &json!([actual.clone(), second.clone()]),
        &baseline,
        Some(&pause)
    ));
    assert!(!unchanged(
        &d,
        &json!([actual.clone(), second.clone()]),
        &baseline,
        None
    ));
    let mut changed = second.clone();
    changed["setting"]["on_time"] = json!("0 19 * * *");
    assert!(!unchanged(
        &d,
        &json!([actual.clone(), changed]),
        &baseline,
        Some(&pause)
    ));
    assert!(!unchanged(
        &d,
        &json!([actual, second.clone(), row(&d, &point(), 3)]),
        &baseline,
        Some(&pause)
    ));
    assert!(!unchanged(&d, &json!([second]), &baseline, Some(&pause)));
}

#[test]
fn confirmation_rejects_union_collisions_and_a_target_replaced_by_a_foreign_scene() {
    let (d, _) = context();
    let target = row(&d, &point(), 1);
    let mut collision = target.clone();
    collision["us_id"] = json!("2");
    assert!(!confirmed(
        &d,
        &json!([target.clone(), collision]),
        &target,
        false
    ));
    let foreign = json!({"us_id":"1","identify":"not_disturb","setting":{}});
    assert!(!confirmed(
        &d,
        &json!([foreign]),
        &json!({"us_id":"1","st_id":8}),
        true
    ));
}
