//! One-scan handoff tests: memory stores and mock auth endpoints only.
use super::*;
use crate::account_sso::{AccountSso, MemoryStore, Session, Sid, Store as SsoStore, Wire as SsoWire};
use tokio::sync::Semaphore;
use zeroize::Zeroizing;

#[derive(Default)]
struct SsoMock {
    calls: AtomicUsize,
    failures: Mutex<VecDeque<String>>,
    gate: Option<Arc<Semaphore>>,
}
impl SsoWire for SsoMock {
    fn exchange<'a>(&'a self,c:&'a Credentials,_:Zeroizing<String>,_:Sid,cancel:CancellationToken)->Io<'a,Session> {
        Box::pin(async move {
            self.calls.fetch_add(1,Ordering::SeqCst);
            if let Some(gate)=&self.gate {
                tokio::select! { _=cancel.cancelled()=>return Err(crate::error::AppError::stale()), permit=gate.acquire()=>{permit.unwrap().forget();} }
            }
            if let Some(kind)=self.failures.lock().unwrap().pop_front(){return Err(error(&kind))}
            Ok(Session::OAuth(crate::auth::OAuthCredentials{user_id:c.user_id.clone(),service_token:"mock-oauth-private".into()}))
        })
    }
}
fn service(gated:bool)->(Arc<Authorization>,Arc<Mock>,Arc<Store>,Arc<MemoryStore>,Arc<SsoMock>){
    let wire=Arc::new(Mock::default());
    let tokens=Arc::new(Store::default());let sessions=Arc::new(MemoryStore::default());
    let sid=Arc::new(SsoMock{gate:gated.then(||Arc::new(Semaphore::new(0))),..Default::default()});
    let auth=Arc::new(Authorization::with_sso(wire.clone(),tokens.clone(),Arc::new(AccountSso::new(sessions.clone(),sid.clone()))));
    (auth,wire,tokens,sessions,sid)
}
async fn until(mut ready:impl FnMut()->bool){
    tokio::time::timeout(std::time::Duration::from_secs(2),async{while !ready(){tokio::task::yield_now().await;}}).await.unwrap();
}
async fn settled(auth:&Authorization,c:&Credentials,epoch:u64)->authorization::Status {
    tokio::time::timeout(std::time::Duration::from_secs(2),async{loop{
        let status=auth.status(c,epoch).await.unwrap();
        if status.state!="reconnecting" {return status}
        tokio::task::yield_now().await;
    }}).await.unwrap()
}

#[tokio::test]
async fn one_scan_handoff_returns_before_cloud_and_queries_share_the_login_task(){
    let(auth,wire,_,sessions,sid)=service(true);let c=credentials("1");
    wire.replies.lock().unwrap().push_back(Ok(token("mock-one-scan",3600)));
    tokio::time::timeout(std::time::Duration::from_millis(200),auth.begin_login(&c,1,Some(Zeroizing::new("mock-account-private".into())))).await.unwrap().unwrap();
    let first=auth.status(&c,1).await.unwrap();
    assert_eq!(first.state,"reconnecting");assert!(!first.reverify_required);
    until(||sid.calls.load(Ordering::SeqCst)==1).await;
    for _ in 0..5 {auth.ensure_connected(&c,1).await.unwrap();auth.reconnect(&c,1).await.unwrap();}
    assert_eq!(sid.calls.load(Ordering::SeqCst),1);assert!(wire.calls.lock().unwrap().is_empty());
    sid.gate.as_ref().unwrap().add_permits(1);
    let status=settled(&auth,&c,1).await;assert_eq!(status.state,"authorized");assert!(!status.reverify_required);
    assert_eq!(wire.calls.lock().unwrap().len(),1);assert_eq!(c.service_token,"synthetic-mijia");
    let scope=crate::preferences::PreferenceStore::scope("1","cn");
    assert!(sessions.read(&scope,"account").unwrap().is_some());
    assert!(sessions.read(&scope,"sid-mijia").unwrap().is_some());
    assert!(sessions.read(&scope,"sid-oauth2.0").unwrap().is_some());
    let dto=serde_json::to_string(&status).unwrap();
    for secret in ["mock-account-private","mock-oauth-private","mock-one-scan","synthetic-mijia"]{assert!(!dto.contains(secret));}
}

