//! Offline mock-only regression tests. Never reads a production credential store.
#[path = "login_tests.rs"]
mod single_login;
#[path = "routing_tests.rs"]
mod routing;
use super::*;
use crate::{auth::Credentials, error::Result, models::epoch_secs};
use authorization::{SecretStore, Secrets};
use protocol::{Event, Request};
use serde_json::{json, Value};
use std::{
    collections::{HashMap, VecDeque},
    sync::{
        atomic::{AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use tokio_util::sync::CancellationToken;
use transport::{Emit, Endpoint, Io, Wire};
#[derive(Default)]
struct Store(Mutex<HashMap<String, Secrets>>);
impl SecretStore for Store {
    fn load(&self, s: &str) -> Result<Option<Secrets>> {
        Ok(self.0.lock().unwrap().get(s).cloned())
    }
    fn save(&self, s: &str, t: &Secrets) -> Result<()> {
        self.0.lock().unwrap().insert(s.into(), t.clone());
        Ok(())
    }
    fn delete(&self, s: &str) -> Result<()> {
        self.0.lock().unwrap().remove(s);
        Ok(())
    }
}
#[derive(Default)]
struct Mock {
    calls: Mutex<Vec<(Endpoint, Value)>>,
    request_ids: Mutex<Vec<String>>,
    replies: Mutex<VecDeque<Result<Value>>>,
    events: Mutex<Vec<Event>>,
    stream_error: Mutex<Option<String>>,
    delay_ms: AtomicUsize,
}
impl Wire for Mock {
    fn scope<'a>(&'a self, _: &'a str, _: CancellationToken) -> Io<'a, String> {
        Box::pin(async { Ok("synthetic-scope-code".into()) })
    }
    fn post<'a>(
        &'a self,
        _: &'a Credentials,
        _: &'a str,
        e: Endpoint,
        body: Value,
        request_id: &'a str,
        cancel: CancellationToken,
    ) -> Io<'a, Value> {
        Box::pin(async move {
            self.calls.lock().unwrap().push((e, body));
            self.request_ids.lock().unwrap().push(request_id.into());
            tokio::select! {_=cancel.cancelled()=>Err(error("assistantCancelled")),_=tokio::time::sleep(std::time::Duration::from_millis(self.delay_ms.load(Ordering::Relaxed) as u64))=>self.replies.lock().unwrap().pop_front().unwrap_or(Ok(json!({})))}
        })
    }
    fn stream<'a>(
        &'a self,
        _: &'a Credentials,
        _: &'a str,
        _: &'a str,
        _: &'a str,
        cancel: CancellationToken,
        emit: Emit,
    ) -> Io<'a, ()> {
        Box::pin(async move {
            for e in self.events.lock().unwrap().clone() {
                if cancel.is_cancelled() {
                    return Err(error("assistantCancelled"));
                }
                emit(e);
            }
            if let Some(e) = self.stream_error.lock().unwrap().as_deref() {
                return Err(error(e));
            }
            Ok(())
        })
    }
}
fn credentials(user: &str) -> Credentials {
    Credentials {
        user_id: user.into(),
        security: "AAECAwQFBgcICQoLDA0ODw==".into(),
        service_token: "synthetic-mijia".into(),
        region: "cn".into(),
        device_id: "mock-device".into(),
        service_id: "mijia".into(),
        c_user_id: "mock".into(),
    }
}
fn token(value: &str, seconds: u64) -> Value {
    json!({"code":0,"result":{"access_token":value,"refresh_token":"synthetic-refresh","expires_in":seconds}})
}
fn scope() -> scope::TargetScope {
    scope::TargetScope {
        home_id: "1".into(),
        home_ids: vec!["1".into()],
        owner_uid: "1".into(),
        auth_home_ids: vec!["1".into()],
        devices: vec![],
        permission_ids: vec![],
        channels: vec![],
        grant_epoch: 1,
        key_epoch: 1,
        directory_revision: "fixture".into(),
        auth_generation: 1,
    }
}
fn request(route: &str) -> Request {
    Request {
        query: "打开模拟客厅灯".into(),
        complexity: route.into(),
        request_id: uuid::Uuid::new_v4().to_string(),
        home_id: None,
    }
}

