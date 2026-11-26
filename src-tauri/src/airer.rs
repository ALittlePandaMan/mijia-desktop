//! hyd.airer.1s public v19: main10010 / motor10373 / light10346 /
//! night10403. No movement is inferred from a successful write acknowledgement.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const MODEL: &str = "hyd.airer.1s";

pub(crate) fn uses_extension_position(model: &str) -> bool {
    matches!(model, MODEL | "hyd.airer.1s1")
}

pub(crate) fn position_rail(panel: &DevicePanel, target: &Property) -> Result<u32> {
    let invalid = || AppError::invalid("此属性未绑定晾杆位置。");
    let extension = uses_extension_position(&panel.model);
    let (service_name, property_name, rail_id) = if extension {
        if (target.siid, target.piid) != (4, 9) {
            return Err(invalid());
        }
        ("set-night-light", "set-position", 2)
    } else {
        ("airer", "target-position", target.siid)
    };
    let source = panel.services.iter().find(|s| s.siid == target.siid && s.name == service_name)
        .ok_or_else(invalid)?;
    let range_ok = matches!(target.value_range.as_deref(), Some([min, max, step])
        if *min >= 0.0 && *max <= 100.0 && min < max && *step > 0.0
            && [min, max, step].iter().all(|n| n.fract() == 0.0));
    let label = target.description.to_lowercase();
    if panel.services.iter().filter(|s| s.siid == target.siid).count() != 1
        || panel.services.iter().filter(|s| s.siid == rail_id && s.name == "airer").count() != 1
        || source.properties.iter().filter(|p| p.piid == target.piid).count() != 1
        || source.properties.iter().filter(|p| p.name == property_name).count() != 1
        || target.name != property_name || target.format != "uint8"
        || !matches!(target.unit.as_deref(), Some("percentage" | "percent"))
        || !target.access.iter().any(|s| s == "read") || !target.access.iter().any(|s| s == "write")
        || target.unsupported_reason.is_some() || target.value_list.is_some() || !range_ok
        || ["限位", "校准", "起始位置", "终止位置", "limit", "calibrat"].iter().any(|s| label.contains(*s))
    {
        return Err(invalid());
    }
    Ok(rail_id)
}

pub(crate) fn check_position_limits(panel: &DevicePanel, target: &Value) -> Result<()> {
    if !uses_extension_position(&panel.model) {
        return Ok(());
    }
    let bound = |piid, name: &str, format: &str| {
        let service = panel.services.iter().find(|s| s.siid == 4 && s.name == "set-night-light")?;
        let mut rows = service.properties.iter().filter(|p| p.piid == piid);
        let p = rows.next()?;
        (rows.next().is_none() && p.siid == 4 && p.name == name && p.format == format
            && p.code == Some(0) && p.access.iter().any(|s| s == "read"))
            .then(|| p.value.as_ref()?.as_i64()).flatten()
    };
    let upper = bound(7, "upper-limit", "int8").filter(|n| (0..=49).contains(n));
    let lower = bound(8, "lower-limit", "uint8").filter(|n| (51..=100).contains(n));
    if !upper.zip(lower).is_some_and(|(upper, lower)|
        target.as_i64().is_some_and(|n| (upper..=lower).contains(&n)))
    {
        return Err(AppError::invalid("目标位置超出晾杆的实时上下限。"));
    }
    Ok(())
}

