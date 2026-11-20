//! Account SSO and business SID credentials. Nothing in this module is a UI DTO.
//! Pass tokens and SID sessions live only here or in the OS credential store.
use crate::{auth::{Credentials, LoginAttempt, OAuthCredentials}, error::{AppError, Result}, preferences::PreferenceStore};
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, future::Future, pin::Pin, sync::Arc};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;
use zeroize::{Zeroize, Zeroizing};

type Io<'a, T> = Pin<Box<dyn Future<Output=Result<T>> + Send + 'a>>;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Sid { Mijia, OAuth }
impl Sid { fn key(self)-> &'static str { match self {Self::Mijia=>"sid-mijia",Self::OAuth=>"sid-oauth2.0"} } }
pub enum Session { Mijia(Credentials), OAuth(OAuthCredentials) }
impl Session {
    fn user(&self)->&str { match self {Self::Mijia(c)=>&c.user_id,Self::OAuth(c)=>&c.user_id} }
    fn encode(&self)->Result<Zeroizing<String>> { Ok(Zeroizing::new(match self {Self::Mijia(c)=>serde_json::to_string(c),Self::OAuth(c)=>serde_json::to_string(c)}.map_err(|_|failure())?)) }
}
fn required()->AppError { AppError::new("assistantAuthorizationRequired","请验证当前小米账号以重新连接助手。",false) }
fn account_verification()->AppError { AppError::new("assistantSsoVerificationRequired","请重新验证当前小米账号以补全登录凭据。",false) }
fn failure()->AppError { AppError::new("accountSsoStore","无法读取或保存账号安全凭据。",false) }
fn secret(s:&str)->bool { !s.is_empty()&&s.len()<=32768&&s.bytes().all(|b|b.is_ascii_graphic()&&!matches!(b,b'"'|b','|b';'|b'\\')) }

pub trait Store:Send+Sync {
    fn read(&self,scope:&str,kind:&str)->Result<Option<Zeroizing<String>>>;
    fn write(&self,scope:&str,kind:&str,value:&str)->Result<()>;
    fn delete(&self,scope:&str,kind:&str)->Result<()>;
}
pub struct SystemStore;
impl SystemStore {
    fn entry(scope:&str,kind:&str)->Result<keyring::Entry>{
        if !["account","sid-mijia","sid-oauth2.0","assistant-opt-out"].contains(&kind){return Err(failure())}
        keyring::Entry::new(&format!("io.mijiadesktop.client.sso.{kind}.v1"),scope).map_err(|_|failure())
    }
}
impl Store for SystemStore {
    fn read(&self,scope:&str,kind:&str)->Result<Option<Zeroizing<String>>>{match Self::entry(scope,kind)?.get_password(){Ok(s)=>Ok(Some(Zeroizing::new(s))),Err(keyring::Error::NoEntry)=>Ok(None),Err(_)=>Err(failure())}}
    fn write(&self,scope:&str,kind:&str,value:&str)->Result<()>{Self::entry(scope,kind)?.set_password(value).map_err(|_|failure())}
    fn delete(&self,scope:&str,kind:&str)->Result<()>{match Self::entry(scope,kind)?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>Ok(()),Err(_)=>Err(failure())}}
}
#[derive(Default)]
pub struct MemoryStore(std::sync::Mutex<HashMap<(String,String),Zeroizing<String>>>);
impl Store for MemoryStore {
    fn read(&self,s:&str,k:&str)->Result<Option<Zeroizing<String>>>{Ok(self.0.lock().map_err(|_|failure())?.get(&(s.into(),k.into())).cloned())}
    fn write(&self,s:&str,k:&str,v:&str)->Result<()>{self.0.lock().map_err(|_|failure())?.insert((s.into(),k.into()),Zeroizing::new(v.into()));Ok(())}
    fn delete(&self,s:&str,k:&str)->Result<()>{self.0.lock().map_err(|_|failure())?.remove(&(s.into(),k.into()));Ok(())}
}
pub trait Wire:Send+Sync {
    fn exchange<'a>(&'a self,c:&'a Credentials,pass:Zeroizing<String>,sid:Sid,cancel:CancellationToken)->Io<'a,Session>;
}
struct Http;
impl Wire for Http {
    fn exchange<'a>(&'a self,c:&'a Credentials,pass:Zeroizing<String>,sid:Sid,cancel:CancellationToken)->Io<'a,Session>{Box::pin(async move {
        tokio::select!{_=cancel.cancelled()=>Err(AppError::stale()),result=async{match sid {Sid::Mijia=>LoginAttempt::mijia_from_login(c,pass).await.map(Session::Mijia),Sid::OAuth=>LoginAttempt::oauth_from_login(c,pass).await.map(Session::OAuth)}}=>result}
    })}
}
struct Offline;
impl Wire for Offline { fn exchange<'a>(&'a self,_:&'a Credentials,_:Zeroizing<String>,_:Sid,_:CancellationToken)->Io<'a,Session>{Box::pin(async{Err(required())})} }
#[derive(Serialize,Deserialize)]
struct AccountSecret { user:String,region:String,pass:String }
impl Drop for AccountSecret {fn drop(&mut self){self.pass.zeroize();}}
#[derive(Clone)]
struct Binding { scope:String,user:String,epoch:u64,generation:u64,cancel:CancellationToken }
pub struct Availability { pub reusable:bool,pub opted_out:bool }
pub struct AccountSso {
    store:Arc<dyn Store>,wire:Arc<dyn Wire>,current:Mutex<Option<Binding>>,flights:Mutex<HashMap<String,Arc<Mutex<()>>>>,
    revisions:std::sync::Mutex<HashMap<String,u64>>,
}
impl AccountSso {
    pub fn production()->Self {Self::new(Arc::new(SystemStore),Arc::new(Http))}
    /// Non-production constructor never accesses the user's credential store/network.
    pub fn offline()->Self {Self::new(Arc::new(MemoryStore::default()),Arc::new(Offline))}
    pub fn new(store:Arc<dyn Store>,wire:Arc<dyn Wire>)->Self {Self{store,wire,current:Mutex::new(None),flights:Mutex::new(HashMap::new()),revisions:std::sync::Mutex::new(HashMap::new())}}
    pub async fn bind_account(&self,c:&Credentials,epoch:u64)->Result<()> {self.bind(c,epoch).await.map(|_|())}
    async fn bind(&self,c:&Credentials,epoch:u64)->Result<Binding>{
        if c.region!="cn"||c.service_id!="mijia" {return Err(required())}
        let scope=PreferenceStore::scope(&c.user_id,&c.region);
        let mut current=self.current.lock().await;
        if let Some(old)=current.as_mut(){
            if old.epoch>epoch{return Err(AppError::stale())}
            if old.scope==scope {old.epoch=epoch;return Ok(old.clone())}
            old.cancel.cancel();self.erase(&old.scope)?;
        }
        let generation=current.as_ref().map(|b|b.generation+1).unwrap_or(1);
        let binding=Binding{scope,user:c.user_id.clone(),epoch,generation,cancel:CancellationToken::new()};*current=Some(binding.clone());Ok(binding)
    }
    fn check(current:&Option<Binding>,binding:&Binding)->Result<()> {if !binding.cancel.is_cancelled()&&current.as_ref().is_some_and(|v|v.scope==binding.scope&&v.generation==binding.generation&&!v.cancel.is_cancelled()) {Ok(())}else{Err(AppError::stale())}}
    fn erase(&self,scope:&str)->Result<()> {for kind in ["account","sid-mijia","sid-oauth2.0","assistant-opt-out"]{self.store.delete(scope,kind)?;}Ok(())}
    pub async fn remember_login(&self,c:&Credentials,epoch:u64,pass:Option<Zeroizing<String>>)->Result<()> {
        c.validate()?;self.bind(c,epoch).await?;
        // An explicit new login invalidates older SSO exchanges, including a
        // same-account exchange already using the previous passToken.
        {let mut current=self.current.lock().await;if let Some(b)=current.as_mut(){b.cancel.cancel();b.cancel=CancellationToken::new();b.generation+=1;}}
        let binding=self.bind(c,epoch).await?;
        let current=self.current.lock().await;Self::check(&current,&binding)?;
        if let Some(pass)=pass {if !secret(&pass){return Err(required())}let base=AccountSecret{user:c.user_id.clone(),region:c.region.clone(),pass:pass.to_string()};let raw=Zeroizing::new(serde_json::to_string(&base).map_err(|_|failure())?);self.store.write(&binding.scope,"account",&raw)?;}
        let raw=Zeroizing::new(serde_json::to_string(c).map_err(|_|failure())?);self.store.write(&binding.scope,Sid::Mijia.key(),&raw)?;
        self.store.delete(&binding.scope,"assistant-opt-out")?;self.store.delete(&binding.scope,Sid::OAuth.key())?;Ok(())
    }
    pub async fn remember_oauth(&self,c:&Credentials,epoch:u64,oauth:&OAuthCredentials)->Result<()> {
        if oauth.user_id!=c.user_id||!secret(&oauth.service_token){return Err(AppError::new("assistantAccountMismatch","助手授权账号与当前登录不一致。",false))}
        let binding=self.bind(c,epoch).await?;let current=self.current.lock().await;Self::check(&current,&binding)?;
        if self.store.read(&binding.scope,"assistant-opt-out")?.is_some(){return Err(required())}
        let raw=Zeroizing::new(serde_json::to_string(oauth).map_err(|_|failure())?);self.store.write(&binding.scope,Sid::OAuth.key(),&raw)
    }
    pub async fn availability(&self,c:&Credentials,epoch:u64)->Result<Availability>{
        let binding=self.bind(c,epoch).await?;let current=self.current.lock().await;Self::check(&current,&binding)?;
        Ok(Availability{opted_out:self.store.read(&binding.scope,"assistant-opt-out")?.is_some(),reusable:self.store.read(&binding.scope,"account")?.is_some()||self.store.read(&binding.scope,Sid::OAuth.key())?.is_some()})
    }
    pub async fn enable_assistant(&self,c:&Credentials,epoch:u64)->Result<()> {let binding=self.bind(c,epoch).await?;let current=self.current.lock().await;Self::check(&current,&binding)?;self.store.delete(&binding.scope,"assistant-opt-out")}
    pub async fn disable_assistant(&self,c:&Credentials,epoch:u64)->Result<()> {let binding=self.bind(c,epoch).await?;let current=self.current.lock().await;Self::check(&current,&binding)?;self.store.write(&binding.scope,"assistant-opt-out","1")?;self.store.delete(&binding.scope,Sid::OAuth.key())}
    pub async fn disable_current(&self)->Result<()> {let current=self.current.lock().await;if let Some(binding)=current.as_ref(){self.store.write(&binding.scope,"assistant-opt-out","1")?;self.store.delete(&binding.scope,Sid::OAuth.key())?;}Ok(())}
    async fn session(&self,c:&Credentials,epoch:u64,sid:Sid,force:bool)->Result<Session>{
        let binding=self.bind(c,epoch).await?;
        let key=format!("{}:{}",binding.scope,sid.key());
        let before=*self.revisions.lock().unwrap().get(&key).unwrap_or(&0);
        let flight=self.flights.lock().await.entry(key.clone()).or_insert_with(||Arc::new(Mutex::new(()))).clone();
        let _flight=flight.lock().await;
        {let current=self.current.lock().await;Self::check(&current,&binding)?;if sid==Sid::OAuth&&self.store.read(&binding.scope,"assistant-opt-out")?.is_some(){return Err(required())}}
        let cached=self.store.read(&binding.scope,sid.key())?;
        if !force || *self.revisions.lock().unwrap().get(&key).unwrap_or(&0)!=before {if let Some(raw)=cached {
            let session=match sid {Sid::Mijia=>{let v:Credentials=serde_json::from_str(&raw).map_err(|_|failure())?;v.validate()?;Session::Mijia(v)},Sid::OAuth=>{let v:OAuthCredentials=serde_json::from_str(&raw).map_err(|_|failure())?;if !secret(&v.service_token){return Err(required())}Session::OAuth(v)}};
            if session.user()!=binding.user{return Err(required())}return Ok(session);
        }}
        let raw=self.store.read(&binding.scope,"account")?.ok_or_else(account_verification)?;
        let base:AccountSecret=serde_json::from_str(&raw).map_err(|_|failure())?;
        if base.user!=binding.user||base.region!=c.region||!secret(&base.pass){return Err(account_verification())}
        let session=self.wire.exchange(c,Zeroizing::new(base.pass.clone()),sid,binding.cancel.clone()).await?;
        if session.user()!=binding.user{return Err(AppError::new("assistantAccountMismatch","账号验证结果不一致。",false))}
        let current=self.current.lock().await;Self::check(&current,&binding)?;
        if sid==Sid::OAuth&&self.store.read(&binding.scope,"assistant-opt-out")?.is_some(){return Err(required())}
        self.store.write(&binding.scope,sid.key(),&session.encode()?)?;
        *self.revisions.lock().unwrap().entry(key).or_default()+=1;Ok(session)
    }
    pub async fn oauth(&self,c:&Credentials,epoch:u64,force:bool)->Result<OAuthCredentials>{match self.session(c,epoch,Sid::OAuth,force).await? {Session::OAuth(v)=>Ok(v),_=>Err(required())}}
    pub async fn mijia(&self,c:&Credentials,epoch:u64,force:bool)->Result<Credentials>{match self.session(c,epoch,Sid::Mijia,force).await? {Session::Mijia(v)=>Ok(v),_=>Err(required())}}
    pub async fn logout(&self)->Result<()> {let mut current=self.current.lock().await;if let Some(old)=current.take(){old.cancel.cancel();self.erase(&old.scope)?;}self.flights.lock().await.clear();Ok(())}
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize,Ordering};
    struct Mock {calls:AtomicUsize,wrong:bool,gate:Option<Arc<tokio::sync::Notify>>}
    impl Wire for Mock {
        fn exchange<'a>(&'a self,c:&'a Credentials,_:Zeroizing<String>,sid:Sid,cancel:CancellationToken)->Io<'a,Session>{Box::pin(async move{
            self.calls.fetch_add(1,Ordering::SeqCst);
            if let Some(gate)=&self.gate{tokio::select!{_=cancel.cancelled()=>return Err(AppError::stale()),_=gate.notified()=>{}}}
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            let user=if self.wrong{"2"}else{&c.user_id};
            Ok(match sid {Sid::Mijia=>Session::Mijia(credentials(user)),Sid::OAuth=>Session::OAuth(OAuthCredentials{user_id:user.into(),service_token:"mock-oauth".into()})})
        })}
    }
    fn credentials(user:&str)->Credentials{Credentials{user_id:user.into(),security:"AAECAwQFBgcICQoLDA0ODw==".into(),service_token:"mock-mijia".into(),device_id:"mock-device".into(),region:"cn".into(),service_id:"mijia".into(),c_user_id:"mock-cuser".into()}}
    fn service(wrong:bool,gate:Option<Arc<tokio::sync::Notify>>)->(AccountSso,Arc<MemoryStore>,Arc<Mock>){let store=Arc::new(MemoryStore::default());let wire=Arc::new(Mock{calls:AtomicUsize::new(0),wrong,gate});(AccountSso::new(store.clone(),wire.clone()),store,wire)}
    #[tokio::test]
    async fn saved_sso_restores_and_sid_requests_share_one_exchange(){
        let (sso,store,wire)=service(false,None);let c=credentials("1");
        sso.remember_login(&c,1,Some(Zeroizing::new("mock-pass".into()))).await.unwrap();
        let (a,b)=tokio::join!(sso.oauth(&c,1,false),sso.oauth(&c,1,false));assert!(a.is_ok()&&b.is_ok());assert_eq!(wire.calls.load(Ordering::SeqCst),1);
        let restored=AccountSso::new(store.clone(),wire.clone());assert_eq!(restored.oauth(&c,1,false).await.unwrap().service_token,"mock-oauth");
        let (a,b)=tokio::join!(restored.oauth(&c,1,true),restored.oauth(&c,1,true));assert!(a.is_ok()&&b.is_ok());assert_eq!(wire.calls.load(Ordering::SeqCst),2);
        assert!(store.read(&PreferenceStore::scope("1","cn"),"sid-mijia").unwrap().is_some());
    }
    #[tokio::test]
    async fn durable_opt_out_blocks_reconnect_but_explicit_login_enables_it(){
        let (sso,store,wire)=service(false,None);let c=credentials("1");sso.remember_login(&c,1,Some(Zeroizing::new("mock-pass".into()))).await.unwrap();
        sso.disable_assistant(&c,1).await.unwrap();
        let restored=AccountSso::new(store.clone(),wire.clone());assert!(restored.availability(&c,1).await.unwrap().opted_out);assert!(restored.oauth(&c,1,false).await.is_err());assert_eq!(wire.calls.load(Ordering::SeqCst),0);
        restored.remember_login(&c,2,None).await.unwrap();assert!(restored.oauth(&c,2,false).await.is_ok());
        restored.logout().await.unwrap();assert!(store.read(&PreferenceStore::scope("1","cn"),"account").unwrap().is_none());
    }
    #[tokio::test]
    async fn wrong_account_and_late_exchange_cannot_store_credentials(){
        let (sso,store,_)=service(true,None);let c=credentials("1");sso.remember_login(&c,1,Some(Zeroizing::new("mock-pass".into()))).await.unwrap();
        assert!(sso.oauth(&c,1,false).await.is_err());assert!(store.read(&PreferenceStore::scope("1","cn"),"sid-oauth2.0").unwrap().is_none());
        let gate=Arc::new(tokio::sync::Notify::new());let (sso,store,wire)=service(false,Some(gate.clone()));let sso=Arc::new(sso);
        sso.remember_login(&c,1,Some(Zeroizing::new("mock-pass".into()))).await.unwrap();
        let task={let sso=sso.clone();tokio::spawn(async move{sso.oauth(&credentials("1"),1,false).await})};
        while wire.calls.load(Ordering::SeqCst)==0 {tokio::task::yield_now().await;}
        sso.bind_account(&credentials("2"),2).await.unwrap();gate.notify_waiters();assert!(task.await.unwrap().is_err());assert!(store.read(&PreferenceStore::scope("1","cn"),"sid-oauth2.0").unwrap().is_none());
    }
    #[tokio::test]
    async fn legacy_session_without_sso_remains_unmodified(){
        let (sso,store,wire)=service(false,None);let c=credentials("1");
        assert!(!sso.availability(&c,1).await.unwrap().reusable);assert!(sso.oauth(&c,1,false).await.is_err());assert_eq!(wire.calls.load(Ordering::SeqCst),0);assert!(store.read(&PreferenceStore::scope("1","cn"),"account").unwrap().is_none());
    }
}
