//! ms103 cloud contracts from original plugin 1013486/167. No BLE or measurement upload.
use crate::{
    error::{AppError, Result},
    models::Device,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
pub const MODEL: &str = "yunmai.scales.ms103";
pub const INDEX: &str = "/eco/common/scale/indexInfo";
pub const RECORDS: &str = "/eco/scale/getData";
pub const UNCLAIMED: &str = "/eco/common/scale/getUnClaimByPage";
pub const OLDEST_MS: u64 = 1_640_966_400_000;
pub const PAGE_SIZE: usize = 20;
pub const FIELDS: &[&str] = &[
    "bfp",
    "slm",
    "bwp",
    "bmc",
    "vfl",
    "pp",
    "smm",
    "bmi",
    "swt",
    "mc",
    "wc",
    "fc",
    "whr",
    "bmr",
    "bt",
    "ma",
    "sbc",
    "slp",
    "bmcp",
    "bfm",
    "ffm",
    "bwm",
    "pm",
    "heartRate",
];
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub account_id: String,
    pub name: String,
    pub icon: String,
    pub master: bool,
    pub can_edit: bool,
    pub sex: Option<u64>,
    pub birth: Option<i64>,
    pub height: Option<f64>,
    pub revision: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    pub key: String,
    pub time: u64,
    pub time_ms: u64,
    pub weight: f64,
    pub body_fat: Option<f64>,
    pub bmi: Option<f64>,
    pub muscle: Option<f64>,
    pub heart_rate: Option<f64>,
    pub metrics: BTreeMap<String, f64>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub members: Vec<Member>,
    pub account_id: Option<String>,
    pub records: Vec<Record>,
    pub fetched_at: u64,
    pub next_before: Option<u64>,
    pub omitted_records: usize,
    pub can_write: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub name: String,
    pub sex: u8,
    pub birth: i64,
    pub height: u16,
    pub icon: u8,
}
#[derive(Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RecordRef {
    pub key: String,
    pub time_ms: u64,
}
#[derive(Deserialize, Serialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Change {
    SaveMember {
        account_id: Option<String>,
        baseline: Option<String>,
        draft: Draft,
    },
    RemoveMember {
        account_id: String,
        baseline: String,
    },
    Claim {
        account_id: String,
        records: Vec<RecordRef>,
    },
    DeleteUnclaimed {
        account_id: String,
        records: Vec<RecordRef>,
    },
    DeleteRecords {
        account_id: String,
        records: Vec<RecordRef>,
    },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub confirmed: bool,
    pub message: String,
    pub completed: usize,
}
pub fn validate_device(d: &Device) -> Result<()> {
    if d.model != MODEL || d.split_route.is_some() {
        return Err(AppError::invalid("此体脂秤型号的云端协议尚未核实。"));
    }
    Ok(())
}
pub fn id(v: &Value) -> Option<String> {
    let s = v
        .as_str()
        .map(str::to_owned)
        .or_else(|| v.as_u64().map(|n| n.to_string()))?;
    (!s.is_empty() && s.len() <= 20 && s.bytes().all(|b| b.is_ascii_digit())).then_some(s)
}
pub fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite() && *n > 0.)
}
pub fn millis(v: &Value) -> Option<u64> {
    let n = v.as_u64().or_else(|| v.as_str()?.parse().ok())?;
    if n < 100_000_000_000 {
        n.checked_mul(1000)
    } else {
        Some(n)
    }
}
pub fn birth_millis(v: &Value) -> Option<i64> {
    v.as_i64().or_else(|| v.as_str()?.parse().ok())
}
pub fn fingerprint(v: &Value) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(v).unwrap_or_default())
    )
}
pub fn raw_members(v: &Value) -> Result<&Vec<Value>> {
    let rows = v["accountInfoList"]
        .as_array()
        .ok_or_else(AppError::protocol)?;
    if rows.len() > 32 {
        return Err(AppError::protocol());
    }
    let mut ids = HashSet::new();
    for r in rows {
        let i = id(&r["accountId"]).ok_or_else(AppError::protocol)?;
        if !ids.insert(i) {
            return Err(AppError::protocol());
        }
    }
    Ok(rows)
}
pub fn members(v: &Value, uid: &str, writable: bool) -> Result<Vec<Member>> {
    raw_members(v)?
        .iter()
        .enumerate()
        .map(|(i, r)| {
            let account = id(&r["accountId"]).ok_or_else(AppError::protocol)?;
            let name: String = r["name"]
                .as_str()
                .unwrap_or("")
                .chars()
                .filter(|c| !c.is_control())
                .take(64)
                .collect();
            let raw_icon = r["icon"].as_str().unwrap_or("1");
            let icon = if raw_icon.len() <= 2048
                && (raw_icon.parse::<u8>().is_ok_and(|n| n <= 6) || safe_avatar(raw_icon))
            {
                raw_icon.to_string()
            } else {
                "1".into()
            };
            Ok(Member {
                master: account == uid,
                can_edit: writable && account != "0" && id(&r["uid"]).is_none_or(|s| s == uid),
                account_id: account,
                name: if name.trim().is_empty() {
                    format!("成员 {}", i + 1)
                } else {
                    name
                },
                icon,
                sex: id(&r["sex"]).and_then(|s| s.parse().ok()),
                birth: birth_millis(&r["birth"]),
                height: number(&r["height"]),
                revision: fingerprint(r),
            })
        })
        .collect()
}
fn safe_avatar(s: &str) -> bool {
    reqwest::Url::parse(s).is_ok_and(|u| {
        u.scheme() == "https"
            && u.username().is_empty()
            && u.password().is_none()
            && u.host_str().is_some_and(|h| {
                [
                    "mi-img.com",
                    "xiaomi.net",
                    "xiaomi.com",
                    "mi.com",
                    "mifile.cn",
                ]
                .iter()
                .any(|d| h == *d || h.ends_with(&format!(".{d}")))
            })
    })
}
pub fn select(members: &[Member], requested: Option<&str>, uid: &str) -> Result<Option<String>> {
    if let Some(w) = requested {
        return members
            .iter()
            .find(|m| m.account_id == w)
            .map(|m| Some(m.account_id.clone()))
            .ok_or_else(|| AppError::invalid("该成员已不在此体脂秤中，请刷新。"));
    }
    Ok(members
        .iter()
        .find(|m| m.master)
        .or_else(|| members.iter().find(|m| m.account_id == uid))
        .or_else(|| members.first())
        .map(|m| m.account_id.clone()))
}
pub fn member<'a>(index: &'a Value, account: &str) -> Result<&'a Value> {
    raw_members(index)?
        .iter()
        .find(|r| id(&r["accountId"]).as_deref() == Some(account))
        .ok_or_else(|| AppError::invalid("成员已变更，请刷新后重试。"))
}
pub fn data(row: &Value) -> Option<Value> {
    let mut d = match &row["data"] {
        Value::String(s) if s.len() <= 32768 => serde_json::from_str(s).ok()?,
        Value::Object(_) => row["data"].clone(),
        _ => return None,
    };
    if let Some(extra) = match &d["bodyResData"] {
        Value::String(s) if s.len() <= 16384 => serde_json::from_str::<Value>(s).ok(),
        Value::Object(_) => Some(d["bodyResData"].clone()),
        _ => None,
    } {
        for key in FIELDS.iter().copied().chain(["bodyRes", "bodyRes2"]) {
            if let Some(v) = extra.get(key) {
                d[key] = v.clone();
            }
        }
    }
    Some(d)
}
pub fn record_key(row: &Value) -> String {
    fingerprint(
        &json!({"did":row["did"],"model":row["model"],"accountId":row["accountId"],"createTime":row["createTime"],"sn":row["sn"],"data":row["data"]}),
    )
}
pub fn record(
    row: &Value,
    d: &Device,
    profile: &Value,
    pending: bool,
    start: u64,
    before: u64,
) -> Option<Record> {
    let t = millis(&row["createTime"]).filter(|t| *t >= start && *t <= before)?;
    if row["model"].as_str().is_some_and(|s| s != d.model)
        || row["did"].as_str().is_some_and(|s| s != d.control_did())
    {
        return None;
    }
    let payload = data(row)?;
    if let (Some(owner), Some(member_owner)) =
        (id(&row["uid"]).filter(|s| s != "0"), id(&profile["uid"]))
    {
        if owner != member_owner {
            return None;
        }
    }
    let account = id(&profile["accountId"])?;
    let embedded = id(&payload["user"]["accountId"]).filter(|s| s != "0");
    let outer = id(&row["accountId"]).filter(|s| s != "0");
    if embedded.as_ref().is_some_and(|s| s != &account)
        || outer.as_ref().is_some_and(|s| s != &account)
    {
        return None;
    }
    let code = id(&payload["user"]["id"]).filter(|s| s != "0");
    let own_code = id(&profile["accountCode"]);
    if code.is_some() && code != own_code {
        return None;
    }
    if !pending && embedded.is_none() && outer.is_none() && code.is_none() {
        return None;
    }
    let weight = number(&payload["weight"])?;
    let metrics = FIELDS
        .iter()
        .filter_map(|key| number(&payload[*key]).map(|v| (key.to_string(), v)))
        .collect::<BTreeMap<_, _>>();
    Some(Record {
        key: record_key(row),
        time: t / 1000,
        time_ms: t,
        weight,
        body_fat: metrics.get("bfp").copied().filter(|n| *n <= 100.),
        bmi: metrics.get("bmi").copied(),
        muscle: metrics.get("slm").copied(),
        heart_rate: metrics.get("heartRate").copied(),
        metrics,
    })
}
pub fn records(
    v: &Value,
    d: &Device,
    profile: &Value,
    pending: bool,
    start: u64,
    before: u64,
    limit: usize,
) -> Result<(Vec<Record>, Option<u64>, usize)> {
    let rows = v.as_array().ok_or_else(AppError::protocol)?;
    if rows.len() > limit {
        return Err(AppError::protocol());
    }
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let mut oldest = None;
    let mut omitted = 0;
    for row in rows {
        if let Some(t) = millis(&row["createTime"]).filter(|t| *t >= start && *t <= before) {
            oldest = Some(oldest.map_or(t, |old: u64| old.min(t)));
        }
        if let Some(r) = record(row, d, profile, pending, start, before) {
            if seen.insert(r.key.clone()) {
                out.push(r);
            }
        } else {
            omitted += 1;
        }
    }
    out.sort_by_key(|r| std::cmp::Reverse(r.time_ms));
    let next = if rows.len() == limit {
        oldest
            .and_then(|t| t.checked_sub(1))
            .filter(|t| *t >= start && *t < before)
    } else {
        None
    };
    Ok((out, next, omitted))
}
pub fn validate_draft(d: &Draft, now: u64) -> Result<()> {
    let name = d.name.trim();
    if name.is_empty()
        || name.chars().count() > 20
        || name.chars().any(char::is_control)
        || ![1, 2].contains(&d.sex)
        || !(90..=220).contains(&d.height)
        || !(1..=6).contains(&d.icon)
        || d.birth > now as i64
    {
        return Err(AppError::invalid(
            "请填写有效的姓名、性别、生日、身高（90–220 cm）和头像。",
        ));
    }
    let birth = chrono::DateTime::from_timestamp_millis(d.birth)
        .ok_or_else(|| AppError::invalid("生日无效。"))?;
    if chrono::Datelike::year(&birth) < 1900 {
        return Err(AppError::invalid("生日应在 1900 年之后。"));
    }
    Ok(())
}
pub fn make_member(
    d: &Draft,
    previous: Option<&Value>,
    device: &Device,
    uid: &str,
    now: u64,
) -> Value {
    let mut v=previous.cloned().unwrap_or_else(||json!({"uid":uid,"accountId":"","accountCode":0,"type":2,"weightTarget":"0","weightUpdateTime":0,"creationTime":now}));
    v["sex"] = json!(d.sex.to_string());
    v["birth"] = json!(d.birth);
    v["height"] = json!(d.height.to_string());
    v["name"] = json!(d.name.trim());
    if previous.is_none_or(|r| id(&r["accountId"]).as_deref() != Some(uid)) {
        v["icon"] = json!(d.icon.to_string());
    }
    v["deviceId"] = json!(device.control_did());
    v["updateTime"] = json!(now);
    v
}
pub fn calculation(profile: &Value, payload: &Value, now: u64) -> Option<Value> {
    use chrono::Datelike;
    let birth = chrono::DateTime::from_timestamp_millis(birth_millis(&profile["birth"])?)?
        .with_timezone(&chrono::Local)
        .date_naive();
    let today = chrono::DateTime::from_timestamp_millis(now as i64)?
        .with_timezone(&chrono::Local)
        .date_naive();
    let age = today.year()
        - birth.year()
        - i32::from((today.month(), today.day()) < (birth.month(), birth.day()));
    let height = number(&profile["height"])?;
    let sex = id(&profile["sex"])?;
    if !(6..=80).contains(&age)
        || !(90.0..=220.0).contains(&height)
        || !["1", "2"].contains(&sex.as_str())
    {
        return None;
    }
    Some(
        json!({"age":age,"sex":if sex=="2"{0}else{1},"height":(height*10.).trunc() as u64,"weight":(number(&payload["weight"])?*10.).trunc() as u64,"electrodes_number":4,"res_mapping_switch":0,"current_impedance":[number(&payload["bodyRes"])?*10.,number(&payload["bodyRes2"])?*10.]}),
    )
}
