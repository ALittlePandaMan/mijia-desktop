//! Scoped MISS media, recording and verified camera operations. No arbitrary endpoints.
//! CS2/MISS framing derived from Xiaomi Camera Viewer/go2rtc (MIT); see notices.
pub mod auxiliary;
pub mod cloud_media;
mod cloud_mp4;
mod connect;
pub mod doorbell_cloud;
pub mod events;
pub mod media_control;
mod mp4;
pub mod power;
pub mod profiles;
pub mod queue;
mod rdt;
mod record_cache;
mod relay;
mod relay_list;
mod relay_table;
pub mod save_dialog;
pub mod saved_media;
pub mod startup;
mod transport;
mod ts;
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{Device, Home},
};
use base64::{engine::general_purpose::STANDARD, Engine};
use chacha20::cipher::{KeyIvInit, StreamCipher};
use ring::{agreement, rand::SystemRandom};
use serde::Serialize;
use serde_json::json;
use std::{
    net::Ipv4Addr,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc::sync_channel,
        Arc, Mutex,
    },
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

pub fn category_supported(device: &Device) -> bool {
    matches!(
        device
            .spec_type
            .as_deref()
            .and_then(|s| s.split(':').nth(3)),
        Some("camera" | "video-doorbell" | "doorbell")
    ) || device.model.contains(".camera.")
        || device.model.contains(".cateye.")
}
fn err(kind: &str, message: &str) -> AppError {
    AppError::new(kind, message, true)
}
pub struct Config {
    audio: bool,
    model: String,
    quality: u8,
    host: Option<Ipv4Addr>,
    uid: Option<Zeroizing<String>>,
    servers: Vec<Ipv4Addr>,
    key: Zeroizing<[u8; 32]>,
    public: String,
    sign: Zeroizing<String>,
    startup: Option<startup::Startup>,
}
fn battery_wake_method(model: &str) -> Option<&'static str> {
    if model == "madv.cateye.mi3iot" {
        // Original plugin 1008668-v11: Config dispatch 10715 -> 11255,
        // statusHelper.wakeup.wifiMethod.name. This model wakes its host,
        // while its Wi-Fi controller already reports the inventory online.
        Some("wakeup_host")
    } else if model.contains(".cateye.") {
        Some("wakeup")
    } else {
        None
    }
}
fn battery_wake_request(model: &str) -> Option<serde_json::Value> {
    let method = battery_wake_method(model)?;
    if model == "madv.cateye.mi3iot" {
        // The plugin's arg is {params:{video:"1"}}. The original Android
        // RnPluginHostApiProviderImpl.o00Ooo0o writes that whole arg into the
        // RPC params field, and includes the exact model. See the retained
        // doorbell-live-provider-call REA evidence and doorbell-live-fix.md.
        Some(json!({"id":1,"method":method,"model":model,"params":{"params":{"video":"1"}}}))
    } else {
        Some(json!({"id":1,"method":method,"params":{"video":"1"}}))
    }
}
impl Config {
    pub(crate) fn monitor(&mut self) -> Result<()> {
        self.audio = false;
        self.select_quality("sd")
    }
    pub(crate) fn monitor_startup(&mut self, startup: startup::Startup) {
        self.startup = Some(startup);
    }
    pub fn select_quality(&mut self, quality: &str) -> Result<()> {
        self.quality = media_control::quality_value(&self.model, quality)?;
        Ok(())
    }
    pub fn transport_summary(&self) -> serde_json::Value {
        json!({"localAddress":self.host.is_some(),"uidPresent":self.uid.is_some(),"uidParts":self.uid.as_ref().map(|s|s.split('-').map(|p|p.len()).collect::<Vec<_>>())})
    }
}
pub async fn negotiate(cloud: &Cloud, home: &Home, device: &Device) -> Result<Config> {
    if !category_supported(device) {
        return Err(err("videoUnsupported", "此设备没有已接入的实时视频协议。"));
    }
    if !device.online {
        return Err(err("offline", "摄像机离线。"));
    }
    // Documented MISS battery-doorbell wake for an explicit live-view request;
    // never ring the bell, change power/privacy, or issue this during page reads.
    if let Some(request) = battery_wake_request(&device.model) {
        if let Err(error) = cloud
            .request(&format!("/home/rpc/{}", device.did), request)
            .await
        {
            if error.kind == "authExpired" {
                return Err(error);
            }
        }
    }
    let hosts = inventory_hosts(cloud, home).await?;
    negotiate_with_host(cloud, device, hosts.get(&device.did).copied()).await
}
pub(crate) async fn inventory_hosts(
    cloud: &Cloud,
    home: &Home,
) -> Result<std::collections::BTreeMap<String, Ipv4Addr>> {
    // Resolve the endpoint exclusively from this authenticated home inventory.
    let mut cursor = String::new();
    let mut hosts = std::collections::BTreeMap::new();
    for _ in 0..100 {
        let mut query = json!({"home_owner":home.owner_id.parse::<u64>().map_err(|_|AppError::protocol())?,"home_id":home.id.parse::<u64>().map_err(|_|AppError::protocol())?,"limit":200,"get_split_device":true,"support_smart_home":true});
        if !cursor.is_empty() {
            query["start_did"] = json!(cursor);
        }
        let page = cloud.request("/v2/home/home_device_list", query).await?;
        if let Some(rows) = page["device_info"].as_array() {
            for row in rows {
                if let Some(ip) = row["localip"]
                    .as_str()
                    .and_then(|s| s.parse::<Ipv4Addr>().ok())
                    .filter(|ip| ip.is_private() && !ip.is_broadcast())
                {
                    hosts.insert(crate::models::id(&row["did"]), ip);
                }
            }
        }
        if page["has_more"] != true {
            break;
        }
        let next = crate::models::id(&page["max_did"]);
        if next.is_empty() || next == cursor {
            return Err(AppError::protocol());
        }
        cursor = next;
    }
    Ok(hosts)
}
pub(crate) async fn negotiate_with_host(
    cloud: &Cloud,
    device: &Device,
    host: Option<Ipv4Addr>,
) -> Result<Config> {
    if !category_supported(device) || !device.online {
        return Err(err("videoUnsupported", "摄像机当前不可用。"));
    }
    let private =
        agreement::EphemeralPrivateKey::generate(&agreement::X25519, &SystemRandom::new())
            .map_err(|_| AppError::protocol())?;
    let public = private
        .compute_public_key()
        .map_err(|_| AppError::protocol())?;
    let public = public
        .as_ref()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    let response = cloud
        .request(
            "/v2/device/miss_get_vendor",
            json!({"app_pubkey":public,"did":device.did,"support_vendors":"TUTK_CS2_MTP"}),
        )
        .await?;
    if response["vendor"]["vendor"] != 4 {
        return Err(err(
            "videoProtocolUnsupported",
            "此设备协商的视频传输协议尚未接入。",
        ));
    }
    let raw = response["public_key"]
        .as_str()
        .ok_or_else(AppError::protocol)?;
    if raw.len() != 64 || !raw.is_ascii() {
        return Err(AppError::protocol());
    }
    let mut peer = [0u8; 32];
    for (i, b) in peer.iter_mut().enumerate() {
        *b = u8::from_str_radix(&raw[i * 2..i * 2 + 2], 16).map_err(|_| AppError::protocol())?;
    }
    let shared = agreement::agree_ephemeral(
        private,
        &agreement::UnparsedPublicKey::new(&agreement::X25519, peer),
        |secret| {
            let key =
                salsa20::hsalsa::<salsa20::cipher::consts::U10>(secret.into(), &[0u8; 16].into());
            Zeroizing::new(<[u8; 32]>::from(key))
        },
    )
    .map_err(|_| AppError::protocol())?;
    let sign = response["sign"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() < 4096)
        .ok_or_else(AppError::protocol)?;
    let uid = response["vendor"]["vendor_params"]["p2p_id"]
        .as_str()
        .filter(|s| !s.is_empty() && s.len() < 64)
        .map(|s| Zeroizing::new(s.to_owned()));
    if host.is_none() && uid.is_none() {
        return Err(err(
            "videoTransportUnavailable",
            "小米云未返回可用的视频连接信息。",
        ));
    }
    let servers = response["vendor"]["vendor_params"]["init_string"]
        .as_str()
        .map(relay_list::servers)
        .unwrap_or_default();
    Ok(Config {
        audio: true,
        model: device.model.clone(),
        quality: 0,
        host,
        uid,
        servers,
        key: shared,
        public,
        sign: Zeroizing::new(sign.to_owned()),
        startup: None,
    })
}
fn authenticate(
    connection: &mut transport::Connection,
    config: &Config,
    stop: &AtomicBool,
) -> Result<()> {
    let auth =
        json!({"public_key":config.public,"sign":&*config.sign,"uuid":"","support_encrypt":0})
            .to_string();
    let mut command = 0x100u32.to_be_bytes().to_vec();
    command.extend_from_slice(auth.as_bytes());
    connection.command(&command)?;
    let deadline = Instant::now() + Duration::from_secs(15);
    loop {
        if stop.load(Ordering::Acquire) {
            return Err(AppError::stale());
        }
        if Instant::now() > deadline {
            return Err(err("videoAuthTimeout", "摄像机未完成视频鉴权。"));
        }
        if let Some((0, data)) = connection.next()? {
            if data.len() >= 4
                && serde_json::from_slice::<serde_json::Value>(&data[4..])
                    .ok()
                    .is_some_and(|v| v["result"] == "success")
            {
                break;
            }
            return Err(err("videoAuthRejected", "摄像机拒绝了本次视频会话。"));
        }
    }
    Ok(())
}
fn crypt(data: &[u8], key: &[u8; 32], nonce: &[u8]) -> Result<Vec<u8>> {
    if nonce.len() != 8 {
        return Err(AppError::protocol());
    }
    let mut iv = [0u8; 12];
    iv[4..].copy_from_slice(nonce);
    let mut output = data.to_vec();
    chacha20::ChaCha20::new(key.into(), (&iv).into()).apply_keystream(&mut output);
    Ok(output)
}
fn encoded(cmd: u32, body: &str, key: &[u8; 32]) -> Result<Vec<u8>> {
    let nonce = rand::random::<[u8; 8]>();
    let mut plain = cmd.to_be_bytes().to_vec();
    plain.extend_from_slice(body.as_bytes());
    let mut out = 0x1001u32.to_be_bytes().to_vec();
    out.extend_from_slice(&nonce);
    out.extend(crypt(&plain, key, &nonce)?);
    Ok(out)
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub receive_bytes_per_second: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens_id: Option<u8>,
    pub media_generation: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub keyframe: Option<bool>,
    pub stream_revision: u64,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub data: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub codec: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<AppError>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sample_rate: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub timestamp: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<saved_media::SavedMedia>,
}
impl Event {
    fn state(state: &'static str) -> Self {
        Self {
            receive_bytes_per_second: None,
            lens_id: None,
            media_generation: 0,
            keyframe: None,
            stream_revision: 0,
            state,
            data: None,
            codec: None,
            error: None,
            sample_rate: None,
            timestamp: None,
            file: None,
        }
    }
}
struct LensStream {
    mux: ts::Mux,
    format: mp4::Parameters,
    last_frame: Instant,
    needs_keyframe: bool,
    revision_pending: bool,
    revision: u64,
    unavailable: bool,
}
impl LensStream {
    fn new() -> Self {
        Self {
            mux: ts::Mux::default(),
            format: mp4::Parameters::default(),
            last_frame: Instant::now(),
            needs_keyframe: true,
            revision_pending: false,
            revision: 0,
            unavailable: false,
        }
    }
    fn reset(&mut self) {
        let revision = self.revision.wrapping_add(1);
        *self = Self::new();
        self.revision = revision;
    }
}
struct Session {
    id: String,
    home: String,
    generation: u64,
    did: String,
    stop: Arc<AtomicBool>,
    done: Arc<AtomicBool>,
    poll: Arc<AtomicU64>,
    started: Instant,
    rx: queue::Receiver,
    commands: std::sync::mpsc::SyncSender<media_control::Request>,
    terminal: Arc<Mutex<Option<Event>>>,
    terminal_delivered: AtomicBool,
}
#[derive(Default)]
pub struct Sessions(
    Mutex<Option<Session>>,
    AtomicU64,
    Mutex<Vec<Arc<AtomicBool>>>,
);
fn check_viewer_poll(elapsed_ms: u64, last_poll_ms: u64) -> Result<()> {
    if elapsed_ms.saturating_sub(last_poll_ms) > 10000 {
        return Err(err(
            "videoReadTimeout",
            "视频画面读取暂时中断，请重新连接。",
        ));
    }
    Ok(())
}
impl Sessions {
    fn retiring(&self, done: Arc<AtomicBool>) {
        if let Ok(mut pending) = self.2.lock() {
            pending.retain(|d| !d.load(Ordering::Acquire));
            if !done.load(Ordering::Acquire) && !pending.iter().any(|d| Arc::ptr_eq(d, &done)) {
                pending.push(done);
            }
        }
    }
    pub(crate) fn pending_stops(&self) -> Vec<Arc<AtomicBool>> {
        self.2
            .lock()
            .map(|mut pending| {
                pending.retain(|d| !d.load(Ordering::Acquire));
                pending.clone()
            })
            .unwrap_or_default()
    }
    #[cfg(test)]
    pub(crate) fn hold_fixture_worker(&self) -> Arc<AtomicBool> {
        let done = self.0.lock().unwrap().as_ref().unwrap().done.clone();
        done.store(false, Ordering::Release);
        done
    }
    #[cfg(test)]
    pub(crate) fn fixture(
        home: &str,
        generation: u64,
        did: &str,
        id: &str,
    ) -> (Self, queue::Sender, Arc<AtomicBool>) {
        let sessions = Self::default();
        let (tx, rx) = queue::channel();
        let stop = Arc::new(AtomicBool::new(false));
        *sessions.0.lock().unwrap() = Some(Session {
            id: id.into(),
            home: home.into(),
            generation,
            did: did.into(),
            stop: stop.clone(),
            done: Arc::new(AtomicBool::new(true)),
            poll: Arc::new(AtomicU64::new(0)),
            started: Instant::now(),
            rx,
            commands: sync_channel(1).0,
            terminal: Arc::new(Mutex::new(None)),
            terminal_delivered: AtomicBool::new(false),
        });
        (sessions, tx, stop)
    }
    pub async fn command(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        id: &str,
        operation: media_control::Operation,
        recording: Option<media_control::RecordSettings>,
    ) -> Result<media_control::Reply> {
        let sender = self
            .0
            .lock()
            .map_err(|_| AppError::stale())?
            .as_ref()
            .filter(|s| {
                s.id == id
                    && s.home == home
                    && s.generation == generation
                    && s.did == did
                    && !s.stop.load(Ordering::Acquire)
                    && !s.done.load(Ordering::Acquire)
            })
            .map(|s| s.commands.clone())
            .ok_or_else(AppError::stale)?;
        let (reply, result) = tokio::sync::oneshot::channel();
        sender
            .try_send(media_control::Request {
                operation,
                recording,
                reply,
            })
            .map_err(|_| err("cameraBusy", "摄像机会话正在处理其他请求。"))?;
        tokio::time::timeout(Duration::from_secs(30), result)
            .await
            .map_err(|_| err("cameraOperationTimeout", "摄像机操作等待超时。"))?
            .map_err(|_| err("cameraSessionClosed", "摄像机会话已关闭。"))?
    }
    pub fn owns(&self, home: &str, generation: u64, did: &str, id: &str) -> Result<()> {
        self.0
            .lock()
            .map_err(|_| AppError::stale())?
            .as_ref()
            .filter(|s| {
                s.id == id
                    && s.home == home
                    && s.generation == generation
                    && s.did == did
                    && !s.stop.load(Ordering::Acquire)
                    && !s.done.load(Ordering::Acquire)
            })
            .map(|_| ())
            .ok_or_else(AppError::stale)
    }
    pub fn stop_all(&self) {
        self.begin();
    }
    pub fn stop_all_request(&self) -> Option<Arc<AtomicBool>> {
        let mut slot = self.0.lock().ok()?;
        self.1.fetch_add(1, Ordering::AcqRel);
        let session = slot.take()?;
        session.stop.store(true, Ordering::Release);
        self.retiring(session.done.clone());
        Some(session.done.clone())
    }
    pub fn begin(&self) -> u64 {
        if let Ok(mut slot) = self.0.lock() {
            let ticket = self.1.fetch_add(1, Ordering::AcqRel) + 1;
            if let Some(old) = slot.take() {
                old.stop.store(true, Ordering::Release);
                self.retiring(old.done.clone());
            }
            return ticket;
        }
        0
    }
    pub fn start(
        &self,
        home: String,
        generation: u64,
        did: String,
        config: Config,
    ) -> Result<String> {
        let ticket = self.begin();
        self.start_reserved(home, generation, did, config, ticket)
    }
    pub fn start_reserved(
        &self,
        home: String,
        generation: u64,
        did: String,
        mut config: Config,
        ticket: u64,
    ) -> Result<String> {
        let mut slot = self.0.lock().map_err(|_| AppError::stale())?;
        if ticket == 0 || self.1.load(Ordering::Acquire) != ticket {
            return Err(AppError::stale());
        }
        let id = uuid::Uuid::new_v4().to_string();
        let stop = Arc::new(AtomicBool::new(false));
        let poll = Arc::new(AtomicU64::new(0));
        // A background WebView may batch its read timer once per second.
        // Hold a bounded burst of video/audio instead of ending a healthy stream.
        let (tx, rx) = queue::channel();
        let terminal = Arc::new(Mutex::new(None));
        let worker_terminal = terminal.clone();
        let (commands, requests) = sync_channel(16);
        let started = Instant::now();
        let worker_stop = stop.clone();
        let done = Arc::new(AtomicBool::new(false));
        let worker_done = done.clone();
        let worker_poll = poll.clone();
        std::thread::spawn(move || {
            let result = (|| -> Result<()> {
                let remote = || -> Result<transport::Connection> {
                    let uid = config.uid.as_deref().map(|s| s.as_str()).ok_or_else(|| {
                        err("videoTransportUnavailable", "云端未提供远程视频标识。")
                    })?;
                    let peer = relay_list::connect(uid, &config.servers, &worker_stop)
                        .or_else(|error| relay::connect(uid, &worker_stop).map_err(|_| error))?;
                    transport::Connection::from_relay(peer)
                };
                let local = || -> Result<transport::Connection> {
                    transport::Connection::connect(
                        config.host.ok_or_else(|| {
                            err("videoTransportUnavailable", "云端未提供局域网地址。")
                        })?,
                        &worker_stop,
                    )
                };
                let (mut connection, route) = if let Some(startup) = config.startup.as_ref() {
                    let (connection, route) = connect::authenticated(
                        || connect::race(&config, &worker_stop, startup.hint()),
                        || connect::race_remote(&config, &worker_stop),
                        |connection, route| {
                            startup.mark(|t, ms| {
                                t.connected_ms = Some(ms);
                                t.route = Some(match route {
                                    startup::Route::Local => "local",
                                    startup::Route::Relay => "relay",
                                    startup::Route::Punch => "punch",
                                });
                            });
                            authenticate(connection, &config, &worker_stop)
                        },
                        config.uid.is_some(),
                        &worker_stop,
                    )?;
                    (connection, Some(route))
                } else {
                    let mut connection = if config.servers.is_empty() {
                        local().or_else(|_| remote())?
                    } else {
                        remote().or_else(|error| local().map_err(|_| error))?
                    };
                    authenticate(&mut connection, &config, &worker_stop)?;
                    (connection, None)
                };
                if let Some(startup) = config.startup.as_mut() {
                    startup.mark(|t, ms| t.authenticated_ms = Some(ms));
                    if let Some(route) = route {
                        startup.remember(route);
                    }
                    startup.permits.clear();
                }
                let _ = tx.try_send(Event::state("authenticated"));
                let mut start_body = profiles::quality_body(&config.model, config.quality);
                start_body["enableaudio"] = json!(u8::from(config.audio));
                connection.command(&encoded(0x102, &start_body.to_string(), &config.key)?)?;
                let mut controls = media_control::Control::new(requests, config.model.clone());
                let streaming_result = (|| -> Result<()> {
                    tx.try_send(Event::state("waiting-frame"))
                        .map_err(|_| AppError::stale())?;
                    let dual = !profiles::lenses(&config.model).is_empty();
                    let mut streams = std::collections::BTreeMap::new();
                    streams.insert(0u8, LensStream::new());
                    for lens in profiles::lenses(&config.model) {
                        streams.entry(lens.id).or_insert_with(LensStream::new);
                    }
                    let mut was_recording = false;
                    let mut was_talking = false;
                    let mut rate_at = Instant::now();
                    let mut rate_bytes = connection.received_bytes();
                    while !worker_stop.load(Ordering::Acquire) {
                        check_viewer_poll(
                            started.elapsed().as_millis() as u64,
                            worker_poll.load(Ordering::Acquire),
                        )?;
                        controls.tick(&mut connection, &config.key)?;
                        let talking = controls.is_talking();
                        if talking != was_talking {
                            was_talking = talking;
                            connection.set_talk_active(talking)?;
                            let _ = tx.try_send(Event::state(if talking {
                                "talking"
                            } else {
                                "talk-stopped"
                            }));
                        }
                        if rate_at.elapsed() >= Duration::from_secs(1) {
                            let received = connection.received_bytes();
                            let mut event = Event::state("throughput");
                            event.receive_bytes_per_second = Some(
                                ((received.saturating_sub(rate_bytes)) as f64
                                    / rate_at.elapsed().as_secs_f64())
                                .round() as u64,
                            );
                            let _ = tx.try_send(event);
                            rate_at = Instant::now();
                            rate_bytes = received;
                        }
                        let recording = controls.is_recording();
                        if recording != was_recording {
                            was_recording = recording;
                            let _ = tx.try_send(Event::state(if recording {
                                "recording"
                            } else {
                                "recording-stopped"
                            }));
                        }
                        if controls.take_media_reset() {
                            for stream in streams.values_mut() {
                                stream.reset();
                            }
                        }
                        if !controls.playback_active() {
                            let mut available = false;
                            for (lens_id, stream) in &mut streams {
                                if stream.last_frame.elapsed() <= Duration::from_secs(25) {
                                    available = true;
                                } else if dual && !stream.unavailable {
                                    stream.unavailable = true;
                                    let mut event = Event::state("lens-unavailable");
                                    event.lens_id = Some(*lens_id);
                                    event.media_generation = controls.stream_revision();
                                    event.stream_revision = stream.revision;
                                    event.error =
                                        Some(err("videoFrameTimeout", "此镜头暂时没有画面。"));
                                    let _ = tx.try_send(event);
                                }
                            }
                            if !available {
                                return Err(err(
                                    "videoFrameTimeout",
                                    "已连接摄像机，但未收到可播放的视频帧。",
                                ));
                            }
                        }
                        let Some((channel, data)) = connection.next()? else {
                            continue;
                        };
                        if worker_stop.load(Ordering::Acquire) {
                            break;
                        }
                        if channel == 0 {
                            controls.command_reply(&data, &config.key)?;
                            continue;
                        }
                        if channel == 1 {
                            controls.rdt_reply(&data, &config.key)?;
                            continue;
                        }
                        if channel != 2 {
                            continue;
                        }
                        if data.len() < 40 || data.len() > 2 * 1024 * 1024 {
                            return Err(AppError::protocol());
                        }
                        let codec = u32::from_le_bytes(data[4..8].try_into().unwrap());
                        let timestamp = u64::from_le_bytes(data[16..24].try_into().unwrap());
                        let payload = crypt(&data[40..], &config.key, &data[32..40])?;
                        let flags = u32::from_le_bytes(data[12..16].try_into().unwrap());
                        controls.media(codec, timestamp, flags, &payload, &tx)?;
                        if !controls.media_ready() {
                            continue;
                        }
                        if !matches!(codec, 4 | 5) {
                            continue;
                        }
                        let Some(lens_id) = controls.video_lens(flags) else {
                            continue;
                        };
                        let stream = streams.entry(lens_id).or_insert_with(LensStream::new);
                        if stream.format.observe_change(codec, &payload) {
                            stream.needs_keyframe = true;
                            stream.revision_pending = true;
                        }
                        let keyframe = mp4::annex_b(&payload).iter().any(|n| {
                            !n.is_empty()
                                && if codec == 4 {
                                    n[0] & 31 == 5
                                } else {
                                    matches!((n[0] >> 1) & 63, 16..=21)
                                }
                        });
                        if stream.needs_keyframe && !keyframe {
                            continue;
                        }
                        let recovery = stream.needs_keyframe;
                        if recovery {
                            if stream.revision_pending {
                                stream.revision = stream.revision.wrapping_add(1);
                            }
                            stream.mux = ts::Mux::default();
                            stream.needs_keyframe = false;
                            stream.revision_pending = false;
                        }
                        stream.mux.set_playback(controls.playback_active());
                        let with_parameters = if recovery || keyframe {
                            stream.format.with_parameters(&payload)
                        } else {
                            payload.clone()
                        };
                        let bytes = stream.mux.video(codec, timestamp, &with_parameters)?;
                        stream.last_frame = Instant::now();
                        stream.unavailable = false;
                        if let Some(startup) = config.startup.as_ref() {
                            startup.mark(|t, ms| {
                                t.first_packet_ms.get_or_insert(ms);
                            });
                        }
                        let sent = tx.try_send(Event {
                            receive_bytes_per_second: None,
                            media_generation: controls.stream_revision(),
                            keyframe: Some(keyframe),
                            lens_id: if dual || lens_id != 0 {
                                Some(lens_id)
                            } else {
                                None
                            },
                            stream_revision: stream.revision,
                            state: "media",
                            codec: Some(if codec == 4 { "h264" } else { "hevc" }),
                            data: Some(STANDARD.encode(bytes)),
                            error: None,
                            sample_rate: None,
                            timestamp: Some(timestamp),
                            file: None,
                        });
                        if sent.is_err() {
                            if controls.playback_active() {
                                return Err(err("videoBackpressure", "回看数据读取未及时完成。"));
                            }
                            tx.discard_live_lens(lens_id);
                            stream.needs_keyframe = true;
                            stream.revision_pending = true;
                        }
                    }
                    Ok(())
                })();
                // Cleanup also runs when the frontend drops its receiver while
                // this thread is waiting for a frame, or decoding/backpressure
                // ends the read loop. Closing the receiver is not a video stop.
                controls.close(&mut connection, &config.key);
                let _ = connection.command(&encoded(0x103, "", &config.key)?);
                connection.finish_stop();
                match controls.finish_recording() {
                    Ok(Some(file)) => {
                        let mut event = Event::state("recorded");
                        event.file = Some(file);
                        let _ = tx.try_send(event);
                    }
                    Err(error) => {
                        let mut event = Event::state("operation-error");
                        event.error = Some(error);
                        let _ = tx.try_send(event);
                    }
                    _ => {}
                }
                streaming_result
            })();
            if let Some(startup) = config.startup.as_mut() {
                startup.permits.clear();
                if result.is_err()
                    && startup
                        .timings
                        .lock()
                        .is_ok_and(|t| t.authenticated_ms.is_none())
                {
                    startup.forget();
                }
            }
            let ended = if let Err(error) = result {
                Event {
                    receive_bytes_per_second: None,
                    lens_id: None,
                    media_generation: 0,
                    keyframe: None,
                    stream_revision: 0,
                    state: "error",
                    data: None,
                    codec: None,
                    error: Some(error),
                    sample_rate: None,
                    timestamp: None,
                    file: None,
                }
            } else {
                Event::state("stopped")
            };
            // Terminal diagnostics must survive a full media queue. Otherwise
            // backpressure is incorrectly reported as an unexplained disconnect.
            if let Ok(mut slot) = worker_terminal.lock() {
                *slot = Some(ended);
            }
            worker_done.store(true, Ordering::Release);
        });
        *slot = Some(Session {
            id: id.clone(),
            home,
            generation,
            did,
            stop,
            done,
            poll,
            started,
            rx,
            commands,
            terminal,
            terminal_delivered: AtomicBool::new(false),
        });
        Ok(id)
    }
    pub fn diagnostics(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        id: &str,
    ) -> Option<queue::Diagnostics> {
        self.0
            .lock()
            .ok()?
            .as_ref()
            .filter(|s| s.home == home && s.generation == generation && s.did == did && s.id == id)?
            .rx
            .diagnostics()
    }
    pub fn read(&self, home: &str, generation: u64, did: &str, id: &str) -> Result<Vec<Event>> {
        let slot = self.0.lock().map_err(|_| AppError::stale())?;
        let session = slot
            .as_ref()
            .filter(|s| s.id == id && s.home == home && s.generation == generation && s.did == did)
            .ok_or_else(AppError::stale)?;
        session.poll.store(
            session.started.elapsed().as_millis() as u64,
            Ordering::Release,
        );
        if session.terminal_delivered.load(Ordering::Acquire) {
            return Ok(vec![Event::state("stopped")]);
        }
        let mut events = Vec::new();
        let mut disconnected = false;
        for _ in 0..12 {
            match session.rx.try_recv() {
                Ok(event) => events.push(event),
                Err(std::sync::mpsc::TryRecvError::Empty) => break,
                Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                    disconnected = true;
                    break;
                }
            }
        }
        if let Some(event) = session
            .terminal
            .lock()
            .ok()
            .and_then(|mut slot| slot.take())
        {
            session.terminal_delivered.store(true, Ordering::Release);
            events.push(event);
        } else if disconnected
            && !events
                .iter()
                .any(|event| matches!(event.state, "stopped" | "error"))
        {
            events.push(Event::state("stopped"));
        }
        Ok(events)
    }
    pub fn stop(&self, home: &str, generation: u64, did: &str, id: &str) -> Result<()> {
        self.stop_request(home, generation, did, id).map(|_| ())
    }
    pub fn stop_request(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        id: &str,
    ) -> Result<Option<Arc<AtomicBool>>> {
        let mut slot = self.0.lock().map_err(|_| AppError::stale())?;
        if slot.as_ref().is_some_and(|s| {
            s.id == id && s.home == home && s.generation == generation && s.did == did
        }) {
            if let Some(s) = slot.take() {
                s.stop.store(true, Ordering::Release);
                self.retiring(s.done.clone());
                return Ok(Some(s.done.clone()));
            }
        }
        Ok(None)
    }
}
impl Drop for Sessions {
    fn drop(&mut self) {
        self.stop_all();
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn short_viewer_pause_buffers_frames_without_dropping_the_connection() {
        let (sessions, tx, _) = Sessions::fixture("h", 1, "a", "s");
        for _ in 0..40 {
            tx.try_send(Event::state("media")).unwrap();
        }
        assert_eq!(sessions.read("h", 1, "a", "s").unwrap().len(), 12);
    }
    #[test]
    fn full_video_queue_keeps_the_original_failure_and_never_replays_dead_media() {
        let (sessions, tx, _) = Sessions::fixture("h", 1, "a", "s");
        for _ in 0..64 {
            tx.try_send(Event::state("media")).unwrap();
        }
        assert!(tx.try_send(Event::state("media")).is_err());
        let mut event = Event::state("error");
        event.error = Some(err("videoBackpressure", "full"));
        *sessions
            .0
            .lock()
            .unwrap()
            .as_ref()
            .unwrap()
            .terminal
            .lock()
            .unwrap() = Some(event);
        let first = sessions.read("h", 1, "a", "s").unwrap();
        assert_eq!(
            first.last().unwrap().error.as_ref().unwrap().kind,
            "videoBackpressure"
        );
        let next = sessions.read("h", 1, "a", "s").unwrap();
        assert_eq!(next.len(), 1);
        assert_eq!(next[0].state, "stopped");
    }
    #[test]
    fn stalled_viewer_poll_has_a_distinct_retryable_reason() {
        assert!(check_viewer_poll(10000, 0).is_ok());
        let error = check_viewer_poll(10001, 0).unwrap_err();
        assert_eq!(error.kind, "videoReadTimeout");
        assert!(error.retryable);
        assert!(check_viewer_poll(u64::MAX, u64::MAX - 5).is_ok());
    }
    #[test]
    fn stopped_detail_worker_remains_visible_across_begin_and_repeated_stop() {
        let (sessions, _, _) = Sessions::fixture("h", 1, "a", "old");
        let done = sessions.hold_fixture_worker();
        sessions.stop_request("h", 1, "a", "old").unwrap();
        sessions.begin();
        sessions.stop_all_request();
        assert!(sessions
            .pending_stops()
            .iter()
            .any(|d| Arc::ptr_eq(d, &done)));
        done.store(true, Ordering::Release);
        assert!(sessions.pending_stops().is_empty());
    }
    #[test]
    fn doorbell_three_wakes_the_video_host_not_only_the_wifi_controller() {
        assert_eq!(
            battery_wake_method("madv.cateye.mi3iot"),
            Some("wakeup_host")
        );
        assert_eq!(battery_wake_method("madv.cateye.miowlv2"), Some("wakeup"));
        assert_eq!(battery_wake_method("chuangmi.camera.81ac1"), None);
        assert_eq!(
            battery_wake_request("madv.cateye.mi3iot").unwrap(),
            json!({
                "id":1,"method":"wakeup_host","model":"madv.cateye.mi3iot",
                "params":{"params":{"video":"1"}}
            })
        );
        assert!(battery_wake_request("chuangmi.camera.81ac1").is_none());
    }
    #[test]
    fn superseded_start_ticket_cannot_register_a_stream() {
        let sessions = Sessions::default();
        let first = sessions.begin();
        let second = sessions.begin();
        assert!(second > first);
        let config = Config {
            audio: true,
            model: "fixture.camera".into(),
            quality: 0,
            host: None,
            uid: None,
            servers: vec![],
            key: Zeroizing::new([0u8; 32]),
            public: String::new(),
            sign: Zeroizing::new(String::new()),
            startup: None,
        };
        assert!(sessions
            .start_reserved("h".into(), 1, "d".into(), config, first)
            .is_err());
    }
    #[test]
    fn terminal_disconnect_and_context_isolation() {
        let sessions = Sessions::default();
        let (tx, rx) = queue::channel();
        drop(tx);
        let stop = Arc::new(AtomicBool::new(false));
        *sessions.0.lock().unwrap() = Some(Session {
            commands: sync_channel(1).0,
            terminal: Arc::new(Mutex::new(None)),
            terminal_delivered: AtomicBool::new(false),
            id: "opaque".into(),
            home: "h".into(),
            generation: 2,
            did: "d".into(),
            stop: stop.clone(),
            done: Arc::new(AtomicBool::new(false)),
            poll: Arc::new(AtomicU64::new(0)),
            started: Instant::now(),
            rx,
        });
        assert!(sessions.read("other", 2, "d", "opaque").is_err());
        assert!(sessions.read("h", 1, "d", "opaque").is_err());
        assert_eq!(
            sessions.read("h", 2, "d", "opaque").unwrap()[0].state,
            "stopped"
        );
        sessions.stop("h", 2, "d", "wrong").unwrap();
        assert!(!stop.load(Ordering::Acquire));
        sessions.stop_all();
        assert!(stop.load(Ordering::Acquire));
    }
    #[test]
    fn chacha20_zero_key_nonce_matches_published_vector() {
        let output = crypt(&[0u8; 32], &[0u8; 32], &[0u8; 8]).unwrap();
        assert_eq!(
            output
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect::<String>(),
            "76b8e0ada0f13d90405d6ae55386bd28bdd219b8a08ded1aa836efcc8b770dc7"
        );
        assert!(crypt(&[], &[0u8; 32], &[0u8; 7]).is_err());
    }
}
