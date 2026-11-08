//! Exact vf3 original-plugin bindings: enum 11852, state 11954, API 11999.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

pub const MODEL: &str = "yeelink.ven_fan.vf3";
pub const KEYS: [&str; 7] = [
    "power",
    "bh_mode",
    "gears",
    "swing_action",
    "swing_angle",
    "bright",
    "light_mode",
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub light_on: bool,
    pub fan_on: bool,
    pub gear: u8,
    pub swing_action: String,
    pub swing_angle: u8,
    pub brightness: u8,
    pub light_mode: String,
    pub revision: String,
}

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Fan { on: bool, gear: Option<u8> },
    Gear { gear: u8 },
    Light { on: bool },
    Swing { on: bool },
    Angle { value: u8 },
    Brightness { value: u8 },
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub report: Report,
    pub confirmed: bool,
}

pub fn validate_device(d: &Device) -> Result<()> {
    if d.model != MODEL || d.split_route.is_some() {
        return Err(AppError::invalid("此凉霸型号没有已核实的专用绑定。"));
    }
    Ok(())
}

fn number(v: &Value, min: u64, max: u64) -> Result<u8> {
    v.as_u64()
        .or_else(|| v.as_str()?.parse().ok())
        .filter(|n| (min..=max).contains(n))
        .map(|n| n as u8)
        .ok_or_else(AppError::protocol)
}

pub fn parse(d: &Device, v: Value) -> Result<Report> {
    validate_device(d)?;
    let a = v
        .as_array()
        .filter(|a| a.len() == KEYS.len())
        .ok_or_else(AppError::protocol)?;
    let light_on = match a[0].as_str() {
        Some("on") => true,
        Some("off") => false,
        _ => return Err(AppError::protocol()),
    };
    let fan_on = match a[1].as_str() {
        Some("coolwind") => true,
        Some("bh_off") => false,
        _ => return Err(AppError::protocol()),
    };
    let gear = number(&a[2], 0, 1)?;
    let swing_action = a[3]
        .as_str()
        .filter(|s| ["swing", "stop", "angle"].contains(s))
        .ok_or_else(AppError::protocol)?
        .to_owned();
    // Keep the actual observed value, including a parked motor angle, so an
    // out-of-range reading can never falsely confirm a requested angle.
    let swing_angle = number(&a[4], 0, 180)?;
    let brightness = number(&a[5], 1, 100)?;
    let light_mode = a[6]
        .as_str()
        .filter(|s| ["daylight", "nightlight"].contains(s))
        .ok_or_else(AppError::protocol)?
        .to_owned();
    let revision = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&json!([
                light_on,
                fan_on,
                gear,
                swing_action,
                swing_angle,
                brightness,
                light_mode
            ]))
            .map_err(|_| AppError::protocol())?
        )
    );
    Ok(Report {
        did: d.did.clone(),
        model: d.model.clone(),
        light_on,
        fan_on,
        gear,
        swing_action,
        swing_angle,
        brightness,
        light_mode,
        revision,
    })
}

pub async fn read(c: &Cloud, d: &Device) -> Result<Report> {
    validate_device(d)?;
    parse(d, c.ceiling_fan_rpc(d, "get_prop", json!(KEYS)).await?)
}

