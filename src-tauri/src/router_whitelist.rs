//! rn02 11360 + native specific API: local white-mode handoff and self retention.
//! Gateway/token/current MAC are private, transient values; never IPC or logs.
#[cfg(test)]
#[path = "router_whitelist_tests.rs"]
mod tests;
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router, router_access as access,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::BTreeSet, net::Ipv4Addr, time::Duration};
use zeroize::Zeroizing;
pub const TOKEN: &str = "/appgateway/third/miwifi/app/r/api/xqsystem/renew_token";
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Phase {
    SwitchPending,
    SelfReady,
    SelfPending,
}
#[derive(Clone, Debug)]
pub(crate) struct Transaction {
    pub mac: String,
    pub phase: Phase,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Progress {
    pub phase: Phase,
    pub can_finish: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Decision {
    Confirmed,
    RetainSelf,
    Wait,
}
pub(crate) fn decision(
    r: &access::Report,
    p: &access::Pending,
    explicit: bool,
    initial: bool,
) -> Decision {
    if access::confirmed(r, p) {
        return Decision::Confirmed;
    }
    if progress(r, p).is_some_and(|v| v.can_finish)
        && (explicit
            || initial
                && p.white
                    .as_ref()
                    .is_some_and(|t| t.phase == Phase::SelfReady))
    {
        Decision::RetainSelf
    } else {
        Decision::Wait
    }
}
#[derive(Serialize)]
pub struct Readiness {
    pub ready: bool,
    pub reason: Option<String>,
}
pub(crate) struct Session {
    gateway: Ipv4Addr,
    https: bool,
    token: Zeroizing<String>,
    pub mac: String,
    id: String,
    client: reqwest::Client,
}
fn unavailable() -> AppError {
    AppError::new(
        "localRequired",
        "请连接当前路由器网络后再开启该功能。",
        false,
    )
}
fn success(v: &Value) -> Result<()> {
    let code = v["code"]
        .as_i64()
        .or_else(|| v["code"].as_str()?.parse().ok())
        .ok_or_else(AppError::protocol)?;
    if code == 0 {
        Ok(())
    } else {
        Err(AppError::new(
            "routerGateway",
            "路由器未接受白名单设置。",
            false,
        ))
    }
}
fn flag(v: &Value) -> Option<u8> {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .or_else(|| v.as_bool().map(u64::from))
        .filter(|n| *n <= 255)
        .map(|n| n as u8)
}
fn supports_https(info: &Value, row: &Value) -> bool {
    flag(&info["secAcc"]) == Some(1)
        || info["features"]
            .as_object()
            .is_some_and(|groups| groups.values().any(|g| flag(&g["secAcc"]) == Some(1)))
        || flag(&row["capabilities"]["secAcc"]) == Some(1)
}
fn token(v: &Value) -> Result<Zeroizing<String>> {
    v.as_str()
        .filter(|s| {
            !s.is_empty()
                && s.len() <= 256
                && s.bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
        })
        .map(|s| Zeroizing::new(s.to_owned()))
        .ok_or_else(AppError::protocol)
}
fn local_url(ip: Ipv4Addr, https: bool, token: Option<&str>, path: &str) -> Result<url::Url> {
    if !(ip.is_private() || ip.is_link_local())
        || ![
            "/api/xqsystem/init_info",
            "/api/xqsystem/device_mac",
            "/api/xqnetwork/wifi_macfilter_info",
            "/api/misystem/arn_status",
            "/api/misystem/arn_switch",
        ]
        .contains(&path)
    {
        return Err(AppError::invalid("不支持的路由器本地请求。"));
    }
    let credentials = if let Some(s) = token {
        let t = token_value(s)?;
        format!("/;stok={t}")
    } else {
        String::new()
    };
    url::Url::parse(&format!(
        "{}://{ip}/cgi-bin/luci{credentials}{path}",
        if https { "https" } else { "http" }
    ))
    .map_err(|_| AppError::protocol())
}
fn token_value(s: &str) -> Result<&str> {
    if !s.is_empty()
        && s.len() <= 256
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    {
        Ok(s)
    } else {
        Err(AppError::protocol())
    }
}
async fn response(response: reqwest::Response) -> Result<Value> {
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > 65536) {
        return Err(AppError::protocol());
    }
    let mut response = response;
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await.map_err(AppError::network)? {
        if bytes.len() + chunk.len() > 65536 {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    let v: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::protocol())?;
    success(&v)?;
    Ok(v)
}
fn matches_report(r: &access::Report, status: &Value, filter: &Value) -> bool {
    let Some(rows) = filter["macfilter"].as_array() else {
        return false;
    };
    let mut members = BTreeSet::new();
    for v in rows {
        let Some(mac) = v
            .as_str()
            .or_else(|| v["mac"].as_str())
            .filter(|m| crate::router_client_name::valid_mac(m))
        else {
            return false;
        };
        if !members.insert(mac.to_ascii_lowercase()) {
            return false;
        }
    }
    flag(&status["open"]) == Some(u8::from(r.on))
        && flag(&status["level"]) == Some(r.level)
        && flag(&filter["enable"]) == Some(u8::from(r.on))
        && flag(&filter["model"]) == Some(r.mode)
        && (!r.on || flag(&status["wifimode"]) == Some(r.mode + 1))
        && members
            == r.entries
                .iter()
                .filter(|e| e.member)
                .map(|e| e.mac.to_ascii_lowercase())
                .collect()
}
impl Session {
    pub(crate) async fn prepare(
        cloud: &Cloud,
        device: &Device,
        r: &access::Report,
    ) -> Result<Self> {
        crate::router_indicator::writable(device)?;
        if !r.whitelist_supported || !r.on || r.write_reason.is_some() {
            return Err(AppError::new(
                "unavailable",
                "当前状态不能开启白名单。",
                false,
            ));
        }
        let id = router::gateway_id(device)?.to_owned();
        let gateway = crate::router_connection::verified_gateway(device)
            .await
            .ok_or_else(unavailable)?;
        let anonymous = reqwest::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(Duration::from_secs(3))
            .build()
            .map_err(AppError::network)?;
        let info = response(
            anonymous
                .get(local_url(gateway, false, None, "/api/xqsystem/init_info")?)
                .send()
                .await
                .map_err(AppError::network)?,
        )
        .await?;
        if info["routerId"].as_str() != Some(&id) {
            return Err(unavailable());
        }
        let routers = cloud
            .request_router_read(
                router::ROUTERS,
                json!({"method":"GET","params":{"deviceId":id}}),
            )
            .await?;
        let row = routers["deviceList"]
            .as_array()
            .and_then(|a| a.iter().find(|v| v["id"] == id))
            .ok_or_else(AppError::protocol)?;
        let https = supports_https(&info, row);
        // Vendor enables private certificates for this already-identified LAN
        // router only. No proxy, redirects, user URLs, or cloud credentials.
        let client = reqwest::Client::builder()
            .no_proxy()
            .retry(reqwest::retry::never())
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(https)
            .timeout(Duration::from_secs(5))
            .build()
            .map_err(AppError::network)?;
        let raw = cloud
            .request_router_read(TOKEN, json!({"method":"GET","params":{"deviceId":id}}))
            .await?;
        let token = token(&raw["token"])?;
        let mut s = Self {
            gateway,
            https,
            token,
            mac: String::new(),
            id,
            client,
        };
        let mac = s.read("/api/xqsystem/device_mac").await?;
        let actual = mac["mac"]
            .as_str()
            .filter(|m| crate::router_client_name::valid_mac(m))
            .ok_or_else(AppError::protocol)?;
        let adapters = crate::router_connection::local_macs()
            .await
            .ok_or_else(unavailable)?;
        if !adapters.iter().any(|m| m.eq_ignore_ascii_case(actual)) {
            return Err(unavailable());
        }
        s.mac = actual.to_ascii_lowercase();
        let (status, filter) = tokio::join!(
            s.read("/api/misystem/arn_status"),
            s.read("/api/xqnetwork/wifi_macfilter_info")
        );
        if !matches_report(r, &status?, &filter?) {
            return Err(AppError::new(
                "conflict",
                "本地与云端防蹭网设置未同步，请稍后再操作。",
                false,
            ));
        }
        Ok(s)
    }
    // Android's provider ignores the parameter map for GET, and uses FormBody
    // for POST. Preserve that distinction rather than adding GET options.
    async fn read(&self, path: &str) -> Result<Value> {
        if ![
            "/api/xqsystem/device_mac",
            "/api/misystem/arn_status",
            "/api/xqnetwork/wifi_macfilter_info",
        ]
        .contains(&path)
        {
            return Err(AppError::invalid("不支持的本地只读接口。"));
        }
        response(
            self.client
                .get(local_url(
                    self.gateway,
                    self.https,
                    Some(self.token.as_str()),
                    path,
                )?)
                .send()
                .await
                .map_err(AppError::network)?,
        )
        .await
    }
    pub(crate) async fn switch_white(&self) -> Result<()> {
        let request = white_request(
            &self.client,
            self.gateway,
            self.https,
            self.token.as_str(),
            &self.id,
        )?;
        response(
            self.client
                .execute(request)
                .await
                .map_err(AppError::network)?,
        )
        .await?;
        Ok(())
    }
}
fn white_request(
    client: &reqwest::Client,
    gateway: Ipv4Addr,
    https: bool,
    token: &str,
    id: &str,
) -> Result<reqwest::Request> {
    client
        .post(local_url(
            gateway,
            https,
            Some(token),
            "/api/misystem/arn_switch",
        )?)
        .form(&[
            ("deviceId", id),
            ("deviceID", id),
            ("open", "1"),
            ("mode", "1"),
            ("allow_private_certificates", "true"),
        ])
        .build()
        .map_err(AppError::network)
}
pub async fn readiness(cloud: &Cloud, device: &Device, r: &access::Report) -> Result<Readiness> {
    match Session::prepare(cloud, device, r).await {
        Ok(_) => Ok(Readiness {
            ready: true,
            reason: None,
        }),
        Err(e) if e.kind == "authExpired" => Err(e),
        Err(e) => Ok(Readiness {
            ready: false,
            reason: Some(e.message),
        }),
    }
}
pub(crate) fn progress(r: &access::Report, p: &access::Pending) -> Option<Progress> {
    let t = p.white.as_ref()?;
    Some(Progress {
        phase: t.phase,
        can_finish: r.on
            && r.mode == 1
            && r.write_reason.is_none()
            && t.phase != Phase::SelfPending
            && !r
                .entries
                .iter()
                .any(|e| e.member && e.mac.eq_ignore_ascii_case(&t.mac)),
    })
}
pub(crate) fn self_payload(device: &Device, p: &access::Pending) -> Result<Value> {
    let t = p.white.as_ref().ok_or_else(AppError::protocol)?;
    if !crate::router_client_name::valid_mac(&t.mac) {
        return Err(AppError::protocol());
    }
    Ok(
        json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?,"mac":t.mac,"option":"0","model":"1"}}),
    )
}
pub(crate) fn pending(
    r: &access::Report,
    c: &access::Change,
    mac: &str,
) -> Result<access::Pending> {
    if r.revision != c.baseline {
        return Err(AppError::new(
            "conflict",
            "防蹭网设置已变化，请核对后再操作。",
            false,
        ));
    }
    if !matches!(c.operation, access::Operation::WhiteMode)
        || !r.on
        || !r.whitelist_supported
        || r.write_reason.is_some()
        || !crate::router_client_name::valid_mac(mac)
    {
        return Err(AppError::invalid("当前状态不能开启白名单。"));
    }
    Ok(access::Pending {
        change: c.clone(),
        target: json!({"on":true,"mode":1}),
        white: Some(Transaction {
            mac: mac.to_ascii_lowercase(),
            phase: Phase::SwitchPending,
        }),
    })
}
