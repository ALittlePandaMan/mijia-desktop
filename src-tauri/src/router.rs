//! Exact RN router v4 read paths: API 10151, HomePage 10571, helpers 10148/10157.
use crate::{cloud::Cloud, models::epoch_secs};
use crate::{
    error::{AppError, Result},
    models::Device,
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::HashSet;
pub const MODEL: &str = "xiaomi.router.rn02";
pub const INIT: &str = "/appgateway/third/miwifi/app/r/api/xqsystem/init_info";
pub const CLIENTS: &str = "/appgateway/third/miwifi/app/s/api/device_list";
pub const ROUTERS: &str = "/appgateway/third/miwifi/app/s/admin/deviceList";
pub const FILTER: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/wifi_macfilter_info";
pub const LED: &str = "/appgateway/third/miwifi/app/r/api/misystem/led";
pub const WIFI: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/wifi_detail_all";
pub const WIFI_SAVE: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_all_wifi";
pub const CLIENT_RENAME: &str = "/appgateway/third/miwifi/app/s/api/set_device_nickname";
pub const CLIENT_DISPLAY_CONFIG: &str = "/appgateway/third/miwifi/app/s/api/device_display_config";
pub const CLIENT_CLASSIFY: &str = "/appgateway/third/miwifi/app/s/api/update_device_setting";
pub(crate) fn is_read_path(path: &str) -> bool {
    [
        crate::router_daily::SCAN_INFO,
        crate::router_daily::INFO,
        crate::router_daily::PLUGINS,
        INIT,
        CLIENTS,
        ROUTERS,
        FILTER,
        LED,
        WIFI,
        CLIENT_DISPLAY_CONFIG,
    ]
    .contains(&path)
        || crate::router_advanced::is_read_path(path)
        || crate::router_internet::is_read_path(path)
        || crate::router_network::is_read_path(path)
        || crate::router_qos::is_read_path(path)
        || crate::router_url::is_read_path(path)
        || crate::router_family::is_read_path(path)
        || crate::router_access::is_read_path(path)
        || path == crate::router_whitelist::TOKEN
        || path == crate::router_block_records::PATH
}
pub(crate) fn is_gateway_path(path: &str) -> bool {
    is_read_path(path)
        || path == crate::router_scene::PATH
        || [
            crate::router_daily::START,
            crate::router_daily::APPLY,
            crate::router_daily::SCAN_START,
            crate::router_daily::SCAN_APPLY,
        ]
        .contains(&path)
        || path == WIFI_SAVE
        || path == CLIENT_RENAME
        || path == CLIENT_CLASSIFY
        || crate::router_advanced::is_write_path(path)
        || crate::router_network::is_write_path(path)
        || crate::router_qos::is_write_path(path)
        || crate::router_url::is_write_path(path)
        || path == crate::router_family::SET
        || crate::router_access::is_write_path(path)
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
pub struct RouterClient {
    pub mac: String,
    pub name: String,
    pub ip: Option<String>,
    pub icon: Option<String>,
    pub online: Option<bool>,
    pub connection: Option<u8>,
    pub download_bps: Option<u64>,
    pub upload_bps: Option<u64>,
    pub event_time: Option<u64>,
    pub blocked: bool,
    pub signal: Option<i16>,
    pub wifi_protocol: Option<String>,
    pub port: Option<String>,
    pub port_speed: Option<String>,
    pub tx_rate: Option<String>,
    pub rx_rate: Option<String>,
    pub classification: Option<crate::router_classification::Selection>,
    pub user_specified: bool,
    pub miot_classification: Option<crate::router_classification::Selection>,
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
    pub clients: Option<Vec<RouterClient>>,
    pub filter_mode: Option<String>,
    pub filtered_clients: Option<Vec<RouterClient>>,
    pub wifi7: Option<bool>,
    pub mesh: Option<bool>,
    pub firmware: Option<String>,
    pub indicator_timer_supported: Option<bool>,
    pub warnings: Vec<String>,
}
fn text(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|s| !s.trim().is_empty() && s.len() <= 512 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn binary(v: &Value) -> Option<bool> {
    v.as_bool().or_else(|| match v.as_u64() {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => None,
    })
}
fn integer(v: &Value) -> Option<u64> {
    v.as_u64()
}
fn client_icon(row: &Value) -> Option<String> {
    let source = text(&row["neg480"]).or_else(|| {
        text(&row["iconUrl"])
            .filter(|s| !s.contains("://") && !s.starts_with('/') && !s.contains(".."))
            .map(|s| format!("https://s.miwifi.com/icon/{s}"))
    })?;
    let url = url::Url::parse(&source).ok()?;
    (url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|h| {
            h == "s.miwifi.com"
                || h == "api.mi-img.com"
                || h.ends_with(".mi-img.com")
                || h.ends_with(".fds.api.xiaomi.com")
        }))
    .then_some(source)
}
fn client(row: &Value) -> Option<RouterClient> {
    let mac = text(&row["mac"])?;
    if mac.len() > 64 {
        return None;
    }
    Some(RouterClient {
        name: text(&row["name"])
            .or_else(|| text(&row["originName"]))
            .unwrap_or_else(|| mac.clone()),
        mac,
        ip: text(&row["ip"]),
        icon: client_icon(row),
        online: binary(&row["online"]),
        connection: row["connectionType"]
            .as_u64()
            .and_then(|n| u8::try_from(n).ok()),
        download_bps: integer(&row["dSpeed"]),
        upload_bps: integer(&row["uSpeed"]),
        event_time: row["events"]
            .as_array()
            .and_then(|a| a.first())
            .filter(|e| e["timeDisplay"] == 1)
            .and_then(|e| integer(&e["originatedTime"]))
            .filter(|t| *t > 0),
        blocked: row.get("isBlackList").is_some_and(|v| !v.is_null()),
        // An absent/zero sentinel is not an actual signal reading. Never turn it
        // into the vendor helper's default "strong" result.
        signal: row["signal"]
            .as_i64()
            .filter(|n| (-127..0).contains(n))
            .and_then(|n| i16::try_from(n).ok()),
        wifi_protocol: text(&row["wifiprotocol"]),
        port: text(&row["port"]),
        port_speed: text(&row["portspeed"]),
        tx_rate: text(&row["nego_tx_rate"]),
        rx_rate: text(&row["nego_rx_rate"]),
        classification: crate::router_classification::selection(row),
        user_specified: row["userSpecified"] == true,
        miot_classification: crate::router_classification::miot_selection(row),
    })
}
fn clients(value: &Value) -> Result<Vec<RouterClient>> {
    let rows = value
        .as_array()
        .filter(|a| a.len() <= 4096)
        .ok_or_else(AppError::protocol)?;
    let mut seen = HashSet::new();
    rows.iter()
        .map(|row| {
            // MacFilterModel accepts bare MAC strings as well as objects.
            let normalized;
            let row = if let Some(mac) = row.as_str() {
                if !crate::router_client_name::valid_mac(mac) {
                    return Err(AppError::protocol());
                }
                normalized = json!({"mac":mac});
                &normalized
            } else {
                row
            };
            let item = client(row).ok_or_else(AppError::protocol)?;
            if !seen.insert(item.mac.to_ascii_lowercase()) {
                return Err(AppError::protocol());
            }
            Ok(item)
        })
        .collect()
}
pub(crate) async fn read_clients(cloud: &Cloud, device: &Device) -> Result<Vec<RouterClient>> {
    let id = gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let raw=cloud.request_router_read(CLIENTS,json!({"method":"GET","params":{"deviceId":id,"routerID":id,"locale":"zh_CN","v":"2","refresh":"1"}})).await?;
    success(&raw)?;
    clients(&raw["devices"])
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
    let (init, routers, list) = tokio::join!(
        cloud.request_router_read(INIT, json!({"method":"POST","params":{"deviceId":id}})),
        cloud.request_router_read(ROUTERS, json!({"method":"GET","params":{"deviceId":id}})),
        cloud.request_router_read(CLIENTS, json!({"method":"GET","params":{"deviceId":id,"routerID":id,"locale":"zh_CN","v":"2","refresh":"1"}}))
    );
    // Access control is outside the daily desktop surface; never fetch its list.
    decode(device, id, init, routers, list, Ok(json!({"code":0})))
}
fn decode(
    device: &Device,
    id: &str,
    init: Result<Value>,
    routers: Result<Value>,
    list: Result<Value>,
    filter: Result<Value>,
) -> Result<RouterReport> {
    let mut warnings = vec![];
    let init = accept(init, "网络状态", &mut warnings)?.filter(|value| {
        let matches = value["routerId"].as_str() == Some(id);
        if !matches {
            warnings.push("网络状态的路由器标识不匹配，已忽略。".into())
        }
        matches
    });
    let routers = accept(routers, "路由器信息", &mut warnings)?;
    let router = routers
        .as_ref()
        .and_then(|v| v["deviceList"].as_array())
        .and_then(|a| a.iter().find(|r| r["id"].as_str() == Some(id)));
    let list = accept(list, "设备列表", &mut warnings)?;
    let client_list = list.as_ref().and_then(|v| match clients(&v["devices"]) {
        Ok(list) => Some(list),
        Err(_) => {
            warnings.push("设备列表格式不完整，未显示可能错误的设备数量。".into());
            None
        }
    });
    let filter = accept(filter, "访问控制名单", &mut warnings)?;
    let filter_mode = filter.as_ref().and_then(|v| match v["model"].as_u64() {
        Some(0) => Some("black".into()),
        Some(1) => Some("white".into()),
        _ => None,
    });
    let filtered_clients = filter
        .as_ref()
        .filter(|_| filter_mode.is_some())
        .and_then(|v| match clients(&v["macfilter"]) {
            Ok(mut items) => {
                for item in &mut items {
                    if let Some(known) = client_list.as_ref().and_then(|list| {
                        list.iter().find(|c| c.mac.eq_ignore_ascii_case(&item.mac))
                    }) {
                        *item = known.clone();
                    }
                }
                Some(items)
            }
            Err(_) => {
                warnings.push("访问控制名单格式不完整，未显示名单数量。".into());
                None
            }
        });
    Ok(RouterReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        network: if init.is_some() { "ok" } else { "unknown" }.into(),
        upload_bps: list.as_ref().and_then(|v| integer(&v["wanTX"])),
        download_bps: list.as_ref().and_then(|v| integer(&v["wanRX"])),
        clients: client_list,
        filter_mode,
        filtered_clients,
        wifi7: router.and_then(|r| binary(&r["capabilities"]["Wi-Fi_7"])),
        mesh: init.as_ref().and_then(|v| binary(&v["isSupportMesh"])),
        firmware: init.as_ref().and_then(|v| text(&v["romversion"])),
        indicator_timer_supported: router
            .and_then(|r| binary(&r["capabilities"]["led_time_control"])),
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d:Device=serde_json::from_value(json!({"did":"logical","model":MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("gateway-fixture".into());
        d
    }
    fn row(mac: &str, online: Value) -> Value {
        json!({"mac":mac,"name":"Fixture client","online":online,"connectionType":1,"dSpeed":0,"uSpeed":1000,"events":[{"timeDisplay":1,"originatedTime":1700000000}]})
    }
    #[test]
    fn authenticated_partner_id_is_private_and_split_is_rejected() {
        let mut d = device();
        assert_eq!(gateway_id(&d).unwrap(), "gateway-fixture");
        assert!(!serde_json::to_string(&d)
            .unwrap()
            .contains("gateway-fixture"));
        d.did = "miwifi.explicit".into();
        assert_eq!(gateway_id(&d).unwrap(), "explicit");
        d.did = "numeric".into();
        d.partner_id = None;
        assert!(gateway_id(&d).is_err());
        d.partner_id = Some("again".into());
        d.split_route = Some(crate::models::SplitRoute {
            parent_did: "physical".into(),
            service_iid: 2,
        });
        assert!(gateway_id(&d).is_err());
    }
    #[test]
    fn actual_raw_gateway_shape_maps_lists_and_known_zero_readings() {
        let d = device();
        let report=decode(&d,"gateway-fixture",Ok(json!({"code":0,"routerId":"gateway-fixture","isSupportMesh":1,"romversion":"1.0.64"})),Ok(json!({"code":"0","deviceList":[{"id":"gateway-fixture","capabilities":{"Wi-Fi_7":1,"led_time_control":1}}]})),Ok(json!({"code":0,"wanTX":0,"wanRX":1918,"devices":[row("aa:bb:cc:00:00:01",json!(1)),row("aa:bb:cc:00:00:02",json!(0))]})),Ok(json!({"code":0,"model":0,"macfilter":[]}))).unwrap();
        assert_eq!(report.network, "ok");
        assert_eq!(report.upload_bps, Some(0));
        assert_eq!(report.download_bps, Some(1918));
        assert_eq!(report.clients.as_ref().unwrap().len(), 2);
        assert_eq!(report.filtered_clients.as_ref().unwrap().len(), 0);
        assert_eq!(report.wifi7, Some(true));
        assert_eq!(report.indicator_timer_supported, Some(true));
        assert!(report.warnings.is_empty());
    }
    #[test]
    fn mismatched_identity_and_failed_reads_do_not_become_normal_network_or_empty_lists() {
        let report = decode(
            &device(),
            "gateway-fixture",
            Ok(json!({"code":0,"routerId":"different"})),
            Ok(json!({"code":0,"deviceList":[{"id":"different","capabilities":{"Wi-Fi_7":1}}]})),
            Err(AppError::protocol()),
            Err(AppError::protocol()),
        )
        .unwrap();
        assert_eq!(report.network, "unknown");
        assert!(report.clients.is_none());
        assert!(report.filtered_clients.is_none());
        assert!(report.upload_bps.is_none());
        assert_eq!(report.wifi7, None);
        assert_eq!(report.warnings.len(), 3);
    }
    #[test]
    fn duplicate_or_malformed_client_records_are_not_silently_counted() {
        assert!(clients(&json!([
            row("AA:BB:CC:DD:EE:FF", json!(1)),
            row("aa:bb:cc:dd:ee:ff", json!(0))
        ]))
        .is_err());
        assert!(clients(&json!([{"name":"No identity"}])).is_err());
        let c = client(&row("one", json!(2))).unwrap();
        assert_eq!(c.online, None);
        assert_eq!(c.download_bps, Some(0));
    }
    #[test]
    fn client_quality_uses_actual_fields_and_rejects_invalid_signal_and_text() {
        let value = json!({"mac":"AA:BB:CC:DD:EE:FF","signal":-71,"wifiprotocol":"Wi-Fi 6","port":"LAN1","portspeed":"1000 Mbps","nego_tx_rate":"1200 Mbps","nego_rx_rate":"600 Mbps"});
        let c = client(&value).unwrap();
        assert_eq!(c.signal, Some(-71));
        assert_eq!(c.wifi_protocol.as_deref(), Some("Wi-Fi 6"));
        assert_eq!(c.port.as_deref(), Some("LAN1"));
        assert_eq!(c.port_speed.as_deref(), Some("1000 Mbps"));
        assert_eq!(c.tx_rate.as_deref(), Some("1200 Mbps"));
        assert_eq!(c.rx_rate.as_deref(), Some("600 Mbps"));
        let invalid =
            client(&json!({"mac":"x","signal":0,"wifiprotocol":"\n","port":1,"portspeed":""}))
                .unwrap();
        assert_eq!(invalid.signal, None);
        assert_eq!(invalid.wifi_protocol, None);
        assert_eq!(invalid.port, None);
        assert_eq!(invalid.port_speed, None);
    }
    #[test]
    fn vendor_icon_sources_cannot_load_local_or_arbitrary_content() {
        assert!(client_icon(&json!({"neg480":"file:///secret"})).is_none());
        assert!(client_icon(&json!({"iconUrl":"../private"})).is_none());
        assert!(client_icon(&json!({"neg480":"https://unknown.example/image"})).is_none());
        assert_eq!(
            client_icon(&json!({"iconUrl":"device.png"})).unwrap(),
            "https://s.miwifi.com/icon/device.png"
        );
    }
    #[test]
    fn filter_members_accept_plain_addresses_without_inventing_live_metadata() {
        let rows = clients(&json!(["AA:BB:CC:00:00:01"])).unwrap();
        assert_eq!(rows[0].name, "AA:BB:CC:00:00:01");
        assert_eq!(rows[0].online, None);
        assert_eq!(rows[0].connection, None);
        assert!(clients(&json!(["invalid"])).is_err());
        assert!(clients(&json!(["AA:BB:CC:00:00:01", "aa:bb:cc:00:00:01"])).is_err());
    }
    #[test]
    fn expired_account_propagates_instead_of_creating_a_successful_partial_report() {
        assert_eq!(
            decode(
                &device(),
                "gateway-fixture",
                Err(AppError::auth()),
                Ok(json!({"code":0})),
                Ok(json!({"code":0})),
                Ok(json!({"code":0}))
            )
            .unwrap_err()
            .kind,
            "authExpired"
        );
        assert!(!is_read_path(
            "/appgateway/third/miwifi/app/r/api/misystem/reboot"
        ));
    }
}
