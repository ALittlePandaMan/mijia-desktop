//! Typed cloud favorites for the independently verified wyra01 plugin.
//!
//! SDK 10065 forwards these four paths/parameters to standardCall. Cloud::request
//! already decrypts and unwraps result. No device properties, private refresh
//! triggers or activation commands are sent here. Mutations are issued once;
//! only subsequent list queries are retried, and no rollback is attempted.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, future::Future, time::Duration};

const GET_PATH: &str = "/user/get_user_coll";
const CREATE_PATH: &str = "/user/set_user_coll";
const EDIT_PATH: &str = "/user/edit_user_coll";
const DELETE_PATH: &str = "/user/del_user_coll";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LightFavoriteTab {
    Color,
    Temperature,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightFavorite {
    /// Canonical JSON of the original coll_id; 1 and "1" are distinct.
    pub id: String,
    pub name: String,
    pub brightness: Option<u8>,
    pub color: Option<u32>,
    pub temperature_percent: Option<u8>,
    pub tab: LightFavoriteTab,
    pub revision: String,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightFavoritesReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub items: Vec<LightFavorite>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LightFavoriteChange {
    Create {
        name: String,
        brightness: u8,
        color: u32,
        temperature_percent: u8,
        tab: LightFavoriteTab,
    },
    Edit {
        id: String,
        baseline: String,
        name: String,
        brightness: u8,
        color: u32,
        temperature_percent: u8,
        tab: LightFavoriteTab,
    },
    Delete {
        id: String,
        baseline: String,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LightFavoriteStatus {
    Confirmed,
    Rejected,
    Uncertain,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightFavoriteResult {
    pub status: LightFavoriteStatus,
    pub message: String,
    pub report: Option<LightFavoritesReport>,
}

pub(crate) fn validate_device(device: &Device) -> Result<()> {
    if device.model != "yeelink.light.wyra01"
        || device.split_route.is_some()
        || device.unsupported_reason.is_some()
        || device.control_did() != device.did
    {
        return Err(AppError::new(
            "unsupported",
            "当前设备尚无经过核对的灯光收藏适配。",
            false,
        ));
    }
    // These records live in the cloud, so offline lights can still have their
    // favorites edited. Activation must separately enforce device permissions.
    Ok(())
}

fn normalized_name(name: &str) -> Result<String> {
    if name
        .chars()
        .any(|ch| ch.is_control() || u32::from(ch) > 0xffff)
    {
        return Err(AppError::invalid(
            "收藏名称不能包含控制字符或补充平面字符。",
        ));
    }
    let name = name.trim();
    if name.is_empty() || name.encode_utf16().count() > 4 {
        return Err(AppError::invalid("请输入1–4个UTF-16单位的收藏名称。"));
    }
    // Accepted names contain only BMP characters. The plugin's surrogate-pair
    // entity transform is therefore identity; this is not HTML escaping.
    Ok(name.into())
}

fn identity(value: &Value) -> Result<String> {
    let valid = match value {
        Value::String(text) => !text.trim().is_empty() && !text.chars().any(char::is_control),
        Value::Number(number) => number.is_i64() || number.is_u64(),
        _ => false,
    };
    if !valid {
        return Err(AppError::protocol());
    }
    serde_json::to_string(value).map_err(|_| AppError::protocol())
}

fn parsed_id(text: &str) -> Result<Value> {
    let value: Value =
        serde_json::from_str(text).map_err(|_| AppError::invalid("收藏引用无效，请重新读取。"))?;
    if identity(&value).ok().as_deref() != Some(text) {
        return Err(AppError::invalid("收藏引用无效，请重新读取。"));
    }
    Ok(value)
}

pub(crate) fn validate(change: &LightFavoriteChange) -> Result<()> {
    validate_change(change, true)
}

pub(crate) fn validate_confirmation(change: &LightFavoriteChange) -> Result<()> {
    validate_change(change, false)
}

fn validate_change(change: &LightFavoriteChange, baseline_required: bool) -> Result<()> {
    let target = match change {
        LightFavoriteChange::Create {
            name,
            brightness,
            color,
            temperature_percent,
            ..
        }
        | LightFavoriteChange::Edit {
            name,
            brightness,
            color,
            temperature_percent,
            ..
        } => {
            normalized_name(name)?;
            if !(1..=100).contains(brightness) || *color > 0xffffff || *temperature_percent > 100 {
                return Err(AppError::invalid("收藏亮度、RGB或色温百分比无效。"));
            }
            match change {
                LightFavoriteChange::Edit { id, baseline, .. } => Some((id, baseline)),
                _ => None,
            }
        }
        LightFavoriteChange::Delete { id, baseline } => Some((id, baseline)),
    };
    if let Some((id, baseline)) = target {
        parsed_id(id)?;
        if baseline_required
            && (baseline.len() != 64
                || !baseline
                    .bytes()
                    .all(|ch| ch.is_ascii_digit() || (b'a'..=b'f').contains(&ch)))
        {
            return Err(AppError::invalid("收藏版本引用无效，请重新读取。"));
        }
    }
    Ok(())
}

fn field(value: &Value, max: u64) -> Option<u32> {
    value
        .as_u64()
        .filter(|number| *number <= max)
        .map(|number| number as u32)
}

fn parse(device: &Device, value: &Value) -> Result<LightFavoritesReport> {
    let rows = value.as_array().ok_or_else(AppError::protocol)?;
    let mut seen = HashSet::new();
    let mut items = Vec::with_capacity(rows.len());
    for row in rows {
        if !row.is_object() || row["did"].as_str() != Some(device.did.as_str()) {
            return Err(AppError::protocol());
        }
        let id = identity(&row["coll_id"])?;
        if !seen.insert(id.clone()) {
            return Err(AppError::protocol());
        }
        let name = row["name"]
            .as_str()
            .ok_or_else(AppError::protocol)?
            .to_owned();
        let mut reasons = Vec::new();
        if normalized_name(&name).is_err() {
            reasons.push("收藏名称不符合已核对的名称规则。");
        }
        let content = &row["content"];
        let brightness = field(&content["brightness"], 100).filter(|number| *number >= 1);
        let color = field(&content["color"], 0xffffff);
        let ct = field(&content["color_temperature"], 255).filter(|byte| byte & 127 <= 100);
        if brightness.is_none() {
            reasons.push("收藏亮度未提供有效的1–100整数。");
        }
        if color.is_none() {
            reasons.push("收藏未提供有效的uint24 RGB颜色。");
        }
        if ct.is_none() {
            reasons.push("收藏未提供有效的打包色温字节。");
        }
        // Hash only this exact row, never the surrounding list. JSON map keys
        // are serialized canonically by serde_json's ordered Map configuration.
        let bytes = serde_json::to_vec(row).map_err(|_| AppError::protocol())?;
        items.push(LightFavorite {
            id,
            name,
            brightness: brightness.map(|number| number as u8),
            color,
            temperature_percent: ct.map(|byte| (byte & 127) as u8),
            // A required display discriminator for invalid ct has no executable
            // meaning: its reason is present and temperature_percent is None.
            tab: if ct.is_some_and(|byte| byte & 128 != 0) {
                LightFavoriteTab::Temperature
            } else {
                LightFavoriteTab::Color
            },
            revision: format!("{:x}", Sha256::digest(bytes)),
            reason: (!reasons.is_empty()).then(|| reasons.join("")),
        });
    }
    Ok(LightFavoritesReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        items,
    })
}

fn conflict() -> AppError {
    AppError::new(
        "lightFavoriteConflict",
        "收藏或名称已经变化，请重新读取后再操作。",
        true,
    )
}

fn same_name(item: &LightFavorite, name: &str) -> bool {
    item.name.trim() == name
}

fn content(change: &LightFavoriteChange) -> Result<Value> {
    match change {
        LightFavoriteChange::Create {
            brightness,
            color,
            temperature_percent,
            tab,
            ..
        }
        | LightFavoriteChange::Edit {
            brightness,
            color,
            temperature_percent,
            tab,
            ..
        } => {
            let byte = u32::from(*temperature_percent)
                | if *tab == LightFavoriteTab::Temperature {
                    128
                } else {
                    0
                };
            Ok(json!({"brightness":brightness,"color":color,"color_temperature":byte}))
        }
        LightFavoriteChange::Delete { .. } => Err(AppError::invalid("删除收藏没有颜色内容。")),
    }
}

struct Prepared {
    path: &'static str,
    params: Value,
}

fn prepare(
    device: &Device,
    current: &LightFavoritesReport,
    change: &LightFavoriteChange,
) -> Result<Prepared> {
    validate(change)?;
    if current.did != device.did || current.model != device.model {
        return Err(AppError::stale());
    }
    let find = |id: &str, baseline: &str| -> Result<&LightFavorite> {
        let item = current
            .items
            .iter()
            .find(|item| item.id == id)
            .ok_or_else(conflict)?;
        if item.revision != baseline {
            return Err(conflict());
        }
        Ok(item)
    };
    match change {
        LightFavoriteChange::Create { name, .. } => {
            let name = normalized_name(name)?;
            if current.items.iter().any(|item| same_name(item, &name)) {
                // A pre-existing identical favorite is a conflict too. Do not
                // pretend its ID was newly created by this operation.
                return Err(conflict());
            }
            Ok(Prepared {
                path: CREATE_PATH,
                params: json!({"did":device.did,"name":name,"content":content(change)?}),
            })
        }
        LightFavoriteChange::Edit {
            id, baseline, name, ..
        } => {
            let item = find(id, baseline)?;
            let name = normalized_name(name)?;
            if current
                .items
                .iter()
                .any(|other| other.id != item.id && same_name(other, &name))
            {
                return Err(conflict());
            }
            Ok(Prepared {
                path: EDIT_PATH,
                params: json!({"coll_id":parsed_id(&item.id)?,"newname":name,"content":content(change)?}),
            })
        }
        LightFavoriteChange::Delete { id, baseline } => {
            let item = find(id, baseline)?;
            Ok(Prepared {
                path: DELETE_PATH,
                params: json!({"coll_id":parsed_id(&item.id)?,"did":device.did}),
            })
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum Match {
    Confirmed,
    Mismatch,
    Unknown,
}

fn fields_match(item: &LightFavorite, change: &LightFavoriteChange) -> Match {
    if item.reason.is_some() {
        return Match::Unknown;
    }
    match change {
        LightFavoriteChange::Create {
            name,
            brightness,
            color,
            temperature_percent,
            tab,
        }
        | LightFavoriteChange::Edit {
            name,
            brightness,
            color,
            temperature_percent,
            tab,
            ..
        } => {
            if normalized_name(name)
                .ok()
                .is_some_and(|name| same_name(item, &name))
                && item.brightness == Some(*brightness)
                && item.color == Some(*color)
                && item.temperature_percent == Some(*temperature_percent)
                && item.tab == *tab
            {
                Match::Confirmed
            } else {
                Match::Mismatch
            }
        }
        LightFavoriteChange::Delete { .. } => Match::Mismatch,
    }
}

fn matches(current: &LightFavoritesReport, change: &LightFavoriteChange) -> Match {
    match change {
        LightFavoriteChange::Create { name, .. } => {
            let Ok(name) = normalized_name(name) else {
                return Match::Unknown;
            };
            let candidates: Vec<_> = current
                .items
                .iter()
                .filter(|item| same_name(item, &name))
                .collect();
            if candidates.len() == 1 {
                fields_match(candidates[0], change)
            } else {
                // Absence and non-unique names are both real mismatches, never
                // reasons to invent an ID from the mutation's acknowledgement.
                Match::Mismatch
            }
        }
        LightFavoriteChange::Edit { id, .. } => current
            .items
            .iter()
            .find(|item| item.id == *id)
            .map(|item| fields_match(item, change))
            .unwrap_or(Match::Mismatch),
        LightFavoriteChange::Delete { id, .. } => {
            if current.items.iter().any(|item| item.id == *id) {
                Match::Mismatch
            } else {
                Match::Confirmed
            }
        }
    }
}

trait Transport: Sync {
    fn request(
        &self,
        path: &'static str,
        params: Value,
    ) -> impl Future<Output = Result<Value>> + Send;
}
struct CloudTransport<'a>(&'a Cloud, &'a Device);
impl Transport for CloudTransport<'_> {
    async fn request(&self, path: &'static str, params: Value) -> Result<Value> {
        self.0.request_favorite(self.1, path, params).await
    }
}

#[derive(Clone, Copy)]
struct Policy {
    timeout: Duration,
    delays: [Duration; 2],
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(8),
            delays: [Duration::from_millis(750), Duration::from_millis(1500)],
        }
    }
}
fn timeout_error() -> AppError {
    AppError::new("network", "云收藏请求超时，请稍后查询确认。", true)
}
async fn read<T: Transport>(
    transport: &T,
    device: &Device,
    policy: Policy,
) -> Result<LightFavoritesReport> {
    let response = tokio::time::timeout(
        policy.timeout,
        transport.request(GET_PATH, json!({"did":device.did})),
    )
    .await
    .unwrap_or_else(|_| Err(timeout_error()))?;
    parse(device, &response)
}

fn context_error(error: &AppError) -> bool {
    matches!(error.kind.as_str(), "authExpired" | "staleContext")
}
fn explicit_rejection(error: &AppError) -> bool {
    matches!(
        error.kind.as_str(),
        "permissionDenied" | "invalidInput" | "invalidValue" | "unsupported"
    ) || error.kind == "cloud" && !error.retryable
}

async fn verify<T, F, Fut>(
    transport: &T,
    device: &Device,
    change: &LightFavoriteChange,
    rejected: Option<String>,
    check: &F,
    policy: Policy,
) -> Result<LightFavoriteResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut latest = None;
    let mut mismatches = 0;
    let mut last_mismatch = false;
    for attempt in 0..=policy.delays.len() {
        if attempt > 0 && !policy.delays[attempt - 1].is_zero() {
            tokio::time::sleep(policy.delays[attempt - 1]).await;
        }
        check(false).await?;
        let response = read(transport, device, policy).await;
        check(false).await?;
        last_mismatch = false;
        match response {
            Ok(report) => {
                let state = matches(&report, change);
                latest = Some(report);
                match state {
                    Match::Confirmed => {
                        return Ok(LightFavoriteResult {
                            status: LightFavoriteStatus::Confirmed,
                            message: "云收藏已通过重新查询确认。".into(),
                            report: latest,
                        })
                    }
                    Match::Mismatch => {
                        mismatches += 1;
                        last_mismatch = true;
                    }
                    Match::Unknown => {}
                }
            }
            Err(error) if context_error(&error) => return Err(error),
            Err(_) => {}
        }
    }
    let failed = rejected.is_some() || last_mismatch && mismatches >= 2;
    let message = if let Some(reason) = rejected {
        format!(
            "云服务拒绝了收藏修改：{reason}{}",
            if latest.is_some() {
                "已保留最新查询结果；未重复提交。"
            } else {
                "尚未取得最新列表，请稍后查询；未重复提交。"
            }
        )
    } else if failed {
        "多次查询仍未出现唯一匹配的目标收藏，已保留实际列表；未重复提交或回滚。".into()
    } else {
        "收藏修改尚未确认，请稍后重新查询；不会自动重复提交或回滚。".into()
    };
    Ok(LightFavoriteResult {
        status: if failed {
            LightFavoriteStatus::Rejected
        } else {
            LightFavoriteStatus::Uncertain
        },
        message,
        report: latest,
    })
}

async fn change_with<T, F, Fut>(
    transport: &T,
    device: &Device,
    change: &LightFavoriteChange,
    check: &F,
    policy: Policy,
) -> Result<LightFavoriteResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    validate_device(device)?;
    validate(change)?;
    check(true).await?;
    let current = read(transport, device, policy).await;
    check(false).await?;
    let current = current.map_err(|error| {
        if context_error(&error) {
            error
        } else {
            AppError::new(
                "unconfirmed",
                "保存前无法确认当前收藏列表，未发送修改，请重新读取。",
                true,
            )
        }
    })?;
    let prepared = prepare(device, &current, change)?;
    if matches!(change, LightFavoriteChange::Edit { .. })
        && matches(&current, change) == Match::Confirmed
    {
        return Ok(LightFavoriteResult {
            status: LightFavoriteStatus::Confirmed,
            message: "当前收藏内容已与目标一致。".into(),
            report: Some(current),
        });
    }
    check(true).await?;
    // The only mutation in this entire operation. Even an unknown response
    // shape or a lost acknowledgement must never cause another mutation.
    let response = tokio::time::timeout(
        policy.timeout,
        transport.request(prepared.path, prepared.params),
    )
    .await
    .unwrap_or_else(|_| Err(timeout_error()));
    check(false).await?;
    let rejected = match response {
        Err(error) if context_error(&error) => return Err(error),
        Err(error) if explicit_rejection(&error) => Some(error.message),
        _ => None,
    };
    verify(transport, device, change, rejected, check, policy).await
}

async fn confirm_with<T, F, Fut>(
    transport: &T,
    device: &Device,
    change: &LightFavoriteChange,
    check: &F,
    policy: Policy,
) -> Result<LightFavoriteResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    validate_device(device)?;
    validate_confirmation(change)?;
    // In particular, do not call prepare: the original revision is intentionally
    // ignored and a create's now-present target is the expected success state.
    verify(transport, device, change, None, check, policy).await
}

pub(crate) async fn load(cloud: &Cloud, device: &Device) -> Result<LightFavoritesReport> {
    validate_device(device)?;
    read(&CloudTransport(cloud, device), device, Policy::default()).await
}

pub(crate) async fn change<F, Fut>(
    cloud: &Cloud,
    device: &Device,
    change: &LightFavoriteChange,
    check: F,
) -> Result<LightFavoriteResult>
where
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    change_with(
        &CloudTransport(cloud, device),
        device,
        change,
        &check,
        Policy::default(),
    )
    .await
}

