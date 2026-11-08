//! Standard sensor cloud history with a separate verified t1/t2 hex adapter.
//! Never synchronizes BLE or writes cloud data.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{
        epoch_secs, id, Device, DevicePanel, HistoryChannel, HistoryPeriod, HistoryPoint,
        HistorySelection, Property, SensorHistory,
    },
};
use chrono::{Local, TimeZone, Timelike};
use serde_json::Value;
use std::collections::HashSet;
use tokio::time::{Duration, Instant};

#[derive(Default)]
struct Pages {
    rows: Vec<Value>,
    incomplete: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Encoding {
    LegacyHex,
    MiotNumber,
}

struct Binding<'a> {
    property: &'a Property,
    key: String,
    encoding: Encoding,
}

impl Binding<'_> {
    fn source(&self) -> &'static str {
        match self.encoding {
            Encoding::LegacyHex => "gatewayHex",
            Encoding::MiotNumber => "miotProperty",
        }
    }
}

fn bindings<'a>(device: &Device, panel: &'a DevicePanel) -> Option<[Binding<'a>; 2]> {
    if device.did != panel.did
        || device.model != panel.model
        || device.split_route.is_some()
        || panel.unsupported_reason.is_some()
    {
        return None;
    }
    let legacy = matches!(
        device.model.as_str(),
        "miaomiaoce.sensor_ht.t1" | "miaomiaoce.sensor_ht.t2"
    );
    if !legacy
        && !panel.spec_type.as_deref().is_some_and(|typ| {
            typ.starts_with("urn:miot-spec-v2:device:temperature-humidity-sensor:")
        })
    {
        return None;
    }
    let find = |name: &str, unit: &str| {
        let mut properties = panel
            .services
            .iter()
            .filter(|s| s.name == "temperature-humidity-sensor")
            .flat_map(|service| {
                service
                    .properties
                    .iter()
                    .filter(move |property| property.siid == service.siid)
            })
            .filter(|p| {
                p.name == name
                    && p.unit.as_deref() == Some(unit)
                    && p.siid > 0
                    && p.piid > 0
                    && p.access.iter().any(|a| a == "read")
                    && p.value_range.as_ref().is_none_or(|range| {
                        range.len() == 3
                            && range.iter().all(|value| value.is_finite())
                            && range[0] <= range[1]
                            && range[2] >= 0.0
                    })
                    && matches!(
                        p.format.as_str(),
                        "float"
                            | "int8"
                            | "int16"
                            | "int32"
                            | "int64"
                            | "uint8"
                            | "uint16"
                            | "uint32"
                            | "uint64"
                    )
            });
        let property = properties.next()?;
        properties.next().is_none().then_some(property)
    };
    let binding = |property: &'a Property, legacy_key: &str| Binding {
        property,
        // APK 10034 encodeIidsKey; MIID/split routes are excluded above.
        key: if legacy {
            legacy_key.into()
        } else {
            format!("{}.{}", property.siid, property.piid)
        },
        encoding: if legacy {
            Encoding::LegacyHex
        } else {
            Encoding::MiotNumber
        },
    };
    Some([
        binding(find("temperature", "celsius")?, "4100"),
        binding(find("relative-humidity", "percentage")?, "4102"),
    ])
}

pub fn supported(device: &Device, panel: &DevicePanel) -> bool {
    bindings(device, panel).is_some()
}

async fn pages(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    key: &str,
    start: u64,
    end: u64,
    budget: (usize, Instant),
) -> Result<Pages> {
    collect_pages(start, end, budget, |cursor| {
        cloud.history_page(device, owner, key, start, cursor)
    })
    .await
}

async fn collect_pages<F, Fut>(
    start: u64,
    end: u64,
    budget: (usize, Instant),
    mut fetch: F,
) -> Result<Pages>
where
    F: FnMut(u64) -> Fut,
    Fut: std::future::Future<Output = Result<Vec<Value>>>,
{
    let mut output = Pages::default();
    let mut cursor = end;
    let mut seen = HashSet::new();
    for _ in 0..budget.0 {
        let result = tokio::time::timeout_at(budget.1, fetch(cursor))
            .await
            .unwrap_or_else(|_| Err(AppError::new("network", "读取历史记录超时，请重试。", true)));
        let batch = match result {
            Ok(rows) => rows,
            Err(error) if error.kind == "authExpired" || output.rows.is_empty() => {
                return Err(error)
            }
            Err(_) => {
                output.incomplete = true;
                return Ok(output);
            }
        };
        let full = batch.len() >= 1000;
        let next = batch.iter().filter_map(|r| r["time"].as_u64()).min();
        output.rows.extend(batch);
        if !full {
            return Ok(output);
        }
        let Some(next) = next.filter(|next| *next > start && *next < cursor && seen.insert(*next))
        else {
            output.incomplete = true;
            return Ok(output);
        };
        cursor = next;
    }
    output.incomplete = true;
    Ok(output)
}

