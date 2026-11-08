//! Exact v13 original-plugin RPCs (12266/12323/12398); no arbitrary RPC input.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub const MODEL: &str = "yeelink.bhf_light.v13";
pub const KEYS: [&str; 8] = [
    "power",
    "bh_mode",
    "bh_cfg_delayoff",
    "bh_delayoff",
    "light_cfg_delayoff",
    "delayoff",
    "gears",
    "aim_temp",
];
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub light_on: bool,
    pub mode: String,
    pub gears: u16,
    pub bath_delay: u16,
    pub light_delay: u16,
    pub target_temperature: u8,
    pub revision: String,
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Mode {
        mode: String,
        gear: u8,
        #[serde(default)]
        enabled: Option<bool>,
    },
    Light {
        on: bool,
    },
    Stop,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub report: Report,
    pub confirmed: bool,
}
pub fn validate_device(d: &Device) -> Result<()> {
    if d.model != MODEL || d.split_route.is_some() {
        return Err(AppError::invalid("此浴霸型号没有已核实的专用绑定。"));
    }
    Ok(())
}
fn number(v: &Value, max: u64) -> Result<u64> {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| *n <= max)
        .ok_or_else(AppError::protocol)
}
pub fn parse(d: &Device, v: Value) -> Result<Report> {
    validate_device(d)?;
    let values = v
        .as_array()
        .filter(|v| v.len() == 8)
        .ok_or_else(AppError::protocol)?;
    let light_on = match values[0].as_str() {
        Some("on") => true,
        Some("off") => false,
        _ => return Err(AppError::protocol()),
    };
    let mode = values[1]
        .as_str()
        .filter(|m| {
            m.len() < 64
                && m.split('|').count() <= 2
                && m.split('|').all(|s| {
                    [
                        "bh_off",
                        "venting",
                        "coolwind",
                        "warmwind",
                        "fastdefog",
                        "defog",
                        "fastwarm",
                        "drying",
                    ]
                    .contains(&s)
                })
        })
        .ok_or_else(AppError::protocol)?
        .to_owned();
    let bath_delay = number(&values[2], 120)? as u16;
    let light_delay = number(&values[4], 90)? as u16;
    number(&values[3], 86400)?;
    number(&values[5], 86400)?;
    let gears = number(&values[6], 999)? as u16;
    let target_temperature = number(&values[7], 45)? as u8;
    if target_temperature < 25 {
        return Err(AppError::protocol());
    }
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([
                light_on,
                mode,
                gears,
                bath_delay,
                light_delay,
                target_temperature
            ]))
            .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: d.did.clone(),
        model: d.model.clone(),
        light_on,
        mode,
        gears,
        bath_delay,
        light_delay,
        target_temperature,
        revision,
    })
}
pub async fn read(c: &Cloud, d: &Device) -> Result<Report> {
    validate_device(d)?;
    parse(d, c.bath_heater_rpc(d, "get_prop", json!(KEYS)).await?)
}
pub fn gear(r: &Report, mode: &str) -> u8 {
    match mode {
        "warmwind" => (r.gears / 100) as u8,
        "coolwind" => (r.gears / 10 % 10) as u8,
        "venting" => (r.gears % 10) as u8,
        _ => 0,
    }
}
pub fn command(r: &Report, change: &Change) -> Result<(&'static str, Value)> {
    Ok(match change {
        Change::Stop => ("set_bh_mode", json!(["bh_off", 0])),
        Change::Light { on } => (
            "set_power",
            json!([if *on { "on" } else { "off" }, "smooth", 500]),
        ),
        Change::Mode {
            mode,
            gear: g,
            enabled,
        } if match mode.as_str() {
            "warmwind" => [1, 2].contains(g),
            "venting" | "coolwind" => [1, 3].contains(g),
            "fastwarm" | "fastdefog" | "defog" | "drying" => *g == 0,
            _ => false,
        } =>
        {
            let selected = enabled.map_or_else(
                || r.mode.split('|').any(|m| m == mode) && gear(r, mode) == *g,
                |on| !on,
            );
            let target = if selected {
                if r.mode.contains('|') {
                    if mode == "venting" {
                        "ventingoff"
                    } else {
                        "windoff"
                    }
                } else {
                    "bh_off"
                }
            } else {
                mode.as_str()
            };
            (
                "set_bh_mode",
                json!([target, if selected { 0 } else { *g }]),
            )
        }
        _ => return Err(AppError::invalid("此浴霸操作或取值未通过原版协议校验。")),
    })
}
pub fn matches(before: &Report, after: &Report, change: &Change) -> bool {
    match change {
        Change::Stop => after.mode == "bh_off",
        Change::Light { on } => after.light_on == *on,
        Change::Mode {
            mode,
            gear: g,
            enabled,
        } => {
            if let Some(on) = enabled {
                return after.mode.split('|').any(|m| m == mode) == *on
                    && (!on || gear(after, mode) == *g);
            }
            let selected = before.mode.split('|').any(|m| m == mode) && gear(before, mode) == *g;
            let contains = after.mode.split('|').any(|m| m == mode);
            if selected {
                !contains
            } else {
                contains && gear(after, mode) == *g
            }
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn report() -> Report {
        Report {
            did: "fixture".into(),
            model: MODEL.into(),
            light_on: true,
            mode: "warmwind|venting".into(),
            gears: 213,
            bath_delay: 0,
            light_delay: 0,
            target_temperature: 25,
            revision: "fixture".into(),
        }
    }
    #[test]
    fn mode_gear_and_same_selection_follow_original_component() {
        let r = report();
        assert_eq!(
            command(
                &r,
                &Change::Mode {
                    mode: "venting".into(),
                    gear: 3,
                    enabled: None
                }
            )
            .unwrap()
            .1,
            json!(["ventingoff", 0])
        );
        assert_eq!(
            command(
                &r,
                &Change::Mode {
                    mode: "warmwind".into(),
                    gear: 2,
                    enabled: None
                }
            )
            .unwrap()
            .1,
            json!(["windoff", 0])
        );
        assert!(command(
            &r,
            &Change::Mode {
                mode: "venting".into(),
                gear: 2,
                enabled: None
            }
        )
        .is_err());
    }
    #[test]
    fn absolute_mode_intents_never_toggle_a_newer_desired_state() {
        let r = report();
        let on = Change::Mode {
            mode: "warmwind".into(),
            gear: 2,
            enabled: Some(true),
        };
        let off = Change::Mode {
            mode: "warmwind".into(),
            gear: 2,
            enabled: Some(false),
        };
        assert_eq!(command(&r, &on).unwrap().1, json!(["warmwind", 2]));
        assert!(matches(&r, &r, &on));
        assert!(!matches(&r, &r, &off));
        let mut after = r.clone();
        after.mode = "venting".into();
        assert!(matches(&r, &after, &off));
        // The state layer skips the RPC when this absolute intent is satisfied.
        assert!(matches(&after, &after, &off));
        let legacy: Change =
            serde_json::from_value(json!({"operation":"mode","mode":"warmwind","gear":2})).unwrap();
        assert_eq!(command(&r, &legacy).unwrap().1, json!(["windoff", 0]));
    }
    #[test]
    fn desktop_commands_reject_removed_temperature_and_delay_operations() {
        for removed in [
            json!({"operation":"temperature","value":30}),
            json!({"operation":"bathDelay","minutes":15}),
            json!({"operation":"lightDelay","minutes":15}),
        ] {
            assert!(serde_json::from_value::<Change>(removed).is_err());
        }
    }
    #[test]
    fn status_parsing_rejects_wrong_models_and_bad_ranges_and_ignores_countdown_changes_in_revision(
    ) {
        let device: Device = serde_json::from_value(
            json!({"did":"fixture","model":MODEL,"name":"fixture","online":true,"roomId":"r","roomName":"fixture"}),
        )
        .unwrap();
        let raw = json!(["off", "bh_off", "0", 0, 0, "0", 111, "25"]);
        let first = parse(&device, raw.clone()).unwrap();
        let mut changed = raw.clone();
        changed[3] = json!(30);
        let second = parse(&device, changed).unwrap();
        assert_eq!(first.revision, second.revision);
        for bad in [
            json!(["off", "unknown", 0, 0, 0, 0, 111, 25]),
            json!(["off", "bh_off", 0, 0, 0, 0, 111, 99]),
            json!([]),
        ] {
            assert!(parse(&device, bad).is_err());
        }
        let mut other = device;
        other.model = "yeelink.bhf_light.v13.extra".into();
        assert!(parse(&other, raw).is_err());
    }
}
