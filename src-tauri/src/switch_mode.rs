//! Mode is a read dependency, never a desktop configuration control.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
};
use serde_json::Value;

pub fn property(panel: &DevicePanel, siid: u32) -> Option<&Property> {
    panel
        .services
        .iter()
        .find(|s| s.siid == siid && s.name == "switch")?
        .properties
        .iter()
        .find(|p| p.name == "mode" && p.access.iter().any(|a| a == "read"))
}
pub fn label(model: &str, property: &Property, value: &Value) -> Option<&'static str> {
    let choice = property
        .value_list
        .as_ref()?
        .iter()
        .find(|c| c.value == *value)?;
    let name = choice
        .description
        .to_ascii_lowercase()
        .replace([' ', '-', '_'], "");
    if model == "yeelink.switch.ylsw6" && value.as_i64() == Some(2) && name == "wireless" {
        return Some("灵动开关");
    }
    match name.as_str() {
        "wireless" | "wirelessswitch" => Some("无线开关"),
        "flex" | "flexswitch" => Some("灵动开关"),
        _ => None,
    }
}
pub fn validate(panel: &DevicePanel, siid: u32) -> Result<()> {
    let Some(p) = property(panel, siid) else {
        return Ok(());
    };
    let value = p
        .value
        .as_ref()
        .filter(|_| p.code == Some(0))
        .ok_or_else(|| {
            AppError::new(
                "switchModeUnavailable",
                "开关模式未读取，暂不能操作此按键。",
                true,
            )
        })?;
    if let Some(label) = label(&panel.model, p, value) {
        return Err(AppError::new(
            "switchModeRestricted",
            format!("此按键已转为{label}，不能切断供电。"),
            false,
        ));
    }
    let normal = p.value_list.as_ref().is_some_and(|list| {
        list.iter()
            .any(|c| c.value == *value && c.description.eq_ignore_ascii_case("Wired And Wireless"))
    });
    if !normal {
        return Err(AppError::new(
            "switchModeUnavailable",
            "无法确认开关模式，暂不能操作此按键。",
            true,
        ));
    }
    Ok(())
}

/// A mode check reads only its dependency, never the relay's current on value.
pub async fn check<F, Fut>(panel: &DevicePanel, siid: u32, read: F) -> Result<()>
where
    F: FnOnce(u32, u32) -> Fut,
    Fut: std::future::Future<Output = Result<DevicePanel>>,
{
    let Some(mode) = property(panel, siid) else {
        return Ok(());
    };
    let latest = read(mode.siid, mode.piid).await.map_err(|error| {
        if matches!(
            error.kind.as_str(),
            "network" | "timeout" | "offline" | "deviceError" | "protocol" | "busy"
        ) {
            AppError::new(
                "switchModeUnavailable",
                "开关模式无法读取，已跳过此按键。",
                true,
            )
        } else {
            error
        }
    })?;
    validate(&latest, siid)
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn panel(value: Value, code: i32) -> DevicePanel {
        serde_json::from_value(json!({"did":"fixture","model":"yeelink.switch.ylsw6","services":[{"siid":7,"name":"switch","description":"","actions":[],"properties":[{"siid":7,"piid":8,"name":"mode","description":"Mode","format":"uint8","access":["read","write"],"code":code,"value":value,"valueList":[{"value":0,"description":"Wired And Wireless"},{"value":1,"description":"Wireless"},{"value":2,"description":"Wireless"},{"value":3,"description":"Wireless"}]}]}]})).unwrap()
    }
    #[test]
    fn wireless_flex_and_remote_all_reject_power_writes() {
        for mode in [1, 2, 3] {
            assert!(validate(&panel(json!(mode), 0), 7).is_err())
        }
        assert!(validate(&panel(json!(0), 0), 7).is_ok())
    }
    #[test]
    fn missing_error_and_unknown_mode_cannot_authorize() {
        for p in [
            panel(Value::Null, 0),
            panel(json!(0), -1),
            panel(json!(8), 0),
        ] {
            assert!(validate(&p, 7).is_err())
        }
        assert!(validate(&panel(json!(1), 0), 9).is_ok())
    }
    #[test]
    fn labels_are_model_bound() {
        let p = panel(json!(2), 0);
        let prop = property(&p, 7).unwrap();
        assert_eq!(label(&p.model, prop, &json!(2)), Some("灵动开关"));
        assert_eq!(label("other.switch", prop, &json!(2)), Some("无线开关"))
    }
    #[tokio::test]
    async fn live_guard_uses_the_current_mode_and_only_reads_its_dependency() {
        let schema = panel(json!(0), 0);
        for value in [0, 1, 2, 3] {
            let seen = std::sync::Mutex::new(Vec::new());
            let result = check(&schema, 7, |siid, piid| {
                seen.lock().unwrap().push((siid, piid));
                async move { Ok(panel(json!(value), 0)) }
            })
            .await;
            assert_eq!(*seen.lock().unwrap(), vec![(7, 8)]);
            if value == 0 {
                assert!(result.is_ok());
            } else {
                assert_eq!(result.unwrap_err().kind, "switchModeRestricted");
            }
        }
    }
    #[tokio::test]
    async fn failed_mode_reads_skip_instead_of_becoming_unknown_writes_and_auth_is_preserved() {
        let schema = panel(json!(0), 0);
        for kind in [
            "network",
            "timeout",
            "offline",
            "deviceError",
            "protocol",
            "busy",
        ] {
            let error = check(&schema, 7, |_, _| async {
                Err(AppError::new(kind, "fixture", true))
            })
            .await
            .unwrap_err();
            assert_eq!(error.kind, "switchModeUnavailable");
        }
        let error = check(&schema, 7, |_, _| async { Err(AppError::auth()) })
            .await
            .unwrap_err();
        assert_eq!(error.kind, "authExpired");
        assert!(check(&schema, 2, |_, _| async {
            panic!("a service without modes must not read dependencies")
        })
        .await
        .is_ok());
    }
}
