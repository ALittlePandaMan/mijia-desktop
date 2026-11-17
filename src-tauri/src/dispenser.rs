//! xiaomi.ysj.gxj v29 uses Device.callMethodFromCloud("get_properties").
//! Module10703 defines the first13 keys;10709 binds them;10547 batches ten.
//! Additional IIDs come from the current MIoT schema, never the old 2/4 alias.
use crate::{
    error::{AppError, Result},
    models::{id, DevicePanel},
    spec,
};
use serde_json::{json, Value};
use std::collections::HashSet;

pub const MODEL: &str = "xiaomi.ysj.gxj";
pub const READ_BATCH_SIZE: usize = 10;
const KEYS: [(u32, u32, &str); 13] = [
    (2, 1, "fault"),
    (2, 2, "status"),
    (2, 3, "temperature"),
    (2, 5, "mode"),
    (2, 6, "tap_default_mode"),
    (3, 1, "child_lock_mode"),
    (4, 1, "auto_screen_off_time"),
    (5, 1, "not_disturb"),
    (5, 2, "enable_time_period"),
    (2, 7, "local_mode_config"),
    (2, 8, "process"),
    (2, 9, "sterilization_remind_cycle"),
    (7, 2, "self_check_results"),
];

pub(crate) fn rpc_path(did: &str) -> Result<String> {
    if did.is_empty() || did.len() > 64 || !did.bytes().all(|b| b.is_ascii_digit()) {
        return Err(AppError::new(
            "unsupported",
            "此设备标识尚未核实云端RPC路由。",
            false,
        ));
    }
    Ok(format!("/home/rpc/{did}"))
}

pub(crate) fn is_rpc_path(path: &str) -> bool {
    path.strip_prefix("/home/rpc/")
        .is_some_and(|did| rpc_path(did).is_ok())
}

pub(crate) fn read_params(panel: &DevicePanel) -> Result<Vec<Value>> {
    if panel.model != MODEL || panel.unsupported_reason.is_some() {
        return Err(AppError::invalid("管线机读取绑定无效。"));
    }
    rpc_path(panel.control_did())?;
    let mut remaining = spec::read_params(panel);
    let mut ordered = Vec::with_capacity(remaining.len());
    for (siid, piid, key) in KEYS {
        if let Some(index) = remaining
            .iter()
            .position(|p| p["siid"] == siid && p["piid"] == piid)
        {
            let mut p = remaining.remove(index);
            p["propsKey"] = key.into();
            ordered.push(p);
        }
    }
    ordered.extend(remaining);
    Ok(ordered)
}

/// Match explicit device/property identities, never the vendor's positional
/// fallback. Missing rows remain missing (apply_reads records an error).
pub(crate) fn read_rows(params: &[Value], result: Value) -> Result<Vec<Value>> {
    let rows = result.as_array().ok_or_else(AppError::protocol)?;
    let mut seen = HashSet::new();
    for row in rows {
        let key = (id(&row["did"]), row["siid"].as_u64(), row["piid"].as_u64());
        if key.1.is_none()
            || key.2.is_none()
            || !seen.insert(key)
            || !params.iter().any(|p| {
                id(&row["did"]) == id(&p["did"])
                    && row["siid"] == p["siid"]
                    && row["piid"] == p["piid"]
            })
        {
            return Err(AppError::protocol());
        }
    }
    Ok(rows.clone())
}

pub(crate) fn property_write(
    panel: &DevicePanel,
    siid: u32,
    piid: u32,
    value: Value,
) -> Result<Value> {
    if panel.model != MODEL || panel.unsupported_reason.is_some() {
        return Err(AppError::invalid("管线机写入绑定无效。"));
    }
    rpc_path(panel.control_did())?;
    let p = panel
        .services
        .iter()
        .flat_map(|s| &s.properties)
        .find(|p| p.siid == siid && p.piid == piid)
        .ok_or_else(AppError::protocol)?;
    if !p.access.iter().any(|a| a == "write") || p.unsupported_reason.is_some() {
        return Err(AppError::invalid("此管线机属性不允许写入。"));
    }
    spec::validate_value(p, &value)?;
    Ok(json!([{"did":panel.control_did(),"siid":siid,"piid":piid,"value":value}]))
}

