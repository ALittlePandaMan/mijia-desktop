//! Model-specific wyra01 settings, reconstructed from plugin 10268/10310.
//! Private service 4 is deliberately not added to generic MIoT metadata.
//! Writes are issued once; only direct reads are retried. No 4.14 trigger,
//! automatic rollback, preset activation, or writes during settings queries.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device, DevicePanel, Property},
    spec,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{future::Future, time::Duration};

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LightSettingsTab {
    Color,
    Temperature,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightSettingsSlot {
    pub index: u8,
    pub brightness: Option<u8>,
    pub color: Option<u32>,
    pub temperature_percent: Option<u8>,
    pub tab: LightSettingsTab,
    pub revision: Option<String>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightSettingsSpeed {
    pub value: Option<u8>,
    pub reason: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightSettingsReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub slots: Vec<LightSettingsSlot>,
    pub flow_slots: Vec<LightSettingsSlot>,
    pub speed: LightSettingsSpeed,
    pub write_reason: Option<String>,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "operation",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum LightSettingsChange {
    SaveMode {
        index: u8,
        baseline: String,
        brightness: u8,
        color: u32,
        temperature_percent: u8,
        tab: LightSettingsTab,
    },
    SaveFlow {
        index: u8,
        baseline: String,
        brightness: u8,
        color: u32,
    },
    SetSpeed {
        baseline: u8,
        value: u8,
    },
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum LightSettingsStatus {
    Confirmed,
    Rejected,
    Uncertain,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightSettingsResult {
    pub status: LightSettingsStatus,
    pub message: String,
    pub report: Option<LightSettingsReport>,
}

pub(crate) fn validate(change: &LightSettingsChange) -> Result<()> {
    validate_change(change, true)
}

pub(crate) fn validate_confirmation(change: &LightSettingsChange) -> Result<()> {
    validate_change(change, false)
}

fn validate_change(change: &LightSettingsChange, check_baseline: bool) -> Result<()> {
    let valid_slot = |index: u8, baseline: &str, brightness: u8, color: u32| {
        index < 4
            && (!check_baseline
                || (baseline.len() == 64 && baseline.bytes().all(|byte| byte.is_ascii_hexdigit())))
            && brightness <= 100
            && color <= 0xffffff
    };
    let valid = match change {
        LightSettingsChange::SaveMode {
            index,
            baseline,
            brightness,
            color,
            temperature_percent,
            ..
        } => valid_slot(*index, baseline, *brightness, *color) && *temperature_percent <= 100,
        LightSettingsChange::SaveFlow {
            index,
            baseline,
            brightness,
            color,
        } => valid_slot(*index, baseline, *brightness, *color) && *brightness >= 1,
        LightSettingsChange::SetSpeed { baseline, value } => {
            (!check_baseline || *baseline <= 100) && (2..=100).contains(value)
        }
    };
    if !valid {
        return Err(AppError::invalid("灯光模式参数无效，请重新读取后再编辑。"));
    }
    Ok(())
}

fn validate_binding(device: &Device, panel: &DevicePanel) -> Result<()> {
    crate::light_modes::validate_device(device)?;
    if panel.did != device.did
        || panel.model != device.model
        || panel.route_did.is_some()
        || panel.unsupported_reason.is_some()
    {
        return Err(AppError::new(
            "unsupported",
            "当前设备描述与灯光模式适配不一致。",
            false,
        ));
    }
    Ok(())
}

fn property(panel: &DevicePanel, piid: u32) -> Option<&Property> {
    let mut matching = panel
        .services
        .iter()
        .filter(|service| service.siid == 2 && service.name == "light")
        .flat_map(|service| &service.properties)
        .filter(|property| property.siid == 2 && property.piid == piid);
    let result = matching.next()?;
    matching.next().is_none().then_some(result)
}

pub(crate) fn write_reason(device: &Device, panel: &DevicePanel) -> Option<String> {
    if let Err(error) = validate_binding(device, panel) {
        return Some(error.message);
    }
    if !device.online {
        return Some("设备离线，暂不能保存灯光模式。".into());
    }
    let Some(mode) = property(panel, 5) else {
        return Some("设备未提供可核对的灯光模式描述。".into());
    };
    if mode.name != "mode"
        || mode.format != "uint8"
        || mode.unit.is_some()
        || mode.unsupported_reason.is_some()
        || !["read", "write"]
            .iter()
            .all(|access| mode.access.iter().any(|a| a == access))
        || !mode.value_list.as_ref().is_some_and(|values| {
            (11..=15).all(|value| values.iter().any(|item| item.value.as_u64() == Some(value)))
        })
    {
        return Some("当前灯光模式描述不允许编辑此型号的模式设置。".into());
    }
    None
}

fn speed_descriptor(panel: &DevicePanel, write: bool) -> std::result::Result<&Property, String> {
    let prop = property(panel, 8).ok_or("设备未提供可核对的流光速度描述。")?;
    if prop.name != "flow-speed-level"
        || prop.format != "uint8"
        || prop.unit.is_some()
        || prop.value_list.is_some()
        || prop.unsupported_reason.is_some()
        || !prop.access.iter().any(|access| access == "read")
        || !prop.value_range.as_ref().is_some_and(|range| {
            range.len() == 3
                && range.iter().all(|n| n.is_finite() && n.fract() == 0.0)
                && range[0] >= 0.0
                && range[0] <= range[1]
                && range[1] <= 100.0
                && range[2] >= 1.0
        })
    {
        return Err("流光速度描述与已核对的协议不一致，暂不可编辑。".into());
    }
    if write && !prop.access.iter().any(|access| access == "write") {
        return Err("设备描述只允许读取流光速度。".into());
    }
    Ok(prop)
}

fn addresses(device: &Device, panel: &DevicePanel) -> Vec<Value> {
    let mut params: Vec<_> = (5..=13)
        .map(|piid| json!({"did":device.did,"siid":4,"piid":piid}))
        .collect();
    if speed_descriptor(panel, false).is_ok() {
        params.push(json!({"did":device.did,"siid":2,"piid":8}));
    }
    params
}

fn word(rows: &[Value], did: &str, siid: u32, piid: u32) -> std::result::Result<u32, String> {
    let mut matching = rows.iter().filter(|row| {
        row["siid"].as_u64() == Some(u64::from(siid))
            && row["piid"].as_u64() == Some(u64::from(piid))
    });
    let row = matching
        .next()
        .ok_or_else(|| format!("未返回灯光属性 {siid}.{piid}。"))?;
    if matching.next().is_some() || row["did"].as_str() != Some(did) {
        return Err(format!("灯光属性 {siid}.{piid} 的响应标识不一致或重复。"));
    }
    match row["code"].as_i64() {
        Some(0) => {}
        Some(code) => return Err(format!("灯光属性 {siid}.{piid} 读取失败（代码 {code}）。")),
        None => return Err(format!("灯光属性 {siid}.{piid} 缺少有效的读取状态。")),
    }
    row["value"]
        .as_u64()
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("灯光属性 {siid}.{piid} 不是有效 uint32 数据。"))
}

fn revision(raw: u32, ct: Option<u8>) -> String {
    let mut hash = Sha256::new();
    hash.update(raw.to_le_bytes());
    if let Some(ct) = ct {
        hash.update([ct]);
    }
    format!("{:x}", hash.finalize())
}

fn slot(rows: &[Value], did: &str, index: u8, flow: bool) -> LightSettingsSlot {
    let mut result = LightSettingsSlot {
        index,
        brightness: None,
        color: None,
        temperature_percent: None,
        // Unavailable slots have no usable revision or fields. This required
        // discriminator is only a display placeholder until a valid byte exists.
        tab: LightSettingsTab::Color,
        revision: None,
        reason: None,
    };
    let decoded = (|| {
        let raw = word(rows, did, 4, u32::from(index) + if flow { 10 } else { 5 })?;
        let brightness = (raw & 255) as u8;
        if brightness > 100 || (flow && brightness == 0) {
            return Err("灯光模式亮度超出有效范围。".into());
        }
        let ct = if flow {
            None
        } else {
            let ct = ((word(rows, did, 4, 9)? >> (u32::from(index) * 8)) & 255) as u8;
            if ct & 127 > 100 {
                return Err("灯光模式色温百分比超出有效范围。".into());
            }
            Some(ct)
        };
        Ok((raw, brightness, ct))
    })();
    match decoded {
        Ok((raw, brightness, ct)) => {
            result.brightness = Some(brightness);
            result.color = Some(raw >> 8);
            result.temperature_percent = ct.map(|byte| byte & 127);
            if ct.is_some_and(|byte| byte & 128 != 0) {
                result.tab = LightSettingsTab::Temperature;
            }
            result.revision = Some(revision(raw, ct));
        }
        Err(reason) => result.reason = Some(reason),
    }
    result
}

fn speed_value(
    rows: &[Value],
    device: &Device,
    panel: &DevicePanel,
) -> std::result::Result<u8, String> {
    let prop = speed_descriptor(panel, false)?;
    let value = word(rows, &device.did, 2, 8)?;
    spec::validate_value(prop, &json!(value)).map_err(|error| error.message)?;
    u8::try_from(value).map_err(|_| "流光速度超出 uint8 范围。".into())
}

fn report(device: &Device, panel: &DevicePanel, rows: &[Value]) -> LightSettingsReport {
    let speed = match speed_value(rows, device, panel) {
        Ok(value) => LightSettingsSpeed {
            value: Some(value),
            reason: speed_descriptor(panel, true).err(),
        },
        Err(reason) => LightSettingsSpeed {
            value: None,
            reason: Some(reason),
        },
    };
    LightSettingsReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        slots: (0..4)
            .map(|index| slot(rows, &device.did, index, false))
            .collect(),
        flow_slots: (0..4)
            .map(|index| slot(rows, &device.did, index, true))
            .collect(),
        speed,
        write_reason: write_reason(device, panel),
    }
}

struct Target {
    siid: u32,
    piid: u32,
    value: u32,
    // The shared 4.9 property is confirmed only at the edited byte. Other
    // clients may independently edit the remaining three slots.
    byte: Option<u8>,
}
impl Target {
    fn parameter(&self, device: &Device) -> Value {
        json!({"did":device.did,"siid":self.siid,"piid":self.piid,"value":self.value})
    }
    fn matches(&self, rows: &[Value], device: &Device) -> std::result::Result<bool, String> {
        let actual = word(rows, &device.did, self.siid, self.piid)?;
        if let Some(index) = self.byte {
            let shift = u32::from(index) * 8;
            Ok((actual >> shift) & 255 == (self.value >> shift) & 255)
        } else {
            Ok(actual == self.value)
        }
    }
}

fn targets(change: &LightSettingsChange, shared: u32) -> Vec<Target> {
    match change {
        LightSettingsChange::SaveMode {
            index,
            brightness,
            color,
            temperature_percent,
            tab,
            ..
        } => {
            let byte = u32::from(*temperature_percent)
                | if *tab == LightSettingsTab::Temperature {
                    128
                } else {
                    0
                };
            let shift = u32::from(*index) * 8;
            let current = (shared & !(255 << shift)) | (byte << shift);
            vec![
                Target {
                    siid: 4,
                    piid: 9,
                    value: current,
                    byte: Some(*index),
                },
                Target {
                    siid: 4,
                    piid: 5 + u32::from(*index),
                    value: (color << 8) | u32::from(*brightness),
                    byte: None,
                },
            ]
        }
        LightSettingsChange::SaveFlow {
            index,
            brightness,
            color,
            ..
        } => vec![Target {
            siid: 4,
            piid: 10 + u32::from(*index),
            value: (color << 8) | u32::from(*brightness),
            byte: None,
        }],
        LightSettingsChange::SetSpeed { value, .. } => vec![Target {
            siid: 2,
            piid: 8,
            value: u32::from(*value),
            byte: None,
        }],
    }
}

fn conflict() -> AppError {
    AppError::new(
        "lightSettingsConflict",
        "此灯光模式已变化，请重新读取后再保存。",
        true,
    )
}

fn prepare(
    device: &Device,
    panel: &DevicePanel,
    rows: &[Value],
    change: &LightSettingsChange,
) -> Result<Vec<Target>> {
    validate(change)?;
    if let Some(reason) = write_reason(device, panel) {
        return Err(AppError::new("permissionDenied", reason, false));
    }
    let unavailable = |reason| AppError::new("unconfirmed", reason, true);
    match change {
        LightSettingsChange::SaveMode {
            index, baseline, ..
        }
        | LightSettingsChange::SaveFlow {
            index, baseline, ..
        } => {
            let current = slot(
                rows,
                &device.did,
                *index,
                matches!(change, LightSettingsChange::SaveFlow { .. }),
            );
            if let Some(reason) = current.reason {
                return Err(unavailable(reason));
            }
            if current.revision.as_deref() != Some(baseline) {
                return Err(conflict());
            }
        }
        LightSettingsChange::SetSpeed { baseline, value } => {
            let prop = speed_descriptor(panel, true)
                .map_err(|reason| AppError::new("permissionDenied", reason, false))?;
            spec::validate_value(prop, &json!(value))?;
            if speed_value(rows, device, panel).map_err(unavailable)? != *baseline {
                return Err(conflict());
            }
        }
    }
    let shared = if matches!(change, LightSettingsChange::SaveMode { .. }) {
        word(rows, &device.did, 4, 9).map_err(unavailable)?
    } else {
        0
    };
    Ok(targets(change, shared))
}

trait Transport: Sync {
    fn read(&self, params: Vec<Value>) -> impl Future<Output = Result<Vec<Value>>> + Send;
    fn write(&self, params: Vec<Value>) -> impl Future<Output = Result<Vec<Value>>> + Send;
}
struct CloudTransport<'a>(&'a Cloud);
impl Transport for CloudTransport<'_> {
    async fn read(&self, params: Vec<Value>) -> Result<Vec<Value>> {
        self.0.read(params).await
    }
    async fn write(&self, params: Vec<Value>) -> Result<Vec<Value>> {
        self.0
            .request("/miotspec/prop/set", json!({"params":params}))
            .await?
            .as_array()
            .cloned()
            .ok_or_else(AppError::protocol)
    }
}

#[derive(Clone, Copy)]
struct Policy {
    read_timeout: Duration,
    write_timeout: Duration,
    delays: [Duration; 2],
}
impl Default for Policy {
    fn default() -> Self {
        Self {
            read_timeout: Duration::from_secs(8),
            write_timeout: Duration::from_secs(8),
            delays: [Duration::from_millis(750), Duration::from_millis(1500)],
        }
    }
}
fn timeout_error() -> AppError {
    AppError::new("network", "灯光模式请求超时，正在等待状态确认。", true)
}
async fn read<T: Transport>(
    transport: &T,
    device: &Device,
    panel: &DevicePanel,
    policy: Policy,
) -> Result<Vec<Value>> {
    tokio::time::timeout(
        policy.read_timeout,
        transport.read(addresses(device, panel)),
    )
    .await
    .unwrap_or_else(|_| Err(timeout_error()))
}

#[derive(Default)]
struct Receipt {
    accepted: usize,
    rejected: Vec<String>,
    uncertain: usize,
}
fn receipt(rows: Result<Vec<Value>>, targets: &[Target], device: &Device) -> Result<Receipt> {
    let rows = match rows {
        Ok(rows) => rows,
        Err(error) if error.kind == "authExpired" || error.kind == "staleContext" => {
            return Err(error)
        }
        Err(error)
            if matches!(
                error.kind.as_str(),
                "permissionDenied" | "invalidValue" | "unsupported"
            ) =>
        {
            return Ok(Receipt {
                rejected: vec![error.message],
                ..Receipt::default()
            });
        }
        Err(_) => {
            return Ok(Receipt {
                uncertain: targets.len(),
                ..Receipt::default()
            })
        }
    };
    let mut receipt = Receipt::default();
    for target in targets {
        let matching: Vec<_> = rows
            .iter()
            .filter(|row| {
                row["siid"].as_u64() == Some(u64::from(target.siid))
                    && row["piid"].as_u64() == Some(u64::from(target.piid))
            })
            .collect();
        if matching.len() != 1 || matching[0]["did"].as_str() != Some(&device.did) {
            receipt.uncertain += 1;
            continue;
        }
        match matching[0]["code"].as_i64() {
            Some(0 | 1) => receipt.accepted += 1,
            Some(code)
                if matches!(
                    AppError::device(code).kind.as_str(),
                    "permissionDenied" | "invalidValue" | "unsupported"
                ) =>
            {
                receipt.rejected.push(format!(
                    "{}.{}：{}",
                    target.siid,
                    target.piid,
                    AppError::device(code).message
                ));
            }
            _ => receipt.uncertain += 1,
        }
    }
    Ok(receipt)
}

async fn verify<T, F, Fut>(
    transport: &T,
    device: &Device,
    panel: &DevicePanel,
    targets: &[Target],
    receipt: Receipt,
    check: &F,
    policy: Policy,
) -> Result<LightSettingsResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    let mut latest = None;
    let mut mismatches = 0;
    let mut final_mismatch = false;
    for attempt in 0..=policy.delays.len() {
        if attempt > 0 && !policy.delays[attempt - 1].is_zero() {
            tokio::time::sleep(policy.delays[attempt - 1]).await;
        }
        check(false).await?;
        let response = read(transport, device, panel, policy).await;
        check(false).await?;
        final_mismatch = false;
        match response {
            Ok(rows) => {
                latest = Some(report(device, panel, &rows));
                let matches: std::result::Result<Vec<_>, _> = targets
                    .iter()
                    .map(|target| target.matches(&rows, device))
                    .collect();
                match matches {
                    Ok(values) if values.iter().all(|value| *value) => {
                        return Ok(LightSettingsResult {
                            status: LightSettingsStatus::Confirmed,
                            message: "灯光模式已通过设备状态回读确认。".into(),
                            report: latest,
                        })
                    }
                    Ok(_) => {
                        mismatches += 1;
                        final_mismatch = true;
                    }
                    Err(_) => {}
                }
            }
            Err(error) if error.kind == "authExpired" || error.kind == "staleContext" => {
                return Err(error)
            }
            Err(_) => {}
        }
    }
    let rejected = !receipt.rejected.is_empty() || (final_mismatch && mismatches >= 2);
    let message = if !receipt.rejected.is_empty() {
        format!(
            "设备拒绝了模式修改：{}。已接受{}项，另有{}项尚未确认。{}{}",
            receipt.rejected.join("；"),
            receipt.accepted,
            receipt.uncertain,
            if targets.len() > 1 {
                "多项属性分别处理；未自动回滚或重写。"
            } else {
                "未重新写入。"
            },
            if latest.is_some() {
                "已保留实际回读结果。"
            } else {
                "尚未取得设备状态，请稍后重新查询。"
            }
        )
    } else if rejected {
        "多次回读仍未达到目标值，已展示设备实际状态；未重新写入。".into()
    } else {
        "请求结果尚未确认，请稍后重新查询；不会自动重复下发或回滚。".into()
    };
    Ok(LightSettingsResult {
        status: if rejected {
            LightSettingsStatus::Rejected
        } else {
            LightSettingsStatus::Uncertain
        },
        message,
        report: latest,
    })
}

