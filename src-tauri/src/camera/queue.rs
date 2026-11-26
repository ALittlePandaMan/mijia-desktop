//! Bounded media bursts, independent reliable control/file notifications.
use super::Event;
use std::{
    collections::VecDeque,
    sync::{mpsc::TryRecvError, Arc, Mutex},
};
const MAX_BYTES: usize = 8 * 1024 * 1024;
#[derive(Default)]
struct Queue {
    media: VecDeque<Event>,
    critical: VecDeque<Event>,
    bytes: usize,
    peak: usize,
    recoveries: u64,
    playback_limited: bool,
    closed: bool,
}
#[derive(Debug)]
pub enum SendError {
    Full,
    PlaybackLimited,
    Disconnected,
}
pub struct Sender(Arc<Mutex<Queue>>);
pub struct Receiver(Arc<Mutex<Queue>>);
#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Diagnostics {
    pub queued_bytes: usize,
    pub peak_bytes: usize,
    pub recoveries: u64,
}
pub fn channel() -> (Sender, Receiver) {
    let q = Arc::new(Mutex::new(Queue::default()));
    (Sender(q.clone()), Receiver(q))
}
impl Sender {
    pub fn clear_preview(&self) {
        if let Ok(mut q) = self.0.lock() {
            q.media.clear();
            q.bytes = 0;
            q.playback_limited = false;
            q.critical.retain(|event| event.state != "throughput");
        }
    }

    pub fn try_send(&self, event: Event) -> Result<(), SendError> {
        self.send(event, false)
    }

    pub fn try_send_video(&self, event: Event, playback: bool) -> Result<(), SendError> {
        self.send(event, playback)
    }

