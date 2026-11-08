//! Native MP4 remuxing. Compressed video/Opus stay in their original encoding.
use super::{err, Result};
use std::{
    fs::{File, OpenOptions},
    io::{Seek, SeekFrom, Write},
    path::{Path, PathBuf},
};
fn bx(kind: &[u8; 4], data: Vec<u8>) -> Vec<u8> {
    let mut out = ((data.len() + 8) as u32).to_be_bytes().to_vec();
    out.extend(kind);
    out.extend(data);
    out
}
fn full(kind: &[u8; 4], flags: u32, data: Vec<u8>) -> Vec<u8> {
    let mut d = flags.to_be_bytes().to_vec();
    d.extend(data);
    bx(kind, d)
}
fn u32s(v: &[u32]) -> Vec<u8> {
    v.iter().flat_map(|v| v.to_be_bytes()).collect()
}
fn matrix() -> Vec<u8> {
    u32s(&[0x10000, 0, 0, 0, 0x10000, 0, 0, 0, 0x40000000])
}
fn join(v: Vec<Vec<u8>>) -> Vec<u8> {
    v.into_iter().flatten().collect()
}
pub fn annex_b(data: &[u8]) -> Vec<&[u8]> {
    let mut starts = Vec::new();
    let mut i = 0;
    while i + 3 <= data.len() {
        let n = if data[i..].starts_with(&[0, 0, 0, 1]) {
            4
        } else if data[i..].starts_with(&[0, 0, 1]) {
            3
        } else {
            i += 1;
            continue;
        };
        starts.push((i, i + n));
        i += n;
    }
    starts
        .iter()
        .enumerate()
        .filter_map(|(n, (_, from))| {
            let end = starts.get(n + 1).map(|v| v.0).unwrap_or(data.len());
            (end > *from).then_some(&data[*from..end])
        })
        .collect()
}
#[derive(Default, Clone, PartialEq, Eq)]
pub struct Parameters {
    codec: u32,
    vps: Vec<u8>,
    sps: Vec<u8>,
    pps: Vec<u8>,
}
impl Parameters {
    /// A decoder initialized with old SPS dimensions can crop a new adaptive
    /// resolution. Only completed parameter sets establish the initial format.
    pub fn with_parameters(&self, data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        for n in [&self.vps, &self.sps, &self.pps] {
            if !n.is_empty() {
                out.extend_from_slice(&[0, 0, 0, 1]);
                out.extend_from_slice(n);
            }
        }
        out.extend_from_slice(data);
        out
    }
    pub fn observe_change(&mut self, codec: u32, data: &[u8]) -> bool {
        let established = !self.sps.is_empty()
            && !self.pps.is_empty()
            && (self.codec == 4 || !self.vps.is_empty());
        let before = self.clone();
        self.observe(codec, data);
        established && *self != before
    }
    pub fn observe(&mut self, codec: u32, data: &[u8]) {
        if self.codec != codec {
            *self = Self {
                codec,
                ..Self::default()
            };
        }
        for n in annex_b(data) {
            let t = if codec == 4 {
                n[0] & 31
            } else {
                (n[0] >> 1) & 63
            };
            match (codec, t) {
                (4, 7) | (5, 33) => self.sps = n.to_vec(),
                (4, 8) | (5, 34) => self.pps = n.to_vec(),
                (5, 32) => self.vps = n.to_vec(),
                _ => {}
            }
        }
    }
    fn config(&self) -> Result<Vec<u8>> {
        if self.sps.is_empty()
            || self.pps.is_empty()
            || self.sps.len() > 65535
            || self.pps.len() > 65535
        {
            return Err(err("recordingParameters", "录像尚未收到完整编码参数。"));
        }
        if self.codec == 4 {
            if self.sps.len() < 4 {
                return Err(super::AppError::protocol());
            }
            let mut c = vec![1, self.sps[1], self.sps[2], self.sps[3], 0xff, 0xe1];
            c.extend((self.sps.len() as u16).to_be_bytes());
            c.extend(&self.sps);
            c.push(1);
            c.extend((self.pps.len() as u16).to_be_bytes());
            c.extend(&self.pps);
            return Ok(bx(b"avcC", c));
        }
        if self.codec != 5 || self.sps.len() < 16 || self.vps.is_empty() {
            return Err(err(
                "recordingParameters",
                "录像尚未收到完整 HEVC 编码参数。",
            ));
        }
        let raw = unescape(&self.sps[2..]);
        if raw.len() < 13 {
            return Err(super::AppError::protocol());
        }
        let layers = (raw[0] >> 1) & 7;
        let nested = raw[0] & 1;
        let mut bits = Bits {
            data: &raw,
            at: 104,
        };
        let mut profile = [false; 8];
        let mut level = [false; 8];
        for n in 0..layers as usize {
            profile[n] = bits.take(1)? != 0;
            level[n] = bits.take(1)? != 0;
        }
        if layers > 0 {
            bits.take((8 - layers as usize) * 2)?;
        }
        for n in 0..layers as usize {
            if profile[n] {
                bits.take(88)?;
            }
            if level[n] {
                bits.take(8)?;
            }
        }
        bits.ue()?;
        let chroma = bits.ue()?;
        if chroma > 3 {
            return Err(super::AppError::protocol());
        }
        if chroma == 3 {
            bits.take(1)?;
        }
        bits.ue()?;
        bits.ue()?;
        if bits.take(1)? != 0 {
            for _ in 0..4 {
                bits.ue()?;
            }
        }
        let luma = bits.ue()?;
        let chroma_depth = bits.ue()?;
        if luma > 7 || chroma_depth > 7 {
            return Err(super::AppError::protocol());
        }
        let mut c = vec![1];
        c.extend(&raw[1..13]);
        c.extend([
            0xf0,
            0,
            0xfc,
            0xfc | chroma as u8,
            0xf8 | luma as u8,
            0xf8 | chroma_depth as u8,
            0,
            0,
            ((layers + 1) << 3) | (nested << 2) | 3,
            3,
        ]);
        for (t, n) in [(32, &self.vps), (33, &self.sps), (34, &self.pps)] {
            if n.len() > 65535 {
                return Err(super::AppError::protocol());
            }
            c.push(0x80 | t);
            c.extend(1u16.to_be_bytes());
            c.extend((n.len() as u16).to_be_bytes());
            c.extend(n);
        }
        Ok(bx(b"hvcC", c))
    }
}
fn unescape(n: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    for (i, b) in n.iter().enumerate() {
        if *b == 3 && i >= 2 && n[i - 2..i] == [0, 0] {
            continue;
        }
        out.push(*b);
    }
    out
}
struct Bits<'a> {
    data: &'a [u8],
    at: usize,
}
impl Bits<'_> {
    fn take(&mut self, n: usize) -> Result<u32> {
        if self.at + n > self.data.len() * 8 {
            return Err(super::AppError::protocol());
        }
        let mut v = 0;
        for _ in 0..n {
            v = (v << 1) | ((self.data[self.at / 8] >> (7 - self.at % 8)) & 1) as u32;
            self.at += 1;
        }
        Ok(v)
    }
    fn ue(&mut self) -> Result<u32> {
        let mut zeros = 0;
        while self.take(1)? == 0 {
            zeros += 1;
            if zeros > 30 {
                return Err(super::AppError::protocol());
            }
        }
        Ok(((1u32 << zeros) - 1) + self.take(zeros)?)
    }
}
struct Sample {
    offset: u64,
    size: u32,
    time: u64,
    key: bool,
}
struct Track {
    samples: Vec<Sample>,
    scale: u32,
    codec: u32,
}
impl Track {
    fn step(&self) -> u64 {
        self.samples
            .iter()
            .rev()
            .nth(1)
            .zip(self.samples.last())
            .map(|(a, b)| {
                b.time
                    .saturating_sub(a.time)
                    .clamp(1, self.scale as u64 * 60)
            })
            .unwrap_or(if self.scale == 1000 { 50 } else { 960 })
    }
    fn duration(&self) -> u64 {
        self.samples
            .last()
            .map(|v| v.time.saturating_sub(self.samples[0].time) + self.step())
            .unwrap_or(0)
    }
    fn milliseconds(&self) -> u64 {
        self.duration() * 1000 / self.scale as u64
    }
}
pub struct Recorder {
    file: File,
    path: PathBuf,
    final_path: PathBuf,
    mdat: u64,
    video: Track,
    audio: Track,
    parameters: Parameters,
    width: u16,
    height: u16,
    finished: bool,
    bytes: u64,
    selected_start: Option<u64>,
    selected_end: Option<u64>,
}
impl Recorder {
    pub fn new(destination: &Path, width: u32, height: u32) -> Result<Self> {
        if !(1..=8192).contains(&width) || !(1..=8192).contains(&height) {
            return Err(super::AppError::invalid("录像画面尺寸无效。"));
        }
        super::save_dialog::Kind::Recording.validate(destination)?;
        let final_path = destination.to_path_buf();
        let path = super::saved_media::staging_path(destination);
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&path)
            .map_err(|_| err("mediaSaveFailed", "无法保存录像。"))?;
        let ftyp = bx(
            b"ftyp",
            [b"isom".as_slice(), &512u32.to_be_bytes(), b"isomiso2mp41"].concat(),
        );
        file.write_all(&ftyp)
            .map_err(|_| err("mediaSaveFailed", "录像写入失败。"))?;
        let mdat = ftyp.len() as u64;
        file.write_all(&[&1u32.to_be_bytes()[..], b"mdat", &0u64.to_be_bytes()].concat())
            .map_err(|_| err("mediaSaveFailed", "录像写入失败。"))?;
        Ok(Self {
            file,
            path,
            final_path,
            mdat,
            video: Track {
                samples: vec![],
                scale: 1000,
                codec: 0,
            },
            audio: Track {
                samples: vec![],
                scale: 48000,
                codec: 1032,
            },
            parameters: Parameters::default(),
            width: width as u16,
            height: height as u16,
            finished: false,
            bytes: mdat + 16,
            selected_start: None,
            selected_end: None,
        })
    }
    pub fn seed_parameters(&mut self, parameters: &Parameters) {
        self.parameters = parameters.clone();
    }
    pub fn select_start(&mut self, time: u64) {
        self.selected_start = Some(time);
    }
    pub fn select_end(&mut self, time: u64) {
        self.selected_end = Some(time);
    }
    fn selection(&self) -> (u64, u64) {
        let first = self.video.samples.first().map_or(0, |s| s.time);
        let end = first + self.video.milliseconds();
        (
            self.selected_start.unwrap_or(first).max(first),
            self.selected_end.unwrap_or(end).min(end),
        )
    }
    pub fn push(&mut self, codec: u32, time: u64, payload: &[u8]) -> Result<()> {
        if self.bytes > 4 * 1024 * 1024 * 1024 || self.video.samples.len() > 20 * 60 * 60 {
            return Err(err("recordingLimit", "单次录像已达到一小时或 4GB 限制。"));
        }
        if matches!(codec, 4 | 5) {
            let previous = self.parameters.clone();
            self.parameters.observe(codec, payload);
            if !self.video.samples.is_empty()
                && previous.config().ok() != self.parameters.config().ok()
            {
                self.parameters = previous;
                return Err(err(
                    "recordingCodecChanged",
                    "视频编码参数发生变化，录像已保存并结束。",
                ));
            }
            let nals = annex_b(payload);
            let key = nals.iter().any(|n| {
                if codec == 4 {
                    n[0] & 31 == 5
                } else {
                    matches!((n[0] >> 1) & 63, 16..=21)
                }
            });
            if self.video.samples.is_empty() && (!key || self.parameters.config().is_err()) {
                return Ok(());
            }
            if self.video.codec != 0 && self.video.codec != codec {
                return Err(err(
                    "recordingCodecChanged",
                    "视频编码发生变化，录像已结束。",
                ));
            }
            self.video.codec = codec;
            let mut data = Vec::new();
            for n in nals {
                data.extend((n.len() as u32).to_be_bytes());
                data.extend(n);
            }
            let sample = Sample {
                offset: self.bytes,
                size: data.len() as u32,
                time,
                key,
            };
            self.file
                .write_all(&data)
                .map_err(|_| err("mediaSaveFailed", "录像写入失败，请检查磁盘空间。"))?;
            self.bytes += data.len() as u64;
            self.video.samples.push(sample);
        } else if codec == 1032 && !self.video.samples.is_empty() {
            if payload.len() > 65535 {
                return Err(super::AppError::protocol());
            }
            self.file
                .write_all(payload)
                .map_err(|_| err("mediaSaveFailed", "音轨写入失败。"))?;
            self.audio.samples.push(Sample {
                offset: self.bytes,
                size: payload.len() as u32,
                time: time * 48,
                key: true,
            });
            self.bytes += payload.len() as u64;
        }
        Ok(())
    }
    pub fn finish(mut self) -> Result<PathBuf> {
        if let Some(end) = self.selected_end {
            self.video.samples.retain(|s| s.time < end);
            self.audio.samples.retain(|s| s.time / 48 < end);
        }
        if self.video.samples.is_empty() {
            return Err(err(
                "recordingEmpty",
                "尚未收到可保存的完整视频帧，未生成录像。",
            ));
        }
        let (start, end) = self.selection();
        if end <= start {
            return Err(err(
                "recordingEmpty",
                "录制时间太短，尚无可保存的视频片段。",
            ));
        }
        // Do not retain buffered future frames in the exported MP4.
        self.bytes = self
            .video
            .samples
            .iter()
            .chain(&self.audio.samples)
            .map(|s| s.offset + s.size as u64)
            .max()
            .unwrap();
        self.file
            .set_len(self.bytes)
            .and_then(|_| self.file.seek(SeekFrom::Start(self.bytes)))
            .map_err(|_| err("mediaSaveFailed", "录像裁剪失败。"))?;
        let moov = self.moov()?;
        self.file
            .write_all(&moov)
            .and_then(|_| self.file.seek(SeekFrom::Start(self.mdat + 8)))
            .and_then(|_| self.file.write_all(&(self.bytes - self.mdat).to_be_bytes()))
            .and_then(|_| self.file.sync_all())
            .map_err(|_| err("mediaSaveFailed", "录像封装或保存失败。"))?;
        std::fs::rename(&self.path, &self.final_path)
            .map_err(|_| err("mediaSaveFailed", "无法完成录像文件保存。"))?;
        self.finished = true;
        Ok(self.final_path.clone())
    }
    fn moov(&self) -> Result<Vec<u8>> {
        let (start, end) = self.selection();
        let duration = (end - start) as u32;
        let mut mv = u32s(&[0, 0, 1000, duration, 0x10000]);
        mv.extend(0x100u16.to_be_bytes());
        mv.extend([0; 10]);
        mv.extend(matrix());
        mv.extend([0; 24]);
        mv.extend(3u32.to_be_bytes());
        let mut children = vec![full(b"mvhd", 0, mv), self.trak(&self.video, 1)?];
        if !self.audio.samples.is_empty() {
            children.push(self.trak(&self.audio, 2)?);
        }
        Ok(bx(b"moov", join(children)))
    }
    fn trak(&self, t: &Track, id: u32) -> Result<Vec<u8>> {
        let video = id == 1;
        let (start, end) = self.selection();
        let movie_duration = end - start;
        let mut tk = u32s(&[0, 0, id, 0, movie_duration as u32]);
        tk.extend([0; 8]);
        tk.extend([0; 4]);
        tk.extend(if video { 0u16 } else { 0x100u16 }.to_be_bytes());
        tk.extend([0; 2]);
        tk.extend(matrix());
        tk.extend(((if video { self.width } else { 0 }) as u32 * 65536).to_be_bytes());
        tk.extend(((if video { self.height } else { 0 }) as u32 * 65536).to_be_bytes());
        let mut md = u32s(&[0, 0, t.scale, t.duration() as u32]);
        md.extend(0x55c4u16.to_be_bytes());
        md.extend([0; 2]);
        let mut hd = vec![0; 4];
        hd.extend(if video { b"vide" } else { b"soun" });
        hd.extend([0; 12]);
        hd.extend(if video { b"Video\0" } else { b"Audio\0" });
        let dinf = bx(
            b"dinf",
            full(
                b"dref",
                0,
                join(vec![1u32.to_be_bytes().to_vec(), full(b"url ", 1, vec![])]),
            ),
        );
        let entry = if video {
            let mut v = vec![0; 6];
            v.extend(1u16.to_be_bytes());
            v.extend([0; 16]);
            v.extend(self.width.to_be_bytes());
            v.extend(self.height.to_be_bytes());
            v.extend(u32s(&[0x480000, 0x480000, 0]));
            v.extend(1u16.to_be_bytes());
            v.extend([0; 32]);
            v.extend([0, 24, 0xff, 0xff]);
            v.extend(self.parameters.config()?);
            bx(if t.codec == 4 { b"avc1" } else { b"hvc1" }, v)
        } else {
            let mut v = vec![0; 6];
            v.extend(1u16.to_be_bytes());
            v.extend([0; 8]);
            v.extend(1u16.to_be_bytes());
            v.extend(16u16.to_be_bytes());
            v.extend([0; 4]);
            v.extend((48000u32 << 16).to_be_bytes());
            let mut opus = vec![0, 1];
            opus.extend(0u16.to_be_bytes());
            opus.extend(16000u32.to_be_bytes());
            opus.extend([0; 3]);
            v.extend(bx(b"dOps", opus));
            bx(b"Opus", v)
        };
        let stsd = full(b"stsd", 0, join(vec![1u32.to_be_bytes().to_vec(), entry]));
        let mut deltas: Vec<(u32, u32)> = vec![];
        for (i, s) in t.samples.iter().enumerate() {
            let d = t
                .samples
                .get(i + 1)
                .map(|n| n.time.saturating_sub(s.time))
                .unwrap_or(t.step())
                .clamp(1, t.scale as u64 * if video { 60 } else { 1 }) as u32;
            if let Some(last) = deltas.last_mut().filter(|n| n.1 == d) {
                last.0 += 1;
            } else {
                deltas.push((1, d));
            }
        }
        let stts = full(
            b"stts",
            0,
            join(vec![
                (deltas.len() as u32).to_be_bytes().to_vec(),
                deltas.iter().flat_map(|(n, d)| u32s(&[*n, *d])).collect(),
            ]),
        );
        let stsc = full(b"stsc", 0, u32s(&[1, 1, 1, 1]));
        let stsz = full(
            b"stsz",
            0,
            join(vec![
                u32s(&[0, t.samples.len() as u32]),
                t.samples
                    .iter()
                    .flat_map(|s| s.size.to_be_bytes())
                    .collect(),
            ]),
        );
        let co64 = full(
            b"co64",
            0,
            join(vec![
                (t.samples.len() as u32).to_be_bytes().to_vec(),
                t.samples
                    .iter()
                    .flat_map(|s| s.offset.to_be_bytes())
                    .collect(),
            ]),
        );
        let mut tables = vec![stsd, stts, stsc, stsz, co64];
        if video {
            let keys: Vec<u32> = t
                .samples
                .iter()
                .enumerate()
                .filter(|(_, s)| s.key)
                .map(|(i, _)| i as u32 + 1)
                .collect();
            tables.push(full(
                b"stss",
                0,
                join(vec![
                    (keys.len() as u32).to_be_bytes().to_vec(),
                    u32s(&keys),
                ]),
            ));
        }
        let minf = bx(
            b"minf",
            join(vec![
                if video {
                    full(b"vmhd", 1, vec![0; 8])
                } else {
                    full(b"smhd", 0, vec![0; 4])
                },
                dinf,
                bx(b"stbl", join(tables)),
            ]),
        );
        let mdia = bx(
            b"mdia",
            join(vec![full(b"mdhd", 0, md), full(b"hdlr", 0, hd), minf]),
        );
        let first = t
            .samples
            .first()
            .map_or(start, |s| s.time * 1000 / t.scale as u64);
        let lead = first.saturating_sub(start).min(movie_duration);
        let media_time = start.saturating_sub(first) * t.scale as u64 / 1000;
        let mut edits = vec![];
        edits.extend((if lead > 0 { 2u32 } else { 1u32 }).to_be_bytes());
        if lead > 0 {
            edits.extend(lead.to_be_bytes());
            edits.extend((-1i64).to_be_bytes());
            edits.extend([0, 1, 0, 0]);
        }
        edits.extend((movie_duration - lead).to_be_bytes());
        edits.extend((media_time as i64).to_be_bytes());
        edits.extend([0, 1, 0, 0]);
        Ok(bx(
            b"trak",
            join(vec![
                full(b"tkhd", 7, tk),
                bx(b"edts", full(b"elst", 0x01000000, edits)),
                mdia,
            ]),
        ))
    }
}
impl Drop for Recorder {
    fn drop(&mut self) {
        if !self.finished {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn stream_format_changes_only_after_an_established_format() {
        let h264 = [0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2];
        let mut p = Parameters::default();
        assert!(!p.observe_change(4, &h264));
        assert!(!p.observe_change(4, &h264));
        assert!(!p.observe_change(4, &[0, 0, 1, 0x65, 9]));
        assert!(p.observe_change(4, &[0, 0, 1, 0x67, 3, 0, 0, 1, 0x68, 2]));
        assert!(!p.observe_change(4, &[0, 0, 1, 0x67, 3, 0, 0, 1, 0x68, 2]));
        assert!(p.observe_change(5, &[0, 0, 1, 0x40, 1, 0, 0, 1, 0x42, 2, 0, 0, 1, 0x44, 3]));
        assert!(!p.observe_change(5, &[0, 0, 1, 0x40, 1, 0, 0, 1, 0x42, 2, 0, 0, 1, 0x44, 3]));
        assert!(p.observe_change(5, &[0, 0, 1, 0x42, 4]));
    }
    #[test]
    fn splits_three_and_four_byte_nals() {
        assert_eq!(
            annex_b(&[0, 0, 0, 1, 0x67, 1, 0, 0, 1, 0x68, 2]),
            vec![&[0x67, 1][..], &[0x68, 2][..]]
        );
    }
    #[test]
    fn config_requires_real_parameter_sets() {
        assert!(Parameters::default().config().is_err());
        let mut p = Parameters::default();
        p.observe(4, &[0, 0, 1, 0x67, 0x42, 0, 0x1e, 1, 0, 0, 1, 0x68, 1]);
        assert!(p.config().unwrap().windows(4).any(|v| v == b"avcC"));
    }
    #[test]
    fn native_mp4_contains_real_samples_and_indexes() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir_all(&dir).unwrap();
        let mut r = Recorder::new(&dir.join("用户选择的录像.mp4"), 640, 360).unwrap();
        let bytes = [
            0, 0, 1, 0x67, 0x42, 0, 0x1e, 1, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2,
        ];
        r.push(4, 1000, &bytes).unwrap();
        r.push(4, 1050, &[0, 0, 1, 0x41, 1]).unwrap();
        let path = r.finish().unwrap();
        assert_eq!(path, dir.join("用户选择的录像.mp4"));
        let file = std::fs::read(&path).unwrap();
        assert_eq!(&file[4..8], b"ftyp");
        for atom in [b"mdat", b"moov", b"stts", b"co64", b"stss"] {
            assert!(file.windows(4).any(|v| v == atom));
        }
        let _ = std::fs::remove_file(path);
        let _ = std::fs::remove_dir(dir);
    }
    #[test]
    fn empty_recording_keeps_existing_destination_and_cleans_staging() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("已有录像.mp4");
        std::fs::write(&path, b"previous video").unwrap();
        let recorder = Recorder::new(&path, 640, 360).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"previous video");
        assert!(recorder.finish().is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous video");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
