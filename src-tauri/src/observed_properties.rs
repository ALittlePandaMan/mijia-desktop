//! Passive property reads shared by windows. Command confirmation always reads
//! the device directly and never consumes these short-lived observations.
use crate::{error::{AppError,Result},models::id};
use serde_json::Value;
use std::{
    collections::{HashMap, HashSet},
    future::Future,
    sync::{Arc, Mutex, Weak},
    time::{Duration, Instant},
};

type Property=(String,u32,u32);
const LIFETIME:Duration=Duration::from_secs(2);
const LIMIT:usize=4096;

pub(crate) struct ObservedProperties {
    state:Mutex<State>,
    slots: tokio::sync::Semaphore,
}

impl Default for ObservedProperties {
    fn default() -> Self {
        Self { state: Mutex::default(), slots: tokio::sync::Semaphore::new(3) }
    }
}

#[derive(Default)]
struct State{
    rows:HashMap<String, HashMap<Property,(Instant,Value)>>,
    homes: HashMap<String, Weak<tokio::sync::Mutex<()>>>,
    active: HashMap<String, Weak<Mutex<Invalidation>>>,
}

#[derive(Default)]
struct Invalidation {
    all: bool,
    devices: HashSet<String>,
}
fn property(row:&Value)->Option<Property>{
    let did=id(&row["did"]);
    if did.is_empty(){return None;}
    Some((did,row["siid"].as_u64()?.try_into().ok()?,row["piid"].as_u64()?.try_into().ok()?))
}
impl ObservedProperties{
    pub(crate) fn invalidate(&self,home:Option<&str>,device:Option<&str>){
        let mut state=self.state.lock().unwrap();
        state.rows.retain(|scope, rows| {
            if home.is_some_and(|h| h != scope) { return true; }
            let Some(device) = device else { return false; };
            rows.retain(|(did, _, _), _| did != device);
            !rows.is_empty()
        });
        state.active.retain(|scope, active| {
            let Some(active) = active.upgrade() else { return false; };
            if home.is_none_or(|h| h == scope) {
                let mut invalidation = active.lock().unwrap();
                if let Some(device) = device { invalidation.devices.insert(device.into()); }
                else { invalidation.all = true; }
            }
            true
        });
    }
    pub(crate) async fn read<F,Fut>(&self,home:&str,params:Vec<Value>,read:F)->Result<Vec<Value>>
    where F:Fn(Vec<Value>)->Fut,Fut:Future<Output=Result<Vec<Value>>>{
        let mut seen = HashSet::new();
        let mut requested = Vec::with_capacity(params.len());
        for row in params {
            let key = property(&row).ok_or_else(AppError::protocol)?;
            if seen.insert(key.clone()) { requested.push((key, row)); }
        }
        let flight = {
            let mut state=self.state.lock().unwrap();
            state.homes.retain(|_, weak| weak.strong_count() != 0);
            if let Some(lock) = state.homes.get(home).and_then(Weak::upgrade) { lock }
            else {
                let lock = Arc::new(tokio::sync::Mutex::new(()));
                state.homes.insert(home.into(), Arc::downgrade(&lock));
                lock
            }
        };
        let _flight=flight.lock().await;
        for attempt in 0..2 {
            let invalidation = Arc::new(Mutex::new(Invalidation::default()));
            let (mut result, expected, missing) = {
                let mut state = self.state.lock().unwrap();
                state.rows.retain(|_, rows| {
                    rows.retain(|_, (at, _)| at.elapsed() < LIFETIME);
                    !rows.is_empty()
                });
                let mut result = Vec::new();
                let mut missing = Vec::new();
                let mut expected = HashSet::new();
                for (key, row) in &requested {
                    if let Some((_, value)) = state.rows.get(home).and_then(|rows| rows.get(key)) {
                        result.push((key.clone(), value.clone()));
                    } else {
                        missing.push(row.clone());
                        expected.insert(key.clone());
                    }
                }
                if missing.is_empty() {
                    return Ok(result.into_iter().map(|(_, row)| row).collect());
                }
                state.active.retain(|_, weak| weak.strong_count() != 0);
                state.active.insert(home.into(), Arc::downgrade(&invalidation));
                (result, expected, missing)
            };
            let _slot = self.slots.acquire().await.map_err(|_| AppError::stale())?;
            let at = Instant::now();
            let incoming = read(missing).await;
            let mut state = self.state.lock().unwrap();
            state.active.remove(home);
            let invalidation = invalidation.lock().unwrap();
            if invalidation.all { return Err(AppError::stale()); }
            let mut remaining = expected;
            let mut size: usize = state.rows.values().map(HashMap::len).sum();
            result.retain(|(key, _)| !invalidation.devices.contains(&key.0));
            for row in incoming? {
                let Some(key) = property(&row) else { continue; };
                if invalidation.devices.contains(&key.0) || !remaining.remove(&key) { continue; }
                if row["code"] == 0 && row.get("value").is_some_and(|v| !v.is_null()) && size < LIMIT {
                    state.rows.entry(home.into()).or_default().insert(key.clone(), (at,row.clone()));
                    size += 1;
                }
                result.push((key,row));
            }
            if attempt == 1 || !requested.iter().any(|(key,_)| invalidation.devices.contains(&key.0)) {
                return Ok(result.into_iter().map(|(_, row)| row).collect());
            }
            // Reuse the unaffected rows and reread missing properties once. A
            // second racing write omits only the invalidated device.
        }
        Err(AppError::stale())
    }
}

