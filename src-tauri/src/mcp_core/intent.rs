use std::{
    collections::{BTreeSet, HashMap},
    sync::{
        atomic::{AtomicU64, Ordering},
        Arc, Mutex,
    },
};
#[derive(Clone, Debug)]
pub struct Ticket {
    pub version: u64,
    pub keys: Vec<String>,
    pub reads: Vec<(String, String, u64)>,
}
#[derive(Default)]
pub struct Intents {
    serial: AtomicU64,
    owners: Mutex<HashMap<String, u64>>,
    connections: Mutex<HashMap<String, BTreeSet<String>>>,
}
impl Intents {
    pub fn configure(&self, edges: &[(String, String)]) {
        let mut graph = self.connections.lock().unwrap();
        for (a, b) in edges {
            graph.entry(a.clone()).or_default().insert(b.clone());
            graph.entry(b.clone()).or_default().insert(a.clone());
        }
    }
    pub fn reserve(&self) -> u64 {
        self.serial.fetch_add(1, Ordering::AcqRel) + 1
    }
    pub fn claim(&self, keys: impl IntoIterator<Item = String>) -> Ticket {
        self.bind(self.reserve(), keys)
    }
    pub fn bind(&self, version: u64, keys: impl IntoIterator<Item = String>) -> Ticket {
        let graph = self.connections.lock().unwrap();
        let mut all = BTreeSet::new();
        let mut components = vec![];
        for root in keys {
            if all.contains(&root) {
                continue;
            }
            let mut component = BTreeSet::new();
            let mut pending = vec![root];
            while let Some(key) = pending.pop() {
                if component.insert(key.clone()) {
                    if let Some(anchor) = anchor(&key).filter(|a| graph.contains_key(a)) {
                        pending.push(anchor);
                    }
                    if let Some(next) = graph.get(&key) {
                        pending.extend(next.iter().cloned());
                    }
                }
            }
            all.extend(component.iter().cloned());
            components.push(component);
        }
        drop(graph);
        let mut owners = self.owners.lock().unwrap();
        for component in components {
            let owner = component
                .iter()
                .filter_map(|k| owners.get(k).copied())
                .max()
                .unwrap_or(version)
                .max(version);
            for key in component {
                owners.insert(key, owner);
            }
        }
        Ticket {
            version,
            keys: all.into_iter().collect(),
            reads: vec![],
        }
    }
    // Read dependencies do not claim ownership or cancel independent writers.
    pub fn observe_for(
        &self,
        ticket: &mut Ticket,
        owner: &str,
        keys: impl IntoIterator<Item = String>,
    ) {
        let owners = self.owners.lock().unwrap();
        for key in keys {
            let version = observed(&owners, &key);
            ticket.reads.push((owner.to_owned(), key, version));
        }
    }
    pub fn current(&self, ticket: &Ticket, key: &str) -> bool {
        {
            let owners = self.owners.lock().unwrap();
            ticket.keys.iter().any(|k| k == key)
                && owned(&owners, ticket.version, key)
                && ticket
                    .reads
                    .iter()
                    .filter(|(owner, _, _)| owner == key)
                    .all(|(_, k, v)| *v <= ticket.version && observed(&owners, k) == *v)
        }
    }
    pub fn current_all(&self, ticket: &Ticket) -> bool {
        let owners = self.owners.lock().unwrap();
        ticket
            .keys
            .iter()
            .all(|key| owned(&owners, ticket.version, key))
            && ticket
                .reads
                .iter()
                .all(|(_, k, v)| *v <= ticket.version && observed(&owners, k) == *v)
    }
    pub fn guard(
        self: &Arc<Self>,
        ticket: Ticket,
        key: String,
    ) -> Arc<dyn Fn() -> bool + Send + Sync> {
        let this = self.clone();
        Arc::new(move || this.current(&ticket, &key))
    }
}

fn observed(owners: &HashMap<String, u64>, key: &str) -> u64 {
    if key.ends_with("\n*") {
        let prefix = &key[..key.len() - 1];
        owners
            .iter()
            .filter(|(k, _)| k.starts_with(prefix))
            .map(|(_, v)| *v)
            .max()
            .unwrap_or(0)
    } else {
        owners.get(key).copied().unwrap_or(0).max(
            anchor(key)
                .and_then(|a| owners.get(&a).copied())
                .unwrap_or(0),
        )
    }
}
fn owned(owners: &HashMap<String, u64>, version: u64, key: &str) -> bool {
    owners.get(key) == Some(&version) && observed(owners, key) <= version
}
pub fn device_key(scope: &str, home: &str, did: &str) -> String {
    format!("{scope}\n{home}\n{did}\n*")
}

#[derive(Clone)]
pub struct Active {
    pub intents: Arc<Intents>,
    pub ticket: Ticket,
    pub key: String,
}
tokio::task_local! {pub static ACTIVE:Active;}
pub fn active_current() -> bool {
    ACTIVE
        .try_with(|v| v.intents.current(&v.ticket, &v.key))
        .unwrap_or(true)
}

pub fn anchor(key: &str) -> Option<String> {
    let parts = key.split('\n').collect::<Vec<_>>();
    (parts.len() == 4 && parts[3] != "*")
        .then(|| format!("{}\n{}\n{}\n*", parts[0], parts[1], parts[2]))
}