#[tokio::test]
async fn network_failure_retains_login_and_sso_and_explicit_retry_needs_no_scan(){
    let(auth,wire,_,sessions,sid)=service(false);let c=credentials("1");
    sid.failures.lock().unwrap().push_back("assistantNetwork".into());
    auth.begin_login(&c,1,Some(Zeroizing::new("mock-account".into()))).await.unwrap();
    let failed=settled(&auth,&c,1).await;
    assert_eq!(failed.state,"connectionFailed");assert_eq!(failed.unavailable_reason,"assistantNetwork");assert!(!failed.reverify_required);
    for _ in 0..5{auth.ensure_connected(&c,1).await.unwrap();}
    assert_eq!(sid.calls.load(Ordering::SeqCst),1);
    let scope=crate::preferences::PreferenceStore::scope("1","cn");assert!(sessions.read(&scope,"account").unwrap().is_some());
    wire.replies.lock().unwrap().push_back(Ok(token("retry-succeeded",3600)));
    auth.reconnect(&c,1).await.unwrap();assert_eq!(settled(&auth,&c,1).await.state,"authorized");
    assert_eq!(sid.calls.load(Ordering::SeqCst),2);assert_eq!(wire.calls.lock().unwrap().len(),1);assert_eq!(c.service_token,"synthetic-mijia");
}

#[tokio::test]
async fn missing_credential_and_account_challenge_require_verification_but_unknown_errors_do_not(){
    for (failure,pass,verify,reason) in [
        (None,None,true,"assistantLoginVerificationRequired"),
        (Some("loginVerification"),Some("mock-pass"),true,"assistantLoginVerificationRequired"),
        (Some("assistantSsoVerificationRequired"),Some("mock-pass"),true,"assistantLoginVerificationRequired"),
        (Some("protocol"),Some("mock-pass"),false,"assistantConnectionFailed"),
        (Some("untrusted-secret-looking-reason"),Some("mock-pass"),false,"assistantConnectionFailed"),
    ] {
        let(auth,_,_,_,sid)=service(false);let c=credentials("1");
        if let Some(f)=failure{sid.failures.lock().unwrap().push_back(f.into());}
        auth.begin_login(&c,1,pass.map(|p|Zeroizing::new(p.into()))).await.unwrap();
        let s=settled(&auth,&c,1).await;assert_eq!(s.reverify_required,verify);assert_eq!(s.unavailable_reason,reason);
        assert_eq!(s.state=="connectionFailed",!verify);
    }
}

#[tokio::test]
async fn new_scan_credentials_and_authorization_restore_without_network_or_second_scan(){
    let(auth,wire,tokens,sessions,sid)=service(false);let c=credentials("1");
    wire.replies.lock().unwrap().push_back(Ok(token("restart-saved",3600)));
    auth.begin_login(&c,1,Some(Zeroizing::new("mock-account".into()))).await.unwrap();
    assert_eq!(settled(&auth,&c,1).await.state,"authorized");
    let restored=Arc::new(Authorization::with_sso(wire.clone(),tokens,Arc::new(AccountSso::new(sessions,sid.clone()))));
    restored.ensure_connected(&c,1).await.unwrap();assert_eq!(restored.status(&c,1).await.unwrap().state,"authorized");
    assert_eq!(sid.calls.load(Ordering::SeqCst),1);assert_eq!(wire.calls.lock().unwrap().len(),1);
}

