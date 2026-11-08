//! Account-scoped UI metadata, never live device state or credentials.
//!
//! The caller hashes region + account scope + model + specification identity into
//! `identity` and validates the fetched configuration's protocol. Only that hash
//! and the configuration are persisted. A stale result is explicitly labelled;
//! accepting a UI resource does not confirm any device property or command.
use crate::{
    error::{AppError, Result},
    models::epoch_secs,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    collections::HashMap,
    future::Future,
    io::{Read, Write},
    path::{Path, PathBuf},
    sync::{Arc, Weak},
    time::{Duration, Instant, UNIX_EPOCH},
};
use tokio::sync::Mutex;

const VERSION: u32 = 1;
const FRESH_FOR: u64 = 6 * 60 * 60;
const MAX_AGE: u64 = 30 * 24 * 60 * 60;
const RETRY_AFTER: Duration = Duration::from_secs(10);
const CAPACITY: usize = 256;
const MAX_ENTRY_BYTES: u64 = 4 * 1024 * 1024;
const MAX_DISK_BYTES: u64 = 32 * 1024 * 1024;
const TEMP_MAX_AGE: u64 = 60 * 60;

#[derive(Clone, Debug)]
pub(crate) struct CachedUiResource {
    pub value: Arc<Value>,
    pub fetched_at: u64,
    pub stale: bool,
}

#[derive(Clone)]
struct Entry {
    value: Arc<Value>,
    fetched_at: u64,
}

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct Envelope {
    version: u32,
    identity: String,
    fetched_at: u64,
    value: Value,
}

struct Failure {
    since: Instant,
    error: AppError,
}

struct Inner {
    directory: Option<PathBuf>,
    memory: Mutex<HashMap<String, Entry>>,
    flights: Mutex<HashMap<String, Weak<Mutex<()>>>>,
    failures: Mutex<HashMap<String, Failure>>,
    disk_gate: Mutex<()>,
    now: Arc<dyn Fn() -> u64 + Send + Sync>,
}

#[derive(Clone)]
pub(crate) struct UiResourceCache {
    inner: Arc<Inner>,
}

impl UiResourceCache {
    pub fn new() -> Self {
        let directory = crate::platform_paths::local_data_dir().map(|base| {
            PathBuf::from(base)
                .join("io.mijiadesktop.client")
                .join("ui-resources-v1")
        });
        Self::configured(directory, Arc::new(epoch_secs))
    }

    fn configured(directory: Option<PathBuf>, now: Arc<dyn Fn() -> u64 + Send + Sync>) -> Self {
        Self {
            inner: Arc::new(Inner {
                directory,
                memory: Mutex::new(HashMap::new()),
                flights: Mutex::new(HashMap::new()),
                failures: Mutex::new(HashMap::new()),
                disk_gate: Mutex::new(()),
                now,
            }),
        }
    }