pub(crate) fn action_params(
    panel: &DevicePanel,
    siid: u32,
    aiid: u32,
    inputs: Vec<Value>,
) -> Result<Value> {
    if panel.model != MODEL || panel.unsupported_reason.is_some() {
        return Err(AppError::invalid("管线机动作绑定无效。"));
    }
    rpc_path(panel.control_did())?;
    let service = panel
        .services
        .iter()
        .find(|s| s.siid == siid)
        .ok_or_else(AppError::protocol)?;
    let action = service
        .actions
        .iter()
        .find(|a| a.aiid == aiid)
        .ok_or_else(AppError::protocol)?;
    if action.unsupported_reason.is_some() || inputs.len() != action.inputs.len() {
        return Err(AppError::invalid("管线机动作参数无效。"));
    }
    let mut params = json!({"did":panel.control_did(),"siid":siid,"aiid":aiid});
    if !inputs.is_empty() {
        let mut values = Vec::new();
        for (piid, value) in action.inputs.iter().zip(inputs) {
            let p = service
                .properties
                .iter()
                .find(|p| p.piid == *piid)
                .ok_or_else(AppError::protocol)?;
            spec::validate_value(p, &value)?;
            values.push(json!({"piid":piid,"value":value}));
        }
        params["in"] = values.into();
    }
    Ok(params)
}

pub(crate) fn write_receipt(params: &Value, result: Value) -> Result<i64> {
    let params = params.as_array().ok_or_else(AppError::protocol)?;
    let rows = read_rows(params, result)?;
    if rows.len() != 1 || params.len() != 1 {
        return Err(AppError::protocol());
    }
    let code = rows[0]["code"].as_i64().ok_or_else(AppError::protocol)?;
    if code == 0 {
        Ok(code)
    } else {
        Err(AppError::device(code))
    }
}

