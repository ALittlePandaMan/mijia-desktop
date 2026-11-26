use super::*;
#[test]fn parallel_routing_and_relay_policy_are_consistent(){
 assert!(instructions().contains("同轮并行"));assert!(instructions().contains("不另建请求复核"));
 let skill=assistant_skill();assert!(skill.contains("同一轮并行"));assert!(skill.contains("同设备关联"));assert!(skill.contains("不强制添加“米家反馈”前缀"));
 let guide:serde_json::Value=serde_json::from_str(include_str!("../../../../docs/mcp-guide.json")).unwrap();
 assert_eq!(guide["version"],5);assert!(guide["examples"]["get_assistant_task"].get("details").is_none());
 assert!(guide["topics"]["replies"].as_array().unwrap().iter().any(|r|r.as_str().unwrap().contains("宿主决定")));
 let definitions=tools::definitions();let call=definitions.iter().find(|d|d.name=="miot_ask_assistant").unwrap();
 let annotations=serde_json::to_value(&call.annotations).unwrap();
 assert_eq!(annotations["readOnlyHint"],false);assert_eq!(annotations["destructiveHint"],true);assert_eq!(annotations["idempotentHint"],false);assert_eq!(annotations["openWorldHint"],true);
 assert!(call.description.as_ref().unwrap().contains("同轮并行"));
 assert_eq!(guide["examples"]["miot_ask_assistant"]["query"],"关闭客厅灯");
}
#[test]fn resource_pages_and_schema_stay_bounded_and_versioned(){
 assert!(instructions().len()<2048);assert_eq!(tools::definitions().len(),7);
 assert!(serde_json::to_vec(&tools::definitions()).unwrap().len()<16384);
 for resource in resources(){let result=resource_result(&resource.uri).unwrap();assert!(!result.contents.is_empty());}
 for topic in topics(){let mut args=json!({"topic":topic});loop{let r=query(&args).unwrap();assert!(serde_json::to_vec(&r).unwrap().len()<=4096);let v=r.structured_content.unwrap();if let Some(c)=v["cursor"].as_str(){args["cursor"]=json!(c);}else{break}}}
 assert!(!instructions().contains("get_usage_guide"));
}
#[test]fn reference_document_is_current(){assert_eq!(include_str!("../../../../docs/MCP_REFERENCE.md").replace("\r\n","\n"),reference_markdown());}
#[test]#[ignore="explicit documentation generation"]fn export_reference(){std::fs::write(std::env::var("MIJIA_MCP_REFERENCE_OUTPUT").unwrap(),reference_markdown()).unwrap();}
