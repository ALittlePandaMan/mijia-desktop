//! Presentation only: never changes task identity, evidence or the persisted result.
use super::{journal::Record, response};
use crate::error::{AppError, Result};
use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::{json, Value};

pub const BUDGET: usize = 4096;

fn encoded(value: Value) -> CallToolResult {
    // JSON-escape external text even for text-only clients. It stays data, including newlines.
    let text = serde_json::to_string(&value).unwrap();
    let mut result = CallToolResult::structured(value);
    result.content = vec![ContentBlock::text(text)];
    result.is_error = Some(false); // Reserve the flag in the serialized budget, including refusals.
    result
}
fn fits(value: &Value) -> bool {
    serde_json::to_vec(&encoded(value.clone())).unwrap().len() <= BUDGET
}

fn detail_rows(record: &Record, base: &Value) -> Result<Vec<Value>> {
    let mut rows = vec![];
    // An exceptionally large row is losslessly split, not abbreviated. Normal detail
    // rows keep their existing shape. Include worst-case pagination overhead here.
    let mut probe = base.clone();
    probe["total"] = json!(usize::MAX);
    probe["revision"] = json!(record.revision.to_string());
    probe["cursor"] = json!(format!("{}:{}",usize::MAX,"0".repeat(64)));
    probe["detailsComplete"] = json!(false);
    for (index, row) in record.details().into_iter().enumerate() {
        probe["items"] = json!([row]);
        if fits(&probe) { rows.push(row); continue; }
        let text = serde_json::to_string(&row).unwrap();
        let chars:Vec<_> = text.chars().collect();
        let chunks:Vec<_> = chars.chunks(128).collect();
        for (part, chunk) in chunks.iter().enumerate() {
            let fragment = json!({"source":"cloudAssistantUntrusted","kind":"detailFragment","item":index,
                "part":part,"parts":chunks.len(),"encoding":"json","json":chunk.iter().copied().collect::<String>()});
            probe["items"] = json!([fragment]);
            if !fits(&probe) { return Err(AppError::new("responseBudget", "助手详情超过本页预算。", false)); }
            rows.push(fragment);
        }
    }
    Ok(rows)
}

pub fn render(record: &Record, args: &Value) -> Result<CallToolResult> {
    let task = record.assistant.as_ref().ok_or_else(|| AppError::invalid("助手任务不存在。"))?;
    let base = record.summary();
    let mut result = if args["details"] == true || args.get("cursor").is_some() {
        let rows = detail_rows(record, &base)?;
        let key = format!("{}:{}:{}:assistant:display-v4", record.scope, record.home, record.request_id);
        let revision = record.revision.to_string();
        let mut end = response::offset(args["cursor"].as_str(), &key, &revision)?.min(rows.len());
        let mut value = base;
        value["total"] = json!(rows.len());
        value["revision"] = json!(revision);
        value["items"] = json!([]);
        loop {
            value["detailsComplete"] = json!(end >= rows.len());
            value["cursor"] = if end < rows.len() { json!(response::cursor(&key, &revision, end)) } else { Value::Null };
            if end >= rows.len() || value["items"].as_array().unwrap().len() >= 10 { break; }
            let mut next = value.clone();
            next["items"].as_array_mut().unwrap().push(rows[end].clone());
            next["detailsComplete"] = json!(end + 1 >= rows.len());
            next["cursor"] = if end + 1 < rows.len() { json!(response::cursor(&key, &revision, end + 1)) } else { Value::Null };
            if !fits(&next) {
                if value["items"].as_array().unwrap().is_empty() { return Err(AppError::new("responseBudget", "助手详情超过本页预算。", false)); }
                break;
            }
            value = next;
            end += 1;
        }
        encoded(value)
    } else {
        let mut value = json!({
            "kind":"cloudAssistant", "requestId":record.request_id, "taskStatus":record.task_status,
            "revision":record.revision, "source":"cloudAssistantUntrusted",
            "outcome":base["outcome"], "requestSubmitted":task.request_submitted,
            "remoteReportedSuccess":base["remoteReportedSuccess"], "verification":"notPerformed",
            "retryWrite":false, "retryAfterMs":base["retryAfterMs"], "detailsAvailable":true,
            "truncated":false, "reply":"", "devices":[]
        });
        if let Some(error) = &task.error { value["error"] = json!(error); }
        if let Some(remote) = &task.remote {
            value["reply"] = json!(remote.reply);
            if !fits(&value) {
                value["truncated"] = json!(true);
                let chars: Vec<char> = remote.reply.chars().collect();
                let (mut low, mut high) = (0, chars.len());
                while low < high {
                    let middle = (low + high + 1) / 2;
                    value["reply"] = json!(chars[..middle].iter().collect::<String>());
                    if fits(&value) { low = middle; } else { high = middle - 1; }
                }
                value["reply"] = json!(chars[..low].iter().collect::<String>());
            }
            // Keep complete device values or omit the row; never shorten a numeric reading.
            for device in &remote.devices {
                value["devices"].as_array_mut().unwrap().push(device.clone());
                if !fits(&value) {
                    value["devices"].as_array_mut().unwrap().pop();
                    value["truncated"] = json!(true);
                    break;
                }
            }
        }
        if !fits(&value) { return Err(AppError::new("responseBudget", "助手结果超过摘要预算，请读取详情。", false)); }
        encoded(value)
    };
    if task.error.is_some() && !task.request_attempted { result.is_error = Some(true); }
    Ok(result)
}

#[cfg(test)]
pub(crate) mod tests;
