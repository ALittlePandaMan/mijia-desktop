use super::fingerprint;
use crate::error::{AppError, Result};
use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::{json, Value};
pub fn budget(name: &str) -> usize {
    match name {
        "control_power" | "control_devices" => 2048,
        "find_devices" => 5120,
        _ => 4096,
    }
}
pub fn compact(value: Value) -> CallToolResult {
    // Text-only clients receive the same projection, with no duplicated raw JSON.
    fn render(value: &Value, path: &str, lines: &mut Vec<String>) {
        match value {
            Value::Object(map) => {
                for (key, value) in map {
                    let key = if path.is_empty() {
                        key.clone()
                    } else {
                        format!("{path}.{key}")
                    };
                    render(value, &key, lines)
                }
            }
            Value::Array(items) => {
                for (i, item) in items.iter().enumerate() {
                    render(item, &format!("{path}[{i}]"), lines)
                }
            }
            _ => lines.push(format!(
                "{path}={}",
                value
                    .as_str()
                    .map(str::to_owned)
                    .unwrap_or_else(|| value.to_string())
            )),
        }
    }
    let mut lines = vec![];
    render(&value, "", &mut lines);
    let mut result = CallToolResult::structured(value);
    result.content = vec![ContentBlock::text(lines.join("\n"))];
    result
}
pub fn bytes(value: &Value) -> usize {
    serde_json::to_vec(&compact(value.clone())).unwrap().len()
}
pub fn bounded(mut value: Value, max: usize) -> Result<CallToolResult> {
    // Only display labels/messages may be abbreviated. IDs and evidence never are.
    fn shorten(v: &mut Value) {
        match v {
            Value::Object(map) => {
                for (k, v) in map {
                    if matches!(k.as_str(), "name" | "label" | "message" | "reason" | "room") {
                        if let Some(s) = v.as_str() {
                            if s.chars().count() > 64 {
                                *v = Value::String(s.chars().take(63).collect::<String>() + "…");
                            }
                        }
                    } else {
                        shorten(v)
                    }
                }
            }
            Value::Array(items) => {
                for v in items {
                    shorten(v)
                }
            }
            _ => {}
        }
    }
    shorten(&mut value);
    let result = compact(value);
    if serde_json::to_vec(&result).unwrap().len() > max {
        Err(AppError::new(
            "responseBudget",
            "结果超过本页预算，请缩小查询范围。",
            false,
        ))
    } else {
        Ok(result)
    }
}
pub fn page(
    scope: &str,
    revision: &str,
    start: usize,
    rows: &[Value],
    mut base: Value,
    max: usize,
    limit: usize,
) -> Result<CallToolResult> {
    let mut items = vec![];
    let mut end = start.min(rows.len());
    base["total"] = json!(rows.len());
    base["revision"] = json!(revision);
    loop {
        base["items"] = json!(items);
        base["detailsComplete"] = json!(end >= rows.len());
        base["cursor"] = if end < rows.len() {
            json!(cursor(scope, revision, end))
        } else {
            Value::Null
        };
        if end >= rows.len() || items.len() >= limit {
            return bounded(base, max);
        }
        let mut candidate = base.clone();
        let mut next = items.clone();
        next.push(rows[end].clone());
        candidate["items"] = json!(next);
        candidate["detailsComplete"] = json!(end + 1 >= rows.len());
        candidate["cursor"] = json!(cursor(scope, revision, end + 1));
        if bytes(&candidate) > max {
            if items.is_empty() {
                return bounded(candidate, max);
            }
            return bounded(base, max);
        }
        items = next;
        end += 1;
    }
}
pub fn cursor(scope: &str, revision: &str, offset: usize) -> String {
    format!("{offset}:{}", fingerprint(&(scope, revision, offset)))
}
pub fn offset(token: Option<&str>, scope: &str, revision: &str) -> Result<usize> {
    if let Some(token) = token {
        let (value, _) = token
            .split_once(':')
            .ok_or_else(|| AppError::invalid("分页游标无效。"))?;
        let offset = value
            .parse::<usize>()
            .map_err(|_| AppError::invalid("分页游标无效。"))?;
        if cursor(scope, revision, offset) != token {
            return Err(AppError::new(
                "staleCursor",
                "目录或结果版本已变化，请重新查询。",
                false,
            ));
        }
        Ok(offset)
    } else {
        Ok(0)
    }
}

pub fn error(_name:&str,error:AppError)->CallToolResult{
 let mut result=bounded(serde_json::json!({"kind":error.kind,"message":error.message.chars().take(128).collect::<String>(),"retryable":error.retryable,"retryWrite":false,"guideResource":super::guide::assistant_skill_uri()}),4096).expect("fixed error");result.is_error=Some(true);result
}
