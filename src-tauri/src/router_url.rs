//! rn02 11288/11294 and helper 10148. URL filtering is not Wi-Fi admission.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
#[cfg(test)]
#[path = "router_url_tests.rs"]
mod tests;
pub const STATUS: &str = "/appgateway/third/miwifi/app/r/api/misystem/netacctl_status";
pub const LIST: &str = "/appgateway/third/miwifi/app/r/api/misystem/parctl_get_url";
pub const SET_MODE: &str = "/appgateway/third/miwifi/app/r/api/misystem/parctl_set_filter";
pub const EDIT: &str = "/appgateway/third/miwifi/app/r/api/misystem/parctl_set_url";
pub(crate) fn is_read_path(path: &str) -> bool {
    [STATUS, LIST].contains(&path)
}
pub(crate) fn is_write_path(path: &str) -> bool {
    [SET_MODE, EDIT].contains(&path)
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    None,
    Black,
    White,
}
impl Mode {
    fn wire(self) -> &'static str {
        match self {
            Self::None => "none",
            Self::Black => "black",
            Self::White => "white",
        }
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub mac: String,
    pub revision: String,
    pub available: bool,
    pub reason: Option<String>,
    pub mode: Option<Mode>,
    pub black: Vec<String>,
    pub white: Vec<String>,
    pub write_reason: Option<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    Mode {
        value: Mode,
    },
    Add {
        list: Mode,
        url: String,
    },
    Update {
        list: Mode,
        url: String,
        new_url: String,
    },
    Delete {
        list: Mode,
        urls: Vec<String>,
    },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub baseline: String,
    pub mac: String,
    pub operation: Operation,
}
#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub change: Change,
    mode: Mode,
    black: Vec<String>,
    white: Vec<String>,
}
#[derive(Serialize)]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
}
#[derive(Serialize)]
pub struct Outcome {
    pub status: String,
    pub message: String,
    pub report: Option<Report>,
}
pub(crate) fn success(v: &Value) -> Result<()> {
    if v["code"] == 0 || v["code"] == "0" {
        Ok(())
    } else {
        Err(AppError::new(
            "routerGateway",
            "路由器未接受网址访问控制请求。",
            false,
        ))
    }
}
fn bit(v: &Value) -> bool {
    v == 1 || v == "1" || v == true
}
fn cap(init: &Value, row: &Value, key: &str) -> bool {
    bit(&row["capabilities"][key])
        || init["features"]
            .as_object()
            .is_some_and(|m| m.values().any(|g| bit(&g[key])))
}
pub(crate) fn family_protection(init: &Value, row: &Value) -> Result<bool> {
    if cap(init, row, "mipctlv2") {
        return Ok(true);
    }
    let threshold = match &row["capabilities"]["parental_control"] {
        Value::String(s) => s.clone(),
        Value::Number(n) => n.to_string(),
        _ => return Ok(false),
    };
    // Legacy isSupportParentalControlOld uses a firmware threshold and parseFloat.
    let prefix = threshold.split('.').take(2).collect::<Vec<_>>().join(".");
    if !prefix.parse::<f64>().is_ok_and(|n| n > 0.0) {
        return Ok(false);
    }
    let parse = |s: &str| -> Result<Vec<u64>> {
        s.split('.')
            .map(|part| part.parse().map_err(|_| AppError::protocol()))
            .collect()
    };
    let current = parse(row["rom"].as_str().ok_or_else(AppError::protocol)?)?;
    let minimum = parse(&threshold)?;
    for i in 0..current.len().max(minimum.len()) {
        let a = current.get(i).copied().unwrap_or(0);
        let b = minimum.get(i).copied().unwrap_or(0);
        if a != b {
            return Ok(a > b);
        }
    }
    Ok(true)
}
fn safe_text(s: &str) -> bool {
    !s.is_empty() && s.len() <= 512 && !s.chars().any(|c| c.is_control() || c == ',')
}
/// Original isValidDomain regex, with a bounded ASCII/comma boundary for batch encoding.
pub fn valid_domain(s: &str) -> bool {
    if s.len() > 253 || s.len() < 3 || !s.bytes().all(|b| b.is_ascii_graphic() && b != b',') {
        return false;
    }
    let b = s.as_bytes();
    let allowed = |c: u8| c.is_ascii_alphanumeric() || b"-:;?#_".contains(&c);
    let mut reachable = vec![false; b.len() + 1];
    let mut first = 0;
    while first < b.len() && b[first].is_ascii_alphanumeric() {
        first += 1;
        reachable[first] = true;
    }
    let mut grouped = vec![false; b.len() + 1];
    for i in 1..b.len() {
        if reachable[i] || grouped[i] {
            let mut j = i + 1;
            while j < b.len() && allowed(b[j]) {
                j += 1;
                grouped[j] = true;
            }
        }
    }
    grouped[b.len()]
}
fn list(v: &Value) -> Result<Vec<String>> {
    success(v)?;
    let a = v["list"]
        .as_array()
        .filter(|a| a.len() <= 1024)
        .ok_or_else(AppError::protocol)?;
    let mut result = vec![];
    for v in a {
        let s = v
            .as_str()
            .filter(|s| safe_text(s))
            .ok_or_else(AppError::protocol)?;
        if result.iter().any(|v| v == s) {
            return Err(AppError::protocol());
        }
        result.push(s.to_owned());
    }
    Ok(result)
}
fn revision(r: &Report) -> Result<String> {
    let mut black = r.black.clone();
    black.sort();
    let mut white = r.white.clone();
    white.sort();
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(&json!({"did":r.did,"mac":r.mac.to_ascii_lowercase(),"mode":r.mode,"black":black,"white":white,"available":r.available,"reason":r.write_reason})).map_err(|_|AppError::protocol())?)))
}
pub fn parse(
    device: &Device,
    mac: &str,
    status: &Value,
    black: &Value,
    white: &Value,
    write_reason: Option<String>,
) -> Result<Report> {
    router::gateway_id(device)?;
    if !crate::router_client_name::valid_mac(mac) {
        return Err(AppError::invalid("设备标识无效。"));
    }
    success(status)?;
    let mode: Mode = serde_json::from_value(status["status"]["urlfilter"]["mode"].clone())
        .map_err(|_| AppError::protocol())?;
    let black = list(black)?;
    let white = list(white)?;
    let count = status["status"]["urlfilter"]["count"]
        .as_u64()
        .ok_or_else(AppError::protocol)?;
    let consistent = match mode {
        Mode::None => true,
        Mode::Black => count == black.len() as u64,
        Mode::White => count == white.len() as u64,
    };
    let write_reason = write_reason
        .or_else(|| (!consistent).then(|| "网址模式与名单数量尚未一致，请稍后再操作。".into()));
    let mut r = Report {
        did: device.did.clone(),
        model: device.model.clone(),
        mac: mac.into(),
        revision: String::new(),
        available: true,
        reason: None,
        mode: Some(mode),
        black,
        white,
        write_reason,
    };
    r.revision = revision(&r)?;
    Ok(r)
}
pub async fn load(cloud: &Cloud, device: &Device, mac: &str) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !crate::router_client_name::valid_mac(mac) {
        return Err(AppError::invalid("设备标识无效。"));
    }
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (init,routers,clients)=tokio::try_join!(cloud.request_router_read(router::INIT,json!({"method":"POST","params":{"deviceId":id}})),cloud.request_router_read(router::ROUTERS,json!({"method":"GET","params":{"deviceId":id}})),cloud.request_router_read(router::CLIENTS,json!({"method":"GET","params":{"deviceId":id,"routerID":id,"locale":"zh_CN","v":"2","refresh":"1"}})))?;
    success(&init)?;
    success(&routers)?;
    success(&clients)?;
    let rows = routers["deviceList"]
        .as_array()
        .ok_or_else(AppError::protocol)?
        .iter()
        .filter(|r| r["id"].as_str() == Some(id))
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err(AppError::protocol());
    }
    let row = rows[0];
    let matches = clients["devices"]
        .as_array()
        .ok_or_else(AppError::protocol)?
        .iter()
        .filter(|c| {
            c["mac"]
                .as_str()
                .is_some_and(|m| m.eq_ignore_ascii_case(mac))
        })
        .collect::<Vec<_>>();
    if matches.len() != 1 {
        return Err(AppError::invalid("设备已不在当前路由器列表中。"));
    }
    let client = matches[0];
    let connection = client["connectionType"]
        .as_u64()
        .or_else(|| client["connectionType"].as_str()?.parse().ok());
    let work = row["work_mode"]
        .as_u64()
        .or_else(|| row["work_mode"].as_str()?.parse().ok());
    let parent = family_protection(&init, row)?;
    let reason = if work != Some(0) {
        Some("当前中继模式或工作模式尚未确认，访问控制不可用。")
    } else if connection == Some(3) {
        Some("访客设备不提供此访问控制。")
    } else if connection.is_none() {
        Some("设备连接类型尚未确认。")
    } else if client["miot_id"].as_str().is_some_and(|s| !s.is_empty()) {
        Some("中继设备不提供此访问控制。")
    } else if parent {
        Some("此路由器使用家人上网保护，旧版网址访问控制不适用。")
    } else {
        None
    };
    if let Some(reason) = reason {
        let mut r = Report {
            did: device.did.clone(),
            model: device.model.clone(),
            mac: mac.into(),
            revision: String::new(),
            available: false,
            reason: Some(reason.into()),
            mode: None,
            black: vec![],
            white: vec![],
            write_reason: Some(reason.into()),
        };
        r.revision = revision(&r)?;
        return Ok(r);
    }
    let request = |path, mode: Option<&str>| {
        let mut params = json!({"deviceId":id,"mac":mac});
        if let Some(mode) = mode {
            params["mode"] = json!(mode);
        }
        cloud.request_router_read(path, json!({"method":"GET","params":params}))
    };
    let (status, black, white) = tokio::try_join!(
        request(STATUS, None),
        request(LIST, Some("black")),
        request(LIST, Some("white"))
    )?;
    parse(
        device,
        mac,
        &status,
        &black,
        &white,
        device
            .shared_read_only
            .then(|| "此共享设备只有读取权限。".into()),
    )
}
pub(crate) fn prepare(
    device: &Device,
    r: &Report,
    c: &Change,
) -> Result<(&'static str, Value, Pending)> {
    crate::router_indicator::writable(device)?;
    if !r.available {
        return Err(AppError::new(
            "unsupported",
            r.reason
                .clone()
                .unwrap_or_else(|| "网址访问控制不可用。".into()),
            false,
        ));
    }
    if let Some(reason) = &r.write_reason {
        return Err(AppError::new("unavailable", reason, false));
    }
    if r.did != device.did
        || r.model != device.model
        || !r.mac.eq_ignore_ascii_case(&c.mac)
        || c.baseline != r.revision
    {
        return Err(AppError::new(
            "conflict",
            "网址访问控制已变化，请核对当前设置。",
            false,
        ));
    }
    let mut p = Pending {
        change: c.clone(),
        mode: r.mode.ok_or_else(AppError::protocol)?,
        black: r.black.clone(),
        white: r.white.clone(),
    };
    let mut params = json!({"deviceId":router::gateway_id(device)?,"mac":r.mac});
    let path;
    match &c.operation {
        Operation::Mode { value } => {
            p.mode = *value;
            path = SET_MODE;
            params["mode"] = json!(value.wire());
        }
        op => {
            let (mode, url, new_url, opt) = match op {
                Operation::Add { list, url } => (*list, url.clone(), None, "0"),
                Operation::Update { list, url, new_url } => {
                    (*list, url.clone(), Some(new_url), "2")
                }
                Operation::Delete { list, urls } => {
                    if urls.is_empty()
                        || urls.len() > 1024
                        || urls.iter().any(|s| !safe_text(s))
                        || urls.iter().collect::<std::collections::HashSet<_>>().len() != urls.len()
                    {
                        return Err(AppError::invalid("待删除的网址列表无效。"));
                    }
                    (*list, urls.join(","), None, "1")
                }
                _ => unreachable!(),
            };
            let target = match mode {
                Mode::Black => &mut p.black,
                Mode::White => &mut p.white,
                Mode::None => return Err(AppError::invalid("网址名单类型无效。")),
            };
            match op {
                Operation::Add { .. } => {
                    if !valid_domain(&url) || target.contains(&url) || target.len() >= 1024 {
                        return Err(AppError::invalid("网址格式无效或列表中已存在该地址。"));
                    }
                    target.push(url.clone());
                }
                Operation::Update { .. } => {
                    let new = new_url.unwrap();
                    if !valid_domain(new)
                        || !target.contains(&url)
                        || new != &url && target.contains(new)
                    {
                        return Err(AppError::invalid("网址格式无效或原地址已经变化。"));
                    }
                    let index = target.iter().position(|s| s == &url).unwrap();
                    target[index] = new.clone();
                }
                Operation::Delete { urls, .. } => {
                    if urls.iter().any(|s| !target.contains(s)) {
                        return Err(AppError::new("conflict", "待删除的网址已发生变化。", false));
                    }
                    target.retain(|s| !urls.contains(s));
                }
                _ => unreachable!(),
            }
            path = EDIT;
            params["mode"] = json!(mode.wire());
            params["opt"] = json!(opt);
            params["url"] = json!(url);
            if let Some(new) = new_url {
                params["newurl"] = json!(new);
            }
        }
    }
    Ok((path, json!({"method":"GET","params":params}), p))
}
pub(crate) fn confirmed(r: &Report, p: &Pending) -> bool {
    fn same(a: &[String], b: &[String]) -> bool {
        let mut a = a.to_vec();
        a.sort();
        let mut b = b.to_vec();
        b.sort();
        a == b
    }
    r.available
        && r.write_reason.is_none()
        && r.mode == Some(p.mode)
        && r.mac.eq_ignore_ascii_case(&p.change.mac)
        && same(&r.black, &p.black)
        && same(&r.white, &p.white)
}
