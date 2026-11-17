//! Bounded compressed preroll for selecting what was displayed, not IPC read-ahead.
use super::{err, mp4, Result};
use std::collections::{BTreeMap, VecDeque};
struct Frame {
    codec: u32,
    time: u64,
    lens: u8,
    payload: Vec<u8>,
    key: bool,
}
#[derive(Default)]
pub struct Cache {
    frames: VecDeque<Frame>,
    bytes: usize,
    parameters: BTreeMap<u8, mp4::Parameters>,
}
impl Cache {
    pub fn clear(&mut self) {
        *self = Self::default();
    }
    pub fn push(&mut self, codec: u32, time: u64, lens: u8, payload: &[u8], playback: bool) {
        let video = matches!(codec, 4 | 5);
        let key = video
            && mp4::annex_b(payload).iter().any(|n| {
                if codec == 4 {
                    n[0] & 31 == 5
                } else {
                    matches!((n[0] >> 1) & 63, 16..=21)
                }
            });
        let payload = if video {
            let p = self.parameters.entry(lens).or_default();
            p.observe(codec, payload);
            if key {
                p.with_parameters(payload)
            } else {
                payload.to_vec()
            }
        } else {
            payload.to_vec()
        };
        let limit = if playback {
            24 * 1024 * 1024
        } else {
            8 * 1024 * 1024
        };
        let age = if playback { 64000 } else { 6000 };
        if payload.len() > limit {
            return;
        }
        self.bytes += payload.len();
        self.frames.push_back(Frame {
            codec,
            time,
            lens,
            payload,
            key,
        });
        while self.bytes > limit
            || self
                .frames
                .front()
                .is_some_and(|f| time.saturating_sub(f.time) > age)
        {
            if let Some(f) = self.frames.pop_front() {
                self.bytes = self.bytes.saturating_sub(f.payload.len());
            } else {
                break;
            }
        }
    }
    pub fn seed(&self, recorder: &mut mp4::Recorder, lens: u8, at: Option<u64>) -> Result<()> {
        if let Some(p) = self.parameters.get(&lens) {
            recorder.seed_parameters(p);
        }
        let Some(at) = at else {
            return Ok(());
        };
        let start = self
            .frames
            .iter()
            .rposition(|f| f.lens == lens && f.key && f.time <= at)
            .ok_or_else(|| {
                err(
                    "recordingFrameUnavailable",
                    "当前播放位置的关键帧尚未准备好，请稍后再录制。",
                )
            })?;
        if !self
            .frames
            .iter()
            .any(|f| f.lens == lens && matches!(f.codec, 4 | 5) && f.time >= at)
        {
            return Err(err(
                "recordingFrameUnavailable",
                "尚未收到当前播放位置的视频。",
            ));
        }
        recorder.select_start(at);
        for f in self.frames.iter().skip(start) {
            if !matches!(f.codec, 4 | 5) || f.lens == lens {
                recorder
                    .push(f.codec, f.time, &f.payload)
                    .map_err(|error| {
                        if error.kind == "recordingCodecChanged" {
                            err(
                                "recordingFrameUnavailable",
                                "回看缓冲的编码发生变化，请重新定位后再录制。 ",
                            )
                        } else {
                            error
                        }
                    })?;
            }
        }
        Ok(())
    }
}