fn payload(
    row: &Value,
    did: &str,
    owner: &str,
    key: &str,
    start: u64,
    end: u64,
) -> Option<(u64, Value)> {
    if id(&row["did"]) != did || id(&row["uid"]) != owner || row["key"].as_str() != Some(key) {
        return None;
    }
    let time = row["time"]
        .as_u64()
        .filter(|time| *time > start && *time <= end)?;
    let value = row["value"].as_str().filter(|s| s.len() <= 16384)?;
    Some((time, serde_json::from_str(value).ok()?))
}

fn decode_hex(value: &Value, temperature: bool) -> Option<f64> {
    let text = value.as_array()?.first()?.as_str()?;
    if !matches!(text.len(), 2 | 4) || !text.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let low = u8::from_str_radix(&text[..2], 16).ok()?;
    let high = if text.len() == 4 {
        u8::from_str_radix(&text[2..], 16).ok()?
    } else {
        0
    };
    Some(if temperature {
        i16::from_le_bytes([low, high]) as f64 / 10.0
    } else {
        u16::from_le_bytes([low, high]) as f64 / 10.0
    })
}

fn decode_number(value: &Value) -> Option<f64> {
    let value = value.as_array()?.first()?;
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse::<f64>().ok())
        .filter(|v| v.is_finite())
}

fn hour_end<T: TimeZone>(time: u64, timezone: &T) -> Option<u64> {
    let local = timezone
        .timestamp_opt(i64::try_from(time).ok()?, 0)
        .single()?;
    Some(time.saturating_sub(u64::from(local.minute()) * 60 + u64::from(local.second())) + 3600)
}

