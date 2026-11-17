//! Read-only standard outlet statistics. No timer or power writes.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{
        epoch_secs, id, Device, DevicePanel, EnergyPeriod, EnergyPoint, EnergyReport,
        EnergySelection, EnergySummary,
    },
};
use chrono::{DateTime, Datelike, Days, Local, Months, NaiveDate, TimeZone};
use serde_json::Value;
use std::collections::BTreeMap;

pub fn supported(device: &Device, panel: &DevicePanel) -> bool {
    device.did == panel.did
        && device.model == panel.model
        && panel.unsupported_reason.is_none()
        && device.split_route.is_none()
        && panel.spec_type.as_deref().is_some_and(|t| {
            t.starts_with("urn:miot-spec-v2:device:outlet:")
                || (device.model == "lumi.acpartner.mcn02"
                    && t.starts_with("urn:miot-spec-v2:device:air-conditioner:"))
        })
        && scale(device, panel).is_some()
        && panel.services.iter().any(|s| {
            s.name == "power-consumption"
                && s.properties.iter().any(|p| {
                    p.name == "electric-power"
                        && p.unit.as_deref() == Some("watt")
                        && p.access.iter().any(|a| a == "read")
                })
        })
}
fn scale(device: &Device, panel: &DevicePanel) -> Option<f64> {
    if device.model == "lumi.acpartner.mcn02" {
        return Some(1000.0);
    }
    let prop = panel
        .services
        .iter()
        .filter(|s| s.name == "power-consumption")
        .flat_map(|s| &s.properties)
        .find(|p| p.name == "power-consumption" && p.access.iter().any(|a| a == "read"))?;
    // APK standard plugin 14846: these model rules precede declared units.
    // qmi.psv3 uses that plugin's default (unscaled) statistic, confirmed by
    // live daily rows. This is not a conversion of its unitless live counter.
    match device.model.as_str() {
        "cuco.plug.cp1m" | "cuco.plug.cp1md" => Some(1000.0),
        "cuco.plug.cp2" | "cuco.plug.cp2d" | "cuco.plug.v3" | "zimi.plug.zncz01" => Some(100.0),
        "chuangmi.plug.212a01" => Some(1_000_000.0),
        "qmi.plug.psv3" => Some(1.0),
        _ => match prop.unit.as_deref() {
            Some("kilowatt-hour" | "kWh") => Some(1.0),
            Some("watt-hour" | "Wh") => Some(1000.0),
            _ => None,
        },
    }
}

fn statistics_key(device: &Device, prop: &crate::models::Property) -> String {
    // This prefix is part of the verified vendor contract, not UI input.
    let prefix = if device.model == "chuangmi.plug.212a01" {
        "prop."
    } else {
        ""
    };
    format!("{prefix}{}.{}", prop.siid, prop.piid)
}
struct Window {
    start: u64,
    end: u64,
    limit: u32,
    monthly: bool,
}
fn window<T: TimeZone>(selection: &EnergySelection, now: &DateTime<T>) -> Result<Window> {
    let invalid = || AppError::invalid("请选择最近一年内的有效统计日期。");
    let selected = NaiveDate::parse_from_str(&selection.date, "%Y-%m-%d").map_err(|_| invalid())?;
    if selected.format("%Y-%m-%d").to_string() != selection.date {
        return Err(invalid());
    }
    let today = now.date_naive();
    let min = today
        .with_year(today.year() - 1)
        .unwrap_or_else(|| NaiveDate::from_ymd_opt(today.year() - 1, 3, 1).unwrap());
    let month = selected.with_day(1).ok_or_else(invalid)?;
    let last = month
        .checked_add_months(Months::new(1))
        .and_then(|date| date.pred_opt())
        .ok_or_else(invalid)?;
    let (first, last, limit, monthly) = match selection.period {
        EnergyPeriod::Week if selected >= min && selected <= today => (
            selected
                .checked_sub_days(Days::new(6))
                .ok_or_else(invalid)?,
            selected,
            7,
            false,
        ),
        EnergyPeriod::Month if last >= min && month <= today => {
            if month == today.with_day(1).ok_or_else(invalid)? && today != last {
                (
                    today.checked_sub_days(Days::new(29)).ok_or_else(invalid)?,
                    today,
                    30,
                    false,
                )
            } else {
                (month, last, last.day(), false)
            }
        }
        EnergyPeriod::Year if selected == today => (
            today
                .with_day(1)
                .and_then(|date| date.checked_sub_months(Months::new(11)))
                .ok_or_else(invalid)?,
            today,
            12,
            true,
        ),
        _ => return Err(invalid()),
    };
    let local = |date: NaiveDate, end: bool| -> Result<u64> {
        let at = if end {
            date.and_hms_opt(23, 59, 59)
        } else {
            date.and_hms_opt(0, 0, 0)
        }
        .ok_or_else(invalid)?;
        now.timezone()
            .from_local_datetime(&at)
            .earliest()
            .and_then(|dt| u64::try_from(dt.timestamp()).ok())
            .ok_or_else(invalid)
    };
    Ok(Window {
        start: local(first, false)?,
        end: local(last, true)?,
        limit,
        monthly,
    })
}

