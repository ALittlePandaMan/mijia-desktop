//! Radio drafts and exact full-configuration fields from rn02 modules 11789/10271.
use crate::{
    error::{AppError, Result},
    models::Device,
    router,
    router_advanced::{self as advanced, Report},
    router_wifi as wifi,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Values {
    pub on: bool,
    pub encryption: String,
    pub power: String,
    pub hidden: bool,
    pub channel: u16,
    pub bandwidth: u16,
}
#[derive(Clone, Serialize)]
pub struct Channel {
    pub value: u16,
    pub widths: Vec<u16>,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rules {
    pub encryptions: Vec<String>,
    pub can_switch: bool,
    pub channel_visible: bool,
    pub remind_2g: bool,
    pub mesh: bool,
    pub five_off_optimization: bool,
    pub relay_band: Option<usize>,
    pub write_reason: Option<String>,
    pub connection: crate::router_connection::Protection,
}
pub fn number(v: &Value) -> Option<u16> {
    v.as_u64().and_then(|v| v.try_into().ok()).or_else(|| {
        if v == "nil" {
            Some(0)
        } else {
            v.as_str()?.parse().ok()
        }
    })
}
pub fn channels(row: &Value) -> Vec<Channel> {
    row["available_channels"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    Some(Channel {
                        value: number(&r["c"])?,
                        widths: r["b"].as_array()?.iter().filter_map(number).collect(),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}
pub fn rules(s: &wifi::Snapshot) -> Rules {
    let modern = s.info.iter().all(|r| r["available_channels"].is_array());
    let reason = s
        .report
        .write_reason
        .clone()
        .or_else(|| (!modern).then(|| "固件未提供可核对的信道和带宽组合。".into()));
    let strong = advanced::has(s, "Wi-Fi_6") || advanced::has(s, "wpa3");
    Rules {
        encryptions: if strong {
            vec!["ccmp", "psk2+ccmp", "psk2", "mixed-psk", "none"]
        } else {
            vec!["psk2", "mixed-psk", "none"]
        }
        .into_iter()
        .map(String::from)
        .collect(),
        can_switch: advanced::has(s, "Mesh_mode_unity_WiFi_switch"),
        channel_visible: number(&s.router_info["work_mode"]) != Some(1),
        remind_2g: advanced::has(s, "2GChannelRemind"),
        mesh: ["MiMesh", "mimesh_rom", "easymesh"]
            .iter()
            .any(|key| advanced::has(s, key)),
        five_off_optimization: advanced::has(s, "5gwifi_off_optimization"),
        relay_band: if number(&s.router_info["work_mode"]) == Some(1) {
            number(&s.router_info["active_apcli_mode"])
                .filter(|n| (1..=3).contains(n))
                .map(|n| usize::from(n - 1))
        } else {
            None
        },
        write_reason: reason,
        connection: crate::router_connection::Protection::unchecked(),
    }
}
pub fn values(r: &Report) -> Option<Vec<Values>> {
    r.bands
        .iter()
        .map(|b| {
            Some(Values {
                on: b.on,
                encryption: if b.encryption == "owe" {
                    "none".into()
                } else {
                    b.encryption.clone()
                },
                power: b.power.clone(),
                hidden: b.hidden,
                channel: b.channel?,
                bandwidth: b.bandwidth?,
            })
        })
        .collect()
}
pub fn matches(r: &Report, target: &[Values]) -> bool {
    values(r).is_some_and(|actual| {
        actual.len() == target.len() && actual.iter().zip(target).all(|(a, b)| a == b)
    })
}
pub fn validate(r: &Report, w: &wifi::WifiChange, bands: &[Values]) -> Result<()> {
    wifi::valid_change(w)?;
    let rules = &r.radio;
    if let Some(reason) = &rules.write_reason {
        return Err(AppError::new("unsupported", reason, false));
    }
    let old = values(r).ok_or_else(AppError::protocol)?;
    if bands.len() != 2 || old.len() != 2 {
        return Err(AppError::invalid("频段配置数量无效。"));
    }
    for (i, (b, old)) in bands.iter().zip(&old).enumerate() {
        if !rules.encryptions.contains(&b.encryption)
            || !["max", "mid", "min"].contains(&b.power.as_str())
        {
            return Err(AppError::invalid("加密或信号强度选项无效。"));
        }
        if !rules.can_switch && b.on != old.on {
            return Err(AppError::new(
                "unsupported",
                "Mesh模式下暂不支持此功能。",
                false,
            ));
        }
        if !b.on && old.on && rules.connection.protected_bands.contains(&i) {
            return Err(AppError::new(
                "currentNetwork",
                "当前电脑连接的Wi-Fi无法关闭，否则应用将与路由器失去联系。",
                false,
            ));
        }
        if !b.on
            && old.on
            && rules
                .relay_band
                .is_some_and(|up| w.values.merged || up == i)
        {
            return Err(AppError::invalid("关闭此Wi-Fi会中断无线中继连接。"));
        }
        if b.channel != old.channel || b.bandwidth != old.bandwidth {
            if !rules.channel_visible
                || i == 0 && advanced::value(r, advanced::Field::ChannelAdj) == Some(true)
            {
                return Err(AppError::invalid("当前模式不允许修改此频段的信道和带宽。"));
            }
            let row = r.bands[i]
                .channels
                .iter()
                .find(|v| v.value == b.channel)
                .ok_or_else(|| AppError::invalid("信道不在固件提供的可用列表内。"))?;
            if b.bandwidth != 0 && !row.widths.contains(&b.bandwidth) {
                return Err(AppError::invalid("当前信道不支持所选带宽。"));
            }
        }
    }
    if w.values.merged {
        // Only these fields are synchronized by bsdOnChangeState; signal/channel/width remain per-band.
        let on_changed = bands.iter().zip(&old).any(|(a, b)| a.on != b.on);
        let hidden_changed = bands.iter().zip(&old).any(|(a, b)| a.hidden != b.hidden);
        let encryption_changed = bands
            .iter()
            .zip(&old)
            .any(|(a, b)| a.encryption != b.encryption);
        for b in &bands[1..] {
            if on_changed && b.on != bands[0].on
                || hidden_changed && b.hidden != bands[0].hidden
                || encryption_changed && b.encryption != bands[0].encryption
            {
                return Err(AppError::invalid(
                    "多频合一时开启、加密和隐藏设置必须同步。",
                ));
            }
        }
    }
    let mut current = r.wifi.clone();
    current.enabled = vec![true; 2];
    current.encrypted = bands.iter().map(|b| b.encryption != "none").collect();
    for i in 0..2 {
        if !current.encrypted[i] {
            current.values.bands[i].password = w.values.bands[i].password.clone();
        }
    }
    wifi::validate(&current, &w.values)
}
pub fn payload(
    s: &advanced::Snapshot,
    device: &Device,
    w: &wifi::WifiChange,
    bands: &[Values],
    dfs: bool,
) -> Result<Value> {
    validate(&s.report, w, bands)?;
    if s.report.wifi.revision != w.baseline {
        return Err(AppError::new(
            "conflict",
            "Wi-Fi配置已变化，请重新进入页面。",
            false,
        ));
    }
    let mut p = s.wifi.params.clone();
    p.remove("ver");
    p.insert("deviceId".into(), json!(router::gateway_id(device)?));
    p.insert("bsd".into(), json!(u8::from(w.values.merged)));
    p.insert("user_confirm".into(), json!(u8::from(dfs)));
    let old = values(&s.report).ok_or_else(AppError::protocol)?;
    for (i, (b, names)) in bands.iter().zip(&w.values.bands).enumerate() {
        let n = i + 1;
        for (k, v) in [
            ("on", json!(u8::from(b.on))),
            ("encryption", json!(b.encryption)),
            ("txpwr", json!(b.power)),
            ("hidden", json!(u8::from(b.hidden))),
            ("channel", json!(b.channel.to_string())),
            ("bandwidth", json!(b.bandwidth.to_string())),
            ("ssid", json!(names.ssid)),
            (
                "pwd",
                json!(if b.encryption == "none" {
                    ""
                } else {
                    &names.password
                }),
            ),
        ] {
            let unchanged = match k {
                "on" => b.on == old[i].on,
                "hidden" => b.hidden == old[i].hidden,
                "channel" => b.channel == old[i].channel,
                "bandwidth" => b.bandwidth == old[i].bandwidth,
                _ => false,
            };
            if unchanged && p.contains_key(&format!("{k}{n}")) {
                continue;
            }
            p.insert(format!("{k}{n}"), v);
        }
    }
    Ok(json!({"method":"GET","params":p}))
}