struct ChannelInput<'a> {
    device: &'a Device,
    owner: &'a str,
    start: u64,
    end: u64,
    gateway_start: u64,
    per_day: bool,
}
fn channel(
    input: &ChannelInput<'_>,
    binding: &Binding<'_>,
    temperature: bool,
    common: &Result<Pages>,
    gateway: &Result<Pages>,
) -> HistoryChannel {
    let name = if temperature {
        "temperature"
    } else {
        "humidity"
    };
    let bounds = binding
        .property
        .value_range
        .as_ref()
        .filter(|range| range.len() == 3)
        .map(|range| (range[0], range[1]));
    let valid = |value: f64| {
        value.is_finite() && bounds.is_none_or(|(min, max)| value >= min && value <= max)
    };
    let mut points = Vec::new();
    let mut rejected = 0;
    if let Ok(pages) = common {
        for row in &pages.rows {
            let Some((time, data)) = payload(
                row,
                input.device.control_did(),
                input.owner,
                if input.per_day {
                    "history_per_day"
                } else {
                    "historykey"
                },
                input.start,
                input.end,
            ) else {
                rejected += 1;
                continue;
            };
            let (low, high) = if input.per_day && temperature {
                ("lowTemp", "highTemp")
            } else if input.per_day {
                ("lowHumi", "highHumi")
            } else if temperature {
                ("temperaturelow", "temperaturehigh")
            } else {
                ("lowHumidity", "highHumidity")
            };
            // A single-channel summary must not discard a valid record from
            // the other channel or make that other channel look malformed.
            if data.get(low).is_none() && data.get(high).is_none() {
                let known = if input.per_day {
                    ["lowTemp", "highTemp", "lowHumi", "highHumi"]
                } else {
                    [
                        "temperaturelow",
                        "temperaturehigh",
                        "lowHumidity",
                        "highHumidity",
                    ]
                };
                if !data
                    .as_object()
                    .is_some_and(|object| known.iter().any(|key| object.contains_key(*key)))
                {
                    rejected += 1;
                }
                continue;
            }
            if let (Some(low), Some(high)) = (data[low].as_f64(), data[high].as_f64()) {
                if valid(low) && valid(high) && low <= high {
                    points.push(HistoryPoint {
                        time,
                        low,
                        high,
                        gateway: false,
                        source: "cloudSummary".into(),
                        bucket_time: time,
                        state: "measured".into(),
                    });
                    continue;
                }
            }
            rejected += 1;
        }
    }
    if let Ok(pages) = gateway {
        let key = &binding.key;
        for row in &pages.rows {
            let Some((time, data)) = payload(
                row,
                input.device.control_did(),
                input.owner,
                key,
                input.gateway_start,
                input.end,
            ) else {
                rejected += 1;
                continue;
            };
            let value = match binding.encoding {
                Encoding::LegacyHex => decode_hex(&data, temperature),
                Encoding::MiotNumber => decode_number(&data),
            };
            if let Some((value, bucket_time)) = value
                .filter(|value| valid(*value))
                .zip(hour_end(time, &Local))
            {
                points.push(HistoryPoint {
                    time,
                    low: value,
                    high: value,
                    gateway: true,
                    source: binding.source().into(),
                    bucket_time,
                    state: "measured".into(),
                });
            } else {
                rejected += 1;
            }
        }
    }
    points.sort_by(|a, b| {
        a.time
            .cmp(&b.time)
            .then(a.source.cmp(&b.source))
            .then(a.low.total_cmp(&b.low))
            .then(a.high.total_cmp(&b.high))
    });
    points.dedup_by(|a, b| {
        a.time == b.time && a.low == b.low && a.high == b.high && a.source == b.source
    });
    let missing = common.is_err()
        || gateway.is_err()
        || rejected > 0
        || common.as_ref().is_ok_and(|p| p.incomplete)
        || gateway.as_ref().is_ok_and(|p| p.incomplete);
    let error = (points.is_empty() && missing).then(|| "历史记录暂时无法完整读取，请重试。".into());
    let completeness = if !missing {
        "complete"
    } else if points.is_empty() {
        "failed"
    } else {
        "partial"
    };
    HistoryChannel {
        name: name.into(),
        unit: if temperature { "℃" } else { "%" }.into(),
        points,
        error,
        complete: !missing,
        sources: vec!["cloudSummary".into(), binding.source().into()],
        completeness: completeness.into(),
    }
}

pub async fn load(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
) -> Result<SensorHistory> {
    let end = epoch_secs();
    load_window(
        cloud,
        device,
        owner,
        panel,
        (end.saturating_sub(30 * 3600), end, end),
        None,
    )
    .await
}

pub async fn load_detail(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    selection: HistorySelection,
) -> Result<SensorHistory> {
    let range = crate::history_range::for_selection(&selection)?;
    load_window(
        cloud,
        device,
        owner,
        panel,
        (range.start, range.end, range.reference_time),
        Some(selection),
    )
    .await
}

// Per-day summaries use the APK's <=50-day request windows. A shared deadline
// bounds all windows; acquired rows survive a later non-authentication failure.
async fn per_day_pages(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    start: u64,
    end: u64,
    deadline: Instant,
) -> Result<Pages> {
    let mut output = Pages::default();
    let mut cursor = start;
    while cursor < end {
        let until = end.min(cursor.saturating_add(50 * 86400));
        match pages(
            cloud,
            device,
            owner,
            "history_per_day",
            cursor.saturating_sub(1),
            until,
            (8, deadline),
        )
        .await
        {
            Ok(batch) => {
                output.rows.extend(batch.rows);
                output.incomplete |= batch.incomplete;
            }
            Err(error) if error.kind == "authExpired" || output.rows.is_empty() => {
                return Err(error)
            }
            Err(_) => {
                output.incomplete = true;
                break;
            }
        }
        if Instant::now() >= deadline {
            output.incomplete = true;
            break;
        }
        cursor = until;
    }
    Ok(output)
}

