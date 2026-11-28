//! Account-scoped cloud reports and verified MIoT weight readings.
use crate::{
    error::{AppError, Result},
    models::{id, Device, DevicePanel, Property},
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{
    borrow::Cow,
    cmp::Reverse,
    collections::{BTreeMap, HashSet},
};

pub(crate) mod pending;

pub(crate) const MODEL: &str = "yunmai.scales.ms103";
pub(crate) const INDEX: &str = "/eco/common/scale/indexInfo";
pub(crate) const RECORDS: &str = "/eco/scale/getData";
pub(crate) const REGIONAL_RECORDS: &str = "/eco/common/scale/getUserDataByPage";
pub(crate) const PENDING: &str = "/eco/common/scale/getUnClaimByPage";
pub(crate) const PAGE_SIZE: usize = 20;
pub(crate) const EARLIEST_MS: u64 = 1_640_966_400_000;

#[derive(Clone, Copy, Eq, PartialEq)]
pub(crate) enum EcoScale {
    S400,
    S200,
    Composition,
}

impl EcoScale {
    pub(crate) fn for_model(model: &str) -> Option<Self> {
        match model {
            MODEL | "yunmai.scales.ms104" | "yunmai.scales.ms107" => Some(Self::S400),
            "yunmai.scales.ms106" | "xiaomi.scales.ms112" | "xiaomi.scales.ms113" => {
                Some(Self::S200)
            }
            "xiaomi.scales.ms110"
            | "xiaomi.scales.ms116"
            | "xiaomi.scales.ms117"
            | "xiaomi.scales.s401" => Some(Self::Composition),
            _ => None,
        }
    }

    pub(crate) fn pending_supported(self) -> bool {
        matches!(self, Self::S400 | Self::S200)
    }
}

#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Source {
    MemberCloud,
    DeviceHistory,
    DeviceReading,
    Unavailable,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Query {
    pub(crate) member_id: Option<String>,
    pub(crate) start: Option<u64>,
    pub(crate) before: Option<u64>,
    #[serde(default)]
    pub(crate) pending: bool,
}

// Fields with known meaning and units in the original S400 report.
const METRICS: &[(&str, &str, f64)] = &[
    ("bmi", "bmi", 100.0),
    ("bfp", "bodyFat", 100.0),
    ("slm", "muscle", 150.0),
    ("heartRate", "heartRate", 250.0),
    ("bwp", "water", 100.0),
    ("bmc", "boneMass", 150.0),
    ("smm", "skeletalMuscle", 150.0),
    ("vfl", "visceralFat", 100.0),
    ("pp", "protein", 100.0),
    ("bmr", "basalMetabolism", 10_000.0),
    ("ma", "bodyAge", 150.0),
];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Member {
    pub(crate) id: String,
    name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    icon: Option<String>,
}

pub(crate) struct Profile {
    pub(crate) member: Member,
    database_id: Option<String>,
    birth_date: Option<chrono::NaiveDate>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Measurement {
    pub(crate) key: String,
    pub(crate) time_ms: u64,
    pub(crate) weight: f64,
    pub(crate) metrics: BTreeMap<&'static str, f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    adult_bmi: Option<bool>,
}

#[derive(Debug, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    pub(crate) records: Vec<Measurement>,
    pub(crate) next_before: Option<u64>,
    pub(crate) omitted: usize,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct History {
    pub(crate) did: String,
    pub(crate) model: String,
    pub(crate) members: Vec<Member>,
    pub(crate) member_id: Option<String>,
    pub(crate) source: Source,
    pub(crate) composition_supported: bool,
    pub(crate) pending_supported: bool,
    pub(crate) pending_editable: bool,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub(crate) pending_claim_member_ids: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) latest_weight: Option<f64>,
    #[serde(flatten)]
    pub(crate) page: Page,
}

pub(crate) fn validate_eco_device(device: &Device) -> Result<EcoScale> {
    if device.split_route.is_some() {
        return Err(AppError::invalid("此型号没有已核实的称重历史接口。"));
    }
    EcoScale::for_model(&device.model)
        .ok_or_else(|| AppError::invalid("此型号没有已核实的称重历史接口。"))
}

pub(crate) fn is_scale(device: &Device) -> bool {
    if let Some(spec_type) = device.spec_type.as_deref() {
        return spec_type.starts_with("urn:miot-spec-v2:device:scale:0000A07D:");
    }
    matches!(device.model.split('.').nth(1), Some("scales" | "scale"))
}

pub(crate) fn weight_binding(panel: &DevicePanel) -> Option<&Property> {
    if !panel
        .spec_type
        .as_deref()?
        .starts_with("urn:miot-spec-v2:device:scale:0000A07D:")
    {
        return None;
    }
    let mut bindings = panel
        .services
        .iter()
        .filter(|service| service.name == "scale")
        .flat_map(|service| {
            service
                .properties
                .iter()
                .filter(move |property| property.siid == service.siid)
        })
        .filter(|property| {
            let published_kg = property.unit.as_deref() == Some("kg");
            property.name == "body-weight"
                && published_kg
                && property.siid > 0
                && property.piid > 0
                && matches!(
                    property.format.as_str(),
                    "float" | "double" | "uint16" | "uint32"
                )
                && property.unsupported_reason.is_none()
                && property
                    .access
                    .iter()
                    .any(|access| matches!(access.as_str(), "read" | "notify"))
        });
    let property = bindings.next()?;
    bindings.next().is_none().then_some(property)
}

pub(crate) fn property_weight(value: &Value, property: &Property) -> Option<f64> {
    let value = value
        .as_f64()
        .filter(|kg| kg.is_finite() && (0.1..=500.0).contains(kg))?;
    if let Some(range) = property.value_range.as_deref() {
        let [min, max, step] = range else { return None };
        if !step.is_finite() || *step <= 0.0 || !(*min..=*max).contains(&value) {
            return None;
        }
    }
    Some(value)
}

pub(crate) fn live_weight(rows: &[Value], did: &str, property: &Property) -> Option<f64> {
    let [row] = rows else { return None };
    if id(&row["did"]) != did
        || row["siid"] != property.siid
        || row["piid"] != property.piid
        || row["code"].as_i64() != Some(0)
    {
        return None;
    }
    property_weight(&row["value"], property)
}

pub(crate) fn device_history_page(
    rows: &[Value],
    did: &str,
    uid: &str,
    key: &str,
    property: &Property,
    start_ms: u64,
    before_ms: u64,
) -> Result<Page> {
    if rows.len() > PAGE_SIZE {
        return Err(AppError::protocol());
    }
    let mut page = Page::default();
    let mut oldest = None;
    let mut seen = HashSet::new();
    for row in rows {
        let reading = crate::history::payload(
            row,
            did,
            uid,
            key,
            start_ms.saturating_sub(1) / 1000,
            before_ms / 1000,
        );
        let Some((time, payload)) = reading else {
            page.omitted += 1;
            continue;
        };
        let time_ms = time * 1000;
        oldest = Some(oldest.map_or(time_ms, |old: u64| old.min(time_ms)));
        let raw = match payload.as_array().map(Vec::as_slice) {
            Some([value]) => value,
            Some(_) => &Value::Null,
            None => &payload,
        };
        let Some(weight) = property_weight(raw, property) else {
            page.omitted += 1;
            continue;
        };
        let key = measurement_key(time_ms, weight, &BTreeMap::new());
        if seen.insert(key.clone()) {
            page.records.push(Measurement {
                key,
                time_ms,
                weight,
                metrics: BTreeMap::new(),
                adult_bmi: None,
            });
        }
    }
    page.records.sort_by_key(|record| Reverse(record.time_ms));
    if rows.len() == PAGE_SIZE {
        page.next_before = oldest
            .and_then(|time| time.checked_sub(1))
            .filter(|time| *time >= start_ms);
    }
    Ok(page)
}

fn integer(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| {
        let text = value.as_str()?;
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return None;
        }
        text.parse().ok()
    })
}

