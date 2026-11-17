use super::{
    error,
    fallback::{self, Branch, Rule},
    protocol::{self, Event, RemoteResult, Request},
    scope::DelegatedScope,
    transport::{Emit, Endpoint, Io, Wire},
};
use crate::{auth::Credentials, error::Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::sync::{Arc, Mutex};
use tokio_util::sync::CancellationToken;

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Task {
    pub route_requested: String,
    pub route_used: Option<String>,
    pub intent_hash: String,
    pub scope: super::scope::TargetScope,
    pub authorization_generation: u64,
    pub phase: String,
    pub request_attempted: bool,
    pub request_submitted: Option<bool>,
    pub remote: Option<RemoteResult>,
    pub error: Option<String>,
    #[serde(default)]
    pub events: Vec<Event>,
    #[serde(default)]
    pub elapsed_ms: u64,
    #[serde(default)]
    pub trace: Vec<Stage>,
    #[serde(default)]
    pub attempts: Vec<Value>,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stage {
    pub phase: String,
    pub endpoint_category: String,
    pub business_code: Option<i64>,
    pub elapsed_ms: u64,
}
impl Task {
    /// Retain the same bounded public progress, without inventing revisions for
    /// callbacks that no longer change it. SUBMIT is always a durable boundary.
    pub fn record_progress(&mut self, mut event: Event, elapsed_ms: u64) -> bool {
        let mut changed = self.phase != event.status;
        if changed { self.phase.clone_from(&event.status); }
        if self.trace.len() < 100 {
            self.trace.push(Stage { phase: event.kind.clone(), endpoint_category: if self.route_requested == "simple" { "subAgent" } else { "complexStream" }.into(), business_code: event.code, elapsed_ms });
            changed = true;
        }
        if event.kind == "SUBMIT" {
            self.request_attempted = true; self.request_submitted = None;
            self.route_used = Some(self.route_requested.clone()); changed = true;
        }
        if self.events.len() < 100 {
            event.content.clear(); event.metadata.clear(); self.events.push(event); changed = true;
        }
        changed
    }
    pub fn summary(&self, id: &str, status: &str, revision: u64) -> Value {
        json!({"requestId":id,"kind":"cloudAssistant","taskStatus":status,"phase":self.phase,"revision":revision,"routeRequested":self.route_requested,"routeUsed":self.remote.as_ref().map(|r|r.route_used.as_str()).or(self.route_used.as_deref()),"fallbackReason":self.remote.as_ref().and_then(|r|r.fallback_reason.as_deref()),"recovery":self.remote.as_ref().and_then(|r|r.recovery.as_ref()),"requestAttempted":self.request_attempted,"requestSubmitted":self.request_submitted,"outcome":self.remote.as_ref().map(|r|r.outcome.as_str()).unwrap_or(if status=="running"{"pending"}else if self.request_attempted{"unknown"}else{"failed"}),"remoteReportedSuccess":self.remote.as_ref().map(|r|r.remote_reported_success),"verification":"notPerformed","error":self.error,"retryWrite":false,"elapsedMs":self.elapsed_ms,"modelTokens":Value::Null,"detailsAvailable":true,"detailsComplete":false,"retryAfterMs":if status=="running"{1000}else{0}})
    }
    pub fn details(&self) -> Vec<Value> {
        let mut result = vec![];
        if let Some(remote) = &self.remote {
            result.push(json!({"source":"cloudAssistantUntrusted","code":remote.code,"businessCode":remote.business_code,"status":remote.status,"remoteReportedSuccess":remote.remote_reported_success,"verification":remote.verification,"recovery":remote.recovery}));
            let chars: Vec<_> = remote.reply.chars().collect();
            for (part, text) in chars.chunks(300).enumerate() {
                result.push(json!({"source":"cloudAssistantUntrusted","part":part,"reply":text.iter().collect::<String>()}));
            }
            result.extend(remote.devices.iter().cloned());
            result.extend(remote.artifacts.iter().cloned());
        }
        result.extend(self.events.iter().map(|e|json!({"source":"cloudAssistantProgress","event":e.kind,"status":e.status,"code":e.code})));
        result.extend(self.trace.iter().map(|s|json!({"source":"backendTrace","phase":s.phase,"endpointCategory":s.endpoint_category,"businessCode":s.business_code,"elapsedMs":s.elapsed_ms})));
        result.extend(self.attempts.iter().cloned());
        result
    }
}
#[derive(Default)]
struct Aggregate {
    answer: String,
    snapshot: String,
    artifacts: Vec<Value>,
    status: String,
    code: Option<i64>,
    cancelled: bool,
    failed: bool,
    terminal: bool,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RecoveryPhase { AssistantRefresh, ComplexFallback, MijiaRefresh }
/// Backend-only recovery contract. Caller inputs and cloud text cannot enable it.
/// `prepare_phase` MUST durably store a new internal UUID under the original
/// logical task before returning. A persistence failure prevents submission.
pub trait Recovery: Send + Sync {
    fn permits(&self, _rule: Rule) -> bool { false }
    fn prepare_phase<'a>(&'a self, _parent_id: &'a str, _phase: RecoveryPhase) -> Io<'a, String> {
        Box::pin(async { Err(error("assistantRecoveryUnavailable")) })
    }
    fn refresh_access<'a>(&'a self, _credentials: &'a Credentials) -> Io<'a, zeroize::Zeroizing<String>> {
        Box::pin(async { Err(error("assistantRecoveryUnavailable")) })
    }
    fn refresh_mijia<'a>(&'a self, _credentials: &'a Credentials) -> Io<'a, Credentials> {
        Box::pin(async { Err(error("assistantRecoveryUnavailable")) })
    }
}
struct DisabledRecovery;
impl Recovery for DisabledRecovery {}
pub async fn run(
    wire: Arc<dyn Wire>,
    credentials: &Credentials,
    access: &str,
    request: &Request,
    proof: &DelegatedScope,
    cancel: CancellationToken,
    emit: Emit,
) -> Result<RemoteResult> {
    run_with_recovery(wire, credentials, access, request, proof, cancel, emit, Arc::new(DisabledRecovery)).await
}
pub async fn run_with_recovery(
    wire: Arc<dyn Wire>, credentials: &Credentials, access: &str, request: &Request,
    proof: &DelegatedScope, cancel: CancellationToken, emit: Emit, recovery: Arc<dyn Recovery>,
) -> Result<RemoteResult> {
    request.validate()?;
    if cancel.is_cancelled() {
        return Err(error("assistantCancelled"));
    }
    let secrets = Arc::new(Mutex::new(zeroize::Zeroizing::new(vec![
        access.to_owned(),
        credentials.service_token.clone(),
        credentials.security.clone(),
    ])));
    let emit_secrets = secrets.clone();
    let sink = emit;
    let emit: Emit = Arc::new(move |mut e| {
        let known = emit_secrets.lock().unwrap();
        let values:Vec<_> = known.iter().map(String::as_str).collect();
        for secret in values.iter().filter(|s| !s.is_empty()) {
            e.status = e.status.replace(secret, "[redacted]");
            e.content = e.content.replace(secret, "[redacted]");
            e.session_id = e.session_id.replace(secret, "[redacted]");
            e.turn_id = e.turn_id.replace(secret, "[redacted]");
        }
        for value in &mut e.metadata { clean(value, &values); }
        drop(known);
        sink(e)
    });
    let mut token = zeroize::Zeroizing::new(access.to_owned());
    let mut renewed_credentials = None;
    let mut current_request = request.clone();
    let mut auth_retried = false;
    let mut route_fallback = None;
    let mut complex_proof = None;
    let mut phase_ids = std::collections::BTreeSet::from([request.request_id.clone()]);
    if request.complexity == "simple" {
      loop {
        emit(Event {
            kind: "SUBMIT".into(),
            status: "submitting".into(),
            content: String::new(),
            session_id: String::new(),
            turn_id: String::new(),
            code: None,
            recoverable: false,
            answer_snapshot: false,
            metadata: vec![],
        });
        if cancel.is_cancelled() { return Err(error("assistantCancelled")); }
        let response = wire
            .post(
                credentials,
                &token,
                Endpoint::Simple,
                protocol::simple_body(credentials, &token, &current_request, proof.target()),
                &current_request.request_id,
                cancel.clone(),
            )
            .await?;
        let mut result = protocol::simple_result(response)?;
        let rule = result.business_code.and_then(fallback::candidate);
        let Some(rule) = rule else { redact_known(&mut result, &secrets); return Ok(result); };
        if !recovery.permits(rule) {
            redact_known(&mut result, &secrets);
            return Ok(result);
        }
        if rule.branch == Branch::RefreshAssistant && !auth_retried {
            let id = prepared(&*recovery, &request.request_id, RecoveryPhase::AssistantRefresh, &mut phase_ids).await?;
            token = recovery.refresh_access(credentials).await?;
            secrets.lock().unwrap().push(token.to_string());
            auth_retried = true;
            current_request.request_id = id;
            continue;
        }
        let complex_rule = fallback::complex_candidate(rule.code).unwrap();
        if !recovery.permits(complex_rule) {
            result.recovery = Some(complex_rule.blocked());
            redact_known(&mut result, &secrets);
            return Ok(result);
        }
        let target = match proof.complex_target() {
            Ok(target) => target,
            Err(_) => {
                result.fallback_reason = Some("clarificationRequired".into());
                result.recovery = Some(json!({"code":rule.code,"candidateBranch":"complex","enabled":false,"reason":"clarificationRequired"}));
                redact_known(&mut result, &secrets);
                return Ok(result);
            }
        };
        current_request.request_id = prepared(&*recovery, &request.request_id, RecoveryPhase::ComplexFallback, &mut phase_ids).await?;
        current_request.complexity = "complex".into();
        route_fallback = Some(rule.code);
        complex_proof = Some(target);
        break;
      }
    }
    let proof = complex_proof.as_ref().unwrap_or(proof);
    let scope = proof.target();
    let mut body = json!({"query":request.query,"home_id":decimal(&scope.home_id)?,"auth_home_ids":proof.authorized_homes().iter().map(|id|decimal(id)).collect::<Result<Vec<_>>>()?});
    if !scope.owner_uid.is_empty() { body["owner_uid"] = json!(decimal(&scope.owner_uid)?); }
    if let Some(code) = route_fallback { body["xiaoai_code"] = json!(code); }
    emit(Event {
        kind: "SUBMIT".into(),
        status: "submitting".into(),
        content: String::new(),
        session_id: String::new(),
        turn_id: String::new(),
        code: None,
        recoverable: false,
        answer_snapshot: false,
        metadata: vec![],
    });
    if cancel.is_cancelled() { return Err(error("assistantCancelled")); }
    let mut chat = wire
        .post(
            credentials,
            &token,
            Endpoint::Chat,
            body.clone(),
            &current_request.request_id,
            cancel.clone(),
        )
        .await;
    if chat.as_ref().err().is_some_and(|e|e.kind == "assistantChatInitUnauthorized") {
        let rule = fallback::chat_init_unauthorized();
        if !auth_retried && recovery.permits(rule) {
            let id = prepared(&*recovery, &request.request_id, RecoveryPhase::MijiaRefresh, &mut phase_ids).await?;
            renewed_credentials = Some(recovery.refresh_mijia(credentials).await?);
            let next = renewed_credentials.as_ref().unwrap();
            if next.user_id != credentials.user_id || next.region != credentials.region || next.service_id != credentials.service_id {
                return Err(error("assistantAccountMismatch"));
            }
            { let mut known = secrets.lock().unwrap(); known.push(next.service_token.clone()); known.push(next.security.clone()); }
            current_request.request_id = id;
            chat = wire.post(next, &token, Endpoint::Chat, body, &current_request.request_id, cancel.clone()).await;
        } else {
            let reason = if auth_retried { "authenticationRetryLimitReached" } else { "preExecutionGuaranteeUnverified" };
            let mut blocked = rule.blocked();
            blocked["reason"] = json!(reason);
            return Ok(RemoteResult { route_requested:request.complexity.clone(), route_used:"complex".into(),
                fallback_reason:Some(reason.into()), remote_reported_success:false,
                submitted:None, verification:"notPerformed".into(), source:"cloudAssistantUntrusted".into(),
                code:Some(401), business_code:None, recovery:Some(blocked), status:"AUTHORIZATION_REQUIRED".into(),
                reply:String::new(), devices:vec![], outcome:"failed".into(), retry_write:false, artifacts:vec![] });
        }
    }
    let credentials = renewed_credentials.as_ref().unwrap_or(credentials);
    let chat = chat?;
    let session = chat["session_id"]
        .as_str()
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("assistantProtocol"))?
        .to_owned();
    Endpoint::Stream(session.clone()).location()?;
    let aggregate = Arc::new(Mutex::new(Aggregate::default()));
    let captured = aggregate.clone();
    let progress = emit.clone();
    let events: Emit = Arc::new(move |event| {
        let mut a = captured.lock().unwrap();
        match event.kind.as_str() {
            "SESSION" => {
                a.status = event.status.clone();
                a.terminal = matches!(a.status.as_str(), "completed" | "failed" | "cancelled");
                if a.answer.is_empty() && !event.content.is_empty() {
                    a.snapshot = event.content.clone();
                }
                if matches!(a.status.as_str(), "failed" | "cancelled") {
                    a.failed = true
                }
            }
            "ANSWER" => {
                if event.answer_snapshot {
                    a.snapshot = event.content.clone();
                } else {
                    let left = protocol::MAX_ANSWER.saturating_sub(a.answer.chars().count());
                    a.answer.extend(event.content.chars().take(left));
                }
            }
            "ERROR" => {
                a.code = event.code;
                if !event.recoverable {
                    a.failed = true;
                    a.terminal = true;
                }
            }
            "CANCELLED" => {
                a.cancelled = true;
                a.terminal = true;
                a.status = "cancelled".into()
            }
            _ => {}
        }
        for item in &event.metadata {
            if a.artifacts.len() < 200 && !a.artifacts.contains(item) {
                a.artifacts.push(item.clone());
            }
        }
        drop(a);
        progress(event)
    });
    let stream = wire
        .stream(
            credentials,
            &token,
            &session,
            &current_request.request_id,
            cancel,
            events,
        )
        .await;
    let finished = aggregate.lock().unwrap().status == "completed";
    if !aggregate.lock().unwrap().terminal {
        let mut cancel_body = json!({"home_id":decimal(&scope.home_id)?});
        if !scope.owner_uid.is_empty() { cancel_body["owner_uid"] = json!(decimal(&scope.owner_uid)?); }
        let _ = wire
            .post(
                credentials,
                &token,
                Endpoint::Cancel(session),
                cancel_body,
                &current_request.request_id,
                CancellationToken::new(),
            )
            .await;
    }
    stream?;
    let a = aggregate.lock().unwrap();
    if a.cancelled {
        return Err(error("assistantCancelled"));
    }
    let answer = if a.answer.is_empty() {
        &a.snapshot
    } else {
        &a.answer
    };
    let success = finished && !a.failed && (!answer.is_empty() || !a.artifacts.is_empty());
    let mut result = RemoteResult {
        route_requested: request.complexity.clone(),
        route_used: "complex".into(),
        fallback_reason: route_fallback.map(|code|format!("miot_status:{code}")),
        remote_reported_success: success,
        submitted: None,
        verification: "notPerformed".into(),
        source: "cloudAssistantUntrusted".into(),
        code: a.code,
        business_code: None,
        recovery: None,
        status: a.status.clone(),
        reply: answer.clone(),
        devices: vec![],
        outcome: if success { "unconfirmed" } else { "unknown" }.into(),
        retry_write: false,
        artifacts: a.artifacts.clone(),
    };
    redact_known(&mut result, &secrets);
    Ok(result)
}
async fn prepared(recovery: &dyn Recovery, parent: &str, phase: RecoveryPhase, used: &mut std::collections::BTreeSet<String>) -> Result<String> {
    let id = recovery.prepare_phase(parent, phase).await?;
    if uuid::Uuid::parse_str(&id).is_err() || !used.insert(id.clone()) {
        return Err(error("assistantPhasePersistenceRequired"));
    }
    Ok(id)
}
fn clean(v: &mut Value, secrets: &[&str]) {
        match v {
            Value::String(s) => {
                for secret in secrets.iter().filter(|s| !s.is_empty()) {
                    *s = s.replace(secret, "[redacted]");
                }
            }
            Value::Object(o) => {
                for v in o.values_mut() {
                    clean(v, secrets)
                }
            }
            Value::Array(a) => {
                for v in a {
                    clean(v, secrets)
                }
            }
            _ => {}
        }
}
fn redact_known(result: &mut RemoteResult, known: &Arc<Mutex<zeroize::Zeroizing<Vec<String>>>>) {
    let known = known.lock().unwrap();
    let secrets: Vec<_> = known.iter().map(String::as_str).collect();
    for secret in secrets.iter().filter(|s| !s.is_empty()) {
        result.reply = result.reply.replace(secret, "[redacted]");
        result.status = result.status.replace(secret, "[redacted]");
    }
    for v in &mut result.devices {
        clean(v, &secrets);
    }
    for v in &mut result.artifacts {
        clean(v, &secrets);
    }
}
fn decimal(s: &str) -> Result<u64> {
    let v = s
        .parse::<u64>()
        .ok()
        .filter(|v| *v <= 9_007_199_254_740_991);
    if s.is_empty() || !s.bytes().all(|b| b.is_ascii_digit()) || v.is_none() {
        Err(error("assistantProtocol"))
    } else {
        Ok(v.unwrap())
    }
}
