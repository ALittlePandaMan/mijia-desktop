use super::{
    error,
    protocol::CLIENT_ID,
    transport::{Endpoint, Http, Wire},
};
use crate::{
    auth::{Credentials, LoginAttempt, PollResult},
    account_sso::AccountSso,
    error::Result,
    models::{epoch_secs, QrView},
};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use zeroize::{Zeroize, Zeroizing};

#[derive(Clone, Serialize, Deserialize)]
pub struct Secrets {
    user: String,
    oauth_sid: String,
    access: String,
    refresh: String,
    obtained: u64,
    expires: u64,
}
impl Drop for Secrets {
    fn drop(&mut self) {
        self.oauth_sid.zeroize();
        self.access.zeroize();
        self.refresh.zeroize();
    }
}
impl Secrets {
    pub fn parse(user: &str, oauth: &str, value: Value, now: u64) -> Result<Self> {
        if value["code"] != 0 {
            return Err(error("assistantAuthorizationRequired"));
        }
        let result = &value["result"];
        let access = result["access_token"]
            .as_str()
            .filter(|s| valid_secret(s))
            .ok_or_else(|| error("assistantProtocol"))?;
        let duration = result["expires_in"]
            .as_u64()
            .or_else(|| result["expires_in"].as_str().and_then(|s| s.parse().ok()))
            .filter(|n| *n > 0 && *n <= 366 * 86400)
            .ok_or_else(|| error("assistantTokenExpiryInvalid"))?;
        let refresh = result["refresh_token"].as_str().unwrap_or("");
        if !refresh.is_empty() && !valid_secret(refresh) {
            return Err(error("assistantProtocol"));
        }
        Ok(Self {
            user: user.into(),
            oauth_sid: oauth.into(),
            access: access.into(),
            refresh: refresh.into(),
            obtained: now,
            expires: now
                .checked_add(duration)
                .ok_or_else(|| error("assistantTokenExpiryInvalid"))?,
        })
    }
    fn valid_for(&self, user: &str) -> bool {
        self.user == user
            && valid_secret(&self.oauth_sid)
            && valid_secret(&self.access)
            && self.expires > self.obtained
            && self.expires - self.obtained <= 366 * 86400
    }
    fn refresh_at(&self) -> u64 {
        self.expires
            .saturating_sub(((self.expires - self.obtained) / 10).min(60).max(1))
    }
}
fn valid_secret(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 32768
        && s.bytes()
            .all(|b| b.is_ascii_graphic() && !matches!(b, b'"' | b',' | b';' | b'\\'))
}
// Existing control callers keep their authorization-required business contract;
// the richer verification classification is for the login/status lifecycle.
fn control_authorization_error(error:crate::error::AppError)->crate::error::AppError {
    if error.kind=="assistantSsoVerificationRequired" {super::error("assistantAuthorizationRequired")}else{error}
}
pub trait SecretStore: Send + Sync {
    fn load(&self, scope: &str) -> Result<Option<Secrets>>;
    fn save(&self, scope: &str, secrets: &Secrets) -> Result<()>;
    fn delete(&self, scope: &str) -> Result<()>;
}
pub struct SystemStore;
impl SystemStore {
    fn entry(scope: &str) -> Result<keyring::Entry> {
        keyring::Entry::new("io.mijiadesktop.client.cloud-assistant.v1", scope)
            .map_err(|_| error("assistantCredentialStore"))
    }
}
impl SecretStore for SystemStore {
    fn load(&self, scope: &str) -> Result<Option<Secrets>> {
        match Self::entry(scope)?.get_password() {
            Ok(raw) => {
                let raw = Zeroizing::new(raw);
                serde_json::from_str(&raw)
                    .map(Some)
                    .map_err(|_| error("assistantCredentialStore"))
            }
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(_) => Err(error("assistantCredentialStore")),
        }
    }
    fn save(&self, scope: &str, secrets: &Secrets) -> Result<()> {
        let raw =
            Zeroizing::new(serde_json::to_string(secrets).map_err(|_| error("assistantProtocol"))?);
        Self::entry(scope)?
            .set_password(&raw)
            .map_err(|_| error("assistantCredentialStore"))
    }
    fn delete(&self, scope: &str) -> Result<()> {
        match Self::entry(scope)?.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(_) => Err(error("assistantCredentialStore")),
        }
    }
}
#[derive(Clone, PartialEq, Eq)]
struct Binding {
    scope: String,
    user: String,
    epoch: u64,
}
impl Binding {
    fn new(c: &Credentials, epoch: u64) -> Self {
        Self {
            scope: crate::preferences::PreferenceStore::scope(&c.user_id, &c.region),
            user: c.user_id.clone(),
            epoch,
        }
    }
}
struct Inner {
    binding: Option<Binding>,
    generation: u64,
    cancel: CancellationToken,
    secrets: Option<Secrets>,
    attempt: Option<Arc<LoginAttempt>>,
    refresh_error: bool,
    retry_after: u64,
    connecting: bool,
    reconnect_attempted: bool,
    connection_error: Option<ConnectionFailure>,
}
// Only fixed classifications leave the backend; never forward a cloud response.
struct ConnectionFailure { reason: &'static str, reverify: bool }
impl ConnectionFailure {
    fn from_error(error: &crate::error::AppError, missing_sso: bool) -> Self {
        let reverify = matches!(error.kind.as_str(), "loginVerification" | "authExpired" | "assistantSsoVerificationRequired" | "assistantAccountMismatch")
            || (missing_sso && error.kind == "assistantAuthorizationRequired");
        let reason = if reverify { "assistantLoginVerificationRequired" } else { match error.kind.as_str() {
            "network" | "assistantNetwork" | "assistantAuthorizationNetwork" => "assistantNetwork",
            "assistantTimeout" => "assistantTimeout",
            "accountSsoStore" | "assistantCredentialStore" => "assistantCredentialStore",
            "assistantAuthorizationRequired" => "assistantAuthorizationRejected",
            _ => "assistantConnectionFailed",
        }};
        Self { reason, reverify }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub state: String,
    pub expires_at: Option<u64>,
    pub authorization_generation: u64,
    pub region_supported: bool,
    pub scope_guarantee: String,
    pub simple_available: bool,
    pub complex_available: bool,
    pub unavailable_reason: String,
    pub client_identity: String,
    pub skill_version: String,
    #[serde(default)]
    pub sso_available: bool,
    #[serde(default)]
    pub auto_reconnect: bool,
    #[serde(default)]
    pub reverify_required: bool,
}
impl Status {
    pub fn unavailable(state: &str) -> Self {
        Self {
            state: state.into(),
            expires_at: None,
            authorization_generation: 0,
            region_supported: false,
            scope_guarantee: "householdDelegationUnverified".into(),
            simple_available: false,
            complex_available: false,
            unavailable_reason: state.into(),
            client_identity: format!("privateCompatibility:{CLIENT_ID}"),
            skill_version: crate::mcp_core::guide::revision().into(),
            sso_available: false,
            auto_reconnect: false,
            reverify_required: false,
        }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Poll {
    pub status: String,
    pub authorization: Status,
}
pub struct Authorization {
    inner: Mutex<Inner>,
    flight: Mutex<()>,
    wire: Arc<dyn Wire>,
    store: Arc<dyn SecretStore>,
    sso: Arc<AccountSso>,
}
impl Authorization {
    pub fn production() -> Result<Self> {
        Ok(Self::with_sso(Arc::new(Http::new()?), Arc::new(SystemStore),Arc::new(AccountSso::production())))
    }
    pub fn new(wire: Arc<dyn Wire>, store: Arc<dyn SecretStore>) -> Self {
        Self::with_sso(wire,store,Arc::new(AccountSso::offline()))
    }
    pub fn with_sso(wire: Arc<dyn Wire>, store: Arc<dyn SecretStore>,sso:Arc<AccountSso>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                binding: None,
                generation: 0,
                cancel: CancellationToken::new(),
                secrets: None,
                attempt: None,
                refresh_error: false,
                retry_after: 0,
                connecting: false,
                reconnect_attempted: false,
                connection_error: None,
            }),
            flight: Mutex::new(()),
            wire,
            store,
            sso,
        }
    }
    async fn bind(&self, c: &Credentials, epoch: u64) -> Result<(Binding, u64, CancellationToken)> {
        if c.region != "cn" || c.service_id != "mijia" {
            return Err(error("assistantRegionUnsupported"));
        }
        let binding = Binding::new(c, epoch);
        self.sso.bind_account(c,epoch).await?;
        let mut inner = self.inner.lock().await;
        if inner.binding.as_ref().is_some_and(|b| b.epoch > epoch) {
            return Err(crate::error::AppError::stale());
        }
        if inner.binding.as_ref().is_some_and(|b|b.scope==binding.scope&&b.user==binding.user) {
            // Renewing a SID for this account is not a new logical authorization.
            if let Some(current)=inner.binding.as_mut(){current.epoch=epoch;}
        } else {
            inner.cancel.cancel();
            inner.cancel = CancellationToken::new();
            inner.generation += 1;
            inner.attempt = None;
            inner.secrets = None;
            inner.refresh_error = false;
            inner.retry_after = 0;
            inner.connecting = false;
            inner.reconnect_attempted = false;
            inner.connection_error = None;
            if let Some(old) = inner.binding.take() {
                if old.scope!=binding.scope{self.store.delete(&old.scope)?;}
            }
            inner.binding = Some(binding.clone());
            let stored = self.store.load(&binding.scope)?;
            if let Some(stored) = stored {
                if stored.valid_for(&binding.user) {
                    if !self.sso.availability(c,epoch).await?.opted_out {
                        self.sso.remember_oauth(c,epoch,&crate::auth::OAuthCredentials{user_id:binding.user.clone(),service_token:stored.oauth_sid.clone()}).await?;
                    }
                    inner.secrets = Some(stored)
                } else {
                    self.store.delete(&binding.scope)?;
                }
            }
        }
        Ok((binding, inner.generation, inner.cancel.clone()))
    }
    fn check(inner: &Inner, binding: &Binding, generation: u64) -> Result<()> {
        if !inner.binding.as_ref().is_some_and(|b|b.scope==binding.scope&&b.user==binding.user)
            || inner.generation != generation
            || inner.cancel.is_cancelled()
        {
            Err(crate::error::AppError::stale())
        } else {
            Ok(())
        }
    }
    pub async fn status(&self, c: &Credentials, epoch: u64) -> Result<Status> {
        if c.region != "cn" || c.service_id != "mijia" {
            return Ok(Status::unavailable("assistantRegionUnsupported"));
        }
        let (_, _, _) = self.bind(c, epoch).await?;
        let availability=self.sso.availability(c,epoch).await?;
        let inner = self.inner.lock().await;
        let state = if inner.attempt.is_some() {
            "waitingForScan"
        } else if availability.opted_out {
            "disabled"
        } else if inner.connecting {
            "reconnecting"
        } else if inner
            .secrets
            .as_ref()
            .is_some_and(|s| s.expires > epoch_secs())
        {
            if inner.refresh_error {
                "authorizedRefreshDeferred"
            } else {
                "authorized"
            }
        } else if inner.connection_error.as_ref().is_some_and(|e| !e.reverify) {
            "connectionFailed"
        } else if inner.secrets.is_some() {
            "expired"
        } else {
            "authorizationRequired"
        };
        Ok(Status {
            state: state.into(),
            expires_at: inner.secrets.as_ref().map(|s| s.expires),
            authorization_generation: inner.generation,
            region_supported: true,
            scope_guarantee: "householdDelegationUnverified".into(),
            simple_available: state.starts_with("authorized"),
            complex_available: state.starts_with("authorized"),
            unavailable_reason: if state.starts_with("authorized"){String::new()}else if state=="reconnecting"{"assistantConnecting".into()}else{inner.connection_error.as_ref().map(|e|e.reason).unwrap_or("assistantAuthorizationRequired").into()},
            client_identity: format!("privateCompatibility:{CLIENT_ID}"),
            skill_version: crate::mcp_core::guide::revision().into(),
            sso_available: availability.reusable,
            auto_reconnect: !availability.opted_out,
            reverify_required: !matches!(state,"reconnecting"|"waitingForScan"|"disabled") && !state.starts_with("authorized")
                && inner.connection_error.as_ref().map(|e|e.reverify).unwrap_or(!availability.reusable),
        })
    }
    pub async fn start(&self, c: &Credentials, epoch: u64) -> Result<QrView> {
        let (binding, generation, cancel) = self.bind(c, epoch).await?;
        {
            self.inner.lock().await.attempt = None;
        }
        let (attempt, view) = tokio::select! {_=cancel.cancelled()=>return Err(error("assistantCancelled")),r=Box::pin(LoginAttempt::start("cn"))=>r?};
        let mut inner = self.inner.lock().await;
        Self::check(&inner, &binding, generation)?;
        inner.attempt = Some(Arc::new(attempt));
        Ok(view)
    }
    pub async fn cancel_login(&self, id: &str) {
        let mut inner = self.inner.lock().await;
        if inner.attempt.as_ref().is_some_and(|a| a.id == id) {
            inner.attempt = None;
        }
    }
    pub async fn poll(&self, c: &Credentials, epoch: u64, id: &str) -> Result<Poll> {
        let (binding, generation, cancel) = self.bind(c, epoch).await?;
        let attempt = self
            .inner
            .lock()
            .await
            .attempt
            .clone()
            .filter(|a| a.id == id)
            .ok_or_else(crate::error::AppError::stale)?;
        let _poll = attempt.poll_lock.try_lock().map_err(|_| error("busy"))?;
        let result = tokio::select! {_=cancel.cancelled()=>return Err(error("assistantCancelled")),r=Box::pin(attempt.poll())=>r};
        {
            let inner = self.inner.lock().await;
            Self::check(&inner, &binding, generation)?;
            if !inner
                .attempt
                .as_ref()
                .is_some_and(|a| Arc::ptr_eq(a, &attempt))
            {
                return Err(crate::error::AppError::stale());
            }
        }
        let result = match result {
            Ok(result) => result,
            Err(e) => {
                self.cancel_login(id).await;
                return Err(e);
            }
        };
        let state = match result {
            PollResult::Pending => "pending",
            PollResult::Expired => {
                self.cancel_login(id).await;
                "expired"
            }
            PollResult::Success(verified,pass) => {
                if verified.user_id!=binding.user {self.cancel_login(id).await;return Err(error("assistantAccountMismatch"));}
                let _flight = self.flight.lock().await;
                {let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;}
                self.sso.remember_login(&verified,epoch,pass).await?;
                let oauth=self.sso.oauth(&verified,epoch,false).await?;
                let code = Zeroizing::new(
                    self.wire
                        .scope(&oauth.service_token, cancel.clone())
                        .await?,
                );
                let token=self.wire.post(&verified,"",Endpoint::Token,json!({"service_token":B64.encode(oauth.service_token.as_bytes()),"code":B64.encode(code.as_bytes()),"pt":0,"scope_data":"","refresh_token":""}),"assistant-authorization",cancel.clone()).await?;
                let secrets =
                    Secrets::parse(&binding.user, &oauth.service_token, token, epoch_secs())?;
                let mut inner = self.inner.lock().await;
                Self::check(&inner, &binding, generation)?;
                if !inner
                    .attempt
                    .as_ref()
                    .is_some_and(|a| Arc::ptr_eq(a, &attempt))
                {
                    return Err(crate::error::AppError::stale());
                }
                self.store.save(&binding.scope, &secrets)?;
                inner.secrets = Some(secrets);
                inner.attempt = None;
                inner.refresh_error = false;
                inner.reconnect_attempted = false;
                "success"
            }
        };
        Ok(Poll {
            status: state.into(),
            authorization: self.status(c, epoch).await?,
        })
    }
    /// Best-effort login bootstrap: never holds up or revokes the MIoT login.
    /// Generation + cancellation prevent an old login from saving late tokens.
    pub async fn prepare_bootstrap(&self,c:&Credentials,epoch:u64)->Result<u64>{Ok(self.bind(c,epoch).await?.1)}
    pub async fn bootstrap(&self,c:&Credentials,epoch:u64,generation:u64,pass:Option<Zeroizing<String>>)->Result<()>{
        let binding=Binding::new(c,epoch);
        let cancel={let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;inner.cancel.clone()};
        let _flight=self.flight.lock().await;
        {let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;}
        if pass.is_some(){self.sso.remember_login(c,epoch,pass).await?;}
        if self.sso.availability(c,epoch).await?.opted_out{return Err(error("assistantAuthorizationRequired"));}
        {let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
         if inner.secrets.as_ref().is_some_and(|s|s.expires>epoch_secs()){return Ok(());}}
        let oauth=tokio::select!{_=cancel.cancelled()=>return Err(error("assistantCancelled")),r=Box::pin(self.sso.oauth(c,epoch,false))=>r?};
        if oauth.user_id!=binding.user{return Err(error("assistantAccountMismatch"));}
        match self.accept_bootstrap(c,epoch,oauth,generation,cancel.clone()).await {
            Err(e) if e.kind=="assistantAuthorizationRequired" => {
                // Scope/token authorization is read/authentication work, never a
                // replay of an assistant device request.
                let oauth=self.sso.oauth(c,epoch,true).await?;
                self.accept_bootstrap(c,epoch,oauth,generation,cancel).await
            },
            result=>result,
        }
    }
    /// Register the handoff and save this scan before the homepage can query
    /// status. Only credential-store I/O is awaited here, never cloud I/O.
    pub async fn begin_login(self:&Arc<Self>,c:&Credentials,epoch:u64,pass:Option<Zeroizing<String>>)->Result<()> {
        let (binding,_,_)=self.bind(c,epoch).await?;
        let (generation,saved)={
            let mut inner=self.inner.lock().await;
            if inner.binding.as_ref().is_none_or(|b|b.scope!=binding.scope||b.epoch!=epoch){return Err(crate::error::AppError::stale());}
            // Explicit login supersedes an older login, including the same
            // account. Routine SID refreshes do not change this generation.
            inner.cancel.cancel();inner.cancel=CancellationToken::new();inner.generation+=1;
            inner.attempt=None;inner.connecting=true;inner.reconnect_attempted=true;inner.connection_error=None;
            let generation=inner.generation;
            let saved=self.sso.remember_login(c,epoch,pass).await;
            (generation,saved)
        };
        if let Err(error)=saved {self.finish_connection(c,epoch,generation,Err(error)).await;return Ok(())}
        self.spawn_connection(c,epoch,generation);
        Ok(())
    }
    fn spawn_connection(self:&Arc<Self>,c:&Credentials,epoch:u64,generation:u64) {
        let auth=self.clone();let c=c.copy_secret();
        tokio::spawn(Box::pin(async move {
            let result=auth.bootstrap(&c,epoch,generation,None).await;
            auth.finish_connection(&c,epoch,generation,result).await;
        }));
    }
    async fn finish_connection(&self,c:&Credentials,epoch:u64,generation:u64,result:Result<()>) {
        let mut inner=self.inner.lock().await;
        if Self::check(&inner,&Binding::new(c,epoch),generation).is_err(){return}
        inner.connecting=false;
        inner.connection_error=match result {
            Ok(())=>None,
            Err(error)=>{
                let missing=self.sso.availability(c,epoch).await.map(|v|!v.reusable).unwrap_or(false);
                Some(ConnectionFailure::from_error(&error,missing))
            }
        };
    }
    /// One background attempt per binding; failures leave normal MiJia login intact.
    pub async fn ensure_connected(self:&Arc<Self>,c:&Credentials,epoch:u64)->Result<()> {
        let (binding,generation,_)=self.bind(c,epoch).await?;
        {let mut inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
         if inner.attempt.is_some()||inner.connecting||inner.reconnect_attempted||inner.secrets.as_ref().is_some_and(|s|s.expires>epoch_secs()){return Ok(())}
         let availability=self.sso.availability(c,epoch).await?;
         if availability.opted_out||!availability.reusable{return Ok(())}
         inner.connecting=true;inner.reconnect_attempted=true;inner.connection_error=None;}
        self.spawn_connection(c,epoch,generation);Ok(())
    }
    /// Explicit reconnect may use saved SSO but never asks the user to scan unless
    /// that account credential is missing/invalid. It does not change task identity.
    pub async fn reconnect(self:&Arc<Self>,c:&Credentials,epoch:u64)->Result<()> {
        let (binding,generation,_)=self.bind(c,epoch).await?;
        {let mut inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
         if inner.connecting{return Ok(())}
         self.sso.enable_assistant(c,epoch).await?;
         inner.attempt=None;inner.connecting=true;inner.reconnect_attempted=true;inner.connection_error=None;}
        self.spawn_connection(c,epoch,generation);Ok(())
    }
    async fn accept_bootstrap(&self,c:&Credentials,epoch:u64,oauth:crate::auth::OAuthCredentials,generation:u64,cancel:CancellationToken)->Result<()>{
        let binding=Binding::new(c,epoch);
        if oauth.user_id!=binding.user{return Err(error("assistantAccountMismatch"));}
        {let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
         self.sso.remember_oauth(c,epoch,&oauth).await?;}
        let code=Zeroizing::new(self.wire.scope(&oauth.service_token,cancel.clone()).await?);
        let token=self.wire.post(c,"",Endpoint::Token,json!({"service_token":B64.encode(oauth.service_token.as_bytes()),"code":B64.encode(code.as_bytes()),"pt":0,"scope_data":"","refresh_token":""}),"assistant-login-bootstrap",cancel).await?;
        let secrets=Secrets::parse(&binding.user,&oauth.service_token,token,epoch_secs())?;
        let mut inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
        self.store.save(&binding.scope,&secrets)?;inner.secrets=Some(secrets);inner.refresh_error=false;Ok(())
    }
    #[cfg(test)]pub async fn mock_bootstrap(&self,c:&Credentials,epoch:u64,oauth:crate::auth::OAuthCredentials)->Result<()>{
        let(_,generation,cancel)=self.bind(c,epoch).await?;let _flight=self.flight.lock().await;self.accept_bootstrap(c,epoch,oauth,generation,cancel).await
    }
    pub async fn access(&self, c: &Credentials, epoch: u64) -> Result<Zeroizing<String>> {
        let (binding, generation, cancel) = self.bind(c, epoch).await?;
        if self.sso.availability(c,epoch).await?.opted_out{return Err(error("assistantAuthorizationRequired"));}
        let _flight = self.flight.lock().await;
        let old = {
            let inner = self.inner.lock().await;
            Self::check(&inner, &binding, generation)?;
            let old = inner
                .secrets
                .clone()
                .ok_or_else(|| error("assistantAuthorizationRequired"))?;
            if inner.retry_after > epoch_secs() && old.expires > epoch_secs() {
                return Ok(Zeroizing::new(old.access.clone()));
            }
            old
        };
        if epoch_secs() < old.refresh_at() {
            return Ok(Zeroizing::new(old.access.clone()));
        }
        if old.refresh.is_empty() {
            if old.expires > epoch_secs() {
                return Ok(Zeroizing::new(old.access.clone()));
            }
            drop(_flight);
            self.bootstrap(c,epoch,generation,None).await.map_err(control_authorization_error)?;
            let inner=self.inner.lock().await;
            return inner.secrets.as_ref().map(|s|Zeroizing::new(s.access.clone())).ok_or_else(||error("assistantAuthorizationRequired"));
        }
        let refreshed = self
            .wire
            .post(
                c,
                "",
                Endpoint::Token,
                json!({"refresh_token":old.refresh}),
                "assistant-refresh",
                cancel,
            )
            .await
            .and_then(|v| Secrets::parse(&binding.user, &old.oauth_sid, v, epoch_secs()));
        let mut inner = self.inner.lock().await;
        Self::check(&inner, &binding, generation)?;
        match refreshed {
            Ok(mut next) => {
                if next.refresh.is_empty() {
                    next.refresh = old.refresh.clone()
                }
                self.store.save(&binding.scope, &next)?;
                let result = Zeroizing::new(next.access.clone());
                inner.secrets = Some(next);
                inner.refresh_error = false;
                inner.retry_after = 0;
                Ok(result)
            }
            Err(e) if e.kind != "assistantAuthorizationRequired" && old.expires > epoch_secs() => {
                inner.refresh_error = true;
                inner.retry_after = epoch_secs() + 30;
                Ok(Zeroizing::new(old.access.clone()))
            }
            Err(e) => {
                inner.secrets = None;
                self.store.delete(&binding.scope)?;
                drop(inner);
                drop(_flight);
                if self.sso.availability(c,epoch).await?.reusable {
                    self.bootstrap(c,epoch,generation,None).await.map_err(control_authorization_error)?;
                    let inner=self.inner.lock().await;
                    Self::check(&inner,&binding,generation)?;
                    inner.secrets.as_ref().map(|s|Zeroizing::new(s.access.clone())).ok_or_else(||error("assistantAuthorizationRequired"))
                } else {Err(e)}
            }
        }
    }
    /// Used only by an explicitly permitted pre-execution recovery branch.
    /// Refreshing tokens for this account never advances authorizationGeneration.
    pub async fn refresh_access(&self,c:&Credentials,epoch:u64)->Result<Zeroizing<String>> {
        let (binding,generation,cancel)=self.bind(c,epoch).await?;
        if self.sso.availability(c,epoch).await?.opted_out{return Err(error("assistantAuthorizationRequired"));}
        let _flight=self.flight.lock().await;
        let old={let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;inner.secrets.clone()};
        if let Some(old)=old.as_ref().filter(|s|!s.refresh.is_empty()) {
            let value=self.wire.post(c,"",Endpoint::Token,json!({"refresh_token":old.refresh}),"assistant-refresh",cancel.clone()).await;
            if let Ok(value)=value {if let Ok(mut next)=Secrets::parse(&binding.user,&old.oauth_sid,value,epoch_secs()) {
                if next.refresh.is_empty(){next.refresh=old.refresh.clone();}
                let mut inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;
                self.store.save(&binding.scope,&next)?;let access=Zeroizing::new(next.access.clone());inner.secrets=Some(next);inner.refresh_error=false;inner.retry_after=0;return Ok(access);
            }}
        }
        let oauth=self.sso.oauth(c,epoch,false).await?;
        self.accept_bootstrap(c,epoch,oauth,generation,cancel).await?;
        let inner=self.inner.lock().await;Self::check(&inner,&binding,generation)?;inner.secrets.as_ref().map(|s|Zeroizing::new(s.access.clone())).ok_or_else(||error("assistantAuthorizationRequired"))
    }
    pub async fn refresh_mijia(&self,c:&Credentials,epoch:u64)->Result<Credentials>{self.bind(c,epoch).await?;self.sso.mijia(c,epoch,true).await}
    pub async fn saved_mijia(&self,c:&Credentials,epoch:u64)->Result<Credentials>{self.bind(c,epoch).await?;self.sso.mijia(c,epoch,false).await}
    pub async fn revoke(&self) -> Result<()> {
        let mut inner = self.inner.lock().await;
        inner.cancel.cancel();
        inner.cancel = CancellationToken::new();
        inner.generation += 1;
        inner.secrets = None;
        inner.attempt = None;
        inner.connecting = false;
        inner.reconnect_attempted = true;
        inner.connection_error = None;
        if let Some(binding) = inner.binding.as_ref() {
            self.store.delete(&binding.scope)?
        }
        self.sso.disable_current().await?;
        Ok(())
    }
    pub async fn logout(&self)->Result<()> {
        let mut inner=self.inner.lock().await;inner.cancel.cancel();inner.cancel=CancellationToken::new();inner.generation+=1;inner.secrets=None;inner.attempt=None;inner.connecting=false;inner.reconnect_attempted=false;inner.connection_error=None;
        if let Some(binding)=inner.binding.take(){self.store.delete(&binding.scope)?;}
        self.sso.logout().await
    }
    pub async fn generation(&self) -> u64 {
        self.inner.lock().await.generation
    }
    pub fn wire(&self) -> Arc<dyn Wire> {
        self.wire.clone()
    }
}