#[tokio::test]
async fn revocation_cancels_login_task_and_status_queries_cannot_reauthorize(){
    let(auth,wire,tokens,_,sid)=service(true);let c=credentials("1");
    auth.begin_login(&c,1,Some(Zeroizing::new("mock-account".into()))).await.unwrap();
    until(||sid.calls.load(Ordering::SeqCst)==1).await;auth.revoke().await.unwrap();
    sid.gate.as_ref().unwrap().add_permits(1);
    for _ in 0..5{auth.ensure_connected(&c,1).await.unwrap();tokio::task::yield_now().await;}
    assert_eq!(auth.status(&c,1).await.unwrap().state,"disabled");
    assert!(tokens.0.lock().unwrap().is_empty());assert!(wire.calls.lock().unwrap().is_empty());assert_eq!(sid.calls.load(Ordering::SeqCst),1);
}

#[tokio::test]
async fn account_change_rejects_old_login_results_and_uses_only_the_new_scope(){
    let(auth,wire,tokens,sessions,sid)=service(true);
    auth.begin_login(&credentials("1"),1,Some(Zeroizing::new("old-account".into()))).await.unwrap();
    until(||sid.calls.load(Ordering::SeqCst)==1).await;
    wire.replies.lock().unwrap().push_back(Ok(token("new-only",3600)));
    let c=credentials("2");auth.begin_login(&c,2,Some(Zeroizing::new("new-account".into()))).await.unwrap();
    sid.gate.as_ref().unwrap().add_permits(2);
    assert_eq!(settled(&auth,&c,2).await.state,"authorized");
    let old=crate::preferences::PreferenceStore::scope("1","cn");
    assert!(!tokens.0.lock().unwrap().contains_key(&old));assert!(sessions.read(&old,"account").unwrap().is_none());
    assert_eq!(wire.calls.lock().unwrap().len(),1);
}

#[tokio::test]
async fn logout_during_login_cannot_restore_credentials_or_publish_failure_into_a_new_login(){
    let(auth,wire,tokens,sessions,sid)=service(true);let c=credentials("1");
    auth.begin_login(&c,1,Some(Zeroizing::new("old-account".into()))).await.unwrap();
    until(||sid.calls.load(Ordering::SeqCst)==1).await;auth.logout().await.unwrap();
    let scope=crate::preferences::PreferenceStore::scope("1","cn");
    sid.gate.as_ref().unwrap().add_permits(1);
    for _ in 0..20{tokio::task::yield_now().await;}
    assert!(tokens.0.lock().unwrap().is_empty());assert!(sessions.read(&scope,"account").unwrap().is_none());assert!(wire.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_second_explicit_same_account_login_supersedes_the_first_handoff(){
    let(auth,wire,_,_,sid)=service(true);let c=credentials("1");
    auth.begin_login(&c,1,Some(Zeroizing::new("first-scan".into()))).await.unwrap();
    until(||sid.calls.load(Ordering::SeqCst)==1).await;
    wire.replies.lock().unwrap().push_back(Ok(token("latest-scan",3600)));
    auth.begin_login(&c,2,Some(Zeroizing::new("second-scan".into()))).await.unwrap();
    sid.gate.as_ref().unwrap().add_permits(2);
    assert_eq!(settled(&auth,&c,2).await.state,"authorized");
    assert_eq!(wire.calls.lock().unwrap().len(),1);
}

#[tokio::test]
async fn an_expired_legacy_oauth_cache_without_account_sso_offers_account_verification(){
    let(auth,wire,_,sessions,_)=service(false);let c=credentials("1");
    let scope=crate::preferences::PreferenceStore::scope("1","cn");
    sessions.write(&scope,"sid-oauth2.0",&serde_json::to_string(&crate::auth::OAuthCredentials{user_id:"1".into(),service_token:"legacy-oauth".into()}).unwrap()).unwrap();
    wire.replies.lock().unwrap().push_back(Err(error("assistantAuthorizationRequired")));
    auth.reconnect(&c,1).await.unwrap();
    let s=settled(&auth,&c,1).await;
    assert!(s.sso_available);assert!(s.reverify_required);
    assert_eq!(s.unavailable_reason,"assistantLoginVerificationRequired");
    assert_eq!(wire.calls.lock().unwrap().len(),1);
}
