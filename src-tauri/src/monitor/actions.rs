//! Only viewing quality and local recording are exposed to monitor tiles.
use super::*;
use camera::media_control;
use serde::Deserialize;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Target {
    pub home_id: String,
    pub generation: u64,
    pub viewer_id: String,
    pub did: String,
    pub revision: u64,
}
#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
pub enum Operation {
    Quality {
        quality: String,
    },
    Record {
        enabled: bool,
        width: Option<u32>,
        height: Option<u32>,
        #[serde(rename = "lensId")]
        lens_id: Option<u8>,
        #[serde(rename = "atTimestamp")]
        at_timestamp: Option<u64>,
        #[serde(rename = "mediaGeneration")]
        media_generation: Option<u64>,
    },
}
impl Operation {
    pub fn starts_recording(&self) -> bool {
        matches!(self, Self::Record { enabled: true, .. })
    }
    pub fn into_camera(self) -> media_control::Operation {
        match self {
            Self::Quality { quality } => media_control::Operation::Quality { quality },
            Self::Record {
                enabled,
                width,
                height,
                lens_id,
                at_timestamp,
                media_generation,
            } => media_control::Operation::Record {
                enabled,
                width,
                height,
                lens_id,
                at_timestamp,
                media_generation,
            },
        }
    }
}
impl Registry {
    pub(crate) fn route(&self, target: &Target) -> Result<(Arc<Sessions>, String)> {
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let entries = group.entries.lock().map_err(|_| AppError::stale())?;
        let entry = entries
            .get(&target.did)
            .filter(|e| e.revision == target.revision)
            .ok_or_else(AppError::stale)?;
        Ok((
            entry.stream.clone(),
            entry.session.clone().ok_or_else(AppError::stale)?,
        ))
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub lease_id: String,
    pub features: media_control::Features,
}
pub type DetailRelease = (Arc<Sessions>, String, Vec<media_control::Operation>);
pub(super) struct Lease {
    id: String,
    pub playback: bool,
    pub listening: bool,
    pub talking: bool,
    closing: bool,
}
impl Registry {
    pub fn open_detail(&self, target: &Target) -> Result<Detail> {
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
        if entries.values().any(|e| e.detail.is_some()) {
            return Err(AppError::invalid("请先关闭当前设备详情。"));
        }
        let entry = entries
            .get_mut(&target.did)
            .filter(|e| e.revision == target.revision)
            .ok_or_else(AppError::stale)?;
        let lease_id = uuid::Uuid::new_v4().to_string();
        entry.detail = Some(Lease {
            id: lease_id.clone(),
            playback: false,
            listening: false,
            talking: false,
            closing: false,
        });
        let mut features = media_control::features(&entry.device.model);
        if entry.device.shared_read_only {
            features.talk = false;
            features.ptz = false;
            features.reason = Some("此共享设备仅有读取权限。");
        }
        Ok(Detail { lease_id, features })
    }
    pub fn detail_route(
        &self,
        target: &Target,
        lease: &str,
        playback: Option<bool>,
    ) -> Result<(Arc<Sessions>, String)> {
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
        let entry = entries
            .get_mut(&target.did)
            .filter(|e| e.revision == target.revision)
            .ok_or_else(AppError::stale)?;
        let detail = entry
            .detail
            .as_mut()
            .filter(|d| d.id == lease && !d.closing)
            .ok_or_else(AppError::stale)?;
        if let Some(value) = playback {
            detail.playback = value;
        }
        Ok((
            entry.stream.clone(),
            entry.session.clone().ok_or_else(AppError::stale)?,
        ))
    }
    pub fn detail_operation(
        &self,
        target: &Target,
        lease: &str,
        operation: &media_control::Operation,
    ) -> Result<()> {
        self.detail_route(target, lease, None)?;
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
        let d = entries
            .get_mut(&target.did)
            .filter(|e| e.revision == target.revision)
            .and_then(|e| e.detail.as_mut())
            .filter(|d| d.id == lease && !d.closing)
            .ok_or_else(AppError::stale)?;
        match operation {
            media_control::Operation::Talk { enabled: true } => d.talking = true,
            media_control::Operation::Listen { enabled: true } => d.listening = true,
            media_control::Operation::Playback { .. } => d.playback = true,

            _ => {}
        }
        Ok(())
    }
    pub fn detail_confirmed(
        &self,
        target: &Target,
        lease: &str,
        operation: &media_control::Operation,
    ) -> Result<()> {
        self.detail_route(target, lease, None)?;
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
        let d = entries
            .get_mut(&target.did)
            .filter(|e| e.revision == target.revision)
            .and_then(|e| e.detail.as_mut())
            .filter(|d| d.id == lease && !d.closing)
            .ok_or_else(AppError::stale)?;
        match operation {
            media_control::Operation::Talk { enabled } => d.talking = *enabled,
            media_control::Operation::Listen { enabled } => d.listening = *enabled,
            media_control::Operation::Live => d.playback = false,
            _ => {}
        }
        Ok(())
    }
    pub fn finish_detail(&self, target: &Target, lease: &str) {
        if let Ok(group) = self.group(&target.home_id, target.generation, &target.viewer_id) {
            if let Ok(mut entries) = group.entries.lock() {
                if let Some(entry) = entries.get_mut(&target.did).filter(|e| {
                    e.revision == target.revision
                        && e.detail
                            .as_ref()
                            .is_some_and(|d| d.id == lease && d.closing)
                }) {
                    entry.detail = None;
                }
            }
        }
    }
    pub fn release_detail(&self, target: &Target, lease: &str) -> Result<Option<DetailRelease>> {
        let group = self.group(&target.home_id, target.generation, &target.viewer_id)?;
        let mut entries = group.entries.lock().map_err(|_| AppError::stale())?;
        let entry = entries
            .get_mut(&target.did)
            .filter(|e| e.revision == target.revision)
            .ok_or_else(AppError::stale)?;
        if entry
            .detail
            .as_ref()
            .is_none_or(|d| d.id != lease || d.closing)
        {
            return Ok(None);
        }
        let detail = entry.detail.as_mut().unwrap();
        detail.closing = true;
        let mut operations = vec![];
        if detail.talking {
            operations.push(media_control::Operation::Talk { enabled: false });
        }
        if detail.listening {
            operations.push(media_control::Operation::Listen { enabled: false });
        }
        if detail.playback {
            operations.push(media_control::Operation::Live);
        }
        Ok(entry
            .session
            .clone()
            .map(|s| (entry.stream.clone(), s, operations)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn detail_lease_is_scoped_exclusive_and_closing_blocks_reopen() {
        let (registry, _, _, _) = super::super::tests::group();
        let target = Target {
            home_id: "h".into(),
            generation: 1,
            viewer_id: "opaque".into(),
            did: "a".into(),
            revision: 1,
        };
        let d = registry.open_detail(&target).unwrap();
        assert!(registry.open_detail(&target).is_err());
        assert!(registry.detail_route(&target, "other", None).is_err());
        let mut stale = target.clone();
        stale.revision = 2;
        assert!(registry.detail_route(&stale, &d.lease_id, None).is_err());
        registry
            .detail_operation(
                &target,
                &d.lease_id,
                &media_control::Operation::Talk { enabled: true },
            )
            .unwrap();
        let (_, _, ops) = registry
            .release_detail(&target, &d.lease_id)
            .unwrap()
            .unwrap();
        assert_eq!(ops.len(), 1);
        assert!(matches!(
            ops[0],
            media_control::Operation::Talk { enabled: false }
        ));
        assert!(registry.detail_route(&target, &d.lease_id, None).is_err());
        assert!(registry.open_detail(&target).is_err());
        registry.finish_detail(&target, &d.lease_id);
        assert!(registry.open_detail(&target).is_ok());
    }
    #[test]
    fn a_read_only_detail_close_never_sends_microphone_ptz_or_live_commands() {
        let (registry, _, _, _) = super::super::tests::group();
        let target = Target {
            home_id: "h".into(),
            generation: 1,
            viewer_id: "opaque".into(),
            did: "a".into(),
            revision: 1,
        };
        let d = registry.open_detail(&target).unwrap();
        let (_, _, ops) = registry
            .release_detail(&target, &d.lease_id)
            .unwrap()
            .unwrap();
        assert!(ops.is_empty());
    }
    #[test]
    fn offline_detail_needs_no_stream_and_releases_without_commands() {
        let (registry, group, _, _) = super::super::tests::group();
        {
            let mut entries = group.entries.lock().unwrap();
            let entry = entries.get_mut("a").unwrap();
            entry.session = None;
            entry.state = "closed".into();
        }
        let target = Target {
            home_id: "h".into(),
            generation: 1,
            viewer_id: "opaque".into(),
            did: "a".into(),
            revision: 1,
        };
        let d = registry.open_detail(&target).unwrap();
        assert!(registry.detail_route(&target, &d.lease_id, None).is_err());
        assert!(registry
            .release_detail(&target, &d.lease_id)
            .unwrap()
            .is_none());
        registry.finish_detail(&target, &d.lease_id);
        assert!(registry.open_detail(&target).is_ok());
    }
    #[test]
    fn monitor_operation_never_deserializes_device_or_audio_controls() {
        for value in [
            r#"{"kind":"ptz","direction":"left"}"#,
            r#"{"kind":"talk","enabled":true}"#,
            r#"{"kind":"listen","enabled":true}"#,
            r#"{"kind":"live"}"#,
            r#"{"kind":"playback","start":1,"channel":0}"#,
            r#"{"kind":"quality","quality":"sd","power":true}"#,
        ] {
            assert!(serde_json::from_str::<Operation>(value).is_err(), "{value}");
        }
        assert!(serde_json::from_str::<Operation>(r#"{"kind":"quality","quality":"hd"}"#).is_ok());
        assert!(serde_json::from_str::<Operation>(r#"{"kind":"record","enabled":false}"#).is_ok());
    }
}
