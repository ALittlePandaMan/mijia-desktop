use crate::{
    error::{AppError, Result},
    models::{epoch_secs, id, QrView, SessionView},
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::{cookie::Jar, Client, Url};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{ops::Deref, sync::Arc, time::Duration};
use tokio::sync::Mutex;
use zeroize::{Zeroize, Zeroizing};
pub const USER_AGENT: &str =
    "Android-7.1.1-1.0.0-ONEPLUS A3010-136-22a7a2 APP/xiaomi.smarthome APPV/11.9.623";
const CREDENTIAL_SERVICE: &str = "io.mijiadesktop.client.session.v1";
const CREDENTIAL_ACCOUNT: &str = "active";
const AUTH_RESPONSE_LIMIT: usize = 1_000_000;
const QR_IMAGE_LIMIT: usize = 2_000_000;

// Intentionally no Debug: these fields must never reach logs, errors or the frontend.
#[derive(Serialize, Deserialize)]
pub struct Credentials {
    pub user_id: String,
    pub security: String,
    pub service_token: String,
    pub region: String,
    pub device_id: String,
    pub service_id: String,
    pub c_user_id: String,
}
impl Drop for Credentials {
    fn drop(&mut self) {
        self.user_id.zeroize();
        self.security.zeroize();
        self.service_token.zeroize();
        self.device_id.zeroize();
        self.c_user_id.zeroize();
    }
}
impl Credentials {
    pub fn view(&self) -> SessionView {
        SessionView {
            logged_in: true,
            user_id: Some(self.user_id.clone()),
            region: self.region.clone(),
        }
    }
    pub(crate) fn validate(&self) -> Result<()> {
        validate_region(&self.region)?;
        if self.user_id.is_empty()
            || !self.user_id.bytes().all(|b| b.is_ascii_digit())
            || self.service_token.is_empty()
            || self.device_id.is_empty()
            || !["mijia", "xiaomiio"].contains(&self.service_id.as_str())
            || !cookie_value(&self.service_token)
            || !cookie_value(&self.c_user_id)
            || !cookie_value(&self.device_id)
            || !matches!(B64.decode(&self.security).map(Zeroizing::new), Ok(v) if !v.is_empty())
        {
            return Err(AppError::auth());
        }
        Ok(())
    }
}

fn cookie_value(value: &str) -> bool {
    value
        .bytes()
        .all(|b| b.is_ascii_graphic() && !matches!(b, b'"' | b',' | b';' | b'\\'))
}

pub fn validate_region(region: &str) -> Result<()> {
    if ["cn", "de", "us", "ru", "tw", "sg", "in", "i2"].contains(&region) {
        Ok(())
    } else {
        Err(AppError::invalid("不支持的云服务地区。"))
    }
}

/// The application store uses a fixed target in the current operating-system user's secure store.
/// Verification stores have a separate, UUID-qualified target and cannot select it.
pub struct CredentialStore {
    entry: keyring::Entry,
}
impl CredentialStore {
    fn production() -> Result<Self> {
        Self::open(CREDENTIAL_SERVICE)
    }
    pub fn for_verification(id: uuid::Uuid) -> Result<Self> {
        Self::open(&format!("{CREDENTIAL_SERVICE}.verification.{id}"))
    }
    fn open(service: &str) -> Result<Self> {
        Ok(Self {
            entry: keyring::Entry::new(service, CREDENTIAL_ACCOUNT).map_err(|_| {
                AppError::new("credentialStore", "无法打开 系统凭据存储。", false)
            })?,
        })
    }
    pub fn load(&self) -> Result<Option<Credentials>> {
        match self.entry.get_password() {
            Ok(raw) => {
                let raw = Zeroizing::new(raw);
                let parsed = serde_json::from_str::<Credentials>(&raw);
                let credentials = parsed.map_err(|_| {
                    AppError::new(
                        "credentialStore",
                        "保存的会话损坏，请退出登录后重新扫码。",
                        false,
                    )
                })?;
                credentials.validate()?;
                Ok(Some(credentials))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(AppError::new(
                "credentialStore",
                "读取 系统凭据存储失败。",
                false,
            )),
        }
    }
    pub fn save(&self, credentials: &Credentials) -> Result<()> {
        credentials.validate()?;
        let raw =
            Zeroizing::new(serde_json::to_string(credentials).map_err(|_| AppError::protocol())?);
        self.entry.set_password(&raw).map_err(|_| {
            AppError::new(
                "credentialStore",
                "保存会话到 系统凭据存储失败。",
                false,
            )
        })
    }
    pub fn delete(&self) -> Result<()> {
        match self.entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(AppError::new(
                "credentialStore",
                "删除 Windows 保存的会话失败，请重试退出登录。",
                true,
            )),
        }
    }
}
pub fn load() -> Result<Option<Credentials>> {
    CredentialStore::production()?.load()
}
pub fn save(credentials: &Credentials) -> Result<()> {
    CredentialStore::production()?.save(credentials)
}
pub fn delete() -> Result<()> {
    CredentialStore::production()?.delete()
}

fn allowed_auth_url(url: &Url) -> bool {
    url.scheme() == "https"
        && url.port().is_none_or(|p| p == 443)
        && url.username().is_empty()
        && url.password().is_none()
        && url.host_str().is_some_and(|host| {
            host == "xiaomi.com"
                || host.ends_with(".xiaomi.com")
                || host == "mi.com"
                || host.ends_with(".mi.com")
                || host == "mijia.tech"
                || host.ends_with(".mijia.tech")
        })
}
fn auth_url(raw: &str) -> Result<Url> {
    let url = Url::parse(raw).map_err(|_| AppError::protocol())?;
    if allowed_auth_url(&url) {
        Ok(url)
    } else {
        Err(AppError::protocol())
    }
}
pub fn json_body(text: &str) -> Result<Value> {
    serde_json::from_str(
        text.trim()
            .strip_prefix("&&&START&&&")
            .unwrap_or(text.trim()),
    )
    .map_err(|_| AppError::protocol())
}

// The account response can also contain passToken, which this client never needs.
// Clear all JSON string values as well as the response buffer on every return path.
struct LoginResponse(Value);
impl Deref for LoginResponse {
    type Target = Value;
    fn deref(&self) -> &Value {
        &self.0
    }
}
impl Drop for LoginResponse {
    fn drop(&mut self) {
        fn clear(value: &mut Value) {
            match value {
                Value::String(text) => text.zeroize(),
                Value::Array(values) => values.iter_mut().for_each(clear),
                Value::Object(values) => values.values_mut().for_each(clear),
                _ => (),
            }
        }
        clear(&mut self.0);
    }
}
async fn bounded_bytes(
    mut response: reqwest::Response,
    limit: usize,
) -> Result<Zeroizing<Vec<u8>>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(AppError::protocol());
    }
    let mut bytes = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(AppError::network)? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
