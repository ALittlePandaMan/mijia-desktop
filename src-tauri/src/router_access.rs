//! rn02 11162/11174/11360: Wi-Fi admission, separate from URL/time controls.
#[cfg(test)]
#[path = "router_access_tests.rs"]
mod tests;
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};
pub const STATUS: &str = "/appgateway/third/miwifi/app/r/api/misystem/arn_status";
pub const PROTECTION: &str = "/appgateway/third/miwifi/app/s/api/get_protection_status";
pub const SWITCH: &str = "/appgateway/third/miwifi/app/r/api/misystem/arn_switch";
pub const EDIT: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/edit_device";
pub(crate) fn is_read_path(path: &str) -> bool {
    [STATUS, PROTECTION].contains(&path)
}
pub(crate) fn is_write_path(path: &str) -> bool {
    [SWITCH, EDIT].contains(&path)
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub mac: String,
    pub name: String,
    pub connection: Option<u8>,
    pub online: Option<bool>,
    pub member: bool,
    pub protected: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub on: bool,
    pub mode: u8,
    pub level: u8,
    pub wifi_level: Option<u8>,
    pub admin_level: Option<u8>,
    pub duration: Option<u64>,
    pub whitelist_supported: bool,
    pub records_supported: bool,
    pub local_checked: bool,
    pub entries: Vec<Entry>,
    pub write_reason: Option<String>,
    pub warnings: Vec<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Membership { mac: String, add: bool },
    Switch { on: bool },
    Level { value: u8 },
    BlackMode,
    WhiteMode,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub baseline: String,
    pub operation: Operation,
}
#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub change: Change,
    pub target: Value,
    pub white: Option<crate::router_whitelist::Transaction>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
    pub white_progress: Option<crate::router_whitelist::Progress>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: String,
    pub message: String,
    pub report: Option<Report>,
    pub white_progress: Option<crate::router_whitelist::Progress>,
}
fn integer(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn bit(v: &Value) -> Result<bool> {
    match integer(v) {
        Some(0) => Ok(false),
        Some(1) => Ok(true),
        _ => v.as_bool().ok_or_else(AppError::protocol),
    }
}
fn success(v: &Value) -> Result<()> {
    if integer(&v["code"]) == Some(0) {
        Ok(())
    } else {
        Err(AppError::protocol())
    }
}
fn level(v: &Value) -> Option<u8> {
    integer(v).filter(|n| (1..=3).contains(n)).map(|n| n as u8)
}
fn text(v: &Value) -> Option<String> {
    v.as_str()
        .filter(|s| s.len() <= 512 && !s.chars().any(char::is_control))
        .map(str::to_owned)
}
fn cap(init: &Value, row: &Value, key: &str) -> bool {
    init["features"]
        .as_object()
        .is_some_and(|g| g.values().any(|v| bit(&v[key]).ok() == Some(true)))
        || bit(&row["capabilities"][key]).ok() == Some(true)
}
pub(crate) fn parse(
    device: &Device,
    environment: (&Value, &Value),
    status: &Value,
    filter: &Value,
    protection: Option<&Value>,
    clients: &[router::RouterClient],
    local: Option<&[String]>,
) -> Result<Report> {
    let (init, row) = environment;
    success(status)?;
    success(filter)?;
    let on = bit(&status["open"])?;
    let enabled = bit(&filter["enable"])?;
    let mode = integer(&filter["model"])
        .filter(|v| *v <= 1)
        .ok_or_else(AppError::protocol)? as u8;
    let security = level(&status["level"]).ok_or_else(AppError::protocol)?;
    let status_mode = integer(&status["wifimode"]);
    let consistent = on == enabled && (!on || status_mode == Some(u64::from(mode) + 1));
    let mut members = HashSet::new();
    let mut names = BTreeMap::new();
    for v in filter["macfilter"]
        .as_array()
        .filter(|a| a.len() <= 4096)
        .ok_or_else(AppError::protocol)?
    {
        let mac = v
            .as_str()
            .or_else(|| v["mac"].as_str())
            .filter(|m| crate::router_client_name::valid_mac(m))
            .ok_or_else(AppError::protocol)?
            .to_ascii_lowercase();
        if !members.insert(mac.clone()) {
            return Err(AppError::protocol());
        }
        names.insert(mac, text(&v["name"]).unwrap_or_default());
    }
    let mut entries = BTreeMap::new();
    for c in clients {
        if !crate::router_client_name::valid_mac(&c.mac) {
            continue;
        }
        let mac = c.mac.to_ascii_lowercase();
        entries.insert(
            mac.clone(),
            Entry {
                mac: mac.clone(),
                name: c.name.clone(),
                connection: c.connection,
                online: c.online,
                member: members.contains(&mac),
                protected: local
                    .is_some_and(|list| list.iter().any(|m| m.eq_ignore_ascii_case(&mac))),
            },
        );
    }
    for mac in &members {
        entries.entry(mac.clone()).or_insert_with(|| Entry {
            mac: mac.clone(),
            name: names
                .get(mac)
                .filter(|s| !s.is_empty())
                .cloned()
                .unwrap_or_else(|| mac.clone()),
            connection: None,
            online: None,
            member: true,
            protected: local.is_some_and(|list| list.iter().any(|m| m.eq_ignore_ascii_case(mac))),
        });
    }
    let write_reason = if device.shared_read_only {
        Some("此共享设备只有读取权限。")
    } else if !device.online {
        Some("路由器已离线。")
    } else if integer(&row["work_mode"]) != Some(0) {
        Some("中继模式或工作模式尚未确认，防蹭网不可修改。")
    } else if !consistent {
        Some("防蹭网与过滤名单状态尚未一致，正在等待更新。")
    } else {
        None
    }
    .map(str::to_owned);
    let mut r = Report {
        did: device.did.clone(),
        model: device.model.clone(),
        revision: String::new(),
        on,
        mode,
        level: security,
        wifi_level: level(&status["wifilevel"]),
        admin_level: level(&status["adminlevel"]),
        duration: protection
            .filter(|p| {
                integer(&p["code"]) == Some(0) && bit(&p["protection_enabled"]).ok() == Some(true)
            })
            .and_then(|p| integer(&p["duration"])),
        whitelist_supported: cap(init, row, "whitelist"),
        records_supported: crate::router_block_records::supported(init, row),
        local_checked: local.is_some_and(|rows| !rows.is_empty()),
        entries: entries.into_values().collect(),
        write_reason,
        warnings: vec![],
    };
    // Duration and live client metadata change frequently. Only admission inputs
    // belong to the optimistic write baseline.
    r.revision=format!("{:x}",Sha256::digest(serde_json::to_vec(&json!({"on":r.on,"mode":r.mode,"level":r.level,"members":r.entries.iter().filter(|e|e.member).map(|e|&e.mac).collect::<Vec<_>>(),"work":row["work_mode"],"whitelist":r.whitelist_supported})).map_err(|_|AppError::protocol())?));
    Ok(r)
}
pub async fn load(cloud: &Cloud, device: &Device) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (init, routers, status, filter, protection, clients, local) = tokio::join!(
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        ),
        cloud.request_router_read(STATUS, json!({"method":"GET","params":{"deviceId":id}})),
        cloud.request_router_read(
            router::FILTER,
            json!({"method":"GET","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            PROTECTION,
            json!({"method":"GET","params":{"deviceId":id,"routerID":id}})
        ),
        router::read_clients(cloud, device),
        crate::router_connection::local_macs()
    );
    let init = init?;
    success(&init)?;
    let routers = routers?;
    success(&routers)?;
    let rows = routers["deviceList"]
        .as_array()
        .ok_or_else(AppError::protocol)?;
    let matching = rows
        .iter()
        .filter(|r| r["id"].as_str() == Some(id))
        .collect::<Vec<_>>();
    if matching.len() != 1 {
        return Err(AppError::protocol());
    }
    if protection.as_ref().is_err_and(|e| e.kind == "authExpired") {
        return Err(AppError::auth());
    }
    parse(
        device,
        (&init, matching[0]),
        &status?,
        &filter?,
        protection.as_ref().ok(),
        &clients?,
        local.as_deref(),
    )
}
pub fn member_reason(r: &Report, e: &Entry, add: bool) -> Option<String> {
    if let Some(reason) = &r.write_reason {
        return Some(reason.clone());
    }
    if !r.on {
        return Some("把设备拉入名单之前需要开启防蹭网功能。".into());
    }
    if e.connection == Some(4) {
        return Some("该设备为有线设备，无需设置Wi-Fi接入名单。".into());
    }
    if !r.local_checked {
        return Some("尚未核对本机网卡，暂不能修改名单。".into());
    }
    if e.protected && (r.mode == 0 && add || r.mode == 1 && !add) {
        return Some("不可对当前电脑进行此操作。".into());
    }
    if r.mode == 1 && !add && r.entries.iter().filter(|e| e.member).count() <= 1 {
        return Some(
            "当前白名单为空会导致所有设备无法通过Wi-Fi连接路由器，请先保留至少一台设备。".into(),
        );
    }
    None
}
pub(crate) fn prepare(
    device: &Device,
    r: &Report,
    c: &Change,
) -> Result<(&'static str, Value, Pending)> {
    crate::router_indicator::writable(device)?;
    if let Some(reason) = &r.write_reason {
        return Err(AppError::new("unavailable", reason, false));
    }
    if r.revision != c.baseline {
        return Err(AppError::new(
            "conflict",
            "防蹭网或名单已变化，请核对当前设置。",
            false,
        ));
    }
    let (path, mut params, target) = match &c.operation {
        Operation::WhiteMode => return Err(AppError::invalid("白名单切换需要本地连接核对。")),
        Operation::Membership { mac, add } => {
            let e = r.entries.iter().find(|e| e.mac.eq_ignore_ascii_case(mac));
            let manual;
            let e = if let Some(e) = e {
                e
            } else if r.mode == 1 && *add && crate::router_client_name::valid_mac(mac) {
                manual = Entry {
                    mac: mac.to_ascii_lowercase(),
                    name: mac.clone(),
                    connection: None,
                    online: None,
                    member: false,
                    protected: false,
                };
                &manual
            } else {
                return Err(AppError::invalid("设备已不在当前列表中。"));
            };
            if let Some(reason) = member_reason(r, e, *add) {
                return Err(AppError::new("unavailable", reason, false));
            }
            (
                EDIT,
                json!({"mac":e.mac,"option":if *add{"0"}else{"1"},"model":r.mode.to_string()}),
                json!({"mode":r.mode,"on":r.on,"member":add,"mac":e.mac}),
            )
        }
        Operation::Switch { on } => {
            // 11360 changeSwitchStatus explicitly uses mode=0 even from white.
            (
                SWITCH,
                json!({"open":if *on{"1"}else{"0"},"level":r.level,"mode":"0"}),
                json!({"on":on,"mode":0,"level":r.level}),
            )
        }
        Operation::Level { value } => {
            if !r.on || r.mode != 0 || !(1..=3).contains(value) {
                return Err(AppError::invalid("当前模式不能设置此安全等级。"));
            }
            (
                SWITCH,
                json!({"open":"1","mode":"0","level":value}),
                json!({"on":true,"mode":0,"level":value}),
            )
        }
        Operation::BlackMode => {
            if !r.on {
                return Err(AppError::invalid("请先开启防蹭网。"));
            }
            (
                SWITCH,
                json!({"open":"1","mode":"0"}),
                json!({"on":true,"mode":0}),
            )
        }
    };
    params["deviceId"] = json!(router::gateway_id(device)?);
    Ok((
        path,
        json!({"method":"GET","params":params}),
        Pending {
            change: c.clone(),
            target,
            white: None,
        },
    ))
}
pub(crate) fn confirmed(r: &Report, p: &Pending) -> bool {
    if r.write_reason.is_some() {
        return false;
    }
    match &p.change.operation {
        Operation::WhiteMode => {
            r.on && r.mode == 1
                && p.white.as_ref().is_some_and(|t| {
                    r.entries
                        .iter()
                        .any(|e| e.member && e.mac.eq_ignore_ascii_case(&t.mac))
                })
        }
        Operation::Membership { mac, add } => {
            r.mode == p.target["mode"]
                && r.on
                && r.entries
                    .iter()
                    .any(|e| e.mac.eq_ignore_ascii_case(mac) && e.member)
                    == *add
        }
        _ => {
            r.on == p.target["on"]
                && r.mode == p.target["mode"]
                && p.target.get("level").is_none_or(|v| r.level == *v)
        }
    }
}
