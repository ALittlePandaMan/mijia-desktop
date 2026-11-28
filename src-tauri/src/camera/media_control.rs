use super::{crypt, encoded, err, mp4, rdt, saved_media, transport, AppError, Event, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{atomic::{AtomicU8, Ordering}, mpsc::Receiver, Arc},
    time::{Duration, Instant},
};
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Quality {
    pub id: &'static str,
    pub label: &'static str,
    pub wire_value: u8,
}
fn quality_id(model: &str, firmware: Option<&str>, value: u8) -> Option<&'static str> {
    if let Some(profile) = super::profiles::media_for(model, firmware) {
        return profile.qualities.iter().find(|q| q.value == value).map(|q| q.id.as_str());
    }
    match value { 0 => Some("auto"), 1 => Some("sd"), 2 => Some("hd"), _ => None }
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TalkFormat {
    pub codec: &'static str,
    pub sample_rate: u32,
}
#[derive(Serialize, Clone)]
pub struct Lens {
    pub id: u8,
    pub label: &'static str,
    pub ptz: bool,
}
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Features {
    pub qualities: Vec<Quality>,
    pub listen: bool,
    pub talk: bool,
    pub ptz: bool,
    pub playback: bool,
    pub care: bool,
    pub reason: Option<&'static str>,
    pub talk_format: Option<TalkFormat>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lenses: Option<Vec<Lens>>,
}
#[cfg(test)]
fn quality_value(model: &str, quality: &str) -> Result<u8> {
    quality_value_for(model, None, quality)
}
pub fn quality_value_for(model: &str, firmware: Option<&str>, quality: &str) -> Result<u8> {
    if let Some(p) = super::profiles::media_for(model, firmware) {
        return p
            .qualities
            .iter()
            .find(|q| q.id == quality)
            .map(|q| q.value)
            .ok_or_else(|| AppError::invalid("此型号不支持所选画质。"));
    }
    match quality {
        "auto" => Ok(0),
        "sd" => Ok(1),
        "hd" => Ok(2),
        _ => Err(AppError::invalid("此型号不支持所选画质。")),
    }
}
#[cfg(test)]
pub fn features(model: &str) -> Features {
    features_for(model, None)
}
pub fn device_features(device: &crate::models::Device) -> Features {
    let mut result = features_for(&device.model, device.firmware_version.as_deref());
    if device.shared_read_only {
        result.talk = false;
        result.talk_format = None;
        result.ptz = false;
        for lens in result.lenses.iter_mut().flatten() {
            lens.ptz = false;
        }
    }
    result
}
fn features_for(model: &str, firmware: Option<&str>) -> Features {
    let profile = super::profiles::media_for(model, firmware);
    let card_playback = super::profiles::sd(model).is_some();
    Features {
        qualities: profile
            .map(|p| {
                p.qualities
                    .iter()
                    .map(|q| Quality {
                        id: q.id.as_str(),
                        label: q.label.as_str(),
                        wire_value: q.value,
                    })
                    .collect()
            })
            .unwrap_or_else(|| {
                vec![
                    Quality {
                        id: "auto",
                        label: "自动",
                        wire_value: 0,
                    },
                    Quality {
                        id: "sd",
                        label: "流畅",
                        wire_value: 1,
                    },
                    Quality {
                        id: "hd",
                        label: "高清",
                        wire_value: 2,
                    },
                ]
            }),
        listen: true,
        talk: profile.is_some_and(|p| p.talk.is_some()),
        ptz: profile.is_some_and(|p| p.ptz),
        playback: card_playback,
        care: super::profiles::care(model),
        reason: if profile.is_none() {
            Some("此型号的私有控制协议尚未核实。")
        } else {
            None
        },
        lenses: if super::profiles::lenses(model).is_empty() {
            None
        } else {
            Some(
                super::profiles::lenses(model)
                    .iter()
                    .map(|l| Lens {
                        id: l.id,
                        label: l.label.as_str(),
                        ptz: l.ptz,
                    })
                    .collect(),
            )
        },
        talk_format: profile.and_then(|p| p.talk.as_ref()).map(|t| TalkFormat {
            codec: t.codec.as_str(),
            sample_rate: t.sample_rate,
        }),
    }
}
#[derive(Deserialize, Clone, schemars::JsonSchema)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Quality {
        quality: String,
    },
    Listen {
        enabled: bool,
    },
    Talk {
        enabled: bool,
    },
    Ptz {
        direction: String,
    },
    Record {
        enabled: bool,
        width: Option<u32>,
        height: Option<u32>,
        #[serde(default, rename = "lensId")]
        lens_id: Option<u8>,
        #[serde(default, rename = "atTimestamp")]
        at_timestamp: Option<u64>,
        #[serde(default, rename = "mediaGeneration")]
        media_generation: Option<u64>,
    },
    Recordings,
    #[serde(skip)]
    IndexChannel {
        channel: u32,
    },
    Playback {
        start: u64,
        channel: u32,
        #[serde(default)]
        offset: u32,
        #[serde(default = "normal_speed")]
        speed: u32,
    },
    PlaybackSpeed {
        speed: u32,
    },
    Live,
    #[serde(skip)]
    Microphone {
        packet: Vec<u8>,
    },
}
fn normal_speed() -> u32 {
    1
}
fn playback_body(
    model: &str,
    session: u32,
    (start, end, offset, speed, channel): (u64, u64, u32, u32, u32),
    live: bool,
) -> serde_json::Value {
    if super::profiles::sd(model).is_some_and(|p| p.array_playback) {
        serde_json::json!({"sessionid":session,"starttime":[start],"endtime":[end],"offset":[offset],"speed":[speed],"channel":[channel],"avchannelmerge":1,"autoswitchtolive":u8::from(live)})
    } else {
        serde_json::json!({"sessionid":session,"starttime":start,"endtime":end,"offset":offset,"speed":speed,"avchannelmerge":1,"autoswitchtolive":u8::from(live)})
    }
}
fn index_request(model: &str, channel: u32, key: &[u8; 32]) -> Result<Vec<u8>> {
    let profile = super::profiles::sd(model)
        .filter(|p| p.channels.contains(&channel))
        .ok_or_else(AppError::protocol)?;
    rdt::index_request(channel, profile.index_bytes, profile.index_declared, key)
}
fn validate_playback_speed(speed: u32) -> Result<u32> {
    if [1, 4].contains(&speed) {
        Ok(speed)
    } else {
        Err(AppError::invalid("回看仅支持1倍或4倍。"))
    }
}
#[derive(Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Reply {
    pub stream_revision: u64,
    pub state: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub talk_revision: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file: Option<saved_media::SavedMedia>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub clips: Option<Vec<rdt::Clip>>,
}
pub struct RecordSettings {
    pub path: PathBuf,
    pub home: String,
    pub generation: u64,
    pub did: String,
    pub exports: Arc<saved_media::Exports>,
}
pub struct Request {
    pub operation: Operation,
    pub recording: Option<RecordSettings>,
    pub reply: tokio::sync::oneshot::Sender<Result<Reply>>,
}
struct Pending {
    expected: u32,
    deadline: Instant,
    state: &'static str,
    reply: tokio::sync::oneshot::Sender<Result<Reply>>,
    quality: Option<(u8, bool)>,
}
struct PendingListen {
    deadline: Instant,
    start_after: Option<Instant>,
    reply: tokio::sync::oneshot::Sender<Result<Reply>>,
}
const INDEX: u32 = 0x60000000;
const LIVE_FRAME: u32 = 0xffffffff;
pub struct Control {
    requests: Receiver<Request>,
    pending: Option<Pending>,
    pending_listen: Option<PendingListen>,
    listen: bool,
    recording: Option<(super::record_writer::Writer, RecordSettings, u8)>,
    model: String,
    firmware: Option<String>,
    rdt: rdt::Assembler,
    index_channel: u32,
    index_dual: bool,
    index_next: bool,
    index_ok: bool,
    index_error: Option<AppError>,
    clips: Vec<rdt::Clip>,
    talking: bool,
    talk_revision: u64,
    last_mic: Instant,
    mic_packets: u32,
    mic_window: Instant,
    audio_sequence: u32,
    playback_id: u32,
    stream_revision: u64,
    reset_media: bool,
    playback_active: bool,
    pending_speed: Option<u32>,
    quality_uncertain: bool,
    monitor_switch_uncertain: bool,
    current_quality: Option<u8>,
    preferred_quality: Option<Arc<AtomicU8>>,
    monitor_attempt: Option<u8>,
    playback_lens: Option<u8>,
    last_audio: Option<(u32, u64, u8, u64)>,
    last_audio_seen: Option<Instant>,
    previous_playback: Option<(Option<u8>, bool)>,
    record_cache: super::record_cache::Cache,
}
impl Control {
    pub fn take_media_reset(&mut self) -> bool {
        if self.reset_media {
            self.last_audio = None;
            self.last_audio_seen = None;
            self.record_cache.clear();
        }
        std::mem::take(&mut self.reset_media)
    }
    fn rollback_playback(&mut self) {
        if let Some((lens, active)) = self.previous_playback.take() {
            self.playback_lens = lens;
            self.playback_active = active;
            self.pending_speed = None;
            self.reset_media = true;
        }
    }
    pub fn playback_active(&self) -> bool {
        self.playback_active
    }
    pub fn is_recording(&self) -> bool {
        self.recording.is_some()
    }
    pub fn is_talking(&self) -> bool {
        self.talking
    }
    pub(super) fn talk_revision(&self) -> u64 {
        self.talk_revision
    }
    pub fn monitor_protected(&self) -> bool {
        self.is_recording() || self.is_talking() || self.listen || self.playback_active
    }
    pub fn configure_quality(&mut self, initial: u8, preferred: Option<Arc<AtomicU8>>) {
        self.current_quality = Some(initial);
        self.preferred_quality = preferred;
    }
    pub fn current_quality(&self) -> Option<u8> { self.current_quality }
    pub fn measured_quality(&self, background: bool) -> Option<&'static str> {
        let value = self.current_quality?;
        (!background && !self.quality_uncertain && !self.playback_active
            && !self.pending.as_ref().is_some_and(|p| p.quality.is_some())
            && self.preferred_quality.as_ref().is_none_or(|p| p.load(Ordering::Acquire) == value))
            .then(|| quality_id(&self.model, self.firmware.as_deref(), value)).flatten()
    }
    pub fn monitor_visibility_changed(&mut self) { self.monitor_attempt = None; }
    pub fn sync_monitor_quality(&mut self, c: &mut transport::Connection, key: &[u8; 32], background: bool, lowest: u8) -> Result<()> {
        if self.pending.is_some() || self.monitor_protected() { return Ok(()); }
        if self.quality_uncertain {
            return if !background && self.monitor_switch_uncertain {
                Err(err("videoQualityRestore", "画质恢复超时，请重新连接。"))
            } else { Ok(()) };
        }
        let Some(preferred) = &self.preferred_quality else { return Ok(()); };
        let desired = if background { lowest } else { preferred.load(Ordering::Acquire) };
        if self.current_quality == Some(desired) || self.monitor_attempt == Some(desired) { return Ok(()); }
        let (reply, _) = tokio::sync::oneshot::channel();
        self.send_quality(c, key, desired, false, reply)?;
        self.monitor_attempt = Some(desired);
        Ok(())
    }
    pub fn stream_revision(&self) -> u64 {
        self.stream_revision
    }
    pub fn media_ready(&self) -> bool {
        !self
            .pending
            .as_ref()
            .is_some_and(|pending| matches!(pending.expected, 0x10e | LIVE_FRAME))
    }
    pub fn video_lens(&self, flags: u32) -> Option<u8> {
        if let Some(lens) = self.playback_lens {
            return Some(lens);
        }
        let lenses = super::profiles::lenses(&self.model);
        if lenses.is_empty() {
            return Some(0);
        }
        let lens = ((flags >> 21) & 63) as u8;
        lenses.iter().any(|l| l.id == lens).then_some(lens)
    }
    #[cfg(test)]
    pub fn new(requests: Receiver<Request>, model: String) -> Self {
        Self::with_firmware(requests, model, None)
    }
    pub fn with_firmware(requests: Receiver<Request>, model: String, firmware: Option<String>) -> Self {
        Self {
            requests,
            pending: None,
            pending_listen: None,
            listen: false,
            recording: None,
            model,
            firmware,
            rdt: rdt::Assembler::default(),
            index_channel: 0,
            index_dual: false,
            index_next: false,
            index_ok: false,
            index_error: None,
            clips: vec![],
            talking: false,
            talk_revision: 0,
            last_mic: Instant::now(),
            mic_packets: 0,
            mic_window: Instant::now(),
            audio_sequence: 0,
            playback_id: 0,
            stream_revision: 0,
            reset_media: false,
            playback_active: false,
            pending_speed: None,
            quality_uncertain: false,
            monitor_switch_uncertain: false,
            current_quality: None,
            preferred_quality: None,
            monitor_attempt: None,
            playback_lens: None,
            last_audio: None,
            last_audio_seen: None,
            previous_playback: None,
            record_cache: Default::default(),
        }
    }
    fn wait(
        &mut self,
        expected: u32,
        state: &'static str,
        reply: tokio::sync::oneshot::Sender<Result<Reply>>,
        seconds: u64,
    ) {
        self.pending = Some(Pending {
            expected,
            deadline: Instant::now() + Duration::from_secs(seconds),
            state,
            reply,
            quality: None,
        });
    }
    fn send_quality(&mut self, c: &mut transport::Connection, key: &[u8; 32], value: u8, remember: bool,
        reply: tokio::sync::oneshot::Sender<Result<Reply>>) -> Result<()> {
        c.control_command(&encoded(0x109, &super::profiles::quality_body(&self.model, value).to_string(), key)?)?;
        self.wait(0x10a, "confirmed", reply, 8);
        if let Some(pending) = &mut self.pending { pending.quality = Some((value, remember)); }
        Ok(())
    }
    pub fn tick(&mut self, c: &mut transport::Connection, key: &[u8; 32]) -> Result<()> {
        if self.index_next && self.pending.as_ref().is_some_and(|p| p.expected == INDEX) {
            self.index_next = false;
            self.rdt.reset();
            c.write_channel(
                1,
                &index_request(&self.model, self.index_channel, key)?,
                true,
            )?;
        }
        // Original XmStreamClient.streamPlaybackSpeed uses command 271 after
        // playback exists. A speed field on the open request is not sufficient.
        if self.playback_active && self.pending.is_none() {
            if let Some(speed) = self.pending_speed.take() {
                let body = serde_json::json!({"sessionid":self.playback_id,"speed":speed});
                c.control_command(&encoded(0x10f, &body.to_string(), key)?)?;
            }
        }
        if self
            .pending
            .as_ref()
            .is_some_and(|p| Instant::now() > p.deadline)
        {
            if self.index_dual
                && self.index_channel == 0
                && self.pending.as_ref().is_some_and(|p| p.expected == INDEX)
            {
                self.index_channel = 10;
                self.rdt.reset();
                c.write_channel(1, &index_request(&self.model, 10, key)?, true)?;
                self.pending.as_mut().unwrap().deadline = Instant::now() + Duration::from_secs(12);
            } else {
                if let Some(p) = self.pending.take() {
                    if p.expected == INDEX && self.index_ok {
                        self.clips.sort_by_key(|clip| (clip.start, clip.channel));
                        let _ = p.reply.send(Ok(Reply {
                            state: "recordings",
                            clips: Some(self.clips.clone()),
                            ..Reply::default()
                        }));
                        return Ok(());
                    }
                    if p.expected == 0x107 {
                        self.talking = false;
                        let _ = c.control_command(&encoded(0x108, "{\"speakerStop\":1}", key)?);
                    }
                    if p.expected == 0x10a {
                        self.quality_uncertain = true;
                        self.monitor_switch_uncertain = p.quality.is_some_and(|(_, remember)| !remember);
                    }
                    if matches!(p.expected, 0x10e | LIVE_FRAME) {
                        self.rollback_playback();
                    }
                    let error = if p.expected == 0x10a {
                        err(
                            "cameraQualityUncertain",
                            "画质确认超时，需要重新连接此摄像头。",
                        )
                    } else {
                        err("cameraOperationTimeout", "摄像机未确认此项操作。")
                    };
                    let _ = p.reply.send(Err(error));
                }
            }
        }
        if self.talking
            && self.last_mic.elapsed() > Duration::from_secs(3)
            && self.pending.is_none()
        {
            self.talking = false;
            c.control_command(&encoded(0x108, "{\"speakerStop\":1}", key)?)?;
        }
        if self.pending_listen.as_ref().is_some_and(|p| {
            p.reply.is_closed() || Instant::now() >= p.deadline
        }) {
            self.listen = false;
            if let Some(p) = self.pending_listen.take() {
                let _ = p.reply.send(Err(err("cameraAudioUnavailable", "此摄像机暂未返回音频。")));
            }
        }
        for _ in 0..8 {
            let Ok(request) = self.requests.try_recv() else {
                break;
            };
            if request.reply.is_closed() {
                continue;
            }
            // Ending a microphone lease must not wait behind a pending start or quality.
            if matches!(request.operation, Operation::Talk { enabled: false }) {
                self.talking = false;
                if self.pending.as_ref().is_some_and(|p| p.expected == 0x107) {
                    if let Some(p) = self.pending.take() {
                        let _ = p
                            .reply
                            .send(Err(err("cameraTalkCancelled", "通话已取消。")));
                    }
                }
                c.control_command(&encoded(0x108, "{\"speakerStop\":1}", key)?)?;
                let _ = request.reply.send(Ok(Reply {
                    state: "talk-stopped",
                    ..Reply::default()
                }));
                continue;
            }
            // The negotiated media session may already provide audio while a
            // quality or playback command still awaits its own reply.
            if let Operation::Listen { enabled } = &request.operation {
                if !enabled {
                    self.listen = false;
                    if let Some(p) = self.pending_listen.take() {
                        let _ = p.reply.send(Err(err("cameraListenCancelled", "声音已关闭。")));
                    }
                    let _ = request.reply.send(Ok(Reply { state: "muted", ..Reply::default() }));
                } else if self.pending_listen.is_some() {
                    let _ = request.reply.send(Err(err("cameraBusy", "正在等待音频。")));
                } else {
                    let now = Instant::now();
                    let recent = self.last_audio_seen.is_some_and(|time| {
                        now.duration_since(time) < Duration::from_millis(750)
                    });
                    self.listen = true;
                    self.pending_listen = Some(PendingListen {
                        deadline: now + Duration::from_secs(8),
                        start_after: Some(now + if recent { Duration::from_millis(500) } else { Duration::ZERO }),
                        reply: request.reply,
                    });
                }
                continue;
            }
            if self.pending.is_some() && !matches!(request.operation, Operation::Microphone { .. })
            {
                let _ = request
                    .reply
                    .send(Err(err("cameraBusy", "正在等待上一项操作确认。")));
                continue;
            }
            let caps = features_for(&self.model, self.firmware.as_deref());
            let result = match request.operation {
                Operation::Quality { quality } => {
                    if self.quality_uncertain {
                        Err(err(
                            "cameraQualityUncertain",
                            "画质确认超时，需要重新连接此摄像头。",
                        ))
                    } else if self.recording.is_some() {
                        Err(AppError::invalid("请先结束录像。"))
                    } else {
                        let n = match quality_value_for(&self.model, self.firmware.as_deref(), &quality) {
                            Ok(value) => value,
                            Err(error) => {
                                let _ = request.reply.send(Err(error));
                                continue;
                            }
                        };
                        self.send_quality(c, key, n, true, request.reply)?;
                        continue;
                    }
                }
                Operation::Listen { .. } => unreachable!("listen requests are handled before the command queue"),
                Operation::Record {
                    enabled,
                    width,
                    height,
                    lens_id,
                    at_timestamp,
                    media_generation,
                } => {
                    if media_generation.is_some_and(|generation| generation != self.stream_revision)
                    {
                        let _ = request.reply.send(Err(AppError::stale()));
                        continue;
                    }
                    if enabled {
                        if self.recording.is_some() {
                            Err(AppError::invalid("正在录像。"))
                        } else {
                            (|| -> Result<Reply> {
                                let lens = lens_id.unwrap_or(0);
                                let lenses = super::profiles::lenses(&self.model);
                                if !(lens == 0 || lenses.iter().any(|l| l.id == lens)) {
                                    return Err(AppError::invalid("无效的录像镜头。"));
                                }
                                if self.playback_lens.is_some_and(|selected| selected != lens) {
                                    return Err(AppError::invalid("请录制当前回看镜头。"));
                                }
                                let settings = request.recording.ok_or_else(AppError::stale)?;
                                let mut recorder = mp4::Recorder::new(
                                    &settings.path,
                                    width.unwrap_or(0),
                                    height.unwrap_or(0),
                                )?;
                                self.record_cache.seed(&mut recorder, lens, at_timestamp)?;
                                self.recording = Some((
                                    super::record_writer::Writer::start(recorder)?,
                                    settings,
                                    lens,
                                ));
                                Ok(Reply {
                                    state: "recording",
                                    ..Reply::default()
                                })
                            })()
                        }
                    } else {
                        if let Some((recorder, _, _)) = &mut self.recording {
                            if let Some(time) = at_timestamp {
                                recorder.select_end(time);
                            }
                        }
                        self.finish_recording().map(|file| Reply {
                            state: "recorded",
                            file,
                            ..Reply::default()
                        })
                    }
                }
                Operation::Talk { enabled: true } if caps.talk => {
                    c.control_command(&encoded(0x106, "{\"speakerStart\":1}", key)?)?;
                    self.wait(0x107, "talking", request.reply, 8);
                    continue;
                }
                Operation::Ptz { direction } if caps.ptz => {
                    let operation = match direction.as_str() {
                        "left" => 1,
                        "right" => 2,
                        "up" => 3,
                        "down" => 4,
                        _ => {
                            let _ = request.reply.send(Err(AppError::invalid("无效方向。")));
                            continue;
                        }
                    };
                    c.control_command(&encoded(
                        0x112,
                        &serde_json::json!({"operation":operation}).to_string(),
                        key,
                    )?)?;
                    self.wait(0x113, "moved", request.reply, 8);
                    continue;
                }
                Operation::Recordings if caps.playback => {
                    self.index_channel = 0;
                    self.index_dual =
                        super::profiles::sd(&self.model).is_some_and(|p| p.channels.len() == 2);
                    self.index_next = false;
                    self.index_ok = false;
                    self.index_error = None;
                    self.clips.clear();
                    self.rdt.reset();
                    let index = index_request(&self.model, 0, key)?;
                    c.write_channel(1, &index, true)?;
                    self.wait(
                        INDEX,
                        "recordings",
                        request.reply,
                        if self.index_dual { 12 } else { 25 },
                    );
                    continue;
                }
                Operation::IndexChannel { channel }
                    if caps.playback && [0, 10].contains(&channel) =>
                {
                    self.index_channel = channel;
                    self.index_dual = false;
                    self.index_next = false;
                    self.index_ok = false;
                    self.index_error = None;
                    self.clips.clear();
                    self.rdt.reset();
                    let index = index_request(&self.model, channel, key)?;
                    c.write_channel(1, &index, true)?;
                    self.wait(INDEX, "recordings", request.reply, 25);
                    continue;
                }
                Operation::Playback {
                    start,
                    channel,
                    offset,
                    speed,
                } if caps.playback => {
                    if self.recording.is_some() {
                        let _ = request
                            .reply
                            .send(Err(AppError::invalid("请先结束回看录像。")));
                        continue;
                    }
                    if let Err(error) = validate_playback_speed(speed) {
                        let _ = request.reply.send(Err(error));
                        continue;
                    }
                    let Some(clip) = self.clips.iter().find(|clip| {
                        clip.start == start && clip.channel == channel && offset < clip.duration
                    }) else {
                        let _ = request.reply.send(Err(AppError::invalid(
                            "录像未在本次存储卡索引中，或播放位置无效。",
                        )));
                        continue;
                    };
                    self.previous_playback = Some((self.playback_lens, self.playback_active));
                    self.playback_id = self.playback_id.wrapping_add(1);
                    self.playback_lens = Some(channel as u8);
                    self.playback_active = false;
                    self.pending_speed = Some(speed);
                    let body = playback_body(
                        &self.model,
                        self.playback_id,
                        (start, start + clip.duration as u64, offset, 1, channel),
                        false,
                    );
                    c.control_command(&encoded(0x10d, &body.to_string(), key)?)?;
                    self.wait(0x10e, "playback", request.reply, 12);
                    self.stream_revision = self.stream_revision.wrapping_add(1);
                    self.reset_media = true;
                    continue;
                }
                Operation::PlaybackSpeed { speed } if caps.playback => {
                    if !self.playback_active || self.recording.is_some() {
                        Err(AppError::invalid("请先播放存储卡录像并结束录制。"))
                    } else {
                        let speed = match validate_playback_speed(speed) {
                            Ok(speed) => speed,
                            Err(error) => {
                                let _ = request.reply.send(Err(error));
                                continue;
                            }
                        };
                        let body = serde_json::json!({"sessionid":self.playback_id,"speed":speed});
                        c.control_command(&encoded(0x10f, &body.to_string(), key)?)?;
                        Ok(Reply {
                            state: "speed-set",
                            stream_revision: self.stream_revision,
                            ..Reply::default()
                        })
                    }
                }
                Operation::Live if caps.playback => {
                    self.previous_playback = Some((self.playback_lens, self.playback_active));
                    self.playback_lens = None;
                    self.pending_speed = None;
                    self.playback_id = self.playback_id.wrapping_add(1);
                    let body = playback_body(&self.model, self.playback_id, (0, 0, 0, 1, 0), true);
                    c.control_command(&encoded(0x10d, &body.to_string(), key)?)?;
                    self.wait(LIVE_FRAME, "live", request.reply, 12);
                    self.stream_revision = self.stream_revision.wrapping_add(1);
                    self.reset_media = true;
                    self.playback_active = false;
                    continue;
                }
                Operation::Microphone { packet } if caps.talk => {
                    self.send_microphone(c, key, &packet)
                }
                _ => Err(err(
                    "cameraFeatureUnsupported",
                    "此型号尚未接入这项视频能力。",
                )),
            };
            let _ = request.reply.send(result);
        }
        if self.pending.is_none() {
            if let Some(listen) = &mut self.pending_listen {
                if listen.start_after.is_some_and(|time| Instant::now() >= time) {
                    c.control_command(&encoded(0x104, "", key)?)?;
                    listen.start_after = None;
                }
            }
        }
        Ok(())
    }
    pub fn command_reply(&mut self, data: &[u8], key: &[u8; 32]) -> Result<()> {
        if data.len() < 4 {
            return Ok(());
        }
        let cmd = u32::from_be_bytes(data[..4].try_into().unwrap());
        let plain = if cmd == 0x1001 {
            if data.len() < 12 {
                return Err(AppError::protocol());
            }
            crypt(&data[12..], key, &data[4..12])?
        } else {
            data.to_vec()
        };
        if plain.len() < 4 {
            return Err(AppError::protocol());
        }
        let cmd = u32::from_be_bytes(plain[..4].try_into().unwrap());
        if self
            .pending
            .as_ref()
            .is_some_and(|p| p.expected == cmd)
        {
            let p = self.pending.take().unwrap();
            // MISS camera responses may have C-string NUL padding after JSON.
            // Embedded NULs and any other trailing bytes still fail parsing.
            let end = plain
                .iter()
                .rposition(|b| !matches!(b, 0 | b' ' | b'\t' | b'\r' | b'\n'))
                .map_or(4, |i| i + 1);
            let value = serde_json::from_slice::<serde_json::Value>(&plain[4..end.max(4)]).ok();
            // Actual C700 0x10A is a four-byte zero status, not JSON.
            // Do not extend that binary acknowledgement to unrelated commands.
            let binary_quality_ok = cmd == 0x10a && plain.len() == 8 && plain[4..8] == [0; 4];
            // MISS speaker-start also uses a command-specific 32-bit status.
            // Require the exact response ID, size and zero status; never accept a send alone.
            let binary_talk_ok = cmd == 0x107 && plain.len() == 8 && plain[4..8] == [0; 4];
            let success = binary_quality_ok
                || binary_talk_ok
                || value.as_ref().is_some_and(|v| {
                    v["result"] == "success"
                        || v["result"] == 0
                        || v["code"] == 0
                        || v["result"]["code"] == 0
                        || v["status"] == "filefound"
                        || v["result"]["status"] == "filefound"
                });
            if success && cmd == 0x107 {
                self.talking = true;
                self.talk_revision += 1;
                self.last_mic = Instant::now();
            }
            if cmd == 0x10e {
                if success {
                    self.playback_active = true;
                    self.previous_playback = None;
                } else {
                    self.rollback_playback();
                }
            }
            if success {
                if let Some((value, remember)) = p.quality {
                    self.current_quality = Some(value);
                    if remember {
                        if let Some(preferred) = &self.preferred_quality { preferred.store(value, Ordering::Release); }
                        self.monitor_attempt = None;
                    }
                }
            }
            // Quality acknowledgement is not a media boundary. The worker
            // advances the revision once the actual codec parameters change.
            let _ = p.reply.send(if success {
                Ok(Reply {
                    state: p.state,
                    stream_revision: self.stream_revision,
                    talk_revision: (cmd == 0x107).then_some(self.talk_revision),
                    ..Reply::default()
                })
            } else {
                Err(err("cameraOperationRejected", "摄像机未接受此项操作。"))
            });
        }
        Ok(())
    }
    pub fn rdt_reply(&mut self, data: &[u8], key: &[u8; 32]) -> Result<()> {
        if let Err(error) = self.rdt_reply_inner(data, key) {
            self.rdt.reset();
            if self.pending.as_ref().is_some_and(|p| p.expected == INDEX) {
                let p = self.pending.take().unwrap();
                let _ = p.reply.send(Err(error));
            }
        }
        Ok(())
    }
    fn rdt_reply_inner(&mut self, data: &[u8], key: &[u8; 32]) -> Result<()> {
        if data.len() < 8 {
            return Err(AppError::protocol());
        }
        let plain = crypt(&data[8..], key, &data[..8])?;
        if let Some((6, body)) = self.rdt.push(&plain)? {
            if self.pending.as_ref().is_some_and(|p| p.expected == INDEX) {
                let result = rdt::index(&body, self.index_channel);
                match result {
                    Ok(clips) => {
                        self.index_ok = true;
                        self.clips.extend(clips)
                    }
                    Err(error) => self.index_error = Some(error),
                }
                if self.index_dual && self.index_channel == 0 {
                    self.pending.as_mut().unwrap().deadline =
                        Instant::now() + Duration::from_secs(12);
                    self.index_channel = 10;
                    self.index_next = true;
                    return Ok(());
                }
                let p = self.pending.take().unwrap();
                let reply = if self.index_ok {
                    self.clips.sort_by_key(|clip| (clip.start, clip.channel));
                    Ok(Reply {
                        state: "recordings",
                        clips: Some(self.clips.clone()),
                        ..Reply::default()
                    })
                } else {
                    Err(self.index_error.take().unwrap_or_else(AppError::protocol))
                };
                let _ = p.reply.send(reply);
            }
        }
        Ok(())
    }
    fn send_microphone(
        &mut self,
        c: &mut transport::Connection,
        key: &[u8; 32],
        packet: &[u8],
    ) -> Result<Reply> {
        if !self.talking {
            return Err(err("cameraTalkInactive", "通话尚未建立，音频未发送。"));
        }
        if packet.is_empty() || packet.len() > 1275 {
            return Err(AppError::invalid("麦克风音频包无效。"));
        }
        if self.mic_window.elapsed() >= Duration::from_secs(1) {
            self.mic_window = Instant::now();
            self.mic_packets = 0;
        }
        self.mic_packets += 1;
        if self.mic_packets > 100 {
            return Err(AppError::invalid("麦克风音频发送过快。"));
        }
        use rand::RngCore;
        let mut nonce = [0u8; 8];
        rand::rngs::OsRng.fill_bytes(&mut nonce);
        let encrypted = crypt(packet, key, &nonce)?;
        let mut header = [0u8; 32];
        header[..4].copy_from_slice(&((encrypted.len() + 8) as u32).to_le_bytes());
        let format = features_for(&self.model, self.firmware.as_deref())
            .talk_format
            .ok_or_else(|| AppError::invalid("对讲格式尚未核实。"))?;
        let codec: u32 = if format.codec == "opus" { 1032 } else { 1027 };
        header[4..8].copy_from_slice(&codec.to_le_bytes());
        // Original MIStream.avChannelSendAudio passes mChan << 21,
        // not a guessed sample-rate bit. Talk uses the shared primary audio lane.
        let flags: u32 = 0;
        header[12..16].copy_from_slice(&flags.to_le_bytes());
        header[8..12].copy_from_slice(&self.audio_sequence.to_le_bytes());
        self.audio_sequence = self.audio_sequence.wrapping_add(1);
        let time = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|_| AppError::protocol())?
            .as_millis() as u64;
        header[16..24].copy_from_slice(&time.to_le_bytes());
        let mut data = header.to_vec();
        data.extend(nonce);
        data.extend(encrypted);
        c.write_channel(3, &data, false)?;
        self.last_mic = Instant::now();
        Ok(Reply {
            state: "audio-sent",
            ..Reply::default()
        })
    }
    pub fn media(
        &mut self,
        codec: u32,
        time: u64,
        flags: u32,
        payload: &[u8],
        tx: &super::queue::Sender,
    ) -> Result<()> {
        // Frames already in transit before the playback acknowledgement still
        // belong to the previous mode. Do not relabel them as the selected lens.
        if self
            .pending
            .as_ref()
            .is_some_and(|pending| pending.expected == 0x10e)
        {
            return Ok(());
        }
        if matches!(codec, 4 | 5)
            && self
                .pending
                .as_ref()
                .is_some_and(|p| p.expected == LIVE_FRAME)
            && mp4::has_keyframe(codec, payload)
        {
            let p = self.pending.take().unwrap();
            self.previous_playback = None;
            let _ = p.reply.send(Ok(Reply {
                state: "live",
                stream_revision: self.stream_revision,
                ..Reply::default()
            }));
        }
        if !self.media_ready() {
            return Ok(());
        }
        let (format, lens_id) = if matches!(codec, 4 | 5) {
            (mp4::FrameFormat::Video(codec), self.video_lens(flags))
        } else {
            let Some(format) = mp4::AudioFormat::from_packet(codec, flags, payload) else {
                return Ok(());
            };
            // Some dual cameras duplicate shared audio on both channels. Keep
            // distinct packets even when a firmware has coarse timestamps.
            use std::hash::Hasher;
            let mut digest = std::collections::hash_map::DefaultHasher::new();
            digest.write(payload);
            let hash = digest.finish();
            let channel = ((flags >> 21) & 63) as u8;
            if self
                .last_audio
                .is_some_and(|(c, t, l, h)| c == codec && t == time && l != channel && h == hash)
            {
                return Ok(());
            }
            self.last_audio = Some((codec, time, channel, hash));
            (mp4::FrameFormat::Audio(format), Some(0))
        };
        if let Some(lens) = lens_id {
            self.record_cache
                .push(format, time, lens, payload, self.playback_active);
        }
        if let Some((recorder, _, selected)) = &mut self.recording {
            let result = if matches!(format, mp4::FrameFormat::Audio(_)) || lens_id == Some(*selected) {
                recorder.push(format, time, payload)
            } else {
                Ok(())
            };
            if let Err(error) = result {
                let file = self.finish_recording().ok().flatten();
                let _ = tx.try_send(Event {
                    media_generation: self.stream_revision,
                    stream_revision: self.stream_revision,
                    error: Some(error),
                    file,
                    ..Event::state("operation-error")
                });
            }
        }
        let mp4::FrameFormat::Audio(format) = format else {
            return Ok(());
        };
        self.last_audio_seen = Some(Instant::now());
        if self.listen {
            use base64::Engine;
            let sent = tx.try_send(Event {
                media_generation: self.stream_revision,
                stream_revision: self.stream_revision,
                data: Some(base64::engine::general_purpose::STANDARD.encode(payload)),
                codec: Some(format.name()),
                sample_rate: Some(format.rate),
                timestamp: Some(time),
                ..Event::state("audio")
            });
            match sent {
                Ok(()) => {}
                Err(super::queue::SendError::Full | super::queue::SendError::PlaybackLimited) => return Ok(()),
                Err(super::queue::SendError::Disconnected) => return Err(AppError::stale()),
            }
            if let Some(p) = self.pending_listen.take() {
                let _ = p.reply.send(Ok(Reply { state: "listening", ..Reply::default() }));
            }
        }
        Ok(())
    }
    pub fn close(&mut self, c: &mut transport::Connection, key: &[u8; 32]) {
        if self.talking {
            self.talking = false;
            if let Ok(command) = encoded(0x108, "{\"speakerStop\":1}", key) {
                let _ = c.command(&command);
                c.flush_command();
            }
        }
    }
    pub fn finish_recording(&mut self) -> Result<Option<saved_media::SavedMedia>> {
        if let Some((recorder, s, _)) = self.recording.take() {
            let path = recorder.finish()?;
            return s
                .exports
                .register(&s.home, s.generation, &s.did, path, "recording")
                .map(Some);
        }
        Ok(None)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn legacy_camera_uses_the_same_firmware_gate_for_menu_commands_and_readback() {
        let model = "chuangmi.camera.ipc019";
        for firmware in [None, Some("3.5.5_0398"), Some("3.5.5_0399-beta")] {
            assert_eq!(features_for(model, firmware).qualities.len(), 3);
            assert_eq!(quality_value_for(model, firmware, "hd").unwrap(), 2);
        }
        for firmware in [Some("3.5.5_0399"), Some("3.5.5_0400"), Some("3.5.10_0001")] {
            let ids: Vec<_> = features_for(model, firmware).qualities.iter().map(|q| q.id).collect();
            assert_eq!(ids, ["auto", "sd"]);
            assert!(quality_value_for(model, firmware, "hd").is_err());
            assert_eq!(quality_id(model, firmware, 2), None);
            assert_eq!(quality_id(model, firmware, 1), Some("sd"));
        }
    }

    #[test]
    fn shared_camera_features_keep_read_paths_and_disable_all_actuators() {
        let mut device: crate::models::Device = serde_json::from_value(serde_json::json!({
            "did":"mock","model":"xiaomi.camera.cw701","name":"mock",
            "roomId":"room","roomName":"room","online":true,"sharedReadOnly":true
        })).unwrap();
        device.shared_read_only = true;
        let shared = device_features(&device);
        assert!(shared.listen && shared.playback);
        assert_eq!(shared.care, features(&device.model).care);
        assert!(!shared.talk && !shared.ptz && shared.talk_format.is_none());
        assert!(shared.lenses.unwrap().iter().all(|lens| !lens.ptz));
    }

    #[test]
    fn verified_dual_models_start_and_route_both_live_lenses() {
        for model in [
            "isa.camera.hlmax",
            "mxiang.camera.c500ch",
            "mxiang.camera.c500os",
            "chuangmi.camera.72ac1",
            "chuangmi.camera.072ae2",
            "xiaomi.camera.cw501d",
            "xiaomi.camera.cw5014",
            "xiaomi.camera.qp2c",
            "xiaomi.camera.4dc304",
            "chuangmi.camera.068ac1",
            "chuangmi.camera.111ae1",
            "chuangmi.camera.111ac1",
            "chuangmi.camera.075ae1",
            "xiaovv.camera.xvvc10",
        ] {
            let lenses = features(model).lenses.expect(model);
            let ids: Vec<_> = lenses.iter().map(|lens| lens.id).collect();
            assert_eq!(ids, [0, 10], "{model}");
            assert_eq!(lenses[0].ptz, model != "chuangmi.camera.075ae1", "{model}");
            assert!(!lenses[1].ptz, "{model}");
            for (quality, value) in [("auto", 0), ("sd", 1)] {
                assert_eq!(quality_value(model, quality).unwrap(), value, "{model}");
                assert_eq!(
                    super::super::profiles::quality_body(model, value),
                    serde_json::json!({"videoquality": value, "videoquality2": value}),
                    "{model}"
                );
            }
            let (_tx, rx) = std::sync::mpsc::sync_channel(1);
            let control = Control::new(rx, model.into());
            assert_eq!(control.video_lens(1), Some(0), "{model}");
            assert_eq!(control.video_lens((10 << 21) | 1), Some(10), "{model}");
            assert_eq!(control.video_lens((11 << 21) | 1), None, "{model}");
        }

        let single = "isa.camera.cw500";
        assert!(features(single).lenses.is_none());
        assert_eq!(
            super::super::profiles::quality_body(single, 1),
            serde_json::json!({"videoquality": 1})
        );
    }

    #[test]
    fn c700_four_profiles_are_model_scoped() {
        let model = "chuangmi.camera.81ac1";
        let choices = features(model).qualities;
        assert_eq!(
            choices.iter().map(|q| (q.id, q.label)).collect::<Vec<_>>(),
            vec![
                ("uhd", "4K"),
                ("hd", "1080P"),
                ("sd", "480P"),
                ("auto", "自动")
            ]
        );
        assert_eq!(
            choices
                .iter()
                .map(|q| quality_value(model, q.id).unwrap())
                .collect::<Vec<_>>(),
            vec![3, 2, 1, 0]
        );
        assert!(quality_value("fixture.camera", "uhd").is_err());
        for invalid in ["4", "8", "url", "", "4k", "UHD"] {
            assert!(quality_value(model, invalid).is_err());
        }
    }
    fn local() -> (transport::Connection, std::net::UdpSocket) {
        let peer = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        peer.set_read_timeout(Some(Duration::from_millis(60)))
            .unwrap();
        let client = std::net::UdpSocket::bind("127.0.0.1:0").unwrap();
        (
            transport::Connection::from_relay((client, peer.local_addr().unwrap())).unwrap(),
            peer,
        )
    }
    #[test]
    fn original_audio_survives_muted_replay_preroll_and_recording() {
        let video = [
            0, 0, 1, 0x67, 0x42, 0, 0x1e, 1, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2,
        ];
        let preroll = [0x83, 0x72, 0x61, 0x50, 0x41, 0x32, 0x23, 0x16];
        let received = [0xf7, 0xe6, 0xd5, 0xc4];
        for (codec, flags, tag, extension) in [
            (1024, 0, b"sowt", "mov"),
            (1026, 0, b"ulaw", "mov"),
            (1027, 8, b"alaw", "mov"),
            (1032, 0, b"Opus", "mp4"),
        ] {
            let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
            std::fs::create_dir(&dir).unwrap();
            let (requests, rx) = std::sync::mpsc::sync_channel(1);
            let (events, read) = super::super::queue::channel();
            let (mut connection, _) = local();
            let mut control = Control::new(rx, "chuangmi.camera.81ac1".into());
            control.playback_active = true;
            control.media(4, 1000, 0, &video, &events).unwrap();
            control.media(codec, 1020, flags, &preroll, &events).unwrap();
            control.media(4, 1040, 0, &[0, 0, 1, 0x41, 1], &events).unwrap();
            let (reply, mut result) = tokio::sync::oneshot::channel();
            requests.send(Request {
                operation: Operation::Record {
                    enabled: true,
                    width: Some(640),
                    height: Some(360),
                    lens_id: Some(0),
                    at_timestamp: Some(1020),
                    media_generation: Some(control.stream_revision()),
                },
                recording: Some(RecordSettings {
                    path: dir.join("fixture.mp4"),
                    home: "test-home".into(),
                    generation: 2,
                    did: "test-camera".into(),
                    exports: Arc::new(saved_media::Exports::default()),
                }),
                reply,
            }).unwrap();
            control.tick(&mut connection, &[0; 32]).unwrap();
            assert_eq!(result.try_recv().unwrap().unwrap().state, "recording");
            control.media(codec, 1060, flags, &received, &events).unwrap();
            control.media(4, 1080, 0, &[0, 0, 1, 0x41, 2], &events).unwrap();
            let file = control.finish_recording().unwrap().unwrap();
            assert_eq!(file.file_name, format!("fixture.{extension}"));
            let bytes = std::fs::read(dir.join(&file.file_name)).unwrap();
            assert!(bytes.windows(tag.len()).any(|window| window == tag));
            assert!(bytes.windows(preroll.len()).any(|window| window == preroll));
            assert!(bytes.windows(received.len()).any(|window| window == received));
            assert!(read.try_recv().is_err());
            std::fs::remove_file(dir.join(file.file_name)).unwrap();
            std::fs::remove_dir(dir).unwrap();
        }
    }
    #[test]
    fn monitor_audio_requires_listen_and_timeout_releases_the_stream() {
        let (requests, rx) = std::sync::mpsc::sync_channel(4);
        let (events, read) = super::super::queue::channel();
        let mut control = Control::new(rx, "chuangmi.camera.81ac1".into());
        let (mut connection, peer) = local();
        let packet = &[0x55, 0x27, 0xc2];
        let key = [0; 32];
        control.media(1027, 100, 0, packet, &events).unwrap();
        assert!(read.try_recv().is_err());

        let listen = |enabled| {
            let (reply, result) = tokio::sync::oneshot::channel();
            requests.send(Request { operation: Operation::Listen { enabled }, recording: None, reply }).unwrap();
            result
        };
        let mut attempt = listen(true);
        control.tick(&mut connection, &key).unwrap();
        control.pending_listen.as_mut().unwrap().start_after = Some(Instant::now());
        control.tick(&mut connection, &key).unwrap();
        let mut command = [0; 256];
        let n = peer.recv(&mut command).unwrap();
        let payload = crypt(&command[24..n], &key, &command[16..24]).unwrap();
        assert_eq!(u32::from_be_bytes(payload[..4].try_into().unwrap()), 0x104);
        peer.set_nonblocking(true).unwrap();
        control.tick(&mut connection, &key).unwrap();
        assert_eq!(peer.recv(&mut command).unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
        control.pending_listen.as_mut().unwrap().deadline = Instant::now() - Duration::from_secs(1);
        control.tick(&mut connection, &key).unwrap();
        assert_eq!(attempt.try_recv().unwrap().err().unwrap().kind, "cameraAudioUnavailable");
        assert!(!control.monitor_protected());
        control.media(1027, 120, 0, packet, &events).unwrap();
        assert!(read.try_recv().is_err());

        let mut attempt = listen(true);
        control.tick(&mut connection, &key).unwrap();
        for _ in 0..64 {
            events.try_send(Event::state("media")).unwrap();
        }
        control.media(1027, 140, 0, packet, &events).unwrap();
        assert!(attempt.try_recv().is_err());
        events.clear_preview();
        control.media(1027, 150, 0, packet, &events).unwrap();
        assert_eq!(attempt.try_recv().unwrap().unwrap().state, "listening");
        let first = read.try_recv().unwrap();
        assert_eq!((first.state, first.codec, first.sample_rate), ("audio", Some("pcma"), Some(8000)));

        let mut muted = listen(false);
        control.tick(&mut connection, &key).unwrap();
        assert_eq!(muted.try_recv().unwrap().unwrap().state, "muted");
        control.media(1027, 160, 0, packet, &events).unwrap();
        assert!(read.try_recv().is_err());
    }
    #[test]
    fn c700_listens_to_negotiated_audio_while_quality_awaits_its_reply() {
        let (requests, rx) = std::sync::mpsc::sync_channel(4);
        let (events, read) = super::super::queue::channel();
        let mut control = Control::new(rx, "chuangmi.camera.81ac1".into());
        let (mut connection, peer) = local();
        let packet = &[0xf8, 0xff, 0xfe];
        let key = [0; 32];
        let (quality, mut quality_result) = tokio::sync::oneshot::channel();
        control.wait(0x10a, "confirmed", quality, 8);
        control.media(1032, 100, 0, packet, &events).unwrap();
        assert!(read.try_recv().is_err());
        let (reply, mut sound_result) = tokio::sync::oneshot::channel();
        requests.send(Request { operation: Operation::Listen { enabled: true }, recording: None, reply }).unwrap();
        control.tick(&mut connection, &key).unwrap();
        assert!(sound_result.try_recv().is_err());
        control.media(1032, 120, 0, packet, &events).unwrap();
        assert_eq!(sound_result.try_recv().unwrap().unwrap().state, "listening");
        assert_eq!(read.try_recv().unwrap().codec, Some("opus"));
        assert!(quality_result.try_recv().is_err());
        control.command_reply(&encoded(0x10a, "{\"code\":0}", &key).unwrap(), &key).unwrap();
        assert_eq!(quality_result.try_recv().unwrap().unwrap().state, "confirmed");
        peer.set_nonblocking(true).unwrap();
        control.tick(&mut connection, &key).unwrap();
        assert_eq!(peer.recv(&mut [0; 256]).unwrap_err().kind(), std::io::ErrorKind::WouldBlock);
    }
    #[test]
    fn monitor_reconciles_latest_visibility_on_the_same_wire_session() {
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        let mut control = Control::new(rx, "xiaomi.camera.069a03".into());
        let preferred = Arc::new(AtomicU8::new(3));
        control.configure_quality(3, Some(preferred.clone()));
        let (mut connection, peer) = local();
        let key = [0; 32];
        let acknowledge = encoded(0x10a, "{\"code\":0}", &key).unwrap();
        let assert_command = |quality| {
            let mut bytes = [0; 2048];
            let n = peer.recv(&mut bytes).unwrap();
            let payload = crypt(&bytes[24..n], &key, &bytes[16..24]).unwrap();
            assert_eq!(u32::from_be_bytes(payload[..4].try_into().unwrap()), 0x109);
            let body: serde_json::Value = serde_json::from_slice(&payload[4..]).unwrap();
            assert_eq!(body["videoquality"], serde_json::json!(quality));
        };
        control.talking = true;
        control.sync_monitor_quality(&mut connection, &key, true, 1).unwrap();
        assert!(control.pending.is_none());
        control.talking = false;
        control.playback_active = true;
        control.sync_monitor_quality(&mut connection, &key, true, 1).unwrap();
        assert!(control.pending.is_none());
        control.playback_active = false;
        control.sync_monitor_quality(&mut connection, &key, true, 1).unwrap();
        assert_command(1);
        for _ in 0..5 {
            control.monitor_visibility_changed();
            control.sync_monitor_quality(&mut connection, &key, false, 1).unwrap();
        }
        control.command_reply(&acknowledge, &key).unwrap();
        assert_eq!(control.measured_quality(true), None);
        assert_eq!(control.measured_quality(false), None);
        assert_eq!(preferred.load(Ordering::Acquire), 3);
        control.sync_monitor_quality(&mut connection, &key, false, 1).unwrap();
        assert_command(3);
        control.command_reply(&acknowledge, &key).unwrap();
        assert_eq!(control.measured_quality(false), Some("uhd"));
        let (reply, mut result) = tokio::sync::oneshot::channel();
        tx.send(Request { operation: Operation::Quality { quality: "auto".into() }, recording: None, reply }).unwrap();
        control.tick(&mut connection, &key).unwrap();
        assert_command(0);
        control.command_reply(&acknowledge, &key).unwrap();
        assert!(result.try_recv().unwrap().is_ok());
        assert_eq!(preferred.load(Ordering::Acquire), 0);
        control.monitor_visibility_changed();
        control.sync_monitor_quality(&mut connection, &key, true, 1).unwrap();
        assert_command(1);
        control.command_reply(&acknowledge, &key).unwrap();
        control.monitor_visibility_changed();
        control.sync_monitor_quality(&mut connection, &key, false, 1).unwrap();
        assert_command(0);
    }
    #[test]
    fn monitor_background_quality_timeout_keeps_the_connection_until_restore() {
        let (_, rx) = std::sync::mpsc::sync_channel(1);
        let mut control = Control::new(rx, "xiaomi.camera.069a03".into());
        control.configure_quality(3, Some(Arc::new(AtomicU8::new(3))));
        let (mut connection, _peer) = local();
        let key = [0;32];
        control.sync_monitor_quality(&mut connection, &key, true, 1).unwrap();
        control.pending.as_mut().unwrap().deadline = Instant::now() - Duration::from_secs(1);
        control.tick(&mut connection, &key).unwrap();
        assert!(control.sync_monitor_quality(&mut connection, &key, true, 1).is_ok());
        assert_eq!(control.sync_monitor_quality(&mut connection, &key, false, 1).unwrap_err().kind, "videoQualityRestore");
    }
    #[test]
    fn speed_change_keeps_playback_session_revision_and_decoder() {
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        let mut control = Control::new(rx, "chuangmi.camera.81ac1".into());
        control.playback_active = true;
        control.playback_id = 17;
        control.stream_revision = 9;
        let (mut connection, peer) = local();
        for speed in [4, 1] {
            let (reply, mut response) = tokio::sync::oneshot::channel();
            tx.send(Request {
                operation: Operation::PlaybackSpeed { speed },
                recording: None,
                reply,
            })
            .unwrap();
            control.tick(&mut connection, &[0; 32]).unwrap();
            let result = response.try_recv().unwrap().unwrap();
            assert_eq!(result.state, "speed-set");
            assert_eq!(result.stream_revision, 9);
            assert_eq!(control.playback_id, 17);
            assert!(!control.take_media_reset());
            let mut bytes = [0; 2048];
            let n = peer.recv(&mut bytes).unwrap();
            let payload = crypt(&bytes[24..n], &[0; 32], &bytes[16..24]).unwrap();
            assert_eq!(u32::from_be_bytes(payload[..4].try_into().unwrap()), 0x10f);
            let body: serde_json::Value = serde_json::from_slice(&payload[4..]).unwrap();
            assert_eq!(body, serde_json::json!({"sessionid":17,"speed":speed}));
        }
    }
    #[test]
    fn speed_change_rejects_unknown_rates_without_stopping_worker() {
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        let mut control = Control::new(rx, "chuangmi.camera.81ac1".into());
        let (mut connection, peer) = local();
        for (active, speed) in [(false, 4), (true, 2)] {
            control.playback_active = active;
            let (reply, mut response) = tokio::sync::oneshot::channel();
            tx.send(Request {
                operation: Operation::PlaybackSpeed { speed },
                recording: None,
                reply,
            })
            .unwrap();
            control.tick(&mut connection, &[0; 32]).unwrap();
            assert!(response.try_recv().unwrap().is_err());
            assert!(!control.take_media_reset());
            assert!(peer.recv(&mut [0; 2048]).is_err());
        }
    }
    #[test]
    fn factory_quality_and_talk_profiles_match_original_bindings() {
        for m in ["xiaomi.camera.c302", "xiaomi.camera.069a03"] {
            let f = features(m);
            assert!(f.talk && f.ptz && f.care);
            assert_eq!(f.talk_format.unwrap().codec, "opus");
        }
        assert_eq!(quality_value("xiaomi.camera.c302", "hd").unwrap(), 3);
        assert_eq!(quality_value("xiaomi.camera.069a03", "hd").unwrap(), 2);
        assert_eq!(quality_value("xiaomi.camera.069a03", "uhd").unwrap(), 3);
    }
    #[test]
    fn each_enabled_talk_profile_builds_the_correct_codec_and_rate_header() {
        let registry: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/camera-profiles.json")).unwrap();
        for p in registry["media"].as_array().unwrap() {
            let model = p["models"][0].as_str().unwrap();
            let Some(f) = features(model).talk_format else {
                continue;
            };
            let (_, rx) = std::sync::mpsc::sync_channel(1);
            let mut c = Control::new(rx, model.into());
            c.talking = true;
            let (mut connection, peer) = local();
            c.send_microphone(&mut connection, &[0; 32], &[1, 2, 3])
                .unwrap();
            let mut wire = [0; 2048];
            let n = peer.recv(&mut wire).unwrap();
            assert!(n > 40);
            assert_eq!(wire[5], 3);
            assert_eq!(
                u32::from_le_bytes(wire[16..20].try_into().unwrap()),
                if f.codec == "opus" { 1032 } else { 1027 }
            );
            // All enabled profiles use the primary audio lane. The verified
            // sender does not encode the sample rate as a guessed flags bit.
            assert_eq!(u32::from_le_bytes(wire[24..28].try_into().unwrap()), 0);
        }
    }
    #[test]
    fn a_late_quality_ack_cannot_confirm_a_new_choice_after_timeout() {
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        let mut c = Control::new(rx, "xiaomi.camera.c302".into());
        let (mut conn, _peer) = local();
        let (reply, mut result) = tokio::sync::oneshot::channel();
        c.wait(0x10a, "confirmed", reply, 8);
        c.pending.as_mut().unwrap().deadline = Instant::now() - Duration::from_secs(1);
        c.tick(&mut conn, &[0; 32]).unwrap();
        assert_eq!(
            result.try_recv().unwrap().err().unwrap().kind,
            "cameraQualityUncertain"
        );
        let (reply, mut result) = tokio::sync::oneshot::channel();
        tx.try_send(Request {
            operation: Operation::Quality {
                quality: "hd".into(),
            },
            recording: None,
            reply,
        })
        .unwrap();
        c.tick(&mut conn, &[0; 32]).unwrap();
        assert_eq!(
            result.try_recv().unwrap().err().unwrap().kind,
            "cameraQualityUncertain"
        );
        c.command_reply(&encoded(0x10a, "{\"code\":0}", &[0; 32]).unwrap(), &[0; 32])
            .unwrap();
        assert!(c.pending.is_none());
    }
    #[test]
    fn private_features_are_not_enabled_by_category_or_brand_name() {
        let known = features("chuangmi.camera.81ac1");
        assert!(known.ptz && known.talk && known.playback);
        assert_eq!(known.talk_format.unwrap().sample_rate, 16000);
        for model in [
            "fixture.camera.other",
            "chuangmi.camera.other",
            "lumi.camera.aq1",
        ] {
            let f = features(model);
            assert!(!f.ptz && !f.talk && !f.playback);
        }
    }
    #[test]
    fn every_card_profile_builds_its_original_wire_and_preserves_lens_identity() {
        let registry: serde_json::Value =
            serde_json::from_str(include_str!("../../../src/camera-profiles.json")).unwrap();
        let key = [7; 32];
        for p in registry["sd"].as_array().unwrap() {
            for m in p["models"].as_array().unwrap() {
                let model = m.as_str().unwrap();
                assert!(features(model).playback);
                let channels = p["channels"].as_array().unwrap();
                let (_tx, rx) = std::sync::mpsc::sync_channel(1);
                let mut control = Control::new(rx, model.into());
                let (reply, mut result) = tokio::sync::oneshot::channel();
                control.wait(INDEX, "recordings", reply, 25);
                control.index_dual = channels.len() == 2;
                for channel in channels {
                    let channel = channel.as_u64().unwrap() as u32;
                    let packet = index_request(model, channel, &key).unwrap();
                    let plain = crypt(&packet[8..], &key, &packet[..8]).unwrap();
                    assert_eq!(plain.len(), p["indexBytes"].as_u64().unwrap() as usize);
                    assert_eq!(u32::from_le_bytes(plain[..4].try_into().unwrap()), 6);
                    assert_eq!(
                        u32::from_le_bytes(plain[4..8].try_into().unwrap()),
                        p["indexDeclared"].as_u64().unwrap() as u32
                    );
                    if plain.len() >= 20 {
                        assert_eq!(
                            u32::from_le_bytes(plain[16..20].try_into().unwrap()),
                            channel
                        );
                    }
                    let mut body = vec![0; 4];
                    body.extend(1792212500u32.to_le_bytes());
                    body.extend([0, 1, 1, 0]);
                    let mut wire = 6u32.to_le_bytes().to_vec();
                    wire.extend(8u32.to_le_bytes());
                    wire.extend(body);
                    let mut response = vec![3; 8];
                    response.extend(crypt(&wire, &key, &response).unwrap());
                    control.rdt_reply(&response, &key).unwrap();
                    let playback =
                        playback_body(model, 100, (1792212500, 1792212560, 12, 4, channel), false);
                    assert_eq!(playback["autoswitchtolive"], 0);
                    if p["arrayPlayback"] == true {
                        assert_eq!(playback["channel"], serde_json::json!([channel]));
                        assert_eq!(playback["speed"], serde_json::json!([4]));
                    } else {
                        assert!(playback.get("channel").is_none());
                        assert_eq!(playback["offset"], 12);
                    }
                }
                let clips = result.try_recv().unwrap().unwrap().clips.unwrap();
                assert_eq!(clips.len(), channels.len());
                for (clip, channel) in clips.iter().zip(channels) {
                    assert_eq!(clip.channel, channel.as_u64().unwrap() as u32);
                    assert_eq!(clip.duration, 60);
                    assert!(clip.event);
                }
            }
        }
    }
    #[test]
    fn dual_index_keeps_confirmed_lens_when_other_lens_times_out() {
        let (_tx, rx) = std::sync::mpsc::sync_channel(1);
        let mut c = Control::new(rx, "xiaomi.camera.082ac1".into());
        let (reply, mut result) = tokio::sync::oneshot::channel();
        c.wait(INDEX, "recordings", reply, 1);
        c.index_dual = true;
        c.index_channel = 10;
        c.index_ok = true;
        c.clips.push(rdt::Clip {
            start: 1792212500,
            duration: 60,
            event: false,
            channel: 0,
        });
        c.pending.as_mut().unwrap().deadline = Instant::now() - Duration::from_secs(1);
        let (mut connection, _peer) = local();
        c.tick(&mut connection, &[7; 32]).unwrap();
        let clips = result.try_recv().unwrap().unwrap().clips.unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].channel, 0);
        let (reply, mut result) = tokio::sync::oneshot::channel();
        c.wait(INDEX, "recordings", reply, 1);
        c.index_ok = false;
        c.pending.as_mut().unwrap().deadline = Instant::now() - Duration::from_secs(1);
        c.tick(&mut connection, &[7; 32]).unwrap();
        assert!(result.try_recv().unwrap().is_err());
    }
    #[test]
    fn installed_standard_and_dual_cameras_have_independent_card_support() {
        for model in [
            "xiaomi.camera.c302",
            "xiaomi.camera.069a03",
            "xiaomi.camera.hl4g",
        ] {
            let f = features(model);
            assert!(f.playback);
            assert_eq!(
                f.talk,
                super::super::profiles::media(model).is_some_and(|p| p.talk.is_some())
            );
            assert_eq!(
                f.ptz,
                super::super::profiles::media(model).is_some_and(|p| p.ptz)
            );
        }
        let single = playback_body("xiaomi.camera.c302", 7, (100, 160, 12, 1, 0), false);
        assert_eq!(single["starttime"], 100);
        assert!(single.get("channel").is_none());
        let dual = playback_body("xiaomi.camera.hl4g", 8, (100, 160, 12, 1, 10), false);
        assert_eq!(dual["starttime"], serde_json::json!([100]));
        assert_eq!(dual["channel"], serde_json::json!([10]));
        assert_eq!(dual["offset"], serde_json::json!([12]));
        let live = playback_body("xiaomi.camera.hl4g", 9, (0, 0, 0, 1, 0), true);
        assert_eq!(live["autoswitchtolive"], 1);
        assert!(serde_json::from_value::<Operation>(
            serde_json::json!({"kind":"indexChannel","channel":10})
        )
        .is_err());
    }
    #[test]
    fn dual_camera_reads_second_lens_after_first_lens_reports_unavailable() {
        let (_tx, rx) = std::sync::mpsc::sync_channel(1);
        let mut c = Control::new(rx, "xiaomi.camera.hl4g".into());
        let (reply, mut result) = tokio::sync::oneshot::channel();
        c.wait(INDEX, "recordings", reply, 25);
        c.index_dual = true;
        let key = [8; 32];
        let packet = |body: Vec<u8>| {
            let mut plain = 6u32.to_le_bytes().to_vec();
            plain.extend(((body.len() - 4) as u32).to_le_bytes());
            plain.extend(body);
            let mut out = vec![3; 8];
            out.extend(crypt(&plain, &key, &out).unwrap());
            out
        };
        c.rdt_reply(&packet(vec![1, 0, 0, 0]), &key).unwrap();
        assert!(c.index_next);
        assert_eq!(c.index_channel, 10);
        assert!(result.try_recv().is_err());
        let mut body = vec![0; 4];
        body.extend(1792212500u32.to_le_bytes());
        body.extend([60, 1, 1, 0]);
        c.rdt_reply(&packet(body), &key).unwrap();
        let clips = result.try_recv().unwrap().unwrap().clips.unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].channel, 10);
        assert!(clips[0].event);
    }
    #[test]
    fn rejects_unknown_directions_without_sending_network_commands() {
        let (tx, rx) = std::sync::mpsc::sync_channel(4);
        let mut controls = Control::new(rx, "chuangmi.camera.81ac1".into());
        let (mut connection, peer) = local();
        let (reply, mut response) = tokio::sync::oneshot::channel();
        tx.send(Request {
            operation: Operation::Ptz {
                direction: "format".into(),
            },
            recording: None,
            reply,
        })
        .unwrap();
        controls.tick(&mut connection, &[0; 32]).unwrap();
        assert!(response.try_recv().unwrap().is_err());
        assert!(peer.recv(&mut [0; 2048]).is_err());
    }
    #[test]
    fn speaker_packets_require_a_live_talk_lease_and_use_channel_three() {
        let (_, rx) = std::sync::mpsc::sync_channel(4);
        let mut controls = Control::new(rx, "chuangmi.camera.81ac1".into());
        let (mut connection, peer) = local();
        assert!(controls
            .send_microphone(&mut connection, &[0; 32], &[1, 2, 3])
            .is_err());
        let (reply, mut result) = tokio::sync::oneshot::channel();
        controls.wait(0x107, "talking", reply, 8);
        let accepted = [0, 0, 1, 7, 0, 0, 0, 0];
        controls.command_reply(&accepted, &[0; 32]).unwrap();
        assert_eq!(result.try_recv().unwrap().unwrap().talk_revision, Some(1));
        assert_eq!(controls.talk_revision(), 1);
        controls
            .send_microphone(&mut connection, &[0; 32], &[1, 2, 3])
            .unwrap();
        let mut b = [0u8; 2048];
        let n = peer.recv(&mut b).unwrap();
        assert_eq!(b[5], 3);
        assert_eq!(u32::from_le_bytes(b[16..20].try_into().unwrap()), 1032);
        assert_eq!(crypt(&b[52..n], &[0; 32], &b[44..52]).unwrap(), [1, 2, 3]);
        assert!(controls
            .send_microphone(&mut connection, &[0; 32], &[0; 1276])
            .is_err());
        controls.talking = false;
        let (reply, mut result) = tokio::sync::oneshot::channel();
        controls.wait(0x107, "talking", reply, 8);
        controls.command_reply(&accepted, &[0; 32]).unwrap();
        assert_eq!(result.try_recv().unwrap().unwrap().talk_revision, Some(2));
    }
    #[test]
    fn quality_requires_the_correct_explicit_acknowledgement() {
        let (_, rx) = std::sync::mpsc::sync_channel(4);
        let mut controls = Control::new(rx, "fixture.camera".into());
        let (tx, mut result) = tokio::sync::oneshot::channel();
        controls.wait(0x10a, "confirmed", tx, 8);
        controls
            .command_reply(&encoded(0x113, "{\"code\":0}", &[0; 32]).unwrap(), &[0; 32])
            .unwrap();
        assert!(result.try_recv().is_err());
        controls
            .command_reply(&encoded(0x10a, "{\"code\":0}", &[0; 32]).unwrap(), &[0; 32])
            .unwrap();
        assert_eq!(result.try_recv().unwrap().unwrap().state, "confirmed");
    }
    #[test]
    fn ipc_deserialization_cannot_create_internal_microphone_packets() {
        assert!(serde_json::from_value::<Operation>(
            serde_json::json!({"kind":"microphone","packet":[1,2,3]})
        )
        .is_err());
        assert!(serde_json::from_value::<Operation>(
            serde_json::json!({"kind":"ptz","direction":"up","url":"https://example.com"})
        )
        .is_err());
    }
    #[test]
    fn replay_speed_defaults_to_normal_and_rejects_unobserved_rates() {
        let op: Operation = serde_json::from_value(serde_json::json!({
            "kind":"playback","start":1,"channel":0
        }))
        .unwrap();
        assert!(matches!(op, Operation::Playback { speed: 1, .. }));
        for speed in [1, 4] {
            assert_eq!(validate_playback_speed(speed).unwrap(), speed);
        }
        for speed in [0, 2, 8, 16, 17, u32::MAX] {
            assert!(validate_playback_speed(speed).is_err());
        }
    }
    #[test]
    fn accepts_camera_nul_padding_but_not_embedded_or_other_trailing_data() {
        for (body, accepted) in [
            ("{\"code\":0}\0\0\r\n", true),
            ("{\"code\":0}\0garbage", false),
            ("{\"co\0de\":0}", false),
        ] {
            let (_, rx) = std::sync::mpsc::sync_channel(4);
            let mut controls = Control::new(rx, "chuangmi.camera.81ac1".into());
            let (tx, mut reply) = tokio::sync::oneshot::channel();
            controls.wait(0x10a, "confirmed", tx, 8);
            controls
                .command_reply(&encoded(0x10a, body, &[0; 32]).unwrap(), &[0; 32])
                .unwrap();
            assert_eq!(reply.try_recv().unwrap().is_ok(), accepted);
        }
    }
    #[test]
    fn binary_quality_status_is_exact_and_not_a_media_boundary() {
        for (status, accepted) in [([0; 4], true), ([1, 0, 0, 0], false), ([0, 0, 0, 1], false)] {
            let (_, rx) = std::sync::mpsc::sync_channel(4);
            let mut controls = Control::new(rx, "chuangmi.camera.81ac1".into());
            let (tx, mut reply) = tokio::sync::oneshot::channel();
            controls.wait(0x10a, "confirmed", tx, 8);
            let mut data = 0x10au32.to_be_bytes().to_vec();
            data.extend(status);
            controls.command_reply(&data, &[0; 32]).unwrap();
            assert_eq!(reply.try_recv().unwrap().is_ok(), accepted);
            assert!(!controls.take_media_reset());
            assert_eq!(controls.stream_revision(), 0);
        }
    }
}
