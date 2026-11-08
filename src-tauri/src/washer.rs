//! Firmware-selected declarative washer metadata. No lifecycle/control writes.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
};
use serde::Serialize;
use serde_json::{json, Value};

pub const MODEL: &str = "midjd8.washer.42";
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WasherConfigReport {
    pub did: String,
    pub model: String,
    pub firmware: String,
    pub fetched_at: u64,
    pub config: Value,
}
pub fn supports_metadata(device: &Device) -> bool {
    let parts: Vec<_> = device.model.split('.').collect();
    parts.len() == 3
        && parts[1] == "washer"
        && parts
            .iter()
            .all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_'))
}
pub(crate) fn query(device: &Device) -> Result<Value> {
    if !supports_metadata(device)
        || device.split_route.is_some()
        || device.unsupported_reason.is_some()
    {
        return Err(AppError::new(
            "unsupported",
            "当前设备尚无已核实的洗衣程序配置。",
            false,
        ));
    }
    let firmware = device
        .firmware_version
        .as_deref()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 64
                && s.bytes()
                    .all(|b| b.is_ascii_digit() || b == b'.' || b == b'_')
        })
        .ok_or_else(|| {
            AppError::new(
                "washerConfig",
                "设备尚未提供有效固件版本，无法选择程序参数。",
                true,
            )
        })?;
    let version = firmware
        .rsplit('.')
        .next()
        .filter(|v| !v.is_empty())
        .ok_or_else(AppError::protocol)?;
    Ok(json!({"key":device.model,"version":version}))
}
fn identifier(value: &Value) -> bool {
    value.as_str().is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 96
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}
pub(crate) fn parse(device: &Device, response: Value) -> Result<WasherConfigReport> {
    query(device)?;
    let config = response
        .get("config")
        .filter(|v| v.is_object())
        .ok_or_else(AppError::protocol)?;
    if serde_json::to_vec(config)
        .map_err(|_| AppError::protocol())?
        .len()
        > 1024 * 1024
    {
        return Err(AppError::protocol());
    }
    if config
        .get("modesData1")
        .is_some_and(|v| v.as_array().is_some_and(|a| !a.is_empty()))
    {
        return Err(AppError::new(
            "unsupported",
            "此多筒型号的分筒程序约束尚未接入。",
            false,
        ));
    }
    let modes = config["modesData"]
        .as_array()
        .filter(|m| !m.is_empty() && m.len() <= 128)
        .ok_or_else(AppError::protocol)?;
    let mut names = std::collections::HashSet::new();
    for mode in modes {
        if !identifier(&mode["modeName"])
            || !names.insert(mode["modeName"].as_str().unwrap())
            || mode["items"].as_array().is_none_or(|items| {
                items.len() > 64 || items.iter().any(|p| !identifier(&p["propertyName"]))
            })
            || mode.get("modeTime").is_some_and(|v| {
                v.as_f64()
                    .is_none_or(|n| !n.is_finite() || !(0.0..=2880.0).contains(&n))
            })
        {
            return Err(AppError::protocol());
        }
    }
    for key in ["itemsConfig", "conditionsConfig", "modesConfig"] {
        if config
            .get(key)
            .is_some_and(|v| v.as_object().is_none_or(|o| o.len() > 256))
        {
            return Err(AppError::protocol());
        }
    }
    Ok(WasherConfigReport {
        did: device.did.clone(),
        model: device.model.clone(),
        firmware: device.firmware_version.clone().unwrap(),
        fetched_at: epoch_secs(),
        config: config.clone(),
    })
}
pub async fn load(cloud: &Cloud, device: &Device) -> Result<WasherConfigReport> {
    let response = cloud.request_washer_config(device, query(device)?).await?;
    parse(device, response)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d:Device=serde_json::from_value(json!({"did":"fixture-washer","model":MODEL,"name":"washer","online":true,"roomId":"r","roomName":"room"})).unwrap();
        d.firmware_version = Some("2.2.5".into());
        d
    }
    fn response() -> Value {
        json!({"config":{"modesData":[{"modeName":"smart","modeTime":185,"items":[{"propertyName":"temperature","data":[0,40,60],"defaultValue":40}]}],"itemsConfig":{},"conditionsConfig":{},"modesConfig":{}}})
    }
    #[test]
    fn query_uses_authenticated_firmware_suffix_and_never_accepts_a_frontend_url() {
        let mut d = device();
        assert_eq!(query(&d).unwrap(), json!({"key":MODEL,"version":"5"}));
        d.firmware_version = Some("2.0.6_0004".into());
        assert_eq!(query(&d).unwrap()["version"], "6_0004");
        for version in [
            None,
            Some(""),
            Some("2.2."),
            Some("https://wrong"),
            Some("5\n"),
        ] {
            d.firmware_version = version.map(str::to_owned);
            assert!(query(&d).is_err());
        }
        d = device();
        d.model = "other.washer".into();
        assert!(query(&d).is_err());
    }
    #[test]
    fn metadata_preserves_config_and_rejects_malformed_or_oversized_lists() {
        let d = device();
        let original = response();
        let report = parse(&d, original.clone()).unwrap();
        assert_eq!(report.config, original["config"]);
        assert_eq!(report.did, d.did);
        assert_eq!(report.firmware, "2.2.5");
        for bad in [
            json!({}),
            json!({"config":{"modesData":[]}}),
            json!({"config":{"modesData":[{"modeName":"smart","items":"wrong"}]}}),
        ] {
            assert!(parse(&d, bad).is_err());
        }
        let mut bad = response();
        bad["config"]["modesData"][0]["items"][0]["propertyName"] = json!("../script");
        assert!(parse(&d, bad).is_err());
        let mut bad = response();
        let duplicate = bad["config"]["modesData"][0].clone();
        bad["config"]["modesData"]
            .as_array_mut()
            .unwrap()
            .push(duplicate);
        assert!(parse(&d, bad).is_err());
        let mut bad = response();
        bad["config"]["unused"] = json!("x".repeat(1024 * 1024));
        assert!(parse(&d, bad).is_err());
    }
    #[test]
    fn captured_firmware_config_contains_26_programs_and_preserves_dependent_options() {
        let config: Value =
            serde_json::from_str(include_str!("fixtures/washer-config.json")).unwrap();
        let report = parse(&device(), json!({"config":config})).unwrap();
        assert_eq!(report.config["modesData"].as_array().unwrap().len(), 26);
        assert_eq!(report.config["modesData"][0]["modeName"], "smart");
        assert_eq!(
            report.config["modesData"][0]["items"][1]["defaultValue"],
            40.0
        );
        assert_eq!(
            report.config["conditionsConfig"]["night"]["data"],
            json!([0.0, 400.0, 600.0])
        );
        assert_eq!(
            report.config["modesData"][0]["items"][3]["conditions"],
            json!(["night", "speed1000-13"])
        );
    }
}
