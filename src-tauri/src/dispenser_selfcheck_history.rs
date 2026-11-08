//! Read-only gxj v29 self-check history (module 11759, event 7.1).
use crate::{
    cloud::Cloud,
    dispenser, dispenser_selfcheck,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel},
};
use chrono::{Datelike, Local, Months, TimeZone};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub time: u64,
    pub statuses: Vec<u8>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Records {
    pub did: String,
    pub records: Vec<Record>,
    pub rejected: usize,
    pub truncated: bool,
}
fn parse(rows: &[Value], device: &Device, owner: &str, start: u64, end: u64) -> Records {
    let mut records = Vec::new();
    let mut rejected = 0;
    for row in rows {
        let item = (|| {
            if row
                .get("did")
                .is_some_and(|v| id(v) != device.control_did())
                || row.get("uid").is_some_and(|v| id(v) != owner)
                || row["key"] != "7.1"
                || row["type"] != "event"
            {
                return None;
            }
            let time = row["time"].as_u64().filter(|v| *v >= start && *v <= end)?;
            let body = match &row["value"] {
                Value::String(s) if s.len() <= 65536 => serde_json::from_str::<Value>(s).ok()?,
                Value::Array(_) => row["value"].clone(),
                _ => return None,
            };
            let value = body.as_array()?.first()?.get("value")?.as_str()?;
            if value.is_empty() {
                return None;
            }
            let statuses = dispenser_selfcheck::parse(value)?;
            Some(Record { time, statuses })
        })();
        match item {
            Some(record) => records.push(record),
            None => rejected += 1,
        }
    }
    records.sort_by_key(|a| std::cmp::Reverse(a.time));
    Records {
        did: device.did.clone(),
        records,
        rejected,
        truncated: rows.len() >= 1000,
    }
}
pub async fn read(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
) -> Result<Records> {
    if device.model != dispenser::MODEL
        || device.did != panel.did
        || device.split_route.is_some()
        || !dispenser_selfcheck::supported(panel)
    {
        return Err(AppError::new(
            "unsupported",
            "此设备的自检事件绑定尚未核实。",
            false,
        ));
    }
    let now = Local::now();
    let day = now
        .date_naive()
        .with_day(1)
        .and_then(|d| d.checked_sub_months(Months::new(11)))
        .ok_or_else(AppError::protocol)?;
    let start = Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or_else(AppError::protocol)?)
        .earliest()
        .and_then(|t| u64::try_from(t.timestamp()).ok())
        .ok_or_else(AppError::protocol)?;
    let end = epoch_secs();
    if start >= end {
        return Err(AppError::protocol());
    }
    Ok(parse(
        &cloud
            .dispenser_selfcheck_records(device, start, end)
            .await?,
        device,
        owner,
        start,
        end,
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn only_valid_bound_events_are_rendered() {
        let device:Device=serde_json::from_value(json!({"did":"123","model":dispenser::MODEL,"online":true,"name":"d","roomId":"r","roomName":"r"})).unwrap();
        let rows = vec![
            json!({"did":"123","uid":"owner","key":"7.1","type":"event","time":100,"value":"[{\"value\":\"1,2,0\"}]"}),
            json!({"did":"other","key":"7.1","type":"event","time":101,"value":[{"value":"1"}]}),
            json!({"key":"7.1","type":"event","time":101,"value":[{"value":"5"}]}),
            json!({"key":"7.1","type":"event","time":101,"value":[{"value":""}]}),
        ];
        let result = parse(&rows, &device, "owner", 1, 200);
        assert_eq!(result.records.len(), 1);
        assert_eq!(result.records[0].statuses, vec![1, 2, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(result.rejected, 3);
    }
}
