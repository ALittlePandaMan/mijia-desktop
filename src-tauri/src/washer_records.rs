//! Read-only standard-plugin washer log URLs (15971). Query parameters stay in
//! the URL; the APK's POST envelope has no `data` field for these calls.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Aggregation {
    Day,
    Month,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LogRange {
    pub start_time: u64,
    pub end_time: u64,
    pub aggregation: Aggregation,
}
impl LogRange {
    pub fn validate(&self) -> Result<()> {
        let now_ms = epoch_secs().saturating_mul(1000);
        if self.start_time < 946_684_800_000
            || self.end_time < self.start_time
            || self.end_time.saturating_sub(self.start_time) > 367 * 86_400_000
            || self.end_time > now_ms.saturating_add(367 * 86_400_000)
        {
            return Err(AppError::invalid("请选择有效的洗衣记录时间范围。"));
        }
        Ok(())
    }
}
pub enum LogQuery<'a> {
    Statistics(&'a LogRange),
    List(&'a LogRange, Option<&'a str>),
    Detail(&'a str),
}
fn opaque_id(value: &str) -> bool {
    !value.is_empty() && value.len() <= 128 && !value.chars().any(char::is_control)
}
pub fn query_path(device: &Device, query: LogQuery<'_>) -> Result<String> {
    if device.model != crate::washer::MODEL
        || device.split_route.is_some()
        || device.unsupported_reason.is_some()
        || !opaque_id(&device.did)
    {
        return Err(AppError::new(
            "unsupported",
            "此设备尚无已核实的洗衣记录接口。",
            false,
        ));
    }
    let mut fields = url::form_urlencoded::Serializer::new(String::new());
    let path = match query {
        LogQuery::Statistics(range) => {
            range.validate()?;
            fields.append_pair(
                "type",
                if range.aggregation == Aggregation::Day {
                    "day"
                } else {
                    "month"
                },
            );
            fields.append_pair("did", &device.did);
            fields.append_pair("startTime", &range.start_time.to_string());
            fields.append_pair("endTime", &range.end_time.to_string());
            "/appliance/washer/log/statistics"
        }
        LogQuery::List(range, cursor) => {
            range.validate()?;
            fields.append_pair("limit", "20");
            fields.append_pair("did", &device.did);
            if let Some(cursor) = cursor {
                if !opaque_id(cursor) {
                    return Err(AppError::invalid("洗衣记录分页标记无效。"));
                }
                fields.append_pair("startId", cursor);
            }
            fields.append_pair("startTime", &range.start_time.to_string());
            fields.append_pair("endTime", &range.end_time.to_string());
            "/appliance/washer/log/list"
        }
        LogQuery::Detail(id) => {
            if !opaque_id(id) {
                return Err(AppError::invalid("洗衣记录编号无效。"));
            }
            fields.append_pair("id", id);
            "/appliance/washer/log/id"
        }
    };
    Ok(format!("{path}?{}", fields.finish()))
}
/// Native callers supply the authenticated Device, never a frontend URL. The
/// state layer additionally checks ownership/context before exposing records.
pub async fn read(cloud: &Cloud, device: &Device, query: LogQuery<'_>) -> Result<Value> {
    let response = cloud
        .request_washer_log(&query_path(device, query)?)
        .await?;
    if !response.is_object()
        || serde_json::to_vec(&response)
            .map_err(|_| AppError::protocol())?
            .len()
            > 1024 * 1024
    {
        return Err(AppError::protocol());
    }
    Ok(response)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogEntry {
    pub id: String,
    pub mode: u32,
    pub start_time: u64,
    pub end_time: u64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogBucket {
    pub start_time: u64,
    pub end_time: u64,
    pub value: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordReport {
    pub did: String,
    pub range: LogRange,
    pub fetched_at: u64,
    pub buckets: Vec<LogBucket>,
    pub frequent_modes: Vec<u32>,
    pub logs: Vec<LogEntry>,
    pub next_id: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordDetail {
    pub did: String,
    pub entry: LogEntry,
    pub parameters: serde_json::Map<String, Value>,
}
fn integer(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}
fn response_id(value: &Value) -> Result<String> {
    let id = value
        .as_str()
        .map(str::to_owned)
        .or_else(|| value.as_u64().map(|n| n.to_string()))
        .filter(|v| opaque_id(v))
        .ok_or_else(AppError::protocol)?;
    Ok(id)
}
fn entry(value: &Value) -> Result<LogEntry> {
    let id = response_id(&value["id"])?;
    let start_time = integer(&value["startTime"])
        .filter(|t| *t >= 946_684_800_000)
        .ok_or_else(AppError::protocol)?;
    let end_time = integer(&value["endTime"])
        .filter(|t| *t >= start_time && *t <= epoch_secs() * 1000 + 86_400_000)
        .ok_or_else(AppError::protocol)?;
    let mode = integer(&value["mode"])
        .and_then(|v| u32::try_from(v).ok())
        .ok_or_else(AppError::protocol)?;
    Ok(LogEntry {
        id,
        mode,
        start_time,
        end_time,
    })
}
fn page(value: &Value, range: &LogRange) -> Result<(Vec<LogEntry>, Option<String>)> {
    let rows = value["logs"]
        .as_array()
        .filter(|v| v.len() <= 20)
        .ok_or_else(AppError::protocol)?;
    let mut ids = std::collections::HashSet::new();
    let mut logs = Vec::new();
    for row in rows {
        let record = entry(row)?;
        if !ids.insert(record.id.clone())
            || record.start_time > range.end_time
            || record.end_time < range.start_time
        {
            return Err(AppError::protocol());
        }
        logs.push(record);
    }
    let cursor = value.get("nextId");
    let next_id = match cursor {
        None | Some(Value::Null) => None,
        Some(v)
            if v.as_str() == Some("")
                || v.as_str() == Some("0")
                || v.as_str() == Some("-1")
                || v.as_i64() == Some(0)
                || v.as_i64() == Some(-1) =>
        {
            None
        }
        Some(v) => Some(response_id(v)?),
    };
    if logs.is_empty() && next_id.is_some() {
        return Err(AppError::protocol());
    }
    Ok((logs, next_id))
}
fn report(
    device: &Device,
    range: &LogRange,
    statistics: Value,
    list: Value,
) -> Result<RecordReport> {
    let kind = if range.aggregation == Aggregation::Day {
        "day"
    } else {
        "month"
    };
    if statistics["type"].as_str() != Some(kind) {
        return Err(AppError::protocol());
    }
    let rows = statistics["times"]
        .as_array()
        .filter(|r| r.len() <= 400)
        .ok_or_else(AppError::protocol)?;
    let mut buckets = Vec::new();
    for row in rows {
        let start_time = integer(&row["startTime"]).ok_or_else(AppError::protocol)?;
        let end_time = integer(&row["endTime"]).ok_or_else(AppError::protocol)?;
        let value = integer(&row["value"])
            .and_then(|v| u32::try_from(v).ok())
            .filter(|v| *v <= 1_000_000)
            .ok_or_else(AppError::protocol)?;
        if start_time > end_time || start_time > range.end_time || end_time < range.start_time {
            return Err(AppError::protocol());
        }
        buckets.push(LogBucket {
            start_time,
            end_time,
            value,
        });
    }
    buckets.sort_by_key(|b| b.end_time);
    let mut frequent_modes = Vec::new();
    for mode in statistics["mode"]
        .as_array()
        .filter(|r| r.len() <= 128)
        .ok_or_else(AppError::protocol)?
    {
        let mode = integer(mode)
            .and_then(|v| u32::try_from(v).ok())
            .ok_or_else(AppError::protocol)?;
        if !frequent_modes.contains(&mode) {
            frequent_modes.push(mode);
        }
    }
    let (logs, next_id) = page(&list, range)?;
    Ok(RecordReport {
        did: device.did.clone(),
        range: range.clone(),
        fetched_at: epoch_secs(),
        buckets,
        frequent_modes,
        logs,
        next_id,
    })
}
pub async fn load(
    cloud: &Cloud,
    device: &Device,
    range: LogRange,
    cursor: Option<String>,
) -> Result<RecordReport> {
    range.validate()?;
    let (statistics, list) = tokio::try_join!(
        read(cloud, device, LogQuery::Statistics(&range)),
        read(cloud, device, LogQuery::List(&range, cursor.as_deref()))
    )?;
    let result = report(device, &range, statistics, list)?;
    if result.next_id.is_some() && result.next_id == cursor {
        return Err(AppError::protocol());
    }
    Ok(result)
}
fn detail(device: &Device, expected: &LogEntry, value: Value) -> Result<RecordDetail> {
    let actual = entry(&value)?;
    if actual.id != expected.id || actual.mode != expected.mode {
        return Err(AppError::protocol());
    }
    let params = match &value["param"] {
        Value::Null => Value::Object(serde_json::Map::new()),
        Value::String(text) if text.is_empty() => Value::Object(serde_json::Map::new()),
        Value::String(text) if text.len() <= 8192 => {
            serde_json::from_str::<Value>(text).map_err(|_| AppError::protocol())?
        }
        Value::Object(_) => value["param"].clone(),
        _ => return Err(AppError::protocol()),
    };
    let params = params
        .as_object()
        .filter(|p| p.len() <= 64)
        .ok_or_else(AppError::protocol)?;
    let mut parameters = serde_json::Map::new();
    for (key, value) in params {
        if matches!(
            key.as_str(),
            "waterTemperature"
                | "rinseTimes"
                | "spinSpeed"
                | "dryingLevel"
                | "dryingTime"
                | "soakTime"
                | "nightWash"
                | "steam"
                | "shake"
                | "blueOxygen"
                | "shakeTime"
                | "freeWashTime"
                | "dryingDegree"
                | "highWater"
                | "softWash"
                | "lowPowerDry"
                | "ionClean"
        ) {
            if !value.is_boolean() && !value.is_number() {
                return Err(AppError::protocol());
            }
            parameters.insert(key.clone(), value.clone());
        }
    }
    Ok(RecordDetail {
        did: device.did.clone(),
        entry: actual,
        parameters,
    })
}
/// The id-only API is never called for an untrusted frontend id alone. First
/// verify membership in a freshly read page of the authenticated device/range.
pub async fn load_detail(
    cloud: &Cloud,
    device: &Device,
    range: LogRange,
    cursor: Option<String>,
    record_id: String,
) -> Result<RecordDetail> {
    range.validate()?;
    if !opaque_id(&record_id) {
        return Err(AppError::invalid("洗衣记录编号无效。"));
    }
    let current = read(cloud, device, LogQuery::List(&range, cursor.as_deref())).await?;
    let (records, _) = page(&current, &range)?;
    let expected = records.iter().find(|r| r.id == record_id).ok_or_else(|| {
        AppError::new(
            "permissionDenied",
            "该记录不属于当前设备的所选记录页。",
            false,
        )
    })?;
    detail(
        device,
        expected,
        read(cloud, device, LogQuery::Detail(&record_id)).await?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture-123","model":crate::washer::MODEL,"name":"washer","online":true,"roomId":"r","roomName":"room"})).unwrap()
    }
    fn range() -> LogRange {
        LogRange {
            start_time: 1_790_000_000_000,
            end_time: 1_790_086_399_000,
            aggregation: Aggregation::Day,
        }
    }
    #[test]
    fn exact_plugin_post_query_uses_authenticated_id_milliseconds_and_twenty_row_pages() {
        let d = device();
        let r = range();
        assert_eq!(query_path(&d,LogQuery::Statistics(&r)).unwrap(),"/appliance/washer/log/statistics?type=day&did=fixture-123&startTime=1790000000000&endTime=1790086399000");
        assert_eq!(query_path(&d,LogQuery::List(&r,Some("next&cursor"))).unwrap(),"/appliance/washer/log/list?limit=20&did=fixture-123&startId=next%26cursor&startTime=1790000000000&endTime=1790086399000");
        assert_eq!(
            query_path(&d, LogQuery::Detail("id/#?&")).unwrap(),
            "/appliance/washer/log/id?id=id%2F%23%3F%26"
        );
    }
    #[test]
    fn invalid_ranges_models_and_cursors_are_rejected_before_network() {
        let mut d = device();
        let r = range();
        d.model = "unverified.washer".into();
        assert!(query_path(&d, LogQuery::List(&r, None)).is_err());
        let d = device();
        for cursor in ["", "line\nbreak"] {
            assert!(query_path(&d, LogQuery::List(&r, Some(cursor))).is_err());
        }
        for r in [
            LogRange {
                start_time: 1_790_000_000,
                end_time: 1_790_086_399,
                aggregation: Aggregation::Day,
            },
            LogRange {
                start_time: r.end_time,
                end_time: r.start_time,
                aggregation: Aggregation::Day,
            },
            LogRange {
                start_time: r.start_time,
                end_time: r.start_time + 368 * 86_400_000,
                aggregation: Aggregation::Day,
            },
        ] {
            assert!(r.validate().is_err());
        }
    }
    fn captured() -> Value {
        serde_json::from_str(include_str!("fixtures/washer-records.json")).unwrap()
    }
    #[test]
    fn captured_strings_and_numeric_modes_preserve_real_recorded_values_and_time_units() {
        let source = captured();
        let range: LogRange = serde_json::from_value(source["range"].clone()).unwrap();
        let result = report(
            &device(),
            &range,
            source["statistics"].clone(),
            source["page"].clone(),
        )
        .unwrap();
        assert_eq!(result.logs.len(), 1);
        assert_eq!(result.logs[0].mode, 24);
        assert_eq!(
            result.logs[0].end_time - result.logs[0].start_time,
            42 * 60 * 1000
        );
        assert_eq!(result.next_id, None);
        assert!(!result.buckets.is_empty());
        assert_eq!(result.frequent_modes, vec![24, 3, 4]);
        let result = detail(&device(), &result.logs[0], source["detail"].clone()).unwrap();
        assert_eq!(result.parameters["waterTemperature"], 40);
        assert_eq!(result.parameters["rinseTimes"], 2);
        assert_eq!(result.parameters["nightWash"], false);
    }
    #[test]
    fn invalid_or_wrong_page_records_and_statistics_are_errors_instead_of_empty_history() {
        let source = captured();
        let range: LogRange = serde_json::from_value(source["range"].clone()).unwrap();
        for bad in [
            json!({}),
            json!({"logs":"wrong"}),
            json!({"logs":[],"nextId":"unexpected"}),
        ] {
            assert!(page(&bad, &range).is_err());
        }
        let mut bad = source["page"].clone();
        let duplicate = bad["logs"][0].clone();
        bad["logs"].as_array_mut().unwrap().push(duplicate);
        assert!(page(&bad, &range).is_err());
        let mut bad = source["page"].clone();
        bad["logs"][0]["startTime"] = json!(range.end_time + 1000);
        assert!(page(&bad, &range).is_err());
        let mut bad = source["statistics"].clone();
        bad["type"] = json!("month");
        assert!(report(&device(), &range, bad, source["page"].clone()).is_err());
        let mut bad = source["statistics"].clone();
        bad["times"][0]["value"] = json!(-1);
        assert!(report(&device(), &range, bad, source["page"].clone()).is_err());
    }
    #[test]
    fn detail_identity_and_mode_must_match_and_missing_parameters_are_not_invented() {
        let source = captured();
        let expected = entry(&source["page"]["logs"][0]).unwrap();
        for (key, value) in [("id", json!("someone-elses-record")), ("mode", json!(3))] {
            let mut bad = source["detail"].clone();
            bad[key] = value;
            assert!(detail(&device(), &expected, bad).is_err());
        }
        for empty in [Value::Null, json!(""), json!({})] {
            let mut missing = source["detail"].clone();
            missing["param"] = empty;
            assert!(detail(&device(), &expected, missing)
                .unwrap()
                .parameters
                .is_empty());
        }
        let mut bad = source["detail"].clone();
        bad["param"] = json!("{invalid");
        assert!(detail(&device(), &expected, bad).is_err());
        let mut bad = source["detail"].clone();
        bad["param"] = json!({"waterTemperature":{"value":40}});
        assert!(detail(&device(), &expected, bad).is_err());
    }
}