pub type Command = (&'static str, Value);

pub fn commands(r: &Report, change: &Change) -> Result<Vec<Command>> {
    let invalid = || AppError::invalid("此凉霸操作或取值未通过原版协议校验。");
    let command = match change {
        Change::Fan { on, gear } => {
            let g = gear.unwrap_or(r.gear);
            if g > 1 {
                return Err(invalid());
            }
            if *on && r.fan_on {
                ("set_gears_idx", json!([g]))
            } else {
                (
                    "set_bh_mode",
                    json!([
                        if *on { "coolwind" } else { "bh_off" },
                        if *on { g } else { 0 }
                    ]),
                )
            }
        }
        Change::Gear { gear } if *gear <= 1 => {
            if r.fan_on {
                ("set_gears_idx", json!([gear]))
            } else {
                ("set_bh_mode", json!(["coolwind", gear]))
            }
        }
        Change::Light { on } => (
            "set_power",
            json!([if *on { "on" } else { "off" }, "smooth", 500]),
        ),
        Change::Swing { on } if r.fan_on => {
            ("set_swing", json!([if *on { "swing" } else { "stop" }, 0]))
        }
        Change::Angle { value }
            if r.fan_on && r.swing_action != "swing" && (65..=120).contains(value) =>
        {
            ("set_swing", json!(["angle", value]))
        }
        Change::Brightness { value } if r.light_on && (1..=100).contains(value) => {
            let bright = ("set_bright", json!([value, "smooth", 500]));
            if r.light_mode == "nightlight" {
                return Ok(vec![("set_power", json!(["on", "smooth", 0, 1])), bright]);
            }
            bright
        }
        _ => return Err(invalid()),
    };
    Ok(vec![command])
}

pub fn matches(before: &Report, after: &Report, change: &Change) -> bool {
    match change {
        Change::Fan { on, gear } => {
            after.fan_on == *on && (!*on || after.gear == gear.unwrap_or(before.gear))
        }
        Change::Gear { gear } => after.fan_on && after.gear == *gear,
        Change::Light { on } => after.light_on == *on,
        Change::Swing { on } => {
            after.fan_on && after.swing_action == if *on { "swing" } else { "stop" }
        }
        Change::Angle { value } => {
            after.fan_on && after.swing_action != "swing" && after.swing_angle == *value
        }
        Change::Brightness { value } => {
            after.light_on && after.light_mode == "daylight" && after.brightness == *value
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture","model":MODEL,"name":"fixture","online":true,"roomId":"r","roomName":"fixture"})).unwrap()
    }
    fn report() -> Report {
        parse(
            &device(),
            json!(["on", "coolwind", 1, "stop", 90, 70, "daylight"]),
        )
        .unwrap()
    }
    #[test]
    fn original_gear_values_and_running_gear_rpc_are_distinct_from_bath_heaters() {
        let mut r = report();
        assert_eq!(
            commands(&r, &Change::Gear { gear: 0 }).unwrap(),
            vec![("set_gears_idx", json!([0]))]
        );
        assert_eq!(
            commands(
                &r,
                &Change::Fan {
                    on: true,
                    gear: Some(0)
                }
            )
            .unwrap(),
            vec![("set_gears_idx", json!([0]))]
        );
        r.fan_on = false;
        assert_eq!(
            commands(&r, &Change::Gear { gear: 1 }).unwrap(),
            vec![("set_bh_mode", json!(["coolwind", 1]))]
        );
        assert_eq!(
            commands(
                &r,
                &Change::Fan {
                    on: false,
                    gear: None
                }
            )
            .unwrap(),
            vec![("set_bh_mode", json!(["bh_off", 0]))]
        );
        assert_eq!(
            commands(
                &r,
                &Change::Fan {
                    on: true,
                    gear: None
                }
            )
            .unwrap(),
            vec![("set_bh_mode", json!(["coolwind", 1]))]
        );
        assert!(commands(&r, &Change::Gear { gear: 3 }).is_err());
    }
    #[test]
    fn angle_and_brightness_follow_original_enabled_states_and_ranges() {
        let mut r = report();
        assert_eq!(
            commands(&r, &Change::Angle { value: 65 }).unwrap(),
            vec![("set_swing", json!(["angle", 65]))]
        );
        assert!(commands(&r, &Change::Angle { value: 64 }).is_err());
        assert!(commands(&r, &Change::Angle { value: 121 }).is_err());
        r.swing_action = "swing".into();
        assert!(commands(&r, &Change::Angle { value: 90 }).is_err());
        r.fan_on = false;
        assert!(commands(&r, &Change::Swing { on: true }).is_err());
        assert!(commands(&r, &Change::Brightness { value: 0 }).is_err());
        assert!(commands(&r, &Change::Brightness { value: 101 }).is_err());
        r.light_mode = "nightlight".into();
        assert_eq!(
            commands(&r, &Change::Brightness { value: 45 }).unwrap(),
            vec![
                ("set_power", json!(["on", "smooth", 0, 1])),
                ("set_bright", json!([45, "smooth", 500]))
            ]
        );
        r.light_on = false;
        assert!(commands(&r, &Change::Brightness { value: 45 }).is_err());
    }
    #[test]
    fn readback_does_not_confirm_unapplied_or_partial_commands() {
        let mut r = report();
        assert!(!matches(&r, &r, &Change::Gear { gear: 0 }));
        r.brightness = 45;
        r.light_mode = "nightlight".into();
        assert!(!matches(&r, &r, &Change::Brightness { value: 45 }));
        r.light_mode = "daylight".into();
        assert!(matches(&r, &r, &Change::Brightness { value: 45 }));
        r.swing_angle = 0;
        assert!(!matches(&r, &r, &Change::Angle { value: 65 }));
    }
    #[test]
    fn parser_and_wire_changes_reject_wrong_models_bad_values_and_removed_features() {
        let d = device();
        let raw = json!(["off", "bh_off", "0", "angle", "65", "1", "nightlight"]);
        let first = parse(&d, raw.clone()).unwrap();
        let mut changed = raw.clone();
        changed[2] = json!(1);
        assert_ne!(first.revision, parse(&d, changed).unwrap().revision);
        for bad in [
            json!([]),
            json!(["off", "warmwind", 0, "stop", 65, 1, "daylight"]),
            json!(["off", "bh_off", 3, "stop", 65, 1, "daylight"]),
            json!(["off", "bh_off", 0, "stop", 65, 101, "daylight"]),
        ] {
            assert!(parse(&d, bad).is_err());
        }
        let mut other = d;
        other.model.push_str(".other");
        assert!(parse(&other, raw).is_err());
        for operation in ["temperature", "bathDelay", "lightDelay", "rpc"] {
            assert!(
                serde_json::from_value::<Change>(json!({"operation":operation,"value":30}))
                    .is_err()
            );
        }
    }
}
