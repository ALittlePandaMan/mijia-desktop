//! Read-only network status for the verified router model.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
};
use serde::Serialize;
use serde_json::{json, Value};
pub const MODEL: &str = "xiaomi.router.rn02";
pub const INIT: &str = "/appgateway/third/miwifi/app/r/api/xqsystem/init_info";
pub const CLIENTS: &str = "/appgateway/third/miwifi/app/s/api/device_list";
pub const ROUTERS: &str = "/appgateway/third/miwifi/app/s/admin/deviceList";
pub(crate) fn is_read_path(path: &str) -> bool {
    [INIT, CLIENTS, ROUTERS].contains(&path)
}
pub(crate) fn is_gateway_path(path: &str) -> bool {
    is_read_path(path)
}
pub fn gateway_id(device: &Device) -> Result<&str> {
    if device.model != MODEL || device.split_route.is_some() {
        return Err(AppError::new(
            "unsupported",
            "此型号尚未核实路由器专用接口。",
            false,
        ));
    }
    let id = device
        .did
        .strip_prefix("miwifi.")
        .or(device.partner_id.as_deref())
        .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control));
    id.ok_or_else(|| AppError::new("unsupported", "设备未提供路由器的真实网关标识。", false))
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RouterReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub network: String,
    pub upload_bps: Option<u64>,
    pub download_bps: Option<u64>,
    pub wifi7: Option<bool>,
    pub warnings: Vec<String>,
}
fn integer(v: &Value) -> Option<u64> {
    v.as_u64().filter(|v| *v <= 9_007_199_254_740_991)
}
fn binary(v: &Value) -> Option<bool> {
    v.as_bool().or_else(|| match v.as_u64() {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => None,
    })
}
fn success(value: &Value) -> Result<()> {
    let code = value["code"]
        .as_i64()
        .or_else(|| value["code"].as_str()?.parse().ok())
        .ok_or_else(AppError::protocol)?;
    if code == 0 {
        Ok(())
    } else {
        Err(AppError::new(
            "routerGateway",
            format!("路由器读取失败（代码 {code}）。"),
            false,
        ))
    }
}
fn accept(result: Result<Value>, label: &str, warnings: &mut Vec<String>) -> Result<Option<Value>> {
    match result.and_then(|value| {
        success(&value)?;
        Ok(value)
    }) {
        Ok(value) => Ok(Some(value)),
        Err(e) if e.kind == "authExpired" => Err(e),
        Err(e) => {
            warnings.push(format!("{label}暂不可用：{}", e.message));
            Ok(None)
        }
    }
}

