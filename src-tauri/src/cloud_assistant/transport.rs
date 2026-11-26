use super::{
    error,
    protocol::{self, Event, SseDecoder, MAX_RESPONSE},
};
use crate::{auth::Credentials, error::Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use reqwest::{Client, Response};
use serde_json::{json, Value};
use std::{future::Future, io::Read, pin::Pin, sync::Arc, time::Duration};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;
pub type Io<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;
pub type Emit = Arc<dyn Fn(Event) + Send + Sync>;
#[derive(Clone, Debug, PartialEq)]
pub enum Endpoint {
    Token,
    HomeList,
    HomeRoomPage,
    DeviceListPage,
    Simple,
    Chat,
    Stream(String),
    Cancel(String),
}
impl Endpoint {
    pub fn location(&self) -> Result<(String, String)> {
        let (host, path, query) = match self {
            Self::Token => ("api.mijia.tech", "/miclaw/v2/oauth/get_token".into(), ""),
            Self::HomeList => ("api.mijia.tech", "/miclaw/v2/homeroom/gethome".into(), ""),
            Self::HomeRoomPage => ("api.mijia.tech", "/miclaw/v2/homeroom/get_dev_room_page".into(), ""),
            Self::DeviceListPage => ("api.mijia.tech", "/miclaw/v2/home/device_list_page".into(), ""),
            Self::Simple => (
                "api.mijia.tech",
                "/miclaw/v2/voicectrl/subAgent".into(),
                "?agentName=iotCopilot",
            ),
            Self::Chat => ("stream.api.mijia.tech", "/llm/miclaw/v1/chat".into(), ""),
            Self::Stream(id) | Self::Cancel(id) => {
                if id.is_empty()
                    || id.len() > 128
                    || !id
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
                {
                    return Err(error("assistantProtocol"));
                }
                let suffix = if matches!(self, Self::Stream(_)) {
                    "sse"
                } else {
                    "cancel"
                };
                (
                    "stream.api.mijia.tech",
                    format!("/llm/miclaw/v1/sessions/{id}/{suffix}"),
                    "",
                )
            }
        };
        Ok((format!("https://{host}/app{path}{query}"), path))
    }
    pub fn category(&self) -> &str {
        match self {
            Self::Token => "oauthToken",
            Self::HomeList => "homeList",
            Self::HomeRoomPage => "homeRoomPage",
            Self::DeviceListPage => "deviceListPage",
            Self::Simple => "subAgent",
            Self::Chat => "complexChat",
            Self::Stream(_) => "complexStream",
            Self::Cancel(_) => "complexCancel",
        }
    }
}
pub trait Wire: Send + Sync {
    fn scope<'a>(&'a self, oauth: &'a str, cancel: CancellationToken) -> Io<'a, String>;
    fn post<'a>(
        &'a self,
        c: &'a Credentials,
        access: &'a str,
        endpoint: Endpoint,
        body: Value,
        request_id: &'a str,
        cancel: CancellationToken,
    ) -> Io<'a, Value>;
    fn stream<'a>(
        &'a self,
        c: &'a Credentials,
        access: &'a str,
        session: &'a str,
        request_id: &'a str,
        cancel: CancellationToken,
        emit: Emit,
    ) -> Io<'a, ()>;
}
pub struct Http {
    client: Client,
}
impl Http {
    pub fn new() -> Result<Self> {
        Ok(Self {
            client: Client::builder()
                .user_agent(protocol::USER_AGENT)
                .redirect(reqwest::redirect::Policy::none())
                .connect_timeout(Duration::from_secs(15))
                .build()
                .map_err(|_| error("assistantNetwork"))?,
        })
    }
    async fn request(
        &self,
        c: &Credentials,
        access: &str,
        endpoint: &Endpoint,
        body: Value,
        id: &str,
    ) -> Result<(Response, Zeroizing<Vec<u8>>)> {
        if c.region != "cn" || c.service_id != "mijia" {
            return Err(error("assistantRegionUnsupported"));
        }
        let (url, path) = endpoint.location()?;
        let nonce = crate::crypto::random_nonce();
        let body = Zeroizing::new(body.to_string());
        let (form, key) =
            crate::crypto::encrypt_request_profile(&path, &body, &c.security, &nonce, true)?;
        let cookie = Zeroizing::new(
            if matches!(
                endpoint,
                Endpoint::Chat | Endpoint::Stream(_) | Endpoint::Cancel(_)
            ) {
                format!(
                    "cUserId={}; userId={}; serviceToken={}; access_token={access}",
                    c.c_user_id, c.user_id, c.service_token
                )
            } else {
                format!("userId={}; serviceToken={}", c.user_id, c.service_token)
            },
        );
        let accept = if matches!(endpoint, Endpoint::Stream(_)) {
            "text/event-stream"
        } else {
            "application/json"
        };
        let request = self
            .client
            .post(url)
            .header("Cookie", cookie.as_str())
            .header("MIOT-ENCRYPT-ALGORITHM", "ENCRYPT-RC4")
            .header("x-xiaomi-protocal-flag-cli", "PROTOCAL-HTTP2")
            .header("Accept-Encoding", "identity")
            .header("Accept", accept)
            .form(&form);
        let request = if uuid::Uuid::parse_str(id).is_ok() {
            request.header("Request-Id", id)
        } else {
            request
        };
        let response = request
            .send()
            .await
            .map_err(|_| error("assistantNetwork"))?;
        if !response.status().is_success() {
            return Err(error(
                if response.status().as_u16() == 401 && matches!(endpoint, Endpoint::Chat) {
                    "assistantChatInitUnauthorized"
                } else if response.status().as_u16() == 401 || response.status().as_u16() == 403 {
                    "assistantAuthorizationRequired"
                } else {
                    "assistantHttp"
                },
            ));
        }
        Ok((response, Zeroizing::new(key)))
    }
}
pub fn decode(bytes: &[u8], key: &[u8], gzip: bool) -> Result<Value> {
    if bytes.len() > MAX_RESPONSE {
        return Err(error("assistantResponseTooLarge"));
    }
    let plain = if bytes
        .iter()
        .find(|b| !b.is_ascii_whitespace())
        .is_some_and(|b| matches!(b, b'{' | b'['))
    {
        Zeroizing::new(bytes.to_vec())
    } else {
        let raw = B64.decode(bytes).map_err(|_| error("assistantProtocol"))?;
        Zeroizing::new(crate::crypto::rc4_drop(key, &raw)?)
    };
    let decoded = if gzip {
        let mut out = Zeroizing::new(vec![]);
        flate2::read::GzDecoder::new(plain.as_slice())
            .take(MAX_RESPONSE as u64 + 1)
            .read_to_end(&mut out)
            .map_err(|_| error("assistantProtocol"))?;
        if out.len() > MAX_RESPONSE {
            return Err(error("assistantResponseTooLarge"));
        }
        out
    } else {
        plain
    };
    serde_json::from_slice(&decoded).map_err(|_| error("assistantProtocol"))
}
async fn bytes(mut response: Response) -> Result<Vec<u8>> {
    let mut result = vec![];
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|_| error("assistantNetwork"))?
    {
        if result.len() + chunk.len() > MAX_RESPONSE {
            return Err(error("assistantResponseTooLarge"));
        }
        result.extend_from_slice(&chunk)
    }
    Ok(result)
}
fn gzip(r: &Response) -> bool {
    r.headers()
        .get("MIOT-CONTENT-ENCODING")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|s| s.eq_ignore_ascii_case("GZIP"))
}
impl Wire for Http {
    fn scope<'a>(&'a self, oauth: &'a str, cancel: CancellationToken) -> Io<'a, String> {
        Box::pin(async move {
            tokio::select! {_ =cancel.cancelled()=>Err(error("assistantCancelled")),result=tokio::time::timeout(Duration::from_secs(30),async{
               let cookie=Zeroizing::new(format!("oauth2.0_serviceToken={oauth}"));let response=self.client.get("https://account.xiaomi.com/oauth2/user-credentials/scopes").query(&[("client_id",protocol::CLIENT_ID),("sid","oauth2.0")]).header("Cookie",cookie.as_str()).send().await.map_err(|_|error("assistantNetwork"))?;
               if !response.status().is_success(){return Err(error(if matches!(response.status().as_u16(),401|403){"assistantAuthorizationRequired"}else{"assistantNetwork"}))}let raw=Zeroizing::new(bytes(response).await?);let value:Value=serde_json::from_slice(&raw).map_err(|_|error("assistantProtocol"))?;value["code"].as_str().filter(|s|!s.is_empty()&&s.len()<16384).map(str::to_owned).ok_or_else(||error("assistantAuthorizationRequired"))
            })=>result.map_err(|_|error("assistantTimeout"))?}
        })
    }
    fn post<'a>(
        &'a self,
        c: &'a Credentials,
        access: &'a str,
        endpoint: Endpoint,
        body: Value,
        id: &'a str,
        cancel: CancellationToken,
    ) -> Io<'a, Value> {
        Box::pin(async move {
            let timeout = if matches!(endpoint, Endpoint::Cancel(_)) {
                5
            } else {
                30
            };
            tokio::select! {_=cancel.cancelled()=>Err(error("assistantCancelled")),result=tokio::time::timeout(Duration::from_secs(timeout),async{let(response,key)=self.request(c,access,&endpoint,body,id).await?;let compressed=gzip(&response);decode(&bytes(response).await?,&key,compressed)})=>result.map_err(|_|error("assistantTimeout"))?}
        })
    }
    fn stream<'a>(
        &'a self,
        c: &'a Credentials,
        access: &'a str,
        session: &'a str,
        id: &'a str,
        cancel: CancellationToken,
        emit: Emit,
    ) -> Io<'a, ()> {
        Box::pin(async move {
            let run = async {
                let (mut response, key) = self
                    .request(
                        c,
                        access,
                        &Endpoint::Stream(session.into()),
                        json!({"session_id":session}),
                        id,
                    )
                    .await?;
                let compressed = gzip(&response);
                let mut parser = SseDecoder::default();
                let mut events = 0usize;
                loop {
                    let chunk = tokio::time::timeout(Duration::from_secs(45), response.chunk())
                        .await
                        .map_err(|_| error("assistantStreamIdleTimeout"))?
                        .map_err(|_| error("assistantNetwork"))?;
                    let Some(chunk) = chunk else {
                        parser.finish()?;
                        return Ok(());
                    };
                    for (kind, data) in parser.push(&chunk)? {
                        events += 1;
                        if events > 4096 {
                            return Err(error("assistantEventTooLarge"));
                        }
                        let decrypt = |s: &str| -> Result<String> {
                            let raw = B64
                                .decode(s.trim())
                                .map_err(|_| error("assistantStreamCorrupted"))?;
                            let plain = Zeroizing::new(crate::crypto::rc4_drop(&key, &raw)?);
                            let decoded = if compressed {
                                let mut result = vec![];
                                flate2::read::GzDecoder::new(plain.as_slice())
                                    .take(MAX_RESPONSE as u64 + 1)
                                    .read_to_end(&mut result)
                                    .map_err(|_| error("assistantStreamCorrupted"))?;
                                if result.len() > MAX_RESPONSE {
                                    return Err(error("assistantResponseTooLarge"));
                                }
                                result
                            } else {
                                plain.to_vec()
                            };
                            String::from_utf8(decoded)
                                .map_err(|_| error("assistantStreamCorrupted"))
                        };
                        let kind = if kind.is_empty() {
                            String::new()
                        } else {
                            decrypt(&kind)?
                        };
                        let raw = Zeroizing::new(decrypt(&data)?);
                        let v: Value = serde_json::from_str(&raw)
                            .map_err(|_| error("assistantStreamCorrupted"))?;
                        if let Some(event) = protocol::event(&kind, v) {
                            let done = event.kind == "CANCELLED"
                                || event.kind == "SESSION"
                                    && matches!(
                                        event.status.as_str(),
                                        "completed" | "failed" | "cancelled"
                                    )
                                || event.kind == "ERROR" && !event.recoverable;
                            emit(event);
                            if done {
                                return Ok(());
                            }
                        }
                    }
                }
            };
            tokio::select! {_=cancel.cancelled()=>Err(error("assistantCancelled")),result=tokio::time::timeout(Duration::from_secs(120),Box::pin(run))=>result.map_err(|_|error("assistantTimeout"))?}
        })
    }
}
