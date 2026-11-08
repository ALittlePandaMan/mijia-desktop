//! Independent live-view sessions with scoped local capture and quality controls.
pub mod actions;
use crate::camera::startup::{Hints, Startup, Timings};
use crate::{
    camera::{self, Event, Sessions},
    cloud::Cloud,
    error::{AppError, Result},
    models::{Device, Home},
    spec::SpecRepository,
};
use serde::Serialize;
use std::{
    collections::BTreeMap,
    sync::{
        atomic::{AtomicBool, AtomicUsize, Ordering},
        Arc, Mutex,
    },
};
use std::{net::Ipv4Addr, time::Instant};
use tokio::sync::{Notify, OnceCell, OwnedSemaphorePermit, Semaphore};

pub fn eligible(d: &Device) -> bool {
    let category = d.spec_type.as_deref().and_then(|s| s.split(':').nth(3));
    !matches!(category, Some("video-doorbell" | "doorbell"))
        && camera::profiles::doorbell(&d.model).is_none()
        && !d.model.contains(".cateye.")
        && (category == Some("camera") || d.model.contains(".camera."))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub did: String,
    pub revision: u64,
    pub state: String,
    pub events: Vec<Event>,
    pub error: Option<AppError>,
    pub timings: Option<Timings>,
    pub qualities: Vec<camera::media_control::Quality>,
    pub features: camera::media_control::Features,
    pub diagnostics: Option<camera::queue::Diagnostics>,
}
struct Entry {
    device: Device,
    revision: u64,
    state: String,
    error: Option<AppError>,
    session: Option<String>,
    stream: Arc<Sessions>,
    permit: Option<OwnedSemaphorePermit>,
    timings: Arc<Mutex<Timings>>,
    task: Option<tokio::task::AbortHandle>,
    detail: Option<actions::Lease>,
}
struct Group {
    id: String,
    home: Home,
    generation: u64,
    alive: AtomicBool,
    entries: Mutex<BTreeMap<String, Entry>>,
    cloud: Arc<Cloud>,
    specs: Arc<SpecRepository>,
    slots: Arc<Semaphore>,
    cloud_slots: Arc<Semaphore>,
    retry_slots: Arc<Semaphore>,
    initial: Arc<InitialGate>,
    hosts: OnceCell<BTreeMap<String, Ipv4Addr>>,
    hints: Hints,
}
#[derive(Default)]
pub struct Registry {
    active: Mutex<Option<Arc<Group>>>,
    hints: Mutex<(String, Hints)>,
    closing: Mutex<Vec<Arc<AtomicBool>>>,
}
#[derive(Default)]
struct InitialGate {
    remaining: AtomicUsize,
    changed: Notify,
    closed: AtomicBool,
}
struct InitialTurn(Option<Arc<InitialGate>>);
impl Drop for InitialTurn {
    fn drop(&mut self) {
        if let Some(g) = self.0.take() {
            g.remaining.fetch_sub(1, Ordering::AcqRel);
            g.changed.notify_waiters();
        }
    }
}
impl InitialGate {
    async fn wait(&self) {
        loop {
            let changed = self.changed.notified();
            if self.closed.load(Ordering::Acquire) || self.remaining.load(Ordering::Acquire) == 0 {
                return;
            }
            changed.await;
        }
    }
}

