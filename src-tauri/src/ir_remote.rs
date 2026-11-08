//! Existing IR controllers: observed key-list/click APIs, no learned-code handling.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
pub const READ_PATH: &str = "/v2/irdevice/controller/keys";
pub const CLICK_PATH: &str = "/v2/irdevice/controller/key/click";
pub fn supported(model: &str) -> bool {
    matches!(model, "miir.tv.ir01" | "miir.stb.ir01" | "miir.remote.ir01")
}
#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct Key {
    pub name: String,
    pub label: String,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub model: String,
    pub baseline: String,
    pub keys: Vec<Key>,
}
pub struct Table {
    pub report: Report,
    bindings: Vec<(String, u64)>,
    route: String,
}
fn label(model: &str, name: &str) -> Option<&'static str> {
    if model == "miir.remote.ir01" {
        return match name {
            "上" => Some("上"),
            "下" => Some("下"),
            "左" => Some("左"),
            "右" => Some("右"),
            "确认" => Some("确认"),
            "返回" => Some("返回"),
            "主页" => Some("主页"),
            "电源" => Some("电源"),
            "+" => Some("＋"),
            "-" => Some("－"),
            _ => None,
        };
    }
    match name {
        "POWER" => Some("电源"),
        "VOL+" => Some("音量＋"),
        "VOL-" => Some("音量－"),
        "CH+" => Some("下一频道"),
        "CH-" => Some("上一频道"),
        "MUTE" => Some("静音"),
        "NAVIGATE_UP" => Some("上"),
        "NAVIGATE_DOWN" => Some("下"),
        "NAVIGATE_LEFT" => Some("左"),
        "NAVIGATE_RIGHT" => Some("右"),
        "OK" => Some("确认"),
        "BACK" => Some("返回"),
        "HOMEPAGE" => Some("主页"),
        "MENU" => Some("菜单"),
        "INPUT" => Some("信号源"),
        _ => None,
    }
}
pub fn parse(model: &str, raw: &Value) -> Result<Table> {
    if !supported(model) {
        return Err(AppError::invalid("尚未核实此红外遥控器。"));
    }
    let rows = raw["keys"]
        .as_array()
        .filter(|a| a.len() <= 512)
        .ok_or_else(AppError::protocol)?;
    let mut bindings = Vec::new();
    let mut keys = Vec::new();
    let mut names = std::collections::HashSet::new();
    let mut ids = std::collections::HashSet::new();
    for row in rows {
        let name = row["name"].as_str().ok_or_else(AppError::protocol)?;
        let Some(text) = label(model, name) else {
            continue;
        };
        let id = row["id"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or_else(AppError::protocol)?;
        if !names.insert(name.to_owned()) || !ids.insert(id) {
            return Err(AppError::protocol());
        }
        keys.push(Key {
            name: name.into(),
            label: text.into(),
        });
        bindings.push((name.to_owned(), id));
    }
    bindings.sort();
    keys.sort_by(|a, b| a.name.cmp(&b.name));
    let bytes = serde_json::to_vec(&(model, &bindings)).map_err(|_| AppError::protocol())?;
    Ok(Table {
        report: Report {
            model: model.into(),
            baseline: format!("{:x}", Sha256::digest(bytes)),
            keys,
        },
        bindings,
        route: String::new(),
    })
}
fn bind(mut table: Table, device: &Device) -> Table {
    table.report.baseline = format!(
        "{:x}",
        Sha256::digest(format!("{}\n{}", table.report.baseline, device.control_did()).as_bytes())
    );
    table.route = device.control_did().into();
    table
}
pub async fn load(cloud: &Cloud, device: &Device) -> Result<Table> {
    if !supported(&device.model) || device.split_route.is_some() {
        return Err(AppError::invalid("红外遥控器绑定不匹配。"));
    }
    Ok(bind(
        parse(
            &device.model,
            &cloud
                .request(READ_PATH, json!({"did":device.control_did()}))
                .await?,
        )?,
        device,
    ))
}
pub fn click_params(device: &Device, table: &Table, baseline: &str, name: &str) -> Result<Value> {
    if device.model != table.report.model
        || !supported(&device.model)
        || device.split_route.is_some()
        || table.route != device.control_did()
        || baseline != table.report.baseline
    {
        return Err(AppError::new(
            "conflict",
            "遥控器按键已变化，请重新打开设备后操作。",
            false,
        ));
    }
    let id = table
        .bindings
        .iter()
        .find(|(n, _)| n == name)
        .map(|(_, id)| *id)
        .ok_or_else(|| AppError::invalid("当前遥控器没有此日常按键。"))?;
    Ok(json!({"did":device.control_did(),"key_id":id}))
}
pub fn take_nonce(recent: &mut std::collections::VecDeque<String>, nonce: &str) -> Result<()> {
    if nonce.len() != 36 || !nonce.bytes().all(|b| b.is_ascii_hexdigit() || b == b'-') {
        return Err(AppError::invalid("遥控请求标识无效。"));
    }
    if recent.iter().any(|n| n == nonce) {
        return Err(AppError::new(
            "alreadySent",
            "该按键请求已提交，不会重复发送。",
            false,
        ));
    }
    recent.push_back(nonce.into());
    while recent.len() > 64 {
        recent.pop_front();
    }
    Ok(())
}
#[cfg(test)]
mod tests {
    use super::*;
    fn raw() -> Value {
        json!({"keys":[{"id":101,"name":"POWER","display_name":"power"},{"id":102,"name":"VOL+"},{"id":103,"name":"SET"}]})
    }
    #[test]
    fn exact_models_only_and_no_ir_codes_or_ids_in_report() {
        let t = parse("miir.tv.ir01", &raw()).unwrap();
        assert_eq!(t.report.keys.len(), 2);
        assert_eq!(
            t.report
                .keys
                .iter()
                .find(|k| k.name == "POWER")
                .unwrap()
                .label,
            "电源"
        );
        let s = serde_json::to_string(&t.report).unwrap();
        assert!(!s.contains("101") && !s.contains("display_name"));
        assert!(parse("miir.tv.ir02", &raw()).is_err());
    }
    #[test]
    fn missing_keys_are_not_inferred_from_miot() {
        let t = parse("miir.tv.ir01", &raw()).unwrap();
        assert!(!t
            .report
            .keys
            .iter()
            .any(|k| ["MUTE", "CH+", "CH-", "POWER_ON", "POWER_OFF"].contains(&k.name.as_str())));
    }
    #[test]
    fn duplicate_or_malformed_bindings_fail() {
        for raw in [
            json!({"keys":[{"name":"POWER","id":1},{"name":"POWER","id":2}]}),
            json!({"keys":[{"name":"POWER","id":1},{"name":"VOL+","id":1}]}),
            json!({"keys":[{"name":"POWER","id":"1"}]}),
            json!({"keys":null}),
        ] {
            assert!(parse("miir.tv.ir01", &raw).is_err());
        }
    }
    #[test]
    fn snapshot_fingerprint_binds_id_model_and_ignores_order() {
        let a = parse("miir.tv.ir01", &raw()).unwrap();
        let mut b = raw();
        b["keys"].as_array_mut().unwrap().reverse();
        assert_eq!(
            a.report.baseline,
            parse("miir.tv.ir01", &b).unwrap().report.baseline
        );
        b["keys"][2]["id"] = json!(999);
        assert_ne!(
            a.report.baseline,
            parse("miir.tv.ir01", &b).unwrap().report.baseline
        );
        assert_ne!(
            a.report.baseline,
            parse("miir.stb.ir01", &raw()).unwrap().report.baseline
        );
    }
    #[test]
    fn learned_remote_preserves_exact_observed_key_names_without_mouse_configuration() {
        let t=parse("miir.remote.ir01",&json!({"keys":[{"name":"电源","id":1},{"name":"+","id":2},{"name":"鼠标模式","id":3}]})).unwrap();
        assert_eq!(t.report.keys.len(), 2);
        assert_eq!(t.report.keys[0].label, "＋");
    }
    #[test]
    fn nonces_are_one_shot_and_bounded() {
        let mut q = std::collections::VecDeque::new();
        let n = "12345678-1234-1234-1234-123456789012";
        assert!(take_nonce(&mut q, n).is_ok());
        assert!(take_nonce(&mut q, n).is_err());
        assert!(take_nonce(&mut q, "invalid").is_err());
        for i in 0..100 {
            take_nonce(&mut q, &format!("00000000-0000-0000-0000-{i:012x}")).unwrap();
        }
        assert_eq!(q.len(), 64);
    }
    fn device() -> Device {
        serde_json::from_value(json!({"did":"ir.fixture","name":"fixture","model":"miir.tv.ir01","online":true,"roomId":"room","roomName":"room"})).unwrap()
    }
    #[test]
    fn click_uses_the_scoped_live_key_id_and_never_a_miot_action() {
        let d = device();
        let t = bind(parse(&d.model, &raw()).unwrap(), &d);
        assert_eq!(
            click_params(&d, &t, &t.report.baseline, "POWER").unwrap(),
            json!({"did":"ir.fixture","key_id":101})
        );
        assert!(click_params(&d, &t, &t.report.baseline, "SET").is_err());
        assert!(click_params(&d, &t, "old-baseline", "POWER").is_err());
    }
    #[test]
    fn another_device_cannot_reuse_a_matching_key_table() {
        let d = device();
        let t = bind(parse(&d.model, &raw()).unwrap(), &d);
        let mut other = d.clone();
        other.did = "ir.other".into();
        assert!(click_params(&other, &t, &t.report.baseline, "POWER").is_err());
        let new = bind(parse(&d.model, &raw()).unwrap(), &other);
        assert_ne!(t.report.baseline, new.report.baseline);
    }
}
