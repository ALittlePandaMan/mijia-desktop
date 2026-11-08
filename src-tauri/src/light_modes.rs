//! Read-only, model-specific slots observed in the installed wyra01 plugin.
//!
//! The public MIoT instance omits service 4. These addresses come from the
//! separately verified plugin and direct datasource=2 read, not generic MIoT
//! metadata. This module never sends the plugin's 4.14 trigger or any write.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{epoch_secs, Device},
};
use serde::Serialize;
use serde_json::{json, Value};

const MODEL: &str = "yeelink.light.wyra01";

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightModeReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub slots: Vec<LightModeSlot>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LightModeSlot {
    pub index: u8,
    pub mode: u8,
    pub brightness: Option<u8>,
    pub color: Option<u32>,
    pub temperature: Option<u32>,
    pub reason: Option<String>,
}

pub(crate) fn validate_device(device: &Device) -> Result<()> {
    if device.model != MODEL {
        return Err(AppError::new(
            "unsupported",
            "当前型号尚无经过核对的灯光模式槽位适配。",
            false,
        ));
    }
    if device.split_route.is_some() || device.unsupported_reason.is_some() {
        return Err(AppError::new(
            "unsupported",
            "此设备的当前控制路由不支持读取灯光模式槽位。",
            false,
        ));
    }
    Ok(())
}

fn addresses(device: &Device) -> Vec<Value> {
    (5..=9)
        .map(|piid| json!({"did":device.did,"siid":4,"piid":piid}))
        .collect()
}

fn word(rows: &[Value], did: &str, piid: u64) -> std::result::Result<u32, String> {
    let mut matching = rows.iter().filter(|row| {
        row.get("siid").and_then(Value::as_u64) == Some(4)
            && row.get("piid").and_then(Value::as_u64) == Some(piid)
    });
    let row = matching
        .next()
        .ok_or_else(|| format!("未返回模式属性 4.{piid}。"))?;
    if matching.next().is_some() {
        return Err(format!("模式属性 4.{piid} 返回重复结果，暂无法确认。"));
    }
    if row.get("did").and_then(Value::as_str) != Some(did) {
        return Err(format!("模式属性 4.{piid} 的设备标识不一致。"));
    }
    match row.get("code").and_then(Value::as_i64) {
        Some(0) => {}
        Some(code) => return Err(format!("模式属性 4.{piid} 读取失败（代码 {code}）。")),
        None => return Err(format!("模式属性 4.{piid} 缺少有效读取状态。")),
    }
    row.get("value")
        .and_then(Value::as_u64)
        .and_then(|value| u32::try_from(value).ok())
        .ok_or_else(|| format!("模式属性 4.{piid} 不是有效的 uint32 数据。"))
}

fn decode_slot(
    index: u8,
    packed: std::result::Result<u32, String>,
    shared: &std::result::Result<u32, String>,
) -> LightModeSlot {
    let mut slot = LightModeSlot {
        index,
        mode: 11 + index,
        brightness: None,
        color: None,
        temperature: None,
        reason: None,
    };
    let decoded = (|| {
        let packed = packed?;
        let shared = shared.as_ref().map_err(Clone::clone)?;
        let brightness = (packed & 0xff) as u8;
        if brightness > 100 {
            return Err("模式亮度超出 0–100 的有效范围。".into());
        }
        let ct = ((shared >> (8 * u32::from(index))) & 0xff) as u8;
        let percent = ct & 0x7f;
        if percent > 100 {
            return Err("模式色温百分比超出 0–100 的有效范围。".into());
        }
        let is_temperature = ct & 0x80 != 0;
        Ok((brightness, packed >> 8, percent, is_temperature))
    })();
    match decoded {
        Ok((brightness, color, percent, is_temperature)) => {
            slot.brightness = Some(brightness);
            if is_temperature {
                slot.temperature = Some(2700 + u32::from(percent) * 38);
            } else {
                slot.color = Some(color);
            }
        }
        Err(reason) => slot.reason = Some(reason),
    }
    slot
}

