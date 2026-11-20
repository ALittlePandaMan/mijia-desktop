//! Minimal ISO/IEC 13818-1 video-only TS framing for the MediaSource transmuxer.
use super::{AppError, Result};
#[derive(Default)]
pub struct Mux {
    counter: [u8; 3],
    frames: u64,
    origin: Option<u64>,
    last_time: Option<u64>,
    elapsed: u64,
    playback: bool,
}
fn crc(bytes: &[u8]) -> u32 {
    let mut crc = 0xffff_ffffu32;
    for b in bytes {
        crc ^= (*b as u32) << 24;
        for _ in 0..8 {
            crc = if crc & 0x8000_0000 != 0 {
                (crc << 1) ^ 0x04c1_1db7
            } else {
                crc << 1
            };
        }
    }
    crc
}
impl Mux {
    pub fn set_playback(&mut self, playback: bool) {
        self.playback = playback;
    }
    fn packet(&mut self, pid: u16, start: bool, data: &[u8], pcr: Option<u64>, out: &mut Vec<u8>) {
        let index = if pid == 0 {
            0
        } else if pid == 0x100 {
            1
        } else {
            2
        };
        let mut p = [0xffu8; 188];
        p[0] = 0x47;
        p[1] = ((pid >> 8) as u8 & 0x1f) | if start { 0x40 } else { 0 };
        p[2] = pid as u8;
        let adaptation = 184 - data.len();
        p[3] = if adaptation > 0 { 0x30 } else { 0x10 } | self.counter[index];
        self.counter[index] = (self.counter[index] + 1) & 15;
        if adaptation > 0 {
            p[4] = (adaptation - 1) as u8;
            if adaptation > 1 {
                p[5] = if pcr.is_some() { 0x10 } else { 0 };
            }
            if let Some(base) = pcr {
                p[6] = (base >> 25) as u8;
                p[7] = (base >> 17) as u8;
                p[8] = (base >> 9) as u8;
                p[9] = (base >> 1) as u8;
                p[10] = ((base & 1) << 7) as u8 | 0x7e;
                p[11] = 0;
            }
        }
        p[188 - data.len()..].copy_from_slice(data);
        out.extend_from_slice(&p);
    }
    fn section(&mut self, pid: u16, mut bytes: Vec<u8>, out: &mut Vec<u8>) {
        bytes.extend_from_slice(&crc(&bytes).to_be_bytes());
        bytes.insert(0, 0);
        self.packet(pid, true, &bytes, None, out);
    }
    pub fn video(&mut self, codec: u32, time: u64, payload: &[u8]) -> Result<Vec<u8>> {
        if !matches!(codec, 4 | 5)
            || payload.len() > 2 * 1024 * 1024
            || payload.len() < 4
            || !payload.starts_with(&[0, 0, 0, 1]) && !payload.starts_with(&[0, 0, 1])
        {
            return Err(AppError::new(
                "videoCodecUnsupported",
                "摄像机返回的媒体格式尚不能播放。",
                false,
            ));
        }
        let mut out = Vec::with_capacity(payload.len() + 512);
        if self.frames % 30 == 0 {
            self.section(
                0,
                vec![0x00, 0xb0, 0x0d, 0, 1, 0xc1, 0, 0, 0, 1, 0xe1, 0],
                &mut out,
            );
            self.section(
                0x100,
                vec![
                    0x02,
                    0xb0,
                    0x12,
                    0,
                    1,
                    0xc1,
                    0,
                    0,
                    0xe1,
                    1,
                    0xf0,
                    0,
                    if codec == 4 { 0x1b } else { 0x24 },
                    0xe1,
                    1,
                    0xf0,
                    0,
                ],
                &mut out,
            );
        }
        self.frames += 1;
        self.origin.get_or_insert(time);
        if let Some(previous) = self.last_time {
            let delta = time.saturating_sub(previous);
            // Accelerated SD playback can send sparse I-frames several seconds
            // apart in recording time. Preserve those gaps for the media clock.
            let max_delta = if self.playback { 60_000 } else { 500 };
            self.elapsed = self
                .elapsed
                .saturating_add(if (1..=max_delta).contains(&delta) {
                    delta
                } else {
                    50
                });
        }
        self.last_time = Some(time);
        let pts = (self.elapsed.saturating_add(1000) * 90) & 0x1_ffff_ffff;
        let mut pes = vec![
            0,
            0,
            1,
            0xe0,
            0,
            0,
            0x84,
            0x80,
            5,
            0x21 | ((pts >> 29) & 0xe) as u8,
            (pts >> 22) as u8,
            ((pts >> 14) & 0xfe) as u8 | 1,
            (pts >> 7) as u8,
            ((pts << 1) & 0xfe) as u8 | 1,
        ];
        pes.extend_from_slice(payload);
        let mut offset = 0;
        while offset < pes.len() {
            let first = offset == 0;
            let len = (pes.len() - offset).min(if first { 176 } else { 184 });
            self.packet(
                0x101,
                first,
                &pes[offset..offset + len],
                if first {
                    Some(pts.saturating_sub(27000))
                } else {
                    None
                },
                &mut out,
            );
            offset += len;
        }
        Ok(out)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn sections_have_zero_crc_and_transport_boundaries() {
        let data = Mux::default()
            .video(4, 12, &[0, 0, 0, 1, 0x65, 1, 2, 3])
            .unwrap();
        assert_eq!(data.len() % 188, 0);
        assert!(data.chunks(188).all(|p| p[0] == 0x47));
        let pat = &data[..188];
        let offset = 5 + pat[4] as usize + 1;
        assert_eq!(crc(&pat[offset..offset + 16]), 0);
    }
    #[test]
    fn refuses_unknown_or_non_annex_b() {
        assert!(Mux::default().video(6, 0, &[0, 0, 1, 1]).is_err());
        assert!(Mux::default().video(4, 0, &[1, 2, 3, 4]).is_err());
    }
    #[test]
    fn replay_preserves_sparse_frame_time_without_changing_live_gap_recovery() {
        let frame = [0, 0, 0, 1, 0x65, 1, 2, 3];
        for (playback, expected) in [(false, 50), (true, 1600)] {
            let mut mux = Mux::default();
            mux.set_playback(playback);
            mux.video(4, 10_000, &frame).unwrap();
            mux.video(4, 11_600, &frame).unwrap();
            assert_eq!(mux.elapsed, expected);
        }
    }
    #[test]
    fn replay_still_recovers_from_backward_and_unbounded_timestamp_jumps() {
        let frame = [0, 0, 0, 1, 0x65, 1, 2, 3];
        let mut mux = Mux::default();
        mux.set_playback(true);
        for time in [10_000, 9_000, 900_000] {
            mux.video(4, time, &frame).unwrap();
        }
        assert_eq!(mux.elapsed, 100);
    }
}