fn member_icon(value: &Value) -> Option<String> {
    if let Some(preset) = integer(value).filter(|n| (1..=6).contains(n)) {
        return Some(preset.to_string());
    }
    let text = value.as_str().filter(|s| s.len() <= 2048)?;
    let url = url::Url::parse(text).ok()?;
    let host = url.host_str()?;
    let official = [
        "mi-img.com",
        "xiaomi.net",
        "xiaomi.com",
        "mi.com",
        "mifile.cn",
    ]
    .iter()
    .any(|d| {
        host == *d
            || host
                .strip_suffix(d)
                .is_some_and(|prefix| prefix.ends_with('.'))
    });
    (official
        && url.scheme() == "https"
        && url.username().is_empty()
        && url.password().is_none()
        && url.port().is_none())
    .then(|| url.to_string())
}

fn optional_id(value: &Value) -> Result<Option<String>> {
    if value.is_null() || value.as_str() == Some("") {
        return Ok(None);
    }
    integer(value)
        .map(|id| (id != 0).then(|| id.to_string()))
        .ok_or_else(AppError::protocol)
}

pub(crate) fn profiles(value: &Value, uid: &str) -> Result<Vec<Profile>> {
    let rows = value["accountInfoList"]
        .as_array()
        .ok_or_else(AppError::protocol)?;
    if rows.len() > 36 {
        return Err(AppError::protocol());
    }
    let mut profiles = Vec::new();
    let mut ids = HashSet::new();
    for row in rows {
        if optional_id(&row["uid"])?.is_some_and(|owner| owner != uid) {
            continue;
        }
        // An unclaimed measurement account is not a member.
        let Some(id) = optional_id(&row["accountId"])? else {
            continue;
        };
        if !ids.insert(id.clone()) {
            return Err(AppError::protocol());
        }
        let name: String = row["name"]
            .as_str()
            .unwrap_or("")
            .trim()
            .chars()
            .filter(|c| !c.is_control())
            .take(64)
            .collect();
        let name = if name.is_empty() {
            format!("成员 {}", profiles.len() + 1)
        } else {
            name
        };
        let birth_ms = row["birth"]
            .as_i64()
            .or_else(|| row["birth"].as_str()?.parse().ok());
        let birth_date = birth_ms
            .filter(|t| *t != 0)
            .and_then(chrono::DateTime::from_timestamp_millis)
            .map(|date| date.with_timezone(&chrono::Local).date_naive());
        profiles.push(Profile {
            member: Member {
                id,
                name,
                icon: member_icon(&row["icon"]),
            },
            database_id: optional_id(&row["id"])?,
            birth_date,
        });
    }
    Ok(profiles)
}

