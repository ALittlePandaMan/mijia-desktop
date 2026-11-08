//! MISS RDT framing from the original SDK and the MIT reference wire reader.
use super::{err, AppError, Result};
use serde::Serialize;
#[derive(Serialize, Clone, Debug)]
pub struct Clip {
    pub start: u64,
    pub duration: u32,
    pub event: bool,
    pub channel: u32,
}
pub fn index(payload: &[u8], channel: u32) -> Result<Vec<Clip>> {
    if payload.len() < 4 || payload.len() > 16 * 1024 * 1024 || payload.len() % 8 != 4 {
        return Err(err("recordingIndexInvalid", "存储卡录像索引格式无法识别。"));
    }
    if u32::from_le_bytes(payload[..4].try_into().unwrap()) != 0 {
        return Err(err(
            "recordingCardUnavailable",
            "摄像机存储卡当前不可读取。",
        ));
    }
    let mut out = Vec::new();
    for row in payload[4..].chunks_exact(8) {
        let start = u32::from_le_bytes(row[..4].try_into().unwrap()) as u64;
        // Both original standard and Hualai SdFileManager use separate bytes:
        // duration, motion, saved, deleting. Saved clips remain playable.
        let duration = if row[4] == 0 { 60 } else { u32::from(row[4]) };
        if (1577836800..2524608000).contains(&start) && row[7] == 0 {
            out.push(Clip {
                start,
                duration,
                event: row[5] == 1,
                channel,
            });
        }
    }
    out.sort_by_key(|c| c.start);
    out.dedup_by(|b, a| {
        if a.start == b.start {
            a.duration = a.duration.max(b.duration);
            a.event |= b.event;
            true
        } else {
            false
        }
    });
    Ok(out)
}
#[derive(Default)]
pub struct Assembler {
    cmd: u32,
    want: usize,
    data: Vec<u8>,
}
impl Assembler {
    pub fn reset(&mut self) {
        self.cmd = 0;
        self.want = 0;
        self.data.clear();
    }
    pub fn push(&mut self, plain: &[u8]) -> Result<Option<(u32, Vec<u8>)>> {
        if self.cmd == 0 {
            if plain.len() < 8 {
                return Err(AppError::protocol());
            }
            self.cmd = u32::from_le_bytes(plain[..4].try_into().unwrap());
            // Original SDK: command, payload length, then a separate status word.
            // C700 observed: 39360 declared bytes + 4 status bytes, not padding.
            self.want = u32::from_le_bytes(plain[4..8].try_into().unwrap()) as usize + 4;
            if self.cmd == 0 || self.cmd > 65535 || self.want > 16 * 1024 * 1024 {
                self.reset();
                return Err(AppError::protocol());
            }
            self.data.extend(&plain[8..]);
        } else {
            self.data.extend(plain);
        }
        if self.data.len() > 16 * 1024 * 1024 {
            self.reset();
            return Err(AppError::protocol());
        }
        if self.data.len() < self.want {
            return Ok(None);
        }
        if self.data.len() != self.want {
            #[cfg(debug_assertions)]
            eprintln!(
                "[camera RDT] command={} declared={} collected={} finalChunk={}",
                self.cmd,
                self.want,
                self.data.len(),
                plain.len()
            );
            self.reset();
            return Err(err("recordingIndexInvalid", "存储卡响应长度与声明不一致。"));
        }
        let result = (self.cmd, std::mem::take(&mut self.data));
        self.reset();
        Ok(Some(result))
    }
}
/// Preserve original 8/24/32-byte RDT-6 layouts and the observed reference form.
pub fn index_request(channel: u32, bytes: usize, declared: u32, key: &[u8; 32]) -> Result<Vec<u8>> {
    if ![8, 24, 32].contains(&bytes)
        || ![0, 10].contains(&channel)
        || declared != 0 && declared as usize != bytes - 8
        || bytes == 8 && channel != 0
    {
        return Err(AppError::protocol());
    }
    let mut payload = vec![0; bytes - 8];
    if payload.len() >= 12 {
        payload[8..12].copy_from_slice(&channel.to_le_bytes());
    }
    envelope(6, &payload, declared, key)
}
fn envelope(cmd: u32, payload: &[u8], declared: u32, key: &[u8; 32]) -> Result<Vec<u8>> {
    use rand::RngCore;
    let mut nonce = [0u8; 8];
    rand::rngs::OsRng.fill_bytes(&mut nonce);
    let mut plain = cmd.to_le_bytes().to_vec();
    plain.extend(declared.to_le_bytes());
    plain.extend(payload);
    let mut out = nonce.to_vec();
    out.extend(super::crypt(&plain, key, &nonce)?);
    Ok(out)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn hl4g_index_request_matches_original_zero_word_and_channel_offset() {
        let key = [7; 32];
        let packet = index_request(10, 32, 0, &key).unwrap();
        let plain = super::super::crypt(&packet[8..], &key, &packet[..8]).unwrap();
        assert_eq!(plain.len(), 32);
        assert_eq!(&plain[..8], &[6, 0, 0, 0, 0, 0, 0, 0]);
        assert_eq!(&plain[16..20], &10u32.to_le_bytes());
    }
    #[test]
    fn hl4g_index_keeps_saved_clips_and_uses_original_duration_and_delete_flags() {
        let mut payload = vec![0; 4];
        for (start, flags) in [(1792212500u32, [0, 1, 1, 0]), (1792212560, [60, 0, 0, 1])] {
            payload.extend(start.to_le_bytes());
            payload.extend(flags);
        }
        let clips = index(&payload, 10).unwrap();
        assert_eq!(clips.len(), 1);
        assert_eq!(clips[0].duration, 60);
        assert!(clips[0].event);
        assert_eq!(clips[0].channel, 10);
        assert!(index(&[1, 0, 0, 0], 0).is_err());
        assert!(index(&[0; 5], 0).is_err());
    }
    #[test]
    fn index_keeps_real_order_deduplicates_and_rejects_garbage() {
        let mut b = vec![0; 4];
        for (t, d) in [
            (1793760000u32, 60u32),
            (1793760000, 60 | 256),
            (0, 60),
            (1793760060, 60),
        ] {
            b.extend(t.to_le_bytes());
            b.extend(d.to_le_bytes());
        }
        let c = index(&b, 0).unwrap();
        assert_eq!(c.len(), 2);
        assert!(c[0].event);
        assert_eq!(c[0].duration, 60);
        assert!(index(&[0; 3], 0).is_err());
        assert!(index(&[1, 0, 0, 0], 0).is_err());
    }
    #[test]
    fn encrypted_chunks_must_complete_exactly() {
        let mut a = Assembler::default();
        let mut b = 6u32.to_le_bytes().to_vec();
        b.extend(8u32.to_le_bytes());
        b.extend([0; 4]);
        assert!(a.push(&b).unwrap().is_none());
        assert_eq!(a.push(&[0; 8]).unwrap().unwrap().1.len(), 12);
        let mut b = 6u32.to_le_bytes().to_vec();
        b.extend(u32::MAX.to_le_bytes());
        assert!(a.push(&b).is_err());
    }
}