pub fn validate(selection: &EnergySelection) -> Result<()> {
    window(selection, &Local::now()).map(|_| ())
}

fn points(rows: &[Value], window: &Window, scale: f64) -> (Vec<EnergyPoint>, bool) {
    let mut map = BTreeMap::new();
    let mut complete = true;
    for row in rows {
        let point = (|| {
            let time = row["time"]
                .as_u64()
                .filter(|time| *time >= window.start && *time <= window.end)?;
            let value = row["value"].as_str().filter(|value| value.len() < 4096)?;
            let value: Value = serde_json::from_str(value).ok()?;
            let values = value.as_array().filter(|values| values.len() == 1)?;
            let value = values[0].as_f64().filter(|v| v.is_finite() && *v >= 0.0)? / scale;
            Some(EnergyPoint { time, value })
        })();
        if let Some(point) = point {
            if let Some(old) = map.get(&point.time) {
                if *old != Some(point.value) {
                    complete = false;
                    map.insert(point.time, None);
                }
            } else {
                map.insert(point.time, Some(point.value));
            }
        } else {
            complete = false;
        }
    }
    (
        map.into_iter()
            .filter_map(|(time, value)| value.map(|value| EnergyPoint { time, value }))
            .collect(),
        complete,
    )
}

fn switch_count(
    rows: &[Value],
    device: &Device,
    owner: &str,
    key: &str,
    start: u64,
    end: u64,
) -> Option<(u32, bool)> {
    if rows.len() >= 1000 {
        return None;
    }
    let mut records = BTreeMap::new();
    for row in rows {
        if id(&row["did"]) != device.control_did()
            || id(&row["uid"]) != owner
            || row["key"].as_str() != Some(key)
            || row["type"].as_str() != Some("prop")
        {
            return None;
        }
        let time = row["time"]
            .as_u64()
            .filter(|time| *time >= start && *time <= end)?;
        let value: Value = serde_json::from_str(row["value"].as_str()?).ok()?;
        let value = value.as_array().filter(|v| v.len() == 1)?[0].as_bool()?;
        if records.insert(time, value).is_some_and(|old| old != value) {
            return None;
        }
    }
    // Native filterContinuousPropValueLogs counts the first row and each change.
    let mut previous = None;
    let mut count = 0;
    for value in records.values().rev() {
        if previous != Some(*value) {
            count += 1;
            previous = Some(*value);
        }
    }
    Some((count, count > 20))
}

