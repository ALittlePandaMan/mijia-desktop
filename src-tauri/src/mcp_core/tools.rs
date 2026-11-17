//! Fixed tool contracts: device inventory never enters tool discovery.
use rmcp::model::Tool;
use serde_json::{json, Value};
use std::sync::OnceLock;
pub fn require_known_tool(name:&str)->std::result::Result<(),rmcp::ErrorData> {
    if definitions().iter().any(|tool|tool.name==name){Ok(())}
    else{Err(rmcp::ErrorData::invalid_params("Unknown tool",None))}
}
pub fn require_first_page(cursor:Option<&str>)->std::result::Result<(),rmcp::ErrorData> {
    if cursor.is_some(){Err(rmcp::ErrorData::invalid_params("此列表没有后续页。",None))}else{Ok(())}
}
pub fn definitions() -> Vec<Tool> {
    static TOOLS: OnceLock<Vec<Tool>> = OnceLock::new();
    TOOLS.get_or_init(||{
 let id=json!({"type":"string","format":"uuid"});
 let home=json!({"type":"string","minLength":1,"maxLength":256,"description":"当前账号已选家庭真实ID。simple可省略，交云端解析全部已选家庭，不猜ID；complex多家庭需明确选定。目录省略则聚合。"});
 let cursor=json!({"type":"string","maxLength":200});
 vec![
 ("skills_manage","只读智能家居 Skill。readIndex 不带skillId返回索引；device-collaboration返回使用说明及已选家庭上下文。不安装、修改或启停技能。",json!({"action":{"type":"string","enum":["readIndex"]},"skillId":{"type":"string","enum":["device-collaboration"]}}),vec!["action"],true),
 ("tools_search","检索本服务七个已注册的智能家居工具。支持select:工具名、精确名称及中英文关键词，返回真实Schema；已可用工具直接调用，不重复搜索。",json!({"query":{"type":"string","minLength":1,"maxLength":2000}}),vec!["query"],true),
 ("get_status","按需查看统一登录、助手授权、家庭选择和路由状态；不是每次控制或查询的前置步骤。",json!({}),vec![],true),
 ("miot_list_devices","仅用于设备清单、数量、房间、分类和在线概览，不作为控制前置或执行后复核。省略home_id聚合已选家庭，5分钟缓存；不读属性或Spec、不执行控制，按cursor翻页。",json!({"home_id":home.clone(),"cursor":cursor.clone()}),vec![],true),
 ("miot_ask_assistant","普通控制/读数直接simple，场景、自动化、知识、排障等用complex。明确独立的普通动作以不同UUID同轮并行；顺序、条件、同设备关联和场景请求保持完整，不增加操作。关闭客厅灯或所有灯各提交一次，不枚举或提前追问设备；simple家庭不明省略home_id。完成后直接使用或简短总结reply，不强制来源前缀，不查设备或另建请求复核；仅未完成轮询原UUID，未知不重发。",json!({"query":{"type":"string","minLength":1,"maxLength":2000,"description":"用户原句或明确独立的原句子任务；仅继承明确共用上下文，不添加动作，关联请求保持完整。"},"complexity":{"type":"string","enum":["simple","complex"],"description":"simple：普通即时控制、状态或读数；complex：场景、自动化、知识、故障、事件等。complex需一个家庭，多个家庭且目标不明时仅问一次家庭。"},"requestId":id.clone(),"home_id":home}),vec!["query","complexity","requestId"],false),
 ("get_assistant_task","只轮询未完成的原UUID，或读取必要答案被截断的原任务分页。完成后直接使用或简短总结reply并停止，不查设备、不读诊断、不新建请求复核、不重放。",json!({"requestId":id.clone(),"afterRevision":{"type":"integer","minimum":0},"waitMs":{"type":"integer","minimum":0,"maximum":5000},"details":{"type":"boolean","description":"仅必要答案被截断时读取原任务分页；不为普通回复或执行后复核读取诊断。"},"cursor":cursor}),vec!["requestId"],true),
 ("cancel_assistant_task","停止等待已有助手任务，尽力取消复杂会话；不撤销已经发生的设备动作。重复取消不重复下发。",json!({"requestId":id}),vec!["requestId"],false),
 ].into_iter().map(|(name,description,properties,required,read)|serde_json::from_value(json!({"name":name,"description":description,"inputSchema":{"type":"object","additionalProperties":false,"properties":properties,"required":required},"annotations":{"readOnlyHint":read,"destructiveHint":name=="miot_ask_assistant","openWorldHint":true,"idempotentHint":name!="miot_ask_assistant"}})).expect("fixed tools" )).collect()
 }).clone()
}

