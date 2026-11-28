use super::{
    integer, measurement, number, object, time_ms, EcoScale, Profile, EARLIEST_MS, MODEL, PAGE_SIZE,
};
use crate::{
    error::{AppError, Result},
    models::{id, Device},
};
use serde::Deserialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::HashSet;

pub(crate) const SAVE: &str = "/eco/common/scale/add";
pub(crate) const REMOVE: &str = "/eco/common/scale/addClaimDel";
pub(crate) const CALCULATE: &str = "/eco/scale/batch_bcalc";

// S400 v167 WeightData fields retained during the gateway-to-app conversion.
const BODY_FIELDS: &[&str] = &[
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

#[derive(Clone, Copy, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Operation {
    Claim,
    Remove,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Reference {
    pub(crate) key: String,
    pub(crate) time_ms: u64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Change {
    pub(crate) kind: Operation,
    pub(crate) member_id: String,
    pub(crate) target_member_id: Option<String>,
    pub(crate) records: Vec<Reference>,
}

impl Change {
    pub(crate) fn validate(&self, now_ms: u64) -> Result<()> {
        if self.target_member_id.as_ref().is_some_and(|id| {
            self.kind != Operation::Claim || id.parse::<u64>().ok().is_none_or(|id| id == 0)
        }) {
            return Err(AppError::invalid("所选认领成员无效。"));
        }
        if self.records.is_empty() || self.records.len() > PAGE_SIZE {
            return Err(AppError::invalid("每次请选择 1–20 条记录。"));
        }
        let mut times = HashSet::new();
        for record in &self.records {
            if !(EARLIEST_MS..=now_ms).contains(&record.time_ms)
                || record.key.len() != 64
                || !record.key.bytes().all(|byte| byte.is_ascii_hexdigit())
                || !times.insert(record.time_ms)
            {
                return Err(AppError::invalid("记录选择无效，请刷新后重新选择。"));
            }
        }
        Ok(())
    }
}

pub(crate) fn supported(device: &Device, region: &str) -> bool {
    device.model == MODEL
        && region == "cn"
        && !device.shared_read_only
        && device.split_route.is_none()
}

pub(crate) fn owned_profile<'a>(
    index: &'a Value,
    profile: &Profile,
    uid: &str,
    device: &Device,
) -> Option<&'a Value> {
    index["accountInfoList"].as_array()?.iter().find(|row| {
        let account = id(&row["accountId"]);
        let owner = id(&row["uid"]);
        let did = id(&row["deviceId"]);
        account == profile.member.id
            && (owner == uid || row["uid"].is_null() && account == uid)
            && (did.is_empty() || did == device.control_did())
    })
}

pub(super) fn record_key(
    row: &Value,
    data: &Value,
    device: &Device,
    uid: &str,
    time: u64,
) -> String {
    let identity = json!([
        uid,
        device.control_did(),
        device.model,
        time,
        row["did"],
        row["model"],
        row["uid"],
        row["accountId"],
        row["id"],
        row["sn"],
        row["fromSource"],
        data
    ]);
    format!("{:x}", Sha256::digest(identity.to_string()))
}

pub(crate) struct Record<'a> {
    row: &'a Value,
    data: Value,
    weight: f64,
    time_ms: u64,
}

impl<'a> Record<'a> {
    pub(crate) fn read(
        row: &'a Value,
        reference: &Reference,
        device: &Device,
        profile: &Profile,
        uid: &str,
    ) -> Option<Self> {
        let time = time_ms(&row["createTime"])?;
        let source = &row["fromSource"];
        if time != reference.time_ms || !source.is_null() && !matches!(integer(source), Some(2 | 3))
        {
            return None;
        }
        let reading = measurement(row, device, profile, uid, time, true, EcoScale::S400)?;
        if reading.key != reference.key {
            return None;
        }
        let mut data = object(&row["data"], 32_768)?.into_owned();
        let extra = object(&data["bodyResData"], 16_384).map(|value| value.into_owned());
        for &field in BODY_FIELDS.iter().chain(["bodyRes", "bodyRes2"].iter()) {
            if let Some(value) = extra
                .as_ref()
                .and_then(|v| v.get(field))
                .filter(|v| number(v, f64::MAX).is_some())
            {
                data[field] = value.clone();
            }
        }
        Some(Self {
            row,
            data,
            weight: reading.weight,
            time_ms: time,
        })
    }

