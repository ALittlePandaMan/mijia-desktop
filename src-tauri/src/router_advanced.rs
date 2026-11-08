//! rn02 plugin 11789/11792/11795/11798. No vendor scripts execute here.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router, router_wifi as wifi,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub const MLO: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_hostap_mlo";
pub const MLO_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_hostap_mlo";
pub const RELAY: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_miotrelay_switch";
pub const RELAY_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/miotrelay_switch";
pub const AIOT: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_miscan_switch";
pub const AIOT_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/miscan_switch";
pub const CHANNEL: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/get_ch_adj_enable";
pub const CHANNEL_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_ch_adj_enable";
pub const MU_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_wifi_txbf";
pub const AX_SET: &str = "/appgateway/third/miwifi/app/r/api/xqnetwork/set_wifi_ax";
pub fn is_read_path(p: &str) -> bool {
    [MLO, RELAY, AIOT, CHANNEL].contains(&p)
}
pub fn is_write_path(p: &str) -> bool {
    [MLO_SET, RELAY_SET, AIOT_SET, CHANNEL_SET, MU_SET, AX_SET].contains(&p)
}
#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    Mlo,
    MuMimo,
    Wifi5,
    Relay,
    Aiot,
    ChannelAdj,
    Configuration,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Switch {
    pub field: Field,
    pub value: Option<bool>,
    pub mode: Option<u16>,
    pub supported: bool,
    pub reason: Option<String>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Band {
    pub on: bool,
    pub encryption: String,
    pub power: String,
    pub hidden: bool,
    pub channel: Option<u16>,
    pub bandwidth: Option<u16>,
    pub active_channel: Option<u16>,
    pub active_bandwidth: Option<u16>,
    pub widths: Vec<u16>,
    pub channels: Vec<crate::router_radio::Channel>,
}
// No Debug: reports include the normal form's credentials in memory only.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub wifi: wifi::WifiReport,
    pub switches: Vec<Switch>,
    pub bands: Vec<Band>,
    pub reconnect: bool,
    pub warnings: Vec<String>,
    pub work_mode: Option<u16>,
    pub radio: crate::router_radio::Rules,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub field: Field,
    pub on: bool,
    pub baseline: String,
    #[serde(default)]
    pub wifi: Option<wifi::WifiChange>,
    #[serde(default)]
    pub bands: Option<Vec<crate::router_radio::Values>>,
}
#[derive(Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DfsChallenge {
    pub id: String,
    pub seconds: u32,
    pub waiting: bool,
}
#[derive(Clone, PartialEq, Eq)]
pub struct Pending {
    pub change: Change,
    pub dfs: Option<DfsChallenge>,
    pub ready_at: Option<std::time::Instant>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum DfsDecision {
    Confirmed,
    Cancel,
    Conflict,
    Send,
}
impl Pending {
    pub fn wait_left(&self) -> u32 {
        self.ready_at
            .map(|at| {
                let d = at.saturating_duration_since(std::time::Instant::now());
                u32::try_from(d.as_secs() + u64::from(d.subsec_nanos() > 0)).unwrap_or(u32::MAX)
            })
            .unwrap_or(0)
    }
    pub fn view_dfs(&self) -> Option<DfsChallenge> {
        let mut d = self.dfs.clone()?;
        if d.waiting {
            d.seconds = self.wait_left();
            if d.seconds == 0 {
                return None;
            }
        }
        Some(d)
    }
    pub fn matches(&self, report: &Report) -> bool {
        self.wait_left() == 0 && matches(report, &self.change)
    }
    pub fn start_wait(&mut self, seconds: u32) {
        self.ready_at =
            Some(std::time::Instant::now() + std::time::Duration::from_secs(u64::from(seconds)));
        self.dfs = Some(DfsChallenge {
            id: String::new(),
            seconds,
            waiting: true,
        });
    }
    pub fn dfs_decision(&self, report: &Report, id: &str, proceed: bool) -> Result<DfsDecision> {
        if self.dfs.as_ref().is_none_or(|d| d.waiting || d.id != id) {
            return Err(AppError::new(
                "conflict",
                "DFS确认已失效，请查询实际状态。",
                false,
            ));
        }
        if matches(report, &self.change) {
            return Ok(DfsDecision::Confirmed);
        }
        if !proceed {
            return Ok(DfsDecision::Cancel);
        }
        if self
            .change
            .wifi
            .as_ref()
            .is_none_or(|w| w.baseline != report.wifi.revision)
        {
            return Ok(DfsDecision::Conflict);
        }
        Ok(DfsDecision::Send)
    }
    pub fn consume_dfs(&mut self, id: &str) -> Result<()> {
        if self.dfs.as_ref().is_none_or(|d| d.waiting || d.id != id) {
            return Err(AppError::new(
                "conflict",
                "DFS确认已处理，不会重复发送。",
                false,
            ));
        }
        self.dfs = None;
        Ok(())
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
    pub config_pending: bool,
    pub dfs: Option<DfsChallenge>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: String,
    pub report: Option<Report>,
    pub message: String,
    pub dfs: Option<DfsChallenge>,
}
pub struct Snapshot {
    pub report: Report,
    pub wifi: wifi::Snapshot,
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
pub(crate) fn has(s: &wifi::Snapshot, key: &str) -> bool {
    // 10148 checks init_info.features before account device-list capabilities.
    // Its four specification-only exceptions are irrelevant to these switches.
    s.rom_features.as_object().is_some_and(|groups| {
        groups
            .values()
            .any(|g| g.is_object() && bit(&g[key]) == Some(true))
    }) || bit(&s.router_info["capabilities"][key]) == Some(true)
}
fn enabled(s: &wifi::Snapshot, f: Field) -> bool {
    match f {
        Field::Mlo => has(s, "MLO_Settings"),
        Field::MuMimo => has(s, "wifi_mu_mimo") && s.info.len() > 1,
        Field::Wifi5 => has(s, "Wi-Fi_6"),
        Field::Relay => has(s, "easy_connect") || has(s, "WiFi_Auto_Reconnect"),
        Field::Aiot => has(s, "Wi-Fi_scan"),
        Field::ChannelAdj => {
            has(s, "ch_adj_support") && number(&s.router_info["work_mode"]) != Some(1)
        }
        Field::Configuration => true,
    }
}
async fn optional(
    cloud: &Cloud,
    device: &Device,
    s: &wifi::Snapshot,
    field: Field,
    path: &str,
    key: &str,
    warnings: &mut Vec<String>,
) -> Result<Option<bool>> {
    if !enabled(s, field) {
        return Ok(None);
    }
    let id = router::gateway_id(device)?;
    match cloud
        .request_router_read(path, json!({"method":"GET","params":{"deviceId":id}}))
        .await
    {
        Ok(value) => {
            let state = bit(&value[key]);
            if state.is_none() {
                warnings.push("部分高级设置没有返回可识别状态。".into());
            }
            Ok(state)
        }
        Err(error) if error.kind == "authExpired" => Err(error),
        Err(error) => {
            warnings.push(format!("部分高级设置暂不可用：{}", error.message));
            Ok(None)
        }
    }
}
pub async fn read(cloud: &Cloud, device: &Device) -> Result<Snapshot> {
    let id = router::gateway_id(device)?;
    let (s, init) = tokio::join!(
        wifi::read(cloud, device),
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":id}})
        )
    );
    let mut s = s?;
    let init = init?;
    if init["routerId"].as_str() != Some(id) {
        return Err(AppError::protocol());
    }
    s.rom_features = init["features"].clone();
    let (mut a, mut b, mut c, mut d) = (vec![], vec![], vec![], vec![]);
    let (mlo, relay, aiot, channel) = tokio::join!(
        optional(cloud, device, &s, Field::Mlo, MLO, "mlo_enable", &mut a),
        optional(cloud, device, &s, Field::Relay, RELAY, "enabled", &mut b),
        optional(cloud, device, &s, Field::Aiot, AIOT, "enabled", &mut c),
        optional(
            cloud,
            device,
            &s,
            Field::ChannelAdj,
            CHANNEL,
            "ch_adj_en",
            &mut d
        )
    );
    a.extend(b);
    a.extend(c);
    a.extend(d);
    let mut actual = project(device, s, mlo?, relay?, aiot?, channel?, a)?;
    actual.report.radio.connection =
        crate::router_connection::inspect(device, &actual.report.wifi).await;
    Ok(actual)
}
fn project(
    device: &Device,
    s: wifi::Snapshot,
    mlo: Option<bool>,
    relay: Option<bool>,
    aiot: Option<bool>,
    channel: Option<bool>,
    warnings: Vec<String>,
) -> Result<Snapshot> {
    let ax = s.mode("ax");
    let txbf = s.mode("txbf");
    let mut switches = vec![];
    for (field, value, mode) in [
        (Field::Mlo, mlo, mlo.map(u16::from)),
        (Field::MuMimo, txbf.map(|v| v == 3), txbf),
        (Field::Wifi5, ax.map(|v| v == 0), ax),
        (Field::Relay, relay, relay.map(u16::from)),
        (Field::Aiot, aiot, aiot.map(u16::from)),
        (Field::ChannelAdj, channel, channel.map(u16::from)),
    ] {
        let supported = enabled(&s, field);
        let reason = if !supported {
            Some("此路由器未提供该功能。".into())
        } else if value.is_none() {
            Some("实际状态尚未读取，暂时无法操作。".into())
        } else {
            None
        };
        switches.push(Switch {
            field,
            value,
            mode,
            supported,
            reason,
        });
    }
    let bands = s
        .info
        .iter()
        .take(2)
        .map(|r| {
            let mut widths = vec![];
            if let Some(rows) = r["available_channels"].as_array() {
                for row in rows {
                    if let Some(b) = row["b"].as_array() {
                        for v in b {
                            if let Some(n) = number(v) {
                                if !widths.contains(&n) {
                                    widths.push(n);
                                }
                            }
                        }
                    }
                }
            }
            Band {
                on: bit(&r["status"]) == Some(true),
                encryption: r["encryption"].as_str().unwrap_or("").into(),
                power: r["txpwr"].as_str().unwrap_or("").into(),
                hidden: bit(&r["hidden"]) == Some(true),
                channel: crate::router_radio::number(&r["channel"]),
                bandwidth: crate::router_radio::number(&r["bandwidth"]),
                active_channel: number(&r["channelInfo"]["channel"]),
                active_bandwidth: number(&r["channelInfo"]["bandwidth"]),
                widths,
                channels: crate::router_radio::channels(r),
            }
        })
        .collect();
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!({"wifi":s.report.revision,"switches":switches}))
                .map_err(|_| AppError::protocol())?
        )
    );
    let radio = crate::router_radio::rules(&s);
    let report = Report {
        did: device.did.clone(),
        model: device.model.clone(),
        revision,
        wifi: s.report.clone(),
        switches,
        bands,
        reconnect: has(&s, "WiFi_Auto_Reconnect"),
        warnings,
        work_mode: number(&s.router_info["work_mode"]),
        radio,
    };
    Ok(Snapshot { report, wifi: s })
}
pub fn value(report: &Report, field: Field) -> Option<bool> {
    report
        .switches
        .iter()
        .find(|v| v.field == field)
        .and_then(|v| v.value)
}
pub fn matches(report: &Report, change: &Change) -> bool {
    (change.field == Field::Configuration || value(report, change.field) == Some(change.on))
        && change
            .wifi
            .as_ref()
            .is_none_or(|c| wifi::matches(&report.wifi, &c.values))
        && change
            .bands
            .as_ref()
            .is_none_or(|b| crate::router_radio::matches(report, b))
}
pub fn decision(
    report: &Report,
    change: &Change,
    pending: Option<&Change>,
    confirm_only: bool,
) -> Result<wifi::SaveDecision> {
    validate(change)?;
    if pending.is_some_and(|c| !matches(report, c)) {
        return Ok(wifi::SaveDecision::ConfirmPending);
    }
    if matches(report, change) {
        return Ok(wifi::SaveDecision::Confirmed);
    }
    if confirm_only {
        return Ok(wifi::SaveDecision::ConfirmPending);
    }
    Ok(wifi::SaveDecision::Send)
}
pub fn validate(change: &Change) -> Result<()> {
    if change.baseline.len() != 64
        || !change
            .baseline
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err(AppError::invalid("高级Wi-Fi设置版本无效。"));
    }
    if change.field == Field::Mlo && change.on || change.field == Field::Configuration {
        let c = change
            .wifi
            .as_ref()
            .ok_or_else(|| AppError::invalid("缺少Wi-Fi配置基线。"))?;
        wifi::valid_change(c)?;
    } else if change.wifi.is_some() {
        return Err(AppError::invalid("此操作不接受普通Wi-Fi配置。"));
    }
    if change.field == Field::Configuration
        && (change.on || change.bands.as_ref().is_none_or(|b| b.len() != 2))
    {
        return Err(AppError::invalid("完整频段配置无效。"));
    }
    if change.bands.is_some()
        && !(change.field == Field::Configuration || change.field == Field::Mlo && change.on)
    {
        return Err(AppError::invalid("此开关不接受频段草稿。"));
    }
    Ok(())
}
pub fn paths(change: &Change) -> (&'static str, &'static str, u8) {
    match change.field {
        Field::Mlo => (MLO_SET, "mlo_enable", u8::from(change.on)),
        Field::MuMimo => (MU_SET, "txbf", if change.on { 3 } else { 0 }),
        Field::Wifi5 => (AX_SET, "ax", if change.on { 0 } else { 1 }),
        Field::Relay => (RELAY_SET, "on", u8::from(change.on)),
        Field::Aiot => (AIOT_SET, "on", u8::from(change.on)),
        Field::ChannelAdj => (CHANNEL_SET, "ch_adj_en", u8::from(change.on)),
        Field::Configuration => (router::WIFI_SAVE, "", 0),
    }
}
impl Snapshot {
    pub fn payloads(&self, device: &Device, change: &Change) -> Result<(Value, Option<Value>)> {
        validate(change)?;
        if self.report.revision != change.baseline {
            return Err(AppError::new(
                "conflict",
                "高级Wi-Fi设置已变化，请重新进入页面。",
                false,
            ));
        }
        if change.field == Field::Configuration {
            return Ok((self.config_payload(device, change, false)?, None));
        }
        let item = self
            .report
            .switches
            .iter()
            .find(|s| s.field == change.field)
            .ok_or_else(AppError::protocol)?;
        if let Some(reason) = &item.reason {
            return Err(AppError::new("unsupported", reason, false));
        }
        if self.report.revision != change.baseline {
            return Err(AppError::new(
                "conflict",
                "高级Wi-Fi设置已变化，请重新进入页面。",
                false,
            ));
        }
        let wifi_payload = if let Some(cfg) = &change.wifi {
            if !cfg.values.merged {
                return Err(AppError::invalid(
                    "检测到未开启Wi-Fi多频合一，无法打开MLO开关。",
                ));
            }
            if self.wifi.mode("ax") == Some(0) {
                return Err(AppError::invalid(
                    "检测到已开启Wi-Fi 5兼容模式，无法打开MLO开关。",
                ));
            }
            if self.wifi.mode("ax").is_none() {
                return Err(AppError::new("unsupported", "Wi-Fi模式尚未读取。", false));
            }
            Some(if change.bands.is_some() {
                self.config_payload(device, change, false)?
            } else {
                self.wifi.mlo_wifi_payload(device, cfg)?
            })
        } else {
            None
        };
        let (_, key, target) = paths(change);
        let mut params = serde_json::Map::new();
        params.insert("deviceId".into(), json!(router::gateway_id(device)?));
        params.insert(key.into(), json!(target));
        Ok((json!({"method":"GET","params":params}), wifi_payload))
    }
    pub fn config_payload(&self, device: &Device, change: &Change, dfs: bool) -> Result<Value> {
        let cfg = change
            .wifi
            .as_ref()
            .ok_or_else(|| AppError::invalid("缺少Wi-Fi草稿。"))?;
        let bands = change
            .bands
            .clone()
            .or_else(|| crate::router_radio::values(&self.report))
            .ok_or_else(AppError::protocol)?;
        crate::router_radio::payload(self, device, cfg, &bands, dfs)
    }
}
pub async fn write(
    cloud: &Cloud,
    change: &Change,
    payload: Value,
    wifi_payload: Option<Value>,
) -> Result<Receipt> {
    let (path, _, _) = paths(change);
    if change.field == Field::Configuration {
        return cloud
            .request_router_wifi_write(payload)
            .await
            .and_then(config_receipt);
    }
    if let Some(cfg) = wifi_payload {
        // The original enable handler starts both requests. Record the full target
        // before entering this function; neither request is retried by confirmation.
        let (config, feature) = tokio::join!(
            cloud.request_router_wifi_write(cfg),
            cloud.request_router_advanced_write(path, payload)
        );
        let config = config.and_then(config_receipt);
        if let Ok(Receipt::NeedDfs(seconds) | Receipt::Waiting(seconds)) = &config {
            if feature.as_ref().err().is_none_or(|e| {
                !matches!(
                    e.kind.as_str(),
                    "routerGateway" | "authExpired" | "permissionDenied"
                )
            }) {
                return Ok(if matches!(config, Ok(Receipt::NeedDfs(_))) {
                    Receipt::NeedDfs(*seconds)
                } else {
                    Receipt::Waiting(*seconds)
                });
            }
        }
        combine_receipts(config.map(|_| ()), feature.map(|_| ())).map(|_| Receipt::Accepted)
    } else {
        cloud
            .request_router_advanced_write(path, payload)
            .await
            .map(|_| Receipt::Accepted)
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Receipt {
    Accepted,
    NeedDfs(u32),
    Waiting(u32),
}
pub fn config_receipt(value: Value) -> Result<Receipt> {
    let seconds = value["cac_time"]
        .as_u64()
        .or_else(|| value["cac_time"].as_str()?.parse().ok())
        .and_then(|n| u32::try_from(n).ok());
    if (!value["cac_time"].is_null() && seconds.is_none())
        || (!value["need_confirm"].is_null() && bit(&value["need_confirm"]).is_none())
    {
        return Err(AppError::protocol());
    }
    if bit(&value["need_confirm"]) == Some(true) {
        return seconds
            .filter(|n| *n > 0)
            .map(Receipt::NeedDfs)
            .ok_or_else(AppError::protocol);
    }
    Ok(seconds
        .filter(|s| *s > 0)
        .map(Receipt::Waiting)
        .unwrap_or(Receipt::Accepted))
}
fn combine_receipts(a: Result<()>, b: Result<()>) -> Result<()> {
    let errors = [a.err(), b.err()];
    if let Some(e) = errors.iter().flatten().find(|e| {
        !matches!(
            e.kind.as_str(),
            "routerGateway" | "permissionDenied" | "authExpired" | "routerDfsConfirmation"
        )
    }) {
        return Err(e.clone());
    }
    errors.into_iter().flatten().next().map_or(Ok(()), Err)
}
#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        let mut d: Device = serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("fixture-route".into());
        d
    }
    fn snapshot(ax: Option<u8>, work_mode: u8) -> Snapshot {
        let mut band = json!({"status":"1","ssid":"fixture","password":"fixture-pass","encryption":"psk2","hidden":"0","txpwr":"max","channel":"0","bandwidth":"0","txbf":"3","available_channels":[{"b":[20,40]}]});
        if let Some(ax) = ax {
            band["ax"] = json!(ax);
        }
        let mut s = wifi::parse(&device(), json!({"bsd":0,"info":[band.clone(),band]}), json!({"deviceList":[{"id":"fixture-route","work_mode":work_mode,"capabilities":{"band_steering":1,"band_steering_stage_switch":1,"set_all_wifi_api_version":1,"wifi_settings_special_characters":1,"wifi_mu_mimo":1,"Wi-Fi_6":1}}]})).unwrap();
        s.rom_features = json!({"wifi":{"MLO_Settings":1,"ch_adj_support":1,"easy_connect":1}});
        project(
            &device(),
            s,
            Some(false),
            Some(true),
            None,
            Some(false),
            vec![],
        )
        .unwrap()
    }
    fn c(field: Field, on: bool) -> Change {
        Change {
            field,
            on,
            baseline: "a".repeat(64),
            wifi: None,
            bands: None,
        }
    }
    #[test]
    fn exact_vendor_fields_and_boolean_inversions_are_not_guessed() {
        assert_eq!(paths(&c(Field::MuMimo, true)), (MU_SET, "txbf", 3));
        assert_eq!(paths(&c(Field::MuMimo, false)), (MU_SET, "txbf", 0));
        assert_eq!(paths(&c(Field::Wifi5, true)), (AX_SET, "ax", 0));
        assert_eq!(paths(&c(Field::Wifi5, false)), (AX_SET, "ax", 1));
        for field in [Field::Mlo, Field::Relay, Field::Aiot, Field::ChannelAdj] {
            assert_eq!(paths(&c(field, true)).2, 1);
        }
        for p in [MLO_SET, MU_SET, AX_SET, RELAY_SET, AIOT_SET, CHANNEL_SET] {
            assert!(is_write_path(p));
            assert!(!router::is_read_path(p));
        }
    }
    #[test]
    fn commands_reject_extra_fields_missing_mlo_baseline_and_unrelated_wifi_edits() {
        assert!(validate(&c(Field::Mlo, true)).is_err());
        assert!(validate(&c(Field::MuMimo, true)).is_ok());
        assert!(serde_json::from_value::<Change>(
            json!({"field":"muMimo","on":true,"baseline":"a".repeat(64),"deviceId":"untrusted"})
        )
        .is_err());
    }
    #[test]
    fn firmware_capabilities_fill_cloud_omissions_and_wireless_relay_hides_channel() {
        let s = snapshot(Some(1), 0);
        assert!(
            s.report
                .switches
                .iter()
                .find(|s| s.field == Field::ChannelAdj)
                .unwrap()
                .supported
        );
        assert!(
            s.report
                .switches
                .iter()
                .find(|s| s.field == Field::Mlo)
                .unwrap()
                .supported
        );
        assert!(
            !s.report
                .switches
                .iter()
                .find(|s| s.field == Field::Aiot)
                .unwrap()
                .supported
        );
        assert_eq!(value(&s.report, Field::MuMimo), Some(true));
        assert_eq!(value(&s.report, Field::Wifi5), Some(false));
        assert!(
            !snapshot(Some(1), 1)
                .report
                .switches
                .iter()
                .find(|s| s.field == Field::ChannelAdj)
                .unwrap()
                .supported
        );
    }
    fn mlo(s: &Snapshot) -> Change {
        let mut values = s.report.wifi.values.clone();
        values.merged = true;
        values.bands[0].ssid = "edited-fixture".into();
        Change {
            field: Field::Mlo,
            on: true,
            bands: None,
            baseline: s.report.revision.clone(),
            wifi: Some(wifi::WifiChange {
                baseline: s.report.wifi.revision.clone(),
                values,
            }),
        }
    }
    #[test]
    fn mlo_enable_carries_draft_and_preserves_vendor_fields_without_normal_form_ver() {
        let s = snapshot(Some(1), 0);
        let (feature, config) = s.payloads(&device(), &mlo(&s)).unwrap();
        assert_eq!(
            feature,
            json!({"method":"GET","params":{"deviceId":"fixture-route","mlo_enable":1}})
        );
        let config = config.unwrap();
        assert_eq!(config["params"]["user_confirm"], 0);
        assert!(config["params"].get("ver").is_none());
        assert_eq!(config["params"]["txbf"], "3");
        assert_eq!(config["params"]["ssid1"], "edited-fixture");
        assert_eq!(config["params"]["bsd"], 1);
    }
    #[test]
    fn mlo_cannot_send_without_verified_ax_and_merged_prerequisites() {
        for ax in [None, Some(0)] {
            let s = snapshot(ax, 0);
            assert!(s.payloads(&device(), &mlo(&s)).is_err());
        }
        let s = snapshot(Some(1), 0);
        let mut change = mlo(&s);
        change.wifi.as_mut().unwrap().values.merged = false;
        assert!(s.payloads(&device(), &change).is_err());
        change = mlo(&s);
        change.baseline = "f".repeat(64);
        assert!(s.payloads(&device(), &change).is_err());
    }
    #[test]
    fn partial_mlo_readback_and_duplicate_queries_cannot_trigger_a_second_write() {
        let mut s = snapshot(Some(1), 0);
        let change = mlo(&s);
        s.report.switches[0].value = Some(true);
        assert!(!matches(&s.report, &change));
        assert_eq!(
            decision(&s.report, &change, Some(&change), false).unwrap(),
            wifi::SaveDecision::ConfirmPending
        );
        assert_eq!(
            decision(&s.report, &change, None, true).unwrap(),
            wifi::SaveDecision::ConfirmPending
        );
        s.report.wifi.values = change.wifi.as_ref().unwrap().values.clone();
        assert_eq!(
            decision(&s.report, &change, Some(&change), false).unwrap(),
            wifi::SaveDecision::Confirmed
        );
    }
    #[test]
    fn dfs_confirmation_is_never_treated_as_a_completed_config_request() {
        assert_eq!(
            config_receipt(json!({"need_confirm":"1","cac_time":600})).unwrap(),
            Receipt::NeedDfs(600)
        );
        assert!(config_receipt(json!({"need_confirm":1})).is_err());
        assert!(config_receipt(json!({"cac_time":0})).is_ok());
        let definite = AppError::new("routerGateway", "fixture rejection", false);
        let unknown = AppError::new("network", "fixture timeout", true);
        assert_eq!(
            combine_receipts(Err(definite.clone()), Err(unknown.clone()))
                .unwrap_err()
                .kind,
            "network"
        );
        assert_eq!(
            combine_receipts(Err(unknown), Err(definite))
                .unwrap_err()
                .kind,
            "network"
        );
    }
    fn config(s: &Snapshot) -> Change {
        let mut bands = crate::router_radio::values(&s.report).unwrap();
        bands[0].power = "mid".into();
        Change {
            field: Field::Configuration,
            on: false,
            baseline: s.report.revision.clone(),
            wifi: Some(wifi::WifiChange {
                baseline: s.report.wifi.revision.clone(),
                values: s.report.wifi.values.clone(),
            }),
            bands: Some(bands),
        }
    }
    #[test]
    fn full_radio_save_keeps_names_modes_and_unedited_bands_and_requires_readback() {
        let s = snapshot(Some(1), 0);
        let mut c = config(&s);
        c.wifi.as_mut().unwrap().values.bands[0].ssid = "edited-fixture".into();
        let (p, extra) = s.payloads(&device(), &c).unwrap();
        assert!(extra.is_none());
        assert_eq!(p["method"], "GET");
        assert_eq!(p["params"]["txpwr1"], "mid");
        assert_eq!(p["params"]["txpwr2"], "max");
        assert_eq!(p["params"]["ssid1"], "edited-fixture");
        assert_eq!(p["params"]["ax"], 1);
        assert_eq!(p["params"]["txbf"], "3");
        assert_eq!(p["params"]["user_confirm"], 0);
        assert!(p["params"].get("ver").is_none());
        let dfs = s.config_payload(&device(), &c, true).unwrap();
        assert_eq!(dfs["params"]["user_confirm"], 1);
        assert!(!matches(&s.report, &c));
        let mut current = s.report.clone();
        current.wifi.values = c.wifi.as_ref().unwrap().values.clone();
        assert!(!matches(&current, &c));
        current.bands[0].power = "mid".into();
        assert!(matches(&current, &c));
    }
    #[test]
    fn unsupported_radio_combinations_and_desynchronized_merged_fields_never_get_a_payload() {
        let s = snapshot(Some(1), 0);
        let mut c = config(&s);
        c.bands.as_mut().unwrap()[0].channel = 999;
        assert!(s.payloads(&device(), &c).is_err());
        c = config(&s);
        c.bands.as_mut().unwrap()[0].on = false;
        assert!(s.payloads(&device(), &c).is_err()); // no firmware switch capability in this fixture
        c = config(&s);
        c.wifi.as_mut().unwrap().values.merged = true;
        c.bands.as_mut().unwrap()[0].hidden = true;
        assert!(s.payloads(&device(), &c).is_err());
        c = config(&s);
        c.on = true;
        assert!(validate(&c).is_err());
    }
    #[test]
    fn enabling_encryption_requires_new_credentials_and_open_network_payload_clears_the_password() {
        let mut s = snapshot(Some(1), 0);
        s.report.bands[0].encryption = "none".into();
        s.report.wifi.encrypted[0] = false;
        s.report.wifi.values.bands[0].password = String::new();
        let mut c = config(&s);
        c.bands.as_mut().unwrap()[0].encryption = "psk2".into();
        assert!(s.payloads(&device(), &c).is_err());
        c.wifi.as_mut().unwrap().values.bands[0].password = "new-fixture-pass".into();
        assert!(s.payloads(&device(), &c).is_ok());
        c.bands.as_mut().unwrap()[0].encryption = "none".into();
        let (p, _) = s.payloads(&device(), &c).unwrap();
        assert_eq!(p["params"]["pwd1"], "");
    }
    #[test]
    fn dfs_requires_the_current_challenge_and_is_consumed_before_dispatch() {
        let s = snapshot(Some(1), 0);
        let change = config(&s);
        let id = uuid::Uuid::new_v4().to_string();
        let mut p = Pending {
            ready_at: None,
            change,
            dfs: Some(DfsChallenge {
                id: id.clone(),
                seconds: 600,
                waiting: false,
            }),
        };
        assert_eq!(
            p.dfs_decision(&s.report, &id, false).unwrap(),
            DfsDecision::Cancel
        );
        assert_eq!(
            p.dfs_decision(&s.report, &id, true).unwrap(),
            DfsDecision::Send
        );
        assert!(p.dfs_decision(&s.report, "wrong", true).is_err());
        p.consume_dfs(&id).unwrap();
        assert!(p.consume_dfs(&id).is_err());
        assert!(p.dfs_decision(&s.report, &id, true).is_err());
    }
    #[test]
    fn dfs_stops_if_the_network_changes_while_waiting_for_user_confirmation() {
        let s = snapshot(Some(1), 0);
        let id = uuid::Uuid::new_v4().to_string();
        let p = Pending {
            ready_at: None,
            change: config(&s),
            dfs: Some(DfsChallenge {
                id: id.clone(),
                seconds: 600,
                waiting: false,
            }),
        };
        let mut r = s.report.clone();
        r.wifi.revision = "f".repeat(64);
        assert_eq!(
            p.dfs_decision(&r, &id, true).unwrap(),
            DfsDecision::Conflict
        );
        r.bands[0].power = "mid".into();
        assert_eq!(
            p.dfs_decision(&r, &id, true).unwrap(),
            DfsDecision::Confirmed
        );
    }
    #[test]
    fn radar_wait_survives_readback_and_never_allows_a_consumed_dfs_token_to_be_replayed() {
        let s = snapshot(Some(1), 0);
        let mut pending = Pending {
            change: config(&s),
            dfs: None,
            ready_at: None,
        };
        let mut actual = s.report.clone();
        actual.bands[0].power = "mid".into();
        assert!(matches(&actual, &pending.change));
        pending.start_wait(60);
        assert!(!pending.matches(&actual));
        assert!(pending.view_dfs().unwrap().waiting);
        assert!(pending.consume_dfs("").is_err());
        pending.ready_at = Some(std::time::Instant::now() - std::time::Duration::from_secs(1));
        assert!(pending.matches(&actual));
        assert!(pending.view_dfs().is_none());
        assert_eq!(
            config_receipt(json!({"cac_time":60})).unwrap(),
            Receipt::Waiting(60)
        );
    }
    #[test]
    fn malformed_radar_receipts_remain_unknown_instead_of_becoming_accepted() {
        for value in [
            json!({"cac_time":-1}),
            json!({"cac_time":"invalid"}),
            json!({"need_confirm":2}),
            json!({"need_confirm":"not-a-bit"}),
        ] {
            assert!(config_receipt(value).is_err());
        }
        assert_eq!(config_receipt(json!({})).unwrap(), Receipt::Accepted);
        assert_eq!(
            config_receipt(json!({"cac_time":0})).unwrap(),
            Receipt::Accepted
        );
    }
    #[test]
    fn fresh_current_connection_rejects_closing_a_protected_band_before_payload_creation() {
        let mut s = snapshot(Some(1), 0);
        s.report.radio.can_switch = true;
        s.report.radio.connection = crate::router_connection::Protection {
            state: "protected",
            protected_bands: vec![1],
            reason: None,
        };
        let mut c = config(&s);
        c.bands.as_mut().unwrap()[1].on = false;
        assert_eq!(
            s.payloads(&device(), &c).unwrap_err().kind,
            "currentNetwork"
        );
        c = config(&s);
        c.bands.as_mut().unwrap()[0].on = false;
        assert!(s.payloads(&device(), &c).is_ok());
        c.wifi.as_mut().unwrap().values.merged = true;
        c.bands.as_mut().unwrap()[1].on = false;
        assert_eq!(
            s.payloads(&device(), &c).unwrap_err().kind,
            "currentNetwork"
        );
    }
}
