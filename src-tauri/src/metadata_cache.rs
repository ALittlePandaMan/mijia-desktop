//! Public MIoT metadata only: no account, home, DID, credentials or live values.
use crate::{
    error::{AppError, Result},
    models::epoch_secs,
};
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashMap, path::PathBuf, sync::Arc, time::Duration};
use tokio::sync::Mutex;

const DAY: u64 = 86400;
const CAPACITY: usize = 256;
#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) enum Key {
    Registry,
    Instance(String),
}
impl Key {
    fn identity(&self) -> String {
        match self {
            Self::Registry => "instances-released-v1".into(),
            Self::Instance(typ) => format!("instance:{typ}"),
        }
    }
    fn fresh_for(&self) -> u64 {
        match self {
            Self::Registry => DAY,
            Self::Instance(_) => 7 * DAY,
        }
    }
    fn max_age(&self) -> u64 {
        match self {
            Self::Registry => 7 * DAY,
            Self::Instance(_) => 90 * DAY,
        }
    }
    fn valid(&self, value: &Value) -> bool {
        match self {
            Self::Registry => value["instances"].as_array().is_some_and(|v| {
                !v.is_empty()
                    && v.len() <= 200000
                    && v.iter().any(|row| {
                        row["status"] == "released"
                            && row["model"].as_str().is_some_and(|model| !model.is_empty())
                            && row["type"]
                                .as_str()
                                .is_some_and(|typ| typ.starts_with("urn:miot-spec-v2:device:"))
                    })
            }),
            Self::Instance(typ) => {
                value["type"].as_str() == Some(typ)
                    && value["services"].as_array().is_some_and(|v| {
                        !v.is_empty()
                            && v.len() <= 1024
                            && v.iter().all(|service| {
                                let iid = |value: &Value| {
                                    value["iid"]
                                        .as_u64()
                                        .is_some_and(|iid| iid > 0 && iid <= u64::from(u32::MAX))
                                };
                                iid(service)
                                    && ["properties", "actions"].iter().all(|key| {
                                        service.get(key).is_none_or(|items| {
                                            items.is_null()
                                                || items
                                                    .as_array()
                                                    .is_some_and(|items| items.iter().all(iid))
                                        })
                                    })
                            })
                    })
            }
        }
    }
}
#[derive(Clone)]
struct Entry {
    value: Arc<Value>,
    fetched_at: u64,
}
#[derive(Serialize, Deserialize)]
struct Envelope {
    version: u32,
    key: String,
    fetched_at: u64,
    value: Value,
}
struct Inner {
    client: Client,
    base: String,
    directory: Option<PathBuf>,
    memory: Mutex<HashMap<String, Entry>>,
    flights: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    failures: Mutex<HashMap<String, (u64, AppError)>>,
}
#[derive(Clone)]
pub(crate) struct MetadataCache {
    inner: Arc<Inner>,
}
impl MetadataCache {
    pub fn new() -> Result<Self> {
        let directory = crate::platform_paths::local_data_dir().map(|base| {
            PathBuf::from(base)
                .join("io.mijiadesktop.client")
                .join("public-spec-v1")
        });
        Self::configured("https://miot-spec.org/miot-spec-v2/".into(), directory)
    }
    fn configured(base: String, directory: Option<PathBuf>) -> Result<Self> {
        Ok(Self {
            inner: Arc::new(Inner {
                client: Client::builder()
                    .connect_timeout(Duration::from_secs(8))
                    .timeout(Duration::from_secs(15))
                    .build()
                    .map_err(AppError::network)?,
                base,
                directory,
                memory: Mutex::new(HashMap::new()),
                flights: Mutex::new(HashMap::new()),
                failures: Mutex::new(HashMap::new()),
            }),
        })
    }
    fn path(&self, key: &Key) -> Option<PathBuf> {
        self.inner.directory.as_ref().map(|dir| {
            dir.join(format!(
                "{:x}.json",
                Sha256::digest(key.identity().as_bytes())
            ))
        })
    }
    async fn cached(&self, key: &Key) -> Option<Entry> {
        let identity = key.identity();
        let now = epoch_secs();
        if let Some(entry) = self
            .inner
            .memory
            .lock()
            .await
            .get(&identity)
            .filter(|e| e.fetched_at <= now && now - e.fetched_at <= key.max_age())
            .cloned()
        {
            return Some(entry);
        }
        let path = self.path(key)?;
        let key = key.clone();
        let entry = tokio::task::spawn_blocking(move || {
            let meta = std::fs::metadata(&path).ok()?;
            if meta.len() > 32 * 1024 * 1024 {
                return None;
            }
            let envelope: Envelope = serde_json::from_slice(&std::fs::read(path).ok()?).ok()?;
            if envelope.version != 1
                || envelope.key != key.identity()
                || envelope.fetched_at > now
                || now - envelope.fetched_at > key.max_age()
                || !key.valid(&envelope.value)
            {
                return None;
            }
            Some(Entry {
                value: Arc::new(envelope.value),
                fetched_at: envelope.fetched_at,
            })
        })
        .await
        .ok()
        .flatten()?;
        self.remember(identity, entry.clone()).await;
        Some(entry)
    }
    async fn remember(&self, key: String, entry: Entry) {
        let mut memory = self.inner.memory.lock().await;
        if memory.len() >= CAPACITY && !memory.contains_key(&key) {
            if let Some(old) = memory
                .iter()
                .min_by_key(|(_, e)| e.fetched_at)
                .map(|(key, _)| key.clone())
            {
                memory.remove(&old);
            }
        }
        memory.insert(key, entry);
    }
    pub async fn get(&self, key: Key) -> Result<Arc<Value>> {
        if let Some(entry) = self.cached(&key).await {
            if epoch_secs().saturating_sub(entry.fetched_at) > key.fresh_for() {
                let cache = self.clone();
                let refresh = key.clone();
                tokio::spawn(async move {
                    let _ = cache.refresh(refresh).await;
                });
            }
            return Ok(entry.value);
        }
        self.refresh(key).await.map(|entry| entry.value)
    }
    async fn refresh(&self, key: Key) -> Result<Entry> {
        let identity = key.identity();
        let gate = {
            let mut flights = self.inner.flights.lock().await;
            if flights.len() > CAPACITY {
                flights.retain(|_, gate| Arc::strong_count(gate) > 1);
            }
            flights.entry(identity.clone()).or_default().clone()
        };
        let _guard = gate.lock().await;
        if let Some(entry) = self
            .cached(&key)
            .await
            .filter(|e| epoch_secs().saturating_sub(e.fetched_at) <= key.fresh_for())
        {
            return Ok(entry);
        }
        if let Some((_, error)) = self
            .inner
            .failures
            .lock()
            .await
            .get(&identity)
            .filter(|(at, _)| epoch_secs().saturating_sub(*at) < 10)
        {
            return Err(error.clone());
        }
        let fetched: Result<Entry> = async {
            let mut request = self.inner.client.get(format!(
                "{}{}",
                self.inner.base,
                match key {
                    Key::Registry => "instances",
                    Key::Instance(_) => "instance",
                }
            ));
            request = match &key {
                Key::Registry => request.query(&[("status", "all")]),
                Key::Instance(typ) => request.query(&[("type", typ)]),
            };
            let response = request.send().await.map_err(AppError::network)?;
            if !response.status().is_success() {
                return Err(AppError::new(
                    "specUnavailable",
                    "MIoT描述服务暂时不可用，请稍后重试。",
                    true,
                ));
            }
            if response
                .content_length()
                .is_some_and(|n| n > 32 * 1024 * 1024)
            {
                return Err(AppError::protocol());
            }
            let bytes = response.bytes().await.map_err(AppError::network)?;
            if bytes.len() > 32 * 1024 * 1024 {
                return Err(AppError::protocol());
            }
            let value: Value = serde_json::from_slice(&bytes).map_err(|_| AppError::protocol())?;
            if !key.valid(&value) {
                return Err(AppError::protocol());
            }
            let entry = Entry {
                value: Arc::new(value),
                fetched_at: epoch_secs(),
            };
            Ok(entry)
        }
        .await;
        let entry = match fetched {
            Ok(entry) => {
                self.inner.failures.lock().await.remove(&identity);
                entry
            }
            Err(error) => {
                let mut failures = self.inner.failures.lock().await;
                if failures.len() >= CAPACITY {
                    failures.retain(|_, (at, _)| epoch_secs().saturating_sub(*at) < 10);
                    if failures.len() >= CAPACITY {
                        if let Some(key) = failures.keys().next().cloned() {
                            failures.remove(&key);
                        }
                    }
                }
                failures.insert(identity, (epoch_secs(), error.clone()));
                return Err(error);
            }
        };
        self.remember(identity.clone(), entry.clone()).await;
        if let Some(path) = self.path(&key) {
            let envelope = Envelope {
                version: 1,
                key: identity,
                fetched_at: entry.fetched_at,
                value: (*entry.value).clone(),
            };
            let _ = tokio::task::spawn_blocking(move || write_disk(path, &envelope)).await;
        }
        Ok(entry)
    }
}
fn write_disk(path: PathBuf, envelope: &Envelope) -> std::io::Result<()> {
    let Some(directory) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(directory)?;
    let temporary = path.with_extension(format!("{}.tmp", std::process::id()));
    std::fs::write(&temporary, serde_json::to_vec(envelope)?)?;
    // Rename replaces the complete file; failed downloads never touch old data.
    std::fs::rename(&temporary, &path)?;
    let mut files: Vec<_> = std::fs::read_dir(directory)?
        .filter_map(std::result::Result::ok)
        .filter_map(|entry| {
            let path = entry.path();
            if path.extension()?.to_str()? != "json" {
                return None;
            }
            let meta = entry.metadata().ok()?;
            meta.is_file()
                .then_some((path, meta.modified().ok()?, meta.len()))
        })
        .collect();
    files.sort_by_key(|(_, time, _)| *time);
    let mut bytes: u64 = files.iter().map(|v| v.2).sum();
    let count = files.len();
    for (index, (path, _, size)) in files.into_iter().enumerate() {
        if (count - index > CAPACITY || bytes > 128 * 1024 * 1024)
            && std::fs::remove_file(path).is_ok()
        {
            bytes = bytes.saturating_sub(size);
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::atomic::{AtomicUsize, Ordering};
    fn directory() -> PathBuf {
        static ID: AtomicUsize = AtomicUsize::new(0);
        std::env::temp_dir().join(format!(
            "mijia-public-cache-test-{}-{}",
            std::process::id(),
            ID.fetch_add(1, Ordering::Relaxed)
        ))
    }
    #[tokio::test]
    async fn disk_hit_is_reusable_without_network_and_never_crosses_type() {
        let directory = directory();
        let cache =
            MetadataCache::configured("http://127.0.0.1:1/".into(), Some(directory.clone()))
                .unwrap();
        let key = Key::Instance("urn:miot-spec-v2:device:test:1".into());
        let value = json!({"type":"urn:miot-spec-v2:device:test:1","services":[{"iid":17}]});
        write_disk(
            cache.path(&key).unwrap(),
            &Envelope {
                version: 1,
                key: key.identity(),
                fetched_at: epoch_secs(),
                value: value.clone(),
            },
        )
        .unwrap();
        assert_eq!(*cache.get(key.clone()).await.unwrap(), value);
        let next =
            MetadataCache::configured("http://127.0.0.1:1/".into(), Some(directory)).unwrap();
        assert_eq!(*next.get(key).await.unwrap(), value);
        assert!(next
            .get(Key::Instance("urn:miot-spec-v2:device:foreign:2".into()))
            .await
            .is_err());
    }
    #[tokio::test]
    async fn one_public_template_rebinds_distinct_private_devices_and_parents() {
        use crate::{
            models::{Device, SplitRoute},
            spec::{self, SpecRepository},
        };
        let raw: Value =
            serde_json::from_str(include_str!("fixtures/miot/air-purifier.json")).unwrap();
        let typ = raw["type"].as_str().unwrap().to_owned();
        let siid = raw["services"]
            .as_array()
            .unwrap()
            .iter()
            .find(|s| s["properties"].as_array().is_some_and(|p| !p.is_empty()))
            .unwrap()["iid"]
            .as_u64()
            .unwrap() as u32;
        let cache =
            MetadataCache::configured("http://127.0.0.1:1/".into(), Some(directory())).unwrap();
        let key = Key::Instance(typ.clone());
        write_disk(
            cache.path(&key).unwrap(),
            &Envelope {
                version: 1,
                key: key.identity(),
                fetched_at: epoch_secs(),
                value: raw,
            },
        )
        .unwrap();
        let specs = SpecRepository::from_test_metadata(cache);
        let make = |did: &str, parent: &str| {
            let mut device:Device=serde_json::from_value(json!({"did":did,"name":"fixture","model":"1245.airpurifier.dl01","online":true,"roomId":"fixture","roomName":"fixture","specType":typ})).unwrap();
            device.split_route = Some(SplitRoute {
                parent_did: parent.into(),
                service_iid: siid,
            });
            device
        };
        let a = specs.panel(&make("private-a", "parent-a")).await.unwrap();
        let b = specs.panel(&make("private-b", "parent-b")).await.unwrap();
        assert_eq!(a.did, "private-a");
        assert_eq!(b.did, "private-b");
        assert_eq!(a.control_did(), "parent-a");
        assert_eq!(b.control_did(), "parent-b");
        for (panel, parent) in [(&a, "parent-a"), (&b, "parent-b")] {
            assert!(spec::read_params(panel)
                .iter()
                .all(|p| p["did"] == parent && p["siid"] == siid));
            assert!(panel
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .all(|p| p.value.is_none() && p.last_reported.is_none()));
        }
    }
    #[tokio::test]
    async fn expired_corrupt_future_and_mismatched_envelopes_are_misses() {
        let cache =
            MetadataCache::configured("http://127.0.0.1:1/".into(), Some(directory())).unwrap();
        let key = Key::Registry;
        for (fetched_at, identity, value) in [
            (
                epoch_secs() - 8 * DAY,
                key.identity(),
                json!({"instances":[{"model":"public-model","status":"released","type":"urn:miot-spec-v2:device:switch:fixture"}]}),
            ),
            (
                epoch_secs() + 3600,
                key.identity(),
                json!({"instances":[{"model":"public-model","status":"released","type":"urn:miot-spec-v2:device:switch:fixture"}]}),
            ),
            (
                epoch_secs(),
                "other".into(),
                json!({"instances":[{"model":"public-model","status":"released","type":"urn:miot-spec-v2:device:switch:fixture"}]}),
            ),
            (epoch_secs(), key.identity(), json!({"instances":[]})),
        ] {
            write_disk(
                cache.path(&key).unwrap(),
                &Envelope {
                    version: 1,
                    key: identity,
                    fetched_at,
                    value,
                },
            )
            .unwrap();
            assert!(cache.cached(&key).await.is_none());
        }
        std::fs::write(cache.path(&key).unwrap(), b"broken").unwrap();
        assert!(cache.cached(&key).await.is_none());
    }
    #[tokio::test]
    async fn stale_disk_value_is_returned_while_refresh_fails() {
        let cache =
            MetadataCache::configured("http://127.0.0.1:1/".into(), Some(directory())).unwrap();
        let key = Key::Registry;
        let value = json!({"instances":[{"model":"public-model","status":"released","type":"urn:miot-spec-v2:device:switch:fixture"}]});
        write_disk(
            cache.path(&key).unwrap(),
            &Envelope {
                version: 1,
                key: key.identity(),
                fetched_at: epoch_secs() - 2 * DAY,
                value: value.clone(),
            },
        )
        .unwrap();
        let failure = cache.refresh(key.clone()).await.err().unwrap();
        assert!(matches!(
            failure.kind.as_str(),
            "network" | "specUnavailable"
        ));
        assert_eq!(*cache.get(key).await.unwrap(), value);
    }
    #[tokio::test]
    async fn simultaneous_misses_share_one_http_download() {
        use std::{
            io::{Read, Write},
            net::TcpListener,
        };
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let count = Arc::new(AtomicUsize::new(0));
        let hits = count.clone();
        let server = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            hits.fetch_add(1, Ordering::Relaxed);
            let mut buffer = [0; 2048];
            let _ = socket.read(&mut buffer);
            let body = r#"{"instances":[{"model":"real-contract-shape","status":"released","type":"urn:miot-spec-v2:device:switch:fixture"}]}"#;
            write!(socket,"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",body.len(),body).unwrap();
        });
        let cache = MetadataCache::configured(format!("http://{address}/"), None).unwrap();
        let (a, b) = tokio::join!(cache.get(Key::Registry), cache.get(Key::Registry));
        assert!(a.is_ok() && b.is_ok());
        server.join().unwrap();
        assert_eq!(count.load(Ordering::Relaxed), 1);
    }
}
