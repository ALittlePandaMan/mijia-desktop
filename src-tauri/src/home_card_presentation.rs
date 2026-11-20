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
    pub observed_at: u64,
    pub header_control: Option<String>,
    pub rows: Vec<Vec<String>>,
    pub controls: Vec<CardControl>,
    pub projections: Vec<CardProjection>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PresentationUpdate {
    pub did: String,
    pub revision: u64,
    pub presentation: Option<HomeCardPresentation>,
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
    #[serde(skip_serializing_if = "Option::is_none")]
    pub appearance: Option<&'static str>,
    pub label: String,
    pub value: Option<Value>,
    pub state: Option<String>,
    pub enabled: bool,
    pub read_blocked: bool,
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
    pub confirmation: Option<CardConfirmation>,
    pub card: Option<HomeCardEntry>,
    pub status: Option<HomeCardStatus>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardConfirmation {
    pub template_id: String,
    pub revision: u64,
    pub observed_at: u64,
    pub control: CardControl,
    pub reading: Value,
}
fn observation_time() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default().as_millis() as u64
}
pub(super) struct CachedPresentation {
    at: Instant,
    pub(super) physical: String,
    update: PresentationUpdate,
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
    appearance: Option<&'static str>,
    display_label: Option<&'static str>,
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
const READING: u32 = 200;

fn supplemental_category(category: &str) -> bool {
    matches!(category, "air-conditioner" | "air-condition-outlet"
        | "fan" | "ceiling-fan" | "fresh-air" | "air-fresh" | "humidifier"
        | "dehumidifier" | "thermostat" | "airer" | "roller-shutter" | "curtain" | "speaker"
        | "switch" | "relay" | "control-panel" | "temperature-humidity-sensor" | "thermometer"
        | "weather-sensor" | "air-monitor" | "air-quality-sensor" | "water-purifier"
        | "fridge" | "refrigerator" | "washer")
}

fn has_apk_layout(config: &ConfigBundle, category: &str) -> bool {
    matches!(category, "light" | "air-conditioner" | "air-condition-outlet" | "air-purifier" | "vacuum" | "curtain")
        && category_entry(config, category).is_some_and(|entry| entry["card_instance"]
            .as_array().into_iter().flatten().any(|i| i["instance_type"] == 9 || i["instance_type"] == 10))
}

fn compile(config: &ConfigBundle, device: &Device, panel: &DevicePanel) -> Option<PresentationPlan> {
    let urn = panel.spec_type.as_deref()?;
    let category = urn_name(urn)?;
    if device.unsupported_reason.is_some() || panel.unsupported_reason.is_some()
        || device.hidden_on_home && !device.split_display_available
        || category_entry(config, category).is_some_and(|entry| contains_urn(&entry["disable_type"], urn))
        || config.profiles.as_array().into_iter().flatten()
            .any(|r| array_strings(&r["models"]).any(|m| m == device.model))
    { return None; }
    // The outlet's legacy template can select its physical relay as the header.
    // Climate shortcuts must instead target the same AC service as the detail page.
    let apk = category != "air-condition-outlet" && has_apk_layout(config, category)
        && !crate::capabilities::read_only_category(Some(urn));
    if let Some(plan) = apk.then(|| compile_apk(config, device, panel)).flatten() {
        let has_header = plan.rows.first().is_some_and(|r| r.len() == 1 && plan.controls.iter()
            .any(|c| c.id == r[0] && matches!(c.gate.card_type, 1 | 101)));
        if plan.rows.iter().skip(usize::from(has_header)).flatten().any(|id| plan.controls.iter()
            .any(|c| &c.id == id && (c.gate.card_type != 3 || describe_control(c, &Values::new()).options.len() >= 2)))
        { return Some(plan); }
    }
    supplemental_category(category).then(|| compile_supplemental(device, panel, urn, category)).flatten()
}

fn compile_apk(
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

// Desktop-authored layouts. Match standard service/property identities, not labels or model prefixes.
fn compile_supplemental(device: &Device, panel: &DevicePanel, urn: &str, category: &str) -> Option<PresentationPlan> {
    let unique = |services: &[&str], name: &str| {
        let mut fields = panel.services.iter().filter(|s| services.contains(&s.name.as_str()))
            .flat_map(|s| &s.properties).filter(|p| p.name == name && readable(p));
        let first = fields.next()?;
        fields.next().is_none().then_some(first)
    };
    let writable = |p: &Property| p.access.iter().any(|a| a == "write")
        && crate::capabilities::property_write_allowed(panel, p.siid, p.piid);
    let adjustment = |p: &Property| {
        if !writable(p) { return None; }
        if let Some(options) = &p.value_list {
            return ((2..=8).contains(&options.len()) && options.iter().enumerate().all(|(i, option)|
                !option.description.is_empty() && crate::spec::validate_value(p, &option.value).is_ok()
                && !options[..i].iter().any(|old| old.value == option.value))).then_some(3);
        }
        let [min, max, step] = p.value_range.as_deref()? else { return None; };
        let endpoint = |n: f64| if matches!(p.format.as_str(), "float" | "double") {
            json!(n)
        } else if n.fract() != 0. || step.fract() != 0. {
            Value::Null
        } else if p.format.starts_with('u') && n >= 0. {
            json!(n as u64)
        } else { json!(n as i64) };
        (min.is_finite() && max.is_finite() && step.is_finite() && min < max && *step > 0.
            && step <= &(max - min) && crate::spec::validate_value(p, &endpoint(*min)).is_ok()
            && crate::spec::validate_value(p, &endpoint(*max)).is_ok())
            .then_some(if p.name == "target-temperature" && p.unit.as_deref() == Some("celsius") { 4 } else { 5 })
    };
    let fields: Vec<_> = panel.services.iter().flat_map(|s| s.properties.iter().map(|p| {
        (&s.name, p.siid, p.piid, &p.name, &p.format, &p.access, &p.unit, &p.value_range, &p.value_list, &p.unsupported_reason)
    })).collect();
    let template = digest(&("standard-large-v1", urn, crate::widget_layout::device_fingerprint(device), fields));
    let mut controls = Vec::new();
    let mut rows = Vec::new();
    let mut make = |p: &Property, kind, title: &'static str, unit: &str, dependency: Option<(&Property, Value)>| {
        let id = digest(&(&template, p.siid, p.piid));
        let (dependencies, operations) = dependency.map_or_else(|| (vec![], vec![]), |(dep, value)| {
            let matcher = json!({"value": value});
            (vec![Dependency { matcher: matcher.clone(), property: dep.clone() }], vec![json!({"enable_status":[matcher]})])
        });
        controls.push(ControlPlan { id: id.clone(), item: json!({"prop":{"prop_unit":unit}}), actions: vec![],
            appearance: match kind {
                4 => Some("temperature"),
                5 if is_curtain_position(panel, p) => Some("curtain-position"),
                _ => None,
            },
            display_label: Some(title),
            gate: CardPlan { device: device.clone(), kind: "control", card_type: kind, primary: p.clone(),
                target: p.clone(), operations, dependencies, unresolved_dependency: false, urn: urn.into() } });
        id
    };
    if matches!(category, "switch" | "relay" | "control-panel") {
        if device.control_service_id.is_some() { return None; }
        let channels: Vec<_> = panel.services.iter().filter(|s| s.name == "switch").filter_map(|s| {
            let mut powers = s.properties.iter().filter(|p| p.name == "on");
            let p = powers.next()?;
            if powers.next().is_some() || !readable(p) || !writable(p)
                || [true, false].into_iter().any(|value| power_value(p, value).is_none()) { return None; }
            let mode = if s.properties.iter().any(|p| p.name == "mode") {
                let mode = crate::switch_mode::property(panel, s.siid).filter(|p| readable(p))?;
                let mut options = mode.value_list.as_ref()?.iter().filter(|o| o.description.eq_ignore_ascii_case("Wired And Wireless"));
                let normal = options.next()?;
                if options.next().is_some() { return None; }
                Some((mode, json!(&normal.description)))
            } else { None };
            Some((p, mode))
        }).collect();
        if !(2..=4).contains(&channels.len()) { return None; }
        rows.push(channels.into_iter().enumerate().map(|(i, (p, mode))|
            make(p, 1, ["开关 1", "开关 2", "开关 3", "开关 4"][i], "", mode)).collect());
    } else if matches!(category, "air-conditioner" | "air-condition-outlet") {
        if panel.services.iter().filter(|s| s.name == "air-conditioner").count() != 1 {
            return None;
        }
        let capabilities = crate::capabilities::resolve_device_capabilities(panel);
        let validated = |p: &Property, kind: &str| capabilities.properties.iter()
            .any(|b| b.siid == p.siid && b.piid == p.piid && b.kind == kind);
        let on = unique(&["air-conditioner"], "on")
            .filter(|p| validated(p, "power") && writable(p))?;
        let valid = |services: &[&str], name: &str, accept: fn(&Property) -> bool| {
            let p = unique(services, name).filter(|p| accept(p) && (validated(p, "range") || validated(p, "enum")))?;
            Some((p, adjustment(p)?))
        };
        let (p, kind, label) = valid(&["air-conditioner"], "target-temperature", |p| p.unit.as_deref() == Some("celsius"))
            .map(|(p, kind)| (p, kind, "目标温度"))
            .or_else(|| valid(&["air-conditioner"], "mode", |p| p.value_list.is_some()).map(|(p, kind)| (p, kind, "模式")))
            .or_else(|| [(&["fan-control"][..], "fan-level"), (&["fan-control"][..], "speed-level"), (&["air-conditioner"][..], "fan-level")]
                .into_iter().find_map(|(services, role)| valid(services, role, |_| true).map(|(p, kind)| (p, kind, "风速"))))?;
        rows.push(vec![make(on, 1, "电源", "", None)]);
        rows.push(vec![make(p, kind, label, display_unit(p), Some((on, json!(true))))]);
    } else {
        let (services, fields): (&[&str], &[(&str, &str)]) = match category {
            "fan" | "ceiling-fan" => (&["fan", "ceiling-fan", "fan-control"], &[("fan-level", "风速"), ("speed-level", "风速"), ("stepless-fan-level", "风速")]),
            "fresh-air" | "air-fresh" => (&["fresh-air", "air-fresh", "ventilator"], &[("fan-level", "风速"), ("mode", "模式")]),
            "humidifier" | "dehumidifier" => (&[category], &[("target-humidity", "目标湿度"), ("fan-level", "风速"), ("mode", "模式")]),
            "thermostat" => (&["thermostat"], &[("target-temperature", "目标温度")]),
            "airer" | "roller-shutter" => (&["airer", "roller-shutter"], &[("motor-control", "升降控制"), ("target-position", "目标位置")]),
            "curtain" => (&["curtain"], &[("motor-control", "窗帘控制"), ("target-position", "目标位置")]),
            "speaker" => (&["speaker"], &[("volume", "音量")]),
            _ => (&[], &[]),
        };
        if let Some((p, kind, title)) = fields.iter().find_map(|&(name, title)| {
            let p = unique(services, name)?;
            if name == "motor-control" && !p.value_list.as_ref().is_some_and(|options| options.iter().all(|o|
                matches!(normalize(&o.description).as_str(), "open" | "close" | "pause" | "stop" | "up" | "down"))) { return None; }
            Some((p, adjustment(p)?, title))
        }) {
            let power = unique(services, "on");
            if power.is_some_and(|p| [true, false].into_iter().any(|v| power_value(p, v).is_none())) { return None; }
            if let Some(on) = power.filter(|p| writable(p)) { rows.push(vec![make(on, 1, "电源", "", None)]); }
            rows.push(vec![make(p, kind, title, display_unit(p), power.map(|on| {
                let value = power_value(on, true).expect("checked power binding");
                (on, json!(semantic_value(on, &value)))
            }))]);
        } else {
            let sensors = ["air-monitor", "air-quality-sensor", "environment", "temperature-humidity-sensor", "thermometer", "weather-sensor"];
            let fields: &[(&[&str], &str, &str)] = match category {
                "temperature-humidity-sensor" | "thermometer" | "weather-sensor" | "air-monitor" | "air-quality-sensor" | "air-fresh" | "fresh-air" => &[
                    (&sensors, "temperature", "温度"), (&sensors, "relative-humidity", "湿度"),
                    (&sensors, "pm2.5-density", "PM2.5"), (&sensors, "co2-density", "二氧化碳"),
                ],
                "water-purifier" => &[( &["tds-sensor", "water-purifier"], "tds-in", "进水 TDS"), (&["tds-sensor", "water-purifier"], "tds-out", "出水 TDS")],
                "fridge" | "refrigerator" => &[( &["refrigerating-room", "refrigerating-chamber"], "temperature", "冷藏温度"), (&["freezing-room", "freezing-chamber"], "temperature", "冷冻温度")],
                "washer" => &[( &["washer"], "status", "洗衣状态"), (&["washer", "time"], "left-time", "剩余时间"), (&["washer", "time"], "remaining-time", "剩余时间"), (&["washer", "time"], "remaining-wash-time", "剩余时间")],
                _ => &[],
            };
            let mut seen = HashSet::new();
            let mut readings: Vec<_> = fields.iter().rev().filter_map(|&(services, name, title)| {
                let p = unique(services, name)?;
                (p.format != "string" && p.format != "bool" && seen.insert(title)).then_some((p, title))
            }).collect();
            if readings.is_empty() && matches!(category, "fridge" | "refrigerator") {
                for (description, title) in [("Freezing Chamber", "冷冻温度"), ("Refrigerating Chamber", "冷藏温度")] {
                    let mut fields = panel.services.iter().filter(|s| s.name == "fridge-chamber" && s.description == description)
                        .flat_map(|s| &s.properties).filter(|p| p.name == "temperature" && p.unit.as_deref() == Some("celsius") && readable(p));
                    if let Some(p) = fields.next().filter(|_| fields.next().is_none()) { readings.push((p, title)); }
                }
            }
            if readings.len() < 2 { return None; }
            rows.push(readings.into_iter().rev().take(3).map(|(p,title)| make(p, READING, title, display_unit(p), None)).collect());
        }
    }
    Some(PresentationPlan { template, rows, controls })
}

fn readable(p: &Property) -> bool {
    p.unsupported_reason.is_none() && p.access.iter().any(|a| a == "read")
}

fn display_unit(p: &Property) -> &str {
    match p.unit.as_deref() {
        Some("celsius") => "℃", Some("percentage" | "percent") => "%", Some("minutes") => " 分钟",
        Some("seconds") => " 秒", Some("ppm") => " ppm", Some("mg/m3") => " mg/m³",
        Some("microgram-per-cubic-meter") => " μg/m³", _ if matches!(p.name.as_str(), "tds-in" | "tds-out") => " ppm", _ => "",
    }
}
fn is_curtain_position(panel: &DevicePanel, p: &Property) -> bool {
    p.name == "target-position" && panel.services.iter().any(|service| {
        service.name == "curtain" && service.siid == p.siid
    })
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
    let appearance = match (card_type, primary.name.as_str(), primary.unit.as_deref()) {
        (4, "target-temperature", Some("celsius")) => Some("temperature"),
        (5, "target-position", _) if is_curtain_position(panel, &primary) => Some("curtain-position"),
        (5, "brightness", Some("percentage" | "percent") | None) if urn_name(urn) == Some("light") => {
            let mut colors = panel.services.iter().flat_map(|service| &service.properties)
                .filter(|p| p.siid == primary.siid && p.name == "color");
            let rgb = colors.next().is_some_and(|p| p.format == "uint32"
                    && p.unit.as_deref() == Some("rgb") && p.unsupported_reason.is_none()
                    && p.access.iter().any(|a| a == "read") && p.value_list.is_none()
                    && p.value_range.as_deref() == Some(&[0., 16_777_215., 1.][..]))
                && colors.next().is_none();
            Some(if rgb { "rgb-brightness" } else { "white-brightness" })
        }
        _ => None,
    };
    let id = digest(&(template, index, primary.siid, primary.piid));
    Some(ControlPlan {
        id,
        item: b.item,
        actions,
        appearance,
        display_label: None,
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
        .filter(|v| (g.card_type != READING || g.device.online) && crate::spec::validate_value(&g.primary, v).is_ok());
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
    let reason = if g.card_type == READING {
        None
    } else if !g.device.online {
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
        READING => ("reading", "读数"),
        _ if c.appearance == Some("curtain-position") => ("slider", "目标位置"),
        _ => ("slider", "亮度"),
    };
    let range = if [4, 5].contains(&g.card_type) {
        g.primary.value_range.as_ref().map(|r| CardRange {
            min: r[0],
            max: r[1],
            step: if c.appearance.is_some() { r[2] } else { c.item["param_delta"]
                .as_f64()
                .filter(|d| *d >= r[2])
                .unwrap_or(r[2]) },
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
        appearance: c.appearance,
        label: c.display_label.map(str::to_owned).or_else(|| action.map(|a| label(&a.name))).unwrap_or_else(|| {
            if g.primary.name == "fan-level" {
                "风挡".into()
            } else {
                name.into()
            }
        }),
        state: actual.map(|v| {
            let text = semantic_value(&g.primary, v);
            if g.card_type == READING { format!("{}{}", label(&text), display_unit(&g.primary)) } else { text }
        }),
        value,
        enabled: g.card_type != READING && reason.is_none(),
        read_blocked: !g.device.online || (g.device.shared_read_only && g.card_type != READING),
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
        observed_at: observation_time(),
        header_control: header,
        rows,
        controls,
        projections,
    }
}
fn observed_presentation(
    plan: &PresentationPlan, values: &Values, blocked: &HashSet<(String, u32, u32)>,
    device: &Device, revision: u64,
) -> HomeCardPresentation {
    let mut shown = describe_plan(plan, values, &device.did, revision);
    for (control, bound) in shown.controls.iter_mut().zip(&plan.controls) {
        if blocked.contains(&key(device, &bound.gate.primary)) {
            control.value = None;
            control.state = None;
            control.read_blocked = true;
            control.enabled = false;
        }
    }
    shown
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
    pub(crate) async fn has_large_layout(&self, specs: &SpecRepository, device: &Device) -> Result<bool> {
        if device.spec_type.as_deref().and_then(urn_name).is_some_and(|name|
            !supplemental_category(name) && !matches!(name, "light" | "air-conditioner" | "air-condition-outlet" | "air-purifier" | "vacuum"))
        { return Ok(false); }
        let config = self.configuration().await?;
        let panel = specs.panel(device).await?;
        Ok(compile(&config, device, &panel).is_some())
    }
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
    ) -> Result<Vec<PresentationUpdate>> {
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
                result.push(cached.update.clone());
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
            let supplemental = device.spec_type.as_deref().and_then(urn_name).is_some_and(supplemental_category);
            let plan = if device.spec_type.is_some() && !declared_main && !supplemental {
                None
            } else {
                let panel = match specs.panel(device).await {
                    Ok(panel) => panel,
                    Err(error) if !matches!(error.kind.as_str(), "authExpired" | "staleContext") => continue,
                    Err(error) => return Err(error),
                };
                compile(&config, device, &panel)
            };
            plans.push((device, cache_key, plan));
        }
        let gates: Vec<_> = plans
            .iter()
            .filter_map(|(_, _, p)| p.as_ref())
            .flat_map(|p| p.controls.iter().map(|c| clone_gate(&c.gate)))
            .collect();
        let (seen, params) = plan_read_params(&gates);
        let rows = if params.is_empty() { vec![] } else { cloud.read_observed(home, params).await? };
        let mut by_device: HashMap<String, Values> = HashMap::new();
        for (key, value) in plan_values(&seen, &rows) {
            by_device.entry(key.0.clone()).or_default().insert(key, value);
        }
        let empty = Values::new();
        let blocked: HashSet<_> = rows.iter().filter_map(|row| {
            matches!(row["code"].as_i64(), Some(-704042011 | -704010000)).then_some(())?;
            Some((id(&row["did"]), u32::try_from(row["siid"].as_u64()?).ok()?, u32::try_from(row["piid"].as_u64()?).ok()?))
        }).collect();
        let mut cache = self.presentation_cache.lock().await;
        cache.retain(|_, c| c.at.elapsed() < Duration::from_secs(30));
        for (device, cache_key, plan) in plans {
            let values = by_device.get(device.control_did()).unwrap_or(&empty);
            let complete = plan.as_ref().is_none_or(|p| !device.online || p.controls.iter().all(|c| {
                let gate = &c.gate;
                std::iter::once(&gate.primary).chain(gate.dependencies.iter().map(|d| &d.property))
                    .all(|prop| values.get(&super::key(device, prop)).is_some_and(|v| crate::spec::validate_value(prop, v).is_ok()))
            }));
            let update = PresentationUpdate {
                did: device.did.clone(), revision,
                presentation: plan.map(|p| observed_presentation(&p, values, &blocked, device, revision)),
            };
            if complete && self.presentation_clock.load(Ordering::Acquire) == revision {
                cache.insert(
                    cache_key,
                    CachedPresentation {
                        at: Instant::now(),
                        physical: device.control_did().into(),
                        update: update.clone(),
                    },
                );
            }
            result.push(update);
        }
        Ok(result)
    }
    pub async fn confirm_card_reading(
        &self, cloud: &Cloud, specs: &SpecRepository, device: &Device, change: &CardControlChange,
    ) -> Result<CardConfirmation> {
        if !device.online || device.shared_read_only {
            return Err(AppError::device(if device.online { -704010000 } else { -704042011 }));
        }
        let config = self.configuration().await?;
        let panel = specs.panel(device).await?;
        let plan = compile(&config, device, &panel)
            .filter(|p| p.template == change.template_id).ok_or_else(AppError::stale)?;
        let control = plan.controls.iter().find(|c| c.id == change.control_id).ok_or_else(AppError::stale)?;
        if control.gate.card_type == READING { return Err(AppError::stale()); }
        let primary = &control.gate.primary;
        let field = key(device, primary);
        let revision = self.presentation_clock.fetch_add(1, Ordering::AcqRel) + 1;
        let observed_at = observation_time();
        let rows = cloud.read_panel_property(&panel, primary.siid, primary.piid).await?;
        let values = plan_values(&HashSet::from([field.clone()]), &rows);
        let reading = values.get(&field).filter(|v| crate::spec::validate_value(primary, v).is_ok())
            .cloned().ok_or_else(|| AppError::new("readbackFailed", "", true))?;
        Ok(CardConfirmation {
            template_id: plan.template.clone(), revision, observed_at,
            control: describe_control(control, &values),
            reading,
        })
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
        if c.gate.card_type == READING { return Err(AppError::stale()); }
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
        let mut values = Box::pin(read_plans(cloud, &[clone_gate(&c.gate)])).await?;
        if !change.confirm_only {
            for target in crate::state::ui_control::targets().await {
                for control in std::iter::once(c) {
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
    if c.gate.card_type == READING { return Err(AppError::stale()); }
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

#[cfg(any(feature = "desktop", test))]
#[path = "developer_preview.rs"]
pub(crate) mod preview;

#[cfg(test)]
#[path = "home_card_gallery_tests.rs"]
mod tests_gallery;

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
    fn curtain_position_uses_the_shared_surface_without_synthesizing_a_header() {
        let (device, mut panel) = fixture("curtain");
        panel.services[0].properties = vec![crate::spec::parse_panel(&device, &json!({
            "type": device.spec_type,
            "services": [service(2, "curtain", vec![prop(4, "target-position", "uint8", json!({"value-range":[0,100,5],"unit":"percentage"}))], &[])]
        })).unwrap().services[0].properties[0].clone()];
        let plan = compile(&config(), &device, &panel).unwrap();
        let card = describe_plan(&plan, &readings(&plan), &device.did, 1);
        assert!(card.header_control.is_none());
        let position = &card.controls[0];
        assert_eq!(position.kind, "slider");
        assert_eq!(position.appearance, Some("curtain-position"));
        assert_eq!(position.label, "目标位置");
        let range = position.range.as_ref().unwrap();
        assert_eq!((range.min, range.max, range.step, range.unit.as_str()), (0., 100., 5., "%"));

        let (mut device, mut panel) = fixture("roller-shutter");
        let mut target = plan.controls[0].gate.primary.clone();
        target.piid = 4;
        device.model = "fixture.shutter.v1".into();
        panel.services[0].properties = vec![target];
        let plan = compile(&config(), &device, &panel).unwrap();
        assert!(plan.controls.iter().all(|control| control.appearance != Some("curtain-position")));
    }
    #[test]
    fn shared_appearance_uses_the_device_spec_and_temperature_step() {
        let (device, mut panel) = fixture("air-conditioner");
        panel.services[0].properties.iter_mut().find(|p| p.name == "target-temperature").unwrap().unit = Some("celsius".into());
        let plan = compile(&config(), &device, &panel).unwrap();
        let card = describe_plan(&plan, &readings(&plan), &device.did, 1);
        let temperature = card.controls.iter().find(|c| c.kind == "stepper").unwrap();
        assert_eq!(temperature.appearance, Some("temperature"));
        assert_eq!(temperature.range.as_ref().unwrap().step, 0.5);

        let (device, mut panel) = fixture("light");
        let plan = compile(&config(), &device, &panel).unwrap();
        assert!(plan.controls.iter().any(|c| c.appearance == Some("white-brightness")));
        let mut color = panel.services[0].properties.iter().find(|p| p.name == "brightness").unwrap().clone();
        color.piid = 3;
        color.name = "color".into();
        color.format = "uint32".into();
        color.unit = Some("rgb".into());
        color.value_range = Some(vec![0., 16_777_215., 1.]);
        panel.services[0].properties.push(color);
        let plan = compile(&config(), &device, &panel).unwrap();
        assert!(plan.controls.iter().any(|c| c.appearance == Some("rgb-brightness")));
    }
    #[tokio::test]
    async fn partial_passive_batch_preserves_other_templates_and_guards() {
        let (mut lamp, lamp_panel) = fixture("light");
        lamp.did = "lamp".into();
        let (mut climate, climate_panel) = fixture("air-conditioner");
        climate.did = "climate".into();
        let cfg = config();
        let a = compile(&cfg, &lamp, &lamp_panel).unwrap();
        let b = compile(&cfg, &climate, &climate_panel).unwrap();
        let gates: Vec<_> = a.controls.iter().chain(&b.controls).map(|c| clone_gate(&c.gate)).collect();
        let (seen, params) = plan_read_params(&gates);
        let samples: Values = readings(&a).into_iter().chain(readings(&b)).collect();
        let observed = crate::observed_properties::ObservedProperties::default();
        let rows = observed.read("fixture", params, |params| {
            let samples = &samples;
            async move {
                Ok(params.into_iter().filter(|row| !(row["did"] == "lamp" && row["piid"] == 2)).map(|mut row| {
                    let field = (id(&row["did"]), row["siid"].as_u64().unwrap() as u32, row["piid"].as_u64().unwrap() as u32);
                    row["code"] = json!(0);
                    row["value"] = samples[&field].clone();
                    row
                }).collect())
            }
        }).await.unwrap();
        let values = plan_values(&seen, &rows);
        let a = observed_presentation(&a, &values, &HashSet::new(), &lamp, 2);
        let b = observed_presentation(&b, &values, &HashSet::new(), &climate, 2);
        assert!(a.controls.iter().any(|c| c.kind == "slider" && c.value.is_none() && !c.enabled));
        assert!(a.controls.iter().any(|c| c.kind == "toggle" && c.enabled));
        assert!(b.controls.iter().any(|c| c.kind == "stepper" && c.value == Some(json!(23.5)) && c.enabled));
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
