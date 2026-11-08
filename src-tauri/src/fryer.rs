//! Daily read contract for the observed maf16 firmware. No vendor code or writes.
use crate::{
    error::{AppError, Result},
    models::{DevicePanel, Property},
};
use serde_json::{json, Value};

pub const MODEL: &str = "xiaomi.fryer.maf16";
pub const READ_BATCH_SIZE: usize = 7;
// Plugin v48 module 10280 and the actual account's MIoT descriptor agree.
const BINDINGS: [(u32, &str); READ_BATCH_SIZE] = [
    (2, "status"),
    (3, "fault"),
    (5, "target-time"),
    (7, "target-temperature"),
    (22, "left-time"),
    (23, "auto-keep-warm"),
    (25, "mode"),
];

pub fn is_daily_property(property: &Property) -> bool {
    property.siid == 2
        && property.access.iter().any(|a| a == "read")
        && BINDINGS
            .iter()
            .any(|(id, name)| property.piid == *id && property.name == *name)
}

pub fn read_params(panel: &DevicePanel) -> Result<Vec<Value>> {
    let mismatch = || {
        AppError::new(
            "unsupported",
            "当前炸锅的日常属性与已核实模型不一致，已停止读取。",
            false,
        )
    };
    if panel.model != MODEL {
        return Err(mismatch());
    }
    let services = panel
        .services
        .iter()
        .filter(|s| s.siid == 2)
        .collect::<Vec<_>>();
    if services.len() != 1 || services[0].name != "air-fryer" {
        return Err(mismatch());
    }
    BINDINGS
        .iter()
        .map(|(id, name)| {
            let matches = services[0]
                .properties
                .iter()
                .filter(|p| p.piid == *id)
                .collect::<Vec<_>>();
            if matches.len() != 1 || matches[0].name != *name || !is_daily_property(matches[0]) {
                return Err(mismatch());
            }
            Ok(json!({"did":panel.control_did(),"siid":2,"piid":id}))
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> DevicePanel {
        let all: Value = serde_json::from_str(include_str!(
            "../../src/fixtures/daily-remaining-panels.json"
        ))
        .unwrap();
        serde_json::from_value(
            all["models"]
                .as_array()
                .unwrap()
                .iter()
                .find(|p| p["model"] == MODEL)
                .unwrap()
                .clone(),
        )
        .unwrap()
    }
    #[test]
    fn actual_contract_keeps_only_the_observed_daily_set_and_physical_route() {
        let mut panel = fixture();
        panel.route_did = Some("physical-fixture".into());
        let params = read_params(&panel).unwrap();
        assert_eq!(params.len(), 7);
        assert_eq!(
            params[0],
            json!({"did":"physical-fixture","siid":2,"piid":2})
        );
        assert!(params.iter().all(|p| p["did"] == "physical-fixture"));
        assert_eq!(
            params
                .iter()
                .map(|p| p["piid"].as_u64().unwrap())
                .collect::<Vec<_>>(),
            [2, 3, 5, 7, 22, 23, 25]
        );
        assert!(crate::spec::read_params(&panel).len() > params.len());
    }
    #[test]
    fn changed_model_service_binding_or_read_permission_does_not_guess_a_request() {
        let original = fixture();
        for drift in 0..6 {
            let mut panel = original.clone();
            let service = panel.services.iter_mut().find(|s| s.siid == 2).unwrap();
            match drift {
                0 => panel.model.push_str(".other"),
                1 => service.name = "other".into(),
                2 => service.properties.retain(|p| p.piid != 5),
                3 => {
                    service
                        .properties
                        .iter_mut()
                        .find(|p| p.piid == 7)
                        .unwrap()
                        .name = "other".into()
                }
                4 => service
                    .properties
                    .iter_mut()
                    .find(|p| p.piid == 22)
                    .unwrap()
                    .access
                    .clear(),
                _ => service.properties.push(
                    service
                        .properties
                        .iter()
                        .find(|p| p.piid == 2)
                        .unwrap()
                        .clone(),
                ),
            }
            assert!(read_params(&panel).is_err());
        }
    }
    #[test]
    fn no_cache_request_is_made_for_excluded_recipe_and_selfcheck_fields() {
        let mut panel = fixture();
        let rows = read_params(&panel)
            .unwrap()
            .into_iter()
            .map(|p| json!({"did":p["did"],"siid":p["siid"],"piid":p["piid"],"code":0,"value":0}))
            .collect::<Vec<_>>();
        crate::spec::apply_reads(&mut panel, &rows);
        assert!(crate::spec::missing_read_params(&panel).is_empty());
        panel
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.siid == 2 && p.piid == 5)
            .unwrap()
            .code = Some(-1);
        assert_eq!(
            crate::spec::missing_read_params(&panel),
            vec![json!({"did":panel.control_did(),"siid":2,"piid":5})]
        );
    }
    #[test]
    fn failed_daily_read_stays_failed_after_cache_and_does_not_accept_excluded_rows() {
        let mut panel = fixture();
        crate::spec::apply_reads(&mut panel, &[]);
        let rows = vec![
            json!({"did":panel.control_did(),"siid":2,"piid":5,"code":0,"value":10}),
            json!({"did":panel.control_did(),"siid":2,"piid":34,"code":0,"value":10}),
        ];
        crate::spec::apply_reported(&mut panel, &rows, 1_793_500_000);
        let props = panel
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .collect::<Vec<_>>();
        let time = props.iter().find(|p| p.siid == 2 && p.piid == 5).unwrap();
        assert_eq!(time.code, Some(-1));
        assert!(time.value.is_none());
        assert!(time.last_reported.is_some());
        assert!(props
            .iter()
            .find(|p| p.siid == 2 && p.piid == 34)
            .unwrap()
            .last_reported
            .is_none());
    }
    #[test]
    fn other_models_keep_their_ordinary_cache_fallback() {
        let mut panel = fixture();
        panel.model = "unrelated.model".into();
        crate::spec::apply_reads(&mut panel, &[]);
        assert_eq!(
            crate::spec::missing_read_params(&panel).len(),
            crate::spec::read_params(&panel).len()
        );
        let rows = [json!({"did":panel.control_did(),"siid":2,"piid":34,"code":0,"value":10})];
        crate::spec::apply_reported(&mut panel, &rows, 1_793_500_000);
        assert!(panel
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .find(|p| p.siid == 2 && p.piid == 34)
            .unwrap()
            .last_reported
            .is_some());
    }
}