async fn login_response(response: reqwest::Response) -> Result<LoginResponse> {
    let bytes = bounded_bytes(response, AUTH_RESPONSE_LIMIT).await?;
    let text = std::str::from_utf8(&bytes).map_err(|_| AppError::protocol())?;
    Ok(LoginResponse(json_body(text)?))
}
fn successful_code(data: &Value) -> Result<()> {
    match data["code"].as_i64() {
        Some(0) => Ok(()),
        Some(_) => Err(AppError::new(
            "loginVerification",
            "请在手机上完成小米账号确认或验证，然后刷新二维码重试。",
            true,
        )),
        None => Err(AppError::protocol()),
    }
}
fn login_ready(data: &Value) -> Result<bool> {
    successful_code(data)?;
    let status = match data.get("securityStatus") {
        None => 0,
        Some(Value::Number(number)) => number.as_i64().ok_or_else(AppError::protocol)?,
        Some(Value::String(text)) => text.parse::<i64>().map_err(|_| AppError::protocol())?,
        Some(_) => return Err(AppError::protocol()),
    };
    if status != 0 {
        return Err(AppError::new(
            "loginVerification",
            "小米账号要求额外验证，请在手机上完成后重新扫码。",
            false,
        ));
    }
    Ok(data.get("location").is_some())
}
fn poll_timeout(expires_at: u64, now: u64) -> Option<Duration> {
    let remaining = expires_at.saturating_sub(now);
    (remaining > 0).then(|| Duration::from_secs(remaining.min(12)))
}

