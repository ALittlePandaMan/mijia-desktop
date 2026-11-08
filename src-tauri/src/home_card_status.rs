//! APK p49 -> SpecCardType/qxe -> c00: text items in the selected grid layout.
//! Display readings are separate from shortcut readback, including cache fallback.
use super::*;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeCardStatus {
    pub did: String,
    pub text: String,
}
pub(super) struct DisplayPlan {
    pub shortcut: Option<CardPlan>,
    device: Device,
    items: Vec<TextItem>,
    switch_states: Vec<Property>,
    language: Value,
}
struct TextItem {
    item: Value,
    gate: CardPlan,
}
pub(super) struct Readings {
    pub controls: Values,
    statuses: Values,
}

pub(super) async fn compile(
    specs: &SpecRepository,
    resources: &crate::ui_resources::UiResourceRepository,
    cloud: Arc<Cloud>,
    config: &ConfigBundle,
    device: &Device,
) -> Result<DisplayPlan> {
    let mut result = DisplayPlan {
        device: device.clone(),
        shortcut: None,
        items: vec![],
        switch_states: vec![],
        language: Value::Null,
    };
    if device.unsupported_reason.is_some()
        || config
            .profiles
            .as_array()
            .into_iter()
            .flatten()
            .any(|row| array_strings(&row["models"]).any(|model| model == device.model))
    {
        return Ok(result);
    }
    if device.spec_type.as_deref().is_some_and(|urn| {
        urn_name(urn)
            .and_then(|name| category_entry(config, name))
            .is_none_or(|entry| {
                !entry["card_instance"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .any(|instance| {
                        instance["instance_type"] == 5 || instance["instance_type"] == 6
                    })
            })
    }) {
        return Ok(result);
    }
    let panel = specs.panel(device).await?;
    result.switch_states = panel
        .services
        .iter()
        .filter(|s| s.name == "switch" && device.control_service_id.is_none_or(|id| s.siid == id))
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == "on" && p.format == "bool" && p.access.iter().any(|a| a == "read"))
        .cloned()
        .collect();
    result.shortcut = compile_panel(config, device, &panel)?;
    result.items = compile_items(config, device, &panel);
    if !result.items.is_empty() && device.online {
        if let Some(urn) = panel.spec_type {
            match resources.language(cloud, urn).await {
                Ok(language) => result.language = (*language.value).clone(),
                Err(error) if error.kind == "authExpired" => return Err(error),
                Err(_) => {}
            }
        }
    }
    Ok(result)
}
fn compile_items(config: &ConfigBundle, device: &Device, panel: &DevicePanel) -> Vec<TextItem> {
    let Some(urn) = panel.spec_type.as_deref() else {
        return vec![];
    };
    let Some(entry) = urn_name(urn).and_then(|name| category_entry(config, name)) else {
        return vec![];
    };
    let all = nodes(panel);
    let Some(bound) = select_layout(entry, &all, urn) else {
        return vec![];
    };
    bound
        .into_iter()
        .filter_map(|bound| {
            let card_type = bound.item["cardType"].as_u64()? as u32;
            let primary = bound.nodes.first()?.property.clone()?;
            if ![7, 8, 17].contains(&card_type)
                && !(card_type == 3
                    && urn_name(urn) == Some("curtain")
                    && primary.name == "current-position")
            {
                return None;
            }
            if !primary.access.iter().any(|a| a == "read") || primary.unsupported_reason.is_some() {
                return None;
            }
            let ops = operations(&bound.item);
            let mut dependencies = vec![];
            let mut unresolved = false;
            for matcher in ops.iter().flat_map(|op| {
                ["enable_status", "disable_status"]
                    .into_iter()
                    .flat_map(move |key| op[key].as_array().into_iter().flatten())
            }) {
                if !matcher_applies(matcher, urn) {
                    continue;
                }
                let candidates = select_nodes(&all, matcher["key"].as_str().unwrap_or(""));
                let contextual: Vec<_> = candidates
                    .iter()
                    .filter(|n| n.siid == primary.siid)
                    .collect();
                let candidate = if contextual.len() == 1 {
                    Some(contextual[0])
                } else if candidates.len() == 1 {
                    candidates.first()
                } else {
                    None
                };
                if let Some(property) = candidate.and_then(|n| n.property.as_ref()) {
                    if property.access.iter().any(|a| a == "read") {
                        dependencies.push(Dependency {
                            matcher: matcher.clone(),
                            property: property.clone(),
                        });
                    } else {
                        unresolved = true;
                    }
                } else if !candidates.is_empty() {
                    unresolved = true;
                }
            }
            Some(TextItem {
                item: bound.item,
                gate: CardPlan {
                    device: device.clone(),
                    kind: "text",
                    card_type,
                    primary: primary.clone(),
                    target: primary,
                    operations: ops,
                    dependencies,
                    unresolved_dependency: unresolved,
                    urn: urn.into(),
                },
            })
        })
        .collect()
}
pub(super) async fn read(cloud: &Cloud, plans: &[DisplayPlan]) -> Result<Readings> {
    // read_plans deliberately remains a live-only path for actionable shortcuts.
    let mut seen = HashSet::new();
    let mut params = vec![];
    let mut dispenser = HashMap::<String, Vec<Value>>::new();
    for plan in plans.iter().filter(|p| p.device.online) {
        for property in &plan.switch_states {
            let k = key(&plan.device, property);
            if seen.insert(k.clone()) {
                params.push(json!({"did":k.0,"siid":k.1,"piid":k.2}));
            }
        }
        for item in &plan.items {
            for property in std::iter::once(&item.gate.primary)
                .chain(item.gate.dependencies.iter().map(|d| &d.property))
            {
                let k = key(&plan.device, property);
                if seen.insert(k.clone()) {
                    let param = json!({"did":k.0,"siid":k.1,"piid":k.2});
                    if plan.device.model == crate::dispenser::MODEL {
                        dispenser.entry(k.0).or_default().push(param);
                    } else {
                        params.push(param);
                    }
                }
            }
        }
    }
    let shortcuts: Vec<_> = plans.iter().filter_map(|p| p.shortcut.as_ref()).collect();
    let controls = read_shortcuts(cloud, &shortcuts).await?;
    let mut statuses = controls.clone();
    params.retain(|p| {
        !statuses.contains_key(&(
            id(&p["did"]),
            p["siid"].as_u64().unwrap_or(0) as u32,
            p["piid"].as_u64().unwrap_or(0) as u32,
        ))
    });
    collect_rows(&mut statuses, &seen, cloud.read(params.clone()).await)?;
    for (did, params) in dispenser {
        collect_rows(
            &mut statuses,
            &seen,
            cloud.read_dispenser(&did, params).await,
        )?;
    }
    let missing: Vec<_> = params
        .into_iter()
        .filter(|p| {
            !statuses.contains_key(&(
                id(&p["did"]),
                p["siid"].as_u64().unwrap_or(0) as u32,
                p["piid"].as_u64().unwrap_or(0) as u32,
            ))
        })
        .collect();
    if !missing.is_empty() {
        collect_rows(&mut statuses, &seen, cloud.read_cached(missing).await)?;
    }
    Ok(Readings { controls, statuses })
}
async fn read_shortcuts(cloud: &Cloud, plans: &[&CardPlan]) -> Result<Values> {
    let mut seen = HashSet::new();
    let mut params = vec![];
    for plan in plans.iter().filter(|p| p.device.online) {
        for property in
            std::iter::once(&plan.primary).chain(plan.dependencies.iter().map(|d| &d.property))
        {
            let k = key(&plan.device, property);
            if seen.insert(k.clone()) {
                params.push(json!({"did":k.0,"siid":k.1,"piid":k.2}));
            }
        }
    }
    let mut values = Values::new();
    if !params.is_empty() {
        collect_rows(&mut values, &seen, cloud.read(params).await)?;
    }
    Ok(values)
}
fn collect_rows(
    values: &mut Values,
    seen: &HashSet<(String, u32, u32)>,
    result: Result<Vec<Value>>,
) -> Result<()> {
    let rows = match result {
        Ok(rows) => rows,
        Err(e) if e.kind == "authExpired" => return Err(e),
        Err(_) => return Ok(()),
    };
    for row in rows.into_iter().filter(|r| r["code"] == 0) {
        if let (Some(siid), Some(piid), Some(value)) = (
            row["siid"].as_u64().and_then(|v| u32::try_from(v).ok()),
            row["piid"].as_u64().and_then(|v| u32::try_from(v).ok()),
            row.get("value").filter(|v| !v.is_null()),
        ) {
            let k = (id(&row["did"]), siid, piid);
            if seen.contains(&k) {
                values.insert(k, value.clone());
            }
        }
    }
    Ok(())
}
pub(super) fn describe(plan: &DisplayPlan, readings: &Readings) -> Option<HomeCardStatus> {
    if !plan.device.online {
        return None;
    }
    if let Some(text) = switch_state_text(plan, readings) {
        return Some(HomeCardStatus {
            did: plan.device.did.clone(),
            text,
        });
    }
    let mut seen = HashSet::new();
    let text = plan
        .items
        .iter()
        .filter_map(|item| {
            let text = render_item(item, &plan.language, &readings.statuses)?;
            seen.insert(key(&plan.device, &item.gate.primary))
                .then_some(text)
        })
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then(|| HomeCardStatus {
        did: plan.device.did.clone(),
        text,
    })
}
// Relay mode remains a control restriction in switch_mode. The homepage
// caption reports each actual on/off channel, never a wireless/flex mode count.
fn switch_state_text(plan: &DisplayPlan, readings: &Readings) -> Option<String> {
    let values: Vec<_> = plan
        .switch_states
        .iter()
        .map(|p| {
            readings
                .statuses
                .get(&key(&plan.device, p))
                .and_then(Value::as_bool)
        })
        .collect();
    if values.is_empty() || values.iter().all(Option::is_none) {
        return None;
    }
    Some(
        values
            .into_iter()
            .map(|v| match v {
                Some(true) => "开",
                Some(false) => "关",
                None => "未读取",
            })
            .collect::<Vec<_>>()
            .join(" "),
    )
}

