//! Read-only cloud events from the original Doorbell 3 plugin (10022/10025/10139).
//! File/image store identifiers remain native and are never serialized to the UI.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use ring::hmac;
use serde::Serialize;
use serde_json::Value;

pub const MODEL: &str = "madv.cateye.mi3iot";
const PAGE_LIMIT: usize = 20;
const MAX_PAGES: usize = 20;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub id: String,
    pub time: u64,
    pub kind: String,
    #[serde(rename = "type")]
    pub event_type: String,
    // The original eventlist adapter does not establish duration units.
    // Leave this absent until the media adapter supplies a verified duration.
    pub duration: Option<u64>,
    pub thumbnail_available: bool,
    pub playback_available: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub date: String,
    pub events: Vec<Event>,
    pub complete: bool,
    pub retention_days: Option<u16>,
    pub available_from: Option<u64>,
    pub playback_available: bool,
    pub reason: String,
}

pub(crate) struct Record {
    pub event: Event,
    pub file: Option<String>,
    pub image: Option<String>,
}

pub(crate) struct Records {
    pub records: Vec<Record>,
    pub complete: bool,
    pub retention_days: Option<u16>,
    pub available_from: Option<u64>,
}

pub fn validate_device(device: &Device) -> Result<()> {
    if super::profiles::doorbell(&device.model).is_none() || device.split_route.is_some() {
        return Err(AppError::invalid("此型号没有已核实的门铃云录像绑定。"));
    }
    Ok(())
}

pub fn retention_days(model: &str, value: &Value) -> Option<u16> {
    match value.get("vip").and_then(Value::as_bool) {
        Some(false) => super::profiles::doorbell(model).and_then(|p| p.free_retention_days),
        Some(true) => value
            .get("rollingSaveInterval")
            .and_then(Value::as_u64)
            .map(|millis| millis.div_ceil(86_400_000))
            .filter(|days| (1..=31).contains(days))
            .map(|days| days as u16),
        None => None,
    }
}

fn label(event_type: &str) -> &'static str {
    let types: Vec<_> = event_type.split(':').collect();
    for (code, label) in [
        ("Demolition", "设备被拆动"),
        ("Bell", "有人按门铃"),
        ("Stay", "有人逗留"),
        ("Pass", "有人经过"),
        ("BellVideo", "视频留言"),
        ("Face", "识别到人脸"),
    ] {
        if types.contains(&code) {
            return label;
        }
    }
    "门铃事件"
}

fn store_id(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}

fn event_id(key: &hmac::Key, device: &Device, raw: &Value) -> Result<String> {
    let identity = serde_json::json!([
        device.control_did(),
        raw["fileId"],
        raw["imgStoreId"],
        raw["createTime"],
        raw["eventType"],
        raw.get("offset").cloned().unwrap_or(Value::from(0))
    ]);
    Ok(hmac::sign(
        key,
        &serde_json::to_vec(&identity).map_err(|_| AppError::protocol())?,
    )
    .as_ref()
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect())
}

fn parse_page(
    key: &hmac::Key,
    device: &Device,
    value: &Value,
    start_ms: u64,
    end_ms: u64,
) -> Result<(Vec<Record>, bool, Option<u64>)> {
    let rows = value
        .get("thirdPartPlayUnits")
        .and_then(Value::as_array)
        .filter(|rows| rows.len() <= 100)
        .ok_or_else(AppError::protocol)?;
    let more = value
        .get("isContinue")
        .and_then(Value::as_bool)
        .ok_or_else(AppError::protocol)?;
    let next = value.get("nextTime").and_then(Value::as_u64);
    let mut records = Vec::new();
    for row in rows {
        let time_ms = row
            .get("createTime")
            .and_then(Value::as_u64)
            .ok_or_else(AppError::protocol)?;
        if time_ms < start_ms || time_ms > end_ms {
            continue;
        }
        let event_type = row
            .get("eventType")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty() && s.len() <= 128 && s.is_ascii())
            .ok_or_else(AppError::protocol)?;
        let file = store_id(&row["fileId"]);
        let image = store_id(&row["imgStoreId"]);
        records.push(Record {
            event: Event {
                id: event_id(key, device, row)?,
                time: time_ms / 1000,
                kind: label(event_type).into(),
                event_type: event_type.into(),
                duration: None,
                thumbnail_available: image.is_some(),
                playback_available: file.is_some(),
            },
            file,
            image,
        });
    }
    Ok((records, more, next))
}