    pub(crate) fn saved(
        &self,
        candidate: &Value,
        device: &Device,
        profile: &Profile,
        uid: &str,
    ) -> bool {
        if time_ms(&candidate["createTime"]) != Some(self.time_ms)
            || id(&self.row["sn"]) != id(&candidate["sn"])
        {
            return false;
        }
        let Some(data) = object(&candidate["data"], 32_768) else {
            return false;
        };
        if data["reportFrom"] != "Claimed" {
            return false;
        }
        let Some(reading) = measurement(
            candidate,
            device,
            profile,
            uid,
            self.time_ms,
            false,
            EcoScale::S400,
        ) else {
            return false;
        };
        let extra = object(&data["bodyResData"], 16_384);
        (reading.weight - self.weight).abs() < 0.00001
            && ["bodyRes", "bodyRes2"].iter().all(|&field| {
                number(&self.data[field], 10_000.0).is_none_or(|source| {
                    number(&data[field], 10_000.0)
                        .or_else(|| number(&extra.as_ref()?[field], 10_000.0))
                        .is_some_and(|saved| (saved - source).abs() < 0.00001)
                })
            })
    }

    pub(crate) fn calculation(
        &self,
        profile: &Profile,
        user: &Value,
        now: u64,
    ) -> Result<Option<Value>> {
        if number(&self.data["bfp"], 100.0).is_some() {
            return Ok(None);
        }
        let (Some(first), Some(second)) = (
            number(&self.data["bodyRes"], 10_000.0),
            number(&self.data["bodyRes2"], 10_000.0),
        ) else {
            return Ok(None);
        };
        let today =
            chrono::DateTime::from_timestamp_millis(now as i64).ok_or_else(AppError::protocol)?;
        let age = profile.birth_date.and_then(|date| {
            today
                .with_timezone(&chrono::Local)
                .date_naive()
                .years_since(date)
        });
        let height = number(&user["height"], 220.0).filter(|height| *height >= 90.0);
        let sex = match integer(&user["sex"]) {
            Some(1) => Some(1),
            Some(2) => Some(0),
            _ => None,
        };
        let (Some(age), Some(height), Some(sex)) =
            (age.filter(|age| (6..=80).contains(age)), height, sex)
        else {
            return Err(AppError::invalid(
                "请先在米家完善所选成员的性别、生日和身高，再认领体脂记录。",
            ));
        };
        Ok(Some(json!({"version":"235","list":[{
            "age":age,"sex":sex,"height":(height*10.0).trunc() as u64,"weight":(self.weight*10.0).trunc() as u64,
            "electrodes_number":4,"res_mapping_switch":0,"current_impedance":[first*10.0,second*10.0]
        }]})))
    }

    pub(crate) fn claimed(&self, user: &Value, calculated: Option<&Value>) -> Value {
        let mut data = if integer(&self.row["fromSource"]) == Some(3) {
            let mut converted = json!({"miid":user["uid"],"duid":user["accountCode"],"userType":user["type"],"status":0,"idx":-1});
            for &field in BODY_FIELDS
                .iter()
                .chain(["bodyRes", "bodyRes2", "time"].iter())
            {
                if let Some(value) = number(&self.data[field], f64::MAX) {
                    converted[field] = json!(value);
                }
            }
            converted
        } else {
            self.data.clone()
        };
        if let Some(values) = calculated {
            for &field in BODY_FIELDS.iter().filter(|&&field| field != "heartRate") {
                if let Some(value) = number(&values[field], f64::MAX) {
                    data[field] = json!(value);
                }
            }
            if let Some(fields) = data.as_object_mut() {
                fields.remove("bodyResData");
            }
        }
        for field in ["heartRate", "time"] {
            if let Some(value) = number(&data[field], u64::MAX as f64) {
                data[field] = json!(value.trunc() as u64);
            }
        }
        data["weight"] = json!(self.weight);
        data["user"] = user.clone();
        data["reportFrom"] = json!("Claimed");
        data
    }

    pub(crate) fn payload(
        &self,
        device: &Device,
        uid: &str,
        user: &Value,
        claimed: Option<&Value>,
    ) -> Value {
        let data = claimed.unwrap_or(&self.row["data"]);
        let data = data
            .as_str()
            .map(str::to_owned)
            .unwrap_or_else(|| data.to_string());
        let owner = if user["uid"].is_null() {
            json!(uid)
        } else {
            user["uid"].clone()
        };
        json!({"uid":owner,"accountId":user["accountId"],"did":device.control_did(),"model":device.model,
            "dataVersion":1,"fromSource":2,"sn":id(&self.row["sn"]),"data":data,"createTime":self.time_ms})
    }
}

pub(crate) fn calculated_reading(rows: &Value) -> Result<&Value> {
    let [reading] = rows
        .as_array()
        .map(Vec::as_slice)
        .ok_or_else(AppError::protocol)?
    else {
        return Err(AppError::protocol());
    };
    number(&reading["bfp"], 100.0)
        .map(|_| reading)
        .ok_or_else(AppError::protocol)
}
