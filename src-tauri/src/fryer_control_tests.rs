use super::*;
fn panel() -> DevicePanel {
    let data: Value = serde_json::from_str(include_str!(
        "../../src/fixtures/daily-remaining-panels.json"
    ))
    .unwrap();
    serde_json::from_value(
        data["models"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["model"] == crate::fryer::MODEL)
            .unwrap()
            .clone(),
    )
    .unwrap()
}
fn rows(p: &DevicePanel) -> Vec<Value> {
    [
        (2, json!(1)),
        (3, json!(0)),
        (5, json!(15)),
        (7, json!(180)),
        (22, json!(15)),
        (23, json!(true)),
        (25, json!(0)),
        (24, json!(true)),
        (26, json!("M0")),
        (33, json!(0)),
    ]
    .into_iter()
    .map(|(id, value)| json!({"did":p.control_did(),"siid":2,"piid":id,"code":0,"value":value}))
    .collect()
}
fn snapshot(p: &DevicePanel) -> Snapshot {
    parse(p, &rows(p), 100000).unwrap()
}
fn start(m: &Mode, end: Option<u64>) -> Change {
    Change::Start {
        mode: m.mode,
        minutes: m.minutes,
        temperature: m.temperature,
        keep_warm: m.keep_warm && m.temperature > 80,
        finish_at: end,
    }
}
#[test]
fn all_thirteen_original_modes_use_exact_action_parameters_and_encoded_demo() {
    let p = panel();
    let r = snapshot(&p);
    for m in profile().modes {
        let c = commands(&p, &r, &start(&m, None), 100000).unwrap();
        assert_eq!(
            c,
            vec![Command::Action(
                9,
                vec![
                    json!(m.minutes),
                    json!(m.temperature),
                    json!(m.keep_warm && m.temperature > 80),
                    json!(format!("M{}", m.mode)),
                    json!("u0064u0065u006du006f"),
                    json!(if m.mode == 1 { 0 } else { 1 }),
                    json!(1),
                    json!(0),
                    json!(500)
                ]
            )]
        );
    }
}
#[test]
fn reservation_encodes_wait_not_finish_or_total_duration() {
    let p = panel();
    let r = snapshot(&p);
    let c = commands(&p, &r, &start(&mode(0).unwrap(), Some(101800)), 100000).unwrap();
    assert!(matches!(&c[0],Command::Action(9,a)if a[7]==15));
    for end in [100899, 186401] {
        assert!(commands(&p, &r, &start(&mode(0).unwrap(), Some(end)), 100000).is_err());
    }
    assert!(commands(&p, &r, &start(&mode(10).unwrap(), Some(120000)), 100000).is_err());
}
#[test]
fn running_adjustment_writes_total_once_without_restart_or_left_time_write() {
    let p = panel();
    let mut r = snapshot(&p);
    r.status = 4;
    r.left_minutes = 10;
    assert_eq!(
        commands(
            &p,
            &r,
            &Change::Adjust {
                minutes: 16,
                temperature: 180,
                keep_warm: true
            },
            100000
        )
        .unwrap(),
        vec![Command::Write(5, json!(16))]
    );
    assert_eq!(
        commands(
            &p,
            &r,
            &Change::Adjust {
                minutes: 15,
                temperature: 185,
                keep_warm: true
            },
            100000
        )
        .unwrap(),
        vec![Command::Write(7, json!(185))]
    );
    assert!(commands(
        &p,
        &r,
        &Change::Adjust {
            minutes: 5,
            temperature: 180,
            keep_warm: true
        },
        100000
    )
    .is_err());
}
#[test]
fn adjusts_time_before_high_temperature_and_preserves_other_parameters() {
    let p = panel();
    let mut r = snapshot(&p);
    r.status = 4;
    r.minutes = 300;
    r.temperature = 40;
    r.left_minutes = 290;
    r.keep_warm = Some(false);
    let c = commands(
        &p,
        &r,
        &Change::Adjust {
            minutes: 60,
            temperature: 180,
            keep_warm: false,
        },
        100000,
    )
    .unwrap();
    assert_eq!(
        c,
        vec![Command::Write(5, json!(60)), Command::Write(7, json!(180))]
    );
    assert!(commands(
        &p,
        &r,
        &Change::Adjust {
            minutes: 300,
            temperature: 180,
            keep_warm: false
        },
        100000
    )
    .is_err());
}
#[test]
fn strict_bindings_reject_schema_drift_action_reordering_and_other_models() {
    for drift in 0..5 {
        let mut p = panel();
        match drift {
            0 => p.model = "other.fryer".into(),
            1 => p.spec_type = Some("other".into()),
            2 => p.services[1]
                .actions
                .iter_mut()
                .find(|a| a.aiid == 9)
                .unwrap()
                .inputs
                .reverse(),
            3 => {
                p.services[1]
                    .properties
                    .iter_mut()
                    .find(|v| v.piid == 24)
                    .unwrap()
                    .name = "other".into()
            }
            _ => p.route_did = Some("other".into()),
        }
        assert!(validate(&p).is_err());
    }
}
#[test]
fn unreadable_duplicate_or_wrong_device_rows_are_not_live_values() {
    let p = panel();
    for drift in 0..4 {
        let mut values = rows(&p);
        match drift {
            0 => values[0]["code"] = json!(-1),
            1 => values[0]["did"] = json!("other"),
            2 => values.push(values[0].clone()),
            _ => values[2]["value"] = json!("15"),
        }
        assert!(parse(&p, &values, 100000).is_err());
    }
}
#[test]
fn missing_added_readings_remain_missing_without_losing_successful_daily_set() {
    let p = panel();
    let values = rows(&p);
    let r = parse(&p, &values[..7], 100000).unwrap();
    assert!(r.keep_warm.is_none());
    assert!(r.recipe_id.is_none());
    assert!(r.reservation_minutes.is_none());
    assert_eq!(crate::fryer::read_params(&p).unwrap().len(), 7);
    assert_eq!(extra_params(&p).unwrap().len(), 3);
}
#[test]
fn respects_state_fault_staleness_and_basket_pause() {
    let p = panel();
    let mut r = snapshot(&p);
    r.status = 4;
    assert!(commands(&p, &r, &start(&mode(0).unwrap(), None), 100000).is_err());
    assert_eq!(
        commands(&p, &r, &Change::Pause, 100000).unwrap(),
        vec![Command::Action(7, vec![])]
    );
    r.status = 9;
    assert!(commands(&p, &r, &Change::Resume, 100000).is_err());
    r.status = 2;
    assert_eq!(
        commands(&p, &r, &Change::Resume, 100000).unwrap(),
        vec![Command::Action(8, vec![])]
    );
    r.fault = 1;
    assert!(commands(&p, &r, &Change::Resume, 100000).is_err());
    assert!(commands(&p, &r, &Change::Stop, 100000).is_ok());
    r.fault = 0;
    assert!(commands(&p, &r, &Change::Stop, 100031).is_err());
}
#[test]
fn property_permissions_and_device_ranges_are_authoritative() {
    let mut p = panel();
    let mut r = snapshot(&p);
    r.status = 4;
    p.services[1]
        .properties
        .iter_mut()
        .find(|v| v.piid == 5)
        .unwrap()
        .access
        .retain(|v| v != "write");
    assert!(commands(
        &p,
        &r,
        &Change::Adjust {
            minutes: 16,
            temperature: 180,
            keep_warm: true
        },
        100000
    )
    .is_err());
    let mut p = panel();
    p.services[1]
        .properties
        .iter_mut()
        .find(|v| v.piid == 7)
        .unwrap()
        .value_range = Some(vec![40., 175., 5.]);
    assert!(commands(
        &p,
        &snapshot(&panel()),
        &start(&mode(0).unwrap(), None),
        100000
    )
    .is_err());
}
#[test]
fn isolated_transport_applies_actual_command_shape_and_parses_result() {
    let p = panel();
    let before = snapshot(&p);
    let change = start(&mode(9).unwrap(), None);
    let commands = commands(&p, &before, &change, 100000).unwrap();
    let mut response = rows(&p);
    let mut requests = vec![];
    for command in commands {
        match command {
            Command::Action(aiid, inputs) => {
                requests.push(
                    json!({"params":{"did":p.control_did(),"siid":2,"aiid":aiid,"in":inputs}}),
                );
                for (id, value) in [
                    (2, json!(4)),
                    (25, json!(9)),
                    (26, json!("M9")),
                    (7, json!(160)),
                ] {
                    response.iter_mut().find(|r| r["piid"] == id).unwrap()["value"] = value;
                }
            }
            Command::Write(_, _) => panic!("start must be one action"),
        }
    }
    assert_eq!(requests.len(), 1);
    assert_eq!(requests[0]["params"]["in"][3], "M9");
    assert!(super::matches(
        &parse(&p, &response, 100001).unwrap(),
        &change
    ));
}
