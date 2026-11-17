//! Offline, versioned guidance shared by tools, MCP resources and the reference manual.
use super::{response, tools};
use crate::error::{AppError, Result};
use rmcp::model::{
    CallToolResult, Implementation, ReadResourceResult, Resource, ResourceContents,
    ServerCapabilities, ServerConfig,
};
use serde_json::{json, Value};
use std::sync::OnceLock;

pub fn data() -> &'static Value {
    static DATA: OnceLock<Value> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../../docs/mcp-guide.json"))
            .expect("built-in MCP guide")
    })
}
pub fn instructions() -> &'static str {
    data()["instructions"].as_str().unwrap()
}
pub fn server_config() -> ServerConfig {
    ServerConfig::new(
        ServerCapabilities::builder()
            .enable_tools()
            .enable_resources()
            .build(),
    )
    .with_server_info(Implementation::new(
        "mijia-desktop",
        env!("CARGO_PKG_VERSION"),
    ))
    .with_instructions(instructions())
}
pub fn resource_result(uri: &str) -> Result<ReadResourceResult> {
    if uri=="mijia://assistant/v1/recovery"{return Ok(ReadResourceResult::new(vec![ResourceContents::text(serde_json::to_string(&crate::cloud_assistant::fallback::status()).unwrap(),uri)]));}
    if uri==assistant_skill_uri(){return Ok(ReadResourceResult::new(vec![ResourceContents::text(assistant_skill(),uri.to_owned())]));}
    let result = read(uri)?;
    let text = result
        .content
        .iter()
        .filter_map(|c| c.as_text().map(|t| t.text.as_str()))
        .collect::<Vec<_>>()
        .join("\n");
    Ok(ReadResourceResult::new(vec![ResourceContents::text(
        text,
        uri.to_owned(),
    )]))
}
pub fn parameter_help(name: &str) -> &'static str {
    data()["parameters"][name].as_str().unwrap_or("")
}
pub fn revision() -> &'static str {
    static REVISION: OnceLock<String> = OnceLock::new();
    REVISION
        .get_or_init(|| super::fingerprint(&(data(), tools::definitions(),assistant_skill())))
        .as_str()
}
pub fn topics() -> Vec<String> {
    let mut topics = vec!["quickstart".to_owned(), "tools".to_owned()];
    topics.extend(
        data()["topics"]
            .as_object()
            .unwrap()
            .keys()
            .filter(|s| *s != "quickstart")
            .cloned(),
    );
    topics
}
pub fn assistant_skill()->&'static str{include_str!("../../../docs/skills/device-collaboration/SKILL.md")}
pub fn assistant_skill_uri()->String{format!("mijia://skills/v1/{}/device-collaboration",revision())}
pub fn skill_index(skill:Option<&str>)->Result<Value>{
    if skill.is_some_and(|s|s!="device-collaboration"){return Err(AppError::new("notFound","仅提供智能家居 device-collaboration Skill。",false));}
    let mut entry=json!({"skillId":"device-collaboration","name":"智能家居","version":revision(),"enabled":true,"readOnly":true,"resourceUri":assistant_skill_uri(),"description":"米家设备目录、云端控制、场景和故障排查。"});
    if skill.is_some(){entry["skillMd"]=json!(assistant_skill());Ok(entry)}else{Ok(json!({"skills":[entry],"version":revision()}))}
}
fn rows(topic: &str, tool: Option<&str>) -> Result<Vec<Value>> {
    if topic == "assistant" && tool.is_none(){
        let mut rows=vec![json!({"id":"device-collaboration","version":revision(),"resourceUri":assistant_skill_uri(),"summary":"首次或版本变化时读取Skill；通过已选家庭委托自然语言任务。","text":"首次或版本变化时读取device-collaboration Skill；下列分页正文与打包资源同源。"})];
        let chars:Vec<char>=assistant_skill().chars().collect();
        rows.extend(chars.chunks(350).enumerate().map(|(part,chars)|json!({"part":part,"text":chars.iter().collect::<String>()})));
        return Ok(rows);
    }
    if topic == "tools" {
        let definitions = tools::definitions();
        if let Some(name) = tool {
            let definition = definitions
                .iter()
                .find(|t| t.name == name)
                .ok_or_else(|| AppError::invalid("tool 不是已注册的 MCP 工具名。"))?;
            let schema = serde_json::to_value(definition).unwrap()["inputSchema"].clone();
            let mut result = vec![
                json!({"tool":name,"description":definition.description,"usage":data()["notes"][name],"required":schema["required"],"example":data()["examples"][name]}),
            ];
            for (name, schema) in schema["properties"].as_object().unwrap() {
                let mut summary = schema.clone();
                let children = summary.as_object_mut().and_then(|o| o.remove("properties"));
                result.push(
                    json!({"parameter":name,"description":parameter_help(name),"schema":summary}),
                );
                if let Some(children) = children.and_then(|v| v.as_object().cloned()) {
                    for (child, schema) in children {
                        result.push(json!({"parameter":format!("{name}.{child}"),"description":schema["description"].as_str().unwrap_or("约束见本字段 Schema 与 targets 主题。"),"schema":schema}));
                    }
                }
            }
            return Ok(result);
        }
        return Ok(definitions.iter().map(|t| json!({"tool":t.name,"description":t.description,"readOnly":t.annotations.as_ref().and_then(|a|a.read_only_hint)})).collect());
    }
    if tool.is_some() {
        return Err(AppError::invalid("tool 只能用于 topic=tools。"));
    }
    data()["topics"][topic]
        .as_array()
        .map(|rows| {
            rows.iter()
                .enumerate()
                .map(|(i, text)| json!({"section":i+1,"text":text}))
                .collect()
        })
        .ok_or_else(|| AppError::invalid("topic 不存在；省略参数读取 quickstart 及主题索引。"))
}
fn uri(topic: &str, tool: Option<&str>, cursor: Option<&str>) -> String {
    let base = format!(
        "mijia://guide/v1/{}/{topic}/{}",
        revision(),
        tool.unwrap_or("_")
    );
    cursor.map(|c| format!("{base}?cursor={c}")).unwrap_or(base)
}
pub fn query(args: &Value) -> Result<CallToolResult> {
    let object = args
        .as_object()
        .ok_or_else(|| AppError::invalid("指南参数必须为对象。"))?;
    if object
        .keys()
        .any(|k| !matches!(k.as_str(), "topic" | "tool" | "cursor"))
    {
        return Err(AppError::invalid("指南只接受 topic、tool、cursor。"));
    }
    for key in ["topic", "tool", "cursor"] {
        if object
            .get(key)
            .is_some_and(|v| v.as_str().is_none_or(|s| s.is_empty() || s.len() > 200))
        {
            return Err(AppError::invalid("指南字段必须为非空字符串，最多200字节。"));
        }
    }
    let tool = args["tool"].as_str();
    let topic = args["topic"].as_str().unwrap_or(if tool.is_some() {
        "tools"
    } else {
        "quickstart"
    });
    let rows = rows(topic, tool)?;
    let key = format!("guide:{topic}:{}", tool.unwrap_or(""));
    let cursor = args["cursor"].as_str();
    let start = response::offset(cursor, &key, revision())?;
    // Reserve space for resource links; budget includes BOTH representations.
    let result = response::page(
        &key,
        revision(),
        start,
        &rows,
        json!({"guideVersion":data()["version"],"guideRevision":revision(),"appVersion":env!("CARGO_PKG_VERSION"),"topic":topic,"tool":tool,"topics":topics()}),
        3000,
        10,
    )?;
    let mut value = result.structured_content.unwrap();
    value["uri"] = json!(uri(topic, tool, cursor));
    value["nextUri"] = value["cursor"]
        .as_str()
        .map(|c| json!(uri(topic, tool, Some(c))))
        .unwrap_or(Value::Null);
    response::bounded(value, 4096)
}
pub fn resources() -> Vec<Resource> {
    topics()
        .iter()
        .map(|topic| {
            Resource::new(uri(topic, None, None), format!("mijia-guide-{topic}"))
                .with_mime_type("text/plain")
                .with_description(format!(
                    "米家 MCP {topic}，版本化分页资源。"
                ))
        })
        .chain(tools::definitions().iter().map(|tool| {
            Resource::new(
                uri("tools", Some(&tool.name), None),
                format!("mijia-guide-{}", tool.name),
            )
            .with_mime_type("text/plain")
            .with_description(format!("{} 参数、约束和示例", tool.name))
        }))
        .chain(std::iter::once(Resource::new(assistant_skill_uri(),"device-collaboration-skill").with_mime_type("text/markdown").with_description("智能家居Skill；读取一次，版本变化后刷新。")))
        .chain(std::iter::once(Resource::new("mijia://assistant/v1/recovery","recovery-verification").with_mime_type("application/json").with_description("原版回退分支证据及验证状态；非执行授权。")))
        .collect()
}
pub fn read(uri: &str) -> Result<CallToolResult> {
    if uri==assistant_skill_uri(){return Ok(CallToolResult::success(vec![rmcp::model::ContentBlock::text(assistant_skill())]));}
    let prefix = format!("mijia://guide/v1/{}/", revision());
    let path = uri.strip_prefix(&prefix).ok_or_else(|| {
        AppError::new(
            "notFound",
            "指南 URI 不存在或修订已变更，请重新列出资源。",
            false,
        )
    })?;
    let (path, cursor) = path
        .split_once("?cursor=")
        .map(|(p, c)| (p, Some(c)))
        .unwrap_or((path, None));
    let (topic, tool) = path
        .split_once('/')
        .ok_or_else(|| AppError::invalid("指南 URI 无效。"))?;
    let mut args = json!({"topic":topic});
    if tool != "_" {
        args["tool"] = json!(tool);
    }
    if let Some(cursor) = cursor {
        args["cursor"] = json!(cursor);
    }
    query(&args)
}
pub fn reference_markdown() -> String {
    let mut text=format!("# MCP Agent 使用参考\n\n<!-- 由 docs/mcp-guide.json 与固定工具 Schema 生成；运行 npm run mcp:docs -->\n\n指南版本 {}，应用版本 {}。内置 resources 与打包 Skill 使用同源内容。\n\n",data()["version"],env!("CARGO_PKG_VERSION"));
    for topic in topics() {
        text.push_str(&format!("## {topic}\n\n"));
        if topic == "tools" {
            continue;
        }
        for row in rows(&topic, None).unwrap() {
            text.push_str(row["text"].as_str().unwrap());
            text.push_str("\n\n");
        }
    }
    for tool in tools::definitions() {
        let rows = rows("tools", Some(&tool.name)).unwrap();
        let header = &rows[0];
        text.push_str(&format!("## `{}`\n\n{}\n\n{}\n\n示例（占位设备与请求 ID 不可原样执行）：\n\n```json\n{}\n```\n\n",tool.name,header["description"].as_str().unwrap_or(""),header["usage"].as_str().unwrap_or(""),serde_json::to_string_pretty(&header["example"]).unwrap()));
        for row in &rows[1..] {
            let key = row["parameter"].as_str().unwrap();
            let required = header["required"]
                .as_array()
                .unwrap()
                .iter()
                .any(|r| r == key);
            text.push_str(&format!(
                "- `{key}`（{}）：{}\n\n```json\n{}\n```\n\n",
                if required {
                    "必填"
                } else {
                    "可选；条件要求见工具说明"
                },
                row["description"].as_str().unwrap_or(""),
                serde_json::to_string_pretty(&row["schema"]).unwrap()
            ));
        }
    }
    text
}

#[cfg(test)]
mod tests;