pub fn property<'a>(
    p: &'a DevicePanel,
    siid: u32,
    piid: u32,
    name: &str,
    format: &str,
) -> Option<&'a Property> {
    if p.model != MODEL || p.unsupported_reason.is_some() {
        return None;
    }
    let mut rows = p
        .services
        .iter()
        .filter(|s| s.siid == siid)
        .flat_map(|s| &s.properties)
        .filter(|v| {
            v.siid == siid
                && v.piid == piid
                && v.name == name
                && v.format == format
                && v.unsupported_reason.is_none()
        });
    let v = rows.next()?;
    rows.next().is_none().then_some(v)
}
fn value<'a>(
    p: &'a DevicePanel,
    siid: u32,
    piid: u32,
    name: &str,
    format: &str,
) -> Option<&'a Value> {
    let v = property(p, siid, piid, name, format)?;
    if v.code != Some(0) || !v.access.iter().any(|s| s == "read") {
        return None;
    }
    v.value.as_ref()
}
pub fn number(p: &DevicePanel, siid: u32, piid: u32, name: &str, format: &str) -> Option<i64> {
    value(p, siid, piid, name, format)?.as_i64()
}
pub fn status(p: &DevicePanel) -> Option<u8> {
    number(p, 2, 4, "status", "uint8")
        .filter(|n| (0..=4).contains(n))
        .map(|n| n as u8)
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase")]
pub enum Intent {
    Up,
    Pause,
    Down,
}

fn label_key(name: &str) -> String {
    name.chars()
        .filter(|c| !c.is_whitespace() && *c != '-' && *c != '_')
        .flat_map(char::to_lowercase)
        .collect()
}

pub(crate) fn standard_motor_intent(
    panel: &DevicePanel,
    siid: u32,
    piid: u32,
    value: &Value,
) -> Result<Intent> {
    let invalid = || AppError::invalid("此升降指令不在晾衣机的日常控制范围内。");
    let service = panel
        .services
        .iter()
        .find(|s| s.siid == siid && s.name == "airer")
        .ok_or_else(invalid)?;
    if panel.services.iter().filter(|s| s.siid == siid).count() != 1
        || service.properties.iter().filter(|p| p.piid == piid).count() != 1
    {
        return Err(invalid());
    }
    let motor = service
        .properties
        .iter()
        .find(|p| p.siid == siid && p.piid == piid && p.name == "motor-control")
        .ok_or_else(invalid)?;
    let choices = motor.value_list.as_ref().ok_or_else(invalid)?;
    let named = |names: &[&str]| {
        choices
            .iter()
            .filter(|choice| {
                names.contains(&label_key(&choice.description).as_str())
                    && !choice
                        .localized_description
                        .as_deref()
                        .unwrap_or_default()
                        .contains(['设', '校'])
            })
            .collect::<Vec<_>>()
    };
    for (intent, names) in [
        (Intent::Up, &(["up", "raise"])[..]),
        (Intent::Down, &["down", "lower"][..]),
        (Intent::Pause, &["pause", "stop"][..]),
    ] {
        let matching = named(names);
        if matching.len() == 1 && matching[0].value == *value {
            return Ok(intent);
        }
        if intent == Intent::Pause
            && *value == json!(0)
            && matching.len() == 2
            && matching.iter().any(|c| c.value == 0)
            && matching.iter().any(|c| c.value == 3)
            && choices
                .iter()
                .any(|c| label_key(&c.description) == "upwhilesetlimit")
        {
            return Ok(intent);
        }
    }
    Err(invalid())
}

pub(crate) fn check_standard_motor_state(panel: &DevicePanel, siid: u32) -> Result<()> {
    let unavailable = || AppError::new("unavailable", "晾衣机当前无法升降。", true);
    let service = panel
        .services
        .iter()
        .find(|s| s.siid == siid && s.name == "airer")
        .ok_or_else(unavailable)?;
    let current_choice = |p: &Property| {
        p.value_list
            .as_ref()
            .and_then(|choices| {
                choices
                    .iter()
                    .find(|choice| p.value.as_ref() == Some(&choice.value))
            })
            .map(|choice| {
                (
                    label_key(&choice.description),
                    choice.localized_description.clone().unwrap_or_default(),
                )
            })
    };
    if let Some(fault) = service.properties.iter().find(|p| p.name == "fault") {
        let normal = fault.code == Some(0)
            && current_choice(fault).map_or_else(
                || fault.value.as_ref() == Some(&json!(0)),
                |(name, local)| {
                    matches!(
                        name.as_str(),
                        "nofault"
                            | "nofaults"
                            | "normal"
                            | "faultfree"
                            | "none"
                            | "ok"
                            | "upperlimit"
                            | "lowerlimit"
                    ) || matches!(local.trim(), "无故障" | "正常" | "无" | "上限位" | "下限位")
                },
            );
        if !normal {
            return Err(unavailable());
        }
    }
    if service
        .properties
        .iter()
        .find(|p| p.name == "status")
        .filter(|p| p.code == Some(0))
        .and_then(current_choice)
        .is_some_and(|(name, local)| {
            matches!(
                name.as_str(),
                "settingheight"
                    | "calibrating"
                    | "obstaclestop"
                    | "motorlock"
                    | "fault"
                    | "limitfault"
                    | "circuitfault"
                    | "impede"
            ) || [
                "校准",
                "设限",
                "设置高度",
                "遇阻",
                "保护",
                "故障",
                "过载",
                "超重",
            ]
            .iter()
            .any(|label| local.contains(label))
        })
    {
        return Err(unavailable());
    }
    Ok(())
}

#[cfg(test)]
#[test]
fn standard_motion_uses_published_commands_and_live_fault_feedback() {
    let raw: Value = serde_json::from_str(include_str!(
        "fixtures/compatibility/airer--dooya.airer.2m.json"
    ))
    .unwrap();
    let device: crate::models::Device = serde_json::from_value(json!({
        "did":"airer-fixture", "name":"晾衣机", "model":"dooya.airer.2m", "online":true, "roomId":"room", "roomName":"阳台"
    })).unwrap();
    let mut panel = spec::parse_panel(&device, &raw).unwrap();
    assert_eq!(
        standard_motor_intent(&panel, 2, 2, &json!(0)).unwrap(),
        Intent::Down
    );
    assert_eq!(
        standard_motor_intent(&panel, 2, 2, &json!(2)).unwrap(),
        Intent::Pause
    );
    assert!(standard_motor_intent(&panel, 3, 2, &json!(0)).is_err());
    assert!(check_standard_motor_state(&panel, 2).is_err());
    let fault = panel
        .services
        .iter_mut()
        .find(|s| s.siid == 2)
        .unwrap()
        .properties
        .iter_mut()
        .find(|p| p.name == "fault")
        .unwrap();
    fault.code = Some(0);
    fault.value = Some(json!(1));
    assert!(check_standard_motor_state(&panel, 2).is_err());
    panel
        .services
        .iter_mut()
        .find(|s| s.siid == 2)
        .unwrap()
        .properties
        .iter_mut()
        .find(|p| p.name == "fault")
        .unwrap()
        .value = Some(json!(0));
    assert!(check_standard_motor_state(&panel, 2).is_ok());
}

#[cfg(test)]
#[test]
fn percentage_position_respects_the_legacy_rail_limits() {
    let mut panel: DevicePanel = serde_json::from_str(include_str!("fixtures/airer-panel.json")).unwrap();
    let target = property(&panel, 4, 9, "set-position", "uint8").unwrap();
    assert_eq!(position_rail(&panel, target).unwrap(), 2);
    assert!(check_position_limits(&panel, &json!(50)).is_ok());
    let service = panel.services.iter_mut().find(|s| s.siid == 4).unwrap();
    service.properties.iter_mut().find(|p| p.piid == 7).unwrap().value = Some(json!(25));
    service.properties.iter_mut().find(|p| p.piid == 8).unwrap().value = Some(json!(80));
    assert!(check_position_limits(&panel, &json!(20)).is_err());
    assert!(check_position_limits(&panel, &json!(85)).is_err());
    assert!(check_position_limits(&panel, &json!(50)).is_ok());
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LiftChange {
    pub intent: Intent,
    pub expected_status: u8,
}
pub struct LiftPlan {
    pub value: Value,
    pub no_op: bool,
    pub message: &'static str,
}
pub fn lift(p: &DevicePanel, c: &LiftChange) -> Result<LiftPlan> {
    let property = property(p, 2, 2, "motor-control", "uint8")
        .filter(|p| p.access.iter().any(|a| a == "write"))
        .ok_or_else(|| AppError::invalid("此型号的升降绑定尚未确认。"))?;
    let status = status(p).ok_or_else(|| AppError::invalid("请先读取当前升降状态。"))?;
    let target = match c.intent {
        Intent::Up => 1,
        Intent::Down => 2,
        Intent::Pause => 0,
    };
    spec::validate_value(property, &json!(target))?;
    if c.intent != Intent::Pause && status != c.expected_status {
        return Err(AppError::new(
            "stateSuperseded",
            "升降状态已变化，请重新读取后操作。",
            true,
        ));
    }
    let stopped = [0, 3, 4].contains(&status);
    let (no_op, message) = if c.intent == Intent::Pause {
        (stopped, "设备当前已停止。")
    } else {
        let position = number(p, 4, 11, "current-position", "uint8")
            .filter(|v| (0..=100).contains(v))
            .ok_or_else(|| AppError::invalid("请先读取当前晾杆位置。"))?;
        let upper = number(p, 4, 7, "upper-limit", "int8")
            .filter(|v| (0..=49).contains(v))
            .ok_or_else(|| AppError::invalid("请先读取上限位置。"))?;
        let lower = number(p, 4, 8, "lower-limit", "uint8")
            .filter(|v| (51..=100).contains(v))
            .ok_or_else(|| AppError::invalid("请先读取下限位置。"))?;
        match c.intent {
            Intent::Up => (
                status == 0 || position <= upper || status == 1,
                if status == 1 {
                    "设备当前正在上升。"
                } else {
                    "已到达上限位。"
                },
            ),
            Intent::Down => (
                status == 4 || position >= lower || status == 2,
                if status == 2 {
                    "设备当前正在下降。"
                } else {
                    "已到达下限位。"
                },
            ),
            _ => unreachable!(),
        }
    };
    Ok(LiftPlan {
        value: json!(target),
        no_op,
        message,
    })
}
pub fn lift_confirmed(p: &DevicePanel, intent: Intent) -> bool {
    match (intent, status(p)) {
        (Intent::Up, Some(1)) | (Intent::Down, Some(2)) => true,
        (Intent::Pause, Some(0 | 3 | 4)) => true,
        (Intent::Up, Some(0)) => number(p, 4, 11, "current-position", "uint8")
            .filter(|v| (0..=100).contains(v))
            .zip(number(p, 4, 7, "upper-limit", "int8").filter(|v| (0..=49).contains(v)))
            .is_some_and(|(v, limit)| v <= limit),
        (Intent::Down, Some(4)) => number(p, 4, 11, "current-position", "uint8")
            .filter(|v| (0..=100).contains(v))
            .zip(number(p, 4, 8, "lower-limit", "uint8").filter(|v| (51..=100).contains(v)))
            .is_some_and(|(v, limit)| v >= limit),
        _ => false,
    }
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Night {
    pub enabled: bool,
    pub start_hour: u8,
    pub start_minute: u8,
    pub end_hour: u8,
    pub end_minute: u8,
    pub brightness: u8,
}
#[derive(Debug, Deserialize, schemars::JsonSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NightChange {
    pub expected: Night,
    pub target: Night,
}
pub fn night(p: &DevicePanel) -> Option<Night> {
    let n = |piid, name, max| {
        number(p, 4, piid, name, "uint8")
            .filter(|v| (0..=max).contains(v))
            .map(|n| n as u8)
    };
    Some(Night {
        enabled: n(5, "nightlight-switch", 1)? == 1,
        start_hour: n(1, "start-time-hour", 23)?,
        start_minute: n(2, "start-time-min", 59)?,
        end_hour: n(3, "end-time-hour", 23)?,
        end_minute: n(4, "end-time-min", 59)?,
        brightness: n(6, "brightness", 100).filter(|v| *v >= 1)?,
    })
}
pub fn night_params(p: &DevicePanel, c: &NightChange) -> Result<Vec<Value>> {
    if night(p).as_ref() != Some(&c.expected) {
        return Err(AppError::new(
            "stateSuperseded",
            "夜灯设置已变化，请重新读取后编辑。",
            true,
        ));
    }
    let t = &c.target;
    let start = u16::from(t.start_hour) * 60 + u16::from(t.start_minute);
    let end = u16::from(t.end_hour) * 60 + u16::from(t.end_minute);
    if !(17..=23).contains(&t.start_hour)
        || !((17..=23).contains(&t.end_hour) || t.end_hour <= 8)
        || t.start_minute > 59
        || t.end_minute > 59
        || (t.end_hour == 8 && t.end_minute != 0)
        || !(1..=100).contains(&t.brightness)
        || (t.enabled && (start == end || (t.end_hour >= 17 && start > end)))
    {
        return Err(AppError::invalid(
            "请选择17:00以后开始、当晚或次日08:00以前结束的有效夜灯时段。",
        ));
    }
    let mut params = Vec::new();
    for (piid, name, v) in [
        (5, "nightlight-switch", u8::from(t.enabled)),
        (1, "start-time-hour", t.start_hour),
        (2, "start-time-min", t.start_minute),
        (3, "end-time-hour", t.end_hour),
        (4, "end-time-min", t.end_minute),
        (6, "brightness", t.brightness),
    ] {
        let property = property(p, 4, piid, name, "uint8")
            .filter(|p| p.access.iter().any(|a| a == "write"))
            .ok_or_else(|| AppError::invalid("夜灯设置缺少可写的型号绑定。"))?;
        spec::validate_value(property, &json!(v))?;
        params.push(json!({"did":p.control_did(),"siid":4,"piid":piid,"value":v}));
    }
    Ok(params)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn panel() -> DevicePanel {
        serde_json::from_str(include_str!("fixtures/airer-panel.json")).unwrap()
    }
    fn set(p: &mut DevicePanel, siid: u32, piid: u32, v: Value) {
        let p = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == siid && p.piid == piid)
            .unwrap();
        p.value = Some(v);
        p.code = Some(0);
    }
    #[test]
    fn motor_uses_independent_status_and_actual_limits() {
        let mut p = panel();
        let plan = lift(
            &p,
            &LiftChange {
                intent: Intent::Up,
                expected_status: 0,
            },
        )
        .unwrap();
        assert!(plan.no_op);
        assert_eq!(plan.value, json!(1));
        let plan = lift(
            &p,
            &LiftChange {
                intent: Intent::Down,
                expected_status: 0,
            },
        )
        .unwrap();
        assert!(!plan.no_op);
        assert_eq!(plan.value, json!(2));
        assert!(!lift_confirmed(&p, Intent::Down));
        set(&mut p, 2, 4, json!(2));
        assert!(lift_confirmed(&p, Intent::Down));
        assert!(lift(
            &p,
            &LiftChange {
                intent: Intent::Up,
                expected_status: 0
            }
        )
        .is_err());
        let pause = lift(
            &p,
            &LiftChange {
                intent: Intent::Pause,
                expected_status: 0,
            },
        )
        .unwrap();
        assert!(!pause.no_op);
        assert_eq!(pause.value, json!(0));
        set(&mut p, 2, 4, json!(3));
        assert!(lift_confirmed(&p, Intent::Pause));
    }
    #[test]
    fn missing_or_incompatible_live_bindings_cannot_authorize_lift() {
        let mut p = panel();
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 4)
            .unwrap()
            .code = None;
        assert!(lift(
            &p,
            &LiftChange {
                intent: Intent::Down,
                expected_status: 0
            }
        )
        .is_err());
        assert!(!lift_confirmed(&p, Intent::Pause));
        let mut p = panel();
        p.model = "other".into();
        assert!(lift(
            &p,
            &LiftChange {
                intent: Intent::Down,
                expected_status: 0
            }
        )
        .is_err());
        let mut p = panel();
        set(&mut p, 4, 8, json!(50));
        assert!(lift(
            &p,
            &LiftChange {
                intent: Intent::Down,
                expected_status: 0
            }
        )
        .is_err());
    }
    #[test]
    fn night_preflight_preserves_all_six_real_values_and_checks_stale_edits() {
        let p = panel();
        let current = night(&p).unwrap();
        let mut target = current.clone();
        target.start_hour = 23;
        target.end_hour = 7;
        target.end_minute = 30;
        let plan = night_params(
            &p,
            &NightChange {
                expected: current.clone(),
                target: target.clone(),
            },
        )
        .unwrap();
        assert_eq!(
            plan.iter()
                .map(|p| p["piid"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            [5, 1, 2, 3, 4, 6]
        );
        assert_eq!(plan[0]["value"], 1);
        assert_eq!(plan[4]["value"], 30);
        assert_eq!(plan[5]["value"], 60);
        assert!(night_params(
            &p,
            &NightChange {
                expected: target.clone(),
                target
            }
        )
        .is_err());
    }
    #[test]
    fn night_clock_window_is_the_vendor_picker_not_a_generic_daily_timer() {
        let p = panel();
        let current = night(&p).unwrap();
        for (sh, sm, eh, em) in [
            (16, 0, 23, 0),
            (23, 0, 22, 0),
            (22, 0, 22, 0),
            (22, 0, 8, 1),
            (22, 60, 7, 0),
        ] {
            let mut target = current.clone();
            target.start_hour = sh;
            target.start_minute = sm;
            target.end_hour = eh;
            target.end_minute = em;
            assert!(night_params(
                &p,
                &NightChange {
                    expected: current.clone(),
                    target
                }
            )
            .is_err());
        }
        let mut target = current.clone();
        target.start_hour = 23;
        target.end_hour = 8;
        target.end_minute = 0;
        assert!(night_params(
            &p,
            &NightChange {
                expected: current,
                target
            }
        )
        .is_ok());
    }
}
