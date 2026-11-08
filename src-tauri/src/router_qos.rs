//! rn02 modules 11165/11168/11219/11225. Mbps, MiB/s and KiB/s are distinct.
#[cfg(test)]
#[path = "router_qos_tests.rs"]
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
pub const INFO: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_info_new";
pub const DEVICE: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_dev_info";
pub const FLAG: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_limit_flag";
pub const LIMIT: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_set_dev_info";
pub const SWITCH: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_switch";
pub const MODE: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_mode";
pub const BAND: &str = "/appgateway/third/miwifi/app/r/api/misystem/set_band";
pub const GUEST: &str = "/appgateway/third/miwifi/app/r/api/misystem/qos_guest";
pub const DUAL: &str = "/appgateway/third/miwifi/app/r/api/xqnetdetect/nettb2";
pub(crate) fn is_read_path(path: &str) -> bool {
    [INFO, DEVICE, DUAL].contains(&path)
}
pub(crate) fn is_write_path(path: &str) -> bool {
    [FLAG, LIMIT, SWITCH, MODE, BAND, GUEST].contains(&path)
}
#[derive(Clone, Debug, Serialize, PartialEq)]
pub struct Rates {
    pub upload: f64,
    pub download: f64,
}
#[derive(Clone, Debug, Serialize)]
pub struct Client {
    pub mac: String,
    pub on: bool,
    pub band: Rates,
    pub limit: Rates,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub on: bool,
    pub mode: u8,
    pub band: Rates,
    pub guest: Option<Rates>,
    pub ai: bool,
    pub client_supported: bool,
    pub client: Option<Client>,
    pub write_reason: Option<String>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Switch { on: bool },
    Band { upload: String, download: String },
    Mode { value: u8 },
    Device { on: bool },
    Limit { direction: Direction, ticks: u16 },
    Guest { direction: Direction, ticks: u16 },
}
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Direction {
    Upload,
    Download,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub baseline: String,
    pub mac: Option<String>,
    pub operation: Operation,
}
#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub change: Change,
    pub target: Value,
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
fn number(v: &Value) -> Result<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|v| v.is_finite() && *v >= 0.0)
        .ok_or_else(AppError::protocol)
}
fn bit(v: &Value) -> Result<bool> {
    match v {
        Value::Bool(b) => Ok(*b),
        _ => match number(v)? {
            0.0 => Ok(false),
            1.0 => Ok(true),
            _ => Err(AppError::protocol()),
        },
    }
}
fn success(v: &Value) -> Result<()> {
    if number(&v["code"])? == 0.0 {
        Ok(())
    } else {
        Err(AppError::new(
            "routerGateway",
            "路由器未接受智能限速请求。",
            false,
        ))
    }
}
fn rates(v: &Value, up: &str, down: &str) -> Result<Rates> {
    Ok(Rates {
        upload: number(&v[up])?,
        download: number(&v[down])?,
    })
}
fn cap(init: &Value, row: &Value, name: &str) -> bool {
    init["features"]
        .as_object()
        .is_some_and(|groups| groups.values().any(|g| bit(&g[name]).ok() == Some(true)))
        || bit(&row["capabilities"][name]).ok() == Some(true)
}
fn round3(v: f64) -> f64 {
    (v * 1000.0).round() / 1000.0
}
// Plugin getFloat(...,3) returns a fixed-decimal STRING on the wire.
fn fixed(v: f64) -> String {
    format!("{:.3}", round3(v))
}
pub fn percentage(limit: f64, mbps: f64) -> f64 {
    let base = round3(mbps / 8.0);
    let ratio = round3(round3(limit / 1024.0) / base);
    if ratio.is_finite() && ratio > 0.000001 && ratio <= 1.0 {
        ratio * 100.0
    } else {
        100.0
    }
}
fn client_rate(limit: f64, mbps: f64, ticks: Option<u16>) -> f64 {
    let ratio = ticks
        .map(|t| f64::from(t) / 1000.0)
        .unwrap_or_else(|| percentage(limit, mbps) / 100.0);
    round3(round3(ratio * round3(mbps / 8.0)) * 1024.0)
}
pub fn bandwidth(upload: &str, download: &str) -> Result<Rates> {
    let parse = |s: &str| -> Option<f64> {
        if s.is_empty() || s.len() > 9 || !s.bytes().all(|c| c.is_ascii_digit() || c == b'.') {
            return None;
        }
        let parts = s.split('.').collect::<Vec<_>>();
        if parts.len() > 2
            || parts[0].is_empty()
            || parts[0].len() > 1 && parts[0].starts_with('0')
            || parts.get(1).is_some_and(|s| s.is_empty() || s.len() > 2)
        {
            return None;
        }
        s.parse::<f64>().ok().filter(|n| n.is_finite())
    };
    let r = Rates {
        upload: parse(upload)
            .ok_or_else(|| AppError::invalid("请输入正确的上传带宽，最多两位小数。"))?,
        download: parse(download)
            .ok_or_else(|| AppError::invalid("请输入正确的下载带宽，最多两位小数。"))?,
    };
    if !(0.01..=10000.0).contains(&r.upload) || !(8.0..=10000.0).contains(&r.download) {
        return Err(AppError::invalid(
            "上传带宽需为0.01至10000 Mbps，下载带宽需为8至10000 Mbps。",
        ));
    }
    Ok(r)
}
pub(crate) fn parse(
    device: &Device,
    init: &Value,
    row: &Value,
    dual: Option<bool>,
    info: &Value,
    client: Option<(&str, &Value)>,
) -> Result<Report> {
    success(info)?;
    let band = rates(&info["band"], "upload", "download")?;
    let on = bit(&info["status"]["on"])?;
    let mode = number(&info["status"]["mode"])?;
    if mode.fract() != 0.0 || mode > 6.0 || band.upload > 10000.0 || band.download > 10000.0 {
        return Err(AppError::protocol());
    }
    let guest = if info["guest"].is_object()
        && !info["guest"]["percent_up"].is_null()
        && !info["guest"]["percent"].is_null()
    {
        let r = rates(&info["guest"], "percent_up", "percent")?;
        if r.upload > 1.0 || r.download > 1.0 {
            None
        } else {
            Some(r)
        }
    } else {
        None
    };
    let client = client
        .map(|(mac, raw)| -> Result<Client> {
            success(raw)?;
            let limit = rates(&raw["limit"], "upmax", "downmax")?;
            let band = rates(&raw["band"], "upload", "download")?;
            let on = match raw["limit"]["flag"].as_str() {
                Some("on") => true,
                Some("off") => false,
                _ => return Err(AppError::protocol()),
            };
            if band.upload > 10000.0
                || band.download > 10000.0
                || limit.upload > 1280000.0
                || limit.download > 1280000.0
            {
                return Err(AppError::protocol());
            }
            Ok(Client {
                mac: mac.into(),
                on,
                band,
                limit,
            })
        })
        .transpose()?;
    let work = number(&row["work_mode"]).ok();
    let write_reason = if device.shared_read_only {
        Some("此共享设备只有读取权限。")
    } else if !device.online {
        Some("路由器已离线。")
    } else if work != Some(0.0) {
        Some("当前中继模式或工作模式未确认，智能限速不可修改。")
    } else if dual == Some(true) {
        Some("此功能与双WAN功能冲突，请先在路由Web页面关闭双WAN功能。")
    } else {
        None
    }
    .map(str::to_owned);
    let mut r = Report {
        did: device.did.clone(),
        model: device.model.clone(),
        revision: String::new(),
        on,
        mode: mode as u8,
        band,
        guest,
        ai: cap(init, row, "aiqos"),
        client_supported: cap(init, row, "qos_device_switch"),
        client,
        write_reason,
    };
    r.revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&r).map_err(|_| AppError::protocol())?)
    );
    Ok(r)
}
pub async fn load(cloud: &Cloud, device: &Device, mac: Option<&str>) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    if mac.is_some_and(|m| !crate::router_client_name::valid_mac(m)) {
        return Err(AppError::invalid("设备标识无效。"));
    }
    let (init, routers, clients) = tokio::join!(
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        ),
        router::read_clients(cloud, device)
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
    let row = matching[0];
    let clients = clients?;
    if mac.is_some_and(|m| crate::router_client_name::select(&clients, m).is_none()) {
        return Err(AppError::invalid("设备已不在路由器列表中。"));
    }
    let macs = clients
        .iter()
        .map(|c| c.mac.as_str())
        .collect::<Vec<_>>()
        .join(";");
    let info = cloud
        .request_router_read(
            INFO,
            json!({"method":"GET","params":{"deviceId":id,"macs":macs}}),
        )
        .await?;
    let dual = if cap(&init, row, "Dual_WAN") {
        let raw = cloud
            .request_router_read(DUAL, json!({"method":"GET","params":{"deviceId":id}}))
            .await?;
        success(&raw)?;
        Some(bit(&raw["on"])?)
    } else {
        None
    };
    let raw = if let Some(mac) = mac {
        Some(
            cloud
                .request_router_read(
                    DEVICE,
                    json!({"method":"GET","params":{"deviceId":id,"mac":mac}}),
                )
                .await?,
        )
    } else {
        None
    };
    parse(device, &init, row, dual, &info, mac.zip(raw.as_ref()))
}
pub(crate) fn prepare(
    device: &Device,
    r: &Report,
    change: &Change,
) -> Result<(&'static str, Value, Pending)> {
    crate::router_indicator::writable(device)?;
    if let Some(reason) = &r.write_reason {
        return Err(AppError::new("unavailable", reason, false));
    }
    if change.baseline != r.revision {
        return Err(AppError::new(
            "conflict",
            "智能限速设置已变化，请核对当前状态后再操作。",
            false,
        ));
    }
    let device_op = matches!(
        change.operation,
        Operation::Device { .. } | Operation::Limit { .. }
    );
    if device_op != change.mac.is_some()
        || device_op
            && r.client
                .as_ref()
                .zip(change.mac.as_ref())
                .is_none_or(|(c, m)| !c.mac.eq_ignore_ascii_case(m))
    {
        return Err(AppError::invalid("限速操作与当前设备不匹配。"));
    }
    if device_op && !r.client_supported {
        return Err(AppError::new(
            "unavailable",
            "当前固件未提供单设备智能限速能力。",
            false,
        ));
    }
    let enabled = || -> Result<()> {
        if r.on {
            Ok(())
        } else {
            Err(AppError::new(
                "unavailable",
                "运行智能限速前需要开启智能限速功能。",
                false,
            ))
        }
    };
    let id = router::gateway_id(device)?;
    let (path, mut params, target) = match &change.operation {
        Operation::Switch { on } => {
            if *on
                && (!(0.01..=10000.0).contains(&r.band.upload)
                    || !(8.0..=10000.0).contains(&r.band.download))
            {
                return Err(AppError::invalid("请先设置有效的上传和下载带宽。"));
            }
            (SWITCH, json!({"on":u8::from(*on)}), json!(on))
        }
        Operation::Band { upload, download } => {
            let band = bandwidth(upload, download)?;
            (
                BAND,
                json!({"upload":upload,"download":download,"manual":1}),
                json!(band),
            )
        }
        Operation::Mode { value } => {
            enabled()?;
            if r.ai || ![3, 4, 5, 6].contains(value) {
                return Err(AppError::invalid("当前路由器不支持此应用优先级。"));
            }
            (MODE, json!({"mode":value}), json!(value))
        }
        Operation::Device { on } => {
            if *on {
                enabled()?;
            }
            (
                FLAG,
                json!({"mac":change.mac,"flag":if *on {"on"}else{"off"}}),
                json!(on),
            )
        }
        Operation::Limit { direction, ticks } => {
            enabled()?;
            let c = r.client.as_ref().ok_or_else(AppError::protocol)?;
            if !c.on
                || c.band.upload <= 0.0
                || c.band.download <= 0.0
                || *ticks > 1000
                || *ticks
                    < if *direction == Direction::Upload {
                        10
                    } else {
                        1
                    }
            {
                return Err(AppError::invalid("限速状态或带宽不可用。"));
            }
            // Only the moved direction changes. Preserve the independently-read
            // opposite direction, including its zero/unlimited sentinel.
            let mut rates = c.limit.clone();
            match direction {
                Direction::Upload => {
                    rates.upload = client_rate(c.limit.upload, c.band.upload, Some(*ticks))
                }
                Direction::Download => {
                    rates.download = client_rate(c.limit.download, c.band.download, Some(*ticks))
                }
            }
            (
                LIMIT,
                json!({"mac":c.mac,"upload":fixed(rates.upload),"download":fixed(rates.download)}),
                json!(rates),
            )
        }
        Operation::Guest { direction, ticks } => {
            enabled()?;
            let mut rates = r
                .guest
                .clone()
                .ok_or_else(|| AppError::new("unavailable", "访客网络限速比例尚未读取。", false))?;
            if !(10..=1000).contains(ticks) || r.band.upload <= 0.0 || r.band.download <= 0.0 {
                return Err(AppError::invalid("访客网络带宽或限速比例无效。"));
            }
            match direction {
                Direction::Upload => rates.upload = f64::from(*ticks) / 1000.0,
                Direction::Download => rates.download = f64::from(*ticks) / 1000.0,
            }
            (
                GUEST,
                json!({"percent":rates.download,"percent_up":rates.upload}),
                json!(rates),
            )
        }
    };
    params["deviceId"] = json!(id);
    Ok((
        path,
        json!({"method":"GET","params":params}),
        Pending {
            change: change.clone(),
            target,
        },
    ))
}
fn same_rates(r: &Rates, v: &Value) -> bool {
    rates(v, "upload", "download").is_ok_and(|t| {
        (r.upload - t.upload).abs() < 0.0005 && (r.download - t.download).abs() < 0.0005
    })
}
pub(crate) fn confirmed(r: &Report, pending: &Pending) -> bool {
    match &pending.change.operation {
        Operation::Switch { on } => r.on == *on,
        Operation::Band { .. } => same_rates(&r.band, &pending.target),
        Operation::Mode { value } => r.mode == *value,
        Operation::Guest { .. } => r
            .guest
            .as_ref()
            .is_some_and(|v| same_rates(v, &pending.target)),
        Operation::Device { on } => r.client.as_ref().is_some_and(|c| {
            pending
                .change
                .mac
                .as_ref()
                .is_some_and(|m| c.mac.eq_ignore_ascii_case(m))
                && c.on == *on
        }),
        Operation::Limit { .. } => r.client.as_ref().is_some_and(|c| {
            pending
                .change
                .mac
                .as_ref()
                .is_some_and(|m| c.mac.eq_ignore_ascii_case(m))
                && same_rates(&c.limit, &pending.target)
        }),
    }
}
