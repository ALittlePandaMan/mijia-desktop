//! rn02 WAN port selection (11669/11636) and IPv6 (12044/11240).
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router, router_internet as wan,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::net::Ipv6Addr;
pub const PORT_MAP: &str = "/appgateway/third/miwifi/app/r/api/misystem/get_ps_map";
pub const PORT_SAVE: &str = "/appgateway/third/miwifi/app/r/api/misystem/set_ps_service";
pub const LAN: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/lan_info";
pub(crate) fn is_read_path(path: &str) -> bool {
    [PORT_MAP, LAN].contains(&path)
}
pub(crate) fn is_write_path(path: &str) -> bool {
    path == PORT_SAVE
}
#[derive(Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Kind {
    Ports,
    Ipv6,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PortValues {
    pub auto: bool,
    pub wan_port: i32,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Ipv6Values {
    pub mode: String,
    pub auto_dns: bool,
    pub dns1: String,
    pub dns2: String,
    pub auto_sync: bool,
    pub account: String,
    pub password: String,
}
impl Drop for Ipv6Values {
    fn drop(&mut self) {
        use zeroize::Zeroize;
        self.account.zeroize();
        self.password.zeroize();
    }
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    content = "value",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub enum Values {
    Ports(PortValues),
    Ipv6(Ipv6Values),
}
impl Values {
    pub fn kind(&self) -> Kind {
        match self {
            Self::Ports(_) => Kind::Ports,
            Self::Ipv6(_) => Kind::Ipv6,
        }
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
pub struct Port {
    pub id: i32,
    pub index: String,
    pub label: String,
    pub speed: String,
    pub service: String,
    pub selectable: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub values: Values,
    pub ports: Vec<Port>,
    pub modes: Vec<String>,
    pub local_available: bool,
    pub off_warning: bool,
    pub write_reason: Option<String>,
}
pub struct Snapshot {
    pub report: Report,
    pub https: bool,
}
#[derive(Clone)]
pub struct Pending {
    pub id: String,
    pub change: Change,
    pub primary_ok: bool,
    pub lan_sent: bool,
    pub lan_ok: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingView {
    pub id: String,
    pub change: Change,
    pub feedback_required: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub report: Report,
    pub pending: Option<PendingView>,
    pub external_pending: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: &'static str,
    pub report: Option<Report>,
    pub message: String,
    pub feedback_id: Option<String>,
}
fn num(v: &Value) -> Option<i32> {
    v.as_i64()
        .and_then(|n| i32::try_from(n).ok())
        .or_else(|| v.as_str()?.parse().ok())
}
fn bit(v: &Value) -> Option<bool> {
    match num(v) {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => v.as_bool(),
    }
}
fn text(v: &Value) -> Result<String> {
    if v.is_null() {
        return Ok(String::new());
    }
    v.as_str()
        .filter(|s| s.len() <= 1024 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(AppError::protocol)
}
pub fn port_values(service: &Value) -> Result<PortValues> {
    Ok(PortValues {
        auto: bit(&service["wandt"]["enable"]).ok_or_else(AppError::protocol)?,
        wan_port: num(&service["wandt"]["wan_port"])
            .filter(|n| (-1..=128).contains(n))
            .ok_or_else(AppError::protocol)?,
    })
}
pub fn ports(map: &Value) -> Result<Vec<Port>> {
    let rows = map["ports"]
        .as_array()
        .filter(|a| !a.is_empty() && a.len() <= 32)
        .ok_or_else(AppError::protocol)?;
    let mut out = vec![];
    for row in rows {
        let id = num(&row["port"])
            .filter(|n| (0..=128).contains(n))
            .ok_or_else(AppError::protocol)?;
        if out.iter().any(|p: &Port| p.id == id) {
            return Err(AppError::protocol());
        }
        let service = text(&row["service"])?;
        out.push(Port {
            id,
            index: text(&row["index"])?,
            label: text(&row["label"])?,
            speed: text(&row["speed"])?,
            selectable: service == "LAN" || service == "WAN",
            service,
        });
    }
    Ok(out)
}
pub fn ipv6_values(raw: &Value) -> Result<Ipv6Values> {
    let cfg = &raw["wan6_cfg"];
    if !cfg.is_object() {
        return Err(AppError::protocol());
    }
    let mode = text(&cfg["ipv6_mode"])?;
    if mode.is_empty() {
        return Err(AppError::protocol());
    }
    let dns = if cfg["dns"].is_null() {
        vec![]
    } else {
        cfg["dns"]
            .as_array()
            .filter(|a| a.len() <= 2)
            .ok_or_else(AppError::protocol)?
            .iter()
            .map(text)
            .collect::<Result<Vec<_>>>()?
    };
    let auto_dns = if cfg["peerdns"].is_null() {
        true
    } else {
        bit(&cfg["peerdns"]).ok_or_else(AppError::protocol)?
    };
    let auto_sync = if cfg["use_pppoev4"].is_null() {
        true
    } else {
        bit(&cfg["use_pppoev4"]).ok_or_else(AppError::protocol)?
    };
    Ok(Ipv6Values {
        mode,
        auto_dns,
        dns1: dns.first().cloned().unwrap_or_default(),
        dns2: dns.get(1).cloned().unwrap_or_default(),
        auto_sync,
        account: text(&cfg["username"])?,
        password: text(&cfg["password"])?,
    })
}
pub async fn read(cloud: &Cloud, device: &Device, kind: Kind) -> Result<Snapshot> {
    let base = wan::read(cloud, device).await?;
    let id = router::gateway_id(device)?;
    let mut reason = if device.shared_read_only {
        Some("此共享设备只有读取权限。".into())
    } else if base.work_mode != Some(0) {
        Some("中继或Mesh模式的管理链路尚未核实。".into())
    } else {
        None
    };
    let (values, ports, modes) = match kind {
        Kind::Ports => {
            let (map, service) = tokio::join!(
                cloud.request_router_read(
                    PORT_MAP,
                    json!({"method":"GET","params":{"deviceId":id}})
                ),
                cloud.request_router_read(
                    wan::PORT,
                    json!({"method":"GET","params":{"deviceId":id,"service":"wandt"}})
                )
            );
            if !base.report.port_visible {
                reason = Some("此路由器未确认支持WAN口选择。".into());
            }
            if base.report.dual_wan != Some(false) {
                reason = Some("双WAN已开启或状态尚未确认，暂不可切换WAN口。".into());
            }
            (
                Values::Ports(port_values(&service?)?),
                self::ports(&map?)?,
                vec![],
            )
        }
        Kind::Ipv6 => {
            let raw = cloud
                .request_router_read(wan::IPV6, json!({"method":"GET","params":{"deviceId":id}}))
                .await?;
            if !base.report.ipv6_supported {
                reason = Some("此路由器未确认支持IPv6设置。".into());
            }
            if !base.report.local_available {
                reason = Some("请连接当前路由器的网络后再进行设置。".into());
            }
            (
                Values::Ipv6(ipv6_values(&raw)?),
                vec![],
                base.ipv6_choices.clone(),
            )
        }
    };
    let revision=format!("{:x}",Sha256::digest(serde_json::to_vec(&json!({"values":values,"ports":ports,"modes":modes,"workMode":base.work_mode,"dual":base.report.dual_wan})).map_err(|_|AppError::protocol())?));
    Ok(Snapshot {
        https: base.https,
        report: Report {
            did: device.did.clone(),
            model: device.model.clone(),
            revision,
            values,
            ports,
            modes,
            local_available: base.report.local_available,
            off_warning: ["dslite", "v6plus", "ocn"].contains(&base.report.values.mode.as_str()),
            write_reason: reason,
        },
    })
}
pub fn validate(change: &Change) -> Result<()> {
    if change.baseline.len() != 64
        || !change
            .baseline
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::invalid("网络设置版本无效，请重新打开页面。"));
    }
    match &change.values {
        Values::Ports(v) => {
            if !(-1..=128).contains(&v.wan_port) || !v.auto && v.wan_port < 0 {
                return Err(AppError::invalid("请选择有效WAN网口。"));
            }
        }
        Values::Ipv6(v) => {
            if !["native", "pi_relay", "off", "dhcpv6", "pppoev6"].contains(&v.mode.as_str()) {
                return Err(AppError::invalid("不支持此IPv6类型。"));
            }
            for s in [&v.dns1, &v.dns2, &v.account, &v.password] {
                if s.len() > 1024 || s.chars().any(char::is_control) {
                    return Err(AppError::invalid("IPv6输入无效。"));
                }
            }
            if ["dhcpv6", "pppoev6"].contains(&v.mode.as_str()) && !v.auto_dns {
                v.dns1
                    .parse::<Ipv6Addr>()
                    .map_err(|_| AppError::invalid("主DNS不能为空且须为IPv6地址。"))?;
                if !v.dns2.is_empty() {
                    v.dns2
                        .parse::<Ipv6Addr>()
                        .map_err(|_| AppError::invalid("次DNS须为IPv6地址。"))?;
                }
            }
            if v.mode == "pppoev6"
                && !v.auto_sync
                && (v.account.trim().is_empty() || v.password.is_empty())
            {
                return Err(AppError::invalid("请输入IPv6宽带账号和密码。"));
            }
        }
    }
    Ok(())
}
pub fn can_save(report: &Report, change: &Change) -> Result<()> {
    validate(change)?;
    if report.values.kind() != change.values.kind() {
        return Err(AppError::invalid("网络设置类型与当前页面不匹配。"));
    }
    if let Some(reason) = &report.write_reason {
        return Err(AppError::new("unsupported", reason, false));
    }
    if report.revision != change.baseline {
        return Err(AppError::new(
            "conflict",
            "网络配置已变化，请返回后重新编辑。",
            false,
        ));
    }
    match &change.values {
        Values::Ports(v) => {
            if !v.auto
                && !report
                    .ports
                    .iter()
                    .any(|p| p.id == v.wan_port && p.selectable)
            {
                return Err(AppError::invalid("此网口被其他服务占用，不能设为WAN口。"));
            }
        }
        Values::Ipv6(v) => {
            if !report.modes.contains(&v.mode) {
                return Err(AppError::new(
                    "unsupported",
                    "当前能力未提供此IPv6类型。",
                    false,
                ));
            }
        }
    }
    Ok(())
}
fn same_ip(a: &str, b: &str) -> bool {
    a.parse::<Ipv6Addr>()
        .ok()
        .zip(b.parse::<Ipv6Addr>().ok())
        .is_some_and(|(a, b)| a == b)
}
pub fn matches(report: &Report, target: &Values) -> bool {
    match (&report.values, target) {
        (Values::Ports(a), Values::Ports(b)) => {
            a.auto == b.auto && (b.auto || a.wan_port == b.wan_port)
        }
        (Values::Ipv6(a), Values::Ipv6(b)) => {
            a.mode == b.mode
                && (!["dhcpv6", "pppoev6"].contains(&b.mode.as_str())
                    || a.auto_dns == b.auto_dns
                        && (b.auto_dns
                            || same_ip(&a.dns1, &b.dns1)
                                && (a.dns2.is_empty() && b.dns2.is_empty()
                                    || same_ip(&a.dns2, &b.dns2))))
                && (b.mode != "pppoev6"
                    || a.auto_sync == b.auto_sync
                        && (b.auto_sync || a.account == b.account && a.password == b.password))
        }
        _ => false,
    }
}
pub fn primary_payload(v: &Values) -> Vec<(String, String)> {
    match v {
        Values::Ports(v) => vec![
            ("service".into(), "wandt".into()),
            ("enable".into(), u8::from(v.auto).to_string()),
            ("wan_port".into(), v.wan_port.to_string()),
        ],
        Values::Ipv6(v) => {
            let mut p = vec![
                ("ipv6_mode".into(), v.mode.clone()),
                (
                    "automode".into(),
                    if v.mode == "native" { "1" } else { "0" }.into(),
                ),
                ("allow_private_certificates".into(), "true".into()),
            ];
            if ["dhcpv6", "pppoev6"].contains(&v.mode.as_str()) && !v.auto_dns {
                p.extend([
                    ("dns1".into(), v.dns1.clone()),
                    ("dns2".into(), v.dns2.clone()),
                ]);
            }
            if v.mode == "pppoev6" {
                p.push(("use_pppoev4".into(), u8::from(v.auto_sync).to_string()));
                if !v.auto_sync {
                    p.extend([
                        ("ipv6DialAccount".into(), v.account.clone()),
                        ("ipv6DialPassword".into(), v.password.clone()),
                    ]);
                }
            }
            p
        }
    }
}
pub fn needs_lan(v: &Values) -> bool {
    matches!(v,Values::Ipv6(v) if v.mode!="off")
}
pub async fn prepare_ipv6(
    cloud: &Cloud,
    device: &Device,
    s: &Snapshot,
    v: &Values,
    lan: bool,
) -> Result<wan::Prepared> {
    if !matches!(v, Values::Ipv6(_)) {
        return Err(AppError::invalid("本地请求仅适用于IPv6设置。"));
    }
    let (operation, params) = if lan {
        (
            wan::LocalOperation::Lan6,
            vec![
                ("mode".into(), "0".into()),
                ("ip6assign".into(), "64".into()),
                ("allow_private_certificates".into(), "true".into()),
            ],
        )
    } else {
        (wan::LocalOperation::Wan6, primary_payload(v))
    };
    wan::Prepared::local(cloud, device, s.https, operation, params).await
}
pub async fn write_port(cloud: &Cloud, device: &Device, v: &Values) -> Result<()> {
    if !matches!(v, Values::Ports(_)) {
        return Err(AppError::invalid("此请求仅适用于WAN口设置。"));
    }
    let mut params = serde_json::Map::new();
    params.insert("deviceId".into(), json!(router::gateway_id(device)?));
    for (k, v) in primary_payload(v) {
        let value = if k == "enable" || k == "wan_port" {
            json!(v.parse::<i32>().map_err(|_| AppError::protocol())?)
        } else {
            json!(v)
        };
        params.insert(k, value);
    }
    cloud
        .request_router_network_write(PORT_SAVE, json!({"method":"POST","params":params}))
        .await?;
    Ok(())
}
pub fn feedback_ready(report: &Report, p: &Pending) -> bool {
    needs_lan(&p.change.values)
        && p.primary_ok
        && p.lan_sent
        && p.lan_ok
        && matches(report, &p.change.values)
}
pub fn outcome(report: Report, p: &Pending) -> Outcome {
    let matched = matches(&report, &p.change.values);
    let feedback = feedback_ready(&report, p);
    let confirmed = matched && !needs_lan(&p.change.values);
    Outcome {
        status: if feedback {
            "feedbackRequired"
        } else if confirmed {
            "confirmed"
        } else {
            "uncertain"
        },
        report: Some(report),
        message: if feedback {
            "IPv6主配置已回读，局域网IPv6参数无法独立回读，请核实终端IPv6网络效果。"
        } else if confirmed {
            "配置已回读确认，请核实终端网络连接；WAN口切换可能需要60秒。"
        } else if p.primary_ok && needs_lan(&p.change.values) && !p.lan_ok {
            "IPv6主配置已发送，局域网配置尚未确认；只会继续查询，不会重发。"
        } else {
            "网络设置尚未回读确认；只会继续查询，不会重发。"
        }
        .into(),
        feedback_id: feedback.then(|| p.id.clone()),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn v6(mode: &str) -> Values {
        Values::Ipv6(Ipv6Values {
            mode: mode.into(),
            auto_dns: true,
            dns1: String::new(),
            dns2: String::new(),
            auto_sync: true,
            account: String::new(),
            password: String::new(),
        })
    }
    fn report(values: Values) -> Report {
        Report {
            did: "fixture".into(),
            model: router::MODEL.into(),
            revision: "a".repeat(64),
            values,
            ports: vec![
                Port {
                    id: 1,
                    index: "1".into(),
                    label: "LAN1".into(),
                    speed: "2.5G".into(),
                    service: "LAN".into(),
                    selectable: true,
                },
                Port {
                    id: 2,
                    index: "2".into(),
                    label: "IPTV".into(),
                    speed: "1G".into(),
                    service: "IPTV".into(),
                    selectable: false,
                },
            ],
            modes: vec![
                "native".into(),
                "pi_relay".into(),
                "off".into(),
                "dhcpv6".into(),
                "pppoev6".into(),
            ],
            local_available: true,
            off_warning: false,
            write_reason: None,
        }
    }
    fn change(values: Values) -> Change {
        Change {
            baseline: "a".repeat(64),
            values,
        }
    }
    #[test]
    fn ports_require_unique_physical_ids_and_preserve_reserved_services() {
        let map = json!({"ports":[{"port":"1","index":"1","label":"LAN1","speed":"2.5G","service":"LAN"},{"port":"2","index":"2","label":"IPTV","speed":"1G","service":"IPTV"}]});
        let rows = ports(&map).unwrap();
        assert!(rows[0].selectable);
        assert!(!rows[1].selectable);
        let mut bad = map;
        bad["ports"][1]["port"] = json!(1);
        assert!(ports(&bad).is_err());
    }
    #[test]
    fn reserved_port_and_stale_baseline_are_rejected_before_payload() {
        let r = report(Values::Ports(PortValues {
            auto: true,
            wan_port: 1,
        }));
        let mut c = change(Values::Ports(PortValues {
            auto: false,
            wan_port: 2,
        }));
        assert!(can_save(&r, &c).is_err());
        if let Values::Ports(v) = &mut c.values {
            v.wan_port = 1;
        }
        assert!(can_save(&r, &c).is_ok());
        c.baseline = "b".repeat(64);
        assert_eq!(can_save(&r, &c).unwrap_err().kind, "conflict");
    }
    #[test]
    fn automatic_port_readback_allows_the_firmware_to_choose_the_active_port() {
        let r = report(Values::Ports(PortValues {
            auto: true,
            wan_port: 1,
        }));
        assert!(matches(
            &r,
            &Values::Ports(PortValues {
                auto: true,
                wan_port: 4
            })
        ));
        assert!(!matches(
            &r,
            &Values::Ports(PortValues {
                auto: false,
                wan_port: 4
            })
        ));
    }
    #[test]
    fn port_payload_uses_only_the_verified_service_fields_and_post_route_is_not_readonly() {
        let p = primary_payload(&Values::Ports(PortValues {
            auto: false,
            wan_port: 1,
        }));
        assert_eq!(
            p,
            vec![
                ("service".into(), "wandt".into()),
                ("enable".into(), "0".into()),
                ("wan_port".into(), "1".into())
            ]
        );
        assert!(is_write_path(PORT_SAVE));
        assert!(!is_read_path(PORT_SAVE));
    }
    #[test]
    fn ipv6_dns_requires_ipv6_and_readback_accepts_equivalent_compressed_notation() {
        let mut target = v6("dhcpv6");
        if let Values::Ipv6(v) = &mut target {
            v.auto_dns = false;
            v.dns1 = "2001:db8::53".into();
        }
        assert!(validate(&change(target.clone())).is_ok());
        let mut actual = target.clone();
        if let Values::Ipv6(v) = &mut actual {
            v.dns1 = "2001:0db8:0:0:0:0:0:53".into();
        }
        assert!(matches(&report(actual), &target));
        if let Values::Ipv6(v) = &mut target {
            v.dns1 = "192.0.2.53".into();
        }
        assert!(validate(&change(target)).is_err());
    }
    #[test]
    fn automatic_dns_and_ipv4_sync_do_not_send_obsolete_manual_credentials() {
        let mut values = v6("pppoev6");
        if let Values::Ipv6(v) = &mut values {
            v.dns1 = "invalid-unused".into();
            v.password = "fixture-secret".into();
        }
        let p = primary_payload(&values);
        assert!(p.iter().any(|(k, v)| k == "use_pppoev4" && v == "1"));
        assert!(!p
            .iter()
            .any(|(k, _)| k == "dns1" || k == "ipv6DialPassword"));
        if let Values::Ipv6(v) = &mut values {
            v.auto_sync = false;
            v.account = "fixture".into();
        }
        assert!(primary_payload(&values)
            .iter()
            .any(|(k, v)| k == "ipv6DialPassword" && v == "fixture-secret"));
    }
    #[test]
    fn mode_choices_and_page_kind_are_enforced() {
        let mut r = report(v6("native"));
        r.modes = vec!["native".into(), "pi_relay".into(), "off".into()];
        assert!(can_save(&r, &change(v6("dhcpv6"))).is_err());
        assert!(can_save(
            &r,
            &change(Values::Ports(PortValues {
                auto: true,
                wan_port: 1
            }))
        )
        .is_err());
        assert!(!needs_lan(&v6("off")));
        assert!(needs_lan(&v6("native")));
    }
    #[test]
    fn lan_acceptance_is_explicitly_feedback_required_and_never_full_confirmation() {
        let target = v6("pi_relay");
        let mut p = Pending {
            id: "fixture-id".into(),
            change: change(target.clone()),
            primary_ok: true,
            lan_sent: true,
            lan_ok: false,
        };
        assert_eq!(outcome(report(target.clone()), &p).status, "uncertain");
        p.lan_ok = true;
        let o = outcome(report(target), &p);
        assert_eq!(o.status, "feedbackRequired");
        assert_eq!(o.feedback_id.as_deref(), Some("fixture-id"));
    }
    #[test]
    fn a_lost_port_receipt_can_resolve_from_independent_matching_readback() {
        let target = Values::Ports(PortValues {
            auto: false,
            wan_port: 1,
        });
        let p = Pending {
            id: "fixture-id".into(),
            change: change(target.clone()),
            primary_ok: false,
            lan_sent: false,
            lan_ok: false,
        };
        assert_eq!(outcome(report(target), &p).status, "confirmed");
    }
    #[test]
    fn masked_password_does_not_confirm_a_manual_ipv6_account_change() {
        let mut target = v6("pppoev6");
        if let Values::Ipv6(v) = &mut target {
            v.auto_sync = false;
            v.account = "fixture".into();
            v.password = "fixture-secret".into();
        }
        let mut actual = target.clone();
        if let Values::Ipv6(v) = &mut actual {
            v.password = "********".into();
        }
        assert!(!matches(&report(actual), &target));
    }
}