fn translation(language: &Value, key: &str) -> Option<String> {
    let data = language.get("data").unwrap_or(language);
    ["zh_cn", "en"].into_iter().find_map(|locale| {
        data[locale][key]
            .as_str()
            .filter(|s| !s.trim().is_empty())
            .map(str::to_owned)
    })
}
fn label(item: &TextItem, language: &Value) -> String {
    if item.item["prop_name_ignore"] == true {
        return String::new();
    }
    let p = &item.gate.primary;
    translation(
        language,
        &format!("service:{:03}:property:{:03}", p.siid, p.piid),
    )
    .unwrap_or_else(|| p.description.clone())
}
fn render_item(item: &TextItem, language: &Value, values: &Values) -> Option<String> {
    let gate = &item.gate;
    if gate.unresolved_dependency
        || gate
            .operations
            .iter()
            .any(|op| operation_enabled(gate, op, values) != Some(true))
    {
        return None;
    }
    let p = &gate.primary;
    let value = values.get(&key(&gate.device, p))?;
    let text = if p.name == "current-position" && urn_name(&gate.urn) == Some("curtain") {
        let value = value.as_f64()?;
        if !(0.0..=100.0).contains(&value) {
            return None;
        }
        if value <= 2.0 {
            "全关".into()
        } else if value >= 98.0 {
            "全开".into()
        } else {
            format!("打开{}%", value.round())
        }
    } else if gate.card_type == 8 {
        if let Some(list) = &p.value_list {
            let (index, entry) = list
                .iter()
                .enumerate()
                .find(|(_, entry)| entry.value == *value)?;
            translation(
                language,
                &format!(
                    "service:{:03}:property:{:03}:valuelist:{index:03}",
                    p.siid, p.piid
                ),
            )
            .unwrap_or_else(|| entry.description.clone())
        } else if p.format == "bool" {
            if truth(value)? {
                "开".into()
            } else {
                "关".into()
            }
        } else {
            numeric(item, value)?
        }
    } else {
        numeric(item, value)?
    };
    let label = label(item, language);
    Some(if label.is_empty() || gate.card_type == 3 {
        text
    } else {
        format!("{label} {text}")
    })
}
fn numeric(item: &TextItem, value: &Value) -> Option<String> {
    let p = &item.gate.primary;
    let mut number = value.as_f64()?;
    if !number.is_finite()
        || ((p.format.starts_with("uint") || p.format.starts_with("int")) && number.fract() != 0.0)
        || p.value_range
            .as_ref()
            .is_some_and(|r| r.len() >= 2 && (number < r[0] || number > r[1]))
    {
        return None;
    }
    let unit = p
        .unit
        .as_deref()
        .filter(|u| !u.is_empty() && *u != "none")
        .unwrap_or_else(|| item.item["prop"]["prop_unit"].as_str().unwrap_or(""));
    let unit = match unit {
        "celsius" => "℃",
        "percentage" => "%",
        "kelvin" => "K",
        "arcdegrees" => "°",
        "seconds" => "秒",
        "minutes" => "分钟",
        other => other,
    };
    if p.name == "brightness" && p.unit.as_deref() == Some("percentage") {
        if let Some(range) = p
            .value_range
            .as_ref()
            .filter(|r| r.len() >= 2 && r[1] > r[0])
        {
            number = (((number - range[0]) / (range[1] - range[0]) * 99.0) + 1.0)
                .round()
                .clamp(1.0, 100.0);
        }
    }
    let precision = item.item["prop"]["format"]
        .as_str()
        .and_then(|f| {
            f.strip_prefix("%.")?
                .strip_suffix('f')?
                .parse::<usize>()
                .ok()
        })
        .filter(|&p| p <= 4);
    let value = match precision {
        Some(precision) => format!("{number:.precision$}"),
        None => number.to_string(),
    };
    Some(format!("{value}{unit}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn config() -> ConfigBundle {
        ConfigBundle {
            fetched_at: epoch_secs(),
            miot: serde_json::from_str(include_str!("fixtures/home_status_config.json")).unwrap(),
            profiles: json!([]),
        }
    }
    fn plan(panel: DevicePanel, language: Value) -> DisplayPlan {
        let device:Device=serde_json::from_value(json!({"did":panel.did,"model":panel.model,"specType":panel.spec_type,"name":"fixture","online":true,"roomId":"r","roomName":"r"})).unwrap();
        DisplayPlan {
            switch_states: panel
                .services
                .iter()
                .filter(|s| s.name == "switch")
                .flat_map(|s| &s.properties)
                .filter(|p| {
                    p.name == "on" && p.format == "bool" && p.access.iter().any(|a| a == "read")
                })
                .cloned()
                .collect(),
            items: compile_items(&config(), &device, &panel),
            shortcut: compile_panel(&config(), &device, &panel).unwrap(),
            device,
            language,
        }
    }
    fn simple(category: &str, properties: Value) -> DevicePanel {
        let device:Device=serde_json::from_value(json!({"did":"fixture","model":"fixture.model","specType":format!("urn:miot-spec-v2:device:{category}:00000000:fixture:1"),"name":"fixture","online":true,"roomId":"r","roomName":"r"})).unwrap();
        crate::spec::parse_panel(&device,&json!({"type":device.spec_type,"services":[{"iid":2,"type":format!("urn:miot-spec-v2:service:{category}:00000000:fixture:1"),"description":category,"properties":properties}]})).unwrap()
    }
    #[test]
    fn grouped_switch_caption_reports_relays_not_wireless_modes() {
        let p = simple(
            "switch",
            json!([
                {"iid":1,"type":"urn:miot-spec-v2:property:on:00000000:fixture:1","description":"On","format":"bool","access":["read"]},
                {"iid":8,"type":"urn:miot-spec-v2:property:mode:00000000:fixture:1","description":"Mode","format":"uint8","access":["read"],"value-list":[{"value":1,"description":"Wireless"}]}
            ]),
        );
        let mut plan = plan(p, Value::Null);
        plan.shortcut = None;
        let mut second = plan.switch_states[0].clone();
        second.siid = 9;
        plan.switch_states.push(second);
        let mut third = plan.switch_states[0].clone();
        third.siid = 10;
        plan.switch_states.push(third);
        let result = describe(
            &plan,
            &readings(
                &plan,
                &[
                    (2, 1, json!(true)),
                    (9, 1, json!(false)),
                    (10, 1, json!(false)),
                    (2, 8, json!(1)),
                ],
            ),
        );
        assert_eq!(result.unwrap().text, "开 关 关");
        assert_eq!(
            switch_state_text(&plan, &readings(&plan, &[(2, 1, json!(false))])),
            Some("关 未读取 未读取".into())
        );
        assert_eq!(switch_state_text(&plan, &readings(&plan, &[])), None);
    }
    fn property(iid: u32, name: &str, format: &str, unit: &str, range: Value) -> Value {
        json!({"iid":iid,"type":format!("urn:miot-spec-v2:property:{name}:00000000:fixture:1"),"description":name,"format":format,"access":["read","notify","write"],"unit":unit,"value-range":range})
    }
    fn readings(plan: &DisplayPlan, values: &[(u32, u32, Value)]) -> Readings {
        Readings {
            controls: Values::new(),
            statuses: values
                .iter()
                .map(|(s, p, v)| ((plan.device.control_did().into(), *s, *p), v.clone()))
                .collect(),
        }
    }
    #[test]
    fn dispenser_uses_configured_ambient_sensor_and_official_translation() {
        let plan = plan(
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap(),
            json!({"zh_cn":{"service:002:property:003":"常温温度"}}),
        );
        assert_eq!(plan.items.len(), 1);
        assert!(plan.shortcut.is_none());
        assert_eq!(
            describe(
                &plan,
                &readings(&plan, &[(2, 3, json!(25)), (6, 3, json!(95))])
            )
            .unwrap()
            .text,
            "常温温度 25.0℃"
        );
        assert!(describe(&plan, &readings(&plan, &[(6, 3, json!(95))])).is_none());
    }
    #[test]
    fn router_zero_is_valid_and_bad_or_missing_values_are_omitted() {
        let panel = simple(
            "router",
            json!([property(
                3,
                "connected-device-number",
                "uint32",
                "none",
                json!([0, 256, 1])
            )]),
        );
        let mut plan = plan(
            panel,
            json!({"zh_cn":{"service:002:property:003":"连接设备数"}}),
        );
        for (value, text) in [(0, "连接设备数 0"), (35, "连接设备数 35")] {
            assert_eq!(
                describe(&plan, &readings(&plan, &[(2, 3, json!(value))]))
                    .unwrap()
                    .text,
                text
            );
        }
        for value in [
            Value::Null,
            json!(-1),
            json!(999),
            json!("35"),
            json!(false),
        ] {
            assert!(describe(&plan, &readings(&plan, &[(2, 3, value)])).is_none());
        }
        assert!(describe(&plan, &readings(&plan, &[])).is_none());
        plan.device.online = false;
        assert!(describe(&plan, &readings(&plan, &[(2, 3, json!(35))])).is_none());
    }
    #[test]
    fn fridge_uses_enum_index_translation_and_rejects_unknown_enum_values() {
        let panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/fridge-panel.json")).unwrap();
        let property = &panel
            .services
            .iter()
            .find(|s| s.name == "fridge")
            .unwrap()
            .properties
            .iter()
            .find(|p| p.name == "mode")
            .unwrap();
        let index = property
            .value_list
            .as_ref()
            .unwrap()
            .iter()
            .position(|v| v.value == json!(1))
            .unwrap();
        let (siid, piid) = (property.siid, property.piid);
        let mut labels = serde_json::Map::new();
        labels.insert(
            format!("service:{siid:03}:property:{piid:03}:valuelist:{index:03}"),
            json!("智能"),
        );
        let plan = plan(panel, json!({"zh_cn":labels}));
        assert_eq!(
            describe(&plan, &readings(&plan, &[(siid, piid, json!(1))]))
                .unwrap()
                .text,
            "智能"
        );
        assert!(describe(&plan, &readings(&plan, &[(siid, piid, json!(254))])).is_none());
    }
    #[test]
    fn sensor_formats_multiple_readings_and_keeps_missing_fields_empty() {
        let panel = simple(
            "temperature-humidity-sensor",
            json!([
                property(1, "temperature", "float", "celsius", json!([-40, 125, 0.1])),
                property(
                    2,
                    "relative-humidity",
                    "uint8",
                    "percentage",
                    json!([0, 100, 1])
                )
            ]),
        );
        let plan = plan(panel, Value::Null);
        assert_eq!(
            describe(
                &plan,
                &readings(&plan, &[(2, 1, json!(26.8)), (2, 2, json!(67))])
            )
            .unwrap()
            .text,
            "26.8℃ 67%"
        );
        assert_eq!(
            describe(&plan, &readings(&plan, &[(2, 2, json!(67))]))
                .unwrap()
                .text,
            "67%"
        );
    }
    #[test]
    fn off_or_unknown_gate_hides_brightness_and_cached_values_never_enable_shortcuts() {
        let panel = simple(
            "light",
            json!([
                property(1, "on", "bool", "none", Value::Null),
                property(2, "brightness", "uint8", "percentage", json!([1, 254, 1]))
            ]),
        );
        let plan = plan(panel, Value::Null);
        assert!(describe(&plan, &readings(&plan, &[(2, 2, json!(254))])).is_none());
        assert!(describe(
            &plan,
            &readings(&plan, &[(2, 1, json!(false)), (2, 2, json!(254))])
        )
        .is_none());
        let display = readings(&plan, &[(2, 1, json!(true)), (2, 2, json!(254))]);
        assert_eq!(describe(&plan, &display).unwrap().text, "100%");
        let shortcut = super::super::describe(plan.shortcut.as_ref().unwrap(), &display.controls);
        assert_eq!(shortcut.selected, None);
        assert!(!shortcut.enabled);
    }
    #[test]
    fn failed_and_unrequested_rows_never_become_display_values() {
        let mut values = Values::new();
        let seen = HashSet::from([("fixture".into(), 2, 3)]);
        collect_rows(
            &mut values,
            &seen,
            Ok(vec![
                json!({"did":"fixture","siid":2,"piid":3,"code":-1,"value":35}),
                json!({"did":"other","siid":2,"piid":3,"code":0,"value":88}),
            ]),
        )
        .unwrap();
        assert!(values.is_empty());
        assert!(collect_rows(&mut values, &seen, Err(AppError::auth())).is_err());
    }

    fn published(raw: &str, model: &str) -> DevicePanel {
        let raw: Value = serde_json::from_str(raw).unwrap();
        let device: Device = serde_json::from_value(json!({
            "did":"published-summary-fixture","model":model,"name":model,
            "specType":raw["type"],"online":true,"roomId":"","roomName":""
        }))
        .unwrap();
        crate::spec::parse_panel(&device, &raw).unwrap()
    }

    #[test]
    fn published_high_iid_thermometer_uses_real_temperature_and_humidity_bindings() {
        let panel = published(
            include_str!(
                "fixtures/compatibility/temperature-humidity-sensor--xiaomi.sensor_ht.minigl.json"
            ),
            "xiaomi.sensor_ht.minigl",
        );
        let plan = plan(panel, Value::Null);
        let bindings: Vec<_> = plan
            .items
            .iter()
            .map(|item| (item.gate.primary.siid, item.gate.primary.piid))
            .collect();
        assert_eq!(bindings, vec![(2, 1001), (2, 1002)]);
        let status = describe(
            &plan,
            &readings(&plan, &[(2, 1001, json!(0.0)), (2, 1002, json!(0))]),
        )
        .unwrap();
        assert_eq!(status.text, "0.0℃ 0%");
        assert!(describe(
            &plan,
            &readings(&plan, &[(2, 1, json!(28.0)), (2, 2, json!(68))])
        )
        .is_none());
    }

    #[test]
    fn published_cross_brand_router_and_dispenser_use_configured_standard_summaries() {
        let router = plan(
            published(
                include_str!("fixtures/compatibility/router--isa.router.mr01hl.json"),
                "isa.router.mr01hl",
            ),
            json!({"zh_cn":{"service:002:property:003":"连接设备数"}}),
        );
        assert_eq!(router.items.len(), 1);
        assert_eq!(
            describe(&router, &readings(&router, &[(2, 3, json!(0))]))
                .unwrap()
                .text,
            "连接设备数 0"
        );
        let dispenser = plan(
            published(
                include_str!("fixtures/compatibility/water-dispenser--yunmi.plmachine.mg2.json"),
                "yunmi.plmachine.mg2",
            ),
            json!({"zh_cn":{"service:002:property:005":"常温温度"}}),
        );
        assert_eq!(dispenser.items.len(), 1);
        assert_eq!(dispenser.items[0].gate.primary.piid, 5);
        assert_eq!(
            describe(
                &dispenser,
                &readings(&dispenser, &[(2, 5, json!(27)), (2, 6, json!(90))])
            )
            .unwrap()
            .text,
            "常温温度 27.0℃"
        );
    }

    #[test]
    fn every_published_model_summary_retains_real_readable_iids_without_model_gating() {
        let report: Value = serde_json::from_str(include_str!(
            "fixtures/regression/device-capabilities-matrix.json"
        ))
        .unwrap();
        let root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("src/fixtures/compatibility");
        let mut examined = 0;
        for row in report["records"].as_array().unwrap() {
            let raw = std::fs::read_to_string(root.join(row["file"].as_str().unwrap())).unwrap();
            let panel = published(&raw, row["model"].as_str().unwrap());
            let summary = plan(panel.clone(), Value::Null);
            for item in summary.items {
                let actual = panel
                    .services
                    .iter()
                    .flat_map(|service| &service.properties)
                    .filter(|property| {
                        property.siid == item.gate.primary.siid
                            && property.piid == item.gate.primary.piid
                    })
                    .collect::<Vec<_>>();
                assert_eq!(actual.len(), 1, "{} ambiguous summary", panel.model);
                assert_eq!(
                    actual[0].name, item.gate.primary.name,
                    "{} semantic mismatch",
                    panel.model
                );
                assert!(actual[0].access.iter().any(|access| access == "read"));
            }
            examined += 1;
        }
        assert_eq!(examined, 74);
    }
}
