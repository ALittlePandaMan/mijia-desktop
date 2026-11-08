//! v39 10598/10967/10973 and SDK10923/10065. A persistent flushing
//! preference is not an immediate rinse action. Push is a separate cloud key.
use crate::{
    error::{AppError, Result},
    models::{epoch_secs, Device, DevicePanel, Property},
    purifier,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
pub const PUSH_KEY: &str = "push_enable_27067";
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub fetched_at: u64,
    pub filter_flushing_supported: Option<bool>,
    pub support_reason: Option<String>,
    pub flushing: Option<bool>,
    pub push_enabled: Option<bool>,
    pub push_source: String,
    pub can_set_push: bool,
    pub push_reason: Option<String>,
    pub revision: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub revision: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangeResult {
    pub verified: bool,
    pub message: String,
    pub report: Option<Report>,
}
pub fn flushing_supported(device: &Device) -> Option<bool> {
    if device.model != purifier::MODEL || device.split_route.is_some() {
        return None;
    }
    let last = device.plugin_version.as_deref()?.rsplit('.').next()?;
    if last.is_empty() || !last.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    Some(last.parse::<u64>().ok()? > 9)
}
pub fn binding(panel: &DevicePanel) -> Option<&Property> {
    if panel.model != purifier::MODEL || panel.unsupported_reason.is_some() {
        return None;
    }
    let mut rows = panel
        .services
        .iter()
        .filter(|s| s.siid == 2 && s.name == "water-purifier")
        .flat_map(|s| &s.properties)
        .filter(|p| {
            p.siid == 2
                && p.piid == 7
                && p.name == "holiday-mode"
                && p.format == "bool"
                && p.access.iter().any(|a| a == "read")
        });
    let p = rows.next()?;
    rows.next().is_none().then_some(p)
}
pub fn flushing(panel: &DevicePanel) -> Option<bool> {
    let p = binding(panel)?;
    if p.code != Some(0) || p.unsupported_reason.is_some() {
        return None;
    }
    p.value.as_ref()?.as_bool()
}
pub fn can_handle(panel: &DevicePanel) -> bool {
    panel
        .services
        .iter()
        .filter(|s| s.siid == 4)
        .flat_map(|s| &s.properties)
        .any(|p| {
            p.siid == 4
                && p.piid == 2
                && p.name == "tds-out"
                && p.code == Some(0)
                && p.unsupported_reason.is_none()
                && p.value.as_ref().and_then(Value::as_f64).is_some()
        })
}
fn push_state(raw: &Value) -> (Option<bool>, &'static str) {
    let Some(settings) = raw.get("settings").and_then(Value::as_object) else {
        return (None, "unknown");
    };
    // 10973 returns null for an empty settings object, retaining the true
    // initial value in State10964. That is a vendor UI default, not a saved key.
    if settings.is_empty() {
        return (Some(true), "vendorDefault");
    }
    match settings.get(PUSH_KEY) {
        Some(Value::String(v)) if v == "1" => (Some(true), "cloud"),
        Some(Value::String(v)) if v == "0" => (Some(false), "cloud"),
        None => (Some(false), "vendorDefault"),
        _ => (None, "unknown"),
    }
}
pub fn project(
    device: &Device,
    panel: &DevicePanel,
    raw: Option<&Value>,
    owner: bool,
) -> Result<Report> {
    if panel.did != device.did || panel.model != device.model || device.model != purifier::MODEL {
        return Err(AppError::stale());
    }
    let support = flushing_supported(device);
    let flush = flushing(panel);
    let (push, push_source) = raw.map(push_state).unwrap_or((None, "unknown"));
    let support_reason = match support {
        Some(true) => None,
        Some(false) => Some("当前版本不显示滤芯冲洗设置。".into()),
        None => Some("尚未读取可核实的设备/MCU版本。".into()),
    };
    let reason = if support != Some(true) {
        support_reason.clone()
    } else if !device.online {
        Some("设备离线，恢复在线后再操作。".into())
    } else if device.shared_read_only || !owner {
        Some("当前仅支持家庭所有者设置冲洗提醒。".into())
    } else if flush != Some(true) {
        Some("请先读取并开启滤芯冲洗。".into())
    } else if !can_handle(panel) {
        Some("请先读取当前设备水质状态。".into())
    } else if push.is_none() {
        Some("尚未读取当前冲洗提醒设置。".into())
    } else {
        None
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                device.did.as_str(),
                &device.plugin_version,
                support,
                flush,
                push,
                push_source
            ))
            .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: device.did.clone(),
        fetched_at: epoch_secs(),
        filter_flushing_supported: support,
        support_reason,
        flushing: flush,
        push_enabled: push,
        push_source: push_source.into(),
        can_set_push: reason.is_none(),
        push_reason: reason,
        revision,
    })
}
pub fn validate_push(report: &Report, change: &Change) -> Result<()> {
    if !report.can_set_push {
        return Err(AppError::new(
            "permissionDenied",
            report
                .push_reason
                .as_deref()
                .unwrap_or("当前不能设置冲洗提醒。"),
            false,
        ));
    }
    if report.revision != change.revision {
        return Err(AppError::new(
            "stateSuperseded",
            "冲洗设置已变化，请重新读取。",
            true,
        ));
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn context() -> (Device, DevicePanel) {
        let p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/purifier-panel.json")).unwrap();
        let mut d:Device=serde_json::from_value(json!({"did":p.did,"model":p.model,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap();
        d.plugin_version = Some("1.1.3.0017".into());
        (d, p)
    }
    #[test]
    fn capability_uses_last_version_segment_and_exact_model() {
        let (mut d, _) = context();
        assert_eq!(flushing_supported(&d), Some(true));
        for (v, r) in [
            ("1.1.3", Some(false)),
            ("1.1.3.0009", Some(false)),
            ("1.1.3.0010", Some(true)),
            ("1.1.3.bad", None),
            ("1.1.3.", None),
        ] {
            d.plugin_version = Some(v.into());
            assert_eq!(flushing_supported(&d), r);
        }
        d.model = "other".into();
        assert_eq!(flushing_supported(&d), None);
    }
    #[test]
    fn empty_cloud_response_is_distinguished_from_a_saved_key() {
        assert_eq!(
            push_state(&json!({"settings":{}})),
            (Some(true), "vendorDefault")
        );
        assert_eq!(
            push_state(&json!({"settings":{PUSH_KEY:"1"}})),
            (Some(true), "cloud")
        );
        assert_eq!(
            push_state(&json!({"settings":{PUSH_KEY:"0"}})),
            (Some(false), "cloud")
        );
        assert_eq!(
            push_state(&json!({"settings":{"push_enable_other":"1"}})),
            (Some(false), "vendorDefault")
        );
        assert_eq!(
            push_state(&json!({"settings":{PUSH_KEY:true}})),
            (None, "unknown")
        );
        assert_eq!(push_state(&json!({"settings":null})), (None, "unknown"));
    }
    #[test]
    fn current_binding_permission_and_revision_authorize_push() {
        let (mut d, mut p) = context();
        let raw = json!({"settings":{PUSH_KEY:"1"}});
        let r = project(&d, &p, Some(&raw), true).unwrap();
        assert!(r.can_set_push);
        assert!(validate_push(
            &r,
            &Change {
                revision: r.revision.clone(),
                enabled: false
            }
        )
        .is_ok());
        assert!(validate_push(
            &r,
            &Change {
                revision: "stale".into(),
                enabled: false
            }
        )
        .is_err());
        assert!(!project(&d, &p, Some(&raw), false).unwrap().can_set_push);
        d.online = false;
        assert!(!project(&d, &p, Some(&raw), true).unwrap().can_set_push);
        d.online = true;
        p.services[0]
            .properties
            .iter_mut()
            .find(|v| v.piid == 7)
            .unwrap()
            .code = None;
        assert!(!project(&d, &p, Some(&raw), true).unwrap().can_set_push);
        assert!(flushing(&p).is_none());
        let (d, mut p) = context();
        p.services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 4 && p.piid == 2)
            .unwrap()
            .code = None;
        assert!(!project(&d, &p, Some(&raw), true).unwrap().can_set_push);
    }
    #[test]
    fn flushing_is_a_persistent_bool_without_an_invented_instant_action() {
        let (_, mut p) = context();
        assert!(purifier::validate_setting(&p, 2, 7, &json!(false)).is_ok());
        assert!(purifier::validate_setting(&p, 2, 7, &json!(1)).is_err());
        p.services[0]
            .properties
            .iter_mut()
            .find(|v| v.piid == 2)
            .unwrap()
            .value = Some(json!(2));
        assert!(purifier::validate_setting(&p, 2, 7, &json!(false)).is_ok());
        p.services[0]
            .properties
            .iter_mut()
            .find(|v| v.piid == 7)
            .unwrap()
            .value = Some(json!(1));
        assert!(purifier::validate_setting(&p, 2, 7, &json!(false)).is_err());
    }
}
