//! api=610: commands and fields observed in the router's public scene plugin.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub const PATH: &str = "/appgateway/third/miwifi/app/r/api/xqdatacenter/request";
pub const PLUGIN: &str = "2882303761520383774";
#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Speedtest,
    Browserlite,
    Video,
    Filedown,
    Game,
}
pub const KINDS: [Kind; 5] = [
    Kind::Speedtest,
    Kind::Browserlite,
    Kind::Video,
    Kind::Filedown,
    Kind::Game,
];
impl Kind {
    pub fn key(self) -> &'static str {
        match self {
            Self::Speedtest => "speedtest",
            Self::Browserlite => "browserlite",
            Self::Video => "video",
            Self::Filedown => "filedown",
            Self::Game => "game",
        }
    }
}
#[derive(Clone, Serialize)]
pub struct Metric {
    pub label: String,
    pub value: String,
}
#[derive(Clone, Serialize)]
pub struct Row {
    pub kind: Kind,
    pub id: Option<String>,
    pub name: String,
    pub time: Option<String>,
    pub metrics: Vec<Metric>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct History {
    pub did: String,
    pub kind: Kind,
    pub days: u8,
    pub page: u16,
    pub total_pages: u16,
    pub rows: Vec<Row>,
}
#[derive(Clone, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub request_id: String,
    pub baseline: String,
    pub selected: Vec<Kind>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Receipt {
    pub request_id: String,
    pub baseline: String,
    pub stage: String,
    pub selected: Vec<Kind>,
    pub observed_running: bool,
}
#[derive(Clone)]
pub(crate) struct Pending {
    pub change: Change,
    pub prior: Vec<Change>,
    pub created_at: u64,
    pub before: String,
    pub stage: String,
    pub observed_running: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub revision: String,
    pub selected: Vec<Kind>,
    pub duration_minutes: f64,
    pub start_enabled: bool,
    pub finished: bool,
    pub percent: Option<f64>,
    pub rows: Vec<Row>,
    pub fingerprint: String,
    pub reason: Option<String>,
    pub receipt: Option<Receipt>,
}
fn number(v: &Value) -> Option<f64> {
    v.as_f64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| n.is_finite() && *n >= 0. && *n <= 1e12)
}
fn integer(v: &Value) -> Option<u64> {
    v.as_u64().or_else(|| v.as_str()?.parse().ok())
}
fn text(v: &Value) -> Option<String> {
    let s = v.as_str()?;
    (!s.is_empty() && s.len() <= 512 && !s.chars().any(char::is_control)).then(|| s.to_owned())
}
fn identifier(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 64
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"._-".contains(&b))
}
fn digest(v: &Value) -> String {
    format!("{:x}", Sha256::digest(v.to_string().as_bytes()))
}
pub(crate) fn success(v: &Value) -> Result<()> {
    if matches!(integer(&v["code"]), Some(0 | 3012)) {
        Ok(())
    } else {
        Err(AppError::protocol())
    }
}
pub fn read_command(cmd: &str) -> bool {
    if ["show", "manualshow", "manualstatus", "servicesget"].contains(&cmd) {
        return true;
    }
    KINDS.into_iter().any(|k| {
        if cmd == format!("serviceshow0{}", k.key()) {
            return true;
        }
        if let Some(rest) = cmd.strip_prefix(&format!("logsget0{}0", k.key())) {
            return rest.is_ascii()
                && rest.len() >= 3
                && matches!(rest.as_bytes()[0], b'1' | b'2' | b'3')
                && rest.as_bytes()[1] == b'0'
                && rest[2..]
                    .parse::<u16>()
                    .is_ok_and(|n| (1..=100).contains(&n));
        }
        ["logsearch0", "manuallog0"].into_iter().any(|prefix| {
            cmd.strip_prefix(&format!("{prefix}{}0", k.key()))
                .is_some_and(identifier)
        })
    })
}
pub(crate) fn write_command(cmd: &str) -> bool {
    ["manualstart", "manualstop"].contains(&cmd)
        || cmd.strip_prefix("manualconfig0").is_some_and(|s| {
            s.len() == 5 && s.bytes().all(|b| b == b'1' || b == b'2') && s.contains('1')
        })
}
fn payload(device: &Device, cmd: &str) -> Result<Value> {
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    Ok(
        json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?,"payload":json!({"api":610,"pluginID":PLUGIN,"cmd":cmd}).to_string()}}),
    )
}
pub async fn read_raw(cloud: &Cloud, device: &Device, cmd: &str) -> Result<Value> {
    if !read_command(cmd) {
        return Err(AppError::invalid("不支持的测速读取命令。"));
    }
    let v = cloud
        .request_router_scene_read(payload(device, cmd)?)
        .await?;
    success(&v)?;
    Ok(v)
}
/// Raw acknowledgement for explicitly authorized protocol verification tools.
pub async fn write_raw(cloud: &Cloud, device: &Device, cmd: &str) -> Result<Value> {
    crate::router_indicator::writable(device)?;
    if !write_command(cmd) {
        return Err(AppError::invalid("不支持的测速操作。"));
    }
    let v = cloud
        .request_router_scene_write(payload(device, cmd)?)
        .await?;
    success(&v)?;
    Ok(v)
}
pub(crate) async fn write(cloud: &Cloud, device: &Device, cmd: &str) -> Result<()> {
    write_raw(cloud, device, cmd).await.map(|_| ())
}
pub(crate) fn config_command(selected: &[Kind]) -> Result<String> {
    if selected.is_empty()
        || selected.len() > 5
        || selected
            .iter()
            .enumerate()
            .any(|(i, k)| selected[..i].contains(k))
    {
        return Err(AppError::invalid("请选择测速项目。"));
    }
    Ok(format!(
        "manualconfig0{}",
        KINDS
            .into_iter()
            .map(|k| if selected.contains(&k) { '1' } else { '2' })
            .collect::<String>()
    ))
}
pub(crate) fn same_selection(a: &[Kind], b: &[Kind]) -> bool {
    a.len() == b.len() && a.iter().all(|k| b.contains(k))
}
pub(crate) fn valid_change(c: &Change) -> Result<()> {
    if uuid::Uuid::parse_str(&c.request_id).is_err()
        || c.baseline.len() != 64
        || !c.baseline.bytes().all(|b| b.is_ascii_hexdigit())
    {
        return Err(AppError::invalid("测速操作标识无效。"));
    }
    config_command(&c.selected)?;
    Ok(())
}
fn metrics(kind: Kind, v: &Value) -> Vec<Metric> {
    let fields: &[(&str, &[&str], &str)] = match kind {
        Kind::Speedtest => &[
            ("下载速度", &["download"], "Mbps"),
            ("上传速度", &["upload"], "Mbps"),
            ("平均延迟", &["rtt_avg"], "ms"),
            ("延迟抖动", &["rtt_jitter"], "ms"),
        ],
        Kind::Browserlite => &[
            ("首屏耗时", &["firstscreen_delay"], "ms"),
            ("页面耗时", &["pagetotal_delay"], "ms"),
        ],
        Kind::Video => &[
            ("平均速度", &["avg_speed"], "Mbps"),
            ("峰值速度", &["peak_download", "max_speed"], "Mbps"),
            ("卡顿比例", &["stalling_ratio"], ""),
            ("初始缓冲", &["initbuff_delay"], "ms"),
        ],
        Kind::Filedown => &[
            ("平均速度", &["avg_speed"], "Mbps"),
            ("峰值速度", &["max_speed"], "Mbps"),
        ],
        Kind::Game => &[
            ("平均延迟", &["rtt_delay"], "ms"),
            ("丢包率", &["pkg_loss"], ""),
            ("延迟抖动", &["rtt_jitter"], "ms"),
            ("最小延迟", &["min_delay", "rtt_min"], "ms"),
            ("最大延迟", &["max_delay", "rtt_max"], "ms"),
        ],
    };
    fields
        .iter()
        .filter_map(|(label, keys, unit)| {
            let n = keys.iter().find_map(|k| number(&v[*k]))?;
            Some(Metric {
                label: (*label).into(),
                value: format!("{n} {unit}").trim_end().to_owned(),
            })
        })
        .collect()
}
fn row(kind: Kind, v: &Value) -> Result<Row> {
    if !v.is_object() {
        return Err(AppError::protocol());
    }
    let id = v
        .get("index")
        .filter(|v| !v.is_null())
        .map(|v| {
            let s = v
                .as_str()
                .map(str::to_owned)
                .or_else(|| v.as_u64().map(|n| n.to_string()))
                .ok_or_else(AppError::protocol)?;
            if !identifier(&s) {
                return Err(AppError::protocol());
            }
            Ok(s)
        })
        .transpose()?;
    Ok(Row {
        kind,
        id,
        name: text(&v["name"]).unwrap_or_else(|| {
            if kind == Kind::Speedtest {
                "宽带测速"
            } else {
                "测速项目"
            }
            .into()
        }),
        time: text(&v["time"]),
        metrics: metrics(kind, v),
    })
}
pub(crate) fn parse(device: &Device, config: &Value, status: &Value) -> Result<Report> {
    success(config)?;
    success(status)?;
    let c = &config["msg"];
    let s = &status["msg"];
    let mut selected = Vec::new();
    for k in KINDS {
        match integer(&c["services"][k.key()]) {
            Some(1) => selected.push(k),
            Some(0 | 2) => {}
            _ => return Err(AppError::protocol()),
        }
    }
    let start_enabled = match integer(&c["start_enable"]) {
        Some(0) => false,
        Some(1) => true,
        _ => return Err(AppError::protocol()),
    };
    let duration = number(&c["expect_duration"])
        .filter(|n| *n <= 1440.)
        .ok_or_else(AppError::protocol)?;
    let state = integer(&s["scan"]["status"])
        .filter(|n| *n <= 255)
        .ok_or_else(AppError::protocol)?;
    let percent = number(&s["scan"]["percent"])
        .filter(|n| *n <= 1.)
        .map(|n| n * 100.);
    let mut rows = Vec::new();
    for k in KINDS {
        let v = &s[k.key()];
        if v.is_null() || v.as_object().is_some_and(|o| o.is_empty()) {
            continue;
        }
        if k == Kind::Speedtest {
            rows.push(row(k, v)?);
        } else {
            let a = v
                .as_array()
                .filter(|a| a.len() <= 256)
                .ok_or_else(AppError::protocol)?;
            for v in a {
                rows.push(row(k, v)?);
            }
        }
    }
    Ok(Report {
        did: device.did.clone(),
        model: device.model.clone(),
        revision: digest(c),
        selected,
        duration_minutes: duration,
        start_enabled,
        finished: state == 1,
        percent,
        rows,
        fingerprint: digest(s),
        reason: device
            .shared_read_only
            .then(|| "此设备仅有查看权限。".into()),
        receipt: None,
    })
}
pub(crate) async fn load(cloud: &Cloud, device: &Device) -> Result<Report> {
    let (a, b) = tokio::join!(
        read_raw(cloud, device, "manualshow"),
        read_raw(cloud, device, "manualstatus")
    );
    parse(device, &a?, &b?)
}
pub(crate) async fn check_available(cloud: &Cloud, device: &Device) -> Result<()> {
    let id = router::gateway_id(device)?;
    let req = |path| {
        cloud.request_router_read(
            path,
            json!({"method":"GET","params":{"deviceId":id,"language":"zh"}}),
        )
    };
    let (plugins, routers) =
        tokio::try_join!(req(crate::router_daily::PLUGINS), req(router::ROUTERS))?;
    crate::router_family::success(&plugins)?;
    crate::router_family::success(&routers)?;
    let installed = plugins["data"]["list"]
        .as_array()
        .is_some_and(|a| a.iter().any(|p| p["appId"] == PLUGIN));
    let mode = routers["deviceList"]
        .as_array()
        .and_then(|a| a.iter().find(|r| r["id"] == id))
        .and_then(|r| integer(&r["work_mode"]));
    if !installed || mode != Some(0) {
        return Err(AppError::new(
            "unsupported",
            "当前路由器或工作模式未提供场景测速。",
            false,
        ));
    }
    Ok(())
}
pub(crate) fn observe(report: &mut Report, p: &mut Pending) {
    match p.stage.as_str() {
        "configuring" if same_selection(&report.selected, &p.change.selected) => {
            p.stage = "configured".into()
        }
        "starting" | "running" | "unconfirmed" => {
            if report.finished
                && report.fingerprint != p.before
                && (p.observed_running || !report.rows.is_empty())
            {
                p.stage = "complete".into();
                p.before = report.fingerprint.clone();
            } else if !report.finished
                && (!report.start_enabled
                    || report.fingerprint != p.before
                        && (report.percent.is_some_and(|p| p > 0.) || !report.rows.is_empty()))
            {
                p.observed_running = true;
                p.stage = "running".into();
            } else if p.stage == "starting"
                && crate::models::epoch_secs().saturating_sub(p.created_at) >= 60
            {
                p.stage = "unconfirmed".into();
            }
        }
        "stopping" if report.start_enabled => {
            p.stage = "stopped".into();
            p.before = report.fingerprint.clone();
        }
        _ => {}
    }
    if terminal(p) && p.before != report.fingerprint {
        return;
    }
    report.receipt = Some(Receipt {
        request_id: p.change.request_id.clone(),
        baseline: p.change.baseline.clone(),
        stage: p.stage.clone(),
        selected: p.change.selected.clone(),
        observed_running: p.observed_running,
    });
}
pub(crate) fn terminal(p: &Pending) -> bool {
    ["complete", "stopped"].contains(&p.stage.as_str())
}
#[derive(Debug, PartialEq, Eq)]
pub(crate) enum StartDecision {
    Read,
    Resume,
    Fresh,
}
pub(crate) fn start_decision(p: Option<&Pending>, change: &Change) -> Result<StartDecision> {
    if let Some(p) = p {
        if let Some(previous) = p.prior.iter().find(|c| c.request_id == change.request_id) {
            return if previous == change {
                Ok(StartDecision::Read)
            } else {
                Err(AppError::invalid("测速操作标识已使用。"))
            };
        }
        if p.change.request_id == change.request_id {
            if p.change != *change {
                return Err(AppError::invalid("测速操作标识已使用。"));
            }
            return Ok(if p.stage == "configured" {
                StartDecision::Resume
            } else {
                StartDecision::Read
            });
        }
        if !terminal(p) {
            return Err(AppError::new(
                "busy",
                "上次测速状态尚未确认，请先查看状态。",
                false,
            ));
        }
    }
    Ok(StartDecision::Fresh)
}
pub(crate) async fn history(
    cloud: &Cloud,
    device: &Device,
    kind: Kind,
    days: u8,
    page: u16,
) -> Result<History> {
    let period = match days {
        1 => 1,
        3 => 2,
        7 => 3,
        _ => return Err(AppError::invalid("记录时间范围无效。")),
    };
    if !(1..=100).contains(&page) {
        return Err(AppError::invalid("记录页码无效。"));
    }
    let v = read_raw(
        cloud,
        device,
        &format!("logsget0{}0{period}0{page}", kind.key()),
    )
    .await?;
    parse_history(device, kind, days, page, &v)
}
pub(crate) fn parse_history(
    device: &Device,
    kind: Kind,
    days: u8,
    page: u16,
    v: &Value,
) -> Result<History> {
    success(v)?;
    let pages = integer(&v["total_page"])
        .filter(|n| *n <= 10000)
        .ok_or_else(AppError::protocol)? as u16;
    let mut rows = Vec::new();
    if v["log_data"].as_object().is_some_and(|o| o.is_empty()) {
    } else {
        for item in v["log_data"]
            .as_array()
            .filter(|a| a.len() <= 200)
            .ok_or_else(AppError::protocol)?
        {
            rows.push(row(kind, item)?);
        }
    }
    Ok(History {
        did: device.did.clone(),
        kind,
        days,
        page,
        total_pages: pages,
        rows,
    })
}
pub(crate) async fn detail(cloud: &Cloud, device: &Device, kind: Kind, id: &str) -> Result<Row> {
    if !identifier(id) {
        return Err(AppError::invalid("记录标识无效。"));
    }
    let v = read_raw(cloud, device, &format!("logsearch0{}0{id}", kind.key())).await?;
    row(kind, &v["msg"])
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn fresh_progress_proves_running_even_when_the_start_button_remains_enabled() {
        let mut p = pending();
        let mut s = idle();
        s["msg"]["scan"]["percent"] = json!(0.25);
        let mut r = parse(&device(), &config(), &s).unwrap();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "running");
        assert!(r.receipt.unwrap().observed_running);
    }
    #[test]
    fn an_accepted_but_unchanged_start_times_out_without_claiming_success() {
        let mut p = pending();
        p.created_at = crate::models::epoch_secs().saturating_sub(61);
        let mut r = parse(&device(), &config(), &idle()).unwrap();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "unconfirmed");
        assert!(!terminal(&p));
        assert!(!r.receipt.unwrap().observed_running);
    }
    #[test]
    fn earlier_operation_ids_remain_read_only_after_later_tests() {
        let mut p = pending();
        let earlier = p.change.clone();
        p.prior.push(earlier.clone());
        p.change.request_id = uuid::Uuid::new_v4().to_string();
        p.stage = "complete".into();
        assert_eq!(
            start_decision(Some(&p), &earlier).unwrap(),
            StartDecision::Read
        );
        let mut tampered = earlier;
        tampered.selected = vec![Kind::Game];
        assert!(start_decision(Some(&p), &tampered).is_err());
    }
    #[test]
    fn a_later_phone_test_does_not_inherit_the_previous_desktop_completion() {
        let mut p = pending();
        p.stage = "complete".into();
        let mut c = config();
        c["msg"]["start_enable"] = json!(0);
        let mut s = idle();
        s["msg"]["scan"]["percent"] = json!(0.2);
        let mut r = parse(&device(), &c, &s).unwrap();
        observe(&mut r, &mut p);
        assert!(r.receipt.is_none());
        assert!(!r.start_enabled && !r.finished);
    }
    #[test]
    fn operation_replays_cannot_start_again_and_conflicts_cannot_replace_pending() {
        let mut p = pending();
        let same = p.change.clone();
        for stage in [
            "configuring",
            "starting",
            "running",
            "stopping",
            "complete",
            "stopped",
        ] {
            p.stage = stage.into();
            assert_eq!(
                start_decision(Some(&p), &same).unwrap(),
                StartDecision::Read
            );
        }
        p.stage = "configured".into();
        assert_eq!(
            start_decision(Some(&p), &same).unwrap(),
            StartDecision::Resume
        );
        let mut changed = same.clone();
        changed.selected = vec![Kind::Game];
        assert!(start_decision(Some(&p), &changed).is_err());
        changed.request_id = uuid::Uuid::new_v4().to_string();
        assert!(start_decision(Some(&p), &changed).is_err());
        p.stage = "complete".into();
        assert_eq!(
            start_decision(Some(&p), &changed).unwrap(),
            StartDecision::Fresh
        );
    }
    fn device() -> Device {
        serde_json::from_value(json!({"did":"miwifi.fixture","model":router::MODEL,"online":true,"name":"fixture","roomId":"r","roomName":"r"})).unwrap()
    }
    fn config() -> Value {
        json!({"code":0,"msg":{"services":{"speedtest":"1","browserlite":"1","video":"1","filedown":"1","game":"1"},"expect_duration":5.71,"start_enable":1}})
    }
    fn idle() -> Value {
        json!({"code":"0","msg":{"scan":{"percent":"0","status":0}}})
    }
    fn pending() -> Pending {
        Pending {
            prior: vec![],
            created_at: crate::models::epoch_secs(),
            change: Change {
                request_id: uuid::Uuid::new_v4().to_string(),
                baseline: "a".repeat(64),
                selected: KINDS.to_vec(),
            },
            before: parse(&device(), &config(), &idle()).unwrap().fingerprint,
            stage: "starting".into(),
            observed_running: false,
        }
    }
    #[test]
    fn commands_exclude_scheduling_and_keep_reads_separate() {
        for cmd in [
            "manualshow",
            "manualstatus",
            "logsget0speedtest0201",
            "logsget0game030100",
            "logsearch0video0123",
            "manuallog0game0123",
        ] {
            assert!(read_command(cmd));
            assert!(!write_command(cmd));
        }
        for cmd in ["manualstart", "manualstop", "manualconfig011121"] {
            assert!(write_command(cmd));
            assert!(!read_command(cmd));
        }
        for cmd in [
            "autoenable01",
            "configcron0date01",
            "manualconfig022222",
            "manualconfig0111111",
            "logsget0video0200",
            "logsget0video0401",
            "logsget0game0你好",
            "logsearch0video0../",
            "",
        ] {
            assert!(!read_command(cmd));
            assert!(!write_command(cmd));
        }
        assert!(!router::is_read_path(PATH));
    }
    #[test]
    fn selection_order_matches_native_five_flag_protocol() {
        assert_eq!(
            config_command(&[Kind::Game, Kind::Speedtest]).unwrap(),
            "manualconfig012221"
        );
        assert!(config_command(&[]).is_err());
        assert!(config_command(&[Kind::Game, Kind::Game]).is_err());
    }
    #[test]
    fn runtime_idle_fields_are_not_fabricated_results() {
        let r = parse(&device(), &config(), &idle()).unwrap();
        assert!(r.start_enabled);
        assert!(!r.finished);
        assert_eq!(r.duration_minutes, 5.71);
        assert_eq!(r.percent, Some(0.));
        assert!(r.rows.is_empty());
        assert!(r.receipt.is_none());
    }
    #[test]
    fn malformed_state_never_looks_complete_or_empty_history() {
        let mut v = idle();
        v["msg"]["scan"]["status"] = json!("bad");
        assert!(parse(&device(), &config(), &v).is_err());
        assert!(parse_history(&device(), Kind::Game, 3, 1, &json!({"code":0})).is_err());
        assert!(parse_history(
            &device(),
            Kind::Game,
            3,
            1,
            &json!({"code":0,"log_data":{},"total_page":0})
        )
        .unwrap()
        .rows
        .is_empty());
    }
    #[test]
    fn old_completion_does_not_confirm_a_new_start() {
        let mut s = idle();
        s["msg"]["scan"]["status"] = json!(1);
        let mut r = parse(&device(), &config(), &s).unwrap();
        let mut p = pending();
        p.before = r.fingerprint.clone();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "starting");
        assert!(!terminal(&p));
    }
    #[test]
    fn only_independent_progress_and_fresh_completion_finish_a_request() {
        let mut c = config();
        c["msg"]["start_enable"] = json!(0);
        let mut s = idle();
        s["msg"]["scan"]["percent"] = json!(0.4);
        let mut r = parse(&device(), &c, &s).unwrap();
        let mut p = pending();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "running");
        assert_eq!(r.percent, Some(40.));
        s["msg"]["scan"]["status"] = json!(1);
        r = parse(&device(), &config(), &s).unwrap();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "complete");
    }
    #[test]
    fn stopped_requires_readback_enabling_a_new_test() {
        let mut p = pending();
        p.stage = "stopping".into();
        let mut c = config();
        c["msg"]["start_enable"] = json!(0);
        let mut r = parse(&device(), &c, &idle()).unwrap();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "stopping");
        r = parse(&device(), &config(), &idle()).unwrap();
        observe(&mut r, &mut p);
        assert_eq!(p.stage, "stopped");
    }
    #[test]
    fn zero_results_are_real_values_and_unknown_metrics_remain_absent() {
        let r = row(
            Kind::Speedtest,
            &json!({"download":0,"upload":"12.5","rtt_avg":"NaN","index":1}),
        )
        .unwrap();
        assert_eq!(r.metrics.len(), 2);
        assert_eq!(r.metrics[0].value, "0 Mbps");
        assert_eq!(r.id.as_deref(), Some("1"));
    }
    #[test]
    fn permission_and_mutation_payload_do_not_disclose_credentials() {
        let p = payload(&device(), "manualstart").unwrap();
        let inner: Value = serde_json::from_str(p["params"]["payload"].as_str().unwrap()).unwrap();
        assert_eq!(
            inner,
            json!({"api":610,"pluginID":PLUGIN,"cmd":"manualstart"})
        );
        assert_eq!(p["method"], "GET");
        let mut d = device();
        d.online = false;
        assert!(payload(&d, "manualstart").is_err());
    }
}