pub async fn load(cloud: &Cloud, device: &Device) -> Result<RouterReport> {
    let id = gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (init,routers,traffic)=tokio::join!(
  cloud.request_router_read(INIT,json!({"method":"POST","params":{"deviceId":id}})),
  cloud.request_router_read(ROUTERS,json!({"method":"GET","params":{"deviceId":id}})),
  cloud.request_router_read(CLIENTS,json!({"method":"GET","params":{"deviceId":id,"routerID":id,"locale":"zh_CN","v":"2","refresh":"1"}}))
 );
    // This status endpoint supplies WAN totals. Per-client details are neither
    // decoded nor returned to the UI, and no Wi-Fi/password/tool requests run.
    decode(device, id, init, routers, traffic)
}
fn decode(
    device: &Device,
    id: &str,
    init: Result<Value>,
    routers: Result<Value>,
    traffic: Result<Value>,
) -> Result<RouterReport> {
    let mut warnings = vec![];
    let init = accept(init, "网络状态", &mut warnings)?.filter(|v| {
        let matches = v["routerId"].as_str() == Some(id);
        if !matches {
            warnings.push("网络状态的路由器标识不匹配，已忽略。".into());
        }
        matches
    });
    let routers = accept(routers, "路由器信息", &mut warnings)?;
    let router = routers
        .as_ref()
        .and_then(|v| v["deviceList"].as_array())
        .and_then(|v| v.iter().find(|r| r["id"].as_str() == Some(id)));
    let traffic = accept(traffic, "网络速度", &mut warnings)?;
    Ok(RouterReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        network: if init.is_some() { "ok" } else { "unknown" }.into(),
        upload_bps: traffic.as_ref().and_then(|v| integer(&v["wanTX"])),
        download_bps: traffic.as_ref().and_then(|v| integer(&v["wanRX"])),
        wifi7: router.and_then(|v| binary(&v["capabilities"]["Wi-Fi_7"])),
        warnings,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"miwifi.fixture","model":MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap()
    }
    fn init() -> Result<Value> {
        Ok(json!({"code":0,"routerId":"fixture"}))
    }
    fn routers() -> Result<Value> {
        Ok(json!({"code":0,"deviceList":[{"id":"fixture","capabilities":{"Wi-Fi_7":1}}]}))
    }
    #[test]
    fn reports_network_and_aggregate_rates_without_client_or_password_data() {
        let report=decode(&device(),"fixture",init(),routers(),Ok(json!({"code":0,"wanTX":0,"wanRX":2510000,"devices":[{"mac":"AA:BB:CC:DD:EE:FF","password":"private"}]}))).unwrap();
        assert_eq!(report.network, "ok");
        assert_eq!(report.upload_bps, Some(0));
        assert_eq!(report.download_bps, Some(2510000));
        assert_eq!(report.wifi7, Some(true));
        let value = serde_json::to_value(report).unwrap();
        assert!(value.get("clients").is_none());
        assert!(value.get("filteredClients").is_none());
        assert!(!value.to_string().contains("private"));
    }
    #[test]
    fn unavailable_or_wrong_identity_never_looks_like_a_healthy_connection() {
        let r = decode(
            &device(),
            "fixture",
            Ok(json!({"code":0,"routerId":"other"})),
            routers(),
            Ok(json!({"code":0})),
        )
        .unwrap();
        assert_eq!(r.network, "unknown");
        assert_eq!(r.download_bps, None);
        assert!(!r.warnings.is_empty());
        let r = decode(
            &device(),
            "fixture",
            init(),
            routers(),
            Err(AppError::new("network", "offline", true)),
        )
        .unwrap();
        assert_eq!(r.network, "ok");
        assert_eq!(r.upload_bps, None);
        assert_eq!(r.download_bps, None);
    }
    #[test]
    fn expired_authentication_and_invalid_rates_are_not_hidden() {
        assert!(decode(
            &device(),
            "fixture",
            Err(AppError::auth()),
            routers(),
            Ok(json!({"code":0}))
        )
        .is_err());
        let r = decode(
            &device(),
            "fixture",
            init(),
            routers(),
            Ok(json!({"code":0,"wanTX":-1,"wanRX":"unknown"})),
        )
        .unwrap();
        assert_eq!(r.upload_bps, None);
        assert_eq!(r.download_bps, None);
    }
    #[test]
    fn only_the_three_status_read_paths_are_allowed() {
        for path in [INIT, CLIENTS, ROUTERS] {
            assert!(is_read_path(path));
        }
        for path in [
            "/appgateway/third/miwifi/app/r/api/xqnetwork/wifi_detail_all",
            "/appgateway/third/miwifi/app/r/api/xqnetwork/start_wifi_eno",
            "/appgateway/third/miwifi/app/s/api/set_device_nickname",
            "/appgateway/third/miwifi/app/r/api/misystem/set_channel",
        ] {
            assert!(!is_gateway_path(path));
        }
    }
    #[test]
    fn authenticated_gateway_identity_is_required() {
        assert_eq!(gateway_id(&device()).unwrap(), "fixture");
        let mut d = device();
        d.did = "unknown".into();
        assert!(gateway_id(&d).is_err());
        d.partner_id = Some("private-gateway".into());
        assert_eq!(gateway_id(&d).unwrap(), "private-gateway");
        assert!(!serde_json::to_string(&d)
            .unwrap()
            .contains("private-gateway"));
    }

}
