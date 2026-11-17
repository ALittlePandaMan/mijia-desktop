use super::*;
use crate::cloud_assistant::{protocol::Request, scope};
use serde_json::json;
fn req(route: &str, home: Option<&str>) -> Request {
    Request {
        query: "关闭宿舍空调".into(),
        complexity: route.into(),
        request_id: uuid::Uuid::new_v4().to_string(),
        home_id: home.map(str::to_owned),
    }
}
#[test]
fn simple_defaults_to_all_selected_homes_and_complex_requires_one() {
    let selected = vec!["2".into(), "1".into()];
    assert_eq!(
        scope::select_homes(&req("simple", None), &selected).unwrap(),
        vec!["1", "2"]
    );
    assert_eq!(
        scope::select_homes(&req("simple", Some("2")), &selected).unwrap(),
        vec!["2"]
    );
    assert_eq!(
        scope::select_homes(&req("complex", None), &selected)
            .unwrap_err()
            .kind,
        "clarificationRequired"
    );
    assert_eq!(
        scope::select_homes(&req("complex", Some("2")), &selected).unwrap(),
        vec!["2"]
    );
    assert_eq!(
        scope::select_homes(&req("simple", Some("forbidden")), &selected)
            .unwrap_err()
            .kind,
        "homeDenied"
    );
    assert_eq!(
        scope::select_homes(&req("simple", None), &[])
            .unwrap_err()
            .kind,
        "noSelectedHomes"
    );
}
#[test]
fn tool_surface_has_no_hidden_legacy_routes_or_transport_fields() {
    let names = tools::definitions()
        .into_iter()
        .map(|t| t.name.to_string())
        .collect::<Vec<_>>();
    assert_eq!(
        names,
        vec![
            "skills_manage",
            "tools_search",
            "get_status",
            "miot_list_devices",
            "miot_ask_assistant",
            "get_assistant_task",
            "cancel_assistant_task"
        ]
    );
    for name in [
        "miot_home_data",
        "control_power",
        "control_devices",
        "get_operation_memories",
        "get_usage_guide",
        "find_devices",
        "get_control_result",
        "prepare_control",
        "execute_control",
        "get_camera_snapshot",
        "feedback_operation",
    ] {
        assert!(tools::validate_arguments(name, &json!({})).is_err());
    }
    let id = uuid::Uuid::new_v4().to_string();
    for key in ["target", "token", "url", "host", "client_id"] {
        let mut v = json!({"query":"关灯","complexity":"simple","requestId":id});
        v[key] = json!("forbidden");
        assert!(tools::validate_arguments("miot_ask_assistant", &v).is_err());
    }
}
#[test]
fn pagination_cursors_cannot_cross_accounts_or_versions() {
    let c = response::cursor("account-a", "1", 10);
    assert_eq!(response::offset(Some(&c), "account-a", "1").unwrap(), 10);
    assert!(response::offset(Some(&c), "account-b", "1").is_err());
    assert!(response::offset(Some(&c), "account-a", "2").is_err());
}
#[test]
fn smart_home_discovery_is_read_only_precise_and_never_activates_permissions(){
    for query in ["select:miot_ask_assistant","miot_ask_assistant","开灯","control automation"] {
        let value=tools::search(query);assert_eq!(value["activationRequired"],false);assert!(value["tools"].as_array().unwrap().iter().any(|v|v["name"]=="miot_ask_assistant"));
    }
    assert_eq!(tools::search("select:control_power")["tools"],json!([]));
    for action in ["create","install","delete","set_enabled"]{assert!(tools::validate_arguments("skills_manage",&json!({"action":action})).is_err());}
    assert!(tools::validate_arguments("skills_manage",&json!({"action":"readIndex","skillId":"device-collaboration"})).is_ok());
    assert!(tools::validate_arguments("skills_manage",&json!({"action":"readIndex","skillId":"file-transfer"})).is_err());
    let skill=guide::skill_index(Some("device-collaboration")).unwrap();assert_eq!(skill["readOnly"],true);
    assert_eq!(skill["skillMd"],guide::assistant_skill());
    let args=json!({"query":format!(" {} ","开".repeat(2000)),"complexity":"simple","requestId":uuid::Uuid::new_v4().to_string()});
    assert!(tools::validate_arguments("miot_ask_assistant",&args).is_ok());
}

#[test]
fn dependent_intents_cancel_old_remaining_steps_only() {
    let intents = intent::Intents::default();
    intents.configure(&[("switch".into(), "light".into())]);
    let old = intents.claim(["switch".into(), "unrelated".into()]);
    let new = intents.claim(["light".into()]);
    assert!(!intents.current(&old, "switch"));
    assert!(intents.current(&old, "unrelated"));
    assert!(intents.current(&new, "switch"));
}

#[test]
fn late_capability_resolution_cannot_override_a_newer_ui_intent() {
    let intents = intent::Intents::default();
    let older = intents.reserve();
    let newer = intents.claim(["channel".into()]);
    let resolved = intents.bind(older, ["channel".into()]);
    assert!(!intents.current(&resolved, "channel"));
    assert!(intents.current(&newer, "channel"));
}

#[test]
fn a_dependency_discovered_after_a_newer_ui_action_cancels_only_that_component() {
    let intents = intent::Intents::default();
    let older = intents.reserve();
    let _ui = intents.claim(["lamp".into()]);
    intents.configure(&[("supply".into(), "lamp".into())]);
    let late = intents.bind(
        older,
        ["supply".into(), "lamp".into(), "independent".into()],
    );
    assert!(!intents.current(&late, "supply"));
    assert!(!intents.current(&late, "lamp"));
    assert!(intents.current(&late, "independent"));
}