pub(crate) fn time_ms(value: &Value) -> Option<u64> {
    let time = integer(value)?;
    Some(if time < 100_000_000_000 {
        time * 1000
    } else {
        time
    })
}

fn object(value: &Value, limit: usize) -> Option<Cow<'_, Value>> {
    match value {
        Value::Object(_) => Some(Cow::Borrowed(value)),
        Value::String(text) if text.len() <= limit => serde_json::from_str::<Value>(text)
            .ok()
            .filter(Value::is_object)
            .map(Cow::Owned),
        _ => None,
    }
}

fn number(value: &Value, limit: f64) -> Option<f64> {
    value
        .as_f64()
        .or_else(|| value.as_str()?.parse().ok())
        .filter(|n| *n > 0.0 && *n <= limit)
}

fn measurement(
    row: &Value,
    device: &Device,
    profile: &Profile,
    uid: &str,
    time_ms: u64,
    pending: bool,
    family: EcoScale,
) -> Option<Measurement> {
    // A new model must return a device or model identity before we can
    // treat the shared endpoint's response as data from that scale.
    if device.model != MODEL && row["did"].is_null() && row["model"].is_null() {
        return None;
    }
    if !row["model"].is_null() && row["model"].as_str() != Some(&device.model) {
        return None;
    }
    let did = &row["did"];
    if !did.is_null()
        && did.as_str() != Some(device.control_did())
        && did
            .as_u64()
            .is_none_or(|id| id.to_string() != device.control_did())
    {
        return None;
    }
    if optional_id(&row["uid"])
        .ok()?
        .is_some_and(|owner| owner != uid)
    {
        return None;
    }
    let payload = object(&row["data"], 32_768)?;
    let outer = optional_id(&row["accountId"]).ok()?;
    let inner = optional_id(&payload["user"]["accountId"]).ok()?;
    let member_id = optional_id(&payload["user"]["id"]).ok()?;
    if outer
        .iter()
        .chain(&inner)
        .any(|id| id != &profile.member.id)
        || member_id.is_some() && member_id != profile.database_id
        || !pending && outer.is_none() && inner.is_none() && member_id.is_none()
    {
        return None;
    }
    let extra = object(&payload["bodyResData"], 16_384);
    let weight = number(&payload["weight"], 150.0)
        .or_else(|| {
            extra
                .as_deref()
                .and_then(|body| number(&body["weight"], 150.0))
        })
        .filter(|value| *value >= 0.1)?;
    let metrics = METRICS
        .iter()
        .filter(|_| !pending && family != EcoScale::S200)
        .filter_map(|&(raw, key, max)| {
            extra
                .as_deref()
                .and_then(|value| number(&value[raw], max))
                .or_else(|| number(&payload[raw], max))
                .map(|n| (key, n))
        })
        .collect::<BTreeMap<_, _>>();
    let key = if pending {
        pending::record_key(row, &payload, device, uid, time_ms)
    } else {
        measurement_key(time_ms, weight, &metrics)
    };
    let adult_bmi = metrics.contains_key("bmi").then_some(()).and_then(|_| {
        let date = chrono::DateTime::from_timestamp_millis(i64::try_from(time_ms).ok()?)?
            .with_timezone(&chrono::Local)
            .date_naive();
        let age = date.years_since(profile.birth_date?)?;
        (age <= 120).then_some(age >= 18)
    });
    Some(Measurement {
        key,
        time_ms,
        weight,
        metrics,
        adult_bmi,
    })
}