    /// Fresh entries need no fetch. Stale entries return immediately and refresh
    /// in the background; cold reads wait on a per-identity single flight.
    pub async fn get<F, Fut>(&self, identity: String, fetch: F) -> Result<CachedUiResource>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        if !valid_identity(&identity) {
            return Err(AppError::invalid("设备界面资源的缓存标识无效。"));
        }
        // This fast path deliberately does not wait for an ongoing refresh.
        if let Some(entry) = self.memory_entry(&identity).await {
            return Ok(self.cached_result(identity, entry, fetch));
        }
        let gate = self.flight(&identity).await;
        let guard = gate.lock().await;
        if let Some(entry) = self.cached_under_gate(&identity).await {
            drop(guard);
            return Ok(self.cached_result(identity, entry, fetch));
        }
        self.fetch_under_gate(identity, fetch)
            .await
            .map(|entry| self.view(entry))
    }

    fn cached_result<F, Fut>(&self, identity: String, entry: Entry, fetch: F) -> CachedUiResource
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let view = self.view(entry);
        if view.stale {
            let cache = self.clone();
            tokio::spawn(async move {
                let _ = cache.refresh(identity, fetch).await;
            });
        }
        view
    }

    fn view(&self, entry: Entry) -> CachedUiResource {
        CachedUiResource {
            value: entry.value,
            fetched_at: entry.fetched_at,
            stale: (self.inner.now)().saturating_sub(entry.fetched_at) >= FRESH_FOR,
        }
    }

    async fn flight(&self, identity: &str) -> Arc<Mutex<()>> {
        let mut flights = self.inner.flights.lock().await;
        if let Some(gate) = flights.get(identity).and_then(Weak::upgrade) {
            return gate;
        }
        if flights.len() >= CAPACITY {
            flights.retain(|_, gate| gate.strong_count() > 0);
        }
        let gate = Arc::new(Mutex::new(()));
        flights.insert(identity.into(), Arc::downgrade(&gate));
        gate
    }

    async fn memory_entry(&self, identity: &str) -> Option<Entry> {
        let now = (self.inner.now)();
        let mut memory = self.inner.memory.lock().await;
        let entry = memory.get(identity)?;
        if !valid_time(entry.fetched_at, now) {
            memory.remove(identity);
            return None;
        }
        Some(entry.clone())
    }

    // Call only while holding this identity's flight gate. Consequently a slow
    // disk read cannot overwrite a newer network result in memory.
    async fn cached_under_gate(&self, identity: &str) -> Option<Entry> {
        if let Some(entry) = self.memory_entry(identity).await {
            return Some(entry);
        }
        let directory = self.inner.directory.clone()?;
        let identity_owned = identity.to_string();
        let now = (self.inner.now)();
        let _disk_guard = self.inner.disk_gate.lock().await;
        let entry =
            tokio::task::spawn_blocking(move || read_entry(&directory, &identity_owned, now))
                .await
                .ok()
                .flatten()?;
        self.remember(identity.to_string(), entry.clone()).await;
        Some(entry)
    }

    async fn remember(&self, identity: String, entry: Entry) {
        let mut memory = self.inner.memory.lock().await;
        if memory.len() >= CAPACITY && !memory.contains_key(&identity) {
            if let Some(oldest) = memory
                .iter()
                .min_by_key(|(_, entry)| entry.fetched_at)
                .map(|(key, _)| key.clone())
            {
                memory.remove(&oldest);
            }
        }
        memory.insert(identity, entry);
    }

    async fn refresh<F, Fut>(&self, identity: String, fetch: F) -> Result<Entry>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        let gate = self.flight(&identity).await;
        let _guard = gate.lock().await;
        if let Some(entry) = self
            .cached_under_gate(&identity)
            .await
            .filter(|entry| (self.inner.now)().saturating_sub(entry.fetched_at) < FRESH_FOR)
        {
            return Ok(entry);
        }
        self.fetch_under_gate(identity, fetch).await
    }

    async fn fetch_under_gate<F, Fut>(&self, identity: String, fetch: F) -> Result<Entry>
    where
        F: FnOnce() -> Fut + Send + 'static,
        Fut: Future<Output = Result<Value>> + Send + 'static,
    {
        if let Some(failure) = self
            .inner
            .failures
            .lock()
            .await
            .get(&identity)
            .filter(|failure| failure.since.elapsed() < RETRY_AFTER)
        {
            return Err(failure.error.clone());
        }
        let fetched = async {
            let value = fetch().await?;
            if !valid_value(&value) {
                return Err(AppError::protocol());
            }
            let envelope = Envelope {
                version: VERSION,
                identity: identity.clone(),
                fetched_at: (self.inner.now)(),
                value,
            };
            let bytes = serde_json::to_vec(&envelope).map_err(|_| AppError::protocol())?;
            if bytes.len() as u64 > MAX_ENTRY_BYTES {
                return Err(AppError::protocol());
            }
            Ok((envelope, bytes))
        }
        .await;
        match fetched {
            Ok((envelope, bytes)) => {
                let entry = Entry {
                    value: Arc::new(envelope.value),
                    fetched_at: envelope.fetched_at,
                };
                self.remember(identity.clone(), entry.clone()).await;
                self.inner.failures.lock().await.remove(&identity);
                if let Some(directory) = self.inner.directory.clone() {
                    let _disk_guard = self.inner.disk_gate.lock().await;
                    let now = (self.inner.now)();
                    // Unavailable storage must not turn a valid resource into a
                    // network failure. Only a complete atomic file is accepted.
                    let _ = tokio::task::spawn_blocking(move || {
                        persist_entry(&directory, &identity, &bytes, now);
                    })
                    .await;
                }
                Ok(entry)
            }
            Err(error) => {
                let mut failures = self.inner.failures.lock().await;
                failures.retain(|_, failure| failure.since.elapsed() < RETRY_AFTER);
                if failures.len() >= CAPACITY && !failures.contains_key(&identity) {
                    if let Some(oldest) = failures
                        .iter()
                        .min_by_key(|(_, failure)| failure.since)
                        .map(|(key, _)| key.clone())
                    {
                        failures.remove(&oldest);
                    }
                }
                failures.insert(
                    identity,
                    Failure {
                        since: Instant::now(),
                        error: error.clone(),
                    },
                );
                Err(error)
            }
        }
    }
}