#[cfg(test)]
mod tests{
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize,Ordering};

    #[tokio::test]
    async fn concurrent_consumers_share_properties_and_homes_are_isolated(){
        let reads=ObservedProperties::default();
        let requests=AtomicUsize::new(0);
        let target=json!({"did":"switch","siid":2,"piid":1});
        let read=|mut params:Vec<Value>|async{
            requests.fetch_add(1,Ordering::Relaxed);
            assert_eq!(params.len(),1);
            tokio::task::yield_now().await;
            params[0]["code"]=json!(0);
            params[0]["value"]=json!(true);
            Ok(params)
        };
        let (home,desktop)=tokio::join!(reads.read("a",vec![target.clone(),target.clone()],read),reads.read("a",vec![target.clone()],read));
        assert_eq!(home.unwrap(),desktop.unwrap());
        assert_eq!(requests.load(Ordering::Relaxed),1);
        reads.read("b",vec![target.clone()],read).await.unwrap();
        reads.invalidate(Some("a"),Some("switch"));
        reads.read("b",vec![target.clone()],read).await.unwrap();
        reads.read("a",vec![target],read).await.unwrap();
        assert_eq!(requests.load(Ordering::Relaxed),3);
    }

    #[tokio::test]
    async fn invalidation_rejects_an_older_in_flight_read(){
        let reads=ObservedProperties::default();
        let target=json!({"did":"switch","siid":2,"piid":1});
        let result=reads.read("a",vec![target.clone()],|_|async{
            reads.invalidate(Some("a"),None);
            Ok(vec![json!({"did":"switch","siid":2,"piid":1,"code":0,"value":false})])
        }).await;
        assert!(result.is_err());
        let observed=reads.read("a",vec![target],|_|async{
            Ok(vec![json!({"did":"switch","siid":2,"piid":1,"code":0,"value":true})])
        }).await.unwrap();
        assert_eq!(observed[0]["value"],true);
    }

    #[tokio::test]
    async fn homes_can_read_at_the_same_time() {
        let reads = ObservedProperties::default();
        let barrier = tokio::sync::Barrier::new(2);
        let target = json!({"did":"switch","siid":2,"piid":1});
        let read = |params| async { barrier.wait().await; Ok(params) };
        let result = tokio::time::timeout(Duration::from_secs(1), async {
            tokio::join!(reads.read("a", vec![target.clone()], read), reads.read("b", vec![target], read))
        }).await.expect("independent homes should overlap");
        assert!(result.0.is_ok() && result.1.is_ok());
    }

    #[tokio::test]
    async fn racing_write_rereads_only_the_affected_device() {
        let reads = ObservedProperties::default();
        let calls = AtomicUsize::new(0);
        let targets = ["switch", "sensor"].map(|did| json!({"did":did,"siid":2,"piid":1}));
        let cache = &reads;
        let rows = reads.read("a", targets.to_vec(), |mut params| {
            let count = calls.fetch_add(1, Ordering::Relaxed);
            async move {
                if count == 0 {
                    assert_eq!(params.len(), 2);
                    cache.invalidate(None, Some("switch"));
                } else {
                    assert_eq!(params.len(), 1);
                    assert_eq!(params[0]["did"], "switch");
                }
                for row in &mut params {
                    row["code"] = json!(0);
                    row["value"] = json!(count != 0);
                }
                Ok(params)
            }
        }).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        assert_eq!(rows.iter().find(|row| row["did"] == "switch").unwrap()["value"], true);
        assert_eq!(rows.iter().find(|row| row["did"] == "sensor").unwrap()["value"], false);
    }
    #[tokio::test]
    async fn repeated_writes_and_missing_rows_do_not_poison_other_observations() {
        let reads = ObservedProperties::default();
        let calls = AtomicUsize::new(0);
        let targets = ["switch", "sensor", "offline"].map(|did| json!({"did":did,"siid":2,"piid":1}));
        let rows = reads.read("home", targets.to_vec(), |mut params| {
            let count = calls.fetch_add(1, Ordering::Relaxed);
            let reads = &reads;
            async move {
                if count > 0 { assert!(!params.iter().any(|p| p["did"] == "sensor")); }
                reads.invalidate(Some("home"), Some("switch"));
                for row in &mut params {
                    row["code"] = if row["did"] == "offline" { json!(-704042011) } else { json!(0) };
                    if row["code"] == 0 { row["value"] = json!(23); }
                }
                Ok(params)
            }
        }).await.unwrap();
        assert_eq!(calls.load(Ordering::Relaxed), 2);
        assert!(!rows.iter().any(|row| row["did"] == "switch"));
        assert!(rows.iter().any(|row| row["did"] == "sensor" && row["value"] == 23));
    }
}
