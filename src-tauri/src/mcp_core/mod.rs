//! MCP domain logic independent of Tauri and real devices. No cloud writes in tests.
pub mod catalog;
pub mod directory;
pub mod executor;
pub mod intent;
pub mod journal;
pub mod response;
pub mod assistant_result;
pub mod assistant_progress;
use crate::error::{AppError, Result};
use serde_json::Value;
use sha2::{Digest, Sha256};
pub fn fingerprint(value: &impl serde::Serialize) -> String {
    format!(
        "{:x}",
        Sha256::digest(serde_json::to_vec(value).unwrap_or_default())
    )
}
pub fn text<'a>(value: &'a Value, key: &str) -> Result<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty() && s.len() <= 512)
        .ok_or_else(|| AppError::invalid("缺少或无效的参数。"))
}
pub fn now_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

pub mod guide;
pub mod tools;
pub mod metrics;
#[cfg(test)]mod family_tests;
#[cfg(test)]mod protocol_tests;