pub(crate) async fn confirm<F, Fut>(
    cloud: &Cloud,
    device: &Device,
    change: &LightFavoriteChange,
    check: F,
) -> Result<LightFavoriteResult>
where
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    confirm_with(
        &CloudTransport(cloud, device),
        device,
        change,
        &check,
        Policy::default(),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        collections::VecDeque,
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
    };

    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture-light","model":"yeelink.light.wyra01","name":"fixture","online":true,"roomId":"room","roomName":"room"})).unwrap()
    }
    fn row(id: Value, name: &str) -> Value {
        json!({"coll_id":id,"did":"fixture-light","name":name,"content":{"brightness":75,"color":0xffffff,"color_temperature":178}})
    }
    fn create() -> LightFavoriteChange {
        LightFavoriteChange::Create {
            name: " 阅读 ".into(),
            brightness: 50,
            color: 0x123456,
            temperature_percent: 75,
            tab: LightFavoriteTab::Color,
        }
    }
    fn wanted(id: Value) -> Value {
        json!({"coll_id":id,"did":"fixture-light","name":"阅读","content":{"brightness":50,"color":0x123456,"color_temperature":75}})
    }
    fn edit(item: &LightFavorite) -> LightFavoriteChange {
        LightFavoriteChange::Edit {
            id: item.id.clone(),
            baseline: item.revision.clone(),
            name: " 阅读 ".into(),
            brightness: 50,
            color: 0x123456,
            temperature_percent: 75,
            tab: LightFavoriteTab::Color,
        }
    }
    fn delete(item: &LightFavorite) -> LightFavoriteChange {
        LightFavoriteChange::Delete {
            id: item.id.clone(),
            baseline: item.revision.clone(),
        }
    }
    fn policy() -> Policy {
        Policy {
            timeout: Duration::from_millis(20),
            delays: [Duration::ZERO; 2],
        }
    }
    async fn context(_: bool) -> Result<()> {
        Ok(())
    }

    enum Reply {
        Data(Result<Value>),
        Hang,
    }
    #[derive(Clone, Debug)]
    struct Call {
        path: &'static str,
        params: Value,
    }
    struct RecordingTransport {
        replies: Mutex<VecDeque<Reply>>,
        calls: Mutex<Vec<Call>>,
    }
    impl RecordingTransport {
        fn new(replies: Vec<Reply>) -> Self {
            Self {
                replies: Mutex::new(replies.into()),
                calls: Mutex::new(vec![]),
            }
        }
        fn writes(&self) -> Vec<Call> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|call| call.path != GET_PATH)
                .cloned()
                .collect()
        }
    }
    impl Transport for RecordingTransport {
        async fn request(&self, path: &'static str, params: Value) -> Result<Value> {
            self.calls.lock().unwrap().push(Call { path, params });
            let reply = self
                .replies
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected request or repeated mutation");
            match reply {
                Reply::Data(result) => result,
                Reply::Hang => std::future::pending().await,
            }
        }
    }
    fn ok(value: Value) -> Reply {
        Reply::Data(Ok(value))
    }
    fn network() -> Reply {
        Reply::Data(Err(AppError::new("network", "fixture timeout", true)))
    }

    #[test]
    fn empty_array_is_a_real_empty_list_but_other_envelopes_are_not() {
        let report = parse(&device(), &json!([])).unwrap();
        assert!(report.items.is_empty());
        for value in [Value::Null, json!({}), json!({"result":[]}), json!("[]")] {
            assert_eq!(parse(&device(), &value).unwrap_err().kind, "protocol");
        }
    }
    #[test]
    fn id_json_keeps_numeric_string_and_large_integer_identities_distinct() {
        let list = json!([
            row(json!(1), "甲"),
            row(json!("1"), "乙"),
            row(json!(18446744073709551615_u64), "丙")
        ]);
        let report = parse(&device(), &list).unwrap();
        assert_eq!(
            report
                .items
                .iter()
                .map(|item| item.id.as_str())
                .collect::<Vec<_>>(),
            ["1", "\"1\"", "18446744073709551615"]
        );
        assert_eq!(
            parsed_id(&report.items[2].id).unwrap(),
            json!(18446744073709551615_u64)
        );
        assert_eq!(report.items[0].brightness, Some(75));
        assert_eq!(report.items[0].temperature_percent, Some(50));
        assert_eq!(report.items[0].tab, LightFavoriteTab::Temperature);
        assert_eq!(report.items[0].color, Some(0xffffff));
        assert!(report.items.iter().all(|item| item.reason.is_none()));
    }
    #[test]
    fn foreign_missing_or_duplicated_identity_rejects_the_entire_list() {
        for id in [
            Value::Null,
            json!(true),
            json!(1.0),
            json!({}),
            json!(""),
            json!(" "),
            json!("line\n"),
        ] {
            assert_eq!(
                parse(&device(), &json!([row(id, "甲")])).unwrap_err().kind,
                "protocol"
            );
        }
        let mut foreign = row(json!(1), "甲");
        foreign["did"] = json!("other-private-id");
        assert_eq!(
            parse(&device(), &json!([foreign])).unwrap_err().kind,
            "protocol"
        );
        let mut missing = row(json!(1), "甲");
        missing.as_object_mut().unwrap().remove("did");
        assert!(parse(&device(), &json!([missing])).is_err());
        let item = row(json!(1), "甲");
        assert!(parse(&device(), &json!([item.clone(), item])).is_err());
        let mut bad_name = row(json!(1), "甲");
        bad_name["name"] = Value::Null;
        assert!(parse(&device(), &json!([bad_name])).is_err());
    }
    #[test]
    fn invalid_content_fields_are_unavailable_without_inventing_values() {
        for (field, value) in [
            ("brightness", json!(0)),
            ("brightness", json!(101)),
            ("brightness", json!(75.0)),
            ("color", json!(-1)),
            ("color", json!(16777216)),
            ("color_temperature", json!(256)),
            ("color_temperature", json!(255)),
            ("color_temperature", Value::Null),
        ] {
            let mut item = row(json!(1), "甲");
            item["content"][field] = value;
            let report = parse(&device(), &json!([item])).unwrap();
            let item = &report.items[0];
            assert!(item.reason.is_some());
            match field {
                "brightness" => assert!(item.brightness.is_none()),
                "color" => assert!(item.color.is_none()),
                _ => assert!(item.temperature_percent.is_none()),
            }
        }
        let mut item = row(json!(1), "甲");
        item.as_object_mut().unwrap().remove("content");
        let report = parse(&device(), &json!([item])).unwrap();
        let item = &report.items[0];
        assert!(
            item.brightness.is_none()
                && item.color.is_none()
                && item.temperature_percent.is_none()
                && item.reason.is_some()
        );
        let mut black = row(json!(1), "甲");
        black["content"]["color"] = json!(0);
        black["content"]["color_temperature"] = json!(0);
        let report = parse(&device(), &json!([black])).unwrap();
        assert_eq!(report.items[0].color, Some(0));
        assert_eq!(report.items[0].temperature_percent, Some(0));
    }
    #[test]
    fn names_use_trimmed_bmp_utf16_rules_without_html_escaping_or_emoji_defaults() {
        assert_eq!(normalized_name(" 阅读 ").unwrap(), "阅读");
        assert_eq!(normalized_name("ABCD").unwrap(), "ABCD");
        assert_eq!(normalized_name("<&>").unwrap(), "<&>");
        for name in ["", "   ", "ABCDE", "😀", "𠀀", "a\nb", "\tAB", "a\u{7f}"] {
            assert_eq!(normalized_name(name).unwrap_err().kind, "invalidInput");
        }
    }
    #[test]
    fn changes_are_typed_and_reject_unknown_fields_bad_ids_and_invalid_numbers() {
        let base = json!({"operation":"create","name":"阅读","brightness":50,"color":0,"temperaturePercent":0,"tab":"color"});
        validate(&serde_json::from_value::<LightFavoriteChange>(base.clone()).unwrap()).unwrap();
        for (key, value) in [
            ("brightness", json!(0)),
            ("brightness", json!(101)),
            ("color", json!(16777216)),
            ("temperaturePercent", json!(101)),
        ] {
            let mut invalid = base.clone();
            invalid[key] = value;
            assert!(validate(&serde_json::from_value(invalid).unwrap()).is_err());
        }
        for (key, value) in [
            ("brightness", json!(-1)),
            ("brightness", json!(1.0)),
            ("tab", json!("other")),
            ("extra", json!(true)),
        ] {
            let mut invalid = base.clone();
            invalid[key] = value;
            assert!(serde_json::from_value::<LightFavoriteChange>(invalid).is_err());
        }
        for id in ["not-json", "null", "1.0", "true", "[]", "{}", " 1", "\"\""] {
            assert!(parsed_id(id).is_err());
        }
        let change = LightFavoriteChange::Delete {
            id: "1".into(),
            baseline: "bad".into(),
        };
        assert!(validate(&change).is_err());
        assert!(validate_confirmation(&change).is_ok());
    }
    #[test]
    fn target_revision_does_not_bind_other_items_or_order_but_detects_target_changes() {
        let list = json!([row(json!(1), "甲"), row(json!(2), "乙")]);
        let current = parse(&device(), &list).unwrap();
        let change = edit(&current.items[0]);
        let revised = parse(
            &device(),
            &json!([row(json!(3), "丙"), row(json!(1), "甲")]),
        )
        .unwrap();
        assert_eq!(revised.items[1].revision, current.items[0].revision);
        assert!(prepare(&device(), &revised, &change).is_ok());
        let mut changed = row(json!(1), "甲");
        changed["content"]["color"] = json!(123);
        assert_eq!(
            prepare(
                &device(),
                &parse(&device(), &json!([changed])).unwrap(),
                &change
            )
            .err()
            .unwrap()
            .kind,
            "lightFavoriteConflict"
        );
    }
    #[test]
    fn creation_duplicates_always_conflict_and_edit_excludes_its_own_stable_id() {
        let current = parse(&device(), &json!([wanted(json!(1))])).unwrap();
        assert_eq!(
            prepare(&device(), &current, &create()).err().unwrap().kind,
            "lightFavoriteConflict"
        );
        assert!(prepare(&device(), &current, &edit(&current.items[0])).is_ok());
        let current = parse(
            &device(),
            &json!([row(json!(1), "甲"), row(json!(2), " 阅读 ")]),
        )
        .unwrap();
        assert_eq!(
            prepare(&device(), &current, &edit(&current.items[0]))
                .err()
                .unwrap()
                .kind,
            "lightFavoriteConflict"
        );
    }
    #[test]
    fn exact_sdk_payload_preserves_raw_id_and_both_inactive_color_fields() {
        let current = parse(&device(), &json!([row(json!("1"), "甲")])).unwrap();
        let mut change = edit(&current.items[0]);
        if let LightFavoriteChange::Edit { tab, .. } = &mut change {
            *tab = LightFavoriteTab::Temperature;
        }
        let prepared = prepare(&device(), &current, &change).unwrap();
        assert_eq!(prepared.path, EDIT_PATH);
        assert_eq!(
            prepared.params,
            json!({"coll_id":"1","newname":"阅读","content":{"brightness":50,"color":0x123456,"color_temperature":203}})
        );
        assert!(prepared.params.get("did").is_none());
        let deleted = prepare(&device(), &current, &delete(&current.items[0])).unwrap();
        assert_eq!(deleted.path, DELETE_PATH);
        assert_eq!(deleted.params, json!({"did":"fixture-light","coll_id":"1"}));
        let empty = parse(&device(), &json!([])).unwrap();
        let created = prepare(&device(), &empty, &create()).unwrap();
        assert_eq!(created.path, CREATE_PATH);
        assert_eq!(
            created.params,
            json!({"did":"fixture-light","name":"阅读","content":{"brightness":50,"color":0x123456,"color_temperature":75}})
        );
    }
    #[test]
    fn model_scope_rejects_splits_but_offline_cloud_records_remain_editable() {
        let mut device = device();
        device.online = false;
        validate_device(&device).unwrap();
        device.model = "other.light.v1".into();
        assert_eq!(validate_device(&device).unwrap_err().kind, "unsupported");
        device.model = "yeelink.light.wyra01".into();
        device.split_route = Some(crate::models::SplitRoute {
            parent_did: "parent".into(),
            service_iid: 2,
        });
        assert!(validate_device(&device).is_err());
    }
    #[test]
    fn create_confirmation_requires_a_unique_name_and_all_inactive_fields_too() {
        assert_eq!(
            matches(
                &parse(&device(), &json!([wanted(json!(1))])).unwrap(),
                &create()
            ),
            Match::Confirmed
        );
        assert_eq!(
            matches(
                &parse(&device(), &json!([wanted(json!(1)), wanted(json!(2))])).unwrap(),
                &create()
            ),
            Match::Mismatch
        );
        let mut different = wanted(json!(1));
        different["content"]["color_temperature"] = json!(76);
        assert_eq!(
            matches(&parse(&device(), &json!([different])).unwrap(), &create()),
            Match::Mismatch
        );
        let mut unknown = wanted(json!(1));
        unknown["content"]["color"] = Value::Null;
        assert_eq!(
            matches(&parse(&device(), &json!([unknown])).unwrap(), &create()),
            Match::Unknown
        );
    }

    #[tokio::test]
    async fn create_sends_one_request_and_never_uses_the_ack_to_invent_an_id() {
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            ok(json!({"coll_id":999})),
            ok(json!([wanted(json!("actual"))])),
        ]);
        let result = change_with(&transport, &device(), &create(), &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightFavoriteStatus::Confirmed);
        assert_eq!(result.report.unwrap().items[0].id, "\"actual\"");
        let writes = transport.writes();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].path, CREATE_PATH);
        assert!(transport
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| [GET_PATH, CREATE_PATH].contains(&call.path)));
        assert_eq!(
            transport.calls.lock().unwrap()[0].params,
            json!({"did":"fixture-light"})
        );
    }
    #[tokio::test]
    async fn acknowledgement_success_without_readback_match_is_never_confirmed() {
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            ok(json!({"saved":true})),
            ok(json!([])),
            ok(json!([])),
            ok(json!([])),
        ]);
        let result = change_with(&transport, &device(), &create(), &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightFavoriteStatus::Rejected);
        assert_eq!(transport.writes().len(), 1);
    }
    #[tokio::test]
    async fn write_timeout_can_confirm_later_using_queries_and_never_resends_create() {
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            Reply::Hang,
            network(),
            ok(json!([wanted(json!(1))])),
        ]);
        let result = change_with(&transport, &device(), &create(), &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightFavoriteStatus::Confirmed);
        assert_eq!(transport.writes().len(), 1);
    }
    #[tokio::test]
    async fn network_or_malformed_list_cannot_be_misread_as_an_empty_success() {
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            network(),
            ok(json!({"result":[]})),
            network(),
            network(),
        ]);
        let result = change_with(&transport, &device(), &create(), &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightFavoriteStatus::Uncertain);
        assert!(result.report.is_none());
        assert_eq!(transport.writes().len(), 1);
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            ok(Value::Null),
            ok(json!([])),
            ok(json!([])),
            network(),
        ]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Uncertain
        );
    }
    #[tokio::test]
    async fn explicit_rejection_preserves_query_results_and_never_claims_missing_report() {
        let transport = RecordingTransport::new(vec![
            ok(json!([])),
            Reply::Data(Err(AppError::new(
                "permissionDenied",
                "fixture denied",
                false,
            ))),
            network(),
            network(),
            network(),
        ]);
        let result = change_with(&transport, &device(), &create(), &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightFavoriteStatus::Rejected);
        assert!(result.report.is_none());
        assert!(result.message.contains("尚未取得最新列表"));
        assert_eq!(transport.writes().len(), 1);
    }
    #[tokio::test]
    async fn preflight_failure_conflicts_and_unknown_target_cannot_send_a_mutation() {
        let transport = RecordingTransport::new(vec![network()]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap_err()
                .kind,
            "unconfirmed"
        );
        assert!(transport.writes().is_empty());
        let transport = RecordingTransport::new(vec![ok(json!([wanted(json!(1))]))]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap_err()
                .kind,
            "lightFavoriteConflict"
        );
        assert!(transport.writes().is_empty());
        let report = parse(&device(), &json!([row(json!(1), "甲")])).unwrap();
        let change = edit(&report.items[0]);
        let transport = RecordingTransport::new(vec![ok(json!([]))]);
        assert_eq!(
            change_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap_err()
                .kind,
            "lightFavoriteConflict"
        );
        assert!(transport.writes().is_empty());
    }
    #[tokio::test]
    async fn edit_and_delete_confirm_the_exact_id_preserving_numeric_and_string_distinction() {
        let rows = json!([row(json!(1), "甲"), row(json!("1"), "乙")]);
        let report = parse(&device(), &rows).unwrap();
        let change = edit(&report.items[0]);
        let transport = RecordingTransport::new(vec![
            ok(rows.clone()),
            ok(Value::Null),
            ok(json!([wanted(json!(1)), row(json!("1"), "乙")])),
        ]);
        assert_eq!(
            change_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert_eq!(transport.writes()[0].params["coll_id"], json!(1));
        let change = delete(&report.items[1]);
        let transport = RecordingTransport::new(vec![
            ok(rows),
            ok(Value::Null),
            ok(json!([row(json!(1), "甲")])),
        ]);
        assert_eq!(
            change_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert_eq!(transport.writes()[0].params["coll_id"], json!("1"));
    }
    #[tokio::test]
    async fn confirm_ignores_baseline_and_issues_only_queries_for_create_edit_and_delete() {
        let list = json!([wanted(json!(1))]);
        let report = parse(&device(), &list).unwrap();
        let mut change = edit(&report.items[0]);
        if let LightFavoriteChange::Edit { baseline, .. } = &mut change {
            *baseline = "old ignored revision".into();
        }
        let transport = RecordingTransport::new(vec![ok(list.clone())]);
        assert_eq!(
            confirm_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert!(transport.writes().is_empty());
        let transport = RecordingTransport::new(vec![ok(list)]);
        assert_eq!(
            confirm_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert!(transport.writes().is_empty());
        let change = LightFavoriteChange::Delete {
            id: "1".into(),
            baseline: String::new(),
        };
        let transport = RecordingTransport::new(vec![ok(json!([]))]);
        assert_eq!(
            confirm_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert!(transport.writes().is_empty());
    }
    #[tokio::test]
    async fn identical_edit_is_read_only_but_identical_preexisting_create_is_not_a_success() {
        let list = json!([wanted(json!(1))]);
        let report = parse(&device(), &list).unwrap();
        let change = edit(&report.items[0]);
        let transport = RecordingTransport::new(vec![ok(list.clone())]);
        assert_eq!(
            change_with(&transport, &device(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Confirmed
        );
        assert!(transport.writes().is_empty());
        let transport = RecordingTransport::new(vec![ok(list)]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap_err()
                .kind,
            "lightFavoriteConflict"
        );
        assert!(transport.writes().is_empty());
    }
    #[tokio::test]
    async fn malformed_target_content_is_unknown_not_a_bounded_valid_mismatch() {
        let mut unknown = wanted(json!(1));
        unknown["content"]["brightness"] = Value::Null;
        let transport = RecordingTransport::new(vec![
            ok(json!([unknown.clone()])),
            ok(json!([unknown.clone()])),
            ok(json!([unknown])),
        ]);
        assert_eq!(
            confirm_with(&transport, &device(), &create(), &context, policy())
                .await
                .unwrap()
                .status,
            LightFavoriteStatus::Uncertain
        );
        assert!(transport.writes().is_empty());
    }
    #[tokio::test]
    async fn old_context_or_write_permission_changes_prevent_writes_and_late_results() {
        let checks = AtomicUsize::new(0);
        let check = |_: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 2 {
                Err(AppError::stale())
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(json!([]))]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &check, policy())
                .await
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert!(transport.writes().is_empty());
        let checks = AtomicUsize::new(0);
        let check = |writing: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 2 && writing {
                Err(AppError::new(
                    "permissionDenied",
                    "fixture permission changed",
                    false,
                ))
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(json!([]))]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &check, policy())
                .await
                .unwrap_err()
                .kind,
            "permissionDenied"
        );
        assert!(transport.writes().is_empty());
        let checks = AtomicUsize::new(0);
        let check = |_: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 3 {
                Err(AppError::stale())
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(json!([])), ok(Value::Null)]);
        assert_eq!(
            change_with(&transport, &device(), &create(), &check, policy())
                .await
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert_eq!(transport.writes().len(), 1);
    }
    #[test]
    fn serialized_contract_is_camel_case_and_reports_no_private_record_fields() {
        let mut raw = row(json!(1), "甲");
        raw["private_token"] = json!("fixture-secret");
        let report = serde_json::to_value(parse(&device(), &json!([raw])).unwrap()).unwrap();
        assert!(report.get("fetchedAt").is_some());
        assert!(report["items"][0].get("temperaturePercent").is_some());
        assert!(!report.to_string().contains("fixture-secret"));
        let result = serde_json::to_value(LightFavoriteResult {
            status: LightFavoriteStatus::Uncertain,
            message: "query".into(),
            report: None,
        })
        .unwrap();
        assert_eq!(result["status"], "uncertain");
        assert_eq!(result["report"], Value::Null);
    }
}
