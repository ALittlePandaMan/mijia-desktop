use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub kind: String,
    pub message: String,
    pub retryable: bool,
}

pub type Result<T> = std::result::Result<T, AppError>;

impl AppError {
    pub fn new(kind: &str, message: impl Into<String>, retryable: bool) -> Self {
        Self {
            kind: kind.into(),
            message: message.into(),
            retryable,
        }
    }
    pub fn invalid(message: &str) -> Self {
        Self::new("invalidInput", message, false)
    }
    pub fn protocol() -> Self {
        Self::new(
            "protocol",
            "小米服务返回的数据格式无法识别，请稍后重试。",
            true,
        )
    }
    pub fn auth() -> Self {
        Self::new("authExpired", "登录已失效，请重新扫码登录。", false)
    }
    pub fn stale() -> Self {
        Self::new(
            "staleContext",
            "家庭或账号已经切换，请重新打开设备。",
            false,
        )
    }
    pub fn network(error: reqwest::Error) -> Self {
        // reqwest errors may contain URLs with login tokens. Never forward Display/Debug.
        Self::new(
            "network",
            if error.is_timeout() {
                "请求超时，请检查网络后重试。"
            } else {
                "无法连接小米服务，请检查网络后重试。"
            },
            true,
        )
    }
    pub fn device(code: i64) -> Self {
        let (kind, message) = match code {
            -704042011 => ("offline", "设备离线或暂时无法连接。"),
            -704010000 => ("permissionDenied", "此账号没有该操作的权限。"),
            -704030003 => ("unsupported", "设备不存在此属性。"),
            -704030013 => ("unsupported", "设备属性不可读取。"),
            -704220043 => ("invalidValue", "设备拒绝此属性值。"),
            _ => ("deviceError", "设备返回异常状态，请核实实际效果。"),
        };
        Self::new(kind, format!("{message}（设备代码 {code}）"), false)
    }
}

impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.message)
    }
}
impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn network_error_does_not_forward_sensitive_request_url() {
        let error = reqwest::Client::new()
            .get("invalid-url?serviceToken=synthetic-test-secret")
            .build()
            .unwrap_err();
        let view = AppError::network(error);
        let serialized = serde_json::to_string(&view).unwrap();
        assert_eq!(view.kind, "network");
        assert!(view.retryable);
        assert!(!serialized.contains("synthetic-test-secret"));
        assert!(!serialized.contains("serviceToken"));
    }
    #[test]
    fn unknown_device_errors_preserve_code_without_guessing_meaning() {
        let error = AppError::device(-704083036);
        assert_eq!(error.kind, "deviceError");
        assert!(error.message.contains("-704083036"));
    }
}