    fn send(&self, event: Event, playback: bool) -> Result<(), SendError> {
        let Ok(mut q) = self.0.lock() else {
            return Err(SendError::Disconnected);
        };
        if matches!(event.state, "media" | "audio") {
            if q.playback_limited {
                return Err(SendError::PlaybackLimited);
            }
            let bytes = event.data.as_ref().map_or(0, String::len);
            let lens_full = event.lens_id.is_some()
                && q.media
                    .iter()
                    .filter(|e| e.state == "media" && e.lens_id == event.lens_id)
                    .count()
                    >= 32;
            if q.media.len() >= 64 || lens_full || q.bytes + bytes > MAX_BYTES {
                if playback {
                    // Keep the playable prefix and deliver one marker after it.
                    // Control replies and original recording leave by their usual paths.
                    let mut limit = Event::state("playback-preview-limit");
                    limit.media_generation = event.media_generation;
                    q.media.push_back(limit);
                    q.playback_limited = true;
                    q.recoveries += 1;
                    return Err(SendError::PlaybackLimited);
                }
                return Err(SendError::Full);
            }
            q.bytes += bytes;
            q.peak = q.peak.max(q.bytes);
            q.media.push_back(event);
        } else {
            if q.critical.len() >= 256 {
                return Err(SendError::Full);
            }
            q.critical.push_back(event);
        }
        Ok(())
    }
    pub fn discard_live_lens(&self, lens_id: u8) {
        if let Ok(mut q) = self.0.lock() {
            q.media
                .retain(|e| e.state != "media" || e.lens_id.unwrap_or(0) != lens_id);
            q.bytes = q
                .media
                .iter()
                .map(|e| e.data.as_ref().map_or(0, String::len))
                .sum();
            q.recoveries += 1;
        }
    }
}
impl Drop for Sender {
    fn drop(&mut self) {
        if let Ok(mut q) = self.0.lock() {
            q.closed = true;
        }
    }
}
impl Receiver {
    pub fn try_recv(&self) -> Result<Event, TryRecvError> {
        let mut q = self.0.lock().map_err(|_| TryRecvError::Disconnected)?;
        if let Some(e) = q.critical.pop_front() {
            return Ok(e);
        }
        if let Some(e) = q.media.pop_front() {
            q.bytes = q
                .bytes
                .saturating_sub(e.data.as_ref().map_or(0, String::len));
            return Ok(e);
        }
        Err(if q.closed {
            TryRecvError::Disconnected
        } else {
            TryRecvError::Empty
        })
    }
    pub fn diagnostics(&self) -> Option<Diagnostics> {
        self.0.lock().ok().map(|q| Diagnostics {
            queued_bytes: q.bytes,
            peak_bytes: q.peak,
            recoveries: q.recoveries,
        })
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn clearing_preview_retains_control_and_recording_notifications() {
        let (tx, rx) = channel();
        for state in ["authenticated", "media", "audio", "throughput", "recorded"] {
            tx.try_send(Event::state(state)).unwrap();
        }
        tx.clear_preview();
        assert_eq!(rx.try_recv().unwrap().state, "authenticated");
        assert_eq!(rx.try_recv().unwrap().state, "recorded");
        assert!(rx.try_recv().is_err());
        assert_eq!(rx.diagnostics().unwrap().queued_bytes, 0);
    }
    #[test]
    fn overflow_preserves_the_other_lens_and_file_events() {
        let (tx, rx) = channel();
        let secondary = || {
            let mut event = Event::state("media");
            event.lens_id = Some(10);
            event
        };
        for _ in 0..32 {
            tx.try_send(secondary()).unwrap();
        }
        assert!(tx.try_send(secondary()).is_err());
        let mut primary = Event::state("media");
        primary.lens_id = Some(0);
        tx.try_send(primary).unwrap();
        tx.try_send(Event::state("recorded")).unwrap();
        tx.discard_live_lens(10);
        assert_eq!(rx.try_recv().unwrap().state, "recorded");
        assert_eq!(rx.try_recv().unwrap().lens_id, Some(0));
        assert!(rx.try_recv().is_err());
        assert_eq!(rx.diagnostics().unwrap().recoveries, 1);
    }
    #[test]
    fn limited_playback_keeps_a_complete_prefix_and_one_scoped_marker() {
        let (tx, rx) = channel();
        let video = |generation| {
            let mut event = Event::state("media");
            event.lens_id = Some(10);
            event.media_generation = generation;
            event
        };
        tx.try_send(Event::state("audio")).unwrap();
        for _ in 0..32 {
            tx.try_send_video(video(7), true).unwrap();
        }
        assert!(matches!(tx.try_send_video(video(7), true), Err(SendError::PlaybackLimited)));
        assert!(matches!(tx.try_send(Event::state("audio")), Err(SendError::PlaybackLimited)));
        tx.try_send(Event::state("recording-stopped")).unwrap();
        assert_eq!(rx.try_recv().unwrap().state, "recording-stopped");
        assert_eq!(rx.try_recv().unwrap().state, "audio");
        for _ in 0..32 {
            assert_eq!(rx.try_recv().unwrap().state, "media");
        }
        let limit = rx.try_recv().unwrap();
        assert_eq!((limit.state, limit.media_generation), ("playback-preview-limit", 7));
        assert!(rx.try_recv().is_err());
        assert!(matches!(tx.try_send_video(video(7), true), Err(SendError::PlaybackLimited)));
        assert_eq!(rx.diagnostics().unwrap().recoveries, 1);

        tx.clear_preview();
        tx.try_send_video(video(8), true).unwrap();
        assert_eq!(rx.try_recv().unwrap().media_generation, 8);
        assert!(rx.try_recv().is_err());
    }
    #[test]
    fn byte_budget_and_closed_state_are_bounded() {
        let (tx, rx) = channel();
        let mut e = Event::state("media");
        e.data = Some("a".repeat(MAX_BYTES));
        tx.try_send(e).unwrap();
        assert!(tx.try_send(Event::state("media")).is_ok());
        let mut e = Event::state("media");
        e.data = Some("b".into());
        assert!(tx.try_send(e).is_err());
        assert_eq!(rx.diagnostics().unwrap().peak_bytes, MAX_BYTES);
        tx.discard_live_lens(0);
        drop(tx);
        assert!(matches!(rx.try_recv(), Err(TryRecvError::Disconnected)));
    }
}
