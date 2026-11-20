//! Read-only MiClaw inventory. No artwork, Spec, property reads or device writes.
use crate::{auth::Credentials, cloud_assistant::transport::{Endpoint, Wire}, error::{AppError, Result}, models::{Home, Room}};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{collections::{BTreeMap, HashMap, HashSet}, sync::{Arc, atomic::{AtomicU64, Ordering}}, time::{Duration, Instant}};
use tokio::sync::Mutex;
use tokio_util::sync::CancellationToken;

const TTL: Duration = Duration::from_secs(300);
pub const CONTEXT_URI: &str = "mijia://context/v1/selected-homes";
pub const CONTEXT_BUDGET: usize = 24 * 1024;
const MAX_PAGES: usize = 100;

#[derive(Clone, Serialize, Deserialize)]
pub struct CatalogHome {
    pub home: Home,
    pub dids: Vec<String>,
}
#[derive(Clone)]
struct Device {
    did: String,
    name: String,
    model: String,
    online: bool,
    owner: String,
    owner_name: String,
}
struct Cached<T> { at: Instant, updated: u64, value: T }
pub struct Directory {
    wire: Arc<dyn Wire>,
    homes: Mutex<Option<(String, Cached<Vec<CatalogHome>>)>>,
    home_flight: Mutex<()>,
    devices: Mutex<HashMap<String, Cached<Vec<Device>>>>,
    flights: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    epoch: AtomicU64,
    cancel: std::sync::Mutex<CancellationToken>,
}
impl Directory {
    pub fn new(wire: Arc<dyn Wire>) -> Self {
        Self { wire, homes: Mutex::new(None), home_flight: Mutex::new(()), devices: Mutex::new(HashMap::new()), flights: Mutex::new(HashMap::new()), epoch:AtomicU64::new(0), cancel:std::sync::Mutex::new(CancellationToken::new()) }
    }
    pub async fn clear(&self) {
        self.epoch.fetch_add(1,Ordering::AcqRel);
        { let mut c=self.cancel.lock().unwrap();c.cancel();*c=CancellationToken::new(); }
        *self.homes.lock().await = None;
        self.devices.lock().await.clear();
        self.flights.lock().await.clear();
    }
    fn check(&self,epoch:u64)->Result<()> { if self.epoch.load(Ordering::Acquire)==epoch {Ok(())}else{Err(AppError::stale())} }
    async fn post(&self, c: &Credentials, endpoint: Endpoint, body: Value, epoch:u64) -> Result<Value> {
        self.check(epoch)?;
        if c.region != "cn" || c.service_id != "mijia" {
            return Err(AppError::new("assistantRegionUnsupported", "智能家居助手目录仅支持中国区 mijia 会话。", false));
        }
        let cancel=self.cancel.lock().unwrap().clone();
        let value = self.wire.post(c, "", endpoint, body, "smart-home-directory", cancel).await?;
        self.check(epoch)?;
        if number(&value["code"]) != Some(0) {
            return Err(AppError::new("directoryUnavailable", "米家目录读取失败。", true));
        }
        value.get("result").filter(|v| v.is_object()).cloned().ok_or_else(protocol)
    }
    pub async fn homes(&self, c: &Credentials) -> Result<(Vec<CatalogHome>, u64)> {
        let epoch=self.epoch.load(Ordering::Acquire);
        let key = account(c);
        if let Some((k, cache)) = self.homes.lock().await.as_ref().filter(|(k,v)| *k == key && v.at.elapsed() < TTL) {
            let _ = k;
            return Ok((cache.value.clone(), cache.updated));
        }
        let _flight = self.home_flight.lock().await;
        if let Some((_, cache)) = self.homes.lock().await.as_ref().filter(|(k,v)| *k == key && v.at.elapsed() < TTL) {
            return Ok((cache.value.clone(), cache.updated));
        }
        self.check(epoch)?;
        let first = self.post(c, Endpoint::HomeList, json!({"limit":150,"fetch_share":true,"fetch_share_dev":true,"plat_form":0,"app_ver":9}),epoch).await?;
        let mut homes = parse_homes(&first)?;
        let mut more = first["has_more"] == true;
        let mut cursor = id(&first["max_id"]);
        let mut seen = HashSet::new();
        for _ in 0..MAX_PAGES {
            if !more { break; }
            if cursor.is_empty() || !seen.insert(cursor.clone()) { return Err(pagination()); }
            let page = self.post(c, Endpoint::HomeRoomPage, json!({"start_id":cursor,"limit":150}),epoch).await?;
            merge_rooms(&mut homes, &page)?;
            more = page["has_more"] == true;
            cursor = id(&page["max_id"]);
        }
        if more { return Err(pagination()); }
        self.check(epoch)?;
        let updated = super::now_ms();
        // Removed homes do not retain inventory or singleflight entries forever.
        let allowed:HashSet<String>=homes.iter().map(|h|format!("{}:{}",key,h.home.id)).chain(std::iter::once(format!("{key}:separated"))).collect();
        self.devices.lock().await.retain(|k,_|allowed.contains(k));
        self.flights.lock().await.retain(|k,_|allowed.contains(k));
        *self.homes.lock().await = Some((key, Cached { at: Instant::now(), updated, value: homes.clone() }));
        Ok((homes, updated))
    }
    async fn device_page(&self, c: &Credentials, dids: &[String],epoch:u64) -> Result<Vec<Device>> {
        let mut values = BTreeMap::new();
        let mut cursor = String::new();
        let mut seen = HashSet::new();
        for _ in 0..MAX_PAGES {
            let mut body = json!({"limit":200,"get_split_device":true,"get_third_device":true,"dids":dids});
            if !cursor.is_empty() { body["start_did"] = json!(cursor); }
            let page = self.post(c, Endpoint::DeviceListPage, body,epoch).await?;
            let rows = page["list"].as_array().ok_or_else(protocol)?;
            for row in rows {
                let did = id(&row["did"]);
                if did.is_empty() { continue; }
                values.insert(did.clone(), Device { name: label(&row["name"],100), model: label(&row["model"],100), did, online: row["isOnline"] == true, owner: id(&row["owner"]["userid"]), owner_name: label(&row["owner"]["nickname"],100) });
            }
            if page["has_more"] != true { return Ok(values.into_values().collect()); }
            cursor = id(&page["next_start_did"]);
            if cursor.is_empty() || !seen.insert(cursor.clone()) { return Err(pagination()); }
        }
        Err(pagination())
    }
    async fn devices(&self, c: &Credentials, home: Option<&CatalogHome>) -> Result<Vec<Device>> {
        let epoch=self.epoch.load(Ordering::Acquire);
        let key = format!("{}:{}", account(c), home.map(|h|h.home.id.clone()).unwrap_or_else(||"separated".into()));
        if let Some(v) = self.devices.lock().await.get(&key).filter(|v|v.at.elapsed()<TTL) { return Ok(v.value.clone()); }
        let flight = self.flights.lock().await.entry(key.clone()).or_insert_with(||Arc::new(Mutex::new(()))).clone();
        let _guard = flight.lock().await;
        if let Some(v) = self.devices.lock().await.get(&key).filter(|v|v.at.elapsed()<TTL) { return Ok(v.value.clone()); }
        let mut devices = BTreeMap::new();
        if let Some(h) = home {
            // Empty dids means an empty household, never an account-wide request.
            let mut dids = h.dids.clone();
            dids.extend(h.home.room_devices.keys().cloned());
            dids.sort(); dids.dedup();
            for chunk in dids.chunks(150) {
                let allowed: HashSet<_> = chunk.iter().map(String::as_str).collect();
                for d in self.device_page(c,chunk,epoch).await? {
                    if allowed.contains(d.did.as_str()) { devices.insert(d.did.clone(),d); }
                }
            }
        } else {
            for d in self.device_page(c,&[],epoch).await? {
                if !d.owner.is_empty() { devices.insert(d.did.clone(),d); }
            }
        }
        self.check(epoch)?;
        let value: Vec<_> = devices.into_values().collect();
        self.devices.lock().await.insert(key, Cached { at: Instant::now(), updated: super::now_ms(), value: value.clone() });
        Ok(value)
    }
    async fn optional_devices(&self, c: &Credentials, home: Option<&CatalogHome>) -> Option<Result<Vec<Device>>> {
        match home { Some(h) => Some(self.devices(c,Some(h)).await), None => None }
    }
    pub async fn list(&self, c: &Credentials, homes: &[CatalogHome], separated: bool) -> DirectoryResult {
        let mut rows = vec![]; let mut warnings = vec![]; let mut seen = HashSet::new();
        for group in homes.chunks(3) {
            let (a,b,d) = tokio::join!(self.optional_devices(c,group.first()), self.optional_devices(c,group.get(1)), self.optional_devices(c,group.get(2)));
            for (home,result) in group.iter().zip([a,b,d].into_iter().flatten()) {
                match result {
                    Ok(devices) => for item in devices {
                        if !seen.insert(item.did.clone()) { continue; }
                        let room = home.home.room_devices.get(&item.did).and_then(|id|home.home.rooms.iter().find(|r|&r.id==id));
                        rows.push(json!({"source":"accountUntrusted","home_id":home.home.id,"homeName":home.home.name,"shared":home.home.shared,"name":item.name,"model":item.model,"roomName":room.map(|r|r.name.as_str()).unwrap_or("未分配房间"),"online":item.online}));
                    },
                    Err(e) => warnings.push(json!({"home_id":home.home.id,"code":e.kind,"source":"directory"})),
                }
            }
        }
        if separated {
            match self.devices(c,None).await {
                Ok(devices) => for item in devices {
                    if seen.insert(item.did.clone()) {
                        rows.push(json!({"source":"separatedSharedDeviceUntrusted","home_id":Value::Null,"shared":true,"ownerName":item.owner_name,"name":item.name,"model":item.model,"roomName":"共享给我的设备","online":item.online}));
                    }
                },
                Err(e) => warnings.push(json!({"code":e.kind,"source":"separatedSharedDevices"})),
            }
        }
        let online = rows.iter().filter(|r|r["online"]==true).count();
        DirectoryResult { summary: json!({"total":rows.len(),"online":online,"multipleHomes":homes.len()>1,"partial":!warnings.is_empty(),"warnings":warnings}), rows }
    }
}
pub struct DirectoryResult { pub summary: Value, pub rows: Vec<Value> }
fn protocol() -> AppError { AppError::new("directoryProtocol", "米家目录返回格式无效。", false) }
fn pagination() -> AppError { AppError::new("pagination", "米家目录分页未继续，结果不完整。", true) }
fn account(c: &Credentials) -> String { super::fingerprint(&(&c.user_id,&c.region,&c.service_id)) }
fn number(v: &Value) -> Option<i64> { v.as_i64().or_else(||v.as_str()?.parse().ok()) }
fn id(v: &Value) -> String {
    let s = v.as_str().map(str::to_owned).or_else(||v.as_u64().map(|n|n.to_string())).unwrap_or_default();
    if s.len()<=256 && !s.chars().any(char::is_control) { s } else { String::new() }
}
fn label(v: &Value, max: usize) -> String { v.as_str().unwrap_or("").chars().filter(|c|!c.is_control()).take(max).collect() }
fn ids(v: &Value) -> Vec<String> { v.as_array().into_iter().flatten().map(id).filter(|s|!s.is_empty()).collect() }
fn parse_homes(value: &Value) -> Result<Vec<CatalogHome>> {
    let mut result = BTreeMap::new();
    let own = value["homelist"].as_array().ok_or_else(protocol)?;
    for (shared, list) in [(false,own.as_slice()),(true,value["share_home_list"].as_array().map(Vec::as_slice).unwrap_or(&[]))] {
        for h in list {
            let home_id = id(&h["id"]); let owner_id = id(&h["uid"]);
            if home_id.is_empty() || owner_id.is_empty() || !home_id.bytes().all(|c|c.is_ascii_digit()) || !owner_id.bytes().all(|c|c.is_ascii_digit()) { return Err(protocol()); }
            let mut item = CatalogHome { home: Home { id: home_id.clone(), name: label(&h["name"],100), owner_id, shared:shared || h["shareflag"]==1, rooms:vec![], room_devices:HashMap::new() }, dids: ids(&h["dids"]) };
            merge_home_rooms(&mut item,h)?;
            result.insert(home_id,item);
        }
    }
    Ok(result.into_values().collect())
}
fn merge_home_rooms(home: &mut CatalogHome, row: &Value) -> Result<()> {
    for room in row["roomlist"].as_array().into_iter().flatten() {
        let room_id = id(&room["id"]);
        if room_id.is_empty() { return Err(protocol()); }
        if !home.home.rooms.iter().any(|r|r.id==room_id) { home.home.rooms.push(Room { id:room_id.clone(), name:label(&room["name"],100) }); }
        for did in ids(&room["dids"]) { home.home.room_devices.insert(did,room_id.clone()); }
    }
    Ok(())
}
fn merge_rooms(homes: &mut [CatalogHome], page: &Value) -> Result<()> {
    for row in page["info"].as_array().ok_or_else(protocol)? {
        if let Some(home) = homes.iter_mut().find(|h|h.home.id==id(&row["id"])) {
            home.dids.extend(ids(&row["dids"])); home.dids.sort(); home.dids.dedup();
            merge_home_rooms(home,row)?;
        }
    }
    Ok(())
}
pub fn context(homes: &[Home], updated_at: u64) -> Value {
    let mut value=json!({"source":"accountUntrusted","scopeMode":"householdDelegation","serverEnforcedScope":"unverified","updatedAt":updated_at,"version":super::fingerprint(&homes),"homes":[],"truncated":false});
    let mut rows = vec![];
    for home in homes {
        let mut row=json!({"home_id":home.id,"name":home.name,"shared":home.shared,"rooms":[]});
        let mut rooms=vec![];
        for r in &home.rooms {
            rooms.push(json!({"room_id":r.id,"name":r.name}));
            row["rooms"]=json!(rooms);
            let mut candidate=rows.clone();candidate.push(row.clone());value["homes"]=json!(candidate);
            if serde_json::to_vec(&value).unwrap().len()>CONTEXT_BUDGET {
                rooms.pop();row["rooms"]=json!(rooms);value["truncated"]=json!(true);break;
            }
        }
        rows.push(row);value["homes"]=json!(rows);
        if serde_json::to_vec(&value).unwrap().len()>CONTEXT_BUDGET { rows.pop();value["homes"]=json!(rows);value["truncated"]=json!(true);break; }
        if value["truncated"]==true { break; }
    }
    value
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::cloud_assistant::transport::{Io,Emit};
    use std::sync::atomic::{AtomicUsize,Ordering};
    struct Mock {homes:AtomicUsize,devices:AtomicUsize,active:AtomicUsize,peak:AtomicUsize,fail:String}
    impl Mock {fn new(fail:&str)->Self{Self{homes:AtomicUsize::new(0),devices:AtomicUsize::new(0),active:AtomicUsize::new(0),peak:AtomicUsize::new(0),fail:fail.into()}}}
    impl Wire for Mock {
        fn scope<'a>(&'a self,_:&'a str,_:CancellationToken)->Io<'a,String>{Box::pin(async{panic!("directory cannot request assistant authorization")})}
        fn stream<'a>(&'a self,_:&'a Credentials,_:&'a str,_:&'a str,_:&'a str,_:CancellationToken,_:Emit)->Io<'a,()>{Box::pin(async{panic!("directory cannot open assistant stream")})}
        fn post<'a>(&'a self,_:&'a Credentials,access:&'a str,endpoint:Endpoint,body:Value,_:&'a str,cancel:CancellationToken)->Io<'a,Value>{Box::pin(async move{
            assert!(access.is_empty());
            match endpoint {
                Endpoint::HomeList=>{self.homes.fetch_add(1,Ordering::SeqCst);tokio::time::sleep(Duration::from_millis(5)).await;Ok(json!({"code":0,"result":{"homelist":(1..=5).map(|n|json!({"id":n,"uid":1,"name":format!("家{n}"),"dids":[format!("d{n}")],"roomlist":[{"id":n+10,"name":"房间","dids":[format!("d{n}")]}]})).collect::<Vec<_>>()}}))},
                Endpoint::DeviceListPage=>{
                    self.devices.fetch_add(1,Ordering::SeqCst);let current=self.active.fetch_add(1,Ordering::SeqCst)+1;self.peak.fetch_max(current,Ordering::SeqCst);
                    tokio::select!{_=cancel.cancelled()=>{self.active.fetch_sub(1,Ordering::SeqCst);return Err(AppError::stale())},_=tokio::time::sleep(Duration::from_millis(10))=>{}}
                    self.active.fetch_sub(1,Ordering::SeqCst);
                    if body["dids"].as_array().unwrap().iter().any(|v|v==&self.fail){return Err(AppError::new("mockFailure","mock",true));}
                    let list=if body["dids"]==json!([]){json!([{"did":"d1","name":"已有","model":"mock.light","owner":{"userid":"99","nickname":"别人"},"isOnline":true},{"did":"separate","name":"共享插座","model":"mock.plug","owner":{"userid":"99","nickname":"别人"},"isOnline":false}])}
                    else{json!(body["dids"].as_array().unwrap().iter().map(|d|json!({"did":d,"name":"模拟灯","model":"mock.light","isOnline":true})).collect::<Vec<_>>())};
                    Ok(json!({"code":"0","result":{"list":list,"has_more":false}}))
                },
                _=>panic!("directory submitted a non-inventory endpoint"),
            }
        })}
    }
    fn credentials(user:&str)->Credentials{Credentials{user_id:user.into(),region:"cn".into(),service_id:"mijia".into(),service_token:"mock".into(),security:"AAECAwQFBgcICQoLDA0ODw==".into(),device_id:"mock".into(),c_user_id:"mock".into()}}
    #[tokio::test]
    async fn cached_inventory_coalesces_and_limits_household_parallelism(){
        let mock=Arc::new(Mock::new(""));let directory=Directory::new(mock.clone());let c=credentials("1");
        let (a,b)=tokio::join!(directory.homes(&c),directory.homes(&c));let homes=a.unwrap().0;assert_eq!(b.unwrap().0.len(),5);assert_eq!(mock.homes.load(Ordering::SeqCst),1);
        let (a,b)=tokio::join!(directory.list(&c,&homes,false),directory.list(&c,&homes,false));
        assert_eq!(a.summary["total"],5);assert_eq!(b.summary["online"],5);assert_eq!(mock.devices.load(Ordering::SeqCst),5);assert!(mock.peak.load(Ordering::SeqCst)<=3);
        let start=Instant::now();let result=directory.list(&c,&homes,false).await;assert_eq!(result.rows.len(),5);assert!(start.elapsed()<Duration::from_secs(1));
    }
    #[tokio::test]
    async fn separate_shared_devices_are_deduplicated_and_never_get_a_home_id(){
        let mock=Arc::new(Mock::new(""));let directory=Directory::new(mock);let c=credentials("1");let homes=directory.homes(&c).await.unwrap().0;
        let result=directory.list(&c,&homes,true).await;assert_eq!(result.summary["total"],6);
        let shared=result.rows.iter().find(|v|v["source"]=="separatedSharedDeviceUntrusted").unwrap();assert!(shared["home_id"].is_null());assert_eq!(shared["online"],false);
    }
    #[tokio::test]
    async fn partial_failures_are_explicit_and_account_caches_are_isolated(){
        let mock=Arc::new(Mock::new("d3"));let directory=Directory::new(mock.clone());let c=credentials("1");let homes=directory.homes(&c).await.unwrap().0;
        let result=directory.list(&c,&homes,false).await;assert_eq!(result.summary["partial"],true);assert_eq!(result.summary["total"],4);assert_eq!(result.summary["warnings"][0]["home_id"],"3");
        directory.homes(&credentials("2")).await.unwrap();assert_eq!(mock.homes.load(Ordering::SeqCst),2);
        let empty=CatalogHome{home:homes[0].home.clone(),dids:vec![]};let mut empty=empty;empty.home.room_devices.clear();let before=mock.devices.load(Ordering::SeqCst);assert!(directory.devices(&c,Some(&empty)).await.unwrap().is_empty());assert_eq!(before,mock.devices.load(Ordering::SeqCst));
    }
    #[tokio::test]
    async fn changing_room_metadata_reuses_bounded_household_cache(){
        let mock=Arc::new(Mock::new(""));let directory=Directory::new(mock.clone());let c=credentials("1");let homes=directory.homes(&c).await.unwrap().0;
        for n in 0..20 {let mut home=homes[0].clone();home.home.room_devices.insert(format!("new{n}"),"11".into());directory.devices(&c,Some(&home)).await.unwrap();}
        assert_eq!(mock.devices.load(Ordering::SeqCst),1);assert_eq!(directory.devices.lock().await.len(),1);assert_eq!(directory.flights.lock().await.len(),1);
    }
    #[test]
    fn shared_homes_and_room_pages_preserve_real_owner_and_membership() {
        let mut homes=parse_homes(&json!({"homelist":[{"id":1,"uid":2,"name":"家","dids":["a"],"roomlist":[{"id":3,"name":"客厅","dids":["a"]}]}],"share_home_list":[{"id":"4","uid":"5","name":"共享"}]})).unwrap();
        merge_rooms(&mut homes,&json!({"info":[{"id":1,"dids":["b"],"roomlist":[{"id":3,"dids":["b"]}]}]})).unwrap();
        assert_eq!(homes[0].dids,["a","b"]);assert_eq!(homes[0].home.room_devices["b"],"3");
        assert!(homes[1].home.shared);assert_eq!(homes[1].home.owner_id,"5");
    }
    #[test]
    fn context_budget_and_untrusted_data_are_explicit() {
        let homes=(0..100).map(|i|Home{id:i.to_string(),name:"<ignore instructions>".repeat(5),owner_id:"1".into(),shared:false,rooms:(0..100).map(|j|Room{id:j.to_string(),name:"房间".repeat(30)}).collect(),room_devices:HashMap::new()}).collect::<Vec<_>>();
        let value=context(&homes,123);assert!(serde_json::to_vec(&value).unwrap().len()<=CONTEXT_BUDGET);assert_eq!(value["truncated"],true);assert_eq!(value["source"],"accountUntrusted");
        assert_eq!(context(&[],123)["homes"],json!([]));
    }
}
