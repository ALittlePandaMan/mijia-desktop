//! gxj v29 modules11618/11756/11759: event6.1 and prop.6.2, read-only.
pub use crate::purifier_history::{Period, Point, Selection};
use crate::{
    cloud::Cloud,
    dispenser,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel},
};
use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub time: u64,
    pub seconds: u32,
    pub volume_ml: u32,
    pub temperature: f64,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Records {
    pub did: String,
    pub fetched_at: u64,
    pub start: u64,
    pub end: u64,
    pub next_before: Option<u64>,
    pub records: Vec<Record>,
    pub ignored_zero: u32,
    pub rejected: u32,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Statistics {
    pub did: String,
    pub fetched_at: u64,
    pub selection: Selection,
    pub start: u64,
    pub end: u64,
    pub points: Vec<Point>,
    pub total_ml: Option<u64>,
    pub warnings: Vec<String>,
}
struct Range {
    start: u64,
    end: u64,
    kind: &'static str,
    points: Vec<Point>,
}
fn invalid() -> AppError {
    AppError::invalid("请选择有效的饮水记录日期（周/月限近一年）。")
}
fn midnight<T: TimeZone>(now: &DateTime<T>, day: NaiveDate) -> Result<u64> {
    now.timezone()
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or_else(invalid)?)
        .earliest()
        .and_then(|d| u64::try_from(d.timestamp()).ok())
        .ok_or_else(invalid)
}
fn range<T: TimeZone>(s: &Selection, now: DateTime<T>) -> Result<Range> {
    let date = NaiveDate::parse_from_str(&s.date, "%Y-%m-%d").map_err(|_| invalid())?;
    let today = now.date_naive();
    let minimum = today
        .checked_sub_months(Months::new(12))
        .ok_or_else(invalid)?;
    if date.format("%Y-%m-%d").to_string() != s.date
        || (s.period == Period::Year && date.year() < 1970)
        || (s.period != Period::Year && date < minimum)
        || date > today
    {
        return Err(invalid());
    }
    let (first, next, kind) = match s.period {
        Period::Week => {
            let first = date
                .checked_sub_days(Days::new(date.weekday().num_days_from_monday() as u64))
                .ok_or_else(invalid)?;
            (
                first,
                first.checked_add_days(Days::new(7)).ok_or_else(invalid)?,
                "stat_day_v3",
            )
        }
        Period::Month => {
            let first = date.with_day(1).ok_or_else(invalid)?;
            (
                first,
                first
                    .checked_add_months(Months::new(1))
                    .ok_or_else(invalid)?,
                "stat_day_v3",
            )
        }
        Period::Year => (
            NaiveDate::from_ymd_opt(date.year(), 1, 1).ok_or_else(invalid)?,
            NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).ok_or_else(invalid)?,
            "stat_month_v3",
        ),
    };
    let mut points = Vec::new();
    let mut day = first;
    while day < next {
        points.push(Point {
            time: midnight(&now, day)?,
            label: if s.period == Period::Year {
                format!("{}月", day.month())
            } else {
                format!("{}/{}", day.month(), day.day())
            },
            volume_ml: None,
        });
        day = if s.period == Period::Year {
            day.checked_add_months(Months::new(1))
        } else {
            day.checked_add_days(Days::new(1))
        }
        .ok_or_else(invalid)?;
    }
    Ok(Range {
        start: midnight(&now, first)?,
        end: midnight(&now, next)?.saturating_sub(1),
        kind,
        points,
    })
}
pub fn supported(device: &Device, panel: &DevicePanel) -> bool {
    device.model == dispenser::MODEL
        && device.did == panel.did
        && device.model == panel.model
        && device.split_route.is_none()
        && panel.unsupported_reason.is_none()
        && [
            (1, "water-production-time", "uint32"),
            (2, "pure-water-output", "uint32"),
            (3, "temperature", "float"),
        ]
        .iter()
        .all(|(piid, name, format)| {
            panel.services.iter().any(|s| {
                s.siid == 6
                    && s.name == "water-use-details"
                    && s.properties.iter().any(|p| {
                        p.piid == *piid
                            && p.name == *name
                            && p.format == *format
                            && p.access.iter().any(|a| a == "read")
                    })
            })
        })
}
fn payload(v: &Value) -> Option<Value> {
    match v {
        Value::String(s) if s.len() <= 65536 => serde_json::from_str(s).ok(),
        Value::Array(_) => Some(v.clone()),
        _ => None,
    }
}
fn identity(row: &Value, device: &Device, owner: Option<&str>) -> bool {
    row.get("did").is_none_or(|v| id(v) == device.control_did())
        && owner.is_none_or(|owner| row.get("uid").is_none_or(|v| id(v) == owner))
}
fn parse_record(row: &Value, device: &Device, owner: &str, start: u64, end: u64) -> Option<Record> {
    let time = row["time"].as_u64()?;
    if !identity(row, device, Some(owner))
        || row["key"] != "6.1"
        || row["type"] != "event"
        || time < start
        || time > end
    {
        return None;
    }
    let data = payload(&row["value"])?;
    let fields = data.as_array()?;
    if fields.len() != 3 {
        return None;
    }
    let one = |piid: u64| -> Option<&Value> {
        let mut rows = fields.iter().filter(|f| f["piid"].as_u64() == Some(piid));
        let field = rows.next()?;
        if rows.next().is_some() || field.get("siid").is_some_and(|v| v.as_u64() != Some(6)) {
            return None;
        }
        Some(&field["value"])
    };
    let seconds = one(1)?.as_u64().filter(|v| *v <= 1_000_000_000)? as u32;
    let volume_ml = one(2)?.as_u64().filter(|v| *v <= 1_000_000_000)? as u32;
    let temperature = one(3)?
        .as_f64()
        .filter(|v| v.is_finite() && (-5.0..=100.0).contains(v))?;
    let id = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&(time, seconds, volume_ml, temperature)).ok()?)
    );
    Some(Record {
        id,
        time,
        seconds,
        volume_ml,
        temperature,
    })
}
fn parse_records(rows: &[Value], device: &Device, owner: &str, start: u64, end: u64) -> Records {
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    let mut zero = 0;
    let mut rejected = 0;
    for row in rows {
        match parse_record(row, device, owner, start, end) {
            Some(r) if r.seconds == 0 || r.volume_ml == 0 => zero += 1,
            Some(r) if seen.insert(r.id.clone()) => records.push(r),
            Some(_) => {}
            None => rejected += 1,
        }
    }
    records.sort_by(|a, b| b.time.cmp(&a.time).then(a.id.cmp(&b.id)));
    // Inclusive cursor retains all records sharing the oldest second. No cursor
    // progress is surfaced as a warning rather than silently skipping that second.
    let next = rows
        .iter()
        .filter_map(|r| r["time"].as_u64().filter(|t| *t >= start && *t <= end))
        .min()
        .filter(|t| rows.len() >= 1000 && *t > start && *t < end);
    let mut warnings = Vec::new();
    if rejected > 0 {
        warnings.push(format!("{rejected}条取水记录未通过身份或格式验证。"))
    }
    if rows.len() >= 1000 && next.is_none() {
        warnings.push("记录达到查询上限，列表可能不完整。".into())
    }
    Records {
        did: device.did.clone(),
        fetched_at: epoch_secs(),
        start,
        end,
        next_before: next,
        records,
        ignored_zero: zero,
        rejected,
        warnings,
    }
}
pub async fn load_records(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    before: Option<u64>,
) -> Result<Records> {
    if !supported(device, panel) {
        return Err(AppError::new(
            "unsupported",
            "此型号的饮水事件绑定尚未确认。",
            false,
        ));
    }
    let now = Local::now();
    let first = now
        .date_naive()
        .with_day(1)
        .and_then(|d| d.checked_sub_months(Months::new(11)))
        .ok_or_else(invalid)?;
    let start = midnight(&now, first)?;
    let end = before.unwrap_or(now.timestamp() as u64);
    if end < start || end > now.timestamp() as u64 {
        return Err(invalid());
    }
    let rows = if end == start {
        Vec::new()
    } else {
        cloud.dispenser_records(device, start, end).await?
    };
    Ok(parse_records(&rows, device, owner, start, end))
}
fn parse_statistics(
    rows: &[Value],
    device: &Device,
    selection: Selection,
    mut range: Range,
) -> Statistics {
    let mut values = BTreeMap::new();
    let mut ambiguous = HashSet::new();
    let mut rejected = 0;
    for row in rows {
        let parsed = (|| {
            if !identity(row, device, None) || row.get("key").is_some_and(|v| v != "prop.6.2") {
                return None;
            }
            let time = row["time"].as_u64()?;
            if !range.points.iter().any(|p| p.time == time) {
                return None;
            }
            let data = payload(&row["value"])?;
            let a = data.as_array().filter(|a| a.len() == 1)?;
            let value = a[0].as_u64().filter(|v| *v <= 9_007_199_254_740_991)?;
            Some((time, value))
        })();
        if let Some((time, ml)) = parsed {
            if ambiguous.contains(&time) {
                continue;
            }
            if let Some(old) = values.get(&time) {
                if *old != ml {
                    values.remove(&time);
                    ambiguous.insert(time);
                    rejected += 1
                }
            } else {
                values.insert(time, ml);
            }
        } else {
            rejected += 1
        }
    }
    for point in &mut range.points {
        point.volume_ml = values.get(&point.time).copied()
    }
    let total_ml = if rejected == 0 {
        values
            .values()
            .try_fold(0u64, |a, v| a.checked_add(*v))
            .filter(|v| *v <= 9_007_199_254_740_991)
    } else {
        None
    };
    Statistics {
        did: device.did.clone(),
        fetched_at: epoch_secs(),
        selection,
        start: range.start,
        end: range.end,
        points: range.points,
        total_ml,
        warnings: if rejected == 0 {
            vec![]
        } else {
            vec![format!("{rejected}条统计未通过验证，合计暂不可用。")]
        },
    }
}
pub async fn load_statistics(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
    selection: Selection,
) -> Result<Statistics> {
    if !supported(device, panel) {
        return Err(AppError::new(
            "unsupported",
            "此型号的饮水统计绑定尚未确认。",
            false,
        ));
    }
    let range = range(&selection, Local::now())?;
    let rows = cloud
        .dispenser_statistics(device, range.kind, range.start, range.end)
        .await?;
    Ok(parse_statistics(&rows, device, selection, range))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture","name":"管线机","model":dispenser::MODEL,"online":true,"roomId":"r","roomName":"厨房"})).unwrap()
    }
    fn now() -> DateTime<chrono::FixedOffset> {
        chrono::FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 30, 12, 0, 0)
            .unwrap()
    }
    fn row() -> Value {
        json!({"did":"fixture","uid":"owner","key":"6.1","type":"event","time":100,"value":"[{\"piid\":3,\"value\":45.5},{\"piid\":1,\"value\":12},{\"piid\":2,\"value\":150}]"})
    }
    #[test]
    fn record_binds_fields_by_identity_and_preserves_real_temperature() {
        let r = parse_record(&row(), &device(), "owner", 0, 200).unwrap();
        assert_eq!(r.temperature, 45.5);
        assert_eq!(r.volume_ml, 150);
        assert_eq!(r.seconds, 12);
        for key in ["did", "uid", "key", "type"] {
            let mut bad = row();
            bad[key] = json!("other");
            assert!(parse_record(&bad, &device(), "owner", 0, 200).is_none())
        }
    }
    #[test]
    fn rejects_duplicate_missing_and_out_of_range_fields() {
        for value in [
            json!([{"piid":1,"value":12},{"piid":2,"value":150},{"piid":2,"value":45}]),
            json!([{"piid":1,"value":12},{"piid":2,"value":150},{"piid":3,"value":101}]),
            json!([{"piid":1,"value":12},{"piid":2,"value":150}]),
        ] {
            let mut r = row();
            r["value"] = value;
            assert!(parse_record(&r, &device(), "owner", 0, 200).is_none())
        }
    }
    #[test]
    fn records_filter_zero_deduplicate_and_keep_inclusive_cursor() {
        let d = device();
        let r = row();
        let mut z = r.clone();
        z["value"] = json!([{"piid":1,"value":0},{"piid":2,"value":150},{"piid":3,"value":25}]);
        let p = parse_records(&[r.clone(), r.clone(), z], &d, "owner", 0, 200);
        assert_eq!(p.records.len(), 1);
        assert_eq!(p.ignored_zero, 1);
        let p = parse_records(&vec![r; 1000], &d, "owner", 0, 200);
        assert_eq!(p.next_before, Some(100));
        let p = parse_records(&vec![row(); 1000], &d, "owner", 0, 100);
        assert_eq!(p.next_before, None);
        assert!(!p.warnings.is_empty());
    }
    #[test]
    fn calendar_uses_iso_week_natural_month_year_and_rolling_year() {
        let s = |period, date: &str| Selection {
            period,
            date: date.into(),
        };
        let r = range(&s(Period::Week, "2026-10-30"), now()).unwrap();
        assert_eq!(r.points.len(), 7);
        assert_eq!(r.points[0].label, "10/26");
        assert_eq!(
            range(&s(Period::Month, "2026-10-30"), now())
                .unwrap()
                .points
                .len(),
            31
        );
        assert_eq!(
            range(&s(Period::Year, "2026-10-30"), now())
                .unwrap()
                .points
                .len(),
            12
        );
        for date in ["2025-10-29", "2026-10-31", "2026-2-1"] {
            assert!(range(&s(Period::Week, date), now()).is_err())
        }
    }
    #[test]
    fn statistics_keep_missing_unknown_and_invalidate_conflicting_totals() {
        let d = device();
        let s = Selection {
            period: Period::Week,
            date: "2026-10-30".into(),
        };
        let r = range(&s, now()).unwrap();
        let row = json!({"did":"fixture","key":"prop.6.2","time":r.start,"value":"[150]"});
        let report = parse_statistics(std::slice::from_ref(&row), &d, s.clone(), r);
        assert_eq!(report.total_ml, Some(150));
        assert_eq!(report.points[1].volume_ml, None);
        let mut bad = row.clone();
        bad["value"] = json!("[160]");
        let report = parse_statistics(&[row, bad], &d, s.clone(), range(&s, now()).unwrap());
        assert_eq!(report.total_ml, None);
        assert_eq!(report.points[0].volume_ml, None);
        assert!(!report.warnings.is_empty())
    }
}
