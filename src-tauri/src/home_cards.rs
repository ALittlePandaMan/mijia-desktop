//! Homepage shortcuts compiled from the Android app's public card configuration.
//! Config and Spec are public metadata; device values never enter that cache.
//! APK evidence and deliberate unsupported cases: research/home-quick-control-apk.md.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, id, Device, DevicePanel, Property, Service},
    spec::SpecRepository,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    future::{poll_fn, Future},
    path::PathBuf,
    pin::Pin,
    sync::Arc,
    task::Poll,
    time::Duration,
};
use tokio::sync::Mutex;

const CONFIG_TTL: u64 = 7 * 86400;
const MAX_CONFIG_BYTES: usize = 4 * 1024 * 1024;
// DeviceModelManager.isSwitchCamera: p49 excludes these exact models before
// reading any card layout. "camera double" in that log is a model feature,
// not the user's selected grid width.
const SWITCH_CAMERA_MODELS: &[&str] = &[
    "isa.camera.hlmax",
    "chuangmi.camera.068ac1",
    "mxiang.camera.c500ch",
    "chuangmi.camera.72ac1",
    "isa.camera.500dh",
    "chuangmi.camera.072ae2",
    "mxiang.camera.c500os",
    "chuangmi.camera.075ae1",
    "chuangmi.camera.111ae1",
    "chuangmi.camera.111ac1",
];
#[path = "home_card_status.rs"]
mod status;
pub use status::HomeCardStatus;
type PlanFuture<'a> = Pin<Box<dyn Future<Output = Result<status::DisplayPlan>> + Send + 'a>>;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardReport {
    pub home_id: String,
    pub generation: u64,
    pub cards: Vec<HomeCardEntry>,
    pub statuses: Vec<HomeCardStatus>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardResult {
    pub verified: bool,
    pub message: String,
    pub card: Option<HomeCardEntry>,
    pub status: Option<HomeCardStatus>,
    pub actual: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardEntry {
    pub did: String,
    /// A confirmed property value, never an optimistic assumption.
    pub selected: Option<bool>,
    pub kind: String,
    /// Whether the APK's shortcut state is eligible for a homepage button.
    pub visible: bool,
    /// Presentation state, distinct from the confirmed underlying value.
    pub highlight: bool,
    pub enabled: bool,
    /// Configured mode restriction, independent of power, online and permission.
    pub mode_allowed: Option<bool>,
    pub reason: Option<String>,
    pub binding: HomeCardBinding,
    pub action: String,
    pub card_type: u32,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardBinding {
    pub siid: u32,
    pub piid: u32,
}
/// Server-selected logical property. The state layer validates the current
/// home/generation and resolves the authenticated physical route again.
pub struct HomeCardWrite {
    pub siid: u32,
    pub piid: u32,
    pub value: Value,
}

#[derive(Clone, Serialize, Deserialize)]
struct ConfigBundle {
    fetched_at: u64,
    miot: Value,
    profiles: Value,
}
pub struct HomeCardRepository {
    client: reqwest::Client,
    config: Mutex<Option<Arc<ConfigBundle>>>,
    config_flight: Mutex<()>,
    cache_path: Option<PathBuf>,
}
impl HomeCardRepository {
    pub fn new() -> Result<Self> {
        let cache_path = crate::platform_paths::local_data_dir().map(|base| {
            PathBuf::from(base)
                .join("io.mijiadesktop.client")
                .join("public-home-cards-v1.json")
        });
        let config = cache_path
            .as_ref()
            .and_then(|path| std::fs::read(path).ok())
            .filter(|bytes| bytes.len() <= MAX_CONFIG_BYTES)
            .and_then(|bytes| serde_json::from_slice::<ConfigBundle>(&bytes).ok())
            .filter(valid_bundle)
            .map(Arc::new);
        Ok(Self {
            client: reqwest::Client::builder()
                .connect_timeout(Duration::from_secs(8))
                .timeout(Duration::from_secs(15))
                .redirect(reqwest::redirect::Policy::none())
                .build()
                .map_err(AppError::network)?,
            config: Mutex::new(config),
            config_flight: Mutex::new(()),
            cache_path,
        })
    }
    async fn fetch_config(&self, name: &str, version: &str, lang: &str) -> Result<Value> {
        // AppConfigHelper.OooO00o: this is an unsigned public GET, not Cloud RC4.
        let response = self
            .client
            .get("https://api.mijia.tech/app/service/getappconfig")
            .query(&[(
                "data",
                json!({"name":name,"version":version,"lang":lang}).to_string(),
            )])
            .send()
            .await
            .map_err(AppError::network)?
            .error_for_status()
            .map_err(AppError::network)?;
        if response
            .content_length()
            .is_some_and(|size| size > MAX_CONFIG_BYTES as u64)
        {
            return Err(AppError::protocol());
        }
        let bytes = response.bytes().await.map_err(AppError::network)?;
        if bytes.len() > MAX_CONFIG_BYTES {
            return Err(AppError::protocol());
        }
        let body: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::protocol())?;
        if body["code"] != 0 || body["result"]["name"] != name {
            return Err(AppError::protocol());
        }
        let content: Value = serde_json::from_str(
            body["result"]["content"]
                .as_str()
                .ok_or_else(AppError::protocol)?,
        )
        .map_err(|_| AppError::protocol())?;
        if !content
            .as_array()
            .is_some_and(|rows| !rows.is_empty() && rows.len() < 4096)
        {
            return Err(AppError::protocol());
        }
        Ok(content)
    }
    async fn configuration(&self) -> Result<Arc<ConfigBundle>> {
        if let Some(config) = self
            .config
            .lock()
            .await
            .as_ref()
            .filter(|c| fresh(c))
            .cloned()
        {
            return Ok(config);
        }
        let _flight = self.config_flight.lock().await;
        if let Some(config) = self
            .config
            .lock()
            .await
            .as_ref()
            .filter(|c| fresh(c))
            .cloned()
        {
            return Ok(config);
        }
        let (miot, profiles) = tokio::try_join!(
            self.fetch_config("card_control_miotspec_config", "7", "en"),
            self.fetch_config("card_control_config", "13", "zh_CN")
        )?;
        let config = Arc::new(ConfigBundle {
            fetched_at: epoch_secs(),
            miot,
            profiles,
        });
        if !valid_bundle(&config) {
            return Err(AppError::protocol());
        }
        if let Some(path) = &self.cache_path {
            // This file contains public configuration only. A damaged cache is
            // ignored by new(); a write failure must not hide current controls.
            if let (Some(parent), Ok(bytes)) = (path.parent(), serde_json::to_vec(&*config)) {
                if std::fs::create_dir_all(parent).is_ok() {
                    // This public cache is self-validating on the next load;
                    // write also replaces an expired file on Windows.
                    let _ = std::fs::write(path, bytes);
                }
            }
        }
        *self.config.lock().await = Some(config.clone());
        Ok(config)
    }
    pub(crate) async fn load(
        &self,
        cloud: Arc<Cloud>,
        specs: &SpecRepository,
        resources: &crate::ui_resources::UiResourceRepository,
        home_id: &str,
        generation: u64,
        devices: &[Device],
    ) -> Result<HomeCardReport> {
        let configuration = self.configuration().await?;
        let mut plans = Vec::new();
        // Bounded parallel public Spec fetches. The normal device list does not
        // wait for this independent command and no full panel value reads occur.
        for batch in devices.chunks(8) {
            let mut pending: Vec<PlanFuture<'_>> = batch
                .iter()
                .filter(|device| !device.hidden_on_home || device.split_display_available)
                .map(|device| {
                    Box::pin(status::compile(
                        specs,
                        resources,
                        cloud.clone(),
                        &configuration,
                        device,
                    )) as _
                })
                .collect();
            let mut completed = Vec::new();
            poll_fn(|cx| {
                let mut index = 0;
                while index < pending.len() {
                    match pending[index].as_mut().poll(cx) {
                        Poll::Ready(result) => {
                            completed.push(result);
                            drop(pending.swap_remove(index));
                        }
                        Poll::Pending => index += 1,
                    }
                }
                if pending.is_empty() {
                    Poll::Ready(())
                } else {
                    Poll::Pending
                }
            })
            .await;
            for result in completed {
                match result {
                    Ok(plan) => plans.push(plan),
                    Err(error) if error.kind == "authExpired" => return Err(error),
                    Err(_) => {}
                }
            }
        }
        let values = status::read(&cloud, &plans).await?;
        let cards = plans
            .iter()
            .filter_map(|plan| plan.shortcut.as_ref())
            .map(|plan| describe(plan, &values.controls))
            .collect();
        let statuses = plans
            .iter()
            .filter_map(|plan| status::describe(plan, &values))
            .collect();
        Ok(HomeCardReport {
            home_id: home_id.into(),
            generation,
            cards,
            statuses,
        })
    }
    /// Resolves the current config/Spec and freshly reads its primary value and
    /// guards. No control is sent here. Only explicit desired intents are valid.
    pub async fn prepare_write(
        &self,
        cloud: &Cloud,
        specs: &SpecRepository,
        device: &Device,
        intent: &str,
    ) -> Result<HomeCardWrite> {
        if (device.hidden_on_home && !device.split_display_available) || !device.online {
            return Err(AppError::new("offline", "设备离线或不在首页中。", false));
        }
        if device.shared_read_only {
            return Err(AppError::new(
                "permissionDenied",
                "此共享设备只有读取权限。",
                false,
            ));
        }
        let config = self.configuration().await?;
        let plan = compile_device(specs, &config, device)
            .await?
            .ok_or_else(|| AppError::new("unsupported", "此设备没有可用的首页快捷控制。", false))?;
        let values = read_plans(cloud, std::slice::from_ref(&plan)).await?;
        let card = describe(&plan, &values);
        if !card.enabled {
            return Err(AppError::new(
                "unavailable",
                card.reason
                    .unwrap_or_else(|| "当前不能使用快捷控制。".into()),
                false,
            ));
        }
        let value = if plan.kind == "power" {
            let desired = match intent {
                "on" => true,
                "off" => false,
                _ => return Err(AppError::invalid("开关快捷控制需要明确的开或关意图。")),
            };
            power_value(&plan.target, desired).ok_or_else(|| {
                AppError::new("unsupported", "无法确定此开关的真实属性值。", false)
            })?
        } else {
            let desired = match intent {
                "open" => "Open",
                "close" => "Close",
                "pause" => "Pause",
                _ => return Err(AppError::invalid("窗帘快捷控制只接受开、关或暂停。")),
            };
            // Accept only operations/stop values actually advertised by this
            // card; do not invent motor enum numbers or cross-device semantics.
            if !plan.operations.iter().any(|op| {
                array_strings(&op["set_value"])
                    .chain(array_strings(&op["stop_value"]))
                    .any(|v| normalize(v) == normalize(desired))
            }) {
                return Err(AppError::new(
                    "unsupported",
                    "该窗帘配置没有此快捷动作。",
                    false,
                ));
            }
            enum_value(&plan.target, desired).ok_or_else(|| {
                AppError::new("unsupported", "窗帘描述缺少该动作的真实枚举值。", false)
            })?
        };
        crate::spec::validate_value(&plan.target, &value)?;
        Ok(HomeCardWrite {
            siid: plan.target.siid,
            piid: plan.target.piid,
            value,
        })
    }
}

fn fresh(config: &ConfigBundle) -> bool {
    let now = epoch_secs();
    config.fetched_at <= now && now - config.fetched_at < CONFIG_TTL
}
fn valid_bundle(config: &ConfigBundle) -> bool {
    fresh(config)
        && config.miot.as_array().is_some_and(|a| {
            !a.is_empty()
                && a.len() < 4096
                && a.iter().all(|entry| {
                    entry["card_items"].is_array() && entry["card_instance"].is_array()
                })
        })
        && config
            .profiles
            .as_array()
            .is_some_and(|a| !a.is_empty() && a.len() < 4096)
}
fn array_strings(value: &Value) -> impl Iterator<Item = &str> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
}
fn normalize(value: &str) -> String {
    value
        .chars()
        .filter(|c| !c.is_ascii_whitespace())
        .collect::<String>()
        .replace("@3x", "")
        .to_ascii_lowercase()
}
fn urn_name(urn: &str) -> Option<&str> {
    urn.split(':').nth(3)
}
fn contains_urn(value: &Value, urn: &str) -> bool {
    array_strings(value).any(|v| v == urn)
}
fn category_entry<'a>(config: &'a ConfigBundle, category: &str) -> Option<&'a Value> {
    config
        .miot
        .as_array()?
        .iter()
        .find(|entry| array_strings(&entry["types"]).any(|name| name == category))
}

