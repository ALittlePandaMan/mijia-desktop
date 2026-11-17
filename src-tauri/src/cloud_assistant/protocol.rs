use super::error;
use crate::error::Result;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub const CLIENT_ID: &str = "2882303761517233197";
pub const USER_AGENT:&str="miNative PC/Normal Windows/0 SDKV/1.0.0 MK/ L/zh_CN DEVT/UEM= DEVS/V2luZG93cw== BRA/ APP/mijia-desktop APPV/0.2.0 null/null";
pub const MAX_RESPONSE: usize = 4 * 1024 * 1024;
pub const MAX_EVENT: usize = 1_000_000;
pub const MAX_ANSWER: usize = 20_000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Request {
    pub query: String,
    pub complexity: String,
    pub request_id: String,
    #[serde(default)]
    #[serde(rename="home_id")]
    pub home_id: Option<String>,
}
impl Request {
    pub fn validate(&self) -> Result<()> {
        let n = self.query.trim().chars().count();
        if !(1..=2000).contains(&n)
            || !matches!(self.complexity.as_str(), "simple" | "complex")
            || uuid::Uuid::parse_str(&self.request_id).is_err()
        {
            return Err(crate::error::AppError::invalid(
                "助手请求需要1～2000字符原句、simple／complex和有效UUID。",
            ));
        }
        Ok(())
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteResult {
    pub route_requested: String,
    pub route_used: String,
    pub fallback_reason: Option<String>,
    pub remote_reported_success: bool,
    pub submitted: Option<bool>,
    pub verification: String,
    pub source: String,
    pub code: Option<i64>,
    #[serde(default)]
    pub business_code: Option<i64>,
    #[serde(default)]
    pub recovery: Option<Value>,
    pub status: String,
    pub reply: String,
    pub devices: Vec<Value>,
    pub outcome: String,
    pub retry_write: bool,
    #[serde(default)]
    pub artifacts: Vec<Value>,
}
pub fn text(value: &Value, key: &str, max: usize) -> String {
    value[key]
        .as_str()
        .unwrap_or("")
        .chars()
        .filter(|c| !c.is_control() || matches!(c, '\n' | '\t'))
        .take(max)
        .collect()
}
pub fn simple_result(value: Value) -> Result<RemoteResult> {
    let code = numeric_code(&value["code"]);
    let data = &value["data"];
    let status = text(data, "status", 80);
    let reply = text(data, "reply", MAX_ANSWER);
    let miot_status = decoded_json(&data["miot_status"]);
    let business_code = numeric_code(&miot_status["code"]);
    let invalid_business_status = !data["miot_status"].is_null() && !miot_status.is_object();
    let refused = business_code.is_some_and(|c| !matches!(c, 0 | 200));
    let recovery = business_code.and_then(super::fallback::candidate).map(|rule|rule.blocked());
    let reported = code == Some(200) && status == "SUCCESS" && !refused && !invalid_business_status;
    let mut devices = vec![];
    let instructions = decoded_json(data.get("instruction").filter(|v|!v.is_null())
        .or_else(||data.get("instructions")).unwrap_or(&Value::Null));
    for instruction in instructions.as_array().into_iter().flatten() {
        if instruction["header"]["name"] != "DeviceList" {
            continue;
        }
        for item in instruction["payload"]["items"]
            .as_array()
            .into_iter()
            .flatten()
            .take(100 - devices.len())
        {
            let name = text(&item["title"],"main_title",100);
            if name.is_empty() { continue; }
            devices.push(json!({"name":name,"room":text(&item["info"],"room",100),"status":text(&item["title"],"sub_title",256),"source":"cloudAssistantUnverified"}));
        }
    }
    let meaningful = !reply.trim().is_empty() || !devices.is_empty();
    Ok(RemoteResult {
        route_requested: "simple".into(),
        route_used: "simple".into(),
        fallback_reason: recovery.as_ref().map(|_| "preExecutionGuaranteeUnverified".into()),
        remote_reported_success: reported,
        submitted: None,
        verification: "notPerformed".into(),
        source: "cloudAssistantUntrusted".into(),
        code,
        business_code,
        recovery,
        status,
        reply,
        devices,
        outcome: if reported && meaningful {
            "unconfirmed"
        } else if reported {
            "unknown"
        } else if invalid_business_status {
            "unknown"
        } else if code.is_some() || refused {
            "failed"
        } else {
            "unknown"
        }
        .into(),
        retry_write: false,
        artifacts: vec![],
    })
}
pub fn numeric_code(value: &Value) -> Option<i64> {
    value.as_i64().or_else(||value.as_str()?.trim().parse().ok())
}
fn decoded_json(value: &Value) -> Value {
    if let Some(s) = value.as_str() {
        serde_json::from_str(s).unwrap_or(Value::Null)
    } else { value.clone() }
}
fn identifier(value: &Value) -> String {
    value.as_str().map(|s|s.chars().filter(|c|!c.is_control()).take(128).collect())
        .or_else(||value.as_u64().map(|n|n.to_string())).unwrap_or_default()
}
pub fn simple_body(
    c: &crate::auth::Credentials,
    access: &str,
    r: &Request,
    scope: &super::scope::TargetScope,
) -> Value {
    let id = uuid::Uuid::parse_str(&r.request_id)
        .unwrap()
        .simple()
        .to_string();
    let uid = c
        .user_id
        .parse::<u64>()
        .ok()
        .filter(|v| *v <= 9_007_199_254_740_991)
        .unwrap_or(0);
    let props = json!({"client_id":CLIENT_ID,"request_id":id,"device":{"device_id":c.device_id,"device_category":"Device/Desktop","app_name":"miui_voiceassist","user_agent":USER_AGENT,"screen_size":"Large","mask_device_id":c.device_id,"app_id":CLIENT_ID,"app_nick_name":"小爱","cross_devices_info":[]},"user":{"user_id":uid,"gender":"unknown","verified":"DeviceOAuth","id_type":"","extend":{"auth_type":"DeviceOAuth","access_token":access}},"xiaomi_id":c.user_id,"location":{"ip":""},"oauth":{"access_token":access,"client_id":CLIENT_ID},"contexts":[]});
    json!({"request_id":id,"refined_request":r.query,"query":{"platform":"Desktop"},"device_info":{"props":props.to_string()},"device_id_list":[],"home_id_list":scope.home_ids,"room_id_list":[]})
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub kind: String,
    pub status: String,
    pub content: String,
    pub session_id: String,
    pub turn_id: String,
    pub code: Option<i64>,
    pub recoverable: bool,
    #[serde(default)]
    pub answer_snapshot: bool,
    #[serde(default)]
    pub metadata: Vec<Value>,
}
pub fn event(kind: &str, v: Value) -> Option<Event> {
    let kind = kind.to_ascii_uppercase();
    if ![
        "SESSION",
        "ANSWER",
        "PLAN",
        "STEP",
        "TOOL",
        "ERROR",
        "CANCELLED",
    ]
    .contains(&kind.as_str())
    {
        return None;
    }
    let content = match kind.as_str() {
        "ANSWER" => {
            let delta = text(&v, "delta", MAX_ANSWER);
            if delta.is_empty() {
                text(&v, "content", MAX_ANSWER)
            } else {
                delta
            }
        }
        "PLAN" => text(&v, "message", 1000),
        "STEP" => text(&v, "summary", 1000),
        "TOOL" => text(&v, "tool_display_name", 200),
        "SESSION" => text(&v["result"], "answer", MAX_ANSWER),
        "ERROR" => String::new(),
        _ => String::new(),
    };
    Some(Event {
        kind: kind.clone(),
        status: if kind == "SESSION" {
            text(&v, "status", 80).to_ascii_lowercase()
        } else {
            text(&v, "status", 80)
        },
        content,
        session_id: text(&v, "session_id", 128),
        turn_id: text(&v, "turn_id", 128),
        code: numeric_code(&v["code"]),
        recoverable: v["recoverable"] == true,
        answer_snapshot: kind == "ANSWER" && text(&v, "delta", 1).is_empty(),
        metadata: metadata(&v["metadata"]),
    })
}
fn metadata(v: &Value) -> Vec<Value> {
    let mut rows = vec![];
    for item in v["videos"].as_array().into_iter().flatten().take(100) {
        rows.push(json!({"kind":"cameraEvent","time":item["time"].as_f64().or_else(||item["time"].as_str()?.parse::<f64>().ok()).filter(|v|v.is_finite()),"title":text(item,"title",100),"description":text(item,"description",1000),"source":"cloudAssistantUntrusted"}));
    }
    let mut scenes = 0;
    for key in ["created_scenes", "recommend_scenes"] {
        for item in v[key].as_array().into_iter().flatten().take(100 - scenes) {
            rows.push(json!({"kind":"scene","sceneId":identifier(&item["scene_id"]),"homeId":identifier(&item["home_id"]),"uid":identifier(&item["uid"]),"name":text(item,"name",100),"source":"cloudAssistantUntrusted"}));
            scenes += 1;
        }
    }
    rows
}
#[derive(Default)]
pub struct SseDecoder {
    buffer: Vec<u8>,
}
impl SseDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<(String, String)>> {
        let mut result = vec![];
        for &byte in bytes {
            self.buffer.push(byte);
            if self.buffer.len() > MAX_EVENT * 4 + 4096 {
                return Err(error("assistantEventTooLarge"));
            }
            let end = self.buffer.ends_with(b"\n\n") || self.buffer.ends_with(b"\r\n\r\n");
            if end {
                let block = String::from_utf8(std::mem::take(&mut self.buffer))
                    .map_err(|_| error("assistantStreamCorrupted"))?;
                if block.chars().count() > MAX_EVENT {
                    return Err(error("assistantEventTooLarge"));
                }
                let mut kind = String::new();
                let mut data = vec![];
                for line in block.lines() {
                    if let Some(s) = line.strip_prefix("event:") {
                        kind = s.trim().into()
                    }
                    if let Some(s) = line.strip_prefix("data:") {
                        data.push(s.trim().to_owned())
                    }
                }
                if !data.is_empty() {
                    result.push((kind, data.join("\n")))
                }
            }
        }
        Ok(result)
    }
    pub fn finish(&self) -> Result<()> {
        if self.buffer.iter().all(u8::is_ascii_whitespace) {
            Ok(())
        } else {
            Err(error("assistantStreamInterrupted"))
        }
    }
}
