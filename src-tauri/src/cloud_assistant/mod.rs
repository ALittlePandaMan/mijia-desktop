//! Private cloud-assistant compatibility adapter. No arbitrary URLs or live test writes.
pub mod authorization;
pub mod dispatch;
pub mod execution;
pub mod fallback;
pub mod protocol;
pub mod scope;
pub mod transport;
pub use authorization::{Authorization, Status};
pub fn error(kind: &str) -> crate::error::AppError {
    let message = match kind {
        "assistantAuthorizationRequired" => "请在设置 → MCP 完成云端助手授权。",
        "assistantScopeUnverified" => "尚未验证云端强制执行逐设备／通道范围；请求未发送。",
        "assistantRegionUnsupported" => "云端助手目前仅支持中国区米家会话。",
        "assistantAccountMismatch" => "助手授权与当前米家账号不一致。",
        "assistantCancelled" => "助手任务已停止等待；这不表示撤销已发生的设备动作。",
        _ => "云端助手请求未完成，请查询原请求记录，不要重复下发。",
    };
    crate::error::AppError::new(kind, message, false)
}
#[cfg(test)]
mod tests;
