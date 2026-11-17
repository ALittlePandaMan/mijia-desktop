//! Native-owned recording/dialog destinations and opaque export IDs.
use super::{err, Result};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::Write,
    path::{Path, PathBuf},
    sync::Mutex,
};
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SavedMedia {
    pub id: String,
    pub file_name: String,
    pub kind: &'static str,
}
struct Saved {
    home: String,
    generation: u64,
    did: String,
    path: PathBuf,
}
#[derive(Default)]
pub struct Exports(Mutex<HashMap<String, Saved>>);
pub fn valid_png(bytes: &[u8]) -> bool {
    bytes.len() >= 57
        && bytes.len() <= 32 * 1024 * 1024
        && bytes[..8] == *b"\x89PNG\r\n\x1a\n"
        && bytes[12..16] == *b"IHDR"
        && u32::from_be_bytes(bytes[8..12].try_into().unwrap()) == 13
        && (1..=8192).contains(&u32::from_be_bytes(bytes[16..20].try_into().unwrap()))
        && (1..=8192).contains(&u32::from_be_bytes(bytes[20..24].try_into().unwrap()))
        && bytes[bytes.len() - 8..bytes.len() - 4] == *b"IEND"
}
pub fn filename(_name: &str, extension: &str) -> String {
    use std::sync::atomic::{AtomicI64, Ordering};
    static LAST: AtomicI64 = AtomicI64::new(0);
    let now = chrono::Utc::now();
    let nanos = now.timestamp_nanos_opt().unwrap_or(0);
    let mut last = LAST.load(Ordering::Relaxed);
    let value = loop {
        // Distinguish simultaneous dual-lens exports without device names or
        // random suffixes. A clock correction larger than 1s follows wall time.
        let next = if nanos <= last && last.saturating_sub(nanos) < 1_000_000_000 {
            last.saturating_add(1)
        } else {
            nanos
        };
        match LAST.compare_exchange_weak(last, next, Ordering::Relaxed, Ordering::Relaxed) {
            Ok(_) => break next,
            Err(current) => last = current,
        }
    };
    let stamp =
        chrono::DateTime::from_timestamp(value / 1_000_000_000, (value % 1_000_000_000) as u32)
            .unwrap_or(now)
            .with_timezone(&chrono::Local);
    format!("{}.{}", stamp.format("%Y%m%d-%H%M%S-%9f"), extension)
}
pub fn staging_path(destination: &Path) -> PathBuf {
    destination.with_file_name(format!(".mijia-{}.partial", uuid::Uuid::new_v4()))
}
impl Exports {
    /// Bytes originate in the authenticated native cloud remuxer, never JS paths.
    pub fn cloud_recording(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        destination: &Path,
        bytes: &[u8],
    ) -> Result<SavedMedia> {
        if bytes.len() < 16 || bytes.len() > 48 * 1024 * 1024 || &bytes[4..8] != b"ftyp" {
            return Err(err("invalidVideo", "云录像格式无效。"));
        }
        super::save_dialog::Kind::Recording.validate(destination)?;
        let path = staging_path(destination);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| {
                err(
                    "mediaSaveFailed",
                    "无法保存录像，请检查文件权限和磁盘空间。",
                )
            })?;
        let result = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if result.is_err() || std::fs::rename(&path, destination).is_err() {
            let _ = std::fs::remove_file(path);
            return Err(err("mediaSaveFailed", "录像保存失败，请重试。"));
        }
        self.register(
            home,
            generation,
            did,
            destination.to_path_buf(),
            "recording",
        )
    }
    pub fn register(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        path: PathBuf,
        kind: &'static str,
    ) -> Result<SavedMedia> {
        let result = SavedMedia {
            id: uuid::Uuid::new_v4().to_string(),
            file_name: path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .into_owned(),
            kind,
        };
        let mut entries = self.0.lock().map_err(|_| super::AppError::stale())?;
        if entries.len() >= 256 {
            entries.clear();
        }
        entries.insert(
            result.id.clone(),
            Saved {
                home: home.into(),
                generation,
                did: did.into(),
                path,
            },
        );
        Ok(result)
    }
    pub fn screenshot(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        destination: &Path,
        bytes: &[u8],
    ) -> Result<SavedMedia> {
        if !valid_png(bytes) {
            return Err(err("invalidImage", "截图数据无效。"));
        }
        super::save_dialog::Kind::Screenshot.validate(destination)?;
        let path = staging_path(destination);
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
            .map_err(|_| {
                err(
                    "mediaSaveFailed",
                    "无法保存截图，请检查图片目录权限和磁盘空间。",
                )
            })?;
        let result = file.write_all(bytes).and_then(|_| file.sync_all());
        drop(file);
        if result.is_err() || std::fs::rename(&path, destination).is_err() {
            let _ = std::fs::remove_file(&path);
            return Err(err(
                "mediaSaveFailed",
                "截图保存失败，请检查磁盘空间和文件权限。",
            ));
        }
        self.register(
            home,
            generation,
            did,
            destination.to_path_buf(),
            "screenshot",
        )
    }
    pub fn folder(&self, home: &str, generation: u64, did: &str, id: &str) -> Result<PathBuf> {
        self.0
            .lock()
            .map_err(|_| super::AppError::stale())?
            .get(id)
            .filter(|v| v.home == home && v.generation == generation && v.did == did)
            .and_then(|v| v.path.parent())
            .map(Path::to_path_buf)
            .ok_or_else(super::AppError::stale)
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cloud_recordings_keep_existing_file_until_validated_and_register_selected_path() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("事件.mp4");
        std::fs::write(&path, b"previous").unwrap();
        let e = Exports::default();
        assert!(e.cloud_recording("h", 1, "d", &path, b"bad").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous");
        let bytes = b"\0\0\0\x10ftypisom\0\0\0\0";
        let saved = e.cloud_recording("h", 1, "d", &path, bytes).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(saved.kind, "recording");
        assert_eq!(e.folder("h", 1, "d", &saved.id).unwrap(), dir);
        assert!(e.folder("other", 1, "d", &saved.id).is_err());
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    fn fixture_png() -> Vec<u8> {
        use base64::Engine;
        base64::engine::general_purpose::STANDARD.decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=").unwrap()
    }
    #[test]
    fn screenshots_use_exact_selected_path_and_replace_only_after_validation() {
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        std::fs::create_dir(&dir).unwrap();
        let path = dir.join("我的截图.png");
        std::fs::write(&path, b"previous file").unwrap();
        let e = Exports::default();
        assert!(e.screenshot("h", 1, "d", &path, b"bad png").is_err());
        assert_eq!(std::fs::read(&path).unwrap(), b"previous file");
        let bytes = fixture_png();
        let saved = e.screenshot("h", 1, "d", &path, &bytes).unwrap();
        assert_eq!(saved.file_name, "我的截图.png");
        assert_eq!(std::fs::read(&path).unwrap(), bytes);
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 1);
        std::fs::remove_file(path).unwrap();
        std::fs::remove_dir(dir).unwrap();
    }
    #[test]
    fn screenshots_reject_other_extensions_and_nonexistent_parents() {
        let e = Exports::default();
        let bytes = fixture_png();
        let dir = std::env::temp_dir().join(uuid::Uuid::new_v4().to_string());
        assert!(e
            .screenshot("h", 1, "d", &dir.join("x.png"), &bytes)
            .is_err());
        assert!(!dir.exists());
        assert!(e
            .screenshot("h", 1, "d", &std::env::temp_dir().join("x.exe"), &bytes)
            .is_err());
    }
    #[test]
    fn png_rejects_unknown_bytes_and_unbounded_dimensions() {
        assert!(!valid_png(b"not a picture"));
        let mut p = vec![0u8; 57];
        p[..8].copy_from_slice(b"\x89PNG\r\n\x1a\n");
        p[8..12].copy_from_slice(&13u32.to_be_bytes());
        p[12..16].copy_from_slice(b"IHDR");
        p[16..20].copy_from_slice(&1u32.to_be_bytes());
        p[20..24].copy_from_slice(&1u32.to_be_bytes());
        p[49..53].copy_from_slice(b"IEND");
        assert!(valid_png(&p));
        p[16..20].copy_from_slice(&99999u32.to_be_bytes());
        assert!(!valid_png(&p));
    }
    #[test]
    fn names_cannot_choose_directories() {
        let name = filename("../bad:C700\\door/\0", "png");
        assert!(!name.contains('/'));
        assert!(!name.contains('\\'));
        assert!(!name.contains(':'));
        assert!(name.ends_with(".png"));
    }
    #[test]
    fn export_ids_are_device_and_generation_scoped() {
        let e = Exports::default();
        let s = e
            .register(
                "h",
                1,
                "d",
                PathBuf::from("C:/Pictures/米家桌面/a.png"),
                "screenshot",
            )
            .unwrap();
        assert!(e.folder("h", 1, "d", &s.id).is_ok());
        assert!(e.folder("h", 2, "d", &s.id).is_err());
        assert!(e.folder("h", 1, "other", &s.id).is_err());
    }
}
