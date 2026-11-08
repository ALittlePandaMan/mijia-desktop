//! Original standard-camera events and native-only media identities.
//! No arbitrary endpoints, file IDs, thumbnail URLs, or cloud playback credentials leave Rust.
use crate::{
    error::{AppError, Result},
    models,
};
use serde::Serialize;
use serde_json::Value;
use std::{
    collections::HashMap,
    time::{Duration, Instant},
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CareEvent {
    pub id: String,
    pub time: u64,
    pub kind: String,
    pub duration: u64,
    pub thumbnail_available: bool,
    pub playback_available: bool,
}
#[derive(Serialize)]
pub struct CareReport {
    pub events: Vec<CareEvent>,
    pub reason: Option<String>,
}
#[derive(Clone)]
pub(crate) struct Record {
    pub event: CareEvent,
    pub file: Option<String>,
    pub image: Option<String>,
}
#[derive(Default)]
pub(crate) struct EventCache {
    entries: HashMap<String, (String, String, Instant, Record)>,
}
fn id_value(value: &Value) -> Option<String> {
    value
        .as_str()
        .filter(|s| !s.is_empty() && s.len() <= 2048 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn row_key(row: &Value) -> String {
    use sha2::{Digest, Sha256};
    format!(
        "{:x}",
        Sha256::digest(
            serde_json::json!([
                row["fileId"],
                row["imgStoreId"],
                row["createTime"],
                row["eventType"]
            ])
            .to_string()
            .as_bytes()
        )
    )
}
fn opaque_id(cloud: &crate::cloud::Cloud, device: &models::Device, row: &Value) -> String {
    let key = ring::hmac::Key::new(
        ring::hmac::HMAC_SHA256,
        cloud.credentials.security.as_bytes(),
    );
    ring::hmac::sign(
        &key,
        serde_json::json!([
            cloud.credentials.user_id,
            device.control_did(),
            row["fileId"],
            row["imgStoreId"],
            row["createTime"],
            row["eventType"]
        ])
        .to_string()
        .as_bytes(),
    )
    .as_ref()
    .iter()
    .map(|b| format!("{b:02x}"))
    .collect()
}
pub(crate) async fn record(
    cloud: &crate::cloud::Cloud,
    device: &models::Device,
    date: &str,
    id: &str,
) -> Result<Record> {
    range(date)?;
    if !(crate::camera::profiles::care(&device.model)
        || super::profiles::doorbell(&device.model).is_some())
        || id.len() != 64
        || !id.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(AppError::invalid("云录像事件无效。"));
    }
    let cached = cloud
        .camera_event_cache
        .lock()
        .await
        .entries
        .get(id)
        .filter(|(did, day, at, _)| {
            did == device.control_did() && day == date && at.elapsed() < Duration::from_secs(300)
        })
        .map(|(_, _, _, r)| r.clone());
    if let Some(record) = cached {
        return Ok(record);
    }
    if super::profiles::doorbell(&device.model).is_some() {
        super::doorbell_cloud::read_report(cloud, device, date).await?;
    } else {
        read_report(cloud, device, date).await?;
    }
    cloud
        .camera_event_cache
        .lock()
        .await
        .entries
        .get(id)
        .filter(|(did, day, _, _)| did == device.control_did() && day == date)
        .map(|(_, _, _, r)| r.clone())
        .ok_or_else(|| AppError::invalid("此云录像事件已失效，请刷新列表。"))
}
pub async fn read_report(
    cloud: &crate::cloud::Cloud,
    device: &crate::models::Device,
    date: &str,
) -> Result<CareReport> {
    if !crate::camera::profiles::care(&device.model) {
        return Err(AppError::invalid("此型号的看家助手协议尚未核实。"));
    }
    let (start, end) = range(date)?;
    let mut cursor = end * 1000;
    let mut all = Vec::new();
    let mut records = Vec::new();
    let mut complete = false;
    for _ in 0..20 {
        let data = cloud.camera_events(device, start * 1000, cursor).await?;
        let report = parse(&data, start, end)?;
        for mut event in report.events {
            if let Some(row) = data["thirdPartPlayUnits"]
                .as_array()
                .and_then(|rows| rows.iter().find(|row| row_key(row) == event.id))
            {
                event.id = opaque_id(cloud, device, row);
                let file = id_value(&row["fileId"]);
                let image = id_value(&row["imgStoreId"]);
                event.playback_available = file.is_some();
                event.thumbnail_available = image.is_some();
                records.push(Record {
                    event: event.clone(),
                    file,
                    image,
                });
                all.push(event);
            }
        }
        let more = data
            .get("isContinue")
            .and_then(Value::as_bool)
            .ok_or_else(AppError::protocol)?;
        if !more {
            complete = true;
            break;
        }
        let next = data
            .get("nextTime")
            .and_then(Value::as_u64)
            .filter(|n| *n < cursor && *n >= start * 1000)
            .ok_or_else(AppError::protocol)?;
        cursor = next;
    }
    all.sort_by_key(|e| std::cmp::Reverse(e.time));
    let mut seen = std::collections::HashSet::new();
    all.retain(|e| seen.insert(e.id.clone()));
    cache_records(cloud, device, date, records).await;
    Ok(CareReport {
        events: all,
        reason: (!complete).then(|| "事件较多，请选择其他日期继续查看。".into()),
    })
}
pub(crate) async fn cache_records(
    cloud: &crate::cloud::Cloud,
    device: &models::Device,
    date: &str,
    records: Vec<Record>,
) {
    let mut cache = cloud.camera_event_cache.lock().await;
    cache
        .entries
        .retain(|_, (_, _, at, _)| at.elapsed() < Duration::from_secs(300));
    if cache.entries.len() + records.len() > 4000 {
        cache.entries.clear();
    }
    for record in records {
        cache.entries.insert(
            record.event.id.clone(),
            (
                device.control_did().to_owned(),
                date.to_owned(),
                Instant::now(),
                record,
            ),
        );
    }
}
pub fn range(date: &str) -> Result<(u64, u64)> {
    use chrono::{FixedOffset, NaiveDate, TimeZone};
    let day =
        NaiveDate::parse_from_str(date, "%Y-%m-%d").map_err(|_| AppError::invalid("日期无效。"))?;
    let start = FixedOffset::east_opt(8 * 3600)
        .unwrap()
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).unwrap())
        .single()
        .ok_or_else(|| AppError::invalid("日期无效。"))?
        .timestamp();
    let now = models::epoch_secs();
    if start < 0 || start as u64 > now || now.saturating_sub(start as u64) > 31 * 86400 {
        return Err(AppError::invalid("请选择最近31天内的日期。"));
    }
    Ok((start as u64, (start as u64 + 86400).min(now)))
}
fn label(kind: &str) -> &'static str {
    if kind.contains("BabyCry") {
        "宝宝哭声"
    } else if kind.contains("People") || kind.contains("Person") {
        "有人移动"
    } else if kind.contains("Face") {
        "识别到人脸"
    } else if kind.contains("Pet") {
        "宠物移动"
    } else if kind.contains("Sound") {
        "较大声响"
    } else if kind.contains("Motion") {
        "画面变动"
    } else {
        "设备事件"
    }
}
pub fn parse(value: &Value, start: u64, end: u64) -> Result<CareReport> {
    let rows = value
        .get("thirdPartPlayUnits")
        .and_then(Value::as_array)
        .ok_or_else(AppError::protocol)?;
    let mut events = Vec::new();
    for row in rows.iter().take(100) {
        let Some(time) = row.get("createTime").and_then(Value::as_u64) else {
            continue;
        };
        let time = if time > 10_000_000_000 {
            time / 1000
        } else {
            time
        };
        if time < start || time > end {
            continue;
        }
        let kind = row
            .get("eventType")
            .and_then(Value::as_str)
            .unwrap_or("Default");
        let label = label(kind);
        events.push(CareEvent {
            id: row_key(row),
            time,
            kind: label.to_owned(),
            duration: row.get("duration").and_then(Value::as_u64).unwrap_or(0),
            thumbnail_available: id_value(&row["imgStoreId"]).is_some(),
            playback_available: id_value(&row["fileId"]).is_some(),
        });
    }
    events.sort_by_key(|e| std::cmp::Reverse(e.time));
    let mut seen = std::collections::HashSet::new();
    events.retain(|e| seen.insert(e.id.clone()));
    Ok(CareReport {
        events,
        reason: None,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn filters_ranges_and_preserves_real_events() {
        let r=parse(&json!({"thirdPartPlayUnits":[{"createTime":1000000000000_u64,"eventType":"Motion","duration":9},{"createTime":1000000000000_u64,"eventType":"Motion"},{"createTime":9999,"eventType":"PeopleMotion"}]}),999999999,1000000001).unwrap();
        assert_eq!(r.events.len(), 1);
        assert_eq!(r.events[0].kind, "画面变动");
        assert_eq!(r.events[0].duration, 9);
    }
    #[test]
    fn same_second_same_kind_keeps_distinct_recordings() {
        let r=parse(&json!({"thirdPartPlayUnits":[{"createTime":1000,"eventType":"Motion","fileId":"a"},{"createTime":1000,"eventType":"Motion","fileId":"b"}]}),0,2000).unwrap();
        assert_eq!(r.events.len(), 2);
        assert_ne!(r.events[0].id, r.events[1].id);
    }
    #[test]
    fn missing_is_not_empty() {
        assert!(parse(&json!({}), 0, 10).is_err());
        assert!(parse(&json!({"thirdPartPlayUnits":[]}), 0, 10)
            .unwrap()
            .events
            .is_empty());
    }
    #[test]
    fn date_is_closed_and_recent() {
        assert!(range("2020-01-01").is_err());
        assert!(range("2026-99-99").is_err());
    }
}
