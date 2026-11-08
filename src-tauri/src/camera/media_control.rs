use super::{crypt, encoded, err, mp4, rdt, saved_media, transport, AppError, Event, Result};
use serde::{Deserialize, Serialize};
use std::{
    path::PathBuf,
    sync::{mpsc::Receiver, Arc},
    time::{Duration, Instant},
};
#[derive(Serialize, Clone)]
pub struct Quality {
    pub id: &'static str,
    pub label: &'static str,
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
pub fn quality_value(model: &str, quality: &str) -> Result<u8> {
    if let Some(p) = super::profiles::media(model) {
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
pub fn features(model: &str) -> Features {
    let profile = super::profiles::media(model);
    let card_playback = super::profiles::sd(model).is_some();
    Features {
        qualities: profile
            .map(|p| {
                p.qualities
                    .iter()
                    .map(|q| Quality {
                        id: q.id.as_str(),
                        label: q.label.as_str(),
                    })
                    .collect()
            })
            .unwrap_or_else(|| {
                vec![
                    Quality {
                        id: "auto",
                        label: "自动",
                    },
                    Quality {
                        id: "sd",
                        label: "流畅",
                    },
                    Quality {
                        id: "hd",
                        label: "高清",
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
#[derive(Deserialize, Clone)]
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
}
const INDEX: u32 = 0x60000000;
const LIVE_FRAME: u32 = 0xffffffff;
pub struct Control {
    requests: Receiver<Request>,
    pending: Option<Pending>,
    listen: bool,
    recording: Option<(mp4::Recorder, RecordSettings, u8)>,
    model: String,
    rdt: rdt::Assembler,
    index_channel: u32,
    index_dual: bool,
    index_next: bool,
    index_ok: bool,
    index_error: Option<AppError>,
    clips: Vec<rdt::Clip>,
    talking: bool,
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
    playback_lens: Option<u8>,
    last_audio: Option<(u32, u64, u8, u64)>,
    previous_playback: Option<(Option<u8>, bool)>,
    record_cache: super::record_cache::Cache,
}
impl Control {
    pub fn take_media_reset(&mut self) -> bool {
        if self.reset_media {
            self.last_audio = None;
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
    pub fn new(requests: Receiver<Request>, model: String) -> Self {
        Self {
            requests,
            pending: None,
            listen: false,
            recording: None,
            model,
            rdt: rdt::Assembler::default(),
            index_channel: 0,
            index_dual: false,
            index_next: false,
            index_ok: false,
            index_error: None,
            clips: vec![],
            talking: false,
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
            playback_lens: None,
            last_audio: None,
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
        });
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
                    }
                    if matches!(p.expected, 0x10e | LIVE_FRAME) {
                        self.rollback_playback();
                    }
                    let _ = p.reply.send(Err(if p.expected == 0x10a {
                        err(
                            "cameraQualityUncertain",
                            "画质确认超时，需要重新连接此摄像头。",
                        )
                    } else {
                        err("cameraOperationTimeout", "摄像机未确认此项操作。")
                    }));
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
            if self.pending.is_some() && !matches!(request.operation, Operation::Microphone { .. })
            {
                let _ = request
                    .reply
                    .send(Err(err("cameraBusy", "正在等待上一项操作确认。")));
                continue;
            }
            let caps = features(&self.model);
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
                        let n = match quality_value(&self.model, &quality) {
                            Ok(value) => value,
                            Err(error) => {
                                let _ = request.reply.send(Err(error));
                                continue;
                            }
                        };
                        c.control_command(&encoded(
                            0x109,
                            &super::profiles::quality_body(&self.model, n).to_string(),
                            key,
                        )?)?;
                        self.wait(0x10a, "confirmed", request.reply, 8);
                        continue;
                    }
                }
                Operation::Listen { enabled } => {
                    self.listen = enabled;
                    if enabled {
                        c.control_command(&encoded(0x104, "", key)?)?;
                        self.wait(0, "listening", request.reply, 8);
                        continue;
                    }
                    Ok(Reply {
                        state: "muted",
                        ..Reply::default()
                    })
                }
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
                                self.recording = Some((recorder, settings, lens));
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
            .is_some_and(|p| p.expected != 0 && p.expected == cmd)
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
            // Quality acknowledgement is not a media boundary. The worker
            // advances the revision once the actual codec parameters change.
            let _ = p.reply.send(if success {
                Ok(Reply {
                    state: p.state,
                    stream_revision: self.stream_revision,
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
        let format = features(&self.model)
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
            && mp4::annex_b(payload).iter().any(|n| {
                if codec == 4 {
                    n[0] & 31 == 5
                } else {
                    matches!((n[0] >> 1) & 63, 16..=21)
                }
            })
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
        let lens_id = self.video_lens(flags);
        let video = matches!(codec, 4 | 5);
        if !video {
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
        }
        if video {
            if let Some(lens) = lens_id {
                self.record_cache
                    .push(codec, time, lens, payload, self.playback_active);
            }
        } else if codec == 1032 {
            self.record_cache
                .push(codec, time, 0, payload, self.playback_active);
        }
        if let Some((recorder, _, selected)) = &mut self.recording {
            let result = if !video || lens_id == Some(*selected) {
                recorder.push(codec, time, payload)
            } else {
                Ok(())
            };
            if let Err(error) = result {
                let file = self.finish_recording().ok().flatten();
                let _ = tx.try_send(Event {
                    receive_bytes_per_second: None,
                    lens_id: None,
                    media_generation: self.stream_revision,
                    keyframe: None,
                    stream_revision: self.stream_revision,
                    state: "operation-error",
                    data: None,
                    codec: None,
                    error: Some(error),
                    sample_rate: None,
                    timestamp: None,
                    file,
                });
            }
        }
        let name = match codec {
            1032 => "opus",
            1024 => "pcm",
            1026 => "pcmu",
            1027 => "pcma",
            _ => return Ok(()),
        };
        if self.listen {
            if self.pending.as_ref().is_some_and(|p| p.expected == 0) {
                let p = self.pending.take().unwrap();
                let _ = p.reply.send(Ok(Reply {
                    state: "listening",
                    ..Reply::default()
                }));
            }
            use base64::Engine;
            tx.try_send(Event {
                receive_bytes_per_second: None,
                lens_id: None,
                media_generation: self.stream_revision,
                keyframe: None,
                stream_revision: self.stream_revision,
                state: "audio",
                data: Some(base64::engine::general_purpose::STANDARD.encode(payload)),
                codec: Some(name),
                error: None,
                sample_rate: Some(if codec == 1032 || (flags >> 3) & 15 != 0 {
                    16000
                } else {
                    8000
                }),
                timestamp: Some(time),
                file: None,
            })
            .map_err(|_| err("videoBackpressure", "音视频读取未及时完成。"))?;
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
            assert_eq!(
                u32::from_le_bytes(wire[24..28].try_into().unwrap()),
                if f.sample_rate == 16000 { 8 } else { 0 }
            );
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
        controls.talking = true;
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