#[test]
fn aligned_simple_business_status_precedes_outer_success() {
    for status in [json!({"code":"2001004"}), json!("{\"code\":2001004}")] {
        let r=protocol::simple_result(json!({"code":"200","data":{"status":"SUCCESS","reply":"not authoritative","miot_status":status}})).unwrap();
        assert_eq!(r.code,Some(200));assert_eq!(r.business_code,Some(2001004));
        assert!(!r.remote_reported_success);assert_eq!(r.outcome,"failed");
        assert_eq!(r.recovery.as_ref().unwrap()["reason"],"preExecutionGuaranteeUnverified");
        assert!(!r.retry_write);
    }
    let r=protocol::simple_result(json!({"code":200,"data":{"status":"SUCCESS","reply":"x","miot_status":"broken"}})).unwrap();
    assert!(!r.remote_reported_success);assert_eq!(r.outcome,"unknown");
}
#[test]
fn aligned_instruction_aliases_decode_arrays_and_strings() {
    let list=json!([{"header":{"name":"DeviceList"},"payload":{"items":[{"title":{"main_title":"模拟灯","sub_title":"已关闭"},"info":{"room":"宿舍"}},{"title":{"main_title":""}}]}}]);
    for key in ["instruction","instructions"] {for body in [list.clone(),json!(list.to_string())] {
        let mut value=json!({"code":"200","data":{"status":"SUCCESS"}});value["data"][key]=body;
        let result=protocol::simple_result(value).unwrap();assert!(result.remote_reported_success);
        assert_eq!(result.devices.len(),1);assert_eq!(result.devices[0]["room"],"宿舍");
    }}
}
#[test]
fn aligned_rules_are_complete_candidates_with_no_production_permission() {
    assert_eq!(fallback::ROUTE_CODES.len(),47);assert_eq!(fallback::AUTH_CODES.len(),8);
    assert_eq!(fallback::rules().len(),64);
    for rule in fallback::rules() {assert!(!rule.enabled);assert_eq!(rule.verification,"unverified");assert!(!rule.evidence.is_empty());}
    assert_eq!(fallback::status()["enabledCount"],0);
    assert!(fallback::candidate(12345).is_none());
}
#[test]
fn aligned_catalog_endpoints_are_fixed_and_separate_from_control() {
    for (endpoint,path) in [(Endpoint::HomeList,"homeroom/gethome"),(Endpoint::HomeRoomPage,"homeroom/get_dev_room_page"),(Endpoint::DeviceListPage,"home/device_list_page")] {
        let (url,signature)=endpoint.location().unwrap();assert_eq!(url,format!("https://api.mijia.tech/app/miclaw/v2/{path}"));assert_eq!(signature,format!("/miclaw/v2/{path}"));
    }
}
#[test]
fn aligned_scope_preserves_target_owner_and_authorized_homes() {
    let mut target=scope();target.home_ids=vec!["1".into()];target.auth_home_ids=vec!["1".into(),"2".into()];target.owner_uid="7".into();
    let proof=scope::delegate(target.clone(),&["1".into(),"2".into()]).unwrap();assert_eq!(proof.authorized_homes().len(),2);
    assert!(scope::delegate(target,&["1".into()]).is_err());
    let old=json!({"homeId":"1","homeIds":["1"],"devices":[],"permissionIds":[],"channels":[],"grantEpoch":1,"keyEpoch":1,"directoryRevision":"old","authGeneration":1});
    let old:scope::TargetScope=serde_json::from_value(old).unwrap();let old=scope::delegate(old,&["1".into()]).unwrap();assert_eq!(old.authorized_homes(),&["1".to_string()]);
}