pub(crate) async fn read_records(cloud: &Cloud, device: &Device, date: &str) -> Result<Records> {
    validate_device(device)?;
    let (start, end) = super::events::range(date)?;
    let retention = match cloud.doorbell_cloud_status(device).await {
        Ok(value) => retention_days(&device.model, &value),
        Err(e) if e.kind == "authExpired" => return Err(e),
        Err(_) => None,
    };
    let now = crate::models::epoch_secs();
    let available_from = retention.map(|days| now.saturating_sub(u64::from(days) * 86400));
    if available_from.is_some_and(|from| end < from) {
        return Err(AppError::invalid("此日期已超出门铃当前云存储的保留范围。"));
    }
    let account_key = hmac::Key::new(hmac::HMAC_SHA256, cloud.credentials.security.as_bytes());
    let seed = hmac::sign(&account_key, cloud.credentials.user_id.as_bytes());
    let key = hmac::Key::new(hmac::HMAC_SHA256, seed.as_ref());
    let start_ms = start * 1000;
    let mut cursor = end * 1000 - u64::from(end == start + 86400);
    let mut records = Vec::new();
    let mut complete = false;
    for _ in 0..MAX_PAGES {
        let value = cloud
            .doorbell_cloud_events(device, start_ms, cursor, PAGE_LIMIT)
            .await?;
        let (rows, more, next) = parse_page(&key, device, &value, start_ms, cursor)?;
        records.extend(rows);
        if !more {
            complete = true;
            break;
        }
        cursor = next
            .filter(|next| *next < cursor && *next >= start_ms)
            .ok_or_else(AppError::protocol)?;
    }
    records.sort_by_key(|r| std::cmp::Reverse(r.event.time));
    let mut seen = std::collections::HashSet::new();
    records.retain(|r| seen.insert(r.event.id.clone()));
    Ok(Records {
        records,
        complete,
        retention_days: retention,
        available_from,
    })
}

