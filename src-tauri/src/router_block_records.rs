//! rn02 v4 modules 11372/11375: last 50 risk records; no mutation or paging.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
    router,
};
use serde::Serialize;
use serde_json::{json, Value};

pub const PATH: &str = "/appgateway/third/miwifi/app/s/risk_device_log";
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub event_id: u32,
    pub name: Option<String>,
    pub mac: Option<String>,
    pub count: u64,
    pub timestamp: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub items: Vec<Record>,
}
pub(crate) fn supported(init: &Value, row: &Value) -> bool {
    let yes = |v: &Value| v == 1 || v == "1" || v == true;
    yes(&row["capabilities"]["blocked_record"])
        || init["features"]
            .as_object()
            .is_some_and(|groups| groups.values().any(|group| yes(&group["blocked_record"])))
}
pub fn payload(device: &Device) -> Result<Value> {
    let id = router::gateway_id(device)?;
    Ok(json!({"method":"GET","params":{"deviceId":id,"routerID":id,"limit":"50"}}))
}
fn success(response: &Value) -> bool {
    response["code"] == 0 || response["code"] == "0"
}
fn optional_text(v: &Value) -> Result<Option<String>> {
    if v.is_null() {
        return Ok(None);
    }
    let s = v
        .as_str()
        .filter(|s| s.len() <= 512 && !s.chars().any(char::is_control))
        .ok_or_else(AppError::protocol)?;
    Ok((!s.trim().is_empty()).then(|| s.to_owned()))
}
pub fn parse(device: &Device, response: &Value) -> Result<Report> {
    router::gateway_id(device)?;
    if !success(response) {
        return Err(AppError::new(
            "routerRecords",
            "获取拦截记录失败，请稍后重试。",
            true,
        ));
    }
    let data = response
        .get("data")
        .filter(|v| v.is_object())
        .ok_or_else(AppError::protocol)?;
    let rows = data["items"]
        .as_array()
        .filter(|rows| rows.len() <= 50)
        .ok_or_else(AppError::protocol)?;
    let mut items = Vec::with_capacity(rows.len());
    for row in rows.iter().filter(|v| !v.is_null()) {
        let event_id = row["eventID"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v > 0)
            .ok_or_else(AppError::protocol)?;
        let count = if row["count"].is_null() {
            1
        } else {
            row["count"]
                .as_u64()
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or_else(AppError::protocol)?
        };
        let timestamp = if row["ts"].is_null() || row["ts"] == -1 {
            None
        } else {
            Some(
                row["ts"]
                    .as_u64()
                    .filter(|v| *v <= 8_640_000_000_000_000)
                    .ok_or_else(AppError::protocol)?,
            )
        };
        let mac = optional_text(&row["mac"])?;
        if mac
            .as_ref()
            .is_some_and(|s| !crate::router_client_name::valid_mac(s))
        {
            return Err(AppError::protocol());
        }
        items.push(Record {
            event_id,
            name: optional_text(&row["name"])?,
            mac,
            count,
            timestamp,
        });
    }
    Ok(Report {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        items,
    })
}
pub async fn load(cloud: &Cloud, device: &Device) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (init, routers) = tokio::try_join!(
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        )
    )?;
    if !success(&init) || !success(&routers) {
        return Err(AppError::protocol());
    }
    let matching = routers["deviceList"]
        .as_array()
        .ok_or_else(AppError::protocol)?
        .iter()
        .filter(|row| row["id"] == id)
        .collect::<Vec<_>>();
    if matching.len() != 1 {
        return Err(AppError::protocol());
    }
    if !supported(&init, matching[0]) {
        return Err(AppError::new(
            "unsupported",
            "此路由器未提供拦截记录功能。",
            false,
        ));
    }
    parse(
        device,
        &cloud.request_router_read(PATH, payload(device)?).await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"miwifi.fixture","model":router::MODEL,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap()
    }
    #[test]
    fn exact_read_only_request_and_native_limit() {
        assert!(router::is_read_path(PATH));
        assert_eq!(
            payload(&device()).unwrap(),
            json!({"method":"GET","params":{"deviceId":"fixture","routerID":"fixture","limit":"50"}})
        );
        assert!(!router::is_read_path(&format!("{PATH}/clear")));
        let mut other = device();
        other.model = "xiaomi.router.other".into();
        assert!(payload(&other).is_err());
    }
    #[test]
    fn valid_empty_is_distinct_from_failure_or_invalid_envelope() {
        assert!(success(&json!({"code":"0"})));
        assert!(!success(&json!({"code":false})));
        assert!(!success(&json!({"code":""})));
        assert!(parse(&device(), &json!({"code":0,"data":{"items":[]}}))
            .unwrap()
            .items
            .is_empty());
        for bad in [
            json!({"code":1,"data":{"items":[]}}),
            json!({"code":0}),
            json!({"code":0,"data":null}),
            json!({"code":0,"data":{"items":{}}}),
        ] {
            assert!(parse(&device(), &bad).is_err());
        }
    }
    #[test]
    fn preserves_server_order_millisecond_dates_and_native_count_default() {
        let r=parse(&device(),&json!({"code":0,"data":{"next":"unconsumed","items":[{"eventID":1005,"name":"A","mac":"AA:BB:CC:00:00:01","ts":1793440000123_u64},null,{"eventID":1003,"count":0,"ts":-1}]}})).unwrap();
        assert_eq!(r.items.len(), 2);
        assert_eq!(r.items[0].timestamp, Some(1793440000123_u64));
        assert_eq!(r.items[0].count, 1);
        assert_eq!(r.items[0].event_id, 1005);
        assert_eq!(r.items[1].count, 0);
        assert_eq!(r.items[1].timestamp, None);
    }
    #[test]
    fn malformed_or_oversized_records_do_not_become_empty_or_partial_success() {
        for (key, value) in [
            ("eventID", json!("1005")),
            ("count", json!(-1)),
            ("count", json!(9007199254740992_u64)),
            ("mac", json!("invalid")),
            ("name", json!("bad\ntext")),
            ("ts", json!(8640000000000001_u64)),
        ] {
            let mut row = json!({"eventID":1005,"ts":1793440000123_u64});
            row[key] = value;
            assert!(parse(&device(), &json!({"code":0,"data":{"items":[row]}})).is_err());
        }
        assert!(parse(
            &device(),
            &json!({"code":0,"data":{"items":vec![json!({"eventID":1005});51]}})
        )
        .is_err());
    }
    #[test]
    fn capability_checks_rom_groups_and_exact_cloud_key() {
        for v in [json!(1), json!("1"), json!(true)] {
            assert!(supported(
                &json!({"features":{"system":{"blocked_record":v}}}),
                &json!({})
            ));
            assert!(supported(
                &json!({}),
                &json!({"capabilities":{"blocked_record":v}})
            ));
        }
        assert!(!supported(
            &json!({"features":{"blocked_record":1}}),
            &json!({"capabilities":{"whitelist":1}})
        ));
    }
}
