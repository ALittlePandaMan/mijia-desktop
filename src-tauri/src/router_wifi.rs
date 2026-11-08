//! Exact rn02 plugin 11195/10271 normal Wi-Fi form. Secrets stay in memory.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};

// Deliberately no Debug implementations: these structs contain Wi-Fi passwords.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Names {
    pub ssid: String,
    pub password: String,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WifiValues {
    pub merged: bool,
    pub bands: Vec<Names>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub enabled: Option<Vec<bool>>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WifiChange {
    pub baseline: String,
    pub values: WifiValues,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiReport {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub values: WifiValues,
    pub enabled: Vec<bool>,
    pub encrypted: Vec<bool>,
    pub can_merge: bool,
    pub special_characters: bool,
    pub write_reason: Option<String>,
    pub protection: Option<crate::router_connection::Protection>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiRead {
    pub report: WifiReport,
    pub pending: Option<WifiChange>,
    pub external_pending: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WifiResult {
    pub status: String,
    pub report: Option<WifiReport>,
    pub message: String,
}
pub struct Snapshot {
    pub report: WifiReport,
    pub(crate) params: Map<String, Value>,
    pub(crate) info: Vec<Value>,
    pub(crate) router_info: Value,
    pub(crate) rom_features: Value,
}
fn number(v: &Value) -> Option<u16> {
    v.as_u64()
        .and_then(|n| n.try_into().ok())
        .or_else(|| v.as_str()?.parse().ok())
}
fn bit(v: &Value) -> Option<bool> {
    match number(v) {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => v.as_bool(),
    }
}
fn string(v: &Value) -> Result<String> {
    v.as_str()
        .filter(|s| s.len() <= 1024 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(AppError::protocol)
}
fn decoded(s: String, encoded: bool) -> String {
    if !encoded {
        return s;
    }
    s.replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&amp;", "&")
}
pub(crate) fn text(row: &Value, key: &str) -> Result<String> {
    Ok(decoded(
        string(&row[key])?,
        number(&row["ssidHtmlEncode"]) == Some(1),
    ))
}
fn dimension(row: &Value, key: &str) -> Result<Value> {
    let v = &row[key];
    if v == "nil" || number(v) == Some(0) {
        return Ok(json!(0));
    }
    number(v).ok_or_else(AppError::protocol)?;
    Ok(v.clone())
}
pub fn parse(device: &Device, raw: Value, routers: Value) -> Result<Snapshot> {
    let id = router::gateway_id(device)?;
    let items = raw["info"]
        .as_array()
        .filter(|a| (2..=3).contains(&a.len()))
        .ok_or_else(AppError::protocol)?;
    let router_info = routers["deviceList"]
        .as_array()
        .and_then(|a| a.iter().find(|r| r["id"].as_str() == Some(id)))
        .ok_or_else(AppError::protocol)?;
    let caps = &router_info["capabilities"];
    if !caps.is_object() {
        return Err(AppError::protocol());
    }
    let merged = bit(&raw["bsd"]).ok_or_else(AppError::protocol)?;
    let mut params = Map::new();
    params.insert("bsd".into(), json!(u8::from(merged)));
    if bit(&caps["set_all_wifi_api_version"]) == Some(true) {
        params.insert("ver".into(), json!(1));
    }
    let mut names = Vec::new();
    let mut enabled = Vec::new();
    let mut encrypted = Vec::new();
    let mut write_reason = None;
    for (i, row) in items.iter().enumerate() {
        let suffix = i + 1;
        let on = bit(&row["status"]).ok_or_else(AppError::protocol)?;
        let ssid = text(row, "ssid")?;
        let encryption = string(&row["encryption"])?;
        let password = if row["password"].is_null() {
            String::new()
        } else {
            text(row, "password")?
        };
        for (key, value) in [
            ("on", row["status"].clone()),
            ("ssid", json!(ssid)),
            ("encryption", json!(encryption)),
            (
                "pwd",
                json!(if ["none", "owe"].contains(&encryption.as_str()) {
                    String::new()
                } else {
                    password.clone()
                }),
            ),
        ] {
            params.insert(format!("{key}{suffix}"), value);
        }
        if i < 2 {
            bit(&row["hidden"]).ok_or_else(AppError::protocol)?;
            let power = string(&row["txpwr"])?;
            if !["max", "mid", "min"].contains(&power.as_str()) {
                return Err(AppError::protocol());
            }
            params.insert(format!("hidden{suffix}"), row["hidden"].clone());
            params.insert(format!("txpwr{suffix}"), json!(power));
            params.insert(format!("channel{suffix}"), dimension(row, "channel")?);
            params.insert(format!("bandwidth{suffix}"), dimension(row, "bandwidth")?);
            if !["psk2", "mixed-psk", "ccmp", "psk2+ccmp", "none", "owe"]
                .contains(&encryption.as_str())
            {
                write_reason = Some("此加密方式尚未核实安全保存规则。".into());
            }
            names.push(Names { ssid, password });
            enabled.push(on);
            encrypted.push(!["none", "owe"].contains(&encryption.as_str()));
        }
    }
    for key in ["ax", "txbf"] {
        if !items[0][key].is_null() {
            // Preserve opaque capability modes, including the observed rn02
            // txbf=3. The normal form does not reinterpret these as booleans.
            number(&items[0][key]).ok_or_else(AppError::protocol)?;
            params.insert(key.into(), items[0][key].clone());
        }
    }
    // A third ordinary record is preserved as the original non-tri-band branch.
    // Current rn02 capability does not expose a third editable radio.
    if bit(&caps["WiFi_tri_dual_switch"]) == Some(true) || bit(&caps["isSupport6g"]) == Some(true) {
        write_reason = Some("此频段布局尚未核实安全保存规则。".into());
    }
    if bit(&caps["wifi_complexPwd"]) == Some(true) {
        write_reason = Some("此型号的复杂密码规则尚未适配。".into());
    }
    let can_merge = bit(&caps["band_steering"]) == Some(true)
        && (merged || bit(&caps["band_steering_stage_switch"]) == Some(true));
    let revision = format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(&params).map_err(|_| AppError::protocol())?)
    );
    Ok(Snapshot {
        report: WifiReport {
            did: device.did.clone(),
            model: device.model.clone(),
            revision,
            values: WifiValues {
                merged,
                bands: names,
                enabled: None,
            },
            enabled,
            encrypted,
            can_merge,
            special_characters: bit(&caps["wifi_settings_special_characters"]) == Some(true),
            write_reason,
            protection: None,
        },
        params,
        info: items.clone(),
        router_info: router_info.clone(),
        rom_features: Value::Null,
    })
}
pub async fn read(cloud: &Cloud, device: &Device) -> Result<Snapshot> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (raw, routers) = tokio::join!(
        cloud.request_router_read(
            router::WIFI,
            json!({"method":"GET","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        )
    );
    let mut snapshot = parse(device, raw?, routers?)?;
    snapshot.report.protection =
        Some(crate::router_connection::inspect(device, &snapshot.report).await);
    Ok(snapshot)
}
pub fn valid_change(change: &WifiChange) -> Result<()> {
    if change.baseline.len() != 64
        || !change
            .baseline
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        || change.values.bands.len() != 2
        || change.values.enabled.as_ref().is_some_and(|v| v.len() != 2)
    {
        return Err(AppError::invalid("Wi-Fi设置版本无效，请重新打开页面。"));
    }
    if change
        .values
        .bands
        .iter()
        .any(|b| b.ssid.len() > 1024 || b.password.len() > 1024)
    {
        return Err(AppError::invalid("Wi-Fi输入长度无效。"));
    }
    Ok(())
}
fn weighted(s: &str) -> usize {
    s.encode_utf16().map(|c| if c <= 128 { 1 } else { 3 }).sum()
}
pub fn validate(current: &WifiReport, target: &WifiValues) -> Result<()> {
    if let Some(reason) = &current.write_reason {
        return Err(AppError::new("unsupported", reason, false));
    }
    if target.bands.len() != 2
        || target.enabled.as_ref().is_some_and(|v| v.len() != 2)
        || target.merged != current.values.merged && !current.can_merge
    {
        return Err(AppError::invalid("当前频段配置不可修改。"));
    }
    if target.merged
        && target
            .enabled
            .as_ref()
            .is_some_and(|v| v.len() != 2 || v[0] != v[1])
    {
        return Err(AppError::invalid("合一网络的频段开关需保持一致。"));
    }
    for (i, names) in target.bands.iter().enumerate() {
        if !target
            .enabled
            .as_ref()
            .map(|v| v[i])
            .unwrap_or(current.enabled[i])
            && *names != current.values.bands[i]
        {
            return Err(AppError::invalid("未开启的Wi-Fi频段不可编辑名称和密码。"));
        }
        if target.merged && i == 1 && *names == current.values.bands[i] {
            continue;
        }
        if names.ssid.trim().is_empty()
            || weighted(&names.ssid) > if i == 0 { 28 } else { 31 }
            || names.ssid.chars().any(char::is_control)
        {
            return Err(AppError::invalid("Wi-Fi名称为空、过长或含无效字符。"));
        }
        let denied_ssid = if current.special_characters {
            ""
        } else {
            "[]［］`｀;；|｜$＄＆&\\{}｛｝＼（）"
        };
        if names.ssid.chars().any(|c| {
            denied_ssid.contains(c) || matches!(c as u32, 0x1f000..=0x1ffff | 0xfe0f | 0x200d)
        }) {
            return Err(AppError::invalid("Wi-Fi名称包含非法字符。"));
        }
        if !current.encrypted[i] {
            if names.password != current.values.bands[i].password {
                return Err(AppError::invalid("无加密网络不可修改密码。"));
            }
            continue;
        }
        let denied = if current.special_characters {
            "[]；｜｛｝｀＼！？。，（）、＆＄"
        } else {
            "[]［］`｀;；|｜$＄＆&\\{}｛｝＼！？。，（）、"
        };
        if names.password.trim().len() < 8
            || names.password.len() > 63
            || !names.password.is_ascii()
            || names
                .password
                .chars()
                .any(|c| c.is_control() || denied.contains(c))
            || names.password.contains("...")
        {
            return Err(AppError::invalid("Wi-Fi密码需为8至63位且不含禁用字符。"));
        }
    }
    Ok(())
}
pub fn matches(report: &WifiReport, target: &WifiValues) -> bool {
    target.enabled.as_ref().is_none_or(|v| v == &report.enabled)
        && report.values.merged == target.merged
        && report.values.bands.len() == target.bands.len()
        && report
            .values
            .bands
            .iter()
            .zip(&target.bands)
            .enumerate()
            .all(|(i, (actual, wanted))| {
                (target.merged && i == 1)
                    || (actual.ssid == wanted.ssid
                        && (!report.encrypted[i] || actual.password == wanted.password))
            })
}
#[derive(Debug, PartialEq, Eq)]
pub enum SaveDecision {
    Confirmed,
    ConfirmPending,
    Send,
}
pub fn decision(
    report: &WifiReport,
    change: &WifiChange,
    pending: Option<&WifiChange>,
    confirm_only: bool,
) -> Result<SaveDecision> {
    valid_change(change)?;
    if pending.is_some_and(|p| !matches(report, &p.values)) {
        return Ok(SaveDecision::ConfirmPending);
    }
    if matches(report, &change.values) {
        return Ok(SaveDecision::Confirmed);
    }
    if confirm_only {
        return Ok(SaveDecision::ConfirmPending);
    }
    Ok(SaveDecision::Send)
}
impl Snapshot {
    pub(crate) fn mode(&self, key: &str) -> Option<u16> {
        self.params.get(key).and_then(number)
    }
    pub(crate) fn mlo_wifi_payload(&self, device: &Device, change: &WifiChange) -> Result<Value> {
        let mut value = self.payload(device, change)?;
        let params = value["params"]
            .as_object_mut()
            .ok_or_else(AppError::protocol)?;
        // 11789 ChangeSetting: rn02 omits normal-form `ver` and carries this
        // DFS confirmation flag. RB08's special `ver` branch is out of scope.
        params.remove("ver");
        params.insert("user_confirm".into(), json!(0));
        Ok(value)
    }
    pub fn payload(&self, device: &Device, change: &WifiChange) -> Result<Value> {
        valid_change(change)?;
        validate(&self.report, &change.values)?;
        if self.report.revision != change.baseline {
            return Err(AppError::new(
                "conflict",
                "Wi-Fi设置已变化，请重新打开页面后编辑。",
                false,
            ));
        }
        if let Some(enabled) = &change.values.enabled {
            for (i, on) in enabled.iter().enumerate() {
                if !on
                    && self.report.enabled[i]
                    && self
                        .report
                        .protection
                        .as_ref()
                        .is_none_or(|p| p.state == "unavailable" || p.protected_bands.contains(&i))
                {
                    return Err(AppError::new(
                        "connectionProtected",
                        "当前无线连接无法安全关闭此频段。",
                        false,
                    ));
                }
            }
        }
        let mut params = self.params.clone();
        params.insert("deviceId".into(), json!(router::gateway_id(device)?));
        params.insert("bsd".into(), json!(u8::from(change.values.merged)));
        if let Some(enabled) = &change.values.enabled {
            for (i, on) in enabled.iter().enumerate() {
                params.insert(format!("on{}", i + 1), json!(u8::from(*on)));
            }
        }
        for (i, names) in change.values.bands.iter().enumerate() {
            params.insert(format!("ssid{}", i + 1), json!(names.ssid));
            if self.report.encrypted[i] {
                params.insert(format!("pwd{}", i + 1), json!(names.password));
            }
        }
        Ok(json!({"method":"GET","params":params}))
    }
}
pub async fn write(cloud: &Cloud, payload: Value) -> Result<()> {
    cloud.request_router_wifi_write(payload).await.map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d:Device=serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("fixture-route".into());
        d
    }
    fn snapshot() -> Snapshot {
        let band = json!({"status":"1","ssid":"fixture","password":"fixture-pass","encryption":"psk2","hidden":"0","txpwr":"max","channel":"0","bandwidth":"0","ax":"1","txbf":"3","ssidHtmlEncode":1});
        parse(&device(),json!({"bsd":0,"info":[band.clone(),band]}),json!({"deviceList":[{"id":"fixture-route","capabilities":{"band_steering":1,"band_steering_stage_switch":1,"set_all_wifi_api_version":1,"wifi_settings_special_characters":1}}]})).unwrap()
    }
    #[test]
    fn saves_names_while_preserving_radio_settings_and_verified_inner_get() {
        let s = snapshot();
        let mut values = s.report.values.clone();
        values.bands[0].ssid = "new-fixture".into();
        let p = s
            .payload(
                &device(),
                &WifiChange {
                    baseline: s.report.revision.clone(),
                    values,
                },
            )
            .unwrap();
        assert_eq!(p["method"], "GET");
        assert_eq!(p["params"]["ssid1"], "new-fixture");
        assert_eq!(p["params"]["hidden1"], "0");
        assert_eq!(p["params"]["txpwr2"], "max");
        assert_eq!(p["params"]["channel1"], 0);
        assert_eq!(p["params"]["bandwidth2"], 0);
        assert_eq!(p["params"]["ax"], "1");
        assert_eq!(p["params"]["txbf"], "3");
        assert_eq!(p["params"]["ver"], 1);
        assert!(!router::is_read_path(router::WIFI_SAVE));
        assert!(router::is_gateway_path(router::WIFI_SAVE));
    }
    #[test]
    fn daily_band_switch_preserves_credentials_and_requires_independent_status() {
        let mut s = snapshot();
        s.report.protection = Some(crate::router_connection::Protection {
            state: "notWireless",
            protected_bands: vec![],
            reason: None,
        });
        let mut values = s.report.values.clone();
        values.enabled = Some(vec![false, true]);
        let c = WifiChange {
            baseline: s.report.revision.clone(),
            values,
        };
        let p = s.payload(&device(), &c).unwrap();
        assert_eq!(p["params"]["on1"], 0);
        assert_eq!(p["params"]["on2"], 1);
        assert_eq!(p["params"]["ssid1"], "fixture");
        assert_eq!(p["params"]["channel1"], 0);
        assert!(!matches(&s.report, &c.values));
        s.report.enabled[0] = false;
        assert!(matches(&s.report, &c.values));
        s.report.enabled[0] = true;
        s.report
            .protection
            .as_mut()
            .unwrap()
            .protected_bands
            .push(0);
        assert!(s.payload(&device(), &c).is_err());
        s.report.protection = None;
        assert!(s.payload(&device(), &c).is_err());
    }
    #[test]
    fn concurrent_config_is_rejected_before_preserving_a_stale_snapshot() {
        let s = snapshot();
        let change = WifiChange {
            baseline: "a".repeat(64),
            values: s.report.values.clone(),
        };
        assert!(s.payload(&device(), &change).is_err());
        assert!(serde_json::from_value::<WifiChange>(
            json!({"baseline":s.report.revision,"values":s.report.values,"deviceId":"untrusted"})
        )
        .is_err());
    }
    #[test]
    fn html_and_weighted_utf16_rules_match_the_selected_plugin() {
        assert_eq!(
            decoded("A&amp;lt;&lt;&#039;&quot;".into(), true),
            "A&lt;<'\""
        );
        let s = snapshot();
        let mut v = s.report.values.clone();
        v.bands[0].ssid = "中".repeat(9);
        assert!(validate(&s.report, &v).is_ok());
        v.bands[0].ssid.push('中');
        assert!(validate(&s.report, &v).is_err());
        v.bands[0].ssid = "fixture".into();
        v.bands[0].password = "1234567".into();
        assert!(validate(&s.report, &v).is_err());
    }
    #[test]
    fn merged_readback_confirms_only_the_network_visible_in_the_normal_form() {
        let s = snapshot();
        let mut v = s.report.values.clone();
        v.merged = true;
        let mut r = s.report.clone();
        r.values.merged = true;
        r.values.bands[1].ssid = "router-normalized-hidden-band".into();
        assert!(matches(&r, &v));
        r.values.bands[0].password = "other-fixture-pass".into();
        assert!(!matches(&r, &v));
    }
    #[test]
    fn duplicate_or_confirm_only_calls_never_send_an_unconfirmed_change_again() {
        let s = snapshot();
        let mut values = s.report.values.clone();
        values.bands[0].ssid = "edited-fixture".into();
        let change = WifiChange {
            baseline: s.report.revision.clone(),
            values,
        };
        assert_eq!(
            decision(&s.report, &change, Some(&change), false).unwrap(),
            SaveDecision::ConfirmPending
        );
        assert_eq!(
            decision(&s.report, &change, None, true).unwrap(),
            SaveDecision::ConfirmPending
        );
        assert_eq!(
            decision(&s.report, &change, None, false).unwrap(),
            SaveDecision::Send
        );
        let mut current = s.report.clone();
        current.values = change.values.clone();
        assert_eq!(
            decision(&current, &change, Some(&change), false).unwrap(),
            SaveDecision::Confirmed
        );
    }
}