pub async fn load(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    selection: EnergySelection,
) -> Result<EnergyReport> {
    if !supported(device, panel) {
        return Err(AppError::new(
            "unsupported",
            "此设备的用电统计单位或协议尚未核实。",
            false,
        ));
    }
    let now = Local::now();
    let range = window(&selection, &now)?;
    let summary_range = window(
        &EnergySelection {
            period: EnergyPeriod::Month,
            date: now.format("%Y-%m-%d").to_string(),
        },
        &now,
    )?;
    // The native header uses the same month helper: rolling 30 days except
    // on the month's final day, when it covers that whole calendar month.
    let prop = panel
        .services
        .iter()
        .filter(|s| s.name == "power-consumption")
        .flat_map(|s| &s.properties)
        .find(|p| p.name == "power-consumption");
    let legacy = device.model == "lumi.acpartner.mcn02";
    let key = if legacy {
        "powerCost".into()
    } else {
        statistics_key(device, prop.ok_or_else(AppError::protocol)?)
    };
    let on = panel
        .services
        .iter()
        .filter(|s| s.name == "switch")
        .flat_map(|s| &s.properties)
        .find(|p| p.name == "on" && p.format == "bool");
    let today_start = now
        .timezone()
        .from_local_datetime(&now.date_naive().and_hms_opt(0, 0, 0).unwrap())
        .earliest()
        .ok_or_else(AppError::protocol)?
        .timestamp() as u64;
    let on_key = on.map(|p| format!("{}.{}", p.siid, p.piid));
    let counts = async {
        if device.model == "cuco.plug.v3" {
            if let Some(key) = &on_key {
                return cloud
                    .history_page(device, owner, key, today_start, epoch_secs())
                    .await
                    .map(Some);
            }
        }
        Ok(None)
    };
    let (daily, chart, counts) = tokio::join!(
        async {
            if legacy {
                cloud
                    .acpartner_statistics(
                        device,
                        false,
                        summary_range.start,
                        summary_range.end.saturating_add(86400),
                        summary_range.limit,
                    )
                    .await
            } else {
                cloud
                    .statistics(
                        device,
                        &key,
                        "stat_day_v3",
                        summary_range.start,
                        summary_range.end,
                        summary_range.limit,
                    )
                    .await
            }
        },
        async {
            if legacy {
                cloud
                    .acpartner_statistics(
                        device,
                        range.monthly,
                        range.start,
                        range.end.saturating_add(86400),
                        range.limit,
                    )
                    .await
            } else {
                cloud
                    .statistics(
                        device,
                        &key,
                        if range.monthly {
                            "stat_month_v3"
                        } else {
                            "stat_day_v3"
                        },
                        range.start,
                        range.end,
                        range.limit,
                    )
                    .await
            }
        },
        counts
    );
    if let Some(error) = [&daily, &chart]
        .iter()
        .find_map(|r| r.as_ref().err().filter(|e| e.kind == "authExpired"))
        .or_else(|| counts.as_ref().err().filter(|e| e.kind == "authExpired"))
    {
        return Err(error.clone());
    }
    let scale = scale(device, panel).ok_or_else(AppError::protocol)?;
    let (chart_points, complete, error) = match chart {
        Ok(rows) => {
            let (p, c) = points(&rows, &range, scale);
            (p, c, None)
        }
        Err(error) => (Vec::new(), false, Some(error)),
    };
    let mut warnings = Vec::new();
    let mut summary = EnergySummary {
        today: None,
        yesterday: None,
        month: None,
        switches: None,
        switches_more: false,
        complete: false,
    };
    if let Ok(rows) = daily {
        let (data, valid) = points(&rows, &summary_range, scale);
        let value = |date: NaiveDate| {
            data.iter()
                .find(|point| {
                    Local
                        .timestamp_opt(point.time as i64, 0)
                        .single()
                        .is_some_and(|time| time.date_naive() == date)
                })
                .map(|point| point.value)
        };
        summary.today = value(now.date_naive());
        summary.yesterday = value(now.date_naive() - Days::new(1));
        summary.month = (!data.is_empty()).then(|| data.iter().map(|point| point.value).sum());
        summary.complete = valid && data.len() == summary_range.limit as usize;
    }
    if let (Ok(Some(rows)), Some(key)) = (counts, on_key) {
        if let Some((count, more)) =
            switch_count(&rows, device, owner, &key, today_start, epoch_secs())
        {
            summary.switches = Some(count);
            summary.switches_more = more;
        }
    }
    if !summary.complete {
        warnings.push("近一月汇总未完整取回，仅合计已取得的记录。".into());
    }
    if device.model == "cuco.plug.v3" && summary.switches.is_none() {
        warnings.push("今日开关次数未完整取回。".into());
    }
    if !complete {
        warnings.push("当前图表未完整取回，请重试。".into());
    }
    Ok(EnergyReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        selection,
        start: range.start,
        end: range.end,
        points: chart_points,
        complete,
        error,
        summary,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;
    use serde_json::json;
    #[test]
    fn apk_vendor_scaling_takes_precedence_over_declared_units() {
        let mut device:Device=serde_json::from_value(json!({"did":"a","name":"outlet","model":"cuco.plug.cp2","online":true,"roomId":"r","roomName":"room"})).unwrap();
        let panel:DevicePanel=serde_json::from_value(json!({"did":"a","model":"cuco.plug.cp2","services":[{"siid":11,"name":"power-consumption","description":"energy","actions":[],"properties":[{"siid":11,"piid":1,"name":"power-consumption","description":"energy","format":"float","access":["read"],"unit":"kilowatt-hour"}]}]})).unwrap();
        assert_eq!(scale(&device, &panel), Some(100.0));
        device.model = "cuco.plug.v3".into();
        assert_eq!(scale(&device, &panel), Some(100.0));
    }
    #[test]
    fn verified_outlet_adapters_bind_actual_property_ids_and_units() {
        let mut device: Device = serde_json::from_value(json!({"did":"a","name":"outlet","model":"qmi.plug.psv3","online":true,"roomId":"r","roomName":"room"})).unwrap();
        let mut panel: DevicePanel = serde_json::from_value(json!({"did":"a","model":"qmi.plug.psv3","specType":"urn:miot-spec-v2:device:outlet:test","services":[{"siid":37,"name":"power-consumption","description":"energy","actions":[],"properties":[{"siid":37,"piid":9,"name":"power-consumption","description":"energy","format":"float","access":["read"]},{"siid":37,"piid":12,"name":"electric-power","description":"power","format":"float","access":["read"],"unit":"watt"}]}]})).unwrap();
        for (model, divisor, key) in [
            ("qmi.plug.psv3", 1.0, "37.9"),
            ("cuco.plug.cp1m", 1000.0, "37.9"),
            ("cuco.plug.cp1md", 1000.0, "37.9"),
            ("cuco.plug.cp2", 100.0, "37.9"),
            ("cuco.plug.cp2d", 100.0, "37.9"),
            ("zimi.plug.zncz01", 100.0, "37.9"),
            ("chuangmi.plug.212a01", 1_000_000.0, "prop.37.9"),
        ] {
            device.model = model.into();
            panel.model = model.into();
            assert!(supported(&device, &panel));
            assert_eq!(scale(&device, &panel), Some(divisor));
            assert_eq!(
                statistics_key(&device, &panel.services[0].properties[0]),
                key
            );
        }
        device.model = "other.plug.meter".into();
        panel.model = device.model.clone();
        assert!(!supported(&device, &panel));
        for (unit, divisor) in [
            ("kWh", 1.0),
            ("kilowatt-hour", 1.0),
            ("Wh", 1000.0),
            ("watt-hour", 1000.0),
        ] {
            panel.services[0].properties[0].unit = Some(unit.into());
            assert!(supported(&device, &panel));
            assert_eq!(scale(&device, &panel), Some(divisor));
        }
        panel.services[0].properties[0].access.clear();
        assert!(!supported(&device, &panel));
        panel.services[0].properties[0].access.push("read".into());
        panel.did = "other".into();
        assert!(!supported(&device, &panel));
    }
    fn now() -> DateTime<FixedOffset> {
        FixedOffset::east_opt(8 * 3600)
            .unwrap()
            .with_ymd_and_hms(2026, 10, 26, 20, 0, 0)
            .unwrap()
    }
    fn selection(period: EnergyPeriod, date: &str) -> EnergySelection {
        EnergySelection {
            period,
            date: date.into(),
        }
    }
    #[test]
    fn calendar_periods_and_validation_match_native_statistics() {
        let now = now();
        let month = window(&selection(EnergyPeriod::Month, "2026-10-01"), &now).unwrap();
        assert_eq!(month.limit, 30);
        let start = now.timezone().timestamp_opt(month.start as i64, 0).unwrap();
        assert_eq!(
            start.date_naive(),
            NaiveDate::from_ymd_opt(2026, 9, 27).unwrap()
        );
        let year = window(&selection(EnergyPeriod::Year, "2026-10-26"), &now).unwrap();
        assert_eq!(year.limit, 12);
        assert!(year.monthly);
        assert_eq!(
            now.timezone()
                .timestamp_opt(year.start as i64, 0)
                .unwrap()
                .date_naive(),
            NaiveDate::from_ymd_opt(2025, 11, 1).unwrap()
        );
        for date in ["2026-10-27", "2025-10-25", "2026-02-30", "2026-1-01"] {
            assert!(window(&selection(EnergyPeriod::Week, date), &now).is_err());
        }
        let leap = window(
            &selection(EnergyPeriod::Month, "2024-02-01"),
            &FixedOffset::east_opt(0)
                .unwrap()
                .with_ymd_and_hms(2024, 3, 1, 0, 0, 0)
                .unwrap(),
        )
        .unwrap();
        assert_eq!(leap.limit, 29);
        let month_end = now
            .timezone()
            .with_ymd_and_hms(2026, 10, 31, 20, 0, 0)
            .unwrap();
        assert_eq!(
            window(&selection(EnergyPeriod::Month, "2026-10-31"), &month_end)
                .unwrap()
                .limit,
            31
        );
    }
    #[test]
    fn statistics_are_numeric_arrays_with_scale_and_missing_preserved() {
        let range = Window {
            start: 100,
            end: 200,
            limit: 7,
            monthly: false,
        };
        let (points, valid) = points(
            &[
                json!({"time":101,"value":"[0]"}),
                json!({"time":102,"value":"[13]"}),
                json!({"time":103,"value":"[-1]"}),
                json!({"time":201,"value":"[5]"}),
                json!({"time":104,"value":"[1,2]"}),
            ],
            &range,
            100.0,
        );
        assert!(!valid);
        assert_eq!(points.len(), 2);
        assert_eq!(points[0].value, 0.0);
        assert_eq!(points[1].value, 0.13);
    }
    #[test]
    fn switch_count_deduplicates_consecutive_values_and_validates_ownership() {
        let device:Device=serde_json::from_value(json!({"did":"a","name":"outlet","model":"cuco.plug.v3","online":true,"roomId":"r","roomName":"room"})).unwrap();
        let rows:Vec<_>=[true,true,false,false,true].iter().enumerate().map(|(i,v)|json!({"did":"a","uid":"b","key":"2.1","type":"prop","time":101+i,"value":format!("[{v}]")})).collect();
        assert_eq!(
            switch_count(&rows, &device, "b", "2.1", 100, 200),
            Some((3, false))
        );
        assert_eq!(switch_count(&rows, &device, "other", "2.1", 100, 200), None);
    }
}
