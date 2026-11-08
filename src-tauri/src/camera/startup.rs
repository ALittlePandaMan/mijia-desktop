use super::*;
use std::collections::BTreeMap;
use tokio::sync::OwnedSemaphorePermit;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Route {
    Local,
    Relay,
    Punch,
}
pub(crate) type Hints = Arc<Mutex<BTreeMap<String, Route>>>;
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Timings {
    pub cloud_start_ms: Option<u64>,
    pub cloud_ready_ms: Option<u64>,
    pub connect_start_ms: Option<u64>,
    pub connected_ms: Option<u64>,
    pub authenticated_ms: Option<u64>,
    pub first_packet_ms: Option<u64>,
    pub route: Option<&'static str>,
}
pub(crate) struct Startup {
    pub origin: Instant,
    pub timings: Arc<Mutex<Timings>>,
    pub permits: Vec<OwnedSemaphorePermit>,
    pub hints: Hints,
    pub did: String,
}
impl Startup {
    pub fn mark(&self, update: impl FnOnce(&mut Timings, u64)) {
        if let Ok(mut t) = self.timings.lock() {
            update(&mut t, self.origin.elapsed().as_millis() as u64);
        }
    }
    pub fn hint(&self) -> Option<Route> {
        self.hints.lock().ok()?.get(&self.did).copied()
    }
    pub fn remember(&self, route: Route) {
        if let Ok(mut h) = self.hints.lock() {
            h.insert(self.did.clone(), route);
        }
    }
    pub fn forget(&self) {
        if let Ok(mut h) = self.hints.lock() {
            h.remove(&self.did);
        }
    }
}
