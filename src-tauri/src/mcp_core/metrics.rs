//! Local diagnostic counters, without targets, request IDs, credentials or payloads.
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    future::Future,
    sync::{Arc, Mutex},
    time::Instant,
};
#[derive(Clone)]
pub struct Trace {
    started: Instant,
    tool: String,
    counters: Arc<Mutex<BTreeMap<String, u64>>>,
}
tokio::task_local! {static TRACE:Trace;}
impl Trace {
    pub fn new(tool: &str) -> Self {
        Self {
            started: Instant::now(),
            tool: tool.into(),
            counters: Default::default(),
        }
    }
    pub async fn scope<T>(&self, future: impl Future<Output = T>) -> T {
        TRACE.scope(self.clone(), future).await
    }
    pub fn result(&self, phase: &str, bytes: Option<usize>) -> Value {
        json!({"at":super::now_ms(),"tool":self.tool,"phase":phase,"elapsedMs":self.started.elapsed().as_millis(),"callToolResultBytes":bytes,"counts":*self.counters.lock().unwrap(),"modelTokens":Value::Null,"agentRoundTrips":Value::Null})
    }
    pub fn save(&self, phase: &str, bytes: Option<usize>) {
        use std::io::Write;
        static LOCK: Mutex<()> = Mutex::new(());
        let _lock = LOCK.lock().unwrap();
        let Ok(root) = crate::app_settings::directory() else {
            return;
        };
        let path = root.join("mcp/metrics-v1.jsonl");
        let _ = std::fs::create_dir_all(path.parent().unwrap());
        if std::fs::metadata(&path).is_ok_and(|m| m.len() > 2 * 1024 * 1024) {
            let _ = std::fs::rename(&path, path.with_extension("previous.jsonl"));
        }
        if let Ok(mut f) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(f, "{}", self.result(phase, bytes));
        }
    }
}
pub fn count(name: &str) {
    add(name, 1);
}
pub fn add(name: &str, amount: u64) {
    let _ =
        TRACE.try_with(|t| *t.counters.lock().unwrap().entry(name.into()).or_default() += amount);
}
pub fn current() -> Option<Trace> {
    TRACE.try_with(Clone::clone).ok()
}
pub fn inherit<T>(future: impl Future<Output = T>) -> impl Future<Output = T> {
    let trace = current();
    async move {
        if let Some(trace) = trace {
            trace.scope(future).await
        } else {
            future.await
        }
    }
}
pub fn cloud(path: &str) {
    count("cloudRequests");
    count(match path {
        "/miotspec/prop/get" => "propertyReads",
        "/miotspec/prop/set" => "propertyWrites",
        "/v2/homeroom/gethome_merged" | "/v2/homeroom/gethome" | "/homeroom/gethome" => {
            "allHomeEnumerations"
        }
        "/v2/home/home_device_list" | "/v2/homeroom/gethome_device_list" | "/home/device_list" => {
            "inventoryRequests"
        }
        "/v2/home/get_union_order"
        | "/v2/homeroom/get_dev_room_page"
        | "/v2/home/get_room_view" => "uiOrderRequests",
        _ => "otherCloudRequests",
    });
}