#[derive(Clone)]
struct Node {
    siid: u32,
    iid: u32,
    service_name: String,
    service_description: String,
    name: String,
    description: String,
    kind: char,
    property: Option<Property>,
}
fn nodes(panel: &DevicePanel) -> Vec<Node> {
    panel
        .services
        .iter()
        .flat_map(|service| {
            let properties = service.properties.iter().map(|p| {
                node(
                    service,
                    p.piid,
                    'p',
                    &p.name,
                    &p.description,
                    Some(p.clone()),
                )
            });
            let actions = service
                .actions
                .iter()
                .map(|a| node(service, a.aiid, 'a', &a.name, &a.description, None));
            properties.chain(actions)
        })
        .collect()
}
fn node(
    service: &Service,
    iid: u32,
    kind: char,
    name: &str,
    description: &str,
    property: Option<Property>,
) -> Node {
    Node {
        siid: service.siid,
        iid,
        service_name: service.name.clone(),
        service_description: service.description.clone(),
        name: name.into(),
        description: description.into(),
        kind,
        property,
    }
}
fn select_nodes(nodes: &[Node], key: &str) -> Vec<Node> {
    let parts: Vec<_> = key.split(':').collect();
    if parts.len() != 3 {
        return vec![];
    } // V3 module routes are unsupported.
    nodes
        .iter()
        .filter(|node| {
            let kind = node.kind.to_string();
            if parts[0] == kind {
                node.service_name == parts[1] && node.name == parts[2]
            } else if parts[0] == format!("{kind}i") {
                parts[1].parse::<u32>().ok() == Some(node.siid)
                    && parts[2].parse::<u32>().ok() == Some(node.iid)
            } else {
                false
            }
        })
        .cloned()
        .collect()
}
fn operations(item: &Value) -> Vec<Value> {
    item.get("grid_operation")
        .or_else(|| item.get("operation"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
}
fn selector_keys(item: &Value) -> Option<Vec<String>> {
    let key = item
        .get("grid_extra_key")
        .or_else(|| item.get("prop_key"))?
        .as_str()?;
    let mut keys: Vec<String> = key.split(',').map(str::to_owned).collect();
    for operation in operations(item) {
        if let Some(target) = operation
            .get("action")
            .or_else(|| operation.get("set_prop"))
            .and_then(Value::as_str)
            .filter(|v| !v.is_empty())
        {
            if !keys.iter().any(|key| key == target) {
                keys.push(target.into());
            }
        }
    }
    Some(keys)
}
fn filtered_candidates(nodes: &[Node], key: &str, item: &Value, required: usize) -> Vec<Node> {
    let mut selected: Vec<Node> = select_nodes(nodes, key)
        .into_iter()
        .filter(|node| {
            node.property.as_ref().is_none_or(|p| {
                array_strings(&item["access"]).all(|access| p.access.iter().any(|a| a == access))
            })
        })
        .collect();
    if selected.len() > required {
        selected.retain(|node| {
            let matches = |key: &str, description: &str| {
                item.get(key)
                    .and_then(Value::as_array)
                    .is_none_or(|descriptions| {
                        descriptions
                            .iter()
                            .filter_map(Value::as_str)
                            .any(|s| normalize(s) == normalize(description))
                    })
            };
            matches("prop_desc", &node.description)
                && matches("service_desc", &node.service_description)
        });
    }
    selected
}
struct BoundItem {
    item: Value,
    nodes: Vec<Node>,
}
/// Every layout item must match exactly; a status-only multi-switch layout is
/// successful and must prevent falling through to the single-switch layout.
fn bind_layout(
    entry: &Value,
    instance: &Value,
    nodes: &[Node],
    urn: &str,
) -> Option<Vec<BoundItem>> {
    if contains_urn(&instance["disable_type"], urn)
        || instance["min_support_version"].as_u64().unwrap_or(0) > 20
        || instance["abtest"].as_str().is_some_and(|s| !s.is_empty())
    {
        return None;
    }
    let items = entry["card_items"].as_array()?;
    let layout: Vec<_> = instance["card_layout"]
        .as_array()?
        .iter()
        .map(Value::as_array)
        .collect::<Option<_>>()?;
    let indexes: Vec<usize> = layout
        .into_iter()
        .flatten()
        .map(|index| index.as_u64().and_then(|v| usize::try_from(v).ok()))
        .collect::<Option<_>>()?;
    if indexes.is_empty() || indexes.len() > 64 {
        return None;
    }
    let mut bound: HashMap<usize, Vec<Vec<Node>>> = HashMap::new();
    for &index in &indexes {
        if bound.contains_key(&index) {
            continue;
        }
        let item = items.get(index)?;
        let repeated = indexes.iter().filter(|&&value| value == index).count();
        let mut rows = vec![Vec::new(); repeated];
        for key in selector_keys(item)? {
            let candidates = filtered_candidates(nodes, &key, item, repeated);
            if candidates.len() != repeated {
                return None;
            }
            for (row, candidate) in rows.iter_mut().zip(candidates) {
                row.push(candidate);
            }
        }
        if rows.iter().any(Vec::is_empty) {
            return None;
        }
        bound.insert(index, rows);
    }
    let mut used: HashMap<usize, usize> = HashMap::new();
    indexes
        .into_iter()
        .map(|index| {
            let position = used.entry(index).or_default();
            let result = BoundItem {
                item: items[index].clone(),
                nodes: bound.get(&index)?[*position].clone(),
            };
            *position += 1;
            Some(result)
        })
        .collect()
}
fn select_layout(entry: &Value, nodes: &[Node], urn: &str) -> Option<Vec<BoundItem>> {
    if contains_urn(&entry["disable_type"], urn) {
        return None;
    }
    let instances = entry["card_instance"].as_array()?;
    for instance_type in [6, 5] {
        for instance in instances {
            if instance["instance_type"] != instance_type {
                continue;
            }
            if instance_type == 6 && !contains_urn(&instance["type"], urn) {
                continue;
            }
            if let Some(bound) = bind_layout(entry, instance, nodes, urn) {
                return Some(bound);
            }
        }
    }
    None
}

#[derive(Clone)]
struct Dependency {
    matcher: Value,
    property: Property,
}
struct CardPlan {
    device: Device,
    kind: &'static str,
    card_type: u32,
    primary: Property,
    target: Property,
    operations: Vec<Value>,
    dependencies: Vec<Dependency>,
    unresolved_dependency: bool,
    urn: String,
}
async fn compile_device(
    specs: &SpecRepository,
    config: &ConfigBundle,
    device: &Device,
) -> Result<Option<CardPlan>> {
    if crate::capabilities::read_only_category(device.spec_type.as_deref()) {
        return Ok(None);
    }
    if device.unsupported_reason.is_some() || SWITCH_CAMERA_MODELS.contains(&device.model.as_str())
    {
        return Ok(None);
    }
    // p49.OooO0oO gives exact legacy model profiles priority. Its RPC methods
    // are not compatible with MIoT set_property; do not synthesize a substitute.
    if config
        .profiles
        .as_array()
        .into_iter()
        .flatten()
        .any(|row| array_strings(&row["models"]).any(|model| model == device.model))
    {
        return Ok(None);
    }
    // Avoid fetching public Spec for categories whose configured grid has no
    // property shortcut. Devices missing a URN can still resolve via registry.
    if let Some(typ) = device.spec_type.as_deref() {
        let Some(entry) = urn_name(typ).and_then(|name| category_entry(config, name)) else {
            return Ok(None);
        };
        if contains_urn(&entry["disable_type"], typ)
            || !entry["card_items"]
                .as_array()
                .into_iter()
                .flatten()
                .any(|item| {
                    item["cardType"] == 1
                        || (item["cardType"] == 3 && urn_name(typ) == Some("curtain"))
                })
        {
            return Ok(None);
        }
    }
    let panel = specs.panel(device).await?;
    compile_panel(config, device, &panel)
}
fn compile_panel(
    config: &ConfigBundle,
    device: &Device,
    panel: &DevicePanel,
) -> Result<Option<CardPlan>> {
    if panel.unsupported_reason.is_some()
        || SWITCH_CAMERA_MODELS.contains(&device.model.as_str())
        || crate::capabilities::read_only_category(panel.spec_type.as_deref())
    {
        return Ok(None);
    }
    let Some(urn) = panel.spec_type.as_deref() else {
        return Ok(None);
    };
    let Some(entry) = urn_name(urn).and_then(|name| category_entry(config, name)) else {
        return Ok(None);
    };
    let all_nodes = nodes(panel);
    let Some(bound) = select_layout(entry, &all_nodes, urn) else {
        return Ok(None);
    };
    // Only the first shortcut State is rendered by q8h.OooOo00.
    for bound in bound {
        let card_type = bound.item["cardType"].as_u64().unwrap_or(0) as u32;
        if ![1, 2, 3].contains(&card_type) {
            continue;
        }
        let Some(primary) = bound.nodes.first().and_then(|n| n.property.clone()) else {
            continue;
        };
        let ops = operations(&bound.item);
        let (kind, target) = if card_type == 1 {
            // Type 1 supplies a binary property shortcut. Require a validated
            // binary value pair; type 2 action/state cards are deliberately not
            // relabelled as power (vacuum start/pause, mute, lid, etc.).
            if primary.name != "on"
                || ops.iter().any(|op| {
                    op["action"].as_str().is_some_and(|s| !s.is_empty())
                        || op["method"].as_str().is_some_and(|s| !s.is_empty())
                        || op["set_prop"].as_str().is_some_and(|s| !s.is_empty())
                        || op.get("set_value").is_some()
                })
            {
                return Ok(None);
            }
            if power_value(&primary, false).is_none() || power_value(&primary, true).is_none() {
                return Ok(None);
            }
            ("power", primary.clone())
        } else if card_type == 3 && urn_name(urn) == Some("curtain") {
            if primary.name != "current-position" {
                return Ok(None);
            }
            let target_key = ops.first().and_then(|op| op["set_prop"].as_str());
            if target_key.is_none()
                || ops.iter().any(|op| {
                    op["set_prop"].as_str() != target_key
                        || op["action"].as_str().is_some_and(|s| !s.is_empty())
                        || op["method"].as_str().is_some_and(|s| !s.is_empty())
                })
            {
                return Ok(None);
            }
            let target = ops
                .iter()
                .filter_map(|op| op["set_prop"].as_str())
                .find_map(|key| {
                    let nodes = select_nodes(&all_nodes, key);
                    (nodes.len() == 1)
                        .then(|| nodes[0].property.clone())
                        .flatten()
                });
            let Some(target) = target else {
                return Ok(None);
            };
            if target.name != "motor-control" {
                return Ok(None);
            }
            if ["Open", "Close", "Pause"]
                .iter()
                .any(|value| enum_value(&target, value).is_none())
            {
                return Ok(None);
            }
            // Only this audited pair of config expressions is understood.
            if ops.len() != 2
                || ops[0]["prop_range"] != "$value<=2"
                || ops[1]["prop_range"] != "$value>2"
                || ops[0]["set_value"] != json!(["Open"])
                || ops[1]["set_value"] != json!(["Close"])
                || ops.iter().any(|op| op["stop_value"] != json!(["Pause"]))
            {
                return Ok(None);
            }
            ("curtain", target)
        } else {
            return Ok(None);
        };
        if !primary.access.iter().any(|a| a == "read")
            || !target.access.iter().any(|a| a == "write")
            || primary.unsupported_reason.is_some()
            || target.unsupported_reason.is_some()
        {
            return Ok(None);
        }
        let mut dependencies = vec![];
        let mut unresolved_dependency = false;
        let mut gate_ops = ops.clone();
        if let Some(normal) = bound.item["operation"].as_array() {
            gate_ops.extend(normal.clone());
        }
        for op in &gate_ops {
            for matcher in ["enable_status", "disable_status"]
                .iter()
                .flat_map(|key| op[*key].as_array().into_iter().flatten())
            {
                let candidates = select_nodes(&all_nodes, matcher["key"].as_str().unwrap_or(""));
                // Android binds dependency in the primary service context.
                let local: Vec<_> = candidates
                    .iter()
                    .filter(|n| n.siid == primary.siid)
                    .collect();
                let selected = if local.len() == 1 {
                    local.first().copied()
                } else if candidates.len() == 1 {
                    candidates.first()
                } else {
                    None
                };
                if let Some(property) = selected
                    .and_then(|n| n.property.as_ref())
                    .filter(|p| p.access.iter().any(|a| a == "read"))
                {
                    dependencies.push(Dependency {
                        matcher: matcher.clone(),
                        property: property.clone(),
                    });
                } else if !candidates.is_empty() {
                    unresolved_dependency = true;
                }
            }
        }
        return Ok(Some(CardPlan {
            device: device.clone(),
            kind,
            card_type,
            primary,
            target,
            operations: gate_ops,
            dependencies,
            unresolved_dependency,
            urn: urn.into(),
        }));
    }
    Ok(None)
}

type Values = HashMap<(String, u32, u32), Value>;
fn key(device: &Device, property: &Property) -> (String, u32, u32) {
    (device.control_did().into(), property.siid, property.piid)
}
async fn read_plans(cloud: &Cloud, plans: &[CardPlan]) -> Result<Values> {
    let mut seen = HashSet::new();
    let mut params = vec![];
    for plan in plans.iter().filter(|plan| plan.device.online) {
        for property in
            std::iter::once(&plan.primary).chain(plan.dependencies.iter().map(|d| &d.property))
        {
            let key = key(&plan.device, property);
            if seen.insert(key.clone()) {
                params.push(json!({"did":key.0,"siid":key.1,"piid":key.2}));
            }
        }
    }
    if params.is_empty() {
        return Ok(HashMap::new());
    }
    let result = cloud.read(params).await;
    let rows = match result {
        Ok(rows) => rows,
        Err(error) if error.kind == "authExpired" => return Err(error),
        Err(_) => return Ok(HashMap::new()),
    };
    Ok(rows
        .iter()
        .filter(|row| row["code"] == 0)
        .filter_map(|row| {
            let key = (
                id(&row["did"]),
                u32::try_from(row["siid"].as_u64()?).ok()?,
                u32::try_from(row["piid"].as_u64()?).ok()?,
            );
            let value = row.get("value").filter(|v| !v.is_null())?.clone();
            seen.contains(&key).then_some((key, value))
        })
        .collect())
}
fn enum_value(property: &Property, description: &str) -> Option<Value> {
    property
        .value_list
        .as_ref()?
        .iter()
        .find(|label| normalize(&label.description) == normalize(description))
        .map(|label| label.value.clone())
}
fn power_value(property: &Property, desired: bool) -> Option<Value> {
    if property.format == "bool" {
        return Some(Value::Bool(desired));
    }
    let truth = if desired { 1 } else { 0 };
    if let Some(list) = &property.value_list {
        if list.len() != 2 {
            return None;
        }
        return list
            .iter()
            .find(|entry| entry.value.as_i64() == Some(truth))
            .map(|entry| entry.value.clone());
    }
    if let Some(range) = &property.value_range {
        if range.len() >= 2 && range[0] == 0.0 && range[1] == 1.0 {
            return Some(json!(truth));
        }
    }
    None
}
fn truth(value: &Value) -> Option<bool> {
    value.as_bool().or_else(|| match value.as_f64() {
        Some(0.0) => Some(false),
        Some(1.0) => Some(true),
        _ => None,
    })
}
fn semantic_value(property: &Property, value: &Value) -> String {
    property
        .value_list
        .as_ref()
        .and_then(|list| list.iter().find(|entry| entry.value == *value))
        .map(|entry| entry.description.clone())
        .unwrap_or_else(|| {
            value
                .as_str()
                .map(str::to_owned)
                .unwrap_or_else(|| value.to_string())
        })
}
fn matcher_applies(matcher: &Value, urn: &str) -> bool {
    !contains_urn(&matcher["disable_type"], urn)
        && matcher
            .get("enable_type")
            .is_none_or(|value| contains_urn(value, urn))
}
fn matcher_matches(plan: &CardPlan, matcher: &Value, values: &Values) -> Option<bool> {
    if !matcher_applies(matcher, &plan.urn) {
        return Some(false);
    }
    let dependency = plan
        .dependencies
        .iter()
        .find(|dependency| dependency.matcher == *matcher);
    let Some(dependency) = dependency else {
        return Some(false);
    };
    let actual = values.get(&key(&plan.device, &dependency.property))?;
    let desired = &matcher["value"];
    let actual = semantic_value(&dependency.property, actual);
    let desired_text = desired
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| desired.to_string());
    Some(
        actual.eq_ignore_ascii_case(&desired_text)
            || desired
                .as_bool()
                .is_some_and(|value| actual.eq_ignore_ascii_case(if value { "1" } else { "0" })),
    )
}
fn operation_enabled(plan: &CardPlan, operation: &Value, values: &Values) -> Option<bool> {
    // APK returns true when no status dependency exists in this device's Spec.
    // A defined dependency whose current read is missing remains unknown below.
    if plan.dependencies.is_empty() {
        return Some(true);
    }
    let enables = operation.get("enable_status").and_then(Value::as_array);
    let disables = operation.get("disable_status").and_then(Value::as_array);
    let mut unknown = false;
    if let Some(enables) = enables {
        for matcher in enables {
            match matcher_matches(plan, matcher, values) {
                Some(true) => return Some(true),
                None => unknown = true,
                _ => {}
            }
        }
    }
    if let Some(disables) = disables {
        for matcher in disables {
            match matcher_matches(plan, matcher, values) {
                Some(true) => return if unknown { None } else { Some(false) },
                None => unknown = true,
                _ => {}
            }
        }
        if unknown {
            None
        } else {
            Some(true)
        }
    } else if unknown {
        None
    } else {
        Some(enables.is_none())
    }
}
fn describe(plan: &CardPlan, values: &Values) -> HomeCardEntry {
    let value = values.get(&key(&plan.device, &plan.primary));
    let selected = if plan.kind == "power" {
        value.and_then(truth)
    } else {
        value.and_then(Value::as_f64).map(|position| position > 2.0)
    };
    let gate = if plan.unresolved_dependency {
        None
    } else {
        // Power cards currently have a single gate-only operation. Curtains'
        // selected operation is determined by the audited position expression.
        let operations: Vec<_> = if plan.kind == "curtain" {
            plan.operations
                .iter()
                .filter(|op| {
                    value.and_then(Value::as_f64).is_some_and(|position| {
                        match op["prop_range"].as_str() {
                            Some("$value<=2") => position <= 2.0,
                            Some("$value>2") => position > 2.0,
                            _ => true,
                        }
                    })
                })
                .collect()
        } else {
            plan.operations.iter().collect()
        };
        operations.into_iter().try_fold(true, |allowed, operation| {
            operation_enabled(plan, operation, values).map(|gate| allowed && gate)
        })
    };
    let reason = if !plan.device.online {
        Some("设备离线。".into())
    } else if plan.device.shared_read_only {
        Some("此共享设备只有读取权限。".into())
    } else if selected.is_none() {
        Some("尚未读取到设备状态，请重试。".into())
    } else if gate.is_none() {
        Some("无法确认快捷控制的限制状态。".into())
    } else if gate == Some(false) {
        Some("设备当前模式不允许此快捷控制。".into())
    } else {
        None
    };
    // p49.OooO0o replaces non-camera type-1/2 UNABLE state pairs with
    // textual disabled status. q8h then excludes them from shortcut states.
    // Cameras retain their UNABLE state/icon. Unknown live reads remain a
    // visible disabled placeholder in this desktop implementation.
    let visible = plan.device.online
        && !plan.device.shared_read_only
        && !(gate == Some(false)
            && [1, 2].contains(&plan.card_type)
            && urn_name(&plan.urn) != Some("camera"));
    let enabled = visible && reason.is_none();
    let highlight = visible && enabled && plan.kind == "power" && selected == Some(true);
    HomeCardEntry {
        did: plan.device.did.clone(),
        selected,
        kind: plan.kind.into(),
        visible,
        highlight,
        enabled,
        mode_allowed: gate,
        reason,
        binding: HomeCardBinding {
            siid: plan.target.siid,
            piid: plan.target.piid,
        },
        action: if plan.kind == "curtain" {
            if selected == Some(true) {
                "close"
            } else {
                "open"
            }
        } else if selected == Some(true) {
            "off"
        } else {
            "on"
        }
        .into(),
        card_type: plan.card_type,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{models::SplitRoute, spec::parse_panel};

    // Public service snapshot, 2026-10-28; only selected categories retained.
    fn config() -> ConfigBundle {
        ConfigBundle {
            fetched_at: epoch_secs(),
            miot: serde_json::from_str(include_str!("fixtures/home_cards_config.json")).unwrap(),
            profiles: json!([]),
        }
    }
    fn device(category: &str) -> Device {
        serde_json::from_value(json!({"did":"logical", "name":"fixture", "model":"fixture.model.v1", "online":true, "roomId":"r", "roomName":"r", "specType":format!("urn:miot-spec-v2:device:{category}:00000000:fixture:1")})).unwrap()
    }
    fn property(iid: u32, name: &str, format: &str, access: &[&str]) -> Value {
        json!({"iid":iid,"type":format!("urn:miot-spec-v2:property:{name}:00000000:fixture:1"),"description":name,"format":format,"access":access})
    }
    fn service(iid: u32, name: &str, properties: Vec<Value>) -> Value {
        json!({"iid":iid,"type":format!("urn:miot-spec-v2:service:{name}:00000000:fixture:1"),"description":name,"properties":properties})
    }
    fn panel(device: &Device, services: Vec<Value>) -> DevicePanel {
        parse_panel(
            device,
            &json!({"type":device.spec_type,"services":services}),
        )
        .unwrap()
    }
    fn switch_service(iid: u32) -> Value {
        let mut mode = property(2, "mode", "uint8", &["read", "write"]);
        mode["value-list"] = json!([{"value":7,"description":"Wired And Wireless"},{"value":9,"description":"Wireless"}]);
        service(
            iid,
            "switch",
            vec![
                property(1, "on", "bool", &["read", "write", "notify"]),
                mode,
            ],
        )
    }
    fn switch_plan() -> CardPlan {
        let d = device("switch");
        compile_panel(&config(), &d, &panel(&d, vec![switch_service(2)]))
            .unwrap()
            .unwrap()
    }
    fn values(plan: &CardPlan, power: Value, mode: Value) -> Values {
        let mut values = Values::from([(key(&plan.device, &plan.primary), power)]);
        for dependency in &plan.dependencies {
            values.insert(key(&plan.device, &dependency.property), mode.clone());
        }
        values
    }

    #[test]
    fn multi_switch_status_layout_preempts_toggle_but_split_binds_one_service() {
        let config = config();
        let d = device("switch");
        let spec = json!({"type":d.spec_type,"services":[switch_service(2),switch_service(3),switch_service(4)]});
        let full = parse_panel(&d, &spec).unwrap();
        let entry = category_entry(&config, "switch").unwrap();
        let bound = select_layout(entry, &nodes(&full), d.spec_type.as_deref().unwrap()).unwrap();
        assert_eq!(bound.len(), 3);
        assert!(bound.iter().all(|item| item.item["cardType"] == 8));
        assert!(compile_panel(&config, &d, &full).unwrap().is_none());
        let mut split = d;
        split.did = "logical.s9".into(); // suffix must not determine SIID.
        split.split_route = Some(SplitRoute {
            parent_did: "parent".into(),
            service_iid: 3,
        });
        let filtered = parse_panel(&split, &spec).unwrap();
        let plan = compile_panel(&config, &split, &filtered).unwrap().unwrap();
        assert_eq!(plan.target.siid, 3);
        assert_eq!(key(&plan.device, &plan.primary), ("parent".into(), 3, 1));
        assert_eq!(plan.card_type, 1);
    }
    #[test]
    fn public_group3_light_spec_compiles_standard_power_without_rpc_mapping() {
        let spec: Value =
            serde_json::from_str(include_str!("fixtures/home_cards_group3_spec.json")).unwrap();
        let mut device = device("light");
        device.model = "mijia.light.group3".into();
        device.spec_type = spec["type"].as_str().map(str::to_owned);
        let panel = parse_panel(&device, &spec).unwrap();
        let plan = compile_panel(&config(), &device, &panel).unwrap().unwrap();
        assert_eq!(plan.kind, "power");
        assert_eq!((plan.target.siid, plan.target.piid), (2, 1));
        assert_eq!(plan.target.format, "bool");
        assert_eq!(power_value(&plan.target, true), Some(json!(true)));
        assert_eq!(power_value(&plan.target, false), Some(json!(false)));
        let entry = describe(
            &plan,
            &Values::from([(key(&device, &plan.primary), json!(true))]),
        );
        assert!(entry.visible && entry.enabled && entry.highlight);
    }
    #[test]
    fn full_urn_override_wins_and_disabled_urn_is_rejected() {
        let urn = "urn:miot-spec-v2:device:outlet:00000000:fixture:1";
        let entry = json!({"card_items":[{"cardType":1,"prop_key":"p:switch:on"},{"cardType":1,"prop_key":"pi:9:7"}],"card_instance":[{"instance_type":5,"card_layout":[[0]]},{"instance_type":6,"type":[urn],"card_layout":[[1]]}]});
        let d = device("outlet");
        let p = panel(
            &d,
            vec![
                switch_service(2),
                service(
                    9,
                    "custom",
                    vec![property(7, "flag", "bool", &["read", "write"])],
                ),
            ],
        );
        let bound = select_layout(&entry, &nodes(&p), urn).unwrap();
        assert_eq!(bound[0].nodes[0].siid, 9);
        let mut disabled = entry;
        disabled["disable_type"] = json!([urn]);
        assert!(select_layout(&disabled, &nodes(&p), urn).is_none());
    }
    #[test]
    fn all_layout_bindings_and_access_are_required_before_fallback() {
        let d = device("light");
        let p = panel(
            &d,
            vec![service(
                2,
                "light",
                vec![property(1, "on", "bool", &["read", "write"])],
            )],
        );
        let config = config();
        let entry = category_entry(&config, "light").unwrap();
        let bound = select_layout(entry, &nodes(&p), d.spec_type.as_deref().unwrap()).unwrap();
        // The first light layout also needs brightness. Only its second layout binds.
        assert_eq!(bound.len(), 1);
        let camera = device("camera");
        let p = panel(
            &camera,
            vec![service(
                2,
                "camera-control",
                vec![property(1, "on", "bool", &["read", "write"])],
            )],
        );
        assert!(compile_panel(&config, &camera, &p).unwrap().is_none()); // notify required
    }
    #[test]
    fn switch_wireless_mode_disables_and_missing_live_guard_stays_unknown() {
        let plan = switch_plan();
        let permitted = values(&plan, json!(false), json!(7));
        let entry = describe(&plan, &permitted);
        assert!(entry.enabled);
        assert!(entry.visible);
        assert_eq!(entry.mode_allowed, Some(true));
        assert!(!entry.highlight);
        assert_eq!(entry.selected, Some(false));
        assert_eq!(entry.action, "on");
        let disabled = describe(&plan, &values(&plan, json!(true), json!(9)));
        assert!(!disabled.enabled);
        assert_eq!(disabled.selected, Some(true));
        assert!(!disabled.visible);
        assert_eq!(disabled.mode_allowed, Some(false));
        assert!(!disabled.highlight);
        let unknown = Values::from([(key(&plan.device, &plan.primary), json!(true))]);
        assert!(!describe(&plan, &unknown).enabled);
        assert_eq!(describe(&plan, &unknown).mode_allowed, None);
        assert!(describe(&plan, &unknown).visible);
        assert!(!describe(&plan, &unknown).highlight);
        assert!(!describe(&plan, &Values::new()).enabled);
        assert_eq!(describe(&plan, &Values::new()).selected, None);
    }
    #[test]
    fn split_mode_guard_handles_all_wireless_enum_values_including_flex() {
        // Public yeelink.switch.ylsw6 Spec labels values 1, 2 (flex) and 3
        // (wireless remote) identically as Wireless. Never assume mode == 1.
        let mut d = device("switch");
        d.split_route = Some(SplitRoute {
            parent_did: "physical".into(),
            service_iid: 7,
        });
        let mut raw = switch_service(7);
        raw["properties"][1]["value-list"] = json!([
            {"value":0,"description":"Wired And Wireless"},
            {"value":1,"description":"Wireless"},
            {"value":2,"description":"Wireless"},
            {"value":3,"description":"Wireless"}
        ]);
        let p = panel(&d, vec![raw]);
        let plan = compile_panel(&config(), &d, &p).unwrap().unwrap();
        assert_eq!(plan.target.siid, 7);
        assert_eq!(
            describe(&plan, &values(&plan, json!(false), json!(0))).mode_allowed,
            Some(true)
        );
        for mode in [1, 2, 3] {
            let described = describe(&plan, &values(&plan, json!(true), json!(mode)));
            assert_eq!(described.mode_allowed, Some(false));
            assert!(!described.visible && !described.enabled);
        }
    }
    #[test]
    fn binary_state_accepts_only_bool_or_numeric_zero_one() {
        for (value, expected) in [
            (json!(true), true),
            (json!(false), false),
            (json!(0), false),
            (json!(1), true),
            (json!(0.0), false),
            (json!(1.0), true),
        ] {
            assert_eq!(truth(&value), Some(expected));
        }
        let plan = switch_plan();
        for value in [
            json!(2),
            json!(-1),
            json!(0.5),
            json!(100),
            json!("true"),
            json!("false"),
            json!("1"),
            json!("0"),
            Value::Null,
            json!([]),
            json!({}),
        ] {
            assert_eq!(truth(&value), None);
            let entry = describe(&plan, &values(&plan, value, json!(7)));
            assert_eq!(entry.selected, None);
            assert!(!entry.enabled);
            assert!(!entry.highlight);
        }
    }
    #[test]
    fn actual_power_value_does_not_imply_visible_or_active_presentation() {
        let mut plan = switch_plan();
        let readback = values(&plan, json!(true), json!(7));
        let normal = describe(&plan, &readback);
        assert!(normal.visible && normal.enabled && normal.highlight);
        assert_eq!(normal.selected, Some(true));
        plan.device.shared_read_only = true;
        let read_only = describe(&plan, &readback);
        assert_eq!(read_only.selected, Some(true));
        assert!(!read_only.visible && !read_only.enabled && !read_only.highlight);
        plan.device.shared_read_only = false;
        plan.device.online = false;
        let offline = describe(&plan, &readback);
        assert_eq!(offline.selected, Some(true));
        assert!(!offline.visible && !offline.enabled && !offline.highlight);
    }
    #[test]
    fn enable_match_has_priority_over_disable_match_and_type_scopes_apply() {
        let mut plan = switch_plan();
        let matcher = json!({"key":"p:switch:mode","value":"Wireless"});
        plan.dependencies = vec![Dependency {
            matcher: matcher.clone(),
            property: plan.dependencies[0].property.clone(),
        }];
        let op = json!({"enable_status":[matcher.clone()],"disable_status":[matcher.clone()]});
        assert_eq!(
            operation_enabled(&plan, &op, &values(&plan, json!(false), json!(9))),
            Some(true)
        );
        let forbidden =
            json!({"key":"p:switch:mode","value":"Wireless","disable_type":[plan.urn.clone()]});
        assert_eq!(
            matcher_matches(&plan, &forbidden, &Values::new()),
            Some(false)
        );
        assert_eq!(operation_enabled(&plan, &op, &Values::new()), None);
    }
    #[test]
    fn semantic_enum_match_does_not_treat_every_positive_number_as_boolean_true() {
        let mut plan = switch_plan();
        let matcher = json!({"key":"p:switch:mode","value":true});
        let property = plan.dependencies[0].property.clone();
        plan.dependencies = vec![Dependency {
            matcher: matcher.clone(),
            property,
        }];
        assert_eq!(
            matcher_matches(&plan, &matcher, &values(&plan, json!(true), json!(9))),
            Some(false)
        );
    }
    #[test]
    fn absent_spec_guard_is_inapplicable_but_shared_read_only_is_disabled() {
        let mut d = device("switch");
        d.shared_read_only = true;
        let p = panel(
            &d,
            vec![service(
                2,
                "switch",
                vec![property(1, "on", "bool", &["read", "write"])],
            )],
        );
        let plan = compile_panel(&config(), &d, &p).unwrap().unwrap();
        assert!(plan.dependencies.is_empty());
        assert!(!plan.unresolved_dependency);
        assert!(!describe(&plan, &values(&plan, json!(true), Value::Null)).enabled);
        assert!(!describe(&plan, &values(&plan, json!(true), Value::Null)).visible);
    }
    #[test]
    fn camera_mask_is_a_real_dependency_and_unsupported_camera_urn_is_hidden() {
        let config = config();
        let d = device("camera");
        let p = panel(
            &d,
            vec![service(
                2,
                "camera-control",
                vec![
                    property(1, "on", "bool", &["read", "write", "notify"]),
                    property(2, "physical-mask", "bool", &["read", "notify"]),
                ],
            )],
        );
        let plan = compile_panel(&config, &d, &p).unwrap().unwrap();
        assert!(describe(&plan, &values(&plan, json!(true), json!(false))).enabled);
        assert!(!describe(&plan, &values(&plan, json!(true), json!(true))).enabled);
        let masked = describe(&plan, &values(&plan, json!(true), json!(true)));
        assert_eq!(masked.selected, Some(true));
        assert!(masked.visible);
        assert!(!masked.enabled && !masked.highlight);
        let entry = category_entry(&config, "camera").unwrap();
        let disabled_urn = array_strings(&entry["disable_type"]).next().unwrap();
        assert!(select_layout(entry, &nodes(&p), disabled_urn).is_none());
        for model in SWITCH_CAMERA_MODELS {
            let mut excluded = d.clone();
            excluded.model = (*model).into();
            assert!(compile_panel(&config, &excluded, &p).unwrap().is_none());
        }
    }
    #[test]
    fn curtain_uses_position_and_real_motor_enum_values() {
        let d = device("curtain");
        let mut motor = property(7, "motor-control", "uint8", &["write"]);
        motor["value-list"] = json!([{"value":17,"description":"Open"},{"value":23,"description":"Pause"},{"value":41,"description":"Close"}]);
        let p = panel(
            &d,
            vec![service(
                4,
                "curtain",
                vec![
                    property(3, "current-position", "uint8", &["read", "notify"]),
                    motor,
                ],
            )],
        );
        let plan = compile_panel(&config(), &d, &p).unwrap().unwrap();
        assert_eq!(plan.kind, "curtain");
        assert_eq!((plan.primary.siid, plan.primary.piid), (4, 3));
        assert_eq!((plan.target.siid, plan.target.piid), (4, 7));
        assert_eq!(enum_value(&plan.target, "Open"), Some(json!(17)));
        assert_eq!(enum_value(&plan.target, "Pause"), Some(json!(23)));
        let closed = describe(&plan, &Values::from([(key(&d, &plan.primary), json!(2))]));
        assert_eq!(closed.action, "open");
        let opened = describe(&plan, &Values::from([(key(&d, &plan.primary), json!(60))]));
        assert_eq!(opened.action, "close");
        assert!(opened.enabled);
        assert!(opened.visible);
        assert!(!opened.highlight);
    }
    #[test]
    fn action_card_and_unknown_ab_layout_are_not_power_toggles() {
        let mut config = config();
        let d = device("speaker");
        let p = panel(
            &d,
            vec![service(
                2,
                "microphone",
                vec![property(1, "mute", "bool", &["read", "write"])],
            )],
        );
        // Isolate the actual microphone type-2 item into a valid grid so this
        // exercises the unsupported action semantics, not a missing binding.
        let speaker = category_entry(&config, "speaker").unwrap();
        let item = speaker["card_items"]
            .as_array()
            .unwrap()
            .iter()
            .find(|item| item["prop_key"] == "p:microphone:mute")
            .unwrap()
            .clone();
        config.miot = json!([{"types":["speaker"],"card_items":[item],"card_instance":[{"instance_type":5,"card_layout":[[0]]}]}]);
        assert_eq!(
            select_layout(
                category_entry(&config, "speaker").unwrap(),
                &nodes(&p),
                d.spec_type.as_deref().unwrap()
            )
            .unwrap()[0]
                .item["cardType"],
            2
        );
        assert!(compile_panel(&config, &d, &p).unwrap().is_none());
        let mut entry = json!({"card_items":[{"cardType":1,"prop_key":"pi:2:1"}],"card_instance":[{"instance_type":5,"abtest":"unresolved","card_layout":[[0]]}]});
        assert!(select_layout(&entry, &nodes(&p), d.spec_type.as_deref().unwrap()).is_none());
        entry["card_instance"][0]
            .as_object_mut()
            .unwrap()
            .remove("abtest");
        assert!(select_layout(&entry, &nodes(&p), d.spec_type.as_deref().unwrap()).is_some());
    }
}
