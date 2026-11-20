use super::*;
use std::collections::BTreeMap;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Ord, PartialOrd)]
#[serde(rename_all = "camelCase")]
pub(crate) enum Scenario {
    On,
    Off,
    Offline,
    Readonly,
    Missing,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase", deny_unknown_fields)]
pub(crate) enum Change {
    Property { siid: u32, piid: u32, value: Value },
    Shortcut { intent: String },
    Control { template_id: String, control_id: String, value: Value },
}

pub(crate) type ValuesByScenario = BTreeMap<Scenario, HashMap<(u32, u32), Value>>;

pub(crate) struct Config(pub(crate) ConfigBundle);

impl Config {
    pub(crate) fn load() -> Result<Self> {
        // The audited public baseline is available to logged-out previews.
        // It also drives the shared compiler regression fixtures.
        let mut miot: Vec<Value> = serde_json::from_str(include_str!("fixtures/home_card_presentations.json"))
            .map_err(|_| AppError::protocol())?;
        let basic: Vec<Value> = serde_json::from_str(include_str!("fixtures/home_cards_config.json"))
            .map_err(|_| AppError::protocol())?;
        for entry in basic {
            if !miot.iter().any(|known| known["types"] == entry["types"]) { miot.push(entry); }
        }
        Ok(Self(ConfigBundle { fetched_at: 0, miot: json!(miot), profiles: json!([]) }))
    }
}

#[derive(Serialize)]
pub(crate) struct Preview {
    device: Device,
    panel: DevicePanel,
    presentation: Option<HomeCardPresentation>,
    shortcut: Option<HomeCardEntry>,
}

fn initial_value(property: &Property, on: bool) -> Option<Value> {
    if !readable(property) { return None; }
    let value = if property.name == "on" {
        power_value(property, on)?
    } else if let Some(choices) = &property.value_list {
        choices.iter().find(|v| v.description.eq_ignore_ascii_case("Wired And Wireless"))
            .or_else(|| choices.first())?.value.clone()
    } else if let Some([min, max, step]) = property.value_range.as_deref() {
        let middle = min + (((max - min) / step) / 2.).floor() * step;
        if matches!(property.format.as_str(), "float" | "double") { json!(middle) } else { json!(middle as i64) }
    } else {
        match property.format.as_str() {
            "bool" => json!(false),
            "string" => json!("模拟值"),
            "float" | "double" => json!(0.),
            _ => json!(0),
        }
    };
    crate::spec::validate_value(property, &value).is_ok().then_some(value)
}

fn unavailable() -> AppError {
    AppError::invalid("此模拟控件当前不可用。")
}

pub(crate) fn render(
    config: &ConfigBundle, mut device: Device, mut panel: DevicePanel, scenario: Scenario,
    history: &mut ValuesByScenario, change: Option<Change>,
) -> Result<Preview> {
    device.online = scenario != Scenario::Offline;
    device.shared_read_only = scenario == Scenario::Readonly;
    let previous = history.get(&scenario);
    let mut values = Values::new();
    let mut blocked = HashSet::new();
    for service in &mut panel.services {
        for p in &mut service.properties {
            p.last_reported = None;
            if (scenario == Scenario::Missing && p.name != "on" || !device.online) && readable(p) {
                p.value = None;
                p.code = Some(-1);
                blocked.insert(key(&device, p));
            } else if let Some(value) = previous.and_then(|old| old.get(&(p.siid, p.piid)).cloned())
                .or_else(|| initial_value(p, scenario != Scenario::Off))
            {
                values.insert(key(&device, p), value.clone());
                p.value = Some(value);
                p.code = Some(0);
            }
        }
    }
    let plan = compile(config, &device, &panel);
    let shortcut = compile_panel(config, &device, &panel)?
        .or_else(|| plan.as_ref().and_then(|p| p.controls.iter().find(|c| c.gate.primary.name == "on"))
            .map(|c| clone_gate(&c.gate)));

    if let Some(change) = change {
        if !device.online || device.shared_read_only { return Err(unavailable()); }
        let target = match change {
            Change::Property { siid, piid, value } => HomeCardWrite { siid, piid, value },
            Change::Shortcut { intent } => {
                let shortcut = shortcut.as_ref().filter(|p| describe(p, &values).enabled)
                    .ok_or_else(unavailable)?;
                let value = match (shortcut.kind, intent.as_str()) {
                    ("power", "on") => power_value(&shortcut.target, true),
                    ("power", "off") => power_value(&shortcut.target, false),
                    ("curtain", "open" | "close" | "pause") => enum_value(&shortcut.target, &intent),
                    _ => None,
                }.ok_or_else(unavailable)?;
                HomeCardWrite { siid: shortcut.target.siid, piid: shortcut.target.piid, value }
            }
            Change::Control { template_id, control_id, value } => {
                let plan = plan.as_ref().filter(|p| p.template == template_id).ok_or_else(unavailable)?;
                let control = plan.controls.iter().find(|c| c.id == control_id).ok_or_else(unavailable)?;
                let shown = describe_control(control, &values);
                if !shown.enabled || blocked.contains(&key(&device, &control.gate.primary)) {
                    return Err(unavailable());
                }
                if shown.kind == "action" {
                    let action = selected_action(control, &values)
                        .filter(|a| Some(action_token(a).as_str()) == value.as_str())
                        .ok_or_else(unavailable)?;
                    let primary = &control.gate.primary;
                    let value = effect_value(primary, &action.name).ok_or_else(unavailable)?;
                    values.insert(key(&device, primary), value.clone());
                    history.entry(scenario).or_default().insert((primary.siid, primary.piid), value.clone());
                    for property in panel.services.iter_mut().flat_map(|s| &mut s.properties)
                        .filter(|p| p.siid == primary.siid && p.piid == primary.piid) {
                        property.value = Some(value.clone());
                    }
                    let presentation = Some(observed_presentation(plan, &values, &blocked, &device, 1));
                    return Ok(Preview { shortcut: shortcut.map(|p| describe(&p, &values)), device, panel, presentation });
                }
                property_write(control, &shown, &value)?
            }
        };
        let p = panel.services.iter().find(|s| s.siid == target.siid)
            .and_then(|service| service.properties.iter().find(|p| p.piid == target.piid))
            .filter(|p| p.access.iter().any(|a| a == "write") && !blocked.contains(&key(&device, p)))
            .ok_or_else(unavailable)?;
        if !crate::capabilities::property_write_allowed(&panel, target.siid, target.piid) {
            return Err(unavailable());
        }
        if p.name == "on" && crate::switch_mode::property(&panel, target.siid).is_some() {
            crate::switch_mode::validate(&panel, target.siid)?;
        }
        crate::spec::validate_value(p, &target.value)?;
        values.insert(key(&device, p), target.value.clone());
        history.entry(scenario).or_default().insert((target.siid, target.piid), target.value.clone());
        let p = panel.services.iter_mut().find(|s| s.siid == target.siid)
            .and_then(|s| s.properties.iter_mut().find(|p| p.piid == target.piid)).unwrap();
        p.value = Some(target.value);
        p.code = Some(0);
    }

    let presentation = plan.map(|plan| observed_presentation(&plan, &values, &blocked, &device, 1));
    Ok(Preview { shortcut: shortcut.map(|p| describe(&p, &values)), device, panel, presentation })
}
