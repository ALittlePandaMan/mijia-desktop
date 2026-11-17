//! Keep disk latency off the camera receive loop; accepted packets stay in order.
use super::{err, mp4, AppError, Result};
use std::{
    path::PathBuf,
    sync::{
        atomic::{AtomicUsize, Ordering},
        mpsc::{self, Receiver, SyncSender},
        Arc,
    },
    thread::{self, JoinHandle},
};

const QUEUE_BYTES: usize = 8 * 1024 * 1024;
const QUEUE_PACKETS: usize = 512;
enum Message {
    Frame {
        codec: u32,
        time: u64,
        data: Vec<u8>,
    },
    Finish(Option<u64>),
}
pub struct Writer {
    sender: Option<SyncSender<Message>>,
    errors: Receiver<AppError>,
    queued: Arc<AtomicUsize>,
    worker: Option<JoinHandle<Result<PathBuf>>>,
    end: Option<u64>,
}
impl Writer {
    pub fn start(recorder: mp4::Recorder) -> Result<Self> {
        Self::spawn(recorder, || {})
    }
    fn spawn(recorder: mp4::Recorder, before: impl FnOnce() + Send + 'static) -> Result<Self> {
        let (sender, receiver) = mpsc::sync_channel(QUEUE_PACKETS);
        let (errors_tx, errors) = mpsc::channel();
        let queued = Arc::new(AtomicUsize::new(0));
        let pending = queued.clone();
        let worker = thread::Builder::new()
            .name("camera-record-writer".into())
            .spawn(move || {
                before();
                let mut recorder = recorder;
                let mut failed = false;
                while let Ok(message) = receiver.recv() {
                    match message {
                        Message::Frame { codec, time, data } => {
                            let result = if failed {
                                Ok(())
                            } else {
                                recorder.push(codec, time, &data)
                            };
                            pending.fetch_sub(data.len(), Ordering::AcqRel);
                            if let Err(error) = result {
                                failed = true;
                                let _ = errors_tx.send(error);
                            }
                        }
                        Message::Finish(end) => {
                            if let Some(time) = end {
                                recorder.select_end(time);
                            }
                            return recorder.finish();
                        }
                    }
                }
                // An abandoned writer must not publish an unfinished file.
                Err(AppError::stale())
            })
            .map_err(|_| err("mediaSaveFailed", "无法启动录像写入线程。"))?;
        Ok(Self {
            sender: Some(sender),
            errors,
            queued,
            worker: Some(worker),
            end: None,
        })
    }
    pub fn push(&mut self, codec: u32, time: u64, payload: &[u8]) -> Result<()> {
        if let Ok(error) = self.errors.try_recv() {
            return Err(error);
        }
        self.queued
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |bytes| {
                bytes
                    .checked_add(payload.len())
                    .filter(|n| *n <= QUEUE_BYTES)
            })
            .map_err(|_| backpressure())?;
        let message = Message::Frame {
            codec,
            time,
            data: payload.to_vec(),
        };
        if let Err(error) = self
            .sender
            .as_ref()
            .ok_or_else(AppError::stale)?
            .try_send(message)
        {
            self.queued.fetch_sub(payload.len(), Ordering::AcqRel);
            return Err(match error {
                mpsc::TrySendError::Full(_) => backpressure(),
                mpsc::TrySendError::Disconnected(_) => {
                    err("mediaSaveFailed", "录像写入线程意外结束。")
                }
            });
        }
        Ok(())
    }
    pub fn select_end(&mut self, time: u64) {
        self.end = Some(time);
    }
    pub fn finish(mut self) -> Result<PathBuf> {
        if let Some(sender) = self.sender.take() {
            let _ = sender.send(Message::Finish(self.end));
        }
        self.worker
            .take()
            .ok_or_else(AppError::stale)?
            .join()
            .map_err(|_| err("mediaSaveFailed", "录像写入线程意外结束。"))?
    }
}
fn backpressure() -> AppError {
    err(
        "recordingBackpressure",
        "磁盘暂时无法跟上录像写入，已结束并保存收到的完整片段。",
    )
}
impl Drop for Writer {
    fn drop(&mut self) {
        self.sender.take();
        if let Some(worker) = self.worker.take() {
            let _ = worker.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const KEY: &[u8] = &[
        0, 0, 1, 0x67, 0x42, 0, 0x1e, 1, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2,
    ];
    fn recorder() -> (PathBuf, mp4::Recorder) {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let recorder = mp4::Recorder::new(&dir.join("record.mp4"), 640, 360).unwrap();
        (dir, recorder)
    }
    fn samples(file: &[u8]) -> u32 {
        let pos = file.windows(4).position(|p| p == b"stsz").unwrap();
        u32::from_be_bytes(file[pos + 12..pos + 16].try_into().unwrap())
    }
    #[test]
    fn receiving_a_burst_never_waits_for_the_disk_worker_and_keeps_every_frame() {
        let (dir, recorder) = recorder();
        let (release, gate) = mpsc::channel();
        let mut writer = Writer::spawn(recorder, move || {
            gate.recv().unwrap();
        })
        .unwrap();
        writer.push(4, 1000, KEY).unwrap();
        for i in 1..300 {
            writer.push(4, 1000 + i * 50, &[0, 0, 1, 0x41, 1]).unwrap();
        }
        // The entire burst has been accepted while the writer is still blocked.
        assert!(writer.queued.load(Ordering::Acquire) > 0);
        release.send(()).unwrap();
        let path = writer.finish().unwrap();
        assert_eq!(samples(&std::fs::read(&path).unwrap()), 300);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn bounded_queue_reports_overload_instead_of_silently_dropping_frames() {
        let (dir, recorder) = recorder();
        let (release, gate) = mpsc::channel();
        let mut writer = Writer::spawn(recorder, move || {
            gate.recv().unwrap();
        })
        .unwrap();
        writer.push(4, 1000, KEY).unwrap();
        for i in 1..QUEUE_PACKETS {
            writer
                .push(4, 1000 + i as u64 * 50, &[0, 0, 1, 0x41, 1])
                .unwrap();
        }
        let packet_overload = writer.push(4, 99999, &[0, 0, 1, 0x41, 1]);
        let byte_overload = writer.push(4, 99999, &vec![0; QUEUE_BYTES + 1]);
        release.send(()).unwrap();
        let path = writer.finish().unwrap();
        assert_eq!(packet_overload.unwrap_err().kind, "recordingBackpressure");
        assert_eq!(byte_overload.unwrap_err().kind, "recordingBackpressure");
        assert_eq!(
            samples(&std::fs::read(&path).unwrap()),
            QUEUE_PACKETS as u32
        );
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn stopping_waits_for_queued_frames_then_applies_the_selected_end() {
        let (dir, recorder) = recorder();
        let mut writer = Writer::start(recorder).unwrap();
        writer.push(4, 1000, KEY).unwrap();
        writer.push(4, 1050, &[0, 0, 1, 0x41, 1]).unwrap();
        writer.push(4, 1100, &[0, 0, 1, 0x41, 1]).unwrap();
        writer.select_end(1100);
        let path = writer.finish().unwrap();
        assert_eq!(samples(&std::fs::read(&path).unwrap()), 2);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn dropping_an_unfinished_writer_cleans_staging_without_replacing_existing_files() {
        let (dir, recorder) = recorder();
        std::fs::write(dir.join("record.mp4"), b"existing").unwrap();
        let mut writer = Writer::start(recorder).unwrap();
        writer.push(4, 1000, KEY).unwrap();
        drop(writer);
        assert_eq!(std::fs::read(dir.join("record.mp4")).unwrap(), b"existing");
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(dir.join("record.mp4")).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn video_and_audio_packets_remain_interleaved_without_losing_samples() {
        let (dir, recorder) = recorder();
        let mut writer = Writer::start(recorder).unwrap();
        for offset in (0..6000).step_by(10) {
            if offset % 50 == 0 {
                writer
                    .push(
                        4,
                        1000 + offset,
                        if offset == 0 {
                            KEY
                        } else {
                            &[0, 0, 1, 0x41, 1]
                        },
                    )
                    .unwrap();
            }
            if offset % 40 == 0 {
                writer
                    .push(1032, 1000 + offset, &[0xf8, 0xff, 0xfe])
                    .unwrap();
            }
        }
        let path = writer.finish().unwrap();
        let file = std::fs::read(&path).unwrap();
        let counts: Vec<_> = file
            .windows(4)
            .enumerate()
            .filter(|(_, p)| *p == b"stsz")
            .map(|(pos, _)| u32::from_be_bytes(file[pos + 12..pos + 16].try_into().unwrap()))
            .collect();
        assert_eq!(counts, vec![120, 150]);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn asynchronous_codec_errors_reach_the_receiver_and_keep_the_completed_prefix() {
        let (dir, recorder) = recorder();
        let mut writer = Writer::start(recorder).unwrap();
        writer.push(4, 1000, KEY).unwrap();
        writer
            .push(
                4,
                1050,
                &[
                    0, 0, 1, 0x67, 0x42, 0, 0x1e, 9, 0, 0, 1, 0x68, 1, 0, 0, 1, 0x65, 2,
                ],
            )
            .unwrap();
        let mut error = None;
        for i in 0..200 {
            match writer.push(4, 1100 + i * 50, &[0, 0, 1, 0x41, 1]) {
                Ok(()) => std::thread::sleep(std::time::Duration::from_millis(1)),
                Err(e) => {
                    error = Some(e);
                    break;
                }
            }
        }
        let path = writer.finish().unwrap();
        assert_eq!(error.unwrap().kind, "recordingCodecChanged");
        assert!(samples(&std::fs::read(&path).unwrap()) >= 1);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
}