impl Group {
    fn current(&self, did: &str, revision: u64) -> bool {
        self.alive.load(Ordering::Acquire)
            && self
                .entries
                .lock()
                .ok()
                .and_then(|e| e.get(did).map(|e| e.revision == revision))
                .unwrap_or(false)
    }
    fn launch(self: &Arc<Self>, did: &str, initial: bool) -> Result<()> {
        if !self.alive.load(Ordering::Acquire) {
            return Err(AppError::stale());
        }
        let origin = Instant::now();
        let (device, revision, stream, ticket, closing, timings) = {
            let mut entries = self.entries.lock().map_err(|_| AppError::stale())?;
            let e = entries.get_mut(did).ok_or_else(AppError::stale)?;
            e.detail = None;
            e.revision += 1;
            if let Some(task) = e.task.take() {
                task.abort();
            }
            e.session = None;
            e.error = None;
            e.permit = None;
            e.timings = Arc::new(Mutex::new(Timings::default()));
            e.stream.stop_all_request();
            let closing = e.stream.pending_stops();
            e.state = if e.device.online {
                "connecting"
            } else {
                "offline"
            }
            .into();
            if !e.device.online {
                return Ok(());
            }
            (
                e.device.clone(),
                e.revision,
                e.stream.clone(),
                e.stream.begin(),
                closing,
                e.timings.clone(),
            )
        };
        let group = self.clone();
        let initial_turn = InitialTurn(initial.then(|| self.initial.clone()));
        let task = tokio::spawn(async move {
            let mark = |update: fn(&mut Timings, u64)| {
                if let Ok(mut t) = timings.lock() {
                    update(&mut t, origin.elapsed().as_millis() as u64);
                }
            };
            let result = async {
                let retry = if !initial {
                    group.initial.wait().await;
                    Some(
                        group
                            .retry_slots
                            .clone()
                            .acquire_owned()
                            .await
                            .map_err(|_| AppError::stale())?,
                    )
                } else {
                    None
                };
                if !group.current(&device.did, revision) {
                    return Err(AppError::stale());
                }
                if !closing.is_empty() {
                    for _ in 0..100 {
                        if closing.iter().all(|done| done.load(Ordering::Acquire)) {
                            break;
                        }
                        if !group.current(&device.did, revision) {
                            return Err(AppError::stale());
                        }
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    }
                    if closing.iter().any(|done| !done.load(Ordering::Acquire)) {
                        return Err(AppError::new(
                            "videoStopping",
                            "视频连接尚未完成关闭。",
                            true,
                        ));
                    }
                }
                let cloud_permit = group
                    .cloud_slots
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| AppError::stale())?;
                mark(|t, ms| t.cloud_start_ms = Some(ms));
                if !group.current(&device.did, revision) {
                    return Err(AppError::stale());
                }
                let panel = group.specs.panel(&device).await?;
                if let Some(reason) = panel.unsupported_reason.as_ref() {
                    return Err(AppError::new("unsupported", reason, false));
                }
                if camera::power::binding(&panel).is_some() {
                    let power = camera::power::read(
                        &group.cloud,
                        &panel,
                        device.shared_read_only,
                        device.online,
                    )
                    .await?;
                    if power.awake == Some(false) {
                        return Err(AppError::new("cameraOff", "摄像机休眠中", false));
                    }
                }
                let hosts = group
                    .hosts
                    .get_or_try_init(|| camera::inventory_hosts(&group.cloud, &group.home))
                    .await?;
                if !group.current(&device.did, revision) {
                    return Err(AppError::stale());
                }
                let mut config = camera::negotiate_with_host(
                    &group.cloud,
                    &device,
                    hosts.get(&device.did).copied(),
                )
                .await?;
                config.monitor()?;
                mark(|t, ms| t.cloud_ready_ms = Some(ms));
                drop(cloud_permit);
                let permit = group
                    .slots
                    .clone()
                    .acquire_owned()
                    .await
                    .map_err(|_| AppError::stale())?;
                drop(initial_turn);
                mark(|t, ms| t.connect_start_ms = Some(ms));
                if !group.current(&device.did, revision) {
                    return Err(AppError::stale());
                }
                let mut permits = vec![permit];
                if let Some(retry) = retry {
                    permits.push(retry);
                }
                config.monitor_startup(Startup {
                    origin,
                    timings: timings.clone(),
                    permits,
                    hints: group.hints.clone(),
                    did: device.did.clone(),
                });
                stream.start_reserved(
                    group.home.id.clone(),
                    group.generation,
                    device.did.clone(),
                    config,
                    ticket,
                )
            }
            .await;
            if !group.current(&device.did, revision) {
                if let Ok(id) = result {
                    let _ = stream.stop(&group.home.id, group.generation, &device.did, &id);
                }
                return;
            }
            if let Ok(mut entries) = group.entries.lock() {
                if let Some(e) = entries
                    .get_mut(&device.did)
                    .filter(|e| e.revision == revision)
                {
                    match result {
                        Ok(id) => {
                            e.session = Some(id);
                            e.state = "connecting".into();
                        }
                        Err(mut error) => {
                            if matches!(
                                error.kind.as_str(),
                                "videoUnsupported"
                                    | "videoProtocolUnsupported"
                                    | "videoAuthRejected"
                                    | "permissionDenied"
                                    | "readOnly"
                            ) {
                                error.retryable = false;
                            }
                            e.state = if error.kind == "cameraOff" {
                                "closed"
                            } else {
                                "error"
                            }
                            .into();
                            e.error = Some(error);
                        }
                    }
                }
            }
        });
        let abort = task.abort_handle();
        if let Ok(mut entries) = self.entries.lock() {
            if let Some(e) = entries.get_mut(did).filter(|e| e.revision == revision) {
                e.task = Some(abort);
                return Ok(());
            }
        }
        task.abort();
        Ok(())
    }
    fn close(&self) -> Vec<Arc<AtomicBool>> {
        self.alive.store(false, Ordering::Release);
        self.slots.close();
        self.cloud_slots.close();
        self.retry_slots.close();
        self.initial.closed.store(true, Ordering::Release);
        self.initial.changed.notify_waiters();
        self.entries
            .lock()
            .map(|mut entries| {
                entries
                    .values_mut()
                    .flat_map(|e| {
                        e.detail = None;
                        e.revision += 1;
                        e.permit = None;
                        if let Some(task) = e.task.take() {
                            task.abort();
                        }
                        e.stream.stop_all_request();
                        e.stream.pending_stops()
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}
impl Registry {
    pub fn create(
        &self,
        cloud: Arc<Cloud>,
        home: Home,
        generation: u64,
        devices: Vec<Device>,
    ) -> Result<String> {
        if devices.is_empty() || devices.iter().any(|d| !eligible(d)) {
            return Err(AppError::invalid("请至少选择一台普通摄像头。"));
        }
        let mut entries = BTreeMap::new();
        for device in devices {
            if entries.contains_key(&device.did) {
                return Err(AppError::invalid("摄像头重复。"));
            }
            entries.insert(
                device.did.clone(),
                Entry {
                    device,
                    revision: 0,
                    state: "connecting".into(),
                    error: None,
                    session: None,
                    stream: Arc::new(Sessions::default()),
                    permit: None,
                    timings: Arc::new(Mutex::new(Timings::default())),
                    task: None,
                    detail: None,
                },
            );
        }
        let scope = format!(
            "{}:{}:{}",
            home.id,
            generation,
            Arc::as_ptr(&cloud) as usize
        );
        let hints = {
            let mut h = self.hints.lock().map_err(|_| AppError::stale())?;
            if h.0 != scope {
                h.0 = scope;
                h.1 = Arc::new(Mutex::new(BTreeMap::new()));
            }
            h.1.clone()
        };
        let online = entries.values().filter(|e| e.device.online).count();
        let group = Arc::new(Group {
            id: uuid::Uuid::new_v4().to_string(),
            home,
            generation,
            cloud,
            specs: Arc::new(SpecRepository::new()?),
            alive: AtomicBool::new(true),
            entries: Mutex::new(entries),
            slots: Arc::new(Semaphore::new(4)),
            cloud_slots: Arc::new(Semaphore::new(2)),
            retry_slots: Arc::new(Semaphore::new(1)),
            initial: Arc::new(InitialGate {
                remaining: AtomicUsize::new(online),
                changed: Notify::new(),
                closed: AtomicBool::new(false),
            }),
            hosts: OnceCell::new(),
            hints,
        });
        let mut active = self.active.lock().map_err(|_| AppError::stale())?;
        if let Some(old) = active.take() {
            self.retain_closing(old.close());
        }
        *active = Some(group.clone());
        drop(active);
        let dids: Vec<_> = group
            .entries
            .lock()
            .map_err(|_| AppError::stale())?
            .keys()
            .cloned()
            .collect();
        for did in dids {
            group.launch(&did, true)?;
        }
        Ok(group.id.clone())
    }
    fn group(&self, home: &str, generation: u64, id: &str) -> Result<Arc<Group>> {
        self.active
            .lock()
            .map_err(|_| AppError::stale())?
            .as_ref()
            .filter(|g| {
                g.id == id
                    && g.home.id == home
                    && g.generation == generation
                    && g.alive.load(Ordering::Acquire)
            })
            .cloned()
            .ok_or_else(AppError::stale)
    }
    pub fn read(
        &self,
        home: &str,
        generation: u64,
        id: &str,
        devices: &[Device],
    ) -> Result<Vec<Row>> {
        let group = self.group(home, generation, id)?;
        let mut reopen = vec![];
        let mut rows = vec![];
        {
            let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
            for (did, e) in entries.iter_mut() {
                let device = devices.iter().find(|d| {
                    &d.did == did
                        && d.model == e.device.model
                        && d.control_did() == e.device.control_did()
                });
                let online = device.is_some_and(|d| d.online);
                if online != e.device.online {
                    e.device.online = online;
                    if online {
                        reopen.push(did.clone());
                    } else {
                        e.detail = None;
                        e.revision += 1;
                        if let Some(task) = e.task.take() {
                            task.abort();
                        }
                        e.stream.stop_all();
                        e.session = None;
                        e.state = "offline".into();
                        e.error = None;
                    }
                }
                if let Some(device) = device {
                    e.device = device.clone();
                }
                let mut events = vec![];
                if let Some(session) = &e.session {
                    match e.stream.read(home, generation, did, session) {
                        Ok(read) => events = read,
                        Err(error) => {
                            e.state = "error".into();
                            e.error = Some(error);
                        }
                    }
                }
                for event in &events {
                    if let Some(error) = &event.error {
                        if matches!(event.state, "operation-error" | "lens-unavailable") {
                            continue;
                        }
                        e.state = "error".into();
                        e.error = Some(error.clone());
                    } else if event.state == "stopped" {
                        e.state = "error".into();
                        e.error.get_or_insert_with(|| {
                            AppError::new("videoDisconnected", "连接已断开", true)
                        });
                    } else if event.state == "authenticated" {
                        e.state = "waiting-frame".into();
                        e.permit = None;
                    } else if event.state == "media" {
                        e.state = "live".into();
                    }
                }
                if matches!(e.state.as_str(), "live" | "error" | "offline" | "closed") {
                    e.permit = None;
                }
                if e.error.as_ref().is_some_and(|e| e.kind == "authExpired") {
                    return Err(AppError::auth());
                }
                if e.detail.is_none() {
                    events.retain(|event| event.state != "audio");
                }
                rows.push(Row {
                    did: did.clone(),
                    revision: e.revision,
                    state: e.state.clone(),
                    error: e.error.clone(),
                    events,
                    timings: e.timings.lock().ok().map(|t| t.clone()),
                    diagnostics: e
                        .session
                        .as_ref()
                        .and_then(|id| e.stream.diagnostics(home, generation, did, id)),
                    qualities: camera::media_control::features(&e.device.model).qualities,
                    features: {
                        let mut f = camera::media_control::features(&e.device.model);
                        if e.device.shared_read_only {
                            f.talk = false;
                            f.ptz = false;
                            f.reason = Some("此共享设备仅有读取权限。");
                        }
                        f
                    },
                });
            }
        }
        for did in reopen {
            group.launch(&did, false)?;
        }
        Ok(rows)
    }
    pub fn power_changed(&self, home: &str, generation: u64, did: &str, awake: bool) -> Result<()> {
        let group = self
            .active
            .lock()
            .map_err(|_| AppError::stale())?
            .as_ref()
            .filter(|g| {
                g.home.id == home && g.generation == generation && g.alive.load(Ordering::Acquire)
            })
            .cloned();
        let Some(group) = group else {
            return Ok(());
        };
        {
            let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
            let Some(e) = entries.get_mut(did) else {
                return Ok(());
            };
            if awake && matches!(e.state.as_str(), "live" | "connecting" | "waiting-frame") {
                return Ok(());
            }
            if !awake {
                e.detail = None;
                e.revision += 1;
                if let Some(task) = e.task.take() {
                    task.abort();
                }
                e.stream.stop_all_request();
                e.session = None;
                e.permit = None;
                e.state = "closed".into();
                e.error = Some(AppError::new("cameraOff", "摄像机休眠中", false));
                return Ok(());
            }
        }
        group.launch(did, false)
    }
    pub fn retry(
        &self,
        home: &str,
        generation: u64,
        id: &str,
        did: &str,
        device: &Device,
    ) -> Result<()> {
        let group = self.group(home, generation, id)?;
        {
            let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
            let e = entries.get_mut(did).ok_or_else(AppError::stale)?;
            if e.device.model != device.model || e.device.control_did() != device.control_did() {
                return Err(AppError::stale());
            }
            e.device = device.clone();
        }
        group.launch(did, false)
    }
    pub fn stop(&self, home: &str, generation: u64, id: &str) -> Vec<Arc<AtomicBool>> {
        let Ok(mut active) = self.active.lock() else {
            return vec![];
        };
        if active
            .as_ref()
            .is_some_and(|g| g.id == id && g.home.id == home && g.generation == generation)
        {
            self.retain_closing(active.take().unwrap().close())
        } else {
            vec![]
        }
    }
    pub fn clear_hints(&self) {
        if let Ok(mut hints) = self.hints.lock() {
            hints.0.clear();
            hints.1 = Arc::new(Mutex::new(BTreeMap::new()));
        }
    }
    fn retain_closing(&self, workers: Vec<Arc<AtomicBool>>) -> Vec<Arc<AtomicBool>> {
        self.closing
            .lock()
            .map(|mut pending| {
                pending.retain(|d| !d.load(Ordering::Acquire));
                for done in workers {
                    if !done.load(Ordering::Acquire)
                        && !pending.iter().any(|d| Arc::ptr_eq(d, &done))
                    {
                        pending.push(done);
                    }
                }
                pending.clone()
            })
            .unwrap_or_default()
    }
    pub fn stop_all(&self) -> Vec<Arc<AtomicBool>> {
        let workers = self
            .active
            .lock()
            .ok()
            .and_then(|mut g| g.take())
            .map(|g| g.close())
            .unwrap_or_default();
        self.retain_closing(workers)
    }
}
impl Drop for Registry {
    fn drop(&mut self) {
        self.stop_all();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use camera::queue::Sender;
    use serde_json::json;
    fn device(did: &str) -> Device {
        serde_json::from_value(json!({"did":did,"name":"same","model":"fixture.camera.v1","online":true,"roomId":"r","roomName":"r"})).unwrap()
    }
    type Fixture = (Registry, Arc<Group>, Vec<Sender>, Vec<Arc<AtomicBool>>);
    pub(super) fn group() -> Fixture {
        let credentials=serde_json::from_value(json!({"user_id":"1","security":"YQ==","service_token":"inert","region":"cn","device_id":"inert","service_id":"xiaomiio","c_user_id":"inert"})).unwrap();
        let mut entries = BTreeMap::new();
        let mut senders = vec![];
        let mut stops = vec![];
        let slots = Arc::new(Semaphore::new(2));
        for did in ["a", "b"] {
            let (stream, tx, stop) = Sessions::fixture("h", 1, did, did);
            senders.push(tx);
            stops.push(stop);
            entries.insert(
                did.into(),
                Entry {
                    device: device(did),
                    revision: 1,
                    state: "waiting-frame".into(),
                    error: None,
                    session: Some(did.into()),
                    stream: Arc::new(stream),
                    permit: Some(slots.clone().try_acquire_owned().unwrap()),
                    timings: Arc::new(Mutex::new(Timings::default())),
                    task: None,
                    detail: None,
                },
            );
        }
        let g = Arc::new(Group {
            id: "opaque".into(),
            home: serde_json::from_value(
                json!({"id":"h","name":"h","ownerId":"1","shared":false,"rooms":[]}),
            )
            .unwrap(),
            generation: 1,
            alive: AtomicBool::new(true),
            entries: Mutex::new(entries),
            cloud: Arc::new(Cloud::new(credentials).unwrap()),
            specs: Arc::new(SpecRepository::new().unwrap()),
            slots,
            cloud_slots: Arc::new(Semaphore::new(2)),
            retry_slots: Arc::new(Semaphore::new(1)),
            initial: Arc::new(InitialGate::default()),
            hosts: OnceCell::new(),
            hints: Arc::new(Mutex::new(BTreeMap::new())),
        });
        let r = Registry::default();
        *r.active.lock().unwrap() = Some(g.clone());
        (r, g, senders, stops)
    }
    fn media() -> Event {
        Event {
            receive_bytes_per_second: None,
            lens_id: None,
            media_generation: 0,
            keyframe: None,
            stream_revision: 0,
            state: "media",
            data: Some("AA==".into()),
            codec: Some("h264"),
            error: None,
            sample_rate: None,
            timestamp: None,
            file: None,
        }
    }
    #[test]
    fn controls_bind_to_exact_group_home_device_and_route_revision() {
        let (r, g, _, _) = group();
        let t = actions::Target {
            home_id: "h".into(),
            generation: 1,
            viewer_id: "opaque".into(),
            did: "a".into(),
            revision: 1,
        };
        let (stream, id) = r.route(&t).unwrap();
        assert_eq!(id, "a");
        assert!(Arc::ptr_eq(&stream, &g.entries.lock().unwrap()["a"].stream));
        for wrong in [
            actions::Target {
                home_id: "other".into(),
                ..t.clone()
            },
            actions::Target {
                generation: 2,
                ..t.clone()
            },
            actions::Target {
                viewer_id: "old".into(),
                ..t.clone()
            },
            actions::Target {
                did: "missing".into(),
                ..t.clone()
            },
            actions::Target {
                revision: 0,
                ..t.clone()
            },
        ] {
            assert!(r.route(&wrong).is_err());
        }
        g.entries.lock().unwrap().get_mut("a").unwrap().revision = 2;
        assert!(r.route(&t).is_err());
        r.stop_all();
        assert!(r.route(&actions::Target { revision: 2, ..t }).is_err());
    }
    #[test]
    fn local_recording_errors_and_saved_files_do_not_disconnect_a_route() {
        let (r, _, tx, stops) = group();
        let mut failed = media();
        failed.state = "operation-error";
        failed.data = None;
        failed.error = Some(AppError::new(
            "recordingLimit",
            "录像已达到时长限制。",
            false,
        ));
        tx[0].try_send(failed).unwrap();
        let mut saved = media();
        saved.state = "saved";
        saved.data = None;
        saved.file = Some(camera::saved_media::SavedMedia {
            id: "opaque-export".into(),
            file_name: "clip.mp4".into(),
            kind: "recording",
        });
        tx[0].try_send(saved).unwrap();
        tx[1].try_send(media()).unwrap();
        let rows = r
            .read("h", 1, "opaque", &[device("a"), device("b")])
            .unwrap();
        assert_ne!(rows[0].state, "error");
        assert!(rows[0].error.is_none());
        assert_eq!(rows[0].events.len(), 2);
        assert!(rows[0].events[1].file.is_some());
        assert_eq!(rows[1].state, "live");
        assert!(stops.iter().all(|s| !s.load(Ordering::Acquire)));
    }
    #[test]
    fn repeated_stop_retains_workers_that_are_still_closing() {
        let (r, g, _, _) = group();
        let done = g.entries.lock().unwrap()["a"].stream.hold_fixture_worker();
        assert!(r
            .stop("h", 1, "opaque")
            .iter()
            .any(|d| Arc::ptr_eq(d, &done)));
        assert!(r.stop_all().iter().any(|d| Arc::ptr_eq(d, &done)));
        done.store(true, Ordering::Release);
        assert!(r.stop_all().is_empty());
    }
    #[test]
    fn closing_during_retry_preparation_keeps_the_previous_worker_barrier() {
        let (r, g, _, _) = group();
        let stream = g.entries.lock().unwrap()["a"].stream.clone();
        let done = stream.hold_fixture_worker();
        stream.stop_all_request();
        assert!(stream.stop_all_request().is_none());
        assert!(r.stop_all().iter().any(|d| Arc::ptr_eq(d, &done)));
        done.store(true, Ordering::Release);
        assert!(r.stop_all().is_empty());
    }
    #[test]
    fn distinct_receivers_do_not_consume_or_stop_each_other() {
        let (r, g, tx, stops) = group();
        for t in &tx {
            t.try_send(media()).unwrap();
        }
        assert_eq!(g.slots.available_permits(), 0);
        let rows = r
            .read("h", 1, "opaque", &[device("a"), device("b")])
            .unwrap();
        assert_eq!(rows.len(), 2);
        assert!(rows
            .iter()
            .all(|r| r.events.len() == 1 && r.state == "live"));
        assert_eq!(g.slots.available_permits(), 2);
        assert!(stops.iter().all(|s| !s.load(Ordering::Acquire)));
    }
    #[test]
    fn authenticated_route_releases_capacity_without_waiting_for_video() {
        let (r, g, tx, _) = group();
        let mut e = media();
        e.state = "authenticated";
        e.data = None;
        tx[0].try_send(e).unwrap();
        let rows = r
            .read("h", 1, "opaque", &[device("a"), device("b")])
            .unwrap();
        assert_eq!(rows[0].state, "waiting-frame");
        assert_eq!(g.slots.available_permits(), 1);
        assert!(rows[0].events.iter().all(|e| e.state != "media"));
    }
    #[tokio::test]
    async fn retries_wait_for_every_initial_turn_and_failed_preparations_release_turns() {
        let gate = Arc::new(InitialGate {
            remaining: AtomicUsize::new(2),
            ..Default::default()
        });
        let first = InitialTurn(Some(gate.clone()));
        let second = InitialTurn(Some(gate.clone()));
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), gate.wait())
                .await
                .is_err()
        );
        drop(first);
        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(10), gate.wait())
                .await
                .is_err()
        );
        drop(second);
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), gate.wait())
                .await
                .is_ok()
        );
    }
    #[tokio::test]
    async fn closing_group_wakes_retry_waiters_even_during_cloud_preparation() {
        let (r, g, _, _) = group();
        g.initial.remaining.store(1, Ordering::Release);
        r.stop_all();
        assert!(
            tokio::time::timeout(std::time::Duration::from_secs(1), g.initial.wait())
                .await
                .is_ok()
        );
        assert!(g.cloud_slots.is_closed() && g.retry_slots.is_closed());
    }
    #[tokio::test]
    async fn closing_aborts_cloud_preparation_instead_of_leaving_requests_running() {
        let (r, g, _, _) = group();
        let task = tokio::spawn(std::future::pending::<()>());
        g.entries.lock().unwrap().get_mut("a").unwrap().task = Some(task.abort_handle());
        r.stop_all();
        assert!(task.await.unwrap_err().is_cancelled());
    }
    #[test]
    fn wrong_group_context_and_late_stop_cannot_close_current_owner() {
        let (r, _, _, stops) = group();
        assert!(r.read("other", 1, "opaque", &[]).is_err());
        assert!(r.read("h", 2, "opaque", &[]).is_err());
        assert!(r.stop("h", 1, "old").is_empty());
        assert!(stops.iter().all(|s| !s.load(Ordering::Acquire)));
        r.stop("h", 1, "opaque");
        assert!(stops.iter().all(|s| s.load(Ordering::Acquire)));
    }
    #[test]
    fn one_offline_or_failed_camera_leaves_healthy_stream_running() {
        let (r, _, tx, stops) = group();
        tx[1].try_send(media()).unwrap();
        let mut offline = device("a");
        offline.online = false;
        let rows = r.read("h", 1, "opaque", &[offline, device("b")]).unwrap();
        assert_eq!(rows[0].state, "offline");
        assert_eq!(rows[1].state, "live");
        assert!(stops[0].load(Ordering::Acquire));
        assert!(!stops[1].load(Ordering::Acquire));
    }
    #[test]
    fn closing_invalidates_pending_versions_releases_capacity_and_stops_all_routes() {
        let (r, g, _, stops) = group();
        assert!(g.current("a", 1));
        r.stop_all();
        assert!(!g.current("a", 1));
        assert!(g.slots.is_closed());
        assert!(stops.iter().all(|s| s.load(Ordering::Acquire)));
        assert!(r.read("h", 1, "opaque", &[]).is_err());
    }
    #[test]
    fn registry_never_exposes_audio_or_media_save_events() {
        let (r, _, tx, _) = group();
        let mut e = media();
        e.state = "audio";
        tx[0].try_send(e).unwrap();
        assert!(r
            .read("h", 1, "opaque", &[device("a"), device("b")])
            .unwrap()[0]
            .events
            .is_empty());
    }
    #[test]
    fn a_closed_receiver_cannot_turn_a_permission_failure_into_a_retryable_disconnect() {
        let (r, _, tx, _) = group();
        let mut failure = media();
        failure.state = "error";
        failure.error = Some(AppError::new("videoAuthRejected", "rejected", false));
        tx[0].try_send(failure).unwrap();
        drop(tx);
        for _ in 0..3 {
            let rows = r
                .read("h", 1, "opaque", &[device("a"), device("b")])
                .unwrap();
            let error = rows[0].error.as_ref().unwrap();
            assert_eq!(error.kind, "videoAuthRejected");
            assert!(!error.retryable);
        }
    }
    #[test]
    fn basic_eligibility_excludes_doorbells_even_if_their_model_contains_camera() {
        let mut d = device("a");
        assert!(eligible(&d));
        d.spec_type = Some("urn:miot-spec-v2:device:doorbell:0000:fixture:1".into());
        assert!(!eligible(&d));
        d.spec_type = None;
        d.model = "madv.cateye.mi3iot".into();
        assert!(!eligible(&d));
    }
}