pub struct LoginAttempt {
    pub id: String,
    pub expires_at: u64,
    pub region: String,
    client: Client,
    jar: Arc<Jar>,
    polling_url: Url,
    device_id: String,
    service_id: String,
    pub poll_lock: Mutex<()>,
}

pub enum PollResult {
    Pending,
    Expired,
    Success(Credentials),
}

impl LoginAttempt {
    pub async fn start(region: &str) -> Result<(Self, QrView)> {
        validate_region(region)?;
        let jar = Arc::new(Jar::default());
        let device_id = uuid::Uuid::new_v4().simple().to_string();
        jar.add_cookie_str(
            &format!("deviceId={device_id}; Path=/; Secure"),
            &Url::parse("https://account.xiaomi.com").unwrap(),
        );
        let client = Client::builder()
            .user_agent(USER_AGENT)
            .cookie_provider(jar.clone())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::custom(|attempt| {
                if attempt.previous().len() > 8 || !allowed_auth_url(attempt.url()) {
                    attempt.stop()
                } else {
                    attempt.follow()
                }
            }))
            .build()
            .map_err(AppError::network)?;
        let service_id = if region == "cn" { "mijia" } else { "xiaomiio" };
        let mut query = vec![("sid", service_id.to_owned())];
        if service_id == "xiaomiio" {
            query.extend([
                ("_qrsize", "480".to_owned()),
                ("qs", "%3Fsid%3Dxiaomiio%26_json%3Dtrue".to_owned()),
                ("callback", "https://sts.api.io.mi.com/sts".to_owned()),
                ("_hasLogo", "false".to_owned()),
                ("serviceParam", String::new()),
                ("_locale", "zh_CN".to_owned()),
                ("_dc", (epoch_secs() * 1000).to_string()),
            ]);
        }
        let issued_at = epoch_secs();
        let response = client
            .get("https://account.xiaomi.com/longPolling/loginUrl")
            .query(&query)
            .send()
            .await
            .map_err(AppError::network)?;
        if !response.status().is_success() {
            return Err(AppError::new(
                "login",
                "无法获取扫码登录入口，请稍后重试。",
                true,
            ));
        }
        let data = login_response(response).await?;
        successful_code(&data)?;
        let qr_url = auth_url(data["qr"].as_str().ok_or_else(AppError::protocol)?)?;
        let polling_url = auth_url(data["lp"].as_str().ok_or_else(AppError::protocol)?)?;
        let image = client.get(qr_url).send().await.map_err(AppError::network)?;
        if !image.status().is_success() {
            return Err(AppError::new("login", "二维码加载失败。", true));
        }
        let mime = image
            .headers()
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|x| x.to_str().ok())
            .unwrap_or("")
            .split(';')
            .next()
            .unwrap_or("")
            .to_owned();
        if !["image/png", "image/jpeg", "image/gif", "image/webp"].contains(&mime.as_str()) {
            return Err(AppError::protocol());
        }
        let bytes = bounded_bytes(image, QR_IMAGE_LIMIT).await?;
        let expires_at = issued_at.saturating_add(data["timeout"].as_u64().unwrap_or(180).min(600));
        if epoch_secs() >= expires_at {
            return Err(AppError::new("login", "二维码已过期，请重新获取。", true));
        }
        let attempt = Self {
            id: uuid::Uuid::new_v4().to_string(),
            expires_at,
            region: region.into(),
            client,
            jar,
            polling_url,
            device_id,
            service_id: service_id.into(),
            poll_lock: Mutex::new(()),
        };
        let view = QrView {
            attempt_id: attempt.id.clone(),
            qr_data_url: format!("data:{mime};base64,{}", B64.encode(bytes.as_slice())),
            expires_at,
        };
        Ok((attempt, view))
    }

    pub async fn poll(&self) -> Result<PollResult> {
        let Some(timeout) = poll_timeout(self.expires_at, epoch_secs()) else {
            return Ok(PollResult::Expired);
        };
        let response = match self
            .client
            .get(self.polling_url.clone())
            .timeout(timeout)
            .send()
            .await
        {
            Ok(r) => r,
            Err(error) if error.is_timeout() => {
                return Ok(if epoch_secs() >= self.expires_at {
                    PollResult::Expired
                } else {
                    PollResult::Pending
                })
            }
            Err(error) => return Err(AppError::network(error)),
        };
        if !response.status().is_success() {
            return Err(AppError::new(
                "login",
                "扫码确认请求失败，请刷新二维码。",
                true,
            ));
        }
        let data = login_response(response).await?;
        if epoch_secs() >= self.expires_at {
            return Ok(PollResult::Expired);
        }
        if !login_ready(&data)? {
            return Ok(PollResult::Pending);
        }
        self.finish_login(&data).await.map(PollResult::Success)
    }

    async fn finish_login(&self, data: &Value) -> Result<Credentials> {
        let mut location = auth_url(data["location"].as_str().ok_or_else(AppError::protocol)?)?;
        let security = Zeroizing::new(
            data["ssecurity"]
                .as_str()
                .ok_or_else(AppError::protocol)?
                .to_owned(),
        );
        let user_id = id(&data["userId"]);
        if self.service_id == "mijia" {
            let nonce = data["nonce"]
                .as_i64()
                .or_else(|| data["nonce"].as_str().and_then(|s| s.parse().ok()))
                .ok_or_else(AppError::protocol)?;
            location
                .query_pairs_mut()
                .append_pair(
                    "clientSign",
                    &crate::crypto::sts_signature(nonce, &security),
                )
                .append_pair("_userIdNeedEncrypt", "true");
        }
        // APK STS exchange accepts 200/302 and reads this response's cookies without following redirects.
        let sts_client = Client::builder()
            .user_agent(USER_AGENT)
            .cookie_provider(self.jar.clone())
            .timeout(Duration::from_secs(30))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(AppError::network)?;
        let response = sts_client
            .get(location)
            .send()
            .await
            .map_err(AppError::network)?;
        if response.status().as_u16() != 200 && response.status().as_u16() != 302 {
            return Err(AppError::new(
                "login",
                "账号确认后获取米家会话失败，请重新扫码。",
                true,
            ));
        }
        let mut primary = None;
        let mut fallback = None;
        for cookie in response.cookies() {
            if cookie.value().is_empty() {
                continue;
            }
            if cookie.name() == "mijia_serviceToken" {
                primary = Some(cookie.value().to_owned());
            }
            if cookie.name() == "serviceToken" {
                fallback = Some(cookie.value().to_owned());
            }
        }
        let token = primary.or(fallback);
        let credentials = Credentials {
            user_id,
            security: security.to_string(),
            service_token: token.ok_or_else(AppError::auth)?,
            region: self.region.clone(),
            device_id: self.device_id.clone(),
            service_id: self.service_id.clone(),
            c_user_id: id(&data["cUserId"]),
        };
        credentials.validate()?;
        Ok(credentials)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn login_destinations_cannot_escape_xiaomi_tls_hosts() {
        for raw in [
            "https://account.xiaomi.com.evil.org/",
            "http://account.xiaomi.com/",
            "https://evilmi.com/",
            "https://user@account.xiaomi.com/",
            "https://account.xiaomi.com:8443/",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://account.xiaomi.com@127.0.0.1/",
            "https://account.xiaomi.com./",
        ] {
            assert!(auth_url(raw).is_err());
        }
        assert!(auth_url("https://sts.api.io.mi.com/sts?ticket=test").is_ok());
        assert!(auth_url("https://account.xiaomi.com/longPolling/loginUrl").is_ok());
        assert!(auth_url("https://api.mijia.tech/sts").is_ok());
    }
    #[test]
    fn parses_xiaomi_json_prefix() {
        assert_eq!(json_body("&&&START&&&{\"code\":0}").unwrap()["code"], 0);
        assert_eq!(
            json_body(" \n&&&START&&&{\"code\":0}\n").unwrap()["code"],
            0
        );
        assert!(json_body("&&&START&&&not json").is_err());
    }
    #[test]
    fn polling_deadline_never_extends_the_qr_lifetime() {
        assert_eq!(poll_timeout(100, 88), Some(Duration::from_secs(12)));
        assert_eq!(poll_timeout(100, 99), Some(Duration::from_secs(1)));
        assert_eq!(poll_timeout(100, 100), None);
        assert_eq!(poll_timeout(100, 101), None);
    }
    #[test]
    fn polling_errors_or_verification_are_never_treated_as_pending_or_success() {
        for value in [
            serde_json::json!({}),
            serde_json::json!({"code": "0"}),
            serde_json::json!({"code": 1}),
            serde_json::json!({"code": 0, "securityStatus": 1}),
            serde_json::json!({"code": 0, "securityStatus": "1"}),
            serde_json::json!({"code": 0, "securityStatus": true}),
            serde_json::json!({"code": 0, "securityStatus": "unknown"}),
        ] {
            assert!(login_ready(&value).is_err());
        }
        assert!(!login_ready(&serde_json::json!({"code":0})).unwrap());
        assert!(login_ready(&serde_json::json!({
            "code":0,"securityStatus":"0","location":"https://api.mijia.tech/sts"
        }))
        .unwrap());
    }
    fn credentials() -> Credentials {
        Credentials {
            user_id: "0".into(),
            security: B64.encode([0; 16]),
            service_token: "isolated-test-token".into(),
            region: "cn".into(),
            device_id: uuid::Uuid::new_v4().simple().to_string(),
            service_id: "mijia".into(),
            c_user_id: "isolated-test-user".into(),
        }
    }
    #[test]
    fn invalid_persisted_credentials_cannot_inject_cloud_cookies() {
        assert!(credentials().validate().is_ok());
        for value in [
            "x; serviceToken=other",
            "x\r\nCookie:other",
            "x y",
            "x\\y",
            "x,y",
            "x\"y",
            "设备",
        ] {
            let mut credentials = credentials();
            credentials.device_id = value.into();
            assert!(credentials.validate().is_err());
            credentials.device_id = "safe".into();
            credentials.service_token = value.into();
            assert!(credentials.validate().is_err());
            credentials.service_token = "safe".into();
            credentials.c_user_id = value.into();
            assert!(credentials.validate().is_err());
        }
    }
    #[test]
    fn persisted_credentials_require_identity_key_service_and_region() {
        let mut credentials = credentials();
        credentials.user_id = "not-numeric".into();
        assert!(credentials.validate().is_err());
        credentials.user_id = "0".into();
        credentials.security = "not-base64".into();
        assert!(credentials.validate().is_err());
        credentials.security = B64.encode([0; 16]);
        credentials.service_id = "unrelated-service".into();
        assert!(credentials.validate().is_err());
        credentials.service_id = "mijia".into();
        credentials.region = "evil.example".into();
        assert!(credentials.validate().is_err());
    }
}