#[derive(Default)]
struct VerifiedRecovery {
    prepared:Mutex<Vec<(String,execution::RecoveryPhase,String)>>,
    refreshes:AtomicUsize,
    persistence_failure:bool,
    repeat_uuid:bool,
    wrong_account:bool,
    assistant_only:bool,
}
impl execution::Recovery for VerifiedRecovery {
    fn permits(&self,rule:fallback::Rule)->bool { !self.assistant_only || rule.branch == fallback::Branch::RefreshAssistant }
    fn prepare_phase<'a>(&'a self,parent:&'a str,phase:execution::RecoveryPhase)->Io<'a,String>{Box::pin(async move{
        if self.persistence_failure{return Err(error("mockPersistenceFailed"))}
        let mut records=self.prepared.lock().unwrap();let id=if self.repeat_uuid{records.first().map(|x|x.2.clone()).unwrap_or_else(||uuid::Uuid::new_v4().to_string())}else{uuid::Uuid::new_v4().to_string()};
        records.push((parent.into(),phase,id.clone()));Ok(id)
    })}
    fn refresh_access<'a>(&'a self,_:&'a Credentials)->Io<'a,zeroize::Zeroizing<String>>{Box::pin(async move{self.refreshes.fetch_add(1,Ordering::Relaxed);Ok(zeroize::Zeroizing::new("mock-refreshed-access".into()))})}
    fn refresh_mijia<'a>(&'a self,_:&'a Credentials)->Io<'a,Credentials>{Box::pin(async move{self.refreshes.fetch_add(1,Ordering::Relaxed);let mut c=credentials(if self.wrong_account{"2"}else{"1"});c.service_token="mock-refreshed-mijia".into();Ok(c)})}
}
#[tokio::test]
async fn aligned_verified_route_persists_child_id_and_uses_true_owner_and_scope() {
    let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().extend([
        Ok(json!({"code":200,"data":{"status":"FAILED","miot_status":{"code":2001004}}})),Ok(json!({"session_id":"mock-session"}))]);
    *wire.events.lock().unwrap()=vec![protocol::event("ANSWER",json!({"delta":"done"})).unwrap(),protocol::event("SESSION",json!({"status":"completed"})).unwrap()];
    let mut t=scope();t.home_id=String::new();t.owner_uid="7".into();t.auth_home_ids.push("2".into());
    let r=request("simple");let recovery=Arc::new(VerifiedRecovery::default());
    let result=execution::run_with_recovery(wire.clone(),&credentials("1"),"mock",&r,&scope::mock_verified(t),CancellationToken::new(),Arc::new(|_|{}),recovery.clone()).await.unwrap();
    assert_eq!(result.route_requested,"simple");assert_eq!(result.route_used,"complex");assert_eq!(result.fallback_reason.as_deref(),Some("miot_status:2001004"));
    let calls=wire.calls.lock().unwrap();assert_eq!(calls.len(),2);assert_eq!(calls[1].1["owner_uid"],7);assert_eq!(calls[1].1["auth_home_ids"],json!([1,2]));assert_eq!(calls[1].1["xiaoai_code"],2001004);
    let phases=recovery.prepared.lock().unwrap();assert_eq!(phases.len(),1);assert_eq!(phases[0].0,r.request_id);
    assert_eq!(wire.request_ids.lock().unwrap()[1],phases[0].2);
}
#[tokio::test]
async fn aligned_recovery_persistence_failure_prevents_second_submission() {
    let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().push_back(Ok(json!({"code":200,"data":{"miot_status":{"code":2001004}}})));
    let recovery=Arc::new(VerifiedRecovery{persistence_failure:true,..Default::default()});
    let result=execution::run_with_recovery(wire.clone(),&credentials("1"),"mock",&request("simple"),&scope::mock_verified(scope()),CancellationToken::new(),Arc::new(|_|{}),recovery).await;
    assert_eq!(result.err().unwrap().kind,"mockPersistenceFailed");assert_eq!(wire.calls.lock().unwrap().len(),1);
}
#[tokio::test]
async fn aligned_auth_refresh_and_fallback_have_independent_guarantees() {
    let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().extend((0..2).map(|_|Ok(json!({"code":200,"data":{"status":"SUCCESS","miot_status":{"code":2001002}}}))));
    let recovery=Arc::new(VerifiedRecovery{assistant_only:true,..Default::default()});
    let result=execution::run_with_recovery(wire.clone(),&credentials("1"),"mock",&request("simple"),&scope::mock_verified(scope()),CancellationToken::new(),Arc::new(|_|{}),recovery.clone()).await.unwrap();
    assert_eq!(wire.calls.lock().unwrap().len(),2);assert_eq!(recovery.refreshes.load(Ordering::Relaxed),1);
    assert_eq!(result.recovery.unwrap()["candidateBranch"],"complex");
}
#[tokio::test]
async fn aligned_recovery_never_reuses_phase_identity_or_retries_auth_twice() {
    for repeat_uuid in [true,false] {
        let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().extend([
            Ok(json!({"code":200,"data":{"miot_status":{"code":2001002}}})),Ok(json!({"code":200,"data":{"miot_status":{"code":2001002}}})),Err(error("assistantChatInitUnauthorized"))]);
        let recovery=Arc::new(VerifiedRecovery{repeat_uuid,..Default::default()});
        let result=execution::run_with_recovery(wire.clone(),&credentials("1"),"mock",&request("simple"),&scope::mock_verified(scope()),CancellationToken::new(),Arc::new(|_|{}),recovery.clone()).await;
        assert_eq!(recovery.refreshes.load(Ordering::Relaxed),1);
        if repeat_uuid {assert_eq!(result.err().unwrap().kind,"assistantPhasePersistenceRequired");assert_eq!(wire.calls.lock().unwrap().len(),2);}
        else {assert_eq!(result.unwrap().fallback_reason.as_deref(),Some("authenticationRetryLimitReached"));assert_eq!(wire.calls.lock().unwrap().len(),3);}
    }
}
#[tokio::test]
async fn aligned_chat_auth_refresh_rejects_account_change() {
    let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().push_back(Err(error("assistantChatInitUnauthorized")));
    let recovery=Arc::new(VerifiedRecovery{wrong_account:true,..Default::default()});
    let result=execution::run_with_recovery(wire.clone(),&credentials("1"),"mock",&request("complex"),&scope::mock_verified(scope()),CancellationToken::new(),Arc::new(|_|{}),recovery).await;
    assert_eq!(result.err().unwrap().kind,"assistantAccountMismatch");assert_eq!(wire.calls.lock().unwrap().len(),1);
}
#[tokio::test]
async fn aligned_terminal_error_does_not_cancel_or_replay_finished_session() {
    let wire=Arc::new(Mock::default());wire.replies.lock().unwrap().push_back(Ok(json!({"session_id":"mock-session"})));
    *wire.events.lock().unwrap()=vec![protocol::event("ERROR",json!({"code":"42","recoverable":false})).unwrap()];
    let result=execution::run(wire.clone(),&credentials("1"),"mock",&request("complex"),&scope::mock_verified(scope()),CancellationToken::new(),Arc::new(|_|{})).await.unwrap();
    assert!(!result.remote_reported_success);assert_eq!(result.code,Some(42));assert_eq!(wire.calls.lock().unwrap().len(),1);
}
fn setup(seconds: u64, age: u64) -> (Authorization, Arc<Mock>, Arc<Store>, Credentials) {
    let c = credentials("1");
    let wire = Arc::new(Mock::default());
    let store = Arc::new(Store::default());
    let secret = Secrets::parse(
        "1",
        "synthetic-oauth",
        token("synthetic-access", seconds),
        epoch_secs() - age,
    )
    .unwrap();
    store
        .save(
            &crate::preferences::PreferenceStore::scope("1", "cn"),
            &secret,
        )
        .unwrap();
    (
        Authorization::new(wire.clone(), store.clone()),
        wire,
        store,
        c,
    )
}
#[test]
fn deterministic_continuous_rc4_signature_matches_independent_vector() {
    let v: Value = serde_json::from_str(include_str!(
        "../fixtures/regression/protocol-assistant-vector.json"
    ))
    .unwrap();
    let (fields, _) = crate::crypto::encrypt_request_profile(
        v["path"].as_str().unwrap(),
        v["data"].as_str().unwrap(),
        v["security"].as_str().unwrap(),
        v["nonce"].as_str().unwrap(),
        true,
    )
    .unwrap();
    assert_eq!(serde_json::to_value(&fields).unwrap(), v["fields"]);
    let (query, _) = crate::crypto::encrypt_request_profile(
        &format!("{}?agentName=iotCopilot", v["path"].as_str().unwrap()),
        v["data"].as_str().unwrap(),
        v["security"].as_str().unwrap(),
        v["nonce"].as_str().unwrap(),
        true,
    )
    .unwrap();
    assert_eq!(query, fields);
}
#[test]
fn fixed_endpoints_cannot_select_urls_or_escape_session_path() {
    assert_eq!(
        Endpoint::Simple.location().unwrap(),
        (
            "https://api.mijia.tech/app/miclaw/v2/voicectrl/subAgent?agentName=iotCopilot".into(),
            "/miclaw/v2/voicectrl/subAgent".into()
        )
    );
    for id in ["../cancel", "https://evil/", "x?y", "a/b", ""] {
        assert!(Endpoint::Stream(id.into()).location().is_err())
    }
    assert!(Endpoint::Cancel("abc-123_xyz".into()).location().is_ok());
}
#[test]
fn token_expiry_is_required_and_never_defaults_to_months() {
    for expires in [Value::Null, json!(0), json!(-1), json!(999999999999u64)] {
        assert!(Secrets::parse(
            "1",
            "oauth",
            json!({"code":0,"result":{"access_token":"mock","expires_in":expires}}),
            1
        )
        .is_err());
    }
    assert!(Secrets::parse("1", "oauth", token("good", 100), 1).is_ok());
}
#[test]
fn request_validation_rejects_empty_oversize_invalid_route_uuid_and_extra_fields() {
    let mut r = request("simple");
    r.query = " \n ".into();
    assert!(r.validate().is_err());
    r.query = "灯".repeat(2001);
    assert!(r.validate().is_err());
    r.query = "灯".repeat(2000);
    assert!(r.validate().is_ok());
    r.complexity = "auto".into();
    assert!(r.validate().is_err());
    r.complexity = "simple".into();
    r.request_id = "reuse-me".into();
    assert!(r.validate().is_err());
    assert!(serde_json::from_value::<Request>(
        json!({"query":"开灯","complexity":"simple","requestId":uuid::Uuid::new_v4().to_string(),"host":"evil"})
    )
    .is_err());
}
#[test]
fn success_reply_is_not_hardware_confirmation() {
    let r = protocol::simple_result(
        json!({"code":200,"data":{"status":"SUCCESS","reply":"已收到请求"}}),
    )
    .unwrap();
    assert!(r.remote_reported_success);
    assert_eq!(r.submitted, None);
    assert_eq!(r.verification, "notPerformed");
    assert_eq!(r.outcome, "unconfirmed");
    assert!(!r.retry_write);
}
#[test]
fn partial_device_descriptions_remain_unverified_external_data() {
    let r=protocol::simple_result(json!({"code":200,"data":{"status":"SUCCESS","reply":"部分设备未完成","instruction":[{"header":{"name":"DeviceList"},"payload":{"items":[{"title":{"main_title":"模拟灯","sub_title":"失败"},"info":{"room":"模拟客厅"}}]}}]}})).unwrap();
    assert_eq!(r.devices[0]["source"], "cloudAssistantUnverified");
    assert_eq!(r.outcome, "unconfirmed");
}
#[test]
fn plain_encrypted_gzip_and_size_boundaries_are_distinct() {
    use base64::Engine;
    use std::io::Write;
    let key = [1u8; 32];
    let data = br#"{"code":200,"data":{"status":"SUCCESS"}}"#;
    assert_eq!(transport::decode(data, &key, false).unwrap()["code"], 200);
    let encrypted = base64::engine::general_purpose::STANDARD
        .encode(crate::crypto::rc4_drop(&key, data).unwrap());
    assert_eq!(
        transport::decode(encrypted.as_bytes(), &key, false).unwrap()["code"],
        200
    );
    let mut zipped = flate2::write::GzEncoder::new(vec![], flate2::Compression::default());
    zipped.write_all(data).unwrap();
    let encrypted = base64::engine::general_purpose::STANDARD
        .encode(crate::crypto::rc4_drop(&key, &zipped.finish().unwrap()).unwrap());
    assert_eq!(
        transport::decode(encrypted.as_bytes(), &key, true).unwrap()["code"],
        200
    );
    assert!(transport::decode(b"broken", &key, false).is_err());
    assert!(transport::decode(&vec![0; protocol::MAX_RESPONSE + 1], &key, false).is_err());
}
#[test]
fn compressed_output_limit_blocks_a_small_gzip_bomb() {
    use base64::Engine;
    use std::io::Write;
    let mut zipped = flate2::write::GzEncoder::new(vec![], flate2::Compression::fast());
    zipped
        .write_all(&vec![b'a'; protocol::MAX_RESPONSE + 1])
        .unwrap();
    let key = [2u8; 32];
    let encrypted = base64::engine::general_purpose::STANDARD
        .encode(crate::crypto::rc4_drop(&key, &zipped.finish().unwrap()).unwrap());
    assert_eq!(
        transport::decode(encrypted.as_bytes(), &key, true)
            .unwrap_err()
            .kind,
        "assistantResponseTooLarge"
    );
}
#[test]
fn sse_decoder_handles_crlf_split_utf8_and_multiple_events() {
    let raw = "event: ANSWER\r\ndata: 打开灯\r\n\r\nevent: SESSION\ndata: done\n\n".as_bytes();
    let mut p = protocol::SseDecoder::default();
    let mut frames = vec![];
    for byte in raw {
        frames.extend(p.push(&[*byte]).unwrap())
    }
    assert_eq!(
        frames,
        vec![
            ("ANSWER".into(), "打开灯".into()),
            ("SESSION".into(), "done".into())
        ]
    );
    assert!(p.finish().is_ok());
}
#[test]
fn sse_truncation_oversize_and_unknown_events_do_not_invent_completion() {
    let mut p = protocol::SseDecoder::default();
    p.push(b"data: partial").unwrap();
    assert!(p.finish().is_err());
    assert!(p.push(&vec![b'a'; protocol::MAX_EVENT * 4 + 4096]).is_err());
    assert!(protocol::event("UNKNOWN", json!({})).is_none());
}
#[test]
fn all_seven_events_normalize_only_real_public_progress() {
    for kind in [
        "SESSION",
        "ANSWER",
        "PLAN",
        "STEP",
        "TOOL",
        "ERROR",
        "CANCELLED",
    ] {
        let e=protocol::event(kind,json!({"status":"running","delta":"真实答案","reasoning":"private","thinking_delta":"private"})).unwrap();
        assert_eq!(e.kind, kind);
        assert!(!serde_json::to_string(&e).unwrap().contains("private"));
    }
}
#[tokio::test]
async fn authorization_restores_own_account_without_network_or_replacing_mijia() {
    let (auth, wire, _, c) = setup(3600, 0);
    assert_eq!(auth.status(&c, 1).await.unwrap().state, "authorized");
    assert_eq!(
        auth.access(&c, 1).await.unwrap().as_str(),
        "synthetic-access"
    );
    assert!(wire.calls.lock().unwrap().is_empty());
    assert_eq!(c.service_token, "synthetic-mijia");
}
#[tokio::test]
async fn mismatched_saved_account_is_discarded() {
    let (auth, _, store, c) = setup(3600, 0);
    let secret =
        Secrets::parse("2", "synthetic-oauth", token("wrong", 3600), epoch_secs()).unwrap();
    store
        .save(
            &crate::preferences::PreferenceStore::scope("1", "cn"),
            &secret,
        )
        .unwrap();
    assert_eq!(
        auth.status(&c, 1).await.unwrap().state,
        "authorizationRequired"
    );
    assert!(store.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn concurrent_refreshes_are_coalesced_and_saved() {
    let (auth, wire, store, c) = setup(100, 95);
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(token("fresh", 3600)));
    wire.delay_ms.store(20, Ordering::Relaxed);
    let (a, b, c2) = tokio::join!(auth.access(&c, 1), auth.access(&c, 1), auth.access(&c, 1));
    assert_eq!(a.unwrap().as_str(), "fresh");
    assert_eq!(b.unwrap().as_str(), "fresh");
    assert_eq!(c2.unwrap().as_str(), "fresh");
    assert_eq!(wire.calls.lock().unwrap().len(), 1);
    let restored = Authorization::new(wire.clone(), store);
    assert_eq!(restored.access(&c, 0).await.unwrap().as_str(), "fresh");
    assert_eq!(wire.calls.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn revoked_refresh_requires_authorization_and_clears_only_assistant_store() {
    let (auth, wire, store, c) = setup(100, 101);
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(json!({"code":-4})));
    assert_eq!(
        auth.access(&c, 1).await.err().unwrap().kind,
        "assistantAuthorizationRequired"
    );
    assert!(store.0.lock().unwrap().is_empty());
    assert_eq!(c.service_token, "synthetic-mijia");
}
#[tokio::test]
async fn transient_refresh_failure_preserves_only_still_valid_token_with_backoff() {
    let (auth, wire, _, c) = setup(100, 95);
    wire.replies
        .lock()
        .unwrap()
        .push_back(Err(error("assistantNetwork")));
    let (a, b) = tokio::join!(auth.access(&c, 1), auth.access(&c, 1));
    assert_eq!(a.unwrap().as_str(), "synthetic-access");
    assert_eq!(b.unwrap().as_str(), "synthetic-access");
    assert_eq!(wire.calls.lock().unwrap().len(), 1);
    assert_eq!(
        auth.status(&c, 1).await.unwrap().state,
        "authorizedRefreshDeferred"
    );
}
#[tokio::test]
async fn revoke_cancels_a_refresh_and_rejects_its_late_result() {
    let (auth, wire, store, c) = setup(100, 101);
    wire.delay_ms.store(100, Ordering::Relaxed);
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(token("late", 3600)));
    let refresh = auth.access(&c, 1);
    let revoke = async {
        tokio::time::sleep(std::time::Duration::from_millis(10)).await;
        auth.revoke().await.unwrap();
    };
    let (r, ()) = tokio::join!(refresh, revoke);
    assert!(r.is_err());
    assert!(store.0.lock().unwrap().is_empty());
}
#[tokio::test]
async fn old_account_cannot_replace_a_new_account_binding() {
    let (auth, _, _, a) = setup(3600, 0);
    auth.status(&a, 1).await.unwrap();
    let b = credentials("2");
    auth.status(&b, 2).await.unwrap();
    assert!(auth.status(&a, 1).await.is_err());
    assert_eq!(
        auth.status(&b, 2).await.unwrap().state,
        "authorizationRequired"
    );
}
#[tokio::test]
async fn public_status_contains_no_secrets_and_distinguishes_delegation_from_isolation() {
    let (auth, _, _, c) = setup(3600, 0);
    let v = serde_json::to_value(auth.status(&c, 1).await.unwrap()).unwrap();
    let text = v.to_string();
    for secret in [
        "synthetic-access",
        "synthetic-oauth",
        "synthetic-refresh",
        "synthetic-mijia",
    ] {
        assert!(!text.contains(secret));
    }
    assert_eq!(v["simpleAvailable"], true);
    assert_eq!(v["scopeGuarantee"], "householdDelegationUnverified");
}
#[tokio::test]
async fn unsupported_region_cannot_start_transport() {
    let (auth, wire, _, mut c) = setup(3600, 0);
    c.region = "us".into();
    c.service_id = "xiaomiio".into();
    assert_eq!(
        auth.status(&c, 1).await.unwrap().state,
        "assistantRegionUnsupported"
    );
    assert!(auth.access(&c, 1).await.is_err());
    assert!(wire.calls.lock().unwrap().is_empty());
}
#[test]fn household_delegation_validates_selected_ids_without_claiming_server_isolation(){
 assert!(scope::delegate(scope(),&["1".into()]).is_ok());
 assert!(scope::delegate(scope(),&["2".into()]).is_err());
 let mut t=scope();t.devices.push("arbitrary".into());assert!(scope::delegate(t,&["1".into()]).is_err());
 assert!(scope::EVIDENCE.contains("not verified"));
}
#[tokio::test]
async fn simple_mock_uses_original_query_fixed_scope_and_no_legacy_path() {
    let wire = Arc::new(Mock::default());
    wire.replies.lock().unwrap().push_back(Ok(
        json!({"code":200,"data":{"status":"SUCCESS","reply":"收到"}}),
    ));
    let r = request("simple");
    let proof = scope::mock_verified(scope());
    let result = execution::run(
        wire.clone(),
        &credentials("1"),
        "mock-token",
        &r,
        &proof,
        CancellationToken::new(),
        Arc::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(result.verification, "notPerformed");
    let calls = wire.calls.lock().unwrap();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0].0, Endpoint::Simple);
    assert_eq!(calls[0].1["refined_request"], r.query);
    assert_eq!(calls[0].1["home_id_list"], json!(["1"]));
    assert_eq!(calls[0].1["device_id_list"], json!([]));
}
#[tokio::test]
async fn ambiguous_simple_timeout_or_fallback_code_never_replays() {
    for reply in [
        Err(error("assistantTimeout")),
        Ok(json!({"code":200,"data":{"miot_status":{"code":2001004},"status":"FAILED"}})),
    ] {
        let wire = Arc::new(Mock::default());
        wire.replies.lock().unwrap().push_back(reply);
        let _ = execution::run(
            wire.clone(),
            &credentials("1"),
            "mock",
            &request("simple"),
            &scope::mock_verified(scope()),
            CancellationToken::new(),
            Arc::new(|_| {}),
        )
        .await;
        assert_eq!(wire.calls.lock().unwrap().len(), 1);
    }
}
#[tokio::test]
async fn complex_mock_aggregates_answer_and_completion_without_claiming_hardware() {
    let wire = Arc::new(Mock::default());
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(json!({"session_id":"mock-session"})));
    *wire.events.lock().unwrap() = vec![
        protocol::event("ANSWER", json!({"delta":"收到"})).unwrap(),
        protocol::event("SESSION", json!({"status":"completed"})).unwrap(),
    ];
    let r = execution::run(
        wire.clone(),
        &credentials("1"),
        "mock",
        &request("complex"),
        &scope::mock_verified(scope()),
        CancellationToken::new(),
        Arc::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(r.reply, "收到");
    assert_eq!(r.outcome, "unconfirmed");
    assert_eq!(wire.calls.lock().unwrap().len(), 1);
}
#[tokio::test]
async fn incomplete_complex_stream_cancels_once_and_does_not_replay_chat() {
    let wire = Arc::new(Mock::default());
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(json!({"session_id":"mock-session"})));
    *wire.stream_error.lock().unwrap() = Some("assistantStreamIdleTimeout".into());
    let result = execution::run(
        wire.clone(),
        &credentials("1"),
        "mock",
        &request("complex"),
        &scope::mock_verified(scope()),
        CancellationToken::new(),
        Arc::new(|_| {}),
    )
    .await;
    assert!(result.is_err());
    let calls = wire.calls.lock().unwrap();
    assert_eq!(calls.len(), 2);
    assert_eq!(calls[0].0, Endpoint::Chat);
    assert_eq!(calls[1].0, Endpoint::Cancel("mock-session".into()));
}
fn task_record(id: String) -> crate::mcp_core::journal::Record {
    crate::mcp_core::journal::Record {
        scope: "mock".into(),
        home: "1".into(),
        request_id: id,
        fingerprint: "same-query-and-target".into(),
        directory_revision: "fixture".into(),
        target: json!({"scope":"device","deviceId":"lamp"}),
        on: false,
        created_at: crate::mcp_core::now_ms(),
        deadline: crate::mcp_core::now_ms() + 185000,
        targets: vec![],
        entries: vec![],
        issues: vec![],
        target_complete: true,
        phase: "assistant".into(),
        task_status: "running".into(),
        revision: 1,
        legacy: false,
        legacy_result: None,
        memory_status: None,
        operation_memory: None,
        assistant: Some(execution::Task {
            route_requested: "simple".into(),
            route_used: Some("simple".into()),
            intent_hash: "query-hash".into(),
            scope: scope(),
            authorization_generation: 1,
            phase: "submitting".into(),
            request_attempted: true,
            request_submitted: None,
            remote: None,
            error: None,
            events: vec![],
            elapsed_ms: 0,
            trace: vec![],
            attempts: vec![],
        }),
    }
}
#[test]
fn assistant_journal_is_idempotent_conflict_checked_and_never_resumes_on_restart() {
    let path = std::env::temp_dir().join(format!(
        "mijia-assistant-mock-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    let id = uuid::Uuid::new_v4().to_string();
    let journal = crate::mcp_core::journal::Journal::open(path.clone()).unwrap();
    let r = task_record(id.clone());
    assert!(journal.admit(r.clone()).unwrap());
    assert!(!journal.admit(r.clone()).unwrap());
    let mut changed = r;
    changed.fingerprint = "different".into();
    assert_eq!(journal.admit(changed).unwrap_err().kind, "requestConflict");
    drop(journal);
    let journal = crate::mcp_core::journal::Journal::open(path).unwrap();
    let restored = journal.lookup("mock", &id).unwrap().unwrap();
    assert_eq!(restored.task_status, "interrupted");
    assert_eq!(restored.assistant.as_ref().unwrap().phase, "interrupted");
    assert_eq!(restored.summary()["outcome"], "unknown");
    assert_eq!(restored.summary()["retryWrite"], false);
    assert!(!journal.admit(restored).unwrap());
}
#[test]
fn settled_task_rejects_stale_progress_and_long_reply_is_pageable() {
    let path = std::env::temp_dir().join(format!(
        "mijia-assistant-result-{}.jsonl",
        uuid::Uuid::new_v4()
    ));
    let journal = crate::mcp_core::journal::Journal::open(path).unwrap();
    let mut r = task_record(uuid::Uuid::new_v4().to_string());
    r.assistant.as_mut().unwrap().remote = Some(
        protocol::simple_result(
            json!({"code":200,"data":{"status":"SUCCESS","reply":"灯".repeat(20000)}}),
        )
        .unwrap(),
    );
    journal.admit(r.clone()).unwrap();
    journal
        .end("mock", &r.request_id, "completed", None)
        .unwrap();
    assert!(journal
        .assistant("mock", &r.request_id, r.assistant.clone().unwrap())
        .is_err());
    let rows = r.details();
    assert!(rows.len() > 30);
    let page =
        crate::mcp_core::response::page("mock", "1", 0, &rows, r.summary(), 4096, 10).unwrap();
    assert!(serde_json::to_vec(&page).unwrap().len() <= 4096);
    assert_eq!(page.structured_content.unwrap()["detailsComplete"], false);
}
#[tokio::test]
async fn remote_echo_of_secrets_is_redacted_before_results_and_progress() {
    let wire = Arc::new(Mock::default());
    wire.replies.lock().unwrap().push_back(Ok(json!({"code":200,"data":{"status":"SUCCESS","reply":"mock-access synthetic-mijia AAECAwQFBgcICQoLDA0ODw=="}})));
    let r = execution::run(
        wire,
        &credentials("1"),
        "mock-access",
        &request("simple"),
        &scope::mock_verified(scope()),
        CancellationToken::new(),
        Arc::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(r.reply, "[redacted] [redacted] [redacted]");
}
#[test]
fn tool_contract_is_fixed_small_and_excludes_any_transport_credentials() {
    let definitions = crate::mcp_core::tools::definitions();
    assert_eq!(definitions.len(), 7);
    let bytes = serde_json::to_vec(&json!({"tools":definitions}))
        .unwrap()
        .len();
    eprintln!("assistant tools/list schema bytes={bytes}");
    assert!(bytes <= 16384);
    let id = uuid::Uuid::new_v4().to_string();
    for key in ["client_id", "host", "url", "token", "homeId"] {
        let mut args = json!({"query":"打开模拟灯","complexity":"simple","requestId":id});
        args[key] = json!("forbidden");
        assert!(crate::mcp_core::tools::validate_arguments("miot_ask_assistant", &args).is_err());
    }
}
#[test]
fn assistant_futures_and_auth_entry_fit_small_windows_stack_budget() {
    std::thread::Builder::new()
        .stack_size(16 * 1024 * 1024)
        .spawn(|| {
            let (auth, wire, _, c) = setup(3600, 0);
            let q = request("complex");
            let proof = scope::mock_verified(scope());
            let access = auth.access(&c, 1);
            let run = execution::run(
                wire,
                &c,
                "synthetic-access",
                &q,
                &proof,
                CancellationToken::new(),
                Arc::new(|_| {}),
            );
            for (name, size) in [
                ("authorization", std::mem::size_of_val(&access)),
                ("assistantExecution", std::mem::size_of_val(&run)),
            ] {
                eprintln!("{name} future bytes={size}");
                assert!(size < 128 * 1024, "{name}: {size}");
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[tokio::test]
async fn missing_refresh_expired_token_can_try_stored_oauth_without_replaying_controls() {
    let c = credentials("1");
    let store = Arc::new(Store::default());
    let mut value = token("old", 10);
    value["result"]
        .as_object_mut()
        .unwrap()
        .remove("refresh_token");
    let secret = Secrets::parse("1", "oauth", value, epoch_secs() - 20).unwrap();
    store
        .save(
            &crate::preferences::PreferenceStore::scope("1", "cn"),
            &secret,
        )
        .unwrap();
    let wire = Arc::new(Mock::default());
    let auth = Authorization::new(wire.clone(), store);
    assert_eq!(
        auth.access(&c, 1).await.err().unwrap().kind,
        "assistantAuthorizationRequired"
    );
    let calls=wire.calls.lock().unwrap();assert_eq!(calls.len(),1);assert_eq!(calls[0].0,Endpoint::Token);
}
#[tokio::test]
async fn completed_uppercase_session_can_supply_final_answer_without_deltas() {
    let wire = Arc::new(Mock::default());
    wire.replies
        .lock()
        .unwrap()
        .push_back(Ok(json!({"session_id":"mock-session"})));
    *wire.events.lock().unwrap()=vec![protocol::event("TOOL",json!({"metadata":{"created_scenes":[{"scene_id":"mock-scene","home_id":"1","name":"模拟场景"}]}})).unwrap(),protocol::event("SESSION",json!({"status":"COMPLETED","result":{"answer":"最终答案"}})).unwrap()];
    let r = execution::run(
        wire.clone(),
        &credentials("1"),
        "synthetic-access",
        &request("complex"),
        &scope::mock_verified(scope()),
        CancellationToken::new(),
        Arc::new(|_| {}),
    )
    .await
    .unwrap();
    assert_eq!(r.reply, "最终答案");
    assert_eq!(r.artifacts[0]["sceneId"], "mock-scene");
    assert_eq!(r.artifacts[0]["source"], "cloudAssistantUntrusted");
    assert_eq!(wire.calls.lock().unwrap().len(), 1);
}

#[tokio::test]async fn same_scan_bootstrap_mock_saves_separate_credentials_and_checks_identity(){
 let wire=Arc::new(Mock::default());let store=Arc::new(Store::default());let auth=Authorization::new(wire.clone(),store.clone());let c=credentials("1");
 wire.replies.lock().unwrap().push_back(Ok(token("mock-bootstrap",3600)));
 auth.mock_bootstrap(&c,1,crate::auth::OAuthCredentials{user_id:"1".into(),service_token:"mock-oauth".into()}).await.unwrap();
 assert_eq!(auth.status(&c,1).await.unwrap().state,"authorized");assert_eq!(c.service_token,"synthetic-mijia");
 let before=wire.calls.lock().unwrap().len();
 assert_eq!(auth.mock_bootstrap(&c,1,crate::auth::OAuthCredentials{user_id:"2".into(),service_token:"wrong".into()}).await.unwrap_err().kind,"assistantAccountMismatch");
 assert_eq!(wire.calls.lock().unwrap().len(),before);
}

#[tokio::test]
async fn same_account_login_reuses_authorization_without_second_scan_or_network() {
 let (auth,wire,_,c)=setup(3600,0);
 let generation=auth.prepare_bootstrap(&c,2).await.unwrap();
 auth.bootstrap(&c,2,generation,None).await.unwrap();
 assert_eq!(auth.status(&c,2).await.unwrap().state,"authorized");
 assert!(wire.calls.lock().unwrap().is_empty());
}
#[tokio::test]
async fn missing_login_pass_is_repairable_and_revoked_generation_cannot_bootstrap() {
 let wire=Arc::new(Mock::default());let store=Arc::new(Store::default());let auth=Authorization::new(wire.clone(),store.clone());let c=credentials("1");
 let generation=auth.prepare_bootstrap(&c,1).await.unwrap();
 assert_eq!(auth.bootstrap(&c,1,generation,None).await.unwrap_err().kind,"assistantSsoVerificationRequired");
 auth.revoke().await.unwrap();
 assert!(auth.bootstrap(&c,1,generation,None).await.is_err());
 assert!(store.0.lock().unwrap().is_empty());assert!(wire.calls.lock().unwrap().is_empty());
 assert_eq!(c.service_token,"synthetic-mijia");
}
#[tokio::test]
async fn revocation_during_token_exchange_cannot_restore_old_credentials() {
 let wire=Arc::new(Mock::default());wire.delay_ms.store(100,Ordering::Relaxed);
 wire.replies.lock().unwrap().push_back(Ok(token("late-token",3600)));
 let store=Arc::new(Store::default());let auth=Arc::new(Authorization::new(wire.clone(),store.clone()));let c=credentials("1");
 let worker=auth.clone();let job=tokio::spawn(async move{worker.mock_bootstrap(&c,1,crate::auth::OAuthCredentials{user_id:"1".into(),service_token:"mock-oauth".into()}).await});
 tokio::time::timeout(std::time::Duration::from_secs(1),async{while wire.calls.lock().unwrap().is_empty(){tokio::task::yield_now().await;}}).await.unwrap();
 auth.revoke().await.unwrap();assert!(job.await.unwrap().is_err());assert!(store.0.lock().unwrap().is_empty());
}

#[test]
fn final_task_summary_uses_actual_remote_route_not_initial_submit_route(){
 let mut record=task_record(uuid::Uuid::new_v4().to_string());let task=record.assistant.as_mut().unwrap();
 task.route_requested="simple".into();task.route_used=Some("simple".into());
 let mut result=protocol::simple_result(json!({"code":200,"data":{"status":"SUCCESS","reply":"mock"}})).unwrap();result.route_used="complex".into();task.remote=Some(result);
 assert_eq!(task.summary("mock","completed",1)["routeUsed"],"complex");
}
