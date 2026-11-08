//! Router plugin 11702: local draft, explicit save, GET confirmation after POST.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndicatorValues {
    pub on: bool,
    pub timer_on: bool,
    pub open_time: String,
    pub close_time: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorReport {
    pub did: String,
    pub model: String,
    pub values: IndicatorValues,
    pub revision: String,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IndicatorChange {
    pub baseline: String,
    pub values: IndicatorValues,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorResult {
    pub status: String,
    pub report: Option<IndicatorReport>,
    pub message: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IndicatorRead {
    pub report: IndicatorReport,
    pub pending: Option<IndicatorChange>,
}
pub fn writable(device: &Device) -> Result<()> {
    router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    if device.shared_read_only {
        return Err(AppError::new(
            "permissionDenied",
            "此共享设备只有读取权限。",
            false,
        ));
    }
    Ok(())
}
pub fn matches(report: &IndicatorReport, values: &IndicatorValues) -> bool {
    report.values == *values
}
#[derive(Debug, PartialEq, Eq)]
pub enum SaveDecision {
    Confirmed,
    ConfirmPending,
    Send,
}
pub fn decision(
    current: &IndicatorReport,
    change: &IndicatorChange,
    pending: Option<&IndicatorChange>,
    confirm_only: bool,
) -> Result<SaveDecision> {
    change.validate()?;
    if pending.is_some_and(|p| !matches(current, &p.values)) {
        return Ok(SaveDecision::ConfirmPending);
    }
    if matches(current, &change.values) {
        return Ok(SaveDecision::Confirmed);
    }
    if confirm_only {
        return Ok(SaveDecision::ConfirmPending);
    }
    if current.revision != change.baseline {
        return Err(AppError::new(
            "conflict",
            "指示灯设置已变化，请重新打开页面后编辑。",
            false,
        ));
    }
    Ok(SaveDecision::Send)
}
fn bit(value: &Value) -> Option<bool> {
    match value {
        Value::String(s) if s == "0" => Some(false),
        Value::String(s) if s == "1" => Some(true),
        _ => match value.as_u64() {
            Some(0) => Some(false),
            Some(1) => Some(true),
            _ => value.as_bool(),
        },
    }
}
fn time(value: &str) -> bool {
    let b = value.as_bytes();
    b.len() == 5
        && b[2] == b':'
        && [0, 1, 3, 4].iter().all(|&i| b[i].is_ascii_digit())
        && value[..2].parse::<u8>().is_ok_and(|h| h < 24)
        && value[3..].parse::<u8>().is_ok_and(|m| m < 60)
}
impl IndicatorValues {
    pub fn validate(&self) -> Result<()> {
        if (!self.open_time.is_empty() && !time(&self.open_time))
            || (!self.close_time.is_empty() && !time(&self.close_time))
            || self.timer_on
                && (!time(&self.open_time)
                    || !time(&self.close_time)
                    || self.open_time == self.close_time)
        {
            return Err(AppError::invalid("请设置有效且不同的开启、关闭时间。"));
        }
        Ok(())
    }
}
impl IndicatorChange {
    pub fn validate(&self) -> Result<()> {
        if self.baseline.len() != 64
            || !self.baseline.bytes().all(|c| {
                c.is_ascii_hexdigit() && (!c.is_ascii_alphabetic() || c.is_ascii_lowercase())
            })
        {
            return Err(AppError::invalid("指示灯设置版本无效，请重新打开页面。"));
        }
        self.values.validate()
    }
}
pub fn parse(device: &Device, raw: Value) -> Result<IndicatorReport> {
    let open_time = raw["timer_open"].as_str().unwrap_or("").to_owned();
    let close_time = raw["timer_close"].as_str().unwrap_or("").to_owned();
    if raw["timer_open"].as_str().is_none() && !raw["timer_open"].is_null()
        || raw["timer_close"].as_str().is_none() && !raw["timer_close"].is_null()
    {
        return Err(AppError::protocol());
    }
    let values = IndicatorValues {
        on: bit(&raw["status"]).ok_or_else(AppError::protocol)?,
        timer_on: bit(&raw["timer_status"]).ok_or_else(AppError::protocol)?,
        open_time,
        close_time,
    };
    values.validate().map_err(|_| AppError::protocol())?;
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&values).map_err(|_| AppError::protocol())?)
    );
    Ok(IndicatorReport {
        did: device.did.clone(),
        model: device.model.clone(),
        values,
        revision,
    })
}
pub async fn read(cloud: &Cloud, device: &Device) -> Result<IndicatorReport> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    parse(
        device,
        cloud
            .request_router_read(
                router::LED,
                json!({"method":"GET","params":{"deviceId":id}}),
            )
            .await?,
    )
}
pub(crate) fn payload(device: &Device, values: &IndicatorValues) -> Result<Value> {
    values.validate()?;
    let id = router::gateway_id(device)?;
    Ok(
        json!({"method":"POST","params":{"deviceId":id,"on":u8::from(values.on),"timer_on":u8::from(values.timer_on),"timer_open":values.open_time,"timer_close":values.close_time}}),
    )
}
pub async fn write(cloud: &Cloud, device: &Device, values: &IndicatorValues) -> Result<()> {
    cloud
        .request_router_led_write(payload(device, values)?)
        .await
        .map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d:Device=serde_json::from_value(json!({"did":"logical","model":router::MODEL,"online":true,"name":"fixture","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("private-route".into());
        d
    }
    fn report() -> IndicatorReport {
        parse(
            &device(),
            json!({"status":"1","timer_status":"0","timer_open":"00:00","timer_close":"00:00"}),
        )
        .unwrap()
    }
    #[test]
    fn actual_disabled_timer_times_are_preserved_and_not_replaced_with_defaults() {
        let r = report();
        assert!(r.values.on);
        assert!(!r.values.timer_on);
        assert_eq!(r.values.open_time, r.values.close_time);
        assert_eq!(r.revision.len(), 64);
        assert!(!serde_json::to_string(&r).unwrap().contains("private-route"));
    }
    #[test]
    fn missing_or_invalid_status_and_active_time_range_are_rejected() {
        for raw in [
            json!({"status":2,"timer_status":0}),
            json!({"status":true}),
            json!({"status":1,"timer_status":1,"timer_open":"00:00","timer_close":"00:00"}),
            json!({"status":1,"timer_status":0,"timer_open":"24:00"}),
            json!({"status":1,"timer_status":0,"timer_open":1200}),
        ] {
            assert!(parse(&device(), raw).is_err());
        }
    }
    #[test]
    fn write_has_exact_vendor_fields_and_keeps_device_id_out_of_user_changes() {
        let r = report();
        let p = payload(&device(), &r.values).unwrap();
        assert_eq!(
            p,
            json!({"method":"POST","params":{"deviceId":"private-route","on":1,"timer_on":0,"timer_open":"00:00","timer_close":"00:00"}})
        );
        assert!(serde_json::from_value::<IndicatorChange>(
            json!({"baseline":r.revision,"values":r.values,"deviceId":"caller-supplied"})
        )
        .is_err());
    }
    #[test]
    fn unconfirmed_command_never_allows_a_second_send_and_confirmation_never_sends() {
        let r = report();
        let mut values = r.values.clone();
        values.on = false;
        let change = IndicatorChange {
            baseline: r.revision.clone(),
            values,
        };
        assert_eq!(
            decision(&r, &change, None, false).unwrap(),
            SaveDecision::Send
        );
        assert_eq!(
            decision(&r, &change, Some(&change), false).unwrap(),
            SaveDecision::ConfirmPending
        );
        assert_eq!(
            decision(&r, &change, None, true).unwrap(),
            SaveDecision::ConfirmPending
        );
        let done = IndicatorReport {
            values: change.values.clone(),
            ..r.clone()
        };
        assert_eq!(
            decision(&done, &change, Some(&change), true).unwrap(),
            SaveDecision::Confirmed
        );
    }
    #[test]
    fn concurrent_settings_change_and_read_only_role_block_save() {
        let r = report();
        let mut values = r.values.clone();
        values.on = false;
        let change = IndicatorChange {
            baseline: "a".repeat(64),
            values,
        };
        assert_eq!(
            decision(&r, &change, None, false).unwrap_err().kind,
            "conflict"
        );
        let mut d = device();
        d.shared_read_only = true;
        assert_eq!(writable(&d).unwrap_err().kind, "permissionDenied");
        d.shared_read_only = false;
        d.online = false;
        assert_eq!(writable(&d).unwrap_err().kind, "offline");
    }
}
