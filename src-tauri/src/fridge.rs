//! Independent translation of APK standard fridge17369/spec17381/control15638.
//! F01 has no model interceptor. Other model-specific interceptors are not assumed.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const MODEL: &str = "midjd.fridge.f01";
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    Mode,
    Refrigerating,
    Freezing,
    Maternal,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub field: Field,
    pub expected: i64,
    pub value: i64,
}
pub fn binding(p: &DevicePanel, field: Field) -> Option<&Property> {
    if p.model != MODEL
        || p.unsupported_reason.is_some()
        || !p
            .spec_type
            .as_ref()
            .is_some_and(|v| v.starts_with("urn:miot-spec-v2:device:fridge:"))
    {
        return None;
    }
    let (service, description, name, format) = match field {
        Field::Mode => ("fridge", None, "mode", "uint8"),
        Field::Refrigerating => (
            "fridge-chamber",
            Some("Refrigerating Chamber"),
            "target-temperature",
            "int8",
        ),
        Field::Freezing => (
            "fridge-chamber",
            Some("Freezing Chamber"),
            "target-temperature",
            "int8",
        ),
        Field::Maternal => (
            "fridge-chamber",
            Some("Maternal-infant Chamber"),
            "mode",
            "uint8",
        ),
    };
    let mut rows = p
        .services
        .iter()
        .filter(|s| s.name == service && description.is_none_or(|d| s.description == d))
        .flat_map(|s| s.properties.iter().filter(move |q| q.siid == s.siid))
        .filter(|q| q.name == name && q.format == format && q.unsupported_reason.is_none());
    let property = rows.next()?;
    rows.next().is_none().then_some(property)
}
pub fn current(p: &DevicePanel, field: Field) -> Option<i64> {
    let q = binding(p, field)?;
    if q.code != Some(0) || !q.access.iter().any(|a| a == "read") {
        return None;
    }
    q.value.as_ref()?.as_i64()
}
pub fn validate<'a>(p: &'a DevicePanel, change: &Change) -> Result<&'a Property> {
    let q = binding(p, change.field)
        .filter(|q| q.access.iter().any(|a| a == "write"))
        .ok_or_else(|| AppError::invalid("此冰箱型号的控制绑定尚未确认。"))?;
    if current(p, change.field) != Some(change.expected) {
        return Err(AppError::new(
            "stateSuperseded",
            "设备设置已变化，请重新读取后操作。",
            true,
        ));
    }
    spec::validate_value(q, &json!(change.value))?;
    match change.field {
        Field::Mode | Field::Maternal => {
            let allowed: &[&str] = if change.field == Field::Mode {
                &["Smart", "Quick Cooling", "Quick Frozen"]
            } else {
                &["Premium", "Maternal-infant Products", "Zero Degree"]
            };
            if !q.value_list.as_ref().is_some_and(|rows| {
                rows.iter().any(|v| {
                    v.value == json!(change.value) && allowed.contains(&v.description.as_str())
                })
            }) {
                return Err(AppError::invalid("此模式未在原版控件的可选枚举中。"));
            }
        }
        _ => {
            if q.value_list.is_some()
                || q.value_range
                    .as_ref()
                    .is_none_or(|r| r.len() != 3 || r[0] >= r[1])
            {
                return Err(AppError::invalid("温区没有有效的实际范围。"));
            }
        }
    }
    Ok(q)
}
pub fn target_matches(p: &DevicePanel, c: &Change) -> bool {
    current(p, c.field) == Some(c.value)
}
/// Mode/temperature firmware coupling is observed in the original UI. Protect
/// every readable fridge field against pre-write background responses.
pub fn version_keys(p: &DevicePanel) -> Vec<(u32, u32)> {
    p.services
        .iter()
        .filter(|s| s.name != "device-information")
        .flat_map(|s| &s.properties)
        .filter(|p| p.access.iter().any(|a| a == "read"))
        .map(|p| (p.siid, p.piid))
        .collect()
}
pub fn value(c: &Change) -> Value {
    json!(c.value)
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub mode: i64,
    pub refrigerating: i64,
    pub freezing: i64,
    pub maternal: Option<i64>,
}
pub fn snapshot(p: &DevicePanel) -> Option<Snapshot> {
    Some(Snapshot {
        mode: current(p, Field::Mode)?,
        refrigerating: current(p, Field::Refrigerating)?,
        freezing: current(p, Field::Freezing)?,
        maternal: if p
            .services
            .iter()
            .any(|s| s.name == "fridge-chamber" && s.description == "Maternal-infant Chamber")
        {
            Some(current(p, Field::Maternal)?)
        } else {
            None
        },
    })
}
pub fn reset_action<'a>(
    p: &'a DevicePanel,
    expected: &Snapshot,
) -> Result<&'a crate::models::Action> {
    if snapshot(p).as_ref() != Some(expected) {
        return Err(AppError::new(
            "stateSuperseded",
            "冰箱模式或温度已变化，请重新读取后确认。",
            true,
        ));
    }
    let mut rows = p
        .services
        .iter()
        .filter(|s| s.name == "fridge-reset")
        .flat_map(|s| &s.actions)
        .filter(|a| {
            a.name == "reset"
                && a.inputs.is_empty()
                && a.out.is_empty()
                && a.unsupported_reason.is_none()
        });
    let action = rows
        .next()
        .ok_or_else(|| AppError::invalid("设备没有已确认的恢复出厂设置动作。"))?;
    if rows.next().is_some() {
        return Err(AppError::invalid("恢复动作绑定不唯一。"));
    }
    Ok(action)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn panel() -> DevicePanel {
        serde_json::from_str(include_str!("fixtures/fridge-panel.json")).unwrap()
    }
    #[test]
    fn uses_service_description_and_target_not_sensor_temperature() {
        let p = panel();
        assert_eq!(current(&p, Field::Refrigerating), Some(5));
        assert_eq!(current(&p, Field::Freezing), Some(-18));
        assert_eq!(binding(&p, Field::Maternal).unwrap().siid, 6);
        let mut p = p;
        let s = p.services.iter_mut().find(|s| s.siid == 3).unwrap();
        s.siid = 37;
        for q in &mut s.properties {
            q.siid = 37;
        }
        assert_eq!(binding(&p, Field::Refrigerating).unwrap().siid, 37);
    }
    #[test]
    fn rejects_stale_unknown_and_non_original_modes() {
        let p = panel();
        assert!(validate(
            &p,
            &Change {
                field: Field::Mode,
                expected: 1,
                value: 2
            }
        )
        .is_ok());
        for (expected, value) in [(0, 2), (1, 0), (1, 9)] {
            assert!(validate(
                &p,
                &Change {
                    field: Field::Mode,
                    expected,
                    value
                }
            )
            .is_err());
        }
        let mut p = p;
        binding(&p, Field::Mode).unwrap();
        p.model = "other".into();
        assert!(binding(&p, Field::Mode).is_none());
    }
    #[test]
    fn validates_real_ranges_and_code_zero() {
        let p = panel();
        assert!(validate(
            &p,
            &Change {
                field: Field::Freezing,
                expected: -18,
                value: -24
            }
        )
        .is_ok());
        assert!(validate(
            &p,
            &Change {
                field: Field::Freezing,
                expected: -18,
                value: -25
            }
        )
        .is_err());
        let mut p = p;
        p.services
            .iter_mut()
            .find(|s| s.siid == 3)
            .unwrap()
            .properties
            .iter_mut()
            .find(|q| q.piid == 2)
            .unwrap()
            .code = None;
        assert!(current(&p, Field::Refrigerating).is_none());
    }
    #[test]
    fn protects_coupled_readbacks_and_rejects_duplicate_bindings() {
        let mut p = panel();
        let keys = version_keys(&p);
        assert!(keys.contains(&(2, 2)) && keys.contains(&(3, 2)) && keys.contains(&(4, 2)));
        p.services
            .push(p.services.iter().find(|s| s.siid == 3).unwrap().clone());
        assert!(binding(&p, Field::Refrigerating).is_none());
    }
    #[test]
    fn reset_requires_complete_unchanged_live_snapshot_and_exact_no_input_action() {
        let mut p = panel();
        let baseline = snapshot(&p).unwrap();
        assert_eq!(reset_action(&p, &baseline).unwrap().aiid, 1);
        let mut stale = baseline.clone();
        stale.refrigerating = 6;
        assert!(reset_action(&p, &stale).is_err());
        p.services
            .iter_mut()
            .find(|s| s.name == "fridge-reset")
            .unwrap()
            .actions[0]
            .inputs
            .push(1);
        assert!(reset_action(&p, &baseline).is_err());
    }
}
