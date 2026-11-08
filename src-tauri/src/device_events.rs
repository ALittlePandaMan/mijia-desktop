//! Standard plugin 18734/18740 -> 16538 -> SDK getDeviceData(type=event).
//! Notify-only arguments are event payload fields, never polled properties.
use crate::{
    capabilities::{resolve_device_capabilities, CapabilityEvent},
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel},
};
use chrono::{Days, Local, NaiveDate, TimeZone};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Argument {
    pub name: String,
    pub label: String,
    pub value: Value,
    pub display: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub id: String,
    pub time: u64,
    pub role: String,
    pub label: String,
    pub arguments: Vec<Argument>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Page {
    pub did: String,
    pub date: String,
    pub records: Vec<Record>,
    pub next_cursor: Option<String>,
    pub complete: bool,
    pub errors: Vec<String>,
    pub rejected: usize,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Cursor {
    did: String,
    date: String,
    before: u64,
    seen: Vec<String>,
    #[serde(default)]
    incomplete: bool,
}
fn bounds(date: &str) -> Result<(u64, u64)> {
    let day = NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|_| AppError::invalid("请选择有效日期。"))?;
    let today = Local::now().date_naive();
    if day.format("%Y-%m-%d").to_string() != date
        || day > today
        || day
            < today
                .checked_sub_days(Days::new(366))
                .ok_or_else(AppError::protocol)?
    {
        return Err(AppError::invalid("请选择最近一年内的日期。"));
    }
    let start = Local
        .from_local_datetime(&day.and_hms_opt(0, 0, 0).ok_or_else(AppError::protocol)?)
        .earliest()
        .ok_or_else(AppError::protocol)?
        .timestamp();
    let next = day.succ_opt().ok_or_else(AppError::protocol)?;
    let end = Local
        .from_local_datetime(&next.and_hms_opt(0, 0, 0).ok_or_else(AppError::protocol)?)
        .earliest()
        .ok_or_else(AppError::protocol)?
        .timestamp()
        - 1;
    Ok((
        u64::try_from(start).map_err(|_| AppError::protocol())?,
        u64::try_from(end)
            .map_err(|_| AppError::protocol())?
            .min(epoch_secs()),
    ))
}
fn label(name: &str) -> &str {
    match name {
        "lock-event" => "门锁记录",
        "exception-occurred" => "异常告警",
        "door-state" => "门状态",
        "doorbell-ring" => "门铃响铃",
        "someone-at-the-door" => "门前停留",
        "someone-passed-by" => "有人经过",
        "clean-remind" => "清洁提醒",
        "cooking-finished" | "cookfinish" | "cookfinish-right" | "wash-finished" => "运行完成",
        "falsefire-left" | "falsefire-right" => "熄火告警",
        "cookstar-left" | "cookstar-right" => "开始使用",
        "cookoff-left" | "cookoff-right" => "停止使用",
        _ => "设备事件",
    }
}
fn parse(
    row: &Value,
    binding: &CapabilityEvent,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    start: u64,
    end: u64,
) -> Option<Record> {
    let key = format!("{}.{}", binding.siid, binding.eiid);
    if row
        .get("did")
        .is_some_and(|v| id(v) != device.control_did())
        || row.get("uid").is_some_and(|v| id(v) != owner)
        || row["key"] != key
        || row["type"] != "event"
    {
        return None;
    }
    let time = row["time"].as_u64().filter(|t| *t >= start && *t <= end)?;
    let body = match &row["value"] {
        Value::String(s) if s.len() <= 65536 => serde_json::from_str::<Value>(s).ok()?,
        Value::Array(_) => row["value"].clone(),
        _ => return None,
    };
    let values = body.as_array()?;
    if values.len() != binding.arguments.len() {
        return None;
    }
    let service = panel.services.iter().find(|s| s.siid == binding.siid)?;
    let mut args = Vec::new();
    let mut seen = HashSet::new();
    for v in values {
        let piid = v["piid"].as_u64().and_then(|n| u32::try_from(n).ok())?;
        if !binding.arguments.contains(&piid) || !seen.insert(piid) {
            return None;
        }
        let prop = service.properties.iter().find(|p| p.piid == piid)?;
        let value = v.get("value")?;
        crate::spec::validate_value(prop, value).ok()?;
        let display = prop
            .value_list
            .as_ref()
            .and_then(|list| list.iter().find(|i| i.value == *value))
            .map(|i| i.description.clone())
            .unwrap_or_else(|| {
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            });
        if ![
            "operation-position",
            "operation-method",
            "lock-action",
            "operation-id",
            "abnormal-condition",
            "door-state",
        ]
        .contains(&prop.name.as_str())
        {
            continue;
        }
        args.push(Argument {
            name: prop.name.clone(),
            label: prop.description.clone(),
            value: value.clone(),
            display,
        });
    }
    let canonical = serde_json::to_vec(&(key, time, &body)).ok()?;
    let id = format!("{:x}", Sha256::digest(canonical));
    Some(Record {
        id,
        time,
        role: binding.role.clone(),
        label: label(&binding.name).into(),
        arguments: args,
    })
}
pub async fn read(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    date: &str,
    cursor: Option<&str>,
) -> Result<Page> {
    if panel.did != device.did || panel.model != device.model || device.split_route.is_some() {
        return Err(AppError::invalid("设备事件上下文不匹配。"));
    }
    let (start, mut end) = bounds(date)?;
    let mut prior = HashSet::new();
    let mut incomplete = false;
    if let Some(raw) = cursor {
        if raw.len() > 100000 {
            return Err(AppError::invalid("记录游标无效。"));
        }
        let c: Cursor =
            serde_json::from_str(raw).map_err(|_| AppError::invalid("记录游标无效。"))?;
        if c.did != device.did
            || c.date != date
            || c.before < start
            || c.before > end
            || c.seen.len() > 1000
            || c.seen
                .iter()
                .any(|s| s.len() != 64 || !s.bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(AppError::invalid("记录游标与当前设备或日期不匹配。"));
        }
        end = c.before;
        prior.extend(c.seen);
        incomplete = c.incomplete;
    }
    let bindings = resolve_device_capabilities(panel).events;
    if bindings.is_empty() || bindings.len() > 32 {
        return Err(AppError::new(
            "unsupported",
            "此设备没有已接入的事件记录。",
            false,
        ));
    }
    let mut page = Page {
        did: device.did.clone(),
        date: date.into(),
        records: Vec::new(),
        next_cursor: None,
        complete: true,
        errors: Vec::new(),
        rejected: 0,
    };
    let mut full = false;
    let mut seen = HashSet::new();
    for binding in bindings {
        match cloud
            .device_event_rows(
                device,
                owner,
                &format!("{}.{}", binding.siid, binding.eiid),
                start,
                end,
            )
            .await
        {
            Ok(rows) => {
                full |= rows.len() >= 1000;
                if rows.len() >= 1000 && rows.iter().all(|r| r["time"].as_u64() == Some(end)) {
                    incomplete = true;
                }
                for row in rows {
                    match parse(&row, &binding, device, owner, panel, start, end) {
                        Some(r) if seen.insert(r.id.clone()) && !prior.contains(&r.id) => {
                            page.records.push(r)
                        }
                        Some(_) => (),
                        None => page.rejected += 1,
                    }
                }
            }
            Err(e) => {
                page.complete = false;
                page.errors.push(e.message);
            }
        }
    }
    page.records
        .sort_by(|a, b| b.time.cmp(&a.time).then_with(|| a.id.cmp(&b.id)));
    let has_more = page.records.len() > 200 || full;
    page.records.truncate(200);
    if has_more {
        page.complete = false;
        if let Some(last) = page.records.last() {
            let mut ids: Vec<String> = if last.time == end {
                prior.into_iter().collect()
            } else {
                vec![]
            };
            ids.extend(
                page.records
                    .iter()
                    .filter(|r| r.time == last.time)
                    .map(|r| r.id.clone()),
            );
            ids.sort();
            ids.dedup();
            if ids.len() <= 1000 {
                page.next_cursor = Some(
                    serde_json::to_string(&Cursor {
                        did: device.did.clone(),
                        date: date.into(),
                        before: last.time,
                        seen: ids,
                        incomplete: incomplete || page.rejected > 0 || !page.errors.is_empty(),
                    })
                    .map_err(|_| AppError::protocol())?,
                );
            }
        }
    }
    if page.rejected > 0 || incomplete {
        page.complete = false;
    }
    Ok(page)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Device, DevicePanel, CapabilityEvent) {
        let d:Device=serde_json::from_value(json!({"did":"fixture","name":"fixture","model":"lumi.lock.mcn002","online":true,"roomId":"","roomName":""})).unwrap();
        let raw: Value =
            serde_json::from_str(include_str!("fixtures/catalog/lock--lumi.lock.mcn002.json"))
                .unwrap();
        let p = crate::spec::parse_panel(&d, &raw).unwrap();
        let e = resolve_device_capabilities(&p)
            .events
            .into_iter()
            .find(|e| e.name == "lock-event")
            .unwrap();
        (d, p, e)
    }
    #[test]
    fn event_only_arguments_are_read_without_property_poll_permissions() {
        let (d, p, e) = fixture();
        let service = p.services.iter().find(|s| s.siid == e.siid).unwrap();
        let values:Vec<Value>=e.arguments.iter().map(|id|{let prop=service.properties.iter().find(|p|p.piid==*id).unwrap();json!({"piid":id,"value":prop.value_list.as_ref().map(|l|l[0].value.clone()).unwrap_or(json!(10))})}).collect();
        let mut row = json!({"did":"fixture","uid":"owner","key":format!("{}.{}",e.siid,e.eiid),"type":"event","time":100,"value":serde_json::to_string(&values).unwrap()});
        let record = parse(&row, &e, &d, "owner", &p, 0, 200).unwrap();
        assert_eq!(record.arguments.len(), e.arguments.len() - 1);
        row["did"] = json!("other");
        assert!(parse(&row, &e, &d, "owner", &p, 0, 200).is_none());
        row["did"] = json!("fixture");
        row["uid"] = json!("other");
        assert!(parse(&row, &e, &d, "owner", &p, 0, 200).is_none());
    }
    #[test]
    fn malformed_dates_and_event_payloads_fail_closed() {
        assert!(bounds("2026-02-30").is_err());
        assert!(bounds("2099-01-01").is_err());
        let (d, p, e) = fixture();
        for value in [
            json!("garbage"),
            json!([]),
            json!([{ "piid":999,"value":0}]),
        ] {
            let r = json!({"key":format!("{}.{}",e.siid,e.eiid),"type":"event","time":100,"value":value});
            assert!(parse(&r, &e, &d, "owner", &p, 0, 200).is_none());
        }
    }
}
