//! Daily tools, based on router plugin 12137, 10640 and API 10151.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::Serialize;
use serde_json::{json, Value};
pub const INFO: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_wifi_eno_info";
pub const START: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/start_wifi_eno";
pub const APPLY: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_wifi_eno_info";
pub const PLUGINS: &str = "/appgateway/third/miwifi/app/s/plugin/v3/install/list";
pub const SCAN_INFO: &str = "/appgateway/third/miwifi/app/r/api/misystem/channel_scan_result";
pub const SCAN_START: &str = "/appgateway/third/miwifi/app/r/api/misystem/channel_scan_start";
pub const SCAN_APPLY: &str = "/appgateway/third/miwifi/app/r/api/misystem/set_channel";
fn ranking(raw: &Value) -> Option<u64> {
    raw.as_u64()
        .or_else(|| raw.as_str()?.parse().ok())
        .filter(|n| *n <= 65535)
}
fn scan_ready(raw: &Value) -> bool {
    ranking(&raw["2G"]["ranking"]).is_some()
        && (!raw["5G"].is_object() || ranking(&raw["5G"]["ranking"]).is_some())
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub supported: bool,
    pub channels: Vec<bool>,
    pub radar: bool,
    pub clients: usize,
    pub recommended: bool,
    pub revision: String,
    pub reason: Option<String>,
    pub scene_installed: bool,
    pub kind: String,
    pub ready: bool,
    pub suggested_channels: Vec<Option<u16>>,
    pub optimization_pending: bool,
    pub configuration_verified: bool,
}
#[derive(Clone)]
pub(crate) struct Pending {
    pub baseline: String,
    pub channels: Vec<Option<u16>>,
    pub modern: bool,
}
pub(crate) fn channel_matches(raw: &Value, channels: &[Option<u16>]) -> bool {
    channels.first().is_some_and(Option::is_some)
        && channels.iter().enumerate().all(|(i, wanted)| {
            wanted.is_none_or(|n| {
                raw["info"][i]["channel"]
                    .as_u64()
                    .or_else(|| raw["info"][i]["channel"].as_str()?.parse().ok())
                    == Some(u64::from(n))
            })
        })
}
pub(crate) async fn verify(cloud: &Cloud, device: &Device, p: &Pending) -> Result<bool> {
    if p.modern {
        return Ok(false);
    }
    let raw = cloud
        .request_router_read(
            router::WIFI,
            json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?}}),
        )
        .await?;
    Ok(channel_matches(&raw, &p.channels))
}
fn bit(v: &Value) -> Result<bool> {
    match v {
        Value::Null => Ok(false),
        Value::Bool(b) => Ok(*b),
        _ if v == 0 || v == "0" => Ok(false),
        _ if v == 1 || v == "1" => Ok(true),
        _ => Err(AppError::protocol()),
    }
}
pub fn decode(device: &Device, init: &Value, raw: &Value, plugins: &Value) -> Result<Report> {
    crate::router_family::success(raw)?;
    let channels = ["ch_2g", "ch_5g", "ch_5gh", "ch_6g"]
        .iter()
        .map(|k| bit(&raw[k]))
        .collect::<Result<Vec<_>>>()?;
    let radar = bit(&raw["ch_radar"])?;
    let clients = raw["sta_info"].as_array().map_or(0, Vec::len);
    if clients > 4096 {
        return Err(AppError::protocol());
    }
    let supported =
        init["features"]["wifi"]["wifi_eno"] == "1" || init["features"]["wifi"]["wifi_eno"] == 1;
    let reason = if device.shared_read_only {
        Some("此共享设备只有读取权限。".into())
    } else {
        None
    };
    let revision = format!(
        "{:x}",
        <sha2::Sha256 as sha2::Digest>::digest(
            serde_json::to_vec(raw).map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: device.did.clone(),
        model: device.model.clone(),
        supported,
        radar,
        clients,
        recommended: radar || clients > 0 || channels.iter().any(|v| *v),
        channels,
        revision,
        reason,
        scene_installed: plugins["data"]["list"]
            .as_array()
            .is_some_and(|a| a.iter().any(|p| p["appId"] == "2882303761520383774")),
        kind: "network".into(),
        ready: true,
        suggested_channels: vec![],
        optimization_pending: false,
        configuration_verified: false,
    })
}
pub async fn read(cloud: &Cloud, device: &Device) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let req = |path| {
        cloud.request_router_read(path,json!({"method":if path==router::INIT{"POST"}else{"GET"},"params":{"deviceId":id,"language":"zh"}}))
    };
    let (init, plugins) = tokio::try_join!(req(router::INIT), req(PLUGINS))?;
    crate::router_family::success(&init)?;
    crate::router_family::success(&plugins)?;
    let modern =
        init["features"]["wifi"]["wifi_eno"] == "1" || init["features"]["wifi"]["wifi_eno"] == 1;
    if modern {
        return decode(device, &init, &req(INFO).await?, &plugins);
    }
    let mut report = decode(device, &init, &json!({"code":0}), &plugins)?;
    report.kind = "channel".into();
    report.supported = true;
    report.ready = false;
    match req(SCAN_INFO).await {
        Ok(raw) => {
            report.ready = scan_ready(&raw);
            report.channels = ["2G", "5G"]
                .iter()
                .map(|k| ranking(&raw[k]["ranking"]).is_some_and(|n| n > 3))
                .collect();
            report.recommended = report.channels.iter().any(|v| *v);
            report.suggested_channels = ["2G", "5G"]
                .iter()
                .map(|k| {
                    raw[k]["schannel"]
                        .as_u64()
                        .and_then(|n| u16::try_from(n).ok())
                        .filter(|n| *n > 0 && *n <= 233)
                })
                .collect();
            report.revision = format!(
                "{:x}",
                <sha2::Sha256 as sha2::Digest>::digest(
                    serde_json::to_vec(&raw).map_err(|_| AppError::protocol())?
                )
            );
        }
        Err(e) if e.kind == "authExpired" => return Err(e),
        Err(e) => report.reason = Some(e.message),
    }
    Ok(report)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn missing_or_invalid_rankings_never_look_like_a_good_wifi_environment() {
        assert!(scan_ready(
            &json!({"2G":{"ranking":2},"5G":{"ranking":"3"}})
        ));
        for raw in [
            json!({"2G":{}}),
            json!({"2G":{"ranking":2},"5G":{}}),
            json!({"2G":{"ranking":-1}}),
        ] {
            assert!(!scan_ready(&raw));
        }
    }
    #[test]
    fn actual_flags_and_scene_plugin_are_not_speed_measurements() {
        let d:Device=serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"fixture","roomId":"r","roomName":"r"})).unwrap();
        let r = decode(
            &d,
            &json!({"features":{"wifi":{"wifi_eno":"1"}}}),
            &json!({"code":0,"ch_2g":1,"ch_5g":0,"sta_info":[]}),
            &json!({"data":{"list":[{"appId":"2882303761520383774"}]}}),
        )
        .unwrap();
        assert!(r.supported && r.recommended && r.scene_installed);
        assert!(decode(&d, &json!({}), &json!({"code":0,"ch_2g":3}), &json!({})).is_err());
        assert!(!router::is_read_path(START));
        assert!(!router::is_read_path(APPLY));
    }
    #[test]
    fn optimization_confirmation_requires_every_requested_actual_channel() {
        assert!(channel_matches(
            &json!({"info":[{"channel":"6"},{"channel":44}]}),
            &[Some(6), Some(44)]
        ));
        assert!(!channel_matches(
            &json!({"info":[{"channel":0},{"channel":44}]}),
            &[Some(6), Some(44)]
        ));
        assert!(!channel_matches(&json!({"code":0}), &[Some(6), Some(44)]));
        assert!(!channel_matches(&json!({"info":[]}), &[]));
    }
}
