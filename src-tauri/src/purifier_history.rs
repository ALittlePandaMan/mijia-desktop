//! Vendor 1014586 v39, 11813/11861/11885/10499: event 8.1 and prop.8.2
//! aggregates. Read-only. Current properties never substitute for this data.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel},
    purifier,
};
use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Period {
    Week,
    Month,
    Year,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub period: Period,
    pub date: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "scope", rename_all = "lowercase", deny_unknown_fields)]
pub enum RecordQuery {
    Latest { before: Option<u64> },
    Day { date: String, before: Option<u64> },
    Month { date: String, before: Option<u64> },
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub time: u64,
    pub seconds: u32,
    pub volume_ml: u32,
    pub tds: Vec<u32>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPage {
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
pub struct Point {
    pub time: u64,
    pub label: String,
    pub volume_ml: Option<u64>,
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
    #[serde(default)]
    pub week_total_ml: Option<u64>,
    pub warnings: Vec<String>,
}
struct Range {
    start: u64,
    end: u64,
    kind: &'static str,
    points: Vec<Point>,
}
fn invalid() -> AppError {
    AppError::invalid("请选择2023年至今的有效净水器记录日期。")
}
fn midnight<T: TimeZone>(now: &DateTime<T>, day: NaiveDate) -> Result<u64> {
    now.timezone()
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or_else(invalid)?)
        .earliest()
        .and_then(|t| u64::try_from(t.timestamp()).ok())
        .ok_or_else(invalid)
}
fn range<T: TimeZone>(selection: &Selection, now: DateTime<T>) -> Result<Range> {
    let date = NaiveDate::parse_from_str(&selection.date, "%Y-%m-%d").map_err(|_| invalid())?;
    let today = now.date_naive();
    // DefaultModelConfig 10580 + model override 10598, merged by 10577:
    // Calendar 11903 uses releaseYear, not the unused rolling minDate state.
    let valid = date.year() >= 2023;
    if date.format("%Y-%m-%d").to_string() != selection.date || !valid || date > today {
        return Err(invalid());
    }
    let (first, next, kind) = match selection.period {
        Period::Week => {
            let start = date
                .checked_sub_days(Days::new(date.weekday().num_days_from_monday() as u64))
                .ok_or_else(invalid)?;
            (
                start,
                start.checked_add_days(Days::new(7)).ok_or_else(invalid)?,
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
        Period::Year => {
            let first = NaiveDate::from_ymd_opt(date.year(), 1, 1).ok_or_else(invalid)?;
            (
                first,
                NaiveDate::from_ymd_opt(date.year() + 1, 1, 1).ok_or_else(invalid)?,
                "stat_month_v3",
            )
        }
    };
    let mut day = first;
    let mut points = Vec::new();
    while day < next {
        points.push(Point {
            time: midnight(&now, day)?,
            label: if selection.period == Period::Year {
                format!("{}月", day.month())
            } else {
                format!("{}/{}", day.month(), day.day())
            },
            volume_ml: None,
        });
        day = if selection.period == Period::Year {
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
    device.model == purifier::MODEL
        && device.did == panel.did
        && device.model == panel.model
        && device.split_route.is_none()
        && panel.unsupported_reason.is_none()
        && [
            (1, "water-production-time"),
            (2, "pure-water-output"),
            (3, "statistical-tds-out"),
        ]
        .iter()
        .all(|(piid, name)| {
            panel.services.iter().any(|s| {
                s.siid == 8
                    && s.name == "water-use-details"
                    && s.properties.iter().any(|p| {
                        p.piid == *piid && p.name == *name && p.access.iter().any(|a| a == "read")
                    })
            })
        })
}
fn payload(value: &Value) -> Option<Value> {
    match value {
        Value::String(s) if s.len() <= 65536 => serde_json::from_str(s).ok(),
        Value::Array(_) => Some(value.clone()),
        _ => None,
    }
}
fn row_identity(row: &Value, did: &str, owner: Option<&str>) -> bool {
    row.get("did").is_none_or(|v| id(v) == did)
        && owner.is_none_or(|owner| row.get("uid").is_none_or(|v| id(v) == owner))
}
fn record(row: &Value, did: &str, owner: &str, start: u64, end: u64) -> Option<Record> {
    let time = row["time"].as_u64()?;
    if !row_identity(row, did, Some(owner))
        || row["key"] != "8.1"
        || row["type"] != "event"
        || time < start
        || time > end
    {
        return None;
    }
    let data = payload(&row["value"])?;
    let fields = data.as_array()?;
    if fields.len() > 258 {
        return None;
    }
    let one = |piid: u64, max: u64| -> Option<u32> {
        let rows = fields
            .iter()
            .filter(|v| v["piid"].as_u64() == Some(piid))
            .collect::<Vec<_>>();
        if rows.len() != 1 {
            return None;
        }
        let n = rows[0]["value"].as_u64()?;
        if n > max {
            return None;
        }
        u32::try_from(n).ok()
    };
    let seconds = one(1, u32::MAX as u64)?;
    let volume_ml = one(2, 1_000_000_000)?;
    let tds = fields
        .iter()
        .filter(|v| v["piid"] == 3)
        .map(|v| v["value"].as_u64().filter(|n| *n <= 1000).map(|n| n as u32))
        .collect::<Option<Vec<_>>>()?;
    let identity = serde_json::to_vec(&(time, &data)).ok()?;
    let id = format!("{:x}", Sha256::digest(identity));
    Some(Record {
        id,
        time,
        seconds,
        volume_ml,
        tds,
    })
}
fn parse_records(rows: &[Value], device: &Device, owner: &str, start: u64, end: u64) -> RecordPage {
    let mut records = Vec::new();
    let mut seen = HashSet::new();
    let mut zero = 0;
    let mut rejected = 0;
    for row in rows {
        match record(row, device.control_did(), owner, start, end) {
            Some(r) if r.seconds == 0 || r.volume_ml == 0 => zero += 1,
            Some(r) if seen.insert(r.id.clone()) => records.push(r),
            Some(_) => {}
            None => rejected += 1,
        }
    }
    records.sort_by(|a, b| b.time.cmp(&a.time).then(a.id.cmp(&b.id)));
    let next = rows
        .iter()
        .filter_map(|r| r["time"].as_u64())
        .min()
        .filter(|t| rows.len() >= 1000 && *t > start && *t < end);
    let mut warnings = Vec::new();
    if rejected > 0 {
        warnings.push(format!("{}条记录格式或身份不匹配，未用于绘图。", rejected));
    }
    if rows.len() >= 1000 && next.is_none() {
        warnings.push("记录分页未能继续，当前列表可能不完整。".into());
    }
    RecordPage {
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
fn record_range<T: TimeZone>(query: RecordQuery, now: DateTime<T>) -> Result<(u64, u64)> {
    let today = now.date_naive();
    let (date, monthly, before) = match query {
        RecordQuery::Latest { before } => (None, false, before),
        RecordQuery::Day { date, before } => (Some(date), false, before),
        RecordQuery::Month { date, before } => (Some(date), true, before),
    };
    let (start, end) = if let Some(date) = date {
        let day = NaiveDate::parse_from_str(&date, "%Y-%m-%d").map_err(|_| invalid())?;
        let minimum = NaiveDate::from_ymd_opt(2023, 1, 1).ok_or_else(invalid)?;
        if day.format("%Y-%m-%d").to_string() != date || day < minimum || day > today {
            return Err(invalid());
        }
        let first = if monthly {
            day.with_day(1).ok_or_else(invalid)?
        } else {
            day
        };
        let next = if monthly {
            first.checked_add_months(Months::new(1))
        } else {
            first.checked_add_days(Days::new(1))
        }
        .ok_or_else(invalid)?;
        (
            midnight(&now, first)?,
            midnight(&now, next)?
                .saturating_sub(1)
                .min(now.timestamp() as u64),
        )
    } else {
        let first = today
            .with_day(1)
            .and_then(|d| d.checked_sub_months(Months::new(11)))
            .ok_or_else(invalid)?;
        (midnight(&now, first)?, now.timestamp() as u64)
    };
    let query_end = before.unwrap_or(end);
    if query_end < start || query_end > end {
        return Err(invalid());
    }
    Ok((start, query_end))
}
pub async fn load_records(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    query: RecordQuery,
) -> Result<RecordPage> {
    if !supported(device, panel) {
        return Err(AppError::new(
            "unsupported",
            "此型号的净水器历史绑定尚未确认。",
            false,
        ));
    }
    let (start, query_end) = record_range(query, Local::now())?;
    if start == query_end {
        return Ok(parse_records(&[], device, owner, start, query_end));
    }
    let rows = cloud
        .purifier_records(device, owner, start, query_end)
        .await?;
    Ok(parse_records(&rows, device, owner, start, query_end))
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
            "此型号的净水器统计绑定尚未确认。",
            false,
        ));
    }
    let range = range(&selection, Local::now())?;
    let (rows, weekly) = tokio::join!(
        cloud.purifier_statistics(device, range.kind, range.start, range.end),
        async {
            if selection.period == Period::Week {
                Some(
                    cloud
                        .purifier_statistics(device, "stat_week_v3", range.start, range.end)
                        .await,
                )
            } else {
                None
            }
        }
    );
    let mut report = parse_statistics(&rows?, device, selection, range);
    if let Some(weekly) = weekly {
        match weekly {
            Err(e) if e.kind == "authExpired" => return Err(e),
            Ok(rows) => {
                let mut values = HashSet::new();
                let valid = rows.iter().all(|row| {
                    if !row_identity(row, device.control_did(), None)
                        || row.get("key").is_some_and(|k| k != "prop.8.2")
                        || row["time"].as_u64() != Some(report.start)
                    {
                        return false;
                    }
                    let Some(v) = payload(&row["value"]) else {
                        return false;
                    };
                    let Some(a) = v.as_array().filter(|a| a.len() == 1) else {
                        return false;
                    };
                    let Some(n) = a[0].as_u64().filter(|n| *n <= 9_007_199_254_740_991) else {
                        return false;
                    };
                    values.insert(n);
                    true
                });
                if valid && values.len() <= 1 {
                    report.week_total_ml = Some(values.into_iter().next().unwrap_or(0));
                } else {
                    report
                        .warnings
                        .push("本周汇总格式无法确认，主页周统计暂不可用。".into());
                }
            }
            Err(_) => report
                .warnings
                .push("本周汇总读取失败，主页周统计暂不可用。".into()),
        }
    }
    Ok(report)
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
            if !row_identity(row, device.control_did(), None) {
                return None;
            }
            if row.get("key").is_some_and(|k| k != "prop.8.2") {
                return None;
            }
            let time = row["time"].as_u64()?;
            if !range.points.iter().any(|p| p.time == time) {
                return None;
            }
            let value = payload(&row["value"])?;
            let a = value.as_array()?;
            if a.len() != 1 {
                return None;
            }
            let ml = a[0].as_u64()?;
            if ml > 9_007_199_254_740_991 {
                return None;
            }
            Some((time, ml))
        })();
        if let Some((time, ml)) = parsed {
            if ambiguous.contains(&time) {
                continue;
            }
            if let Some(previous) = values.get(&time) {
                if *previous != ml {
                    values.remove(&time);
                    ambiguous.insert(time);
                    rejected += 1;
                }
            } else {
                values.insert(time, ml);
            }
        } else {
            rejected += 1;
        }
    }
    for p in &mut range.points {
        p.volume_ml = values.get(&p.time).copied();
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
        week_total_ml: None,
        warnings: if rejected > 0 {
            vec![format!("{}条统计数据未通过验证，合计暂不可用。", rejected)]
        } else {
            vec![]
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::Timelike;
    use serde_json::json;
    #[test]
    fn calendar_periods_use_monday_and_real_months() {
        let now = chrono::FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 30, 12, 0, 0)
            .unwrap();
        let r = range(
            &Selection {
                period: Period::Week,
                date: "2026-10-30".into(),
            },
            now,
        )
        .unwrap();
        assert_eq!(r.points.len(), 7);
        assert_eq!(r.points[0].label, "10/26");
        let m = range(
            &Selection {
                period: Period::Month,
                date: "2026-02-28".into(),
            },
            now,
        )
        .unwrap();
        assert_eq!(m.points.len(), 28);
        let y = range(
            &Selection {
                period: Period::Year,
                date: "2026-10-30".into(),
            },
            now,
        )
        .unwrap();
        assert_eq!(y.points.len(), 12);
        assert!(range(
            &Selection {
                period: Period::Week,
                date: "2026-10-31".into()
            },
            now
        )
        .is_err());
    }
    #[test]
    fn event_points_keep_the_order_and_bind_by_piid() {
        let row = json!({"did":"d","uid":"u","time":120,"key":"8.1","type":"event","value":"[{\"piid\":2,\"value\":1647},{\"piid\":3,\"value\":4},{\"piid\":1,\"value\":39},{\"piid\":3,\"value\":12},{\"piid\":3,\"value\":4}]"});
        let r = record(&row, "d", "u", 100, 150).unwrap();
        assert_eq!(r.tds, [4, 12, 4]);
        assert_eq!(r.seconds, 39);
        assert_eq!(r.volume_ml, 1647);
        assert!(record(&row, "other", "u", 100, 150).is_none());
        assert!(record(&row, "d", "other", 100, 150).is_none());
        let mut bad = row.clone();
        bad["value"] = json!([{"piid":1,"value":30},{"piid":1,"value":35},{"piid":2,"value":300}]);
        assert!(record(&bad, "d", "u", 100, 150).is_none());
    }
    fn device() -> Device {
        serde_json::from_value(json!({"did":"d","model":purifier::MODEL,"name":"fixture","online":true,"roomId":"","roomName":""})).unwrap()
    }
    #[test]
    fn duplicates_do_not_invent_totals_or_choose_an_arbitrary_bucket() {
        let now = chrono::FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 30, 12, 0, 0)
            .unwrap();
        let selection = Selection {
            period: Period::Week,
            date: "2026-10-30".into(),
        };
        let r = range(&selection, now).unwrap();
        let time = r.points[0].time;
        let parsed = parse_statistics(
            &[
                json!({"time":time,"value":"[1000]"}),
                json!({"time":time,"value":"[2000]"}),
            ],
            &device(),
            selection,
            r,
        );
        assert_eq!(parsed.points[0].volume_ml, None);
        assert_eq!(parsed.total_ml, None);
        assert!(!parsed.warnings.is_empty());
    }
    #[test]
    fn calendar_minimum_uses_the_models_release_year() {
        let now = chrono::FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 30, 12, 0, 0)
            .unwrap();
        assert!(range(
            &Selection {
                period: Period::Month,
                date: "2023-01-01".into()
            },
            now
        )
        .is_ok());
        assert!(range(
            &Selection {
                period: Period::Year,
                date: "2023-01-01".into()
            },
            now
        )
        .is_ok());
        assert!(range(
            &Selection {
                period: Period::Week,
                date: "2022-12-31".into()
            },
            now
        )
        .is_err());
        assert!(record_range(
            RecordQuery::Month {
                date: "2023-01-01".into(),
                before: None
            },
            now
        )
        .is_ok());
        assert!(record_range(
            RecordQuery::Day {
                date: "2022-12-31".into(),
                before: None
            },
            now
        )
        .is_err());
        let midnight = now
            .with_hour(0)
            .unwrap()
            .with_minute(0)
            .unwrap()
            .with_second(0)
            .unwrap();
        let (start, end) = record_range(
            RecordQuery::Day {
                date: "2026-10-30".into(),
                before: None,
            },
            midnight,
        )
        .unwrap();
        assert_eq!(start, end);
    }
    #[test]
    fn zero_records_are_filtered_but_bad_identity_and_pagination_remain_explicit() {
        let zero = json!({"did":"d","uid":"u","key":"8.1","type":"event","time":120,"value":[{"piid":1,"value":0},{"piid":2,"value":300}]});
        let wrong = json!({"did":"wrong","uid":"u","key":"8.1","type":"event","time":120,"value":[{"piid":1,"value":30},{"piid":2,"value":300}]});
        let page = parse_records(&[zero, wrong], &device(), "u", 100, 150);
        assert_eq!(page.ignored_zero, 1);
        assert_eq!(page.rejected, 1);
        assert!(page.records.is_empty());
        let row = json!({"did":"d","uid":"u","key":"8.1","type":"event","time":120,"value":[{"piid":1,"value":30},{"piid":2,"value":300},{"piid":3,"value":0}]});
        let page = parse_records(&vec![row.clone(); 1000], &device(), "u", 100, 150);
        assert_eq!(page.records.len(), 1);
        assert_eq!(page.records[0].tds, [0]);
        assert_eq!(page.next_before, Some(120));
        let exhausted = parse_records(&vec![row; 1000], &device(), "u", 100, 120);
        assert_eq!(exhausted.next_before, None);
        assert!(!exhausted.warnings.is_empty());
    }
}
