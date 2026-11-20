//! Camera privacy sleep is a descriptor-bound device property, never VideoStop.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{DevicePanel, Property, Service},
    spec,
};
use serde::Serialize;
use serde_json::Value;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub awake: Option<bool>,
    pub supported: bool,
    pub writable: bool,
    pub reason: Option<String>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Changed {
    pub report: Snapshot,
    pub confirmed: bool,
}

/// The standard dual-camera plugin explicitly selects the whole-device service
/// by its descriptor identity, not the first `on` or the first camera service.
/// Per-lens services such as "Camera Control0" and "Camera Control10" must never
/// receive a whole-device sleep command.
pub fn global_service(panel: &DevicePanel) -> Option<&Service> {
    let mut services = panel.services.iter().filter(|s| s.name == "camera-control");
    let first = services.next()?;
    if services.next().is_none() {
        if first
            .description
            .trim()
            .strip_prefix("Camera Control")
            .is_some_and(|suffix| {
                let suffix = suffix.trim();
                !suffix.is_empty() && suffix.chars().all(|c| c.is_ascii_digit())
            })
        {
            return None;
        }
        return Some(first);
    }
    let mut global = panel
        .services
        .iter()
        .filter(|s| s.name == "camera-control" && s.description.trim() == "Camera Control");
    let candidate = global.next()?;
    global.next().is_none().then_some(candidate)
}

pub fn binding(panel: &DevicePanel) -> Option<&Property> {
    let mut candidates = global_service(panel)?.properties.iter().filter(|p| {
        p.name == "on"
            && p.format == "bool"
            && p.access.iter().any(|a| a == "read")
            && p.unsupported_reason.is_none()
    });
    let candidate = candidates.next()?;
    candidates.next().is_none().then_some(candidate)
}
pub fn snapshot(panel: &DevicePanel, read_only: bool, online: bool) -> Snapshot {
    let p = binding(panel);
    let awake = p
        .filter(|_| online)
        .filter(|p| p.code == Some(0))
        .and_then(|p| p.value.as_ref())
        .and_then(Value::as_bool);
    let writable = online && !read_only && p.is_some_and(|p| p.access.iter().any(|a| a == "write"));
    let reason = if p.is_none() {
        Some("此型号未提供可核实的休眠／唤醒属性。")
    } else if !online {
        Some("摄像机离线。")
    } else if read_only {
        Some("此共享设备只有读取权限。")
    } else if !writable {
        Some("此型号的休眠状态仅支持读取。")
    } else if awake.is_none() {
        Some("尚未读到摄像机的休眠状态。")
    } else {
        None
    };
    Snapshot {
        awake,
        supported: p.is_some(),
        writable,
        reason: reason.map(str::to_owned),
    }
}
pub async fn read(
    cloud: &Cloud,
    panel: &DevicePanel,
    read_only: bool,
    online: bool,
) -> Result<Snapshot> {
    let Some(p) = binding(panel) else {
        return Ok(snapshot(panel, read_only, online));
    };
    if !online {
        return Ok(snapshot(panel, read_only, false));
    }
    let mut actual = panel.clone();
    let rows = cloud.read_panel_property(panel, p.siid, p.piid).await?;
    spec::apply_property_read(&mut actual, &rows, p.siid, p.piid);
    let mut state = snapshot(&actual, read_only, true);
    // A stale negative cloud read must not turn a working picture into sleep.
    // Confirm a negative result independently; neither read writes the device.
    if state.awake == Some(false) {
        let rows = cloud.read_panel_property(panel, p.siid, p.piid).await?;
        spec::apply_property_read(&mut actual, &rows, p.siid, p.piid);
        state = snapshot(&actual, read_only, true);
    }
    if state.awake.is_none() {
        return Err(AppError::new(
            "cameraStateUnknown",
            "暂时无法读取摄像机休眠状态。",
            true,
        ));
    }
    Ok(state)
}

/// Bounded local command history contains no credentials, addresses or media.
pub fn record(model: &str, did: &str, awake: bool, outcome: &str) {
    static LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());
    let Ok(_guard) = LOCK.lock() else {
        return;
    };
    let Some(base) = crate::platform_paths::local_data_dir() else {
        return;
    };
    let path = std::path::PathBuf::from(base)
        .join("io.mijiadesktop.client")
        .join("camera-power-history.json");
    let mut rows = std::fs::metadata(&path)
        .ok()
        .filter(|m| m.len() <= 65536)
        .and_then(|_| std::fs::read(&path).ok())
        .and_then(|b| serde_json::from_slice::<Vec<Value>>(&b).ok())
        .unwrap_or_default();
    let digest = ring::digest::digest(&ring::digest::SHA256, did.as_bytes());
    let device = digest.as_ref()[..8]
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect::<String>();
    rows.push(serde_json::json!({"time":crate::models::epoch_secs(),"model":model,"device":device,"awake":awake,"source":"property_write","outcome":outcome}));
    if rows.len() > 64 {
        rows.drain(..rows.len() - 64);
    }
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(bytes) = serde_json::to_vec(&rows) {
        let _ = std::fs::write(path, bytes);
    }
}
