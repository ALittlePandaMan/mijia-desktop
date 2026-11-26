//! Shared cloud-scene parsing for device reminders.
use crate::{error::{AppError, Result}, models::id};
use serde_json::Value;

pub(crate) fn flag(value: &Value) -> Option<bool> {
    match value {
        Value::Bool(v) => Some(*v),
        Value::String(v) if v == "1" => Some(true),
        Value::String(v) if v == "0" => Some(false),
        _ => None,
    }
}

pub(crate) fn rows(scenes: &Value) -> Result<Vec<&Value>> {
    let rows: Vec<_> = match scenes {
        Value::Object(map) => map.values().collect(),
        Value::Array(rows) => rows.iter().collect(),
        _ => return Err(AppError::protocol()),
    };
    if rows.len() > 1000 {
        return Err(AppError::protocol());
    }
    Ok(rows)
}

pub(crate) fn scene_id(row: &Value) -> Option<String> {
    let id = id(&row["us_id"]);
    (!id.is_empty() && id != "0" && id.len() <= 20 && id.bytes().all(|b| b.is_ascii_digit()))
        .then_some(id)
}

pub(crate) fn matches_settings(row: &Value, expected: &Value) -> bool {
    if row["identify"] != expected["identify"] || row["name"] != expected["name"] {
        return false;
    }
    let Some(settings) = expected["setting"].as_object() else {
        return false;
    };
    settings.iter().all(|(key, value)| {
        if matches!(
            key.as_str(),
            "enable_timer" | "enable_timer_on" | "enable_timer_off" | "enable_push"
        ) {
            let parse = |v: &Value| match v {
                Value::Bool(v) => Some(*v),
                Value::String(v) if v == "0" => Some(false),
                Value::String(v) if v == "1" => Some(true),
                _ => None,
            };
            parse(value).is_some() && parse(value) == parse(&row["setting"][key])
        } else {
            row["setting"][key] == *value
        }
    })
}