async fn change_with<T, F, Fut>(
    transport: &T,
    device: &Device,
    panel: &DevicePanel,
    change: &LightSettingsChange,
    check: &F,
    policy: Policy,
) -> Result<LightSettingsResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    validate_binding(device, panel)?;
    validate(change)?;
    if let Some(reason) = write_reason(device, panel) {
        return Err(AppError::new("permissionDenied", reason, false));
    }
    check(true).await?;
    let current = read(transport, device, panel, policy).await;
    check(false).await?;
    let current = current?;
    let targets = prepare(device, panel, &current, change)?;
    let already_matches = targets
        .iter()
        .all(|target| target.matches(&current, device) == Ok(true));
    if already_matches {
        return Ok(LightSettingsResult {
            status: LightSettingsStatus::Confirmed,
            message: "设备当前模式设置已与目标一致。".into(),
            report: Some(report(device, panel, &current)),
        });
    }
    // The CAS is against a fresh direct read. Recheck context immediately before
    // the only request that writes. Never hold AppState.inner across this call.
    check(true).await?;
    let written = tokio::time::timeout(
        policy.write_timeout,
        transport.write(
            targets
                .iter()
                .map(|target| target.parameter(device))
                .collect(),
        ),
    )
    .await
    .unwrap_or_else(|_| Err(timeout_error()));
    check(false).await?;
    let receipt = receipt(written, &targets, device)?;
    verify(transport, device, panel, &targets, receipt, check, policy).await
}

