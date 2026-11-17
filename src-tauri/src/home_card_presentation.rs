//! Audited APK main-card templates. Only the bound, server-selected controls
//! are exported; renderer requests never carry raw MIoT addresses.
use super::*;
use sha2::{Digest, Sha256};
use std::sync::atomic::Ordering;
use std::time::Instant;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardPresentation {
    pub did: String,
    pub template_id: String,
    pub revision: u64,
    pub header_control: Option<String>,
    pub rows: Vec<Vec<String>>,
    pub controls: Vec<CardControl>,
    pub projections: Vec<CardProjection>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardProjection {
    pub effects: Vec<StatusEffect>,
    pub control_id: String,
    pub value: Value,
    pub controls: Vec<CardProjectedControl>,
}
#[derive(Clone, Debug, Serialize)]
pub struct CardProjectedControl {
    pub id: String,
    pub enabled: bool,
    pub value: Option<Value>,
    pub label: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardControl {
    pub field_id: String,
    pub id: String,
    pub kind: String,
    pub label: String,
    pub value: Option<Value>,
    pub state: Option<String>,
    pub enabled: bool,
    pub reason: Option<String>,
    pub options: Vec<CardOption>,
    pub range: Option<CardRange>,
}
#[derive(Clone, Debug, Serialize)]
pub struct CardOption {
    pub label: String,
    pub value: Value,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatusEffect {
    pub field_id: String,
    pub value: Value,
}
#[derive(Clone, Debug, Serialize)]
pub struct CardRange {
    pub min: f64,
    pub max: f64,
    pub step: f64,
    pub unit: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CardControlChange {
    pub template_id: String,
    pub control_id: String,
    pub value: Value,
    pub request_id: String,
    #[serde(default)]
    pub confirm_only: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardControlResult {
    pub sequence: u64,
    pub submitted: bool,
    pub target: Option<Value>,
    pub home_id: String,
    pub did: String,
    pub control_id: String,
    pub request_id: String,
    pub verified: bool,
    pub actual: Option<Value>,
    pub message: String,
    pub presentation: Option<HomeCardPresentation>,
    pub card: Option<HomeCardEntry>,
    pub status: Option<HomeCardStatus>,
}
pub(super) struct CachedPresentation {
    at: Instant,
    pub(super) physical: String,
    value: Option<HomeCardPresentation>,
}
pub(super) struct RequestRecord {
    at: Instant,
    signature: String,
    result: Option<Result<CardControlResult>>,
}
struct ControlPlan {
    id: String,
    item: Value,
    gate: CardPlan,
    actions: Vec<Node>,
}
struct PresentationPlan {
    template: String,
    rows: Vec<Vec<String>>,
    controls: Vec<ControlPlan>,
}
pub enum PreparedControl {
    Property(HomeCardWrite),
    Action {
        siid: u32,
        aiid: u32,
        effect: Option<HomeCardWrite>,
    },
}

fn digest(value: &impl Serialize) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).unwrap_or_default())
    )
}
fn main_entry(entry: &Value) -> Value {
    let mut entry = entry.clone();
    if let Some(items) = entry["card_items"].as_array_mut() {
        for item in items {
            if let Some(item) = item.as_object_mut() {
                item.remove("grid_extra_key");
                item.remove("grid_operation");
            }
        }
    }
    entry
}
fn compile(
    config: &ConfigBundle,
    device: &Device,
    panel: &DevicePanel,
) -> Option<PresentationPlan> {
    let urn = panel.spec_type.as_deref()?;
    if device.unsupported_reason.is_some()
        || panel.unsupported_reason.is_some()
        || device.hidden_on_home && !device.split_display_available
        || crate::capabilities::read_only_category(Some(urn))
        || !matches!(
            urn_name(urn)?,
            "light"
                | "air-conditioner"
                | "air-condition-outlet"
                | "air-purifier"
                | "vacuum"
                | "curtain"
        )
        || config
            .profiles
            .as_array()
            .into_iter()
            .flatten()
            .any(|r| array_strings(&r["models"]).any(|m| m == device.model))
    {
        return None;
    }
    let entry = main_entry(category_entry(config, urn_name(urn)?)?);
    if contains_urn(&entry["disable_type"], urn) {
        return None;
    }
    let all = nodes(panel);
    for typ in [10, 9] {
        for instance in entry["card_instance"].as_array()? {
            if instance["instance_type"] != typ
                || (typ == 10 && !contains_urn(&instance["type"], urn))
            {
                continue;
            }
            let Some(bound) = bind_layout(&entry, instance, &all, urn) else {
                continue;
            };
            let template = digest(&(
                urn,
                crate::widget_layout::device_fingerprint(device),
                &entry,
                instance,
            ));
            let controls: Option<Vec<_>> = bound
                .into_iter()
                .enumerate()
                .map(|(index, b)| compile_control(device, panel, urn, &all, b, &template, index))
                .collect();
            let Some(controls) = controls else {
                continue;
            };
            let mut offset = 0;
            let rows: Option<Vec<Vec<String>>> = instance["card_layout"]
                .as_array()?
                .iter()
                .map(|row| {
                    row.as_array()?
                        .iter()
                        .map(|_| {
                            let id = controls.get(offset)?.id.clone();
                            offset += 1;
                            Some(id)
                        })
                        .collect()
                })
                .collect();
            if let Some(rows) = rows {
                return Some(PresentationPlan {
                    template,
                    rows,
                    controls,
                });
            }
        }
    }
    None
}
fn compile_control(
    device: &Device,
    panel: &DevicePanel,
    urn: &str,
    all: &[Node],
    b: BoundItem,
    template: &str,
    index: usize,
) -> Option<ControlPlan> {
    let card_type = b.item["cardType"].as_u64()? as u32;
    if ![1, 2, 3, 4, 5, 101].contains(&card_type) {
        return None;
    }
    let primary = b.nodes.first()?.property.clone()?;
    if primary.unsupported_reason.is_some() || !primary.access.iter().any(|a| a == "read") {
        return None;
    }
    if card_type != 2
        && (!primary.access.iter().any(|a| a == "write")
            || !crate::capabilities::property_write_allowed(panel, primary.siid, primary.piid))
    {
        return None;
    }
    if b.item["prop"]["ratio"].as_f64().is_some_and(|r| r != 1.) {
        return None;
    }
    let actions: Vec<_> = b.nodes.iter().filter(|n| n.kind == 'a').cloned().collect();
    if card_type == 2 {
        if urn_name(urn) != Some("vacuum") || actions.is_empty() {
            return None;
        }
        for node in &actions {
            if !matches!(
                node.name.as_str(),
                "start-sweep"
                    | "pause-sweeping"
                    | "pause"
                    | "stop-sweeping"
                    | "start-only-sweep"
                    | "start-mop"
                    | "start-charge"
            ) {
                return None;
            }
            let action = panel
                .services
                .iter()
                .find(|s| s.siid == node.siid)?
                .actions
                .iter()
                .find(|a| a.aiid == node.iid)?;
            if !action.inputs.is_empty()
                || action.unsupported_reason.is_some()
                || !crate::capabilities::action_write_allowed(panel, node.siid, node.iid)
            {
                return None;
            }
        }
    }
    if [1, 101].contains(&card_type)
        && (power_value(&primary, true).is_none() || power_value(&primary, false).is_none())
    {
        return None;
    }
    if card_type == 3
        && primary
            .value_list
            .as_ref()
            .is_none_or(|v| v.is_empty() || v.len() > 8)
    {
        return None;
    }
    if [4, 5].contains(&card_type) {
        let r = primary.value_range.as_ref()?;
        if r.len() != 3 || !r.iter().all(|n| n.is_finite()) || r[0] >= r[1] || r[2] <= 0. {
            return None;
        }
    }
    let ops = operations(&b.item);
    let mut dependencies = vec![];
    let mut unresolved_dependency = false;
    for matcher in ops.iter().flat_map(|op| {
        ["enable_status", "disable_status"]
            .into_iter()
            .flat_map(move |k| op[k].as_array().into_iter().flatten())
    }) {
        if !matcher_applies(matcher, urn) {
            continue;
        }
        let candidates = select_nodes(all, matcher["key"].as_str().unwrap_or(""));
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
        if let Some(p) = selected
            .and_then(|n| n.property.as_ref())
            .filter(|p| p.access.iter().any(|a| a == "read"))
        {
            dependencies.push(Dependency {
                matcher: matcher.clone(),
                property: p.clone(),
            });
        } else if !candidates.is_empty() {
            unresolved_dependency = true;
        }
    }
    let id = digest(&(template, index, primary.siid, primary.piid));
    Some(ControlPlan {
        id,
        item: b.item,
        actions,
        gate: CardPlan {
            device: device.clone(),
            kind: "control",
            card_type,
            target: primary.clone(),
            primary,
            operations: ops,
            dependencies,
            unresolved_dependency,
            urn: urn.into(),
        },
    })
}
fn selected_operation<'a>(control: &'a ControlPlan, values: &Values) -> Option<&'a Value> {
    let p = &control.gate.primary;
    let actual = values.get(&key(&control.gate.device, p))?;
    let text = semantic_value(p, actual);
    control
        .gate
        .operations
        .iter()
        .find(|op| {
            op["prop_value"]
                .as_str()
                .is_some_and(|v| normalize(v) == normalize(&text))
                || array_strings(&op["prop_values"]).any(|v| normalize(v) == normalize(&text))
        })
        .or_else(|| {
            control
                .gate
                .operations
                .iter()
                .find(|op| op["prop_values"].as_array().is_some_and(Vec::is_empty))
        })
}
fn action_token(node: &Node) -> String {
    format!("{}:{}", node.service_name, node.name)
}
fn selected_action<'a>(c: &'a ControlPlan, values: &Values) -> Option<&'a Node> {
    let selector = selected_operation(c, values)?["action"].as_str()?;
    let found = select_nodes(&c.actions, selector);
    if found.len() != 1 {
        return None;
    }
    c.actions
        .iter()
        .find(|a| a.siid == found[0].siid && a.iid == found[0].iid)
}
fn label(text: &str) -> String {
    match normalize(text).replace(['-', '_'], "").as_str() {
        "auto" => "自动",
        "sleep" | "silent" => "睡眠",
        "favorite" => "最爱",
        "low" => "低档",
        "medium" => "中档",
        "high" => "高档",
        "open" => "打开",
        "pause" | "pausesweeping" => "暂停",
        "close" => "关闭",
        "cool" => "制冷",
        "heat" => "制热",
        "fan" => "送风",
        "dry" => "除湿",
        "startsweep" | "startonlysweep" => "开始清扫",
        "startmop" => "开始拖地",
        "stopsweeping" => "停止",
        "startcharge" => "回充",
        _ => text,
    }
    .into()
}
fn describe_control(c: &ControlPlan, values: &Values) -> CardControl {
    let g = &c.gate;
    let actual = values
        .get(&key(&g.device, &g.primary))
        .filter(|v| crate::spec::validate_value(&g.primary, v).is_ok());
    let action = if g.card_type == 2 {
        selected_action(c, values)
    } else {
        None
    };
    let mut options: Vec<_> = g
        .primary
        .value_list
        .as_ref()
        .into_iter()
        .flatten()
        .map(|o| CardOption {
            label: label(&o.description),
            value: o.value.clone(),
        })
        .collect();
    if let Some(sort) = c.item["desc_sort"].as_array() {
        options = sort
            .iter()
            .filter_map(|s| {
                let name = s.as_str()?;
                g.primary
                    .value_list
                    .as_ref()?
                    .iter()
                    .find(|o| normalize(&o.description) == normalize(name))
                    .map(|o| CardOption {
                        label: label(&o.description),
                        value: o.value.clone(),
                    })
            })
            .collect();
    }
    let gate = if g.unresolved_dependency
        || g.dependencies.iter().any(|d| {
            values
                .get(&key(&g.device, &d.property))
                .is_none_or(|v| crate::spec::validate_value(&d.property, v).is_err())
        }) {
        None
    } else if g.card_type == 2 {
        selected_operation(c, values).and_then(|op| operation_enabled(g, op, values))
    } else {
        g.operations.iter().try_fold(true, |allowed, op| {
            operation_enabled(g, op, values).map(|v| allowed && v)
        })
    };
    let value = if [1, 101].contains(&g.card_type) {
        actual.and_then(truth).map(Value::Bool)
    } else if g.card_type == 2 {
        action.map(|a| Value::String(action_token(a)))
    } else {
        actual.cloned()
    };
    let reason = if !g.device.online {
        Some("设备离线")
    } else if g.device.shared_read_only {
        Some("只有读取权限")
    } else if actual.is_none() {
        Some("状态未读取")
    } else if value.is_none() {
        Some("状态未读取")
    } else if gate != Some(true) {
        Some("当前状态不允许此操作")
    } else {
        None
    };
    let (kind, name) = match g.card_type {
        1 | 101 => ("toggle", "电源"),
        2 => ("action", "操作"),
        3 => ("choices", "模式"),
        4 => ("stepper", "目标温度"),
        _ => ("slider", "亮度"),
    };
    let range = if [4, 5].contains(&g.card_type) {
        g.primary.value_range.as_ref().map(|r| CardRange {
            min: r[0],
            max: r[1],
            step: c.item["param_delta"]
                .as_f64()
                .filter(|d| *d >= r[2])
                .unwrap_or(r[2]),
            unit: c.item["prop"]["prop_unit"]
                .as_str()
                .unwrap_or(if g.card_type == 4 { "℃" } else { "%" })
                .into(),
        })
    } else {
        None
    };
    CardControl {
        field_id: status::field_id(&g.primary),
        id: c.id.clone(),
        kind: kind.into(),
        label: action.map(|a| label(&a.name)).unwrap_or_else(|| {
            if g.primary.name == "fan-level" {
                "风挡".into()
            } else {
                name.into()
            }
        }),
        state: actual.map(|v| semantic_value(&g.primary, v)),
        value,
        enabled: reason.is_none(),
        reason: reason.map(str::to_owned),
        options,
        range,
    }
}
fn describe_plan(
    p: &PresentationPlan,
    values: &Values,
    did: &str,
    revision: u64,
) -> HomeCardPresentation {
    let mut rows = p.rows.clone();
    let controls: Vec<_> = p
        .controls
        .iter()
        .map(|c| describe_control(c, values))
        .collect();
    let header = rows
        .first()
        .filter(|r| r.len() == 1)
        .and_then(|r| controls.iter().find(|c| c.id == r[0] && c.kind == "toggle"))
        .map(|c| c.id.clone());
    if header.is_some() {
        rows.remove(0);
    }
    let mut projections = vec![];
    for source in &p.controls {
        let effects: Vec<_> = if [1, 101].contains(&source.gate.card_type) {
            [false, true]
                .into_iter()
                .filter_map(|v| Some((json!(v), power_value(&source.gate.primary, v)?)))
                .collect()
        } else if source.gate.card_type == 2 && describe_control(source, values).enabled {
            source
                .actions
                .iter()
                .filter_map(|a| {
                    Some((
                        json!(action_token(a)),
                        effect_value(&source.gate.primary, &a.name)?,
                    ))
                })
                .collect()
        } else {
            vec![]
        };
        for (value, effect) in effects {
            let mut projected = values.clone();
            projected.insert(key(&source.gate.device, &source.gate.primary), effect);
            projections.push(CardProjection {
                effects: vec![StatusEffect {
                    field_id: status::field_id(&source.gate.primary),
                    value: projected
                        .get(&key(&source.gate.device, &source.gate.primary))
                        .unwrap()
                        .clone(),
                }],
                control_id: source.id.clone(),
                value,
                controls: p
                    .controls
                    .iter()
                    .map(|c| {
                        let model = describe_control(c, &projected);
                        CardProjectedControl {
                            id: model.id,
                            enabled: model.enabled,
                            value: if model.kind == "action" {
                                model.value
                            } else {
                                None
                            },
                            label: model.label,
                        }
                    })
                    .collect(),
            });
        }
    }
    HomeCardPresentation {
        did: did.into(),
        template_id: p.template.clone(),
        revision,
        header_control: header,
        rows,
        controls,
        projections,
    }
}
fn effect_value(property: &Property, action: &str) -> Option<Value> {
    let names: &[&str] = match action {
        "start-sweep" | "start-only-sweep" => &["Sweeping"],
        "start-mop" => &["Mopping", "Sweeping"],
        "pause" | "pause-sweeping" => &["Paused"],
        "start-charge" => &["Go Charging", "GoCharging", "Charging"],
        "stop-sweeping" => &["Idle", "Standby"],
        _ => &[],
    };
    names.iter().find_map(|name| enum_value(property, name))
}
impl HomeCardRepository {
    pub(crate) async fn presentation_controls_for_property(
        &self,
        device: &Device,
        panel: &DevicePanel,
        siid: u32,
        piid: u32,
    ) -> Vec<String> {
        let config = self.config.lock().await.clone();
        config
            .and_then(|c| compile(&c, device, panel))
            .map(|p| {
                p.controls
                    .into_iter()
                    .filter(|c| c.gate.primary.siid == siid && c.gate.primary.piid == piid)
                    .map(|c| c.id)
                    .collect()
            })
            .unwrap_or_default()
    }
    pub async fn load_presentations(
        &self,
        cloud: Arc<Cloud>,
        specs: &SpecRepository,
        home: &str,
        devices: &[Device],
    ) -> Result<Vec<HomeCardPresentation>> {
        let _flight = self.presentation_flight.lock().await;
        let revision = self.presentation_clock.fetch_add(1, Ordering::AcqRel) + 1;
        let mut result = vec![];
        let mut plans = vec![];
        let config = self.configuration().await?;
        for device in devices {
            let cache_key = reading_key(&cloud, home, device);
            if let Some(cached) = self
                .presentation_cache
                .lock()
                .await
                .get(&cache_key)
                .filter(|c| c.at.elapsed() < Duration::from_secs(30))
            {
                result.extend(cached.value.clone());
                continue;
            }
            let declared_main = device
                .spec_type
                .as_deref()
                .and_then(urn_name)
                .and_then(|name| category_entry(&config, name))
                .is_some_and(|r| {
                    r["card_instance"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .any(|i| i["instance_type"] == 9 || i["instance_type"] == 10)
                });
            let plan = if device.spec_type.is_some() && !declared_main {
                None
            } else {
                let panel = specs.panel(device).await?;
                compile(&config, device, &panel)
            };
            plans.push((device, cache_key, plan));
        }
        let gates: Vec<_> = plans
            .iter()
            .filter_map(|(_, _, p)| p.as_ref())
            .flat_map(|p| p.controls.iter().map(|c| clone_gate(&c.gate)))
            .collect();
        let values = read_plans_strict(&cloud, &gates).await?;
        for (device, key, plan) in plans {
            let value = plan.map(|p| describe_plan(&p, &values, &device.did, revision));
            if self.presentation_clock.load(Ordering::Acquire) == revision {
                let mut cache = self.presentation_cache.lock().await;
                cache.retain(|_, c| c.at.elapsed() < Duration::from_secs(30));
                cache.insert(
                    key,
                    CachedPresentation {
                        at: Instant::now(),
                        physical: device.control_did().into(),
                        value: value.clone(),
                    },
                );
            }
            result.extend(value);
        }
        Ok(result)
    }
    pub async fn prepare_card_control(
        &self,
        cloud: &Cloud,
        specs: &SpecRepository,
        device: &Device,
        change: &CardControlChange,
    ) -> Result<PreparedControl> {
        if change.request_id.is_empty() || change.request_id.len() > 128 {
            return Err(AppError::invalid("操作标识无效。"));
        }
        let config = self.configuration().await?;
        let panel = specs.panel(device).await?;
        let plan = compile(&config, device, &panel).ok_or_else(|| AppError::stale())?;
        if plan.template != change.template_id {
            return Err(AppError::stale());
        }
        let c = plan
            .controls
            .iter()
            .find(|c| c.id == change.control_id)
            .ok_or_else(AppError::stale)?;
        if change.confirm_only {
            if c.gate.card_type == 2 {
                let action = c
                    .actions
                    .iter()
                    .find(|a| Some(action_token(a).as_str()) == change.value.as_str())
                    .ok_or_else(AppError::stale)?;
                return Ok(PreparedControl::Action {
                    siid: action.siid,
                    aiid: action.iid,
                    effect: effect_value(&c.gate.primary, &action.name).map(|value| {
                        HomeCardWrite {
                            siid: c.gate.primary.siid,
                            piid: c.gate.primary.piid,
                            value,
                        }
                    }),
                });
            }
            return Ok(PreparedControl::Property(property_write(
                c,
                &describe_control(c, &Values::new()),
                &change.value,
            )?));
        }
        let mut values = read_plans(
            cloud,
            &plan
                .controls
                .iter()
                .map(|c| clone_gate(&c.gate))
                .collect::<Vec<_>>(),
        )
        .await?;
        if !change.confirm_only {
            for target in crate::state::ui_control::targets().await {
                for control in &plan.controls {
                    for property in std::iter::once(&control.gate.primary)
                        .chain(control.gate.dependencies.iter().map(|d| &d.property))
                    {
                        if property.siid == target.siid
                            && property.piid == target.piid
                            && (property.name == "on"
                                || control.gate.card_type == 2
                                    && describe_control(control, &values).enabled)
                            && crate::spec::validate_value(property, &target.value).is_ok()
                        {
                            values.insert(key(device, property), target.value.clone());
                        }
                    }
                }
            }
        }
        let shown = describe_control(c, &values);
        if !change.confirm_only && !shown.enabled {
            return Err(AppError::new(
                "unavailable",
                shown.reason.unwrap_or_default(),
                false,
            ));
        }
        if c.gate.card_type == 2 {
            let action = c
                .actions
                .iter()
                .find(|a| Some(action_token(a).as_str()) == change.value.as_str())
                .ok_or_else(|| AppError::invalid("动作不属于当前模板。"))?;
            if !change.confirm_only
                && selected_action(c, &values)
                    .is_none_or(|a| a.siid != action.siid || a.iid != action.iid)
            {
                return Err(AppError::stale());
            }
            return Ok(PreparedControl::Action {
                siid: action.siid,
                aiid: action.iid,
                effect: effect_value(&c.gate.primary, &action.name).map(|value| HomeCardWrite {
                    siid: c.gate.primary.siid,
                    piid: c.gate.primary.piid,
                    value,
                }),
            });
        }
        Ok(PreparedControl::Property(property_write(
            c,
            &shown,
            &change.value,
        )?))
    }
    pub async fn reserve_card_request(
        &self,
        key: &str,
        change: &CardControlChange,
    ) -> Result<Option<CardControlResult>> {
        let mut requests = self.presentation_requests.lock().await;
        requests.retain(|_, r| r.at.elapsed() < Duration::from_secs(300));
        let signature = digest(&(key, &change.template_id, &change.control_id, &change.value));
        if let Some(r) = requests.get(&change.request_id) {
            if r.signature != signature {
                return Err(AppError::invalid("操作标识已被使用。"));
            }
            return r
                .result
                .clone()
                .unwrap_or_else(|| Err(AppError::new("busy", "操作正在处理，请勿重复提交。", true)))
                .map(Some);
        }
        if requests.len() >= 256 {
            return Err(AppError::new("busy", "请稍后重试。", true));
        }
        requests.insert(
            change.request_id.clone(),
            RequestRecord {
                at: Instant::now(),
                signature,
                result: None,
            },
        );
        Ok(None)
    }
    pub async fn finish_card_request(&self, id: &str, result: Result<CardControlResult>) {
        if let Some(r) = self.presentation_requests.lock().await.get_mut(id) {
            r.result = Some(result);
        }
    }
}
fn clone_gate(g: &CardPlan) -> CardPlan {
    CardPlan {
        device: g.device.clone(),
        kind: g.kind,
        card_type: g.card_type,
        primary: g.primary.clone(),
        target: g.target.clone(),
        operations: g.operations.clone(),
        dependencies: g
            .dependencies
            .iter()
            .map(|d| Dependency {
                matcher: d.matcher.clone(),
                property: d.property.clone(),
            })
            .collect(),
        unresolved_dependency: g.unresolved_dependency,
        urn: g.urn.clone(),
    }
}
fn property_write(
    c: &ControlPlan,
    shown: &CardControl,
    requested: &Value,
) -> Result<HomeCardWrite> {
    let p = &c.gate.primary;
    let value = if [1, 101].contains(&c.gate.card_type) {
        power_value(
            p,
            requested
                .as_bool()
                .ok_or_else(|| AppError::invalid("开关值无效。"))?,
        )
        .ok_or_else(AppError::protocol)?
    } else {
        requested.clone()
    };
    if c.gate.card_type == 3 && !shown.options.iter().any(|o| o.value == value) {
        return Err(AppError::invalid("选项不属于当前模板。"));
    }
    crate::spec::validate_value(p, &value)?;
    Ok(HomeCardWrite {
        siid: p.siid,
        piid: p.piid,
        value,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ConfigBundle {
        ConfigBundle {
            fetched_at: epoch_secs(),
            miot: serde_json::from_str(include_str!("fixtures/home_card_presentations.json"))
                .unwrap(),
            profiles: json!([]),
        }
    }
    fn prop(i: u32, n: &str, format: &str, extra: Value) -> Value {
        let mut p = json!({"iid":i,"type":format!("urn:miot-spec-v2:property:{n}:00000000:fixture:1"),"description":n,"format":format,"access":["read","write","notify"]});
        for (k, v) in extra.as_object().unwrap() {
            p[k] = v.clone();
        }
        p
    }
    fn service(i: u32, n: &str, props: Vec<Value>, actions: &[&str]) -> Value {
        json!({"iid":i,"type":format!("urn:miot-spec-v2:service:{n}:00000000:fixture:1"),"description":n,"properties":props,"actions":actions.iter().enumerate().map(|(j,a)|json!({"iid":j+1,"type":format!("urn:miot-spec-v2:action:{a}:00000000:fixture:1"),"description":a,"in":[],"out":[]})).collect::<Vec<_>>()})
    }
    fn fixture(category: &str) -> (Device, DevicePanel) {
        let d:Device=serde_json::from_value(json!({"did":"mock","name":"Mock","model":"fixture.device.v1","online":true,"roomId":"room","roomName":"Room","specType":format!("urn:miot-spec-v2:device:{category}:00000000:fixture:1")})).unwrap();
        let on = prop(1, "on", "bool", json!({}));
        let props = match category {
            "light" => vec![
                on,
                prop(2, "brightness", "uint8", json!({"value-range":[1,100,1]})),
            ],
            "air-conditioner" => vec![
                on,
                prop(
                    2,
                    "target-temperature",
                    "float",
                    json!({"value-range":[16,30,0.5]}),
                ),
                prop(
                    3,
                    "mode",
                    "uint8",
                    json!({"value-list":[{"value":0,"description":"Auto"},{"value":1,"description":"Cool"},{"value":2,"description":"Fan"}]}),
                ),
            ],
            "air-purifier" => vec![
                on,
                prop(
                    2,
                    "mode",
                    "uint8",
                    json!({"value-list":[{"value":0,"description":"Auto"},{"value":1,"description":"Sleep"}]}),
                ),
                prop(
                    3,
                    "fan-level",
                    "uint8",
                    json!({"value-list":[{"value":2,"description":"Low"},{"value":4,"description":"High"}]}),
                ),
            ],
            "vacuum" => vec![prop(
                1,
                "status",
                "uint8",
                json!({"access":["read","notify"],"value-list":[{"value":0,"description":"Idle"},{"value":1,"description":"Sweeping"},{"value":2,"description":"Paused"},{"value":3,"description":"Error"}]}),
            )],
            _ => vec![prop(
                1,
                "motor-control",
                "uint8",
                json!({"value-list":[{"value":7,"description":"Open"},{"value":8,"description":"Pause"},{"value":9,"description":"Close"}]}),
            )],
        };
        let actions = if category == "vacuum" {
            vec![
                "start-sweep",
                "pause-sweeping",
                "start-charge",
                "stop-sweeping",
            ]
        } else {
            vec![]
        };
        let mut services = vec![service(2, category, props, &actions)];
        if category == "vacuum" {
            services.push(service(3, "battery", vec![], &["start-charge"]));
        }
        let p =
            crate::spec::parse_panel(&d, &json!({"type":d.spec_type,"services":services})).unwrap();
        (d, p)
    }
    fn readings(p: &PresentationPlan) -> Values {
        let mut v = Values::new();
        for c in &p.controls {
            for prop in std::iter::once(&c.gate.primary)
                .chain(c.gate.dependencies.iter().map(|d| &d.property))
            {
                let value = match prop.name.as_str() {
                    "on" => json!(true),
                    "brightness" => json!(62),
                    "target-temperature" => json!(23.5),
                    "mode" => json!(1),
                    _ => prop
                        .value_list
                        .as_ref()
                        .and_then(|l| l.first())
                        .map(|l| l.value.clone())
                        .unwrap_or(json!(0)),
                };
                v.insert(key(&c.gate.device, prop), value);
            }
        }
        v
    }
    #[test]
    fn local_power_effect_enables_dependent_controls_without_changing_observed_values() {
        for category in ["light", "air-conditioner", "air-purifier"] {
            let (d, p) = fixture(category);
            let plan = compile(&config(), &d, &p).unwrap();
            let mut values = readings(&plan);
            let power = plan
                .controls
                .iter()
                .find(|c| c.gate.primary.name == "on")
                .unwrap();
            values.insert(key(&d, &power.gate.primary), json!(false));
            let before = values.clone();
            let shown = describe_plan(&plan, &values, &d.did, 1);
            let projection = shown
                .projections
                .iter()
                .find(|p| p.control_id == power.id && p.value == json!(true))
                .unwrap();
            assert!(projection.controls.iter().all(|c| c.enabled));
            assert!(shown.controls.iter().any(|c| !c.enabled));
            assert_eq!(values, before);
        }
    }
    #[test]
    fn local_effects_preserve_readonly_restrictions_and_do_not_invent_unknown_readings() {
        let (mut d, p) = fixture("light");
        d.shared_read_only = true;
        let plan = compile(&config(), &d, &p).unwrap();
        let shown = describe_plan(&plan, &readings(&plan), &d.did, 1);
        assert!(shown
            .projections
            .iter()
            .flat_map(|p| &p.controls)
            .all(|c| !c.enabled));
        d.shared_read_only = false;
        let plan = compile(&config(), &d, &p).unwrap();
        let mut values = readings(&plan);
        values.remove(&key(&d, &plan.controls[1].gate.primary));
        let shown = describe_plan(&plan, &values, &d.did, 2);
        assert!(shown
            .projections
            .iter()
            .flat_map(|p| &p.controls)
            .filter(|c| c.id == plan.controls[1].id)
            .all(|c| !c.enabled));
    }
    #[test]
    fn vacuum_effect_has_a_bound_next_action_without_claiming_task_completion() {
        let (d, p) = fixture("vacuum");
        let plan = compile(&config(), &d, &p).unwrap();
        let shown = describe_plan(&plan, &readings(&plan), &d.did, 1);
        let effect = shown
            .projections
            .iter()
            .find(|p| p.value == json!("vacuum:start-sweep"))
            .unwrap();
        assert!(effect
            .controls
            .iter()
            .any(|c| c.value == Some(json!("vacuum:pause-sweeping")) && c.label == "暂停"));
        assert!(shown
            .controls
            .iter()
            .any(|c| c.value == Some(json!("vacuum:start-sweep"))));
    }
    #[test]
    fn main_templates_bind_all_five_device_families() {
        for (category, kinds) in [
            ("light", vec![1, 5]),
            ("air-conditioner", vec![1, 4]),
            ("air-purifier", vec![1, 3]),
            ("vacuum", vec![2, 2]),
            ("curtain", vec![3]),
        ] {
            let (d, p) = fixture(category);
            let plan = compile(&config(), &d, &p).unwrap();
            assert_eq!(
                plan.controls
                    .iter()
                    .map(|c| c.gate.card_type)
                    .collect::<Vec<_>>(),
                kinds,
                "{category}"
            );
            let shown = describe_plan(&plan, &readings(&plan), &d.did, 1);
            assert!(
                shown.controls.iter().all(|c| c.enabled),
                "{category}: {shown:?}"
            );
        }
    }
    #[test]
    fn exact_main_urn_precedes_generic_and_wrong_urn_does_not() {
        let (d, p) = fixture("light");
        let mut c = config();
        let r = c
            .miot
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|r| r["types"] == json!(["light"]))
            .unwrap();
        r["card_instance"]
            .as_array_mut()
            .unwrap()
            .push(json!({"instance_type":10,"type":[d.spec_type],"card_layout":[[2]]}));
        assert_eq!(compile(&c, &d, &p).unwrap().controls[0].gate.card_type, 5);
        let mut other = d.clone();
        other.spec_type = Some("urn:miot-spec-v2:device:light:00000000:other:1".into());
        let mut pp = p;
        pp.spec_type = other.spec_type.clone();
        assert_eq!(compile(&c, &other, &pp).unwrap().controls.len(), 2);
    }
    #[test]
    fn whole_layout_is_rejected_instead_of_partially_rendered() {
        let (d, mut p) = fixture("light");
        p.services[0].properties.retain(|p| p.name != "brightness");
        assert!(compile(&config(), &d, &p).is_none());
    }
    #[test]
    fn purifier_tries_next_complete_main_variant() {
        let (d, mut p) = fixture("air-purifier");
        p.services[0].properties.retain(|p| p.name != "mode");
        let plan = compile(&config(), &d, &p).unwrap();
        assert_eq!(plan.controls[1].gate.primary.name, "fan-level");
    }
    #[test]
    fn main_curtain_uses_motor_enum_without_grid_position_override() {
        let (d, p) = fixture("curtain");
        let plan = compile(&config(), &d, &p).unwrap();
        assert_eq!(plan.controls[0].gate.primary.name, "motor-control");
        let c = describe_control(&plan.controls[0], &readings(&plan));
        assert_eq!(
            c.options
                .iter()
                .map(|c| c.value.clone())
                .collect::<Vec<_>>(),
            vec![json!(7), json!(8), json!(9)]
        );
        assert_eq!(c.options[1].label, "暂停");
    }
    #[test]
    fn off_unknown_and_read_only_controls_stay_disabled() {
        let (d, p) = fixture("light");
        let plan = compile(&config(), &d, &p).unwrap();
        let mut v = readings(&plan);
        v.insert(key(&d, &plan.controls[0].gate.primary), json!(false));
        assert!(!describe_control(&plan.controls[1], &v).enabled);
        assert!(!describe_control(&plan.controls[0], &Values::new()).enabled);
        let mut read_only = d;
        read_only.shared_read_only = true;
        let p = compile(&config(), &read_only, &p).unwrap();
        assert!(!describe_control(&p.controls[0], &v).enabled);
    }
    #[test]
    fn range_and_choices_validate_real_spec_values() {
        let (d, p) = fixture("air-conditioner");
        let plan = compile(&config(), &d, &p).unwrap();
        let c = &plan.controls[1];
        let shown = describe_control(c, &readings(&plan));
        assert!(property_write(c, &shown, &json!(23.5)).is_ok());
        assert!(property_write(c, &shown, &json!(31)).is_err());
        assert!(property_write(c, &shown, &json!(23.2)).is_err());
        let (d, p) = fixture("curtain");
        let plan = compile(&config(), &d, &p).unwrap();
        let c = &plan.controls[0];
        let shown = describe_control(c, &readings(&plan));
        assert!(property_write(c, &shown, &json!(8)).is_ok());
        assert!(property_write(c, &shown, &json!(1)).is_err());
    }
    #[test]
    fn vacuum_action_tracks_state_and_error_gate() {
        let (d, p) = fixture("vacuum");
        let plan = compile(&config(), &d, &p).unwrap();
        let mut v = readings(&plan);
        assert_eq!(describe_control(&plan.controls[0], &v).label, "开始清扫");
        v.insert(key(&d, &plan.controls[0].gate.primary), json!(1));
        assert_eq!(describe_control(&plan.controls[0], &v).label, "暂停");
        v.insert(key(&d, &plan.controls[0].gate.primary), json!(3));
        assert!(!describe_control(&plan.controls[0], &v).enabled);
    }
    #[test]
    fn unsupported_actions_with_arguments_never_bind() {
        let (d, mut p) = fixture("vacuum");
        p.services[0].actions[0].inputs = vec![99];
        assert!(compile(&config(), &d, &p).is_none());
    }
    #[test]
    fn controls_and_template_ids_are_stable_but_change_with_bindings() {
        let (d, p) = fixture("light");
        let a = compile(&config(), &d, &p).unwrap();
        let b = compile(&config(), &d, &p).unwrap();
        assert_eq!(a.controls[0].id, b.controls[0].id);
        let mut p = p;
        p.services[0].properties[0].piid = 8;
        let c = compile(&config(), &d, &p).unwrap();
        assert_ne!(a.controls[0].id, c.controls[0].id);
    }
    #[test]
    fn unknown_action_status_and_hidden_devices_never_enable_controls() {
        let (mut d, p) = fixture("vacuum");
        let plan = compile(&config(), &d, &p).unwrap();
        let mut v = readings(&plan);
        v.insert(key(&d, &plan.controls[0].gate.primary), json!(99));
        assert!(!describe_control(&plan.controls[0], &v).enabled);
        d.hidden_on_home = true;
        assert!(compile(&config(), &d, &p).is_none());
    }
    #[tokio::test]
    async fn requests_deduplicate_in_flight_and_reject_cross_account_reuse() {
        let r = HomeCardRepository::new().unwrap();
        let change = CardControlChange {
            template_id: "t".into(),
            control_id: "c".into(),
            value: json!(true),
            request_id: "id".into(),
            confirm_only: false,
        };
        assert!(r
            .reserve_card_request("account-a", &change)
            .await
            .unwrap()
            .is_none());
        assert_eq!(
            r.reserve_card_request("account-a", &change)
                .await
                .unwrap_err()
                .kind,
            "busy"
        );
        r.finish_card_request("id", Err(AppError::new("network", "uncertain", true)))
            .await;
        assert_eq!(
            r.reserve_card_request("account-a", &change)
                .await
                .unwrap_err()
                .kind,
            "network"
        );
        assert_eq!(
            r.reserve_card_request("account-b", &change)
                .await
                .unwrap_err()
                .kind,
            "invalidInput"
        );
    }
}