pub async fn read_report(cloud: &Cloud, device: &Device, date: &str) -> Result<Report> {
    let result = read_records(cloud, device, date).await?;
    let records = result
        .records
        .iter()
        .map(|r| super::events::Record {
            event: super::events::CareEvent {
                id: r.event.id.clone(),
                time: r.event.time,
                kind: r.event.kind.clone(),
                duration: 0,
                thumbnail_available: r.image.is_some(),
                playback_available: r.file.is_some(),
            },
            file: r.file.clone(),
            image: r.image.clone(),
        })
        .collect();
    super::events::cache_records(cloud, device, date, records).await;
    Ok(Report {
        date: date.into(),
        events: result.records.into_iter().map(|r| r.event).collect(),
        complete: result.complete,
        retention_days: result.retention_days,
        available_from: result.available_from,
        playback_available: true,
        reason: String::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture","model":MODEL,"name":"fixture","online":false,"roomId":"r","roomName":"fixture"})).unwrap()
    }
    fn page() -> Value {
        json!({"thirdPartPlayUnits":[
            {"createTime":1000000000000_u64,"eventType":"Pass:Bell","fileId":"private-video","imgStoreId":"private-image","offset":0},
            {"createTime":1000000000000_u64,"eventType":"Pass:Bell","fileId":"other-private-video","imgStoreId":"other-private-image","offset":0}
        ],"isContinue":false,"nextTime":0})
    }
    #[test]
    fn same_second_events_have_stable_context_bound_opaque_ids_and_private_fields_are_not_serialized(
    ) {
        let key = hmac::Key::new(hmac::HMAC_SHA256, b"fixture-account-key");
        let d = device();
        let (records, more, _) =
            parse_page(&key, &d, &page(), 999999999999, 1000000000001).unwrap();
        assert!(!more);
        assert_eq!(records.len(), 2);
        assert_ne!(records[0].event.id, records[1].event.id);
        assert_eq!(records[0].event.kind, "有人按门铃");
        assert!(records[0].event.playback_available);
        assert!(records[0].event.thumbnail_available);
        assert_eq!(records[0].file.as_deref(), Some("private-video"));
        assert_eq!(records[0].image.as_deref(), Some("private-image"));
        let serialized = serde_json::to_string(&records[0].event).unwrap();
        assert!(!serialized.contains("private"));
        assert!(!serialized.contains("fileId") && !serialized.contains("imgStoreId"));
        let again = parse_page(&key, &d, &page(), 999999999999, 1000000000001)
            .unwrap()
            .0;
        assert_eq!(records[0].event.id, again[0].event.id);
        let other = hmac::Key::new(hmac::HMAC_SHA256, b"other-account-key");
        let changed = parse_page(&other, &d, &page(), 999999999999, 1000000000001)
            .unwrap()
            .0;
        assert_ne!(records[0].event.id, changed[0].event.id);
        let mut another_device = d.clone();
        another_device.did = "another-fixture".into();
        let changed = parse_page(&key, &another_device, &page(), 999999999999, 1000000000001)
            .unwrap()
            .0;
        assert_ne!(records[0].event.id, changed[0].event.id);
    }
    #[test]
    fn malformed_cloud_responses_are_not_reported_as_empty_history() {
        let key = hmac::Key::new(hmac::HMAC_SHA256, b"fixture");
        let d = device();
        for raw in [
            json!({}),
            json!({"thirdPartPlayUnits":[]}),
            json!({"thirdPartPlayUnits":[{"createTime":1000}],"isContinue":false}),
        ] {
            assert!(parse_page(&key, &d, &raw, 0, 2000).is_err());
        }
        let result = parse_page(
            &key,
            &d,
            &json!({"thirdPartPlayUnits":[],"isContinue":false}),
            0,
            2000,
        )
        .unwrap();
        assert!(result.0.is_empty());
    }
    #[test]
    fn cloud_retention_comes_from_original_free_tier_or_actual_vip_interval() {
        assert_eq!(retention_days(MODEL, &json!({"vip":false})), Some(3));
        assert_eq!(
            retention_days(
                MODEL,
                &json!({"vip":true,"rollingSaveInterval":2592000000_u64})
            ),
            Some(30)
        );
        assert_eq!(retention_days(MODEL, &json!({"vip":true})), None);
        assert_eq!(retention_days(MODEL, &json!({})), None);
        assert_eq!(
            retention_days("midr.cateye.sd400", &json!({"vip":false})),
            None
        );
        let mut other = device();
        other.model = "chuangmi.camera.81ac1".into();
        assert!(validate_device(&other).is_err());
    }
    #[test]
    fn all_inspected_doorbells_read_image_only_and_video_events_without_enabling_sd() {
        let registry: Value =
            serde_json::from_str(include_str!("../../../src/camera-profiles.json")).unwrap();
        let key = hmac::Key::new(hmac::HMAC_SHA256, b"isolated-fixture");
        for profile in registry["cloudDoorbells"].as_array().unwrap() {
            for model in profile["models"].as_array().unwrap() {
                let mut d = device();
                d.model = model.as_str().unwrap().into();
                validate_device(&d).unwrap();
                assert!(!super::super::media_control::features(&d.model).playback);
                let raw = json!({"thirdPartPlayUnits":[
                    {"createTime":1000000000000_u64,"eventType":"Bell","imgStoreId":"image-only"},
                    {"createTime":1000000000000_u64,"eventType":"Pass:Stay","fileId":"video","imgStoreId":"image"},
                    {"createTime":1000000000000_u64,"eventType":"Demolition"}
                ],"isContinue":false});
                let (rows, more, _) =
                    parse_page(&key, &d, &raw, 999999999999, 1000000000001).unwrap();
                assert_eq!(rows.len(), 3);
                assert!(!more);
                assert!(rows[0].event.thumbnail_available && !rows[0].event.playback_available);
                assert!(rows[1].event.playback_available);
                assert!(!rows[2].event.thumbnail_available && !rows[2].event.playback_available);
                assert_eq!(rows[2].event.kind, "设备被拆动");
                d.split_route = Some(crate::models::SplitRoute {
                    parent_did: "parent".into(),
                    service_iid: 2,
                });
                assert!(validate_device(&d).is_err());
            }
        }
    }
}