pub(crate) async fn load(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
) -> Result<LightSettingsReport> {
    validate_binding(device, panel)?;
    let rows = read(&CloudTransport(cloud), device, panel, Policy::default()).await?;
    Ok(report(device, panel, &rows))
}

pub(crate) async fn change<F, Fut>(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
    change: &LightSettingsChange,
    check: F,
) -> Result<LightSettingsResult>
where
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    change_with(
        &CloudTransport(cloud),
        device,
        panel,
        change,
        &check,
        Policy::default(),
    )
    .await
}

pub(crate) async fn confirm<F, Fut>(
    cloud: &Cloud,
    device: &Device,
    panel: &DevicePanel,
    change: &LightSettingsChange,
    check: F,
) -> Result<LightSettingsResult>
where
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    confirm_with(
        &CloudTransport(cloud),
        device,
        panel,
        change,
        &check,
        Policy::default(),
    )
    .await
}

async fn confirm_with<T, F, Fut>(
    transport: &T,
    device: &Device,
    panel: &DevicePanel,
    change: &LightSettingsChange,
    check: &F,
    policy: Policy,
) -> Result<LightSettingsResult>
where
    T: Transport,
    F: Fn(bool) -> Fut,
    Fut: Future<Output = Result<()>>,
{
    validate_binding(device, panel)?;
    validate_confirmation(change)?;
    // A confirmation never compares the original baseline and never writes.
    // A dummy shared value is safe: Target::matches compares only the target
    // byte, not the other bytes of 4.9.
    let targets = targets(change, 0);
    verify(
        transport,
        device,
        panel,
        &targets,
        Receipt::default(),
        check,
        policy,
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
        serde_json::from_value(json!({"did":"light-fixture","model":"yeelink.light.wyra01","online":true,"name":"light","roomId":"room","roomName":"room"})).unwrap()
    }
    fn panel() -> DevicePanel {
        serde_json::from_value(json!({"did":"light-fixture","model":"yeelink.light.wyra01","services":[{
            "siid":2,"name":"light","description":"Light","actions":[],"properties":[
                {"siid":2,"piid":5,"name":"mode","description":"Mode","format":"uint8","access":["read","write","notify"],"valueList":(0..=18).map(|value|json!({"value":value,"description":"mode"})).collect::<Vec<_>>()},
                {"siid":2,"piid":8,"name":"flow-speed-level","description":"Speed","format":"uint8","access":["read","write","notify"],"valueRange":[0,100,1]}
            ]
        }]})).unwrap()
    }
    fn rows() -> Vec<Value> {
        [0xff000064_u32,0xff7f0064,0xffff0064,0x00ff0064,0x64432100,0xff000064,0xff7f0064,0xffff0064,0x00ff0064]
            .into_iter().enumerate().map(|(index,value)|json!({"did":"light-fixture","siid":4,"piid":5+index,"code":0,"value":value}))
            .chain([json!({"did":"light-fixture","siid":2,"piid":8,"code":0,"value":50})]).collect()
    }
    fn mode_change(index: u8, current: &[Value]) -> LightSettingsChange {
        LightSettingsChange::SaveMode {
            index,
            baseline: slot(current, "light-fixture", index, false)
                .revision
                .unwrap(),
            brightness: 25,
            color: 0x123456,
            temperature_percent: 75,
            tab: LightSettingsTab::Temperature,
        }
    }
    fn flow_change(index: u8, current: &[Value]) -> LightSettingsChange {
        LightSettingsChange::SaveFlow {
            index,
            baseline: slot(current, "light-fixture", index, true)
                .revision
                .unwrap(),
            brightness: 75,
            color: 0x800000,
        }
    }
    fn applied(current: &[Value], change: &LightSettingsChange) -> Vec<Value> {
        let shared = word(current, "light-fixture", 4, 9).unwrap();
        let device = device();
        let targets = targets(change, shared);
        let mut rows = current.to_vec();
        for target in targets {
            rows.iter_mut()
                .find(|row| row["siid"] == target.siid && row["piid"] == target.piid)
                .unwrap()["value"] = json!(target.value);
        }
        assert_eq!(device.did, "light-fixture");
        rows
    }
    fn policy() -> Policy {
        Policy {
            read_timeout: Duration::from_millis(20),
            write_timeout: Duration::from_millis(20),
            delays: [Duration::ZERO; 2],
        }
    }
    async fn context(_: bool) -> Result<()> {
        Ok(())
    }

    enum Reply {
        Data(Result<Vec<Value>>),
        Hang,
    }
    #[derive(Debug)]
    enum Call {
        Read(Vec<Value>),
        Write(Vec<Value>),
    }
    struct RecordingTransport {
        reads: Mutex<VecDeque<Reply>>,
        writes: Mutex<VecDeque<Reply>>,
        calls: Mutex<Vec<Call>>,
    }
    impl RecordingTransport {
        fn new(reads: Vec<Reply>, writes: Vec<Reply>) -> Self {
            Self {
                reads: Mutex::new(reads.into()),
                writes: Mutex::new(writes.into()),
                calls: Mutex::new(vec![]),
            }
        }
        fn write_calls(&self) -> Vec<Vec<Value>> {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter_map(|call| {
                    if let Call::Write(params) = call {
                        Some(params.clone())
                    } else {
                        None
                    }
                })
                .collect()
        }
        fn read_count(&self) -> usize {
            self.calls
                .lock()
                .unwrap()
                .iter()
                .filter(|call| matches!(call, Call::Read(_)))
                .count()
        }
    }
    fn ok(rows: Vec<Value>) -> Reply {
        Reply::Data(Ok(rows))
    }
    fn network() -> Reply {
        Reply::Data(Err(AppError::new(
            "network",
            "isolated network failure",
            true,
        )))
    }
    fn ack(params: &[Target]) -> Vec<Value> {
        params.iter().map(|target|json!({"did":"light-fixture","siid":target.siid,"piid":target.piid,"code":0})).collect()
    }
    async fn reply(reply: Reply) -> Result<Vec<Value>> {
        match reply {
            Reply::Data(result) => result,
            Reply::Hang => std::future::pending().await,
        }
    }
    impl Transport for RecordingTransport {
        async fn read(&self, params: Vec<Value>) -> Result<Vec<Value>> {
            self.calls.lock().unwrap().push(Call::Read(params));
            let next = self
                .reads
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected additional read");
            reply(next).await
        }
        async fn write(&self, params: Vec<Value>) -> Result<Vec<Value>> {
            self.calls.lock().unwrap().push(Call::Write(params));
            let next = self
                .writes
                .lock()
                .unwrap()
                .pop_front()
                .expect("unexpected duplicate write");
            reply(next).await
        }
    }

    #[test]
    fn report_preserves_inactive_rgb_ct_and_unsigned_words_without_default_slots() {
        let mut rows = rows();
        rows[4]["value"] = json!(0xe4b22100_u32);
        let report = report(&device(), &panel(), &rows);
        assert!(report.write_reason.is_none());
        assert_eq!(report.slots.len(), 4);
        assert_eq!(report.flow_slots.len(), 4);
        assert_eq!(report.slots[2].tab, LightSettingsTab::Temperature);
        assert_eq!(report.slots[2].temperature_percent, Some(50));
        assert_eq!(report.slots[2].color, Some(0xffff00));
        assert_eq!(report.slots[3].temperature_percent, Some(100));
        assert_eq!(report.slots[0].brightness, Some(100));
        assert!(report
            .slots
            .iter()
            .all(|s| s.revision.as_ref().is_some_and(|r| r.len() == 64)));
        assert!(report
            .flow_slots
            .iter()
            .all(|s| s.tab == LightSettingsTab::Color && s.temperature_percent.is_none()));
        let serialized = serde_json::to_value(report).unwrap();
        assert!(serialized.get("fetchedAt").is_some());
        assert!(serialized.get("flowSlots").is_some());
        assert!(serialized["slots"][0].get("temperaturePercent").is_some());
        assert_eq!(serialized["slots"][0]["tab"], "color");
    }
    #[test]
    fn only_target_word_and_ct_byte_determine_revision_and_cas() {
        let before = rows();
        let change = mode_change(1, &before);
        let baseline = slot(&before, "light-fixture", 1, false).revision;
        let mut elsewhere = before.clone();
        elsewhere[4]["value"] = json!(0xe4b22180_u32);
        elsewhere[0]["value"] = json!(0xabcdef32_u32);
        assert_eq!(
            slot(&elsewhere, "light-fixture", 1, false).revision,
            baseline
        );
        let targets = prepare(&device(), &panel(), &elsewhere, &change).unwrap();
        assert_eq!(targets[0].piid, 9);
        assert_eq!(targets[0].value, 0xe4b2cb80);
        assert_eq!(targets[1].value, 0x12345619);
        let mut changed = elsewhere.clone();
        changed[1]["value"] = json!(0xff7f0063_u32);
        assert_eq!(
            prepare(&device(), &panel(), &changed, &change)
                .err()
                .unwrap()
                .kind,
            "lightSettingsConflict"
        );
        changed = elsewhere;
        changed[4]["value"] = json!(0xe4b22280_u32);
        assert_eq!(
            prepare(&device(), &panel(), &changed, &change)
                .err()
                .unwrap()
                .kind,
            "lightSettingsConflict"
        );
    }
    #[test]
    fn every_slot_replacement_preserves_other_bytes_including_high_bit() {
        let before = rows();
        for index in 0..4 {
            let change = mode_change(index, &before);
            let target = prepare(&device(), &panel(), &before, &change).unwrap();
            let shared = word(&before, "light-fixture", 4, 9).unwrap();
            let mask = 255_u32 << (u32::from(index) * 8);
            assert_eq!(target[0].value & !mask, shared & !mask);
            assert_eq!((target[0].value >> (u32::from(index) * 8)) & 255, 203);
            assert_eq!(target[1].piid, 5 + u32::from(index));
        }
    }
    #[test]
    fn bad_response_or_invalid_packed_fields_keep_exact_slot_unavailable() {
        for (field, value) in [
            ("did", json!("foreign-private-id")),
            ("code", json!(-704010000)),
            ("code", Value::Null),
            ("value", json!(-1)),
            ("value", json!(4294967296_u64)),
            ("value", json!(1.0)),
            ("value", json!("1")),
            ("value", json!(0xff000065_u32)),
        ] {
            let mut rows = rows();
            rows[0][field] = value;
            let report = report(&device(), &panel(), &rows);
            assert!(report.slots[0].reason.is_some());
            assert!(report.slots[0].revision.is_none());
            assert!(report.slots[0].color.is_none());
            assert!(report.slots[1].reason.is_none());
            assert!(!report.slots[0]
                .reason
                .as_ref()
                .unwrap()
                .contains("foreign-private-id"));
        }
        let mut missing = rows();
        missing.remove(0);
        assert!(report(&device(), &panel(), &missing).slots[0]
            .reason
            .is_some());
        let mut duplicate = rows();
        duplicate.push(duplicate[4].clone());
        assert!(report(&device(), &panel(), &duplicate)
            .slots
            .iter()
            .all(|slot| slot.reason.is_some()));
        let mut rows = rows();
        rows[4]["value"] = json!(0x644321ff_u32);
        let report = report(&device(), &panel(), &rows);
        assert!(report.slots[0].reason.is_some());
        assert!(report.slots[1..].iter().all(|slot| slot.reason.is_none()));
    }
    #[test]
    fn speed_requires_real_descriptor_successful_read_and_read_write_for_changes() {
        let mut panel = panel();
        let before = rows();
        assert_eq!(report(&device(), &panel, &before).speed.value, Some(50));
        panel.services[0].properties[1].access = vec!["read".into()];
        let current = report(&device(), &panel, &before);
        assert_eq!(current.speed.value, Some(50));
        assert!(current.speed.reason.is_some());
        assert_eq!(
            prepare(
                &device(),
                &panel,
                &before,
                &LightSettingsChange::SetSpeed {
                    baseline: 50,
                    value: 40
                }
            )
            .err()
            .unwrap()
            .kind,
            "permissionDenied"
        );
        panel.services[0].properties[1].unit = Some("millisecond".into());
        assert!(report(&device(), &panel, &before).speed.value.is_none());
        assert!(!addresses(&device(), &panel).iter().any(|p| p["siid"] == 2));
        panel.services[0].properties[1].unit = None;
        panel.services[0].properties[1].value_range = Some(vec![0., 100., 2.]);
        assert_eq!(
            prepare(
                &device(),
                &panel,
                &before,
                &LightSettingsChange::SetSpeed {
                    baseline: 50,
                    value: 41
                }
            )
            .err()
            .unwrap()
            .kind,
            "permissionDenied"
        );
        panel.services[0].properties[1].access.push("write".into());
        assert_eq!(
            prepare(
                &device(),
                &panel,
                &before,
                &LightSettingsChange::SetSpeed {
                    baseline: 50,
                    value: 41
                }
            )
            .err()
            .unwrap()
            .kind,
            "invalidInput"
        );
        let mut denied = before;
        denied[9]["code"] = json!(-704002000);
        assert!(report(&device(), &panel, &denied).speed.value.is_none());
    }
    #[test]
    fn unknown_model_offline_and_readonly_modes_cannot_be_written() {
        let before = rows();
        let change = mode_change(0, &before);
        let mut device = device();
        let mut panel = panel();
        device.model = "other.light.v1".into();
        assert!(validate_binding(&device, &panel).is_err());
        device.model = "yeelink.light.wyra01".into();
        device.online = false;
        assert!(report(&device, &panel, &before).write_reason.is_some());
        assert_eq!(
            prepare(&device, &panel, &before, &change)
                .err()
                .unwrap()
                .kind,
            "permissionDenied"
        );
        device.online = true;
        panel.services[0].properties[0].access = vec!["read".into()];
        assert_eq!(
            prepare(&device, &panel, &before, &change)
                .err()
                .unwrap()
                .kind,
            "permissionDenied"
        );
    }
    #[test]
    fn typed_changes_reject_invalid_values_unknown_fields_and_bad_baselines() {
        let base = json!({"operation":"saveMode","index":0,"baseline":"a".repeat(64),"brightness":0,"color":16777215,"temperaturePercent":0,"tab":"color"});
        assert!(
            validate(&serde_json::from_value::<LightSettingsChange>(base.clone()).unwrap()).is_ok()
        );
        for (field, value) in [
            ("index", json!(4)),
            ("brightness", json!(101)),
            ("color", json!(16777216)),
            ("temperaturePercent", json!(101)),
            ("baseline", json!("stale")),
        ] {
            let mut invalid = base.clone();
            invalid[field] = value;
            assert!(
                validate(&serde_json::from_value::<LightSettingsChange>(invalid).unwrap()).is_err()
            );
        }
        for (field, value) in [
            ("brightness", json!(-1)),
            ("brightness", json!(2.5)),
            ("tab", json!("unknown")),
            ("extra", json!(true)),
        ] {
            let mut invalid = base.clone();
            invalid[field] = value;
            assert!(serde_json::from_value::<LightSettingsChange>(invalid).is_err());
        }
        assert!(validate(&LightSettingsChange::SaveFlow {
            index: 0,
            baseline: "a".repeat(64),
            brightness: 0,
            color: 0
        })
        .is_err());
        assert!(validate(&LightSettingsChange::SetSpeed {
            baseline: 50,
            value: 1
        })
        .is_err());
    }

    #[tokio::test]
    async fn one_mode_request_has_original_order_and_confirmation_ignores_other_shared_bytes() {
        let before = rows();
        let change = mode_change(3, &before);
        let targets = prepare(&device(), &panel(), &before, &change).unwrap();
        let mut after = applied(&before, &change);
        after[4]["value"] = json!((word(&after, "light-fixture", 4, 9).unwrap() & !255) | 10);
        let transport =
            RecordingTransport::new(vec![ok(before), ok(after)], vec![ok(ack(&targets))]);
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Confirmed);
        let writes = transport.write_calls();
        assert_eq!(writes.len(), 1);
        assert_eq!(writes[0].len(), 2);
        assert_eq!(
            writes[0][0],
            json!({"did":"light-fixture","siid":4,"piid":9,"value":0xcb432100_u32})
        );
        assert_eq!(
            writes[0][1],
            json!({"did":"light-fixture","siid":4,"piid":8,"value":0x12345619_u32})
        );
        assert_eq!(transport.read_count(), 2);
        assert!(transport
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|call| match call {
                Call::Read(params) | Call::Write(params) => !params.iter().any(|p| p["piid"] == 14),
            }));
    }
    #[tokio::test]
    async fn success_receipt_alone_cannot_confirm_and_mismatches_are_bounded() {
        let before = rows();
        let change = flow_change(0, &before);
        let targets = prepare(&device(), &panel(), &before, &change).unwrap();
        let transport = RecordingTransport::new(
            vec![
                ok(before.clone()),
                ok(before.clone()),
                ok(before.clone()),
                ok(before),
            ],
            vec![ok(ack(&targets))],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Rejected);
        assert_eq!(transport.read_count(), 4);
        assert_eq!(transport.write_calls().len(), 1);
        assert_eq!(result.report.unwrap().flow_slots[0].color, Some(0xff0000));
    }
    #[tokio::test]
    async fn write_timeout_is_read_back_without_rewrite_and_can_still_confirm() {
        let before = rows();
        let change = flow_change(1, &before);
        let after = applied(&before, &change);
        let transport =
            RecordingTransport::new(vec![ok(before), network(), ok(after)], vec![Reply::Hang]);
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Confirmed);
        assert_eq!(transport.write_calls().len(), 1);
        assert_eq!(transport.read_count(), 3);
    }
    #[tokio::test]
    async fn network_or_failed_last_read_keeps_pending_instead_of_inventing_failure() {
        let before = rows();
        let change = flow_change(2, &before);
        let transport = RecordingTransport::new(
            vec![
                ok(before.clone()),
                ok(before.clone()),
                ok(before),
                network(),
            ],
            vec![network()],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Uncertain);
        assert_eq!(transport.write_calls().len(), 1);
        let before = rows();
        let change = flow_change(2, &before);
        let transport = RecordingTransport::new(
            vec![ok(before), network(), network(), network()],
            vec![network()],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Uncertain);
        assert!(result.report.is_none());
    }
    #[tokio::test]
    async fn partial_rejection_returns_actual_mixed_state_and_never_rolls_back_shared_word() {
        let before = rows();
        let change = mode_change(0, &before);
        let targets = prepare(&device(), &panel(), &before, &change).unwrap();
        let mut mixed = before.clone();
        mixed[4]["value"] = json!(targets[0].value);
        let mut receipts = ack(&targets);
        receipts[1]["code"] = json!(-704010000);
        let transport = RecordingTransport::new(
            vec![ok(before), ok(mixed.clone()), ok(mixed.clone()), ok(mixed)],
            vec![ok(receipts)],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Rejected);
        assert!(result.message.contains("4.5"));
        assert!(result.message.contains("已接受1项"));
        let actual = result.report.unwrap();
        assert_eq!(actual.slots[0].tab, LightSettingsTab::Temperature);
        assert_eq!(actual.slots[0].color, Some(0xff0000));
        assert_eq!(transport.write_calls().len(), 1);
    }
    #[tokio::test]
    async fn unknown_or_foreign_receipt_needs_real_readback_and_does_not_repeat_commands() {
        let before = rows();
        let change = flow_change(0, &before);
        let transport = RecordingTransport::new(
            vec![ok(before), network(), network(), network()],
            vec![ok(vec![
                json!({"did":"foreign","siid":4,"piid":10,"code":0}),
            ])],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Uncertain);
        assert_eq!(transport.write_calls().len(), 1);
    }
    #[tokio::test]
    async fn explicit_rejection_with_unavailable_readback_does_not_claim_a_report_exists() {
        let before = rows();
        let change = flow_change(0, &before);
        let transport = RecordingTransport::new(
            vec![ok(before), network(), network(), network()],
            vec![ok(vec![
                json!({"did":"light-fixture","siid":4,"piid":10,"code":-704010000}),
            ])],
        );
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Rejected);
        assert!(result.report.is_none());
        assert!(result.message.contains("尚未取得设备状态"));
        assert!(!result.message.contains("已保留实际回读结果"));
        assert_eq!(transport.write_calls().len(), 1);
    }
    #[tokio::test]
    async fn confirm_is_queries_only_ignores_old_baseline_and_reads_target_byte() {
        let before = rows();
        let mut change = mode_change(1, &before);
        let mut after = applied(&before, &change);
        if let LightSettingsChange::SaveMode { baseline, .. } = &mut change {
            *baseline = "ignored".into();
        }
        after[4]["value"] = json!(0xff80cbff_u32);
        let transport = RecordingTransport::new(vec![ok(after)], vec![]);
        let result = confirm_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Confirmed);
        assert!(transport.write_calls().is_empty());
        let change = LightSettingsChange::SetSpeed {
            baseline: 255,
            value: 40,
        };
        let mut after = rows();
        after[9]["value"] = json!(40);
        let transport = RecordingTransport::new(vec![ok(after)], vec![]);
        assert_eq!(
            confirm_with(&transport, &device(), &panel(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightSettingsStatus::Confirmed
        );
        assert!(transport.write_calls().is_empty());
    }
    #[tokio::test]
    async fn conflicting_or_unreadable_baseline_never_sends_a_write() {
        let before = rows();
        let change = mode_change(0, &before);
        let mut changed = before.clone();
        changed[0]["value"] = json!(0xabcdef64_u32);
        let transport = RecordingTransport::new(vec![ok(changed)], vec![]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &context, policy())
                .await
                .unwrap_err()
                .kind,
            "lightSettingsConflict"
        );
        assert!(transport.write_calls().is_empty());
        let mut denied = before;
        denied[0]["code"] = json!(-704002000);
        let transport = RecordingTransport::new(vec![ok(denied)], vec![]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &context, policy())
                .await
                .unwrap_err()
                .kind,
            "unconfirmed"
        );
        assert!(transport.write_calls().is_empty());
    }
    #[tokio::test]
    async fn speed_is_one_typed_property_write_and_readback_not_a_mode_command() {
        let before = rows();
        let change = LightSettingsChange::SetSpeed {
            baseline: 50,
            value: 40,
        };
        let targets = prepare(&device(), &panel(), &before, &change).unwrap();
        let after = applied(&before, &change);
        let transport =
            RecordingTransport::new(vec![ok(before), ok(after)], vec![ok(ack(&targets))]);
        let result = change_with(&transport, &device(), &panel(), &change, &context, policy())
            .await
            .unwrap();
        assert_eq!(result.status, LightSettingsStatus::Confirmed);
        assert_eq!(
            transport.write_calls(),
            vec![vec![
                json!({"did":"light-fixture","siid":2,"piid":8,"value":40})
            ]]
        );
    }
    #[tokio::test]
    async fn context_can_expire_after_read_before_write_or_after_write_before_return() {
        let before = rows();
        let change = flow_change(0, &before);
        let checks = AtomicUsize::new(0);
        let check = |_: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 2 {
                Err(AppError::stale())
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(before.clone())], vec![]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &check, policy())
                .await
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert!(transport.write_calls().is_empty());
        let targets = prepare(&device(), &panel(), &before, &change).unwrap();
        let checks = AtomicUsize::new(0);
        let check = |_: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 3 {
                Err(AppError::stale())
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(before)], vec![ok(ack(&targets))]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &check, policy())
                .await
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert_eq!(transport.write_calls().len(), 1);
        assert_eq!(transport.read_count(), 1);
    }
    #[tokio::test]
    async fn write_permissions_are_rechecked_at_last_boundary_and_confirmation_stays_read_only() {
        let before = rows();
        let change = flow_change(0, &before);
        let checks = AtomicUsize::new(0);
        let check = |writing: bool| {
            let n = checks.fetch_add(1, Ordering::SeqCst);
            std::future::ready(if n >= 2 && writing {
                Err(AppError::new("permissionDenied", "became readonly", false))
            } else {
                Ok(())
            })
        };
        let transport = RecordingTransport::new(vec![ok(before)], vec![]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &check, policy())
                .await
                .unwrap_err()
                .kind,
            "permissionDenied"
        );
        assert!(transport.write_calls().is_empty());
    }
    #[tokio::test]
    async fn already_matching_target_uses_current_read_and_skips_all_writes() {
        let before = rows();
        let change = flow_change(0, &before);
        let after = applied(&before, &change);
        let change = LightSettingsChange::SaveFlow {
            index: 0,
            baseline: slot(&after, "light-fixture", 0, true).revision.unwrap(),
            brightness: 75,
            color: 0x800000,
        };
        let transport = RecordingTransport::new(vec![ok(after)], vec![]);
        assert_eq!(
            change_with(&transport, &device(), &panel(), &change, &context, policy())
                .await
                .unwrap()
                .status,
            LightSettingsStatus::Confirmed
        );
        assert!(transport.write_calls().is_empty());
    }
}
