//! gxj v29 self-check stages, from modules 10838/10844/10850/11858.
use crate::{
    dispenser,
    error::{AppError, Result},
    models::DevicePanel,
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub operation: Operation,
    pub expected: Vec<u8>,
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Operation {
    Start,
    Cup,
    Heat,
    Stop,
}

fn service(panel: &DevicePanel) -> Option<&crate::models::Service> {
    if panel.model != dispenser::MODEL || panel.unsupported_reason.is_some() {
        return None;
    }
    let mut services = panel
        .services
        .iter()
        .filter(|s| s.siid == 7 && s.name == "self-check");
    let service = services.next()?;
    if services.next().is_some() {
        return None;
    }
    let mut results = service.properties.iter().filter(|p| {
        p.piid == 2
            && p.siid == 7
            && p.name == "self-check-results"
            && p.format == "string"
            && p.access.iter().any(|a| a == "read")
            && p.unsupported_reason.is_none()
    });
    results.next()?;
    if results.next().is_some() {
        return None;
    }
    Some(service)
}
pub fn supported(panel: &DevicePanel) -> bool {
    service(panel).is_some()
}
pub fn parse(value: &str) -> Option<Vec<u8>> {
    if value.len() > 32 {
        return None;
    }
    let mut parts = Vec::new();
    for part in value.split(',') {
        let status = if part.is_empty() {
            0
        } else if part.len() == 1 {
            part.parse::<u8>().ok()?
        } else {
            return None;
        };
        if status > 4 {
            return None;
        }
        parts.push(status);
    }
    if parts.len() > 9 {
        return None;
    }
    parts.resize(9, 0);
    Some(parts)
}
pub fn state(panel: &DevicePanel) -> Option<Vec<u8>> {
    let prop = service(panel)?.properties.iter().find(|p| p.piid == 2)?;
    if prop.code != Some(0) {
        return None;
    }
    parse(prop.value.as_ref()?.as_str()?)
}
pub fn action(panel: &DevicePanel, change: &Change) -> Result<(u32, Vec<serde_json::Value>)> {
    let service = service(panel)
        .ok_or_else(|| AppError::new("unsupported", "此设备的自检状态绑定尚未核实。", false))?;
    let actual = state(panel).ok_or_else(|| AppError::invalid("未取得实时自检状态。"))?;
    if actual != change.expected {
        return Err(AppError::invalid(
            "自检状态已改变，请查看当前状态后再操作。",
        ));
    }
    if change.operation == Operation::Start {
        let current = crate::dispenser_sterilization::state(panel);
        if current.status != Some(1) {
            return Err(AppError::invalid(
                "设备需要处于待机状态，杀菌后请先排空余水。",
            ));
        }
    }
    let complete = |x: &u8| matches!(x, 1 | 2);
    let (aiid, inputs, name) = match change.operation {
        Operation::Start if actual.iter().all(|v| *v == 0) => {
            (1, vec![serde_json::json!(1)], "start-check")
        }
        Operation::Cup
            if actual[..6].iter().all(complete) && actual[6..].iter().all(|v| *v == 0) =>
        {
            (1, vec![serde_json::json!(7)], "start-check")
        }
        Operation::Heat
            if actual[..7].iter().all(complete) && actual[7..].iter().all(|v| *v == 0) =>
        {
            (1, vec![serde_json::json!(8)], "start-check")
        }
        Operation::Stop
            if actual.iter().any(|v| *v != 0)
                && actual.iter().any(|v| *v == 0 || *v == 4)
                && !actual.contains(&3) =>
        {
            (2, vec![], "stop-check")
        }
        _ => return Err(AppError::invalid("当前自检阶段不允许执行此操作。")),
    };
    let mut actions = service.actions.iter().filter(|a| {
        a.siid == 7 && a.aiid == aiid && a.name == name && a.unsupported_reason.is_none()
    });
    let action = actions.next().ok_or_else(AppError::protocol)?;
    if actions.next().is_some()
        || !action.out.is_empty()
        || action.inputs != (if aiid == 1 { vec![1] } else { vec![] })
    {
        return Err(AppError::protocol());
    }
    if aiid == 1 {
        let mut props = service.properties.iter().filter(|p| {
            p.piid == 1
                && p.siid == 7
                && p.name == "self-check-items"
                && p.format == "uint8"
                && p.unsupported_reason.is_none()
        });
        let p = props.next().ok_or_else(AppError::protocol)?;
        if props.next().is_some()
            || !p.value_list.as_ref().is_some_and(|list| {
                (1..=9).all(|i| list.iter().any(|v| v.value.as_u64() == Some(i)))
            })
        {
            return Err(AppError::protocol());
        }
    }
    Ok((aiid, inputs))
}
pub fn target_matches(panel: &DevicePanel, op: Operation) -> bool {
    let Some(values) = state(panel) else {
        return false;
    };
    match op {
        Operation::Start => values[0] != 0,
        Operation::Cup => values[6] != 0,
        Operation::Heat => values[7] != 0 || values[8] != 0,
        Operation::Stop => values.iter().all(|v| *v == 0),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn panel(value: &str) -> DevicePanel {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        for item in p.services.iter_mut().flat_map(|s| &mut s.properties) {
            if item.siid == 2 && item.piid == 1 {
                item.code = Some(0);
                item.value = Some(json!(0));
            }
            if item.siid == 2 && item.piid == 2 {
                item.code = Some(0);
                item.value = Some(json!(1));
            }
        }
        let item = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 7 && p.piid == 2)
            .unwrap();
        item.code = Some(0);
        item.value = Some(json!(value));
        p
    }
    fn change(operation: Operation, value: &str) -> Change {
        Change {
            operation,
            expected: parse(value).unwrap(),
        }
    }
    #[test]
    fn parser_rejects_unknown_or_excess_statuses() {
        assert_eq!(parse("0,1,2,3,4").unwrap(), vec![0, 1, 2, 3, 4, 0, 0, 0, 0]);
        for s in ["-1", "5", "2.0", "1,2,3,4,0,1,2,3,4,0", "a"] {
            assert!(parse(s).is_none());
        }
    }
    #[test]
    fn stages_require_exact_current_values_and_completed_previous_steps() {
        let idle = panel("0,0,0,0,0,0,0,0,0");
        assert_eq!(
            action(&idle, &change(Operation::Start, "0,0,0,0,0,0,0,0,0"))
                .unwrap()
                .1,
            vec![json!(1)]
        );
        let auto = panel("1,1,2,1,1,1,0,0,0");
        assert_eq!(
            action(&auto, &change(Operation::Cup, "1,1,2,1,1,1,0,0,0"))
                .unwrap()
                .1,
            vec![json!(7)]
        );
        assert!(action(&auto, &change(Operation::Heat, "1,1,2,1,1,1,0,0,0")).is_err());
        let cup = panel("1,1,2,1,1,1,1,0,0");
        assert_eq!(
            action(&cup, &change(Operation::Heat, "1,1,2,1,1,1,1,0,0"))
                .unwrap()
                .1,
            vec![json!(8)]
        );
        assert!(action(&cup, &change(Operation::Cup, "1,1,2,1,1,1,0,0,0")).is_err());
    }
    #[test]
    fn start_requires_live_idle_status() {
        let mut p = panel("0,0,0,0,0,0,0,0,0");
        let status = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 2)
            .unwrap();
        status.value = Some(json!(4));
        assert!(action(&p, &change(Operation::Start, "0,0,0,0,0,0,0,0,0")).is_err());
        let status = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 2)
            .unwrap();
        status.value = Some(json!(1));
        let status = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 2)
            .unwrap();
        status.code = Some(-1);
        assert!(action(&p, &change(Operation::Start, "0,0,0,0,0,0,0,0,0")).is_err());
    }
    #[test]
    fn readback_not_receipt_confirms_and_bad_metadata_blocks() {
        let p = panel("1,1,1,1,1,1,4,0,0");
        assert!(target_matches(&p, Operation::Cup));
        assert!(!target_matches(&p, Operation::Heat));
        assert_eq!(
            action(&p, &change(Operation::Stop, "1,1,1,1,1,1,4,0,0"))
                .unwrap()
                .0,
            2
        );
        let mut invalid = p.clone();
        invalid
            .services
            .iter_mut()
            .find(|s| s.siid == 7)
            .unwrap()
            .actions[1]
            .inputs = vec![1];
        assert!(action(&invalid, &change(Operation::Stop, "1,1,1,1,1,1,4,0,0")).is_err());
    }
}