fn parse(device: &Device, rows: &[Value], fetched_at: u64) -> LightModeReport {
    let shared = word(rows, &device.did, 9);
    LightModeReport {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at,
        slots: (0..4)
            .map(|index| {
                decode_slot(
                    index,
                    word(rows, &device.did, 5 + u64::from(index)),
                    &shared,
                )
            })
            .collect(),
    }
}

pub(crate) async fn load(cloud: &Cloud, device: &Device) -> Result<LightModeReport> {
    validate_device(device)?;
    let rows = cloud.read(addresses(device)).await?;
    Ok(parse(device, &rows, epoch_secs()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn device() -> Device {
        serde_json::from_value(json!({
            "did":"fixture-light", "model":MODEL, "name":"light", "online":true,
            "roomId":"room", "roomName":"room"
        }))
        .unwrap()
    }

    fn rows() -> Vec<Value> {
        [0xff000064_u32, 0xffffff00, 0x12345632, 0x80000001, 0xe4b21900]
            .into_iter()
            .enumerate()
            .map(|(index, value)| {
                json!({"did":"fixture-light","siid":4,"piid":5+index,"code":0,"value":value})
            })
            .collect()
    }

    fn assert_unavailable(slot: &LightModeSlot) {
        assert!(slot.reason.as_ref().is_some_and(|r| !r.is_empty()));
        assert!(slot.brightness.is_none());
        assert!(slot.color.is_none());
        assert!(slot.temperature.is_none());
    }

    #[test]
    fn four_slots_decode_unsigned_words_rgb_ct_and_zero_brightness() {
        let report = parse(&device(), &rows(), 123);
        assert_eq!(report.fetched_at, 123);
        assert_eq!(report.slots.len(), 4);
        let slots = report.slots;
        assert_eq!(
            slots.iter().map(|s| s.mode).collect::<Vec<_>>(),
            [11, 12, 13, 14]
        );
        assert!(slots.iter().all(|s| s.reason.is_none()));
        assert_eq!(slots[0].brightness, Some(100));
        assert_eq!(slots[0].color, Some(0xff0000));
        assert_eq!(slots[0].temperature, None);
        assert_eq!(slots[1].brightness, Some(0));
        assert_eq!(slots[1].color, Some(0xffffff));
        assert_eq!(slots[2].temperature, Some(4600));
        assert_eq!(slots[2].color, None);
        assert_eq!(slots[3].brightness, Some(1));
        assert_eq!(slots[3].temperature, Some(6500));
    }

    #[test]
    fn requests_only_the_five_observed_slots_and_never_the_refresh_trigger() {
        let params = addresses(&device());
        assert_eq!(params.len(), 5);
        assert_eq!(
            params
                .iter()
                .map(|p| p["piid"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            [5, 6, 7, 8, 9]
        );
        assert!(params
            .iter()
            .all(|p| p["siid"] == 4 && p["did"] == "fixture-light"));
    }

    #[test]
    fn unsupported_model_split_route_or_rejected_mapping_are_not_adapted() {
        let mut current = device();
        assert!(validate_device(&current).is_ok());
        current.model = "other.light.v1".into();
        assert_eq!(validate_device(&current).unwrap_err().kind, "unsupported");
        current.model = MODEL.into();
        current.split_route = Some(crate::models::SplitRoute {
            parent_did: "parent".into(),
            service_iid: 2,
        });
        assert_eq!(validate_device(&current).unwrap_err().kind, "unsupported");
        current.split_route = None;
        current.unsupported_reason = Some("unresolved routing".into());
        assert_eq!(validate_device(&current).unwrap_err().kind, "unsupported");
    }

    #[test]
    fn missing_or_duplicate_slot_does_not_invalidate_the_other_slots() {
        let mut values = rows();
        values.remove(1);
        let report = parse(&device(), &values, 1);
        assert_unavailable(&report.slots[1]);
        assert_eq!(report.slots[0].color, Some(0xff0000));
        assert!(report.slots[2..].iter().all(|s| s.reason.is_none()));
        let mut values = rows();
        values.push(values[0].clone());
        let report = parse(&device(), &values, 1);
        assert_unavailable(&report.slots[0]);
        assert!(report.slots[1..].iter().all(|s| s.reason.is_none()));
    }

    #[test]
    fn invalid_shared_word_disables_every_slot_without_defaults() {
        for shared in [
            Value::Null,
            json!(-1),
            json!(4294967296_u64),
            json!(0.5),
            json!("0"),
        ] {
            let mut values = rows();
            values[4]["value"] = shared;
            assert!(parse(&device(), &values, 1).slots.iter().all(|slot| {
                assert_unavailable(slot);
                true
            }));
        }
        let mut values = rows();
        values.pop();
        assert!(parse(&device(), &values, 1)
            .slots
            .iter()
            .all(|slot| slot.reason.is_some()));
        let mut values = rows();
        values.push(values[4].clone());
        assert!(parse(&device(), &values, 1)
            .slots
            .iter()
            .all(|slot| slot.reason.is_some()));
    }

    #[test]
    fn wrong_did_failure_code_missing_code_and_non_uint32_do_not_produce_values() {
        let mutations = [
            ("did", json!("another-light")),
            ("did", Value::Null),
            ("code", json!(-704010000)),
            ("code", json!(1)),
            ("code", Value::Null),
            ("value", json!(-256)),
            ("value", json!(4294967296_u64)),
            ("value", json!(23.0)),
            ("value", json!("23")),
            ("value", json!(true)),
        ];
        for (key, value) in mutations {
            let mut values = rows();
            values[0][key] = value;
            let report = parse(&device(), &values, 1);
            assert_unavailable(&report.slots[0]);
            assert!(report.slots[1..].iter().all(|s| s.reason.is_none()));
        }
    }

    #[test]
    fn invalid_brightness_or_ct_byte_disables_only_its_corresponding_slot() {
        let mut values = rows();
        values[2]["value"] = json!(0x12345665_u32);
        let report = parse(&device(), &values, 1);
        assert_unavailable(&report.slots[2]);
        assert!(report.slots[0].reason.is_none());
        for ct_byte in [101_u32, 127, 229, 255] {
            let mut values = rows();
            values[4]["value"] = json!((0xe4b21900_u32 & !0xff00) | (ct_byte << 8));
            let report = parse(&device(), &values, 1);
            assert_unavailable(&report.slots[1]);
            assert!(report
                .slots
                .iter()
                .filter(|s| s.index != 1)
                .all(|s| s.reason.is_none()));
        }
    }

    #[test]
    fn row_order_is_irrelevant_and_diagnostic_messages_do_not_echo_device_ids() {
        let mut values = rows();
        values.reverse();
        assert_eq!(
            parse(&device(), &values, 1).slots,
            parse(&device(), &rows(), 1).slots
        );
        values[4]["did"] = json!("private-wrong-id");
        let report = parse(&device(), &values, 1);
        assert!(!report.slots[0]
            .reason
            .as_ref()
            .unwrap()
            .contains("private-wrong-id"));
    }

    #[test]
    fn contract_serializes_in_camel_case_and_unavailable_fields_are_null() {
        let report = serde_json::to_value(parse(&device(), &[], 123)).unwrap();
        assert_eq!(report["fetchedAt"], 123);
        assert!(report.get("fetched_at").is_none());
        assert_eq!(report["slots"][0]["brightness"], Value::Null);
        assert_eq!(report["slots"][0]["color"], Value::Null);
        assert_eq!(report["slots"][0]["temperature"], Value::Null);
        assert!(report["slots"][0]["reason"].is_string());
    }
}