fn valid_identity(identity: &str) -> bool {
    identity.len() == 64
        && identity
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn owned_temporary(name: &str) -> bool {
    let Some(stem) = name.strip_suffix(".tmp") else {
        return false;
    };
    let Some((identity, unique)) = stem.split_once('.') else {
        return false;
    };
    valid_identity(identity)
        && unique.len() == 32
        && unique
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn valid_value(value: &Value) -> bool {
    value.is_object() || value.is_null()
}

fn valid_time(fetched_at: u64, now: u64) -> bool {
    fetched_at > 0 && fetched_at <= now && now - fetched_at <= MAX_AGE
}

fn not_reparse(metadata: &std::fs::Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return false;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return false;
        }
    }
    true
}

fn safe_directory(directory: &Path) -> bool {
    std::fs::symlink_metadata(directory)
        .is_ok_and(|metadata| metadata.is_dir() && not_reparse(&metadata))
}

fn read_envelope(path: &Path) -> Option<Envelope> {
    let metadata = std::fs::symlink_metadata(path).ok()?;
    if !metadata.is_file() || !not_reparse(&metadata) || metadata.len() > MAX_ENTRY_BYTES {
        return None;
    }
    // `take` also bounds reads if a file grows after the metadata check.
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    std::fs::File::open(path)
        .ok()?
        .take(MAX_ENTRY_BYTES + 1)
        .read_to_end(&mut bytes)
        .ok()?;
    if bytes.len() as u64 > MAX_ENTRY_BYTES {
        return None;
    }
    serde_json::from_slice(&bytes).ok()
}

fn read_entry(directory: &Path, identity: &str, now: u64) -> Option<Entry> {
    if !safe_directory(directory) {
        return None;
    }
    let envelope = read_envelope(&directory.join(format!("{identity}.json")))?;
    if envelope.version != VERSION
        || envelope.identity != identity
        || !valid_time(envelope.fetched_at, now)
        || !valid_value(&envelope.value)
    {
        return None;
    }
    Some(Entry {
        value: Arc::new(envelope.value),
        fetched_at: envelope.fetched_at,
    })
}