fn measurement_key(time_ms: u64, weight: f64, metrics: &BTreeMap<&'static str, f64>) -> String {
    let fields = (time_ms, weight, metrics);
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&fields).expect("numeric scale measurement"))
    )
}

pub(crate) fn page(
    value: &Value,
    device: &Device,
    profile: &Profile,
    uid: &str,
    start: u64,
    before: u64,
    pending: bool,
) -> Result<Page> {
    let family = validate_eco_device(device)?;
    let rows = value.as_array().ok_or_else(AppError::protocol)?;
    if rows.len() > PAGE_SIZE {
        return Err(AppError::protocol());
    }
    let mut page = Page::default();
    let mut seen = HashSet::new();
    let mut oldest = None;
    for row in rows {
        let Some(time) = time_ms(&row["createTime"]).filter(|t| (start..=before).contains(t))
        else {
            page.omitted += 1;
            continue;
        };
        oldest = Some(oldest.map_or(time, |old: u64| old.min(time)));
        match measurement(row, device, profile, uid, time, pending, family) {
            Some(record) if seen.insert(record.key.clone()) => page.records.push(record),
            Some(_) => {}
            None => page.omitted += 1,
        }
    }
    page.records.sort_by_key(|record| Reverse(record.time_ms));
    if rows.len() == PAGE_SIZE {
        page.next_before = oldest
            .and_then(|old| old.checked_sub(1))
            .filter(|next| *next >= start);
    }
    Ok(page)
}