/// Validate the fixed public schema before any lookup or cloud request. Native
/// parameter objects retain their existing typed adapter validation.
pub fn validate_arguments(name: &str, args: &Value) -> crate::error::Result<()> {
    fn validate(schema: &Value, value: &Value, path: &str) -> crate::error::Result<()> {
        let fail = |expected: &str| crate::error::AppError::invalid(&format!("{path}：{expected}"));
        let valid = match schema["type"].as_str() {
            Some("object") => value.is_object(),
            Some("array") => value.is_array(),
            Some("string") => value.is_string(),
            Some("integer") => value.as_u64().is_some() || value.as_i64().is_some(),
            Some("boolean") => value.is_boolean(),
            _ => true,
        };
        if !valid {
            return Err(fail(&format!("需要 {}", schema["type"])));
        }
        if let Some(choices) = schema["enum"].as_array() {
            if !choices.contains(value) {
                return Err(fail(&format!("合法值为 {}", schema["enum"])));
            }
        }
        if let Some(map) = value.as_object() {
            if let Some(required) = schema["required"].as_array() {
                for key in required {
                    if !map.contains_key(key.as_str().unwrap()) {
                        return Err(fail(&format!("缺少必填字段 {}", key)));
                    }
                }
            }
            for (key, value) in map {
                if let Some(field) = schema["properties"].get(key) {
                    validate(field, value, &format!("{path}.{key}"))?;
                } else if schema["additionalProperties"] == false {
                    return Err(fail(&format!("不支持字段 {key}")));
                }
            }
        }
        if let Some(text) = value.as_str() {
            if schema["minLength"]
                .as_u64()
                .is_some_and(|n| text.chars().count() < n as usize)
            {
                return Err(fail("字符串短于长度下限"));
            }
            if schema["maxLength"]
                .as_u64()
                .is_some_and(|n| text.chars().count() > n as usize)
            {
                return Err(fail("字符串超过长度上限"));
            }
            if schema["format"] == "uuid" && uuid::Uuid::parse_str(text).is_err() {
                return Err(fail("需要有效 UUID"));
            }
        }
        if let Some(number) = value.as_f64() {
            if schema["minimum"].as_f64().is_some_and(|n| number < n)
                || schema["maximum"].as_f64().is_some_and(|n| number > n)
            {
                return Err(fail("数值超出 Schema 范围"));
            }
        }
        if let Some(items) = value.as_array() {
            if schema["minItems"]
                .as_u64()
                .is_some_and(|n| items.len() < n as usize)
                || schema["maxItems"]
                    .as_u64()
                    .is_some_and(|n| items.len() > n as usize)
            {
                return Err(fail("项目数超出 Schema 范围"));
            }
            for (i, item) in items.iter().enumerate() {
                if schema["uniqueItems"] == true && items[..i].contains(item) {
                    return Err(fail("项目必须唯一"));
                }
                validate(&schema["items"], item, &format!("{path}[{i}]"))?;
            }
        }
        Ok(())
    }
    let definition = definitions()
        .into_iter()
        .find(|t| t.name == name)
        .ok_or_else(|| crate::error::AppError::invalid("工具名不存在；请重新读取 tools/list。"))?;
    let schema = serde_json::to_value(definition).unwrap()["inputSchema"].clone();
    let mut normalized=args.clone();
    if name=="miot_ask_assistant" { if let Some(s)=args["query"].as_str(){ normalized["query"]=json!(s.trim()); } }
    validate(&schema, &normalized, "arguments")
}

/// Discovery never activates capabilities or changes permissions.
pub fn search(query:&str)->Value {
    let query=query.trim().to_lowercase();
    let exact=query.strip_prefix("select:").unwrap_or(&query).trim();
    let aliases=[
        ("skills_manage", &["skill","技能","使用说明","使用指南"][..]),
        ("tools_search", &["搜索工具","工具搜索","search","discover"][..]),
        ("get_status", &["登录","授权","连接状态","status","login","authorization"][..]),
        ("miot_list_devices", &["清单","列表","有哪些","数量","在线","离线","inventory","list devices","devices"][..]),
        ("miot_ask_assistant", &["开灯","关灯","空调","亮度","温度","控制","场景","自动化","故障","摄像头","能耗","固件","assistant","control","automation","scene","camera","troubleshoot"][..]),
        ("get_assistant_task", &["任务结果","任务进度","查询任务","poll","task result"][..]),
        ("cancel_assistant_task", &["取消","停止任务","cancel","stop task"][..]),
    ];
    let mut matches=definitions().into_iter().filter_map(|tool|{
        let name=tool.name.as_ref();let exact_match=name==exact;
        if query.starts_with("select:") && !exact_match {return None;}
        let keywords=aliases.iter().find(|(n,_)|*n==name).unwrap().1;
        let score=if exact_match{1000}else{keywords.iter().filter(|word|query.contains(**word)).count()*10+usize::from(name.contains(&query))};
        (score>0).then_some((score,tool))
    }).collect::<Vec<_>>();
    matches.sort_by(|a,b|b.0.cmp(&a.0).then(a.1.name.cmp(&b.1.name)));
    json!({"registered":true,"activationRequired":false,"tools":matches.into_iter().take(5).map(|(_,t)|t).collect::<Vec<_>>()})
}