fn persist_entry(directory: &Path, identity: &str, bytes: &[u8], now: u64) {
    if std::fs::create_dir_all(directory).is_err() || !safe_directory(directory) {
        return;
    }
    let destination = directory.join(format!("{identity}.json"));
    // Never follow or replace a directory/reparse point masquerading as a leaf.
    if std::fs::symlink_metadata(&destination)
        .is_ok_and(|metadata| !metadata.is_file() || !not_reparse(&metadata))
    {
        return;
    }
    let temporary = directory.join(format!("{identity}.{}.tmp", uuid::Uuid::new_v4().simple()));
    let written = (|| -> std::io::Result<()> {
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temporary)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        drop(file);
        std::fs::rename(&temporary, &destination)
    })();
    if written.is_err() {
        let _ = std::fs::remove_file(&temporary);
    }
    cleanup(directory, now);
}

// This is intentionally nonrecursive. Unknown files, directories and reparse
// points are never removed; only cache-owned, hash-named regular leaf files are.
fn cleanup(directory: &Path, now: u64) {
    if !safe_directory(directory) {
        return;
    }
    let Ok(files) = std::fs::read_dir(directory) else {
        return;
    };
    let mut entries = Vec::new();
    let mut total_bytes = 0_u64;
    for item in files.flatten() {
        let name = item.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if owned_temporary(name) {
            let path = item.path();
            if std::fs::symlink_metadata(&path).is_ok_and(|metadata| {
                metadata.is_file()
                    && not_reparse(&metadata)
                    && metadata
                        .modified()
                        .ok()
                        .and_then(|modified| modified.duration_since(UNIX_EPOCH).ok())
                        .is_some_and(|at| at.as_secs() <= now && now - at.as_secs() >= TEMP_MAX_AGE)
            }) {
                let _ = std::fs::remove_file(path);
            }
            continue;
        }
        let Some(identity) = name.strip_suffix(".json").filter(|id| valid_identity(id)) else {
            continue;
        };
        let path = item.path();
        let Ok(metadata) = std::fs::symlink_metadata(&path) else {
            continue;
        };
        if !metadata.is_file() || !not_reparse(&metadata) {
            continue;
        }
        let valid = read_envelope(&path).filter(|envelope| {
            envelope.version == VERSION
                && envelope.identity == identity
                && valid_time(envelope.fetched_at, now)
                && valid_value(&envelope.value)
        });
        if let Some(envelope) = valid {
            total_bytes = total_bytes.saturating_add(metadata.len());
            entries.push((envelope.fetched_at, path, metadata.len()));
        } else {
            let _ = std::fs::remove_file(path);
        }
    }
    entries.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.cmp(&right.1)));
    let mut remaining = entries.len();
    for (_, path, size) in entries {
        if remaining <= CAPACITY && total_bytes <= MAX_DISK_BYTES {
            break;
        }
        if std::fs::remove_file(path).is_ok() {
            remaining -= 1;
            total_bytes = total_bytes.saturating_sub(size);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use sha2::{Digest, Sha256};
    use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
    use tokio::sync::{Barrier, Notify};

    struct Directory(PathBuf);
    impl Directory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("mijia-ui-resource-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir(&path).unwrap();
            Self(path)
        }
    }
    impl Drop for Directory {
        fn drop(&mut self) {
            // Tests create only regular direct children; no recursive deletion.
            if let Ok(files) = std::fs::read_dir(&self.0) {
                for item in files.flatten() {
                    if item.file_type().is_ok_and(|kind| kind.is_file()) {
                        let _ = std::fs::remove_file(item.path());
                    }
                }
            }
            let _ = std::fs::remove_dir(&self.0);
        }
    }

    fn identity(scope: &str) -> String {
        format!("{:x}", Sha256::digest(scope.as_bytes()))
    }

    fn cache(directory: &Directory, now: &Arc<AtomicU64>) -> UiResourceCache {
        let now = now.clone();
        UiResourceCache::configured(
            Some(directory.0.clone()),
            Arc::new(move || now.load(Ordering::SeqCst)),
        )
    }

    fn write_fixture(directory: &Directory, id: &str, value: Value) {
        std::fs::write(
            directory.0.join(format!("{id}.json")),
            serde_json::to_vec(&value).unwrap(),
        )
        .unwrap();
    }

    async fn wait_for<F, Fut>(mut condition: F)
    where
        F: FnMut() -> Fut,
        Fut: Future<Output = bool>,
    {
        tokio::time::timeout(Duration::from_secs(3), async {
            while !condition().await {
                tokio::time::sleep(Duration::from_millis(5)).await;
            }
        })
        .await
        .expect("background refresh completed");
    }

    #[tokio::test]
    async fn memory_and_restart_hits_never_repeat_fetch_and_persist_only_hashed_identity() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(1_000_000));
        let id = identity("cn|hashed-account|test.switch.v1|urn:miot-spec-v2:device:switch");
        let calls = Arc::new(AtomicUsize::new(0));
        let store = cache(&directory, &now);
        let count = calls.clone();
        let first = store
            .get(id.clone(), move || async move {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"cards": [{"type": "switch", "siid": 2}]}))
            })
            .await
            .unwrap();
        for store in [store.clone(), cache(&directory, &now)] {
            let count = calls.clone();
            let hit = store
                .get(id.clone(), move || async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Err(AppError::protocol())
                })
                .await
                .unwrap();
            assert_eq!(hit.value, first.value);
            assert_eq!(hit.fetched_at, 1_000_000);
            assert!(!hit.stale);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        let bytes = std::fs::read_to_string(directory.0.join(format!("{id}.json"))).unwrap();
        assert!(!bytes.contains("hashed-account"));
        assert!(!bytes.contains("test.switch.v1"));
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn disk_rejects_mismatched_identity_version_future_expired_type_and_oversize() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(MAX_AGE + 1_000_000));
        let id = identity("account-a-model");
        let at = now.load(Ordering::SeqCst);
        let mut cases = vec![
            json!({"version": 1, "identity": identity("other-account"), "fetched_at": at, "value": {"wrong": true}}),
            json!({"version": 2, "identity": id, "fetched_at": at, "value": {}}),
            json!({"version": 1, "identity": id, "fetched_at": at + 1, "value": {}}),
            json!({"version": 1, "identity": id, "fetched_at": at - MAX_AGE - 1, "value": {}}),
            json!({"version": 1, "identity": id, "fetched_at": at, "value": []}),
            json!({"version": 1, "identity": id, "fetched_at": at, "value": {"large": "x".repeat(MAX_ENTRY_BYTES as usize)}}),
        ];
        let calls = Arc::new(AtomicUsize::new(0));
        for invalid in cases.drain(..) {
            write_fixture(&directory, &id, invalid);
            let count = calls.clone();
            let hit = cache(&directory, &now)
                .get(id.clone(), move || async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({"verified": true}))
                })
                .await
                .unwrap();
            assert_eq!(*hit.value, json!({"verified": true}));
            assert!(!hit.stale);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 6);
        let invalid = cache(&directory, &now)
            .get("../other-account".into(), || async { Ok(Value::Null) })
            .await
            .unwrap_err();
        assert_eq!(invalid.kind, "invalidInput");
    }

    #[tokio::test]
    async fn concurrent_cold_reads_share_one_fetch() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(1_000_000));
        let store = cache(&directory, &now);
        let calls = Arc::new(AtomicUsize::new(0));
        let barrier = Arc::new(Barrier::new(17));
        let mut tasks = Vec::new();
        for _ in 0..16 {
            let store = store.clone();
            let calls = calls.clone();
            let barrier = barrier.clone();
            tasks.push(tokio::spawn(async move {
                barrier.wait().await;
                store
                    .get(identity("same-scope"), move || async move {
                        calls.fetch_add(1, Ordering::SeqCst);
                        tokio::time::sleep(Duration::from_millis(30)).await;
                        Ok(json!({"layout": "switch"}))
                    })
                    .await
                    .unwrap()
            }));
        }
        barrier.wait().await;
        for task in tasks {
            assert_eq!(*task.await.unwrap().value, json!({"layout": "switch"}));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn stale_returns_before_fetch_and_refreshes_in_background_without_duplicate_requests() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(1_000_000));
        let store = cache(&directory, &now);
        let id = identity("stale-success");
        store
            .get(id.clone(), || async { Ok(json!({"revision": 1})) })
            .await
            .unwrap();
        now.fetch_add(FRESH_FOR, Ordering::SeqCst);
        let started = Arc::new(Notify::new());
        let release = Arc::new(Notify::new());
        let started_fetch = started.clone();
        let release_fetch = release.clone();
        let first = tokio::time::timeout(
            Duration::from_millis(200),
            store.get(id.clone(), move || async move {
                started_fetch.notify_one();
                release_fetch.notified().await;
                Ok(json!({"revision": 2}))
            }),
        )
        .await
        .expect("stale metadata returns without waiting on the network")
        .unwrap();
        assert!(first.stale);
        assert_eq!(first.fetched_at, 1_000_000);
        assert_eq!(*first.value, json!({"revision": 1}));
        tokio::time::timeout(Duration::from_secs(1), started.notified())
            .await
            .unwrap();
        let duplicate_calls = Arc::new(AtomicUsize::new(0));
        for _ in 0..8 {
            let count = duplicate_calls.clone();
            let stale = store
                .get(id.clone(), move || async move {
                    count.fetch_add(1, Ordering::SeqCst);
                    Ok(json!({"revision": "unexpected"}))
                })
                .await
                .unwrap();
            assert!(stale.stale);
            assert_eq!(*stale.value, json!({"revision": 1}));
        }
        release.notify_one();
        wait_for(|| async { store.memory_entry(&id).await.unwrap().value["revision"] == 2 }).await;
        let fresh = store
            .get(id.clone(), || async { Err(AppError::protocol()) })
            .await
            .unwrap();
        assert!(!fresh.stale);
        assert_eq!(*fresh.value, json!({"revision": 2}));
        assert_eq!(duplicate_calls.load(Ordering::SeqCst), 0);
        let gate = store.flight(&id).await;
        let _finished_persisting = gate.lock().await;
    }

    #[tokio::test]
    async fn refresh_failure_preserves_old_file_and_ten_second_backoff_then_recovers() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(1_000_000));
        let store = cache(&directory, &now);
        let id = identity("failed-refresh");
        store
            .get(id.clone(), || async { Ok(json!({"revision": 1})) })
            .await
            .unwrap();
        let path = directory.0.join(format!("{id}.json"));
        let original = std::fs::read(&path).unwrap();
        now.fetch_add(FRESH_FOR + 1, Ordering::SeqCst);
        let stale = store
            .get(id.clone(), || async {
                Err(AppError::new("network", "连接暂时不可用。", true))
            })
            .await
            .unwrap();
        assert!(stale.stale);
        wait_for(|| async { store.inner.failures.lock().await.contains_key(&id) }).await;
        let calls = Arc::new(AtomicUsize::new(0));
        let count = calls.clone();
        store
            .refresh(id.clone(), move || async move {
                count.fetch_add(1, Ordering::SeqCst);
                Ok(json!({"revision": 2}))
            })
            .await
            .err()
            .filter(|error| error.kind == "network")
            .unwrap();
        assert_eq!(calls.load(Ordering::SeqCst), 0);
        assert_eq!(std::fs::read(&path).unwrap(), original);
        assert_eq!(store.memory_entry(&id).await.unwrap().fetched_at, 1_000_000);
        store
            .inner
            .failures
            .lock()
            .await
            .get_mut(&id)
            .unwrap()
            .since -= RETRY_AFTER;
        store
            .refresh(id.clone(), || async { Ok(json!({"revision": 2})) })
            .await
            .unwrap();
        assert_eq!(store.memory_entry(&id).await.unwrap().value["revision"], 2);
        assert!(!store.inner.failures.lock().await.contains_key(&id));
        assert_ne!(std::fs::read(path).unwrap(), original);
    }

    #[tokio::test]
    async fn invalid_fetched_type_cold_failure_and_account_isolation_do_not_pollute_disk() {
        let directory = Directory::new();
        let now = Arc::new(AtomicU64::new(1_000_000));
        let store = cache(&directory, &now);
        let id_a = identity("cn|account-a|model|urn");
        let id_b = identity("cn|account-b|model|urn");
        assert!(store
            .get(id_a.clone(), || async { Ok(json!(["wrong-type"])) })
            .await
            .is_err());
        assert_eq!(std::fs::read_dir(&directory.0).unwrap().count(), 0);
        assert!(store
            .get(id_a.clone(), || async { Ok(json!({"not-fetched": true})) })
            .await
            .is_err());
        let b = store
            .get(id_b.clone(), || async { Ok(Value::Null) })
            .await
            .unwrap();
        assert!(b.value.is_null());
        assert!(!b.stale);
        let restarted = cache(&directory, &now)
            .get(id_b, || async { Err(AppError::protocol()) })
            .await
            .unwrap();
        assert!(restarted.value.is_null());
        assert!(!directory.0.join(format!("{id_a}.json")).exists());
    }

    #[test]
    fn cleanup_limits_count_and_bytes_without_touching_unrelated_files_or_directories() {
        let directory = Directory::new();
        let now = 1_000_000;
        let unrelated = directory.0.join("other-app.json");
        std::fs::write(&unrelated, b"keep").unwrap();
        let old_temporary = directory.0.join(format!(
            "{}.{}.tmp",
            identity("abandoned-write"),
            uuid::Uuid::new_v4().simple()
        ));
        let recent_temporary = directory.0.join(format!(
            "{}.{}.tmp",
            identity("recent-write"),
            uuid::Uuid::new_v4().simple()
        ));
        for (path, age) in [(&old_temporary, TEMP_MAX_AGE), (&recent_temporary, 0)] {
            let mut file = std::fs::File::create(path).unwrap();
            file.write_all(b"partial").unwrap();
            file.set_modified(UNIX_EPOCH + Duration::from_secs(now - age))
                .unwrap();
        }
        let nested = directory.0.join(format!("{}.json", identity("directory")));
        std::fs::create_dir(&nested).unwrap();
        for index in 0..CAPACITY + 3 {
            let id = identity(&format!("small-{index}"));
            write_fixture(
                &directory,
                &id,
                json!({"version": 1, "identity": id, "fetched_at": now - 100, "value": {}}),
            );
        }
        cleanup(&directory.0, now);
        let owned = || {
            std::fs::read_dir(&directory.0)
                .unwrap()
                .flatten()
                .filter(|item| {
                    item.file_type().unwrap().is_file()
                        && item.file_name().to_str().unwrap().len() == 69
                })
                .map(|item| item.metadata().unwrap().len())
                .collect::<Vec<_>>()
        };
        assert_eq!(owned().len(), CAPACITY);
        for index in 0..10 {
            let id = identity(&format!("large-{index}"));
            write_fixture(
                &directory,
                &id,
                json!({"version": 1, "identity": id, "fetched_at": now, "value": {"data": "x".repeat(MAX_ENTRY_BYTES as usize - 512)}}),
            );
        }
        cleanup(&directory.0, now);
        let owned = owned();
        assert!(owned.len() <= CAPACITY);
        assert!(owned.iter().sum::<u64>() <= MAX_DISK_BYTES);
        assert_eq!(std::fs::read(unrelated).unwrap(), b"keep");
        assert!(!old_temporary.exists());
        assert!(recent_temporary.exists());
        assert!(nested.is_dir());
        std::fs::remove_dir(nested).unwrap();
    }
}
