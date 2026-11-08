//! gxj v29 11810/10850/10709/10781: actions2.2/2.3 and actual status/progress.
use crate::{
    dispenser_config::property,
    error::{AppError, Result},
    models::DevicePanel,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Operation {
    Start,
    Stop,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub operation: Operation,
    pub expected_status: u8,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct State {
    pub status: Option<u8>,
    pub progress: Option<u8>,
    pub fault: Option<u32>,
}
pub fn profile(panel: &DevicePanel) -> bool {
    let Some(status) = property(panel, 2, 2, "status", "uint8") else {
        return false;
    };
    let expected = [
        "Fault",
        "Idle",
        "Water Coming Out",
        "In Water Shortage",
        "High Temperature Sterilization",
        "High Temperature Sterilization Stop",
        "High Temperature Sterilization Complete",
    ];
    status
        .value_list
        .as_ref()
        .is_some_and(|list| list.len() == 7)
        && expected.iter().enumerate().all(|(i, name)| {
            status.value_list.as_ref().is_some_and(|list| {
                list.iter()
                    .filter(|v| {
                        v.value.as_u64() == Some(i as u64)
                            && v.description.eq_ignore_ascii_case(name)
                    })
                    .count()
                    == 1
            })
        })
        && property(panel, 2, 1, "fault", "uint32").is_some()
        && property(panel, 2, 8, "progress", "uint8").is_some()
}
pub fn state(panel: &DevicePanel) -> State {
    let number = |piid, name, format| {
        property(panel, 2, piid, name, format)
            .filter(|p| p.code == Some(0) && p.access.iter().any(|a| a == "read"))
            .and_then(|p| p.value.as_ref())
            .and_then(|v| v.as_u64())
    };
    if !profile(panel) {
        return State {
            status: None,
            progress: None,
            fault: None,
        };
    }
    State {
        status: number(2, "status", "uint8")
            .filter(|v| *v <= 6)
            .map(|v| v as u8),
        progress: number(8, "progress", "uint8")
            .filter(|v| *v <= 100)
            .map(|v| v as u8),
        fault: number(1, "fault", "uint32").and_then(|v| u32::try_from(v).ok()),
    }
}
pub fn action(panel: &DevicePanel, change: &Change) -> Result<u32> {
    if !profile(panel) {
        return Err(AppError::new(
            "unsupported",
            "此型号的杀菌状态绑定尚未确认。",
            false,
        ));
    }
    let s = state(panel);
    let status = s
        .status
        .ok_or_else(|| AppError::invalid("杀菌状态未能直接读取，请重新读取。"))?;
    if status != change.expected_status {
        return Err(AppError::invalid("设备状态已改变，请重新读取后操作。"));
    }
    match change.operation {
        Operation::Start => {
            match status {
                0 => return Err(AppError::invalid("管线机存在故障，请先解决故障。")),
                2 => return Err(AppError::invalid("管线机出水中，请先停止出水。")),
                3 => return Err(AppError::invalid("管线机缺水，请检查管路连接。")),
                1 => {}
                4 => return Err(AppError::invalid("设备已经在冲洗中，请勿重复开始。")),
                _ => return Err(AppError::invalid("请先按设备提示排空高温余水。")),
            }
            if s.fault != Some(0) {
                return Err(AppError::invalid(
                    "设备故障状态未确认正常，请重新读取并检查设备。",
                ));
            }
        }
        Operation::Stop => {
            if status != 4 {
                return Err(AppError::invalid("设备当前未在执行高温杀菌，请重新读取。"));
            }
        }
    }
    let (aiid, name) = match change.operation {
        Operation::Start => (2, "start-sterilization"),
        Operation::Stop => (3, "stop-sterilization"),
    };
    let actions = panel
        .services
        .iter()
        .filter(|s| s.siid == 2 && s.name == "water-dispenser")
        .flat_map(|s| &s.actions)
        .filter(|a| a.siid == 2 && a.aiid == aiid && a.name == name)
        .collect::<Vec<_>>();
    if actions.len() != 1
        || !actions[0].inputs.is_empty()
        || !actions[0].out.is_empty()
        || actions[0].unsupported_reason.is_some()
    {
        return Err(AppError::new(
            "unsupported",
            "设备没有提供已核实的杀菌动作。",
            false,
        ));
    }
    Ok(aiid)
}
pub fn target_matches(panel: &DevicePanel, operation: Operation) -> bool {
    matches!(
        (operation, state(panel).status),
        (Operation::Start, Some(4 | 6)) | (Operation::Stop, Some(5 | 6))
    )
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn panel(status: u8) -> DevicePanel {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        for property in p.services.iter_mut().flat_map(|s| &mut s.properties) {
            property.code = Some(0);
            property.value = Some(json!(if property.siid == 2 && property.piid == 2 {
                status
            } else {
                0
            }));
        }
        p
    }
    #[test]
    fn idle_start_and_running_stop_choose_exact_zero_input_actions() {
        assert_eq!(
            action(
                &panel(1),
                &Change {
                    operation: Operation::Start,
                    expected_status: 1
                }
            )
            .unwrap(),
            2
        );
        assert_eq!(
            action(
                &panel(4),
                &Change {
                    operation: Operation::Stop,
                    expected_status: 4
                }
            )
            .unwrap(),
            3
        )
    }
    #[test]
    fn preflight_blocks_changed_unread_fault_running_and_drain_states() {
        for status in [0, 2, 3, 4, 5, 6] {
            assert!(action(
                &panel(status),
                &Change {
                    operation: Operation::Start,
                    expected_status: status
                }
            )
            .is_err())
        }
        assert!(action(
            &panel(1),
            &Change {
                operation: Operation::Start,
                expected_status: 4
            }
        )
        .is_err());
        let mut p = panel(1);
        let fault = p
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 1)
            .unwrap();
        fault.code = Some(-1);
        assert!(action(
            &p,
            &Change {
                operation: Operation::Start,
                expected_status: 1
            }
        )
        .is_err());
    }
    #[test]
    fn rejects_changed_schema_and_action_inputs() {
        let mut p = panel(1);
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.actions)
            .find(|a| a.siid == 2 && a.aiid == 2)
            .unwrap()
            .inputs
            .push(1);
        assert!(action(
            &p,
            &Change {
                operation: Operation::Start,
                expected_status: 1
            }
        )
        .is_err());
        p.model = "other".into();
        assert!(!profile(&p));
    }
    #[test]
    fn acknowledgement_or_old_idle_cannot_confirm_action() {
        assert!(!target_matches(&panel(1), Operation::Start));
        assert!(target_matches(&panel(4), Operation::Start));
        assert!(!target_matches(&panel(4), Operation::Stop));
        assert!(target_matches(&panel(5), Operation::Stop));
        assert!(target_matches(&panel(6), Operation::Start));
        let mut p = panel(6);
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 2)
            .unwrap()
            .code = Some(-1);
        assert!(!target_matches(&p, Operation::Start));
    }
}
