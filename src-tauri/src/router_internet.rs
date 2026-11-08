//! Exact rn02 network mode API 10151 and pages 11240/11249/11252/11255.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{net::Ipv4Addr, time::Duration};
pub const WAN: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/wan_info";
pub const IPV6: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_wan6_v2";
pub const TOKEN: &str = "/appgateway/third/miwifi/app/r/api/xqsystem/renew_token";
pub const PPPOE: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/pppoe_status";
pub const PORT: &str = "/appgateway/third/miwifi/app/r/api/misystem/get_ps_service";
pub const DUAL: &str = "/appgateway/third/miwifi/app/r/api/xqnetdetect/nettb2";
pub(crate) fn is_read_path(path: &str) -> bool {
    [WAN, IPV6, TOKEN, PPPOE, PORT, DUAL].contains(&path)
}
pub(crate) fn record_key(cloud: &Cloud, epoch: u64, did: &str) -> String {
    format!(
        "{}\n{}\n{did}\n{epoch}",
        cloud.credentials.user_id, cloud.credentials.region
    )
}
pub async fn raw(cloud: &Cloud, device: &Device) -> Result<Value> {
    let id = router::gateway_id(device)?;
    cloud
        .request_router_read(
            WAN,
            json!({"method":"GET","params":{"deviceId":id,"wan_name":"WAN1"}}),
        )
        .await
}
// These types carry network configuration and potentially broadband credentials.
// No Debug, persistent serialization, or diagnostic printing.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Values {
    pub mode: String,
    pub auto_dns: bool,
    pub dns1: String,
    pub dns2: String,
    pub account: String,
    pub password: String,
    pub ip: String,
    pub mask: String,
    pub gateway: String,
}
impl Drop for Values {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.password.zeroize();
        self.account.zeroize();
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub baseline: String,
    pub values: Values,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Network {
    pub ipv4: String,
    pub gateway4: String,
    pub ipv6: Vec<String>,
    pub gateway6: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub values: Values,
    pub networks: Vec<Network>,
    pub more_info: bool,
    pub ipv6_mode: Option<String>,
    pub ipv6_supported: bool,
    pub port_auto: Option<bool>,
    pub port_visible: bool,
    pub dual_wan: Option<bool>,
    pub local_available: bool,
    pub write_reason: Option<String>,
    pub warnings: Vec<String>,
}
pub struct Snapshot {
    pub report: Report,
    pub(crate) https: bool,
    pub(crate) work_mode: Option<i64>,
    pub(crate) ipv6_choices: Vec<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: &'static str,
    pub report: Option<Report>,
    pub message: String,
}
fn text(v: &Value) -> Result<String> {
    if v.is_null() {
        return Ok(String::new());
    }
    v.as_str()
        .filter(|s| s.len() <= 4096 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(AppError::protocol)
}
fn bit(v: &Value) -> Option<bool> {
    match v.as_i64().or_else(|| v.as_str()?.parse().ok()) {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => v.as_bool(),
    }
}
fn cap(init: &Value, router: &Value, key: &str) -> bool {
    bit(&router["capabilities"][key]) == Some(true)
        || init["features"]
            .as_object()
            .is_some_and(|groups| groups.values().any(|g| bit(&g[key]) == Some(true)))
}
fn network(raw: &Value) -> Result<Network> {
    let i = &raw["info"];
    if !i.is_object() {
        return Err(AppError::protocol());
    }
    let ip6 = &i["ipv6_info"];
    let ipv6 = match ip6["ip6addr"].as_array() {
        Some(a) if a.len() <= 16 => a.iter().map(text).collect::<Result<Vec<_>>>()?,
        None if ip6["ip6addr"].is_null() => vec![],
        _ => return Err(AppError::protocol()),
    };
    Ok(Network {
        ipv4: text(&i["ipv4"][0]["ip"])?,
        gateway4: text(&i["gateWay"])?,
        ipv6,
        gateway6: text(&ip6["ip6gw"])?,
    })
}
pub fn project(device: &Device, raw: &Value, init: &Value, routers: &Value) -> Result<Snapshot> {
    let id = router::gateway_id(device)?;
    let r = routers["deviceList"]
        .as_array()
        .and_then(|a| a.iter().find(|v| v["id"].as_str() == Some(id)))
        .ok_or_else(AppError::protocol)?;
    let d = &raw["info"]["details"];
    if !d.is_object() {
        return Err(AppError::protocol());
    }
    let mode = text(&d["wanType"])?;
    if mode.is_empty() {
        return Err(AppError::protocol());
    }
    let dns = if d["dns"].is_null() {
        vec![]
    } else {
        d["dns"]
            .as_array()
            .filter(|a| a.len() <= 2)
            .ok_or_else(AppError::protocol)?
            .iter()
            .map(text)
            .collect::<Result<Vec<_>>>()?
    };
    let mut v = Values {
        mode: mode.clone(),
        auto_dns: dns.is_empty(),
        dns1: dns.first().cloned().unwrap_or_default(),
        dns2: dns.get(1).cloned().unwrap_or_default(),
        account: String::new(),
        password: String::new(),
        ip: String::new(),
        mask: String::new(),
        gateway: String::new(),
    };
    if mode == "pppoe" {
        v.account = text(&d["username"])?;
        v.password = text(&d["password"])?;
        v.auto_dns = true;
        v.dns1.clear();
        v.dns2.clear();
    }
    if mode == "static" {
        v.ip = text(&d["ipaddr"])?;
        v.mask = text(&d["netmask"])?;
        v.gateway = text(&d["gateway"])?;
        v.auto_dns = false;
    }
    let work = r["work_mode"]
        .as_i64()
        .or_else(|| r["work_mode"].as_str()?.parse().ok());
    let write_reason = if device.shared_read_only {
        Some("此共享设备只有读取权限。".into())
    } else if work != Some(0) {
        Some("当前中继或Mesh模式的上网设置尚未适配。".into())
    } else if !["dhcp", "pppoe", "static"].contains(&mode.as_str()) {
        Some("当前上网模式的保存规则尚未核实。".into())
    } else {
        None
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!({"values":v,"work":work}))
                .map_err(|_| AppError::protocol())?
        )
    );
    let ipv6_mode = if cap(init, r, "ipv6_wired_v2") {
        raw["info"]["ipv6_info"]["ipv6_mode"]
            .as_str()
            .filter(|s| s.len() < 40)
            .map(str::to_owned)
    } else {
        None
    };
    Ok(Snapshot {
        https: cap(init, r, "secAcc") || bit(&init["secAcc"]) == Some(true),
        work_mode: work,
        // 10148 removes these specification-only flags from ROM features.
        ipv6_choices: if ["dslite", "map_e", "map_e_ocn"]
            .iter()
            .any(|k| bit(&r["capabilities"][k]) == Some(true))
        {
            vec!["native", "dhcpv6", "pppoev6", "pi_relay", "off"]
        } else {
            vec!["native", "pi_relay", "off"]
        }
        .into_iter()
        .map(str::to_owned)
        .collect(),
        report: Report {
            did: device.did.clone(),
            model: device.model.clone(),
            revision,
            values: v,
            networks: vec![network(raw)?],
            more_info: cap(init, r, "WAN_MoreInfoDisplay"),
            ipv6_mode,
            ipv6_supported: cap(init, r, "ipv6_wired_v2"),
            port_auto: None,
            port_visible: cap(init, r, "wan_auto_selection"),
            dual_wan: if cap(init, r, "Dual_WAN") {
                None
            } else {
                Some(false)
            },
            local_available: false,
            write_reason,
            warnings: vec![],
        },
    })
}
pub async fn read(cloud: &Cloud, device: &Device) -> Result<Snapshot> {
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let id = router::gateway_id(device)?;
    let (wan, init, routers) = tokio::join!(
        raw(cloud, device),
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        )
    );
    let mut s = project(device, &wan?, &init?, &routers?)?;
    if s.report.dual_wan.is_none() {
        match cloud
            .request_router_read(DUAL, json!({"method":"GET","params":{"deviceId":id}}))
            .await
        {
            Ok(v) => s.report.dual_wan = bit(&v["on"]),
            Err(e) if e.kind == "authExpired" => return Err(e),
            _ => {}
        }
        if s.report.dual_wan != Some(false) {
            s.report.write_reason =
                Some("双WAN已开启或状态未确认，暂不可修改当前上网模式。".into());
        }
        if s.report.dual_wan == Some(true) {
            match cloud
                .request_router_read(
                    WAN,
                    json!({"method":"GET","params":{"deviceId":id,"wan_name":"WAN2"}}),
                )
                .await
            {
                Ok(v) => {
                    if let Ok(n) = network(&v) {
                        s.report.networks.push(n);
                    }
                }
                Err(e) if e.kind == "authExpired" => return Err(e),
                _ => s.report.warnings.push("WAN2网络信息暂不可用。".into()),
            }
        }
    }
    if s.report.port_visible {
        match cloud
            .request_router_read(
                PORT,
                json!({"method":"GET","params":{"deviceId":id,"service":"wandt"}}),
            )
            .await
        {
            Ok(v) => s.report.port_auto = bit(&v["wandt"]["enable"]),
            Err(e) if e.kind == "authExpired" => return Err(e),
            _ => {}
        }
    }
    s.report.local_available = crate::router_connection::verified_gateway(device)
        .await
        .is_some();
    Ok(s)
}
pub fn validate(change: &Change) -> Result<()> {
    if change.baseline.len() != 64
        || !change
            .baseline
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::invalid("上网设置版本无效，请重新打开页面。"));
    }
    let v = &change.values;
    for s in [
        &v.mode,
        &v.dns1,
        &v.dns2,
        &v.account,
        &v.password,
        &v.ip,
        &v.mask,
        &v.gateway,
    ] {
        if s.len() > 1024 || s.chars().any(char::is_control) {
            return Err(AppError::invalid("上网设置包含无效输入。"));
        }
    }
    if !["dhcp", "pppoe", "static"].contains(&v.mode.as_str()) {
        return Err(AppError::invalid("不支持此上网模式。"));
    }
    if v.mode == "pppoe" {
        if v.account.trim().is_empty() || v.password.is_empty() {
            return Err(AppError::invalid("请输入宽带账号和密码。"));
        }
    } else {
        if v.mode == "static" {
            for s in [&v.ip, &v.mask, &v.gateway] {
                s.parse::<Ipv4Addr>()
                    .map_err(|_| AppError::invalid("IP地址、子网掩码或网关不合法。"))?;
            }
        }
        if v.mode == "static" || !v.auto_dns {
            v.dns1
                .parse::<Ipv4Addr>()
                .map_err(|_| AppError::invalid("DNS1为空或不合法。"))?;
            if !v.dns2.is_empty() {
                v.dns2
                    .parse::<Ipv4Addr>()
                    .map_err(|_| AppError::invalid("DNS2不合法。"))?;
            }
        }
    }
    Ok(())
}
pub fn matches(r: &Report, target: &Values) -> bool {
    let a = &r.values;
    if a.mode != target.mode {
        return false;
    }
    match target.mode.as_str() {
        "dhcp" => {
            a.auto_dns == target.auto_dns
                && (target.auto_dns || a.dns1 == target.dns1 && a.dns2 == target.dns2)
        }
        "pppoe" => a.account == target.account.trim() && a.password == target.password,
        "static" => {
            a.ip == target.ip
                && a.mask == target.mask
                && a.gateway == target.gateway
                && a.dns1 == target.dns1
                && a.dns2 == target.dns2
        }
        _ => false,
    }
}
pub fn payload(device: &Device, v: &Values) -> Result<Vec<(String, String)>> {
    let mut p = vec![
        ("deviceId".into(), router::gateway_id(device)?.into()),
        ("wanType".into(), v.mode.clone()),
        ("allow_private_certificates".into(), "true".into()),
    ];
    if v.mode == "pppoe" {
        p.extend([
            ("pppoeName".into(), v.account.trim().into()),
            ("pppoePwd".into(), v.password.clone()),
        ]);
    } else {
        if v.mode == "static" {
            p.extend([
                ("staticIp".into(), v.ip.clone()),
                ("staticMask".into(), v.mask.clone()),
                ("staticGateway".into(), v.gateway.clone()),
            ]);
        }
        if v.mode == "static" || !v.auto_dns {
            p.push(("dns1".into(), v.dns1.clone()));
            if !v.dns2.is_empty() {
                p.push(("dns2".into(), v.dns2.clone()));
            }
        }
    }
    Ok(p)
}
pub struct Prepared {
    client: reqwest::Client,
    url: String,
    params: Vec<(String, String)>,
    _token: zeroize::Zeroizing<String>,
}
pub(crate) enum LocalOperation {
    Wan,
    Wan6,
    Lan6,
}
impl LocalOperation {
    fn path(&self) -> &'static str {
        match self {
            Self::Wan => "set_wan",
            Self::Wan6 => "set_wan6_v2",
            Self::Lan6 => "set_lan6_v2",
        }
    }
}
impl Drop for Prepared {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.url.zeroize();
        for (_, v) in &mut self.params {
            v.zeroize();
        }
    }
}
impl Prepared {
    pub async fn new(cloud: &Cloud, device: &Device, s: &Snapshot, v: &Values) -> Result<Self> {
        Self::local(
            cloud,
            device,
            s.https,
            LocalOperation::Wan,
            payload(device, v)?,
        )
        .await
    }
    pub(crate) async fn local(
        cloud: &Cloud,
        device: &Device,
        https: bool,
        operation: LocalOperation,
        params: Vec<(String, String)>,
    ) -> Result<Self> {
        let ip = crate::router_connection::verified_gateway(device)
            .await
            .ok_or_else(|| {
                AppError::new(
                    "localRequired",
                    "请连接当前路由器的网络后再进行设置。",
                    false,
                )
            })?;
        let r = cloud
            .request_router_read(
                TOKEN,
                json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?}}),
            )
            .await?;
        let token = zeroize::Zeroizing::new(
            r["token"]
                .as_str()
                .filter(|s| {
                    !s.is_empty()
                        && s.len() <= 256
                        && s.bytes()
                            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                })
                .ok_or_else(AppError::protocol)?
                .to_owned(),
        );
        if crate::router_connection::verified_gateway(device).await != Some(ip) {
            return Err(AppError::new(
                "localRequired",
                "本地网络连接已变化，请重新打开上网设置。",
                false,
            ));
        }
        let client = reqwest::Client::builder()
            .no_proxy()
            .http1_only()
            .redirect(reqwest::redirect::Policy::none())
            .danger_accept_invalid_certs(https)
            .timeout(Duration::from_secs(8))
            .build()
            .map_err(AppError::network)?;
        let url = format!(
            "{}://{ip}/cgi-bin/luci/;stok={}/api/xqnetwork/{}",
            if https { "https" } else { "http" },
            token.as_str(),
            operation.path()
        );
        Ok(Self {
            client,
            url,
            params,
            _token: token,
        })
    }
    pub async fn send(self) -> Result<()> {
        let mut res = self
            .client
            .post(&self.url)
            .form(&self.params)
            .send()
            .await
            .map_err(AppError::network)?;
        if !res.status().is_success() || res.content_length().is_some_and(|n| n > 65536) {
            return Err(AppError::protocol());
        }
        let mut bytes = vec![];
        while let Some(c) = res.chunk().await.map_err(AppError::network)? {
            if bytes.len() + c.len() > 65536 {
                return Err(AppError::protocol());
            }
            bytes.extend_from_slice(&c);
        }
        let v: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::protocol())?;
        let code = v["code"]
            .as_i64()
            .or_else(|| v["code"].as_str()?.parse().ok())
            .ok_or_else(AppError::protocol)?;
        if code != 0 {
            return Err(AppError::new(
                "routerGateway",
                "路由器拒绝了上网设置，请核实实际配置。",
                false,
            ));
        }
        Ok(())
    }
}
pub async fn verified(cloud: &Cloud, device: &Device, r: &Report, target: &Values) -> Result<bool> {
    if !matches(r, target) {
        return Ok(false);
    }
    if target.mode == "pppoe" {
        let v = cloud
            .request_router_read(
                PPPOE,
                json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?}}),
            )
            .await?;
        return Ok(v["status"].as_i64() == Some(2));
    }
    Ok(true)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d:Device=serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("fixture-route".into());
        d
    }
    fn raw() -> Value {
        json!({"info":{"details":{"wanType":"dhcp","peerdns":"1"},"ipv4":[{"ip":"192.0.2.2"}],"gateWay":"192.0.2.1","ipv6_info":{"ipv6_mode":"passthrough","ip6addr":["2001:db8::1/64"],"ip6gw":"fe80::1"}}})
    }
    fn routers() -> Value {
        json!({"deviceList":[{"id":"fixture-route","work_mode":0,"capabilities":{"secAcc":1,"WAN_MoreInfoDisplay":1,"ipv6_wired_v2":1}}]})
    }
    #[test]
    fn missing_dns_is_auto_but_missing_mode_or_router_identity_is_not_invented() {
        let s = project(&device(), &raw(), &Value::Null, &routers()).unwrap();
        assert!(s.report.values.auto_dns);
        assert_eq!(s.report.ipv6_mode.as_deref(), Some("passthrough"));
        let mut r = raw();
        r["info"]["details"] = json!({});
        assert!(project(&device(), &r, &Value::Null, &routers()).is_err());
        assert!(project(&device(), &raw(), &Value::Null, &json!({"deviceList":[]})).is_err());
    }
    #[test]
    fn ipv6_support_survives_missing_runtime_mode_and_rom_only_dial_flags_are_ignored() {
        let mut raw = raw();
        raw["info"]["ipv6_info"] = json!({});
        let init = json!({"features":{"network":{"dslite":1}}});
        let mut routers = routers();
        let s = project(&device(), &raw, &init, &routers).unwrap();
        assert!(s.report.ipv6_supported);
        assert!(s.report.ipv6_mode.is_none());
        assert!(!s.ipv6_choices.iter().any(|m| m == "dhcpv6"));
        routers["deviceList"][0]["capabilities"]["dslite"] = json!(1);
        assert!(project(&device(), &raw, &init, &routers)
            .unwrap()
            .ipv6_choices
            .iter()
            .any(|m| m == "dhcpv6"));
    }
    #[test]
    fn lease_changes_do_not_invalidate_config_baseline_but_dns_changes_do() {
        let original = project(&device(), &raw(), &Value::Null, &routers()).unwrap();
        let mut r = raw();
        r["info"]["ipv4"][0]["ip"] = json!("192.0.2.99");
        assert_eq!(
            original.report.revision,
            project(&device(), &r, &Value::Null, &routers())
                .unwrap()
                .report
                .revision
        );
        r["info"]["details"]["dns"] = json!(["192.0.2.53"]);
        assert_ne!(
            original.report.revision,
            project(&device(), &r, &Value::Null, &routers())
                .unwrap()
                .report
                .revision
        );
    }
    #[test]
    fn dhcp_auto_omits_dns_and_broadband_form_preserves_encoded_secret_characters() {
        let s = project(&device(), &raw(), &Value::Null, &routers()).unwrap();
        let p = payload(&device(), &s.report.values).unwrap();
        assert!(!p.iter().any(|(k, _)| k == "dns1" || k == "pppoePwd"));
        let mut v = s.report.values.clone();
        v.mode = "pppoe".into();
        v.account = " fixture ".into();
        v.password = "fixture&+secret".into();
        let p = payload(&device(), &v).unwrap();
        let req = reqwest::Client::new()
            .post("http://127.0.0.1/")
            .form(&p)
            .build()
            .unwrap();
        let body = std::str::from_utf8(req.body().unwrap().as_bytes().unwrap()).unwrap();
        assert!(body.contains("pppoeName=fixture"));
        assert!(body.contains("pppoePwd=fixture%26%2Bsecret"));
        assert!(!p.iter().any(|(k, _)| k == "staticIp" || k == "dns1"));
    }
    #[test]
    fn static_fields_use_plugin_names_and_invalid_or_injected_addresses_fail() {
        let mut r = raw();
        r["info"]["details"] = json!({"wanType":"static","ipaddr":"192.0.2.2","netmask":"255.255.255.0","gateway":"192.0.2.1","dns":["192.0.2.53"]});
        let s = project(&device(), &r, &Value::Null, &routers()).unwrap();
        let mut c = Change {
            baseline: s.report.revision,
            values: s.report.values,
        };
        assert!(validate(&c).is_ok());
        let p = payload(&device(), &c.values).unwrap();
        assert!(p
            .iter()
            .any(|(k, v)| k == "staticMask" && v == "255.255.255.0"));
        c.values.gateway = "192.0.2.1&other=value".into();
        assert!(validate(&c).is_err());
    }
    #[test]
    fn masked_broadband_password_is_not_evidence_of_matching_new_credentials() {
        let mut r = raw();
        r["info"]["details"] =
            json!({"wanType":"pppoe","username":"fixture","password":"********"});
        let s = project(&device(), &r, &Value::Null, &routers()).unwrap();
        let mut v = s.report.values.clone();
        v.password = "new-fixture-secret".into();
        assert!(!matches(&s.report, &v));
    }
    #[test]
    fn relay_and_shared_devices_have_explicit_write_reasons() {
        let mut routers = routers();
        routers["deviceList"][0]["work_mode"] = json!(1);
        assert!(project(&device(), &raw(), &Value::Null, &routers)
            .unwrap()
            .report
            .write_reason
            .is_some());
        let mut d = device();
        d.shared_read_only = true;
        assert!(project(&d, &raw(), &Value::Null, &routers)
            .unwrap()
            .report
            .write_reason
            .unwrap()
            .contains("读取权限"));
    }
}