pub(crate) fn action_receipt(params: &Value, result: Value) -> Result<Value> {
    if id(&result["did"]) != id(&params["did"])
        || result["siid"] != params["siid"]
        || result["aiid"] != params["aiid"]
    {
        return Err(AppError::protocol());
    }
    let code = result["code"].as_i64().ok_or_else(AppError::protocol)?;
    if code == 0 {
        Ok(result)
    } else {
        Err(AppError::device(code))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn panel() -> DevicePanel {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/dispenser-panel.json")).unwrap();
        p.did = "123456789".into();
        p
    }
    #[test]
    fn reads_keep_current_schema_and_vendor_order_without_old_temperature_alias() {
        let p = panel();
        let rows = read_params(&p).unwrap();
        assert_eq!(rows.len(), 25);
        assert_eq!(
            rows.iter()
                .take(13)
                .map(|p| p["propsKey"].as_str().unwrap())
                .collect::<Vec<_>>(),
            KEYS.map(|(_, _, k)| k)
        );
        assert_eq!(
            rows.chunks(READ_BATCH_SIZE)
                .map(<[Value]>::len)
                .collect::<Vec<_>>(),
            [10, 10, 5]
        );
        assert!(rows.iter().any(|p| p["siid"] == 2 && p["piid"] == 13));
        assert!(!rows.iter().any(|p| p["siid"] == 2 && p["piid"] == 4));
        let identities = |rows: Vec<Value>| {
            rows.into_iter()
                .map(|p| (p["siid"].as_u64().unwrap(), p["piid"].as_u64().unwrap()))
                .collect::<HashSet<_>>()
        };
        assert_eq!(identities(rows), identities(spec::read_params(&p)));
        assert!(p
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .all(|p| p.value.is_none() && p.code.is_none()));
    }
    #[test]
    fn unsupported_models_and_path_injection_never_gain_rpc_routing() {
        for model in [
            "xiaomi.ysj.gxj2",
            "xiaomi.ysj.gxj.extra",
            "midjd.fridge.f01",
        ] {
            let mut p = panel();
            p.model = model.into();
            assert!(read_params(&p).is_err());
        }
        for did in [
            "",
            "../123",
            "123?x=1",
            "123/456",
            "123#1",
            "blt.123",
            "１２３",
        ] {
            assert!(rpc_path(did).is_err());
            assert!(!is_rpc_path(&format!("/home/rpc/{did}")));
        }
        assert!(rpc_path(&"1".repeat(65)).is_err());
        assert!(is_rpc_path("/home/rpc/123456789"));
        assert!(!is_rpc_path("/home/rpc/123/extra"));
    }
    #[test]
    fn response_order_does_not_change_identity_and_missing_values_are_not_filled() {
        let params = vec![
            json!({"did":"123","siid":2,"piid":3}),
            json!({"did":"123","siid":2,"piid":2}),
        ];
        let rows=read_rows(&params,json!([{"did":"123","siid":2,"piid":2,"code":0,"value":1},{"did":"123","siid":2,"piid":3,"code":-1}])).unwrap();
        assert_eq!(rows[0]["piid"], 2);
        assert!(rows[1].get("value").is_none());
        assert_eq!(read_rows(&params, json!([])).unwrap(), Vec::<Value>::new());
    }
    #[test]
    fn rejects_cross_device_unknown_duplicate_and_malformed_rows() {
        let params = vec![json!({"did":"123","siid":2,"piid":3})];
        let valid = json!({"did":"123","siid":2,"piid":3,"code":0,"value":25});
        assert!(read_rows(&params, json!([valid.clone(), valid])).is_err());
        for row in [
            json!({"did":"456","siid":2,"piid":3}),
            json!({"did":"123","siid":2,"piid":13}),
            json!({"did":"123","piid":3}),
        ] {
            assert!(read_rows(&params, json!([row])).is_err());
        }
        assert!(read_rows(&params, json!({"result":[]})).is_err());
    }
    #[test]
    fn property_write_uses_current_iid_and_rejects_read_only_or_invalid_values() {
        let p = panel();
        let values = property_write(&p, 2, 13, json!(45)).unwrap();
        assert_eq!(
            values,
            json!([{"did":"123456789","siid":2,"piid":13,"value":45}])
        );
        assert!(property_write(&p, 2, 4, json!(45)).is_err());
        assert!(property_write(&p, 2, 3, json!(25)).is_err());
        assert!(property_write(&p, 2, 13, json!(256)).is_err());
        assert!(property_write(&p, 2, 13, json!("45")).is_err());
    }
    #[test]
    fn action_inputs_are_bound_to_piids_and_empty_actions_omit_inputs() {
        let p = panel();
        let params = action_params(&p, 2, 4, vec![json!(1), json!(true), json!(123)]).unwrap();
        assert_eq!(
            params["in"],
            json!([{"piid":10,"value":1},{"piid":11,"value":true},{"piid":12,"value":123}])
        );
        assert!(action_params(&p, 2, 2, vec![]).unwrap().get("in").is_none());
        assert!(action_params(&p, 2, 4, vec![json!(true), json!(1), json!(123)]).is_err());
        assert!(action_params(&p, 2, 4, vec![]).is_err());
    }
    #[test]
    fn acknowledgements_require_exact_identity_and_are_not_state_confirmation() {
        let p = panel();
        let write = property_write(&p, 2, 13, json!(45)).unwrap();
        assert_eq!(
            write_receipt(
                &write,
                json!([{"did":"123456789","siid":2,"piid":13,"code":0}])
            )
            .unwrap(),
            0
        );
        assert!(write_receipt(
            &write,
            json!([{"did":"123456789","siid":2,"piid":4,"code":0}])
        )
        .is_err());
        assert!(write_receipt(&write, json!([])).is_err());
        let params = action_params(&p, 2, 2, vec![]).unwrap();
        assert!(action_receipt(
            &params,
            json!({"did":"123456789","siid":2,"aiid":2,"code":0})
        )
        .is_ok());
        assert!(action_receipt(&params, json!({"did":"987","siid":2,"aiid":2,"code":0})).is_err());
        assert!(action_receipt(
            &params,
            json!({"did":"123456789","siid":2,"aiid":2,"code":-1})
        )
        .is_err());
    }
}