async fn load_window(
    cloud: &Cloud,
    device: &Device,
    owner: &str,
    panel: &DevicePanel,
    window: (u64, u64, u64),
    selection: Option<HistorySelection>,
) -> Result<SensorHistory> {
    let [temperature_binding, humidity_binding] = bindings(device, panel).ok_or_else(|| {
        AppError::new(
            "unsupported",
            "此设备没有可读取的标准温湿度历史能力。",
            false,
        )
    })?;
    let (start, end, reference_time) = window;
    let per_day = selection
        .as_ref()
        .is_some_and(|s| s.period != HistoryPeriod::Day);
    let gateway_start = if selection.is_some() {
        start.saturating_sub(6 * 3600)
    } else {
        start
    };
    let deadline = Instant::now() + Duration::from_secs(18);
    let budget = (if selection.is_some() { 64 } else { 8 }, deadline);
    let common_pages = async {
        if per_day {
            per_day_pages(cloud, device, owner, start, end, deadline).await
        } else {
            pages(cloud, device, owner, "historykey", start, end, budget).await
        }
    };
    let (common, temp, humidity) = tokio::join!(
        common_pages,
        pages(
            cloud,
            device,
            owner,
            &temperature_binding.key,
            gateway_start,
            end,
            budget
        ),
        pages(
            cloud,
            device,
            owner,
            &humidity_binding.key,
            gateway_start,
            end,
            budget
        )
    );
    if let Some(error) = [&common, &temp, &humidity]
        .iter()
        .find_map(|r| r.as_ref().err().filter(|e| e.kind == "authExpired"))
    {
        return Err(error.clone());
    }
    if common.is_err() && temp.is_err() && humidity.is_err() {
        return Err(temp.err().unwrap());
    }
    let mut warnings = Vec::new();
    if [&common, &temp, &humidity]
        .iter()
        .any(|r| r.is_err() || r.as_ref().is_ok_and(|p| p.incomplete))
    {
        warnings.push("部分云端历史未完整取回，曲线仅显示已取得的记录。".into());
    }
    let input = ChannelInput {
        device,
        owner,
        start,
        end,
        gateway_start,
        per_day,
    };
    let channels = vec![
        channel(&input, &temperature_binding, true, &common, &temp),
        channel(&input, &humidity_binding, false, &common, &humidity),
    ];
    if channels.iter().any(|channel| !channel.complete) && warnings.is_empty() {
        warnings.push("部分云端历史记录无法显示，缺测处保留空白。".into());
    }
    Ok(SensorHistory {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        start,
        end,
        reference_time,
        selection,
        channels,
        warnings,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn gateway_little_endian_zero_negative_and_boundary_are_not_fabricated() {
        assert_eq!(decode_hex(&json!(["1a01"]), true), Some(28.2));
        assert_eq!(decode_hex(&json!(["4e02"]), false), Some(59.0));
        assert_eq!(decode_hex(&json!(["0000"]), true), Some(0.0));
        assert_eq!(decode_hex(&json!(["cfff"]), true), Some(-4.9));
        assert_eq!(decode_hex(&json!(["0080"]), true), Some(-3276.8));
        for data in [
            json!(["zzzz"]),
            json!(["1"]),
            json!(["123456"]),
            json!([28.2]),
            json!([]),
        ] {
            assert_eq!(decode_hex(&data, true), None);
        }
    }
    #[test]
    fn records_are_bound_to_exact_device_owner_key_and_requested_time() {
        let row = json!({"did":"a","uid":"b","key":"4100","time":1001,"value":"[\"0000\"]"});
        assert!(payload(&row, "a", "b", "4100", 1000, 1002).is_some());
        assert!(payload(&row, "other", "b", "4100", 1000, 1002).is_none());
        assert!(payload(&row, "a", "other", "4100", 1000, 1002).is_none());
        assert!(payload(&row, "a", "b", "4102", 1000, 1002).is_none());
        assert!(payload(&row, "a", "b", "4100", 1001, 1002).is_none());
        assert!(payload(&row, "a", "b", "4100", 1000, 1000).is_none());
    }
    fn fixture() -> (Device, DevicePanel) {
        let device=serde_json::from_value(json!({"did":"a","name":"sensor","model":"miaomiaoce.sensor_ht.t2","online":true,"roomId":"r","roomName":"room"})).unwrap();
        let panel=serde_json::from_value(json!({"did":"a","model":"miaomiaoce.sensor_ht.t2","services":[{"siid":2,"name":"temperature-humidity-sensor","description":"sensor","actions":[],"properties":[{"siid":2,"piid":1,"name":"temperature","description":"temperature","format":"float","access":["read"],"unit":"celsius","valueRange":[-30,100,0.1]},{"siid":2,"piid":2,"name":"relative-humidity","description":"humidity","format":"float","access":["read"],"unit":"percentage","valueRange":[0,100,0.1]}]}]})).unwrap();
        (device, panel)
    }
    #[test]
    fn channel_keeps_valid_zero_rejects_out_of_spec_and_exposes_partial_failures() {
        let (device, panel) = fixture();
        assert!(supported(&device, &panel));
        let common = Err(AppError::new("network", "unavailable", true));
        let gateway = Ok(Pages {
            rows: vec![
                json!({"did":"a","uid":"b","key":"4100","time":1001,"value":"[\"0000\"]"}),
                json!({"did":"a","uid":"b","key":"4100","time":1002,"value":"[\"0080\"]"}),
            ],
            incomplete: false,
        });
        let channel = channel(
            &ChannelInput {
                device: &device,
                owner: "b",
                start: 1000,
                end: 1003,
                gateway_start: 1000,
                per_day: false,
            },
            &bindings(&device, &panel).unwrap()[0],
            true,
            &common,
            &gateway,
        );
        assert_eq!(channel.points.len(), 1);
        assert_eq!(channel.points[0].high, 0.0);
        assert!(!channel.complete);
        assert_eq!(channel.completeness, "partial");
        assert!(channel.error.is_none());
    }
    #[test]
    fn empty_success_and_failed_channel_remain_distinct_and_model_bound() {
        let (mut device, panel) = fixture();
        let empty = Ok(Pages::default());
        let input = ChannelInput {
            device: &device,
            owner: "b",
            start: 1000,
            end: 1003,
            gateway_start: 1000,
            per_day: false,
        };
        let success = channel(
            &input,
            &bindings(&device, &panel).unwrap()[1],
            false,
            &empty,
            &empty,
        );
        assert!(success.points.is_empty() && success.complete && success.error.is_none());
        assert_eq!(success.completeness, "complete");
        let failed = channel(
            &input,
            &bindings(&device, &panel).unwrap()[1],
            false,
            &empty,
            &Err(AppError::protocol()),
        );
        assert!(failed.points.is_empty() && !failed.complete && failed.error.is_some());
        assert_eq!(failed.completeness, "failed");
        device.model = "other.sensor".into();
        assert!(!supported(&device, &panel));
    }
    #[test]
    fn daily_summary_schema_is_separate_and_keeps_zero_and_real_bounds() {
        let (device, panel) = fixture();
        let input = ChannelInput {
            device: &device,
            owner: "b",
            start: 1000,
            end: 1100,
            gateway_start: 900,
            per_day: true,
        };
        let common = Ok(Pages {
            rows: vec![
                json!({"did":"a","uid":"b","key":"history_per_day","time":1001,"value":"{\"lowTemp\":-2,\"highTemp\":0,\"lowHumi\":0,\"highHumi\":60}"}),
                json!({"did":"a","uid":"b","key":"historykey","time":1002,"value":"{\"temperaturelow\":5,\"temperaturehigh\":10}"}),
            ],
            incomplete: false,
        });
        let result = channel(
            &input,
            &bindings(&device, &panel).unwrap()[0],
            true,
            &common,
            &Ok(Pages::default()),
        );
        assert_eq!(result.points.len(), 1);
        assert_eq!(result.points[0].low, -2.0);
        assert_eq!(result.points[0].high, 0.0);
        assert!(!result.complete);
        let humidity = channel(
            &input,
            &bindings(&device, &panel).unwrap()[1],
            false,
            &common,
            &Ok(Pages::default()),
        );
        assert_eq!(humidity.points[0].low, 0.0);
        assert_eq!(humidity.points[0].high, 60.0);
    }

    fn standard_fixture() -> (Device, DevicePanel) {
        let (mut device, mut panel) = fixture();
        device.model = "xiaomi.sensor_ht.mini".into();
        panel.model = device.model.clone();
        panel.spec_type = Some(
            "urn:miot-spec-v2:device:temperature-humidity-sensor:0000A00A:xiaomi-mini:1:0000D063"
                .into(),
        );
        panel.services[0].properties[0].piid = 1001;
        panel.services[0].properties[1].piid = 1002;
        (device, panel)
    }

    fn test_row(key: &str, time: u64, value: Value) -> Value {
        json!({"did":"a","uid":"b","key":key,"time":time,"value":value.to_string()})
    }

    #[test]
    fn mini_and_absent_brands_bind_actual_ids_without_reusing_legacy_keys() {
        let (mut device, mut panel) = standard_fixture();
        let actual = bindings(&device, &panel).unwrap();
        assert_eq!(actual[0].key, "2.1001");
        assert_eq!(actual[1].key, "2.1002");
        assert_eq!(actual[0].encoding, Encoding::MiotNumber);
        device.model = "other.sensor_ht.public".into();
        panel.model = device.model.clone();
        panel.services[0].properties[0].siid = 7;
        panel.services[0].siid = 7;
        panel.services[0].properties[0].piid = 12;
        panel.services[0].properties[1].siid = 7;
        panel.services[0].properties[1].piid = 34;
        let actual = bindings(&device, &panel).unwrap();
        assert_eq!(actual[0].key, "7.12");
        assert_eq!(actual[1].key, "7.34");
    }

    #[test]
    fn standard_adapter_rejects_unrelated_types_ambiguous_or_unreadable_properties() {
        let (device, panel) = standard_fixture();
        let mut wrong = panel.clone();
        wrong.spec_type = Some("urn:miot-spec-v2:device:fan:test".into());
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].access.clear();
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].unit = Some("fahrenheit".into());
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        let duplicate = wrong.services[0].properties[0].clone();
        wrong.services[0].properties.push(duplicate);
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0]
            .properties
            .retain(|property| property.name != "relative-humidity");
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services.clear();
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].piid = 0;
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].siid = 99;
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].format = "bool".into();
        assert!(!supported(&device, &wrong));
        let mut wrong = panel.clone();
        wrong.services[0].properties[0].value_range = Some(vec![100.0, -30.0, 0.1]);
        assert!(!supported(&device, &wrong));
    }

    #[test]
    fn numeric_adapter_preserves_zero_negative_values_and_never_hex_decodes() {
        for (value, expected) in [
            (json!([28.7]), Some(28.7)),
            (json!([0]), Some(0.0)),
            (json!([-4.9]), Some(-4.9)),
            (json!(["28.7"]), Some(28.7)),
            (json!(["1a01"]), None),
            (json!([true]), None),
            (json!([]), None),
            (json!(["NaN"]), None),
        ] {
            assert_eq!(decode_number(&value), expected);
        }
    }

    #[test]
    fn unknown_summary_schema_is_a_failure_instead_of_a_complete_empty_result() {
        let (device, panel) = standard_fixture();
        let [temperature, _] = bindings(&device, &panel).unwrap();
        let input = ChannelInput {
            device: &device,
            owner: "b",
            start: 1000,
            end: 2000,
            gateway_start: 900,
            per_day: false,
        };
        let common = Ok(Pages {
            rows: vec![test_row("historykey", 1001, json!({"unrelated":28.7}))],
            incomplete: false,
        });
        let result = channel(&input, &temperature, true, &common, &Ok(Pages::default()));
        assert!(!result.complete && result.points.is_empty() && result.error.is_some());
        assert_eq!(result.completeness, "failed");
    }

    #[test]
    fn channels_merge_independently_and_deduplicate_overlapping_unordered_pages() {
        let (device, panel) = standard_fixture();
        let [temperature, humidity] = bindings(&device, &panel).unwrap();
        let input = ChannelInput {
            device: &device,
            owner: "b",
            start: 1000,
            end: 10000,
            gateway_start: 900,
            per_day: false,
        };
        let common = Ok(Pages {
            rows: vec![
                test_row(
                    "historykey",
                    1001,
                    json!({"temperaturelow":-2,"temperaturehigh":0}),
                ),
                test_row(
                    "historykey",
                    1002,
                    json!({"lowHumidity":0,"highHumidity":60}),
                ),
            ],
            incomplete: false,
        });
        let gateway = Ok(Pages {
            rows: vec![
                test_row("2.1001", 4001, json!([1])),
                test_row("2.1001", 1001, json!([0])),
                test_row("2.1001", 1001, json!([0])),
                test_row("2.1001", 1001, json!([-1])),
            ],
            incomplete: false,
        });
        let temp = channel(&input, &temperature, true, &common, &gateway);
        let humi = channel(&input, &humidity, false, &common, &Ok(Pages::default()));
        assert!(temp.complete && humi.complete);
        assert_eq!((temp.points.len(), humi.points.len()), (4, 1));
        assert_eq!(humi.points[0].low, 0.0);
        assert!(temp.points.iter().all(|p| p.state == "measured"));
        assert_eq!(
            temp.points
                .iter()
                .filter(|p| p.source == "miotProperty")
                .count(),
            3
        );
        assert!(temp
            .points
            .iter()
            .filter(|p| p.source == "miotProperty")
            .all(|p| p.bucket_time > p.time));
    }

    #[test]
    fn explicit_bucket_time_handles_local_midnight_and_fractional_offsets() {
        use chrono::FixedOffset;
        for seconds in [8 * 3600, 5 * 3600 + 1800, -(3 * 3600 + 1800)] {
            let tz = FixedOffset::east_opt(seconds).unwrap();
            let at = tz
                .with_ymd_and_hms(2026, 11, 4, 23, 32, 45)
                .unwrap()
                .timestamp() as u64;
            let midnight = tz
                .with_ymd_and_hms(2026, 11, 5, 0, 0, 0)
                .unwrap()
                .timestamp() as u64;
            assert_eq!(hour_end(at, &tz), Some(midnight));
            assert_eq!(hour_end(midnight, &tz), Some(midnight + 3600));
        }
    }

    #[tokio::test]
    async fn pagination_full_page_uses_overlapping_boundary_then_finishes_short_page() {
        let full: Vec<_> = (0..1000)
            .map(|n| test_row("2.1001", 2001 + n, json!([0])))
            .collect();
        let mut batches = std::collections::VecDeque::from([
            Ok(full),
            Ok(vec![
                test_row("2.1001", 2001, json!([0])),
                test_row("2.1001", 1500, json!([1])),
            ]),
        ]);
        let mut cursors = Vec::new();
        let result = collect_pages(
            1000,
            4000,
            (8, Instant::now() + Duration::from_secs(1)),
            |cursor| {
                cursors.push(cursor);
                std::future::ready(batches.pop_front().unwrap())
            },
        )
        .await
        .unwrap();
        assert_eq!(cursors, vec![4000, 2001]);
        assert_eq!(result.rows.len(), 1002);
        assert!(!result.incomplete);
    }

    #[tokio::test]
    async fn pagination_partial_data_survives_later_failure_but_auth_error_does_not() {
        for kind in ["network", "authExpired"] {
            let full = vec![test_row("2.1001", 2001, json!([0])); 1000];
            let mut batches = std::collections::VecDeque::from([
                Ok(full),
                Err(AppError::new(kind, "test", true)),
            ]);
            let result = collect_pages(
                1000,
                4000,
                (8, Instant::now() + Duration::from_secs(1)),
                |_| std::future::ready(batches.pop_front().unwrap()),
            )
            .await;
            if kind == "authExpired" {
                assert_eq!(result.err().unwrap().kind, "authExpired");
            } else {
                let result = result.unwrap();
                assert_eq!(result.rows.len(), 1000);
                assert!(result.incomplete);
            }
        }
    }

    #[tokio::test]
    async fn pagination_nonprogress_budget_and_timeout_are_not_complete_empty_history() {
        let repeated = vec![test_row("2.1001", 2001, json!([0])); 1000];
        let result = collect_pages(
            1000,
            4000,
            (8, Instant::now() + Duration::from_secs(1)),
            |_| std::future::ready(Ok(repeated.clone())),
        )
        .await
        .unwrap();
        assert!(result.incomplete);
        let result = collect_pages(
            1000,
            4000,
            (1, Instant::now() + Duration::from_secs(1)),
            |_| std::future::ready(Ok(repeated.clone())),
        )
        .await
        .unwrap();
        assert!(result.incomplete);
        let result = collect_pages(1000, 4000, (8, Instant::now()), |_| {
            std::future::pending::<Result<Vec<Value>>>()
        })
        .await;
        assert_eq!(result.err().unwrap().kind, "network");
        let empty = collect_pages(
            1000,
            4000,
            (8, Instant::now() + Duration::from_secs(1)),
            |_| std::future::ready(Ok(Vec::new())),
        )
        .await
        .unwrap();
        assert!(empty.rows.is_empty() && !empty.incomplete);
    }
}
