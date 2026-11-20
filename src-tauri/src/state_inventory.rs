//! Inventory-only MCP contexts and narrowly scoped property observations.
use super::*;

pub(super) fn retain_matching_panels(inner: &mut Inner, devices: &[Device]) {
    let binding = |d: &Device| {
        crate::mcp_core::fingerprint(&(
            crate::widget_layout::device_fingerprint(d),
            &d.firmware_version,
            &d.plugin_version,
            d.shared_read_only,
            &d.unsupported_reason,
        ))
    };
    let valid: HashMap<_, _> = devices.iter().map(|d| (&d.did, binding(d))).collect();
    let old: HashMap<_, _> = inner.devices.iter().map(|d| (&d.did, binding(d))).collect();
    let changed: std::collections::HashSet<_> = old
        .iter()
        .filter(|(id, fp)| valid.get(*id) != Some(*fp))
        .map(|(id, _)| (*id).clone())
        .collect();
    inner.panels.retain(|did, _| !changed.contains(did));
    inner
        .panel_updated_at
        .retain(|did, _| !changed.contains(did));
    inner.property_versions.retain(|key, _| {
        !changed
            .iter()
            .any(|did| key.starts_with(&format!("{did}\n")))
    });
    if !changed.is_empty() {
        inner.state_revision += 1;
    }
}

impl AppState {
    /// Authenticated inventory supplied only by another Rust context of this account.
    pub(crate) async fn sync_widget_inventory(
        &self,
        home: &str,
        devices: Vec<Device>,
    ) -> Result<()> {
        let mut inner = self.inner.lock().await;
        let generation = inner.generation;
        inner.check(home, generation)?;
        retain_matching_panels(&mut inner, &devices);
        inner.devices = devices;
        Ok(())
    }
    /// Widgets refresh only their bound home, never an all-home catalog or panels.
    pub(crate) async fn refresh_widget_inventory(&self) -> Result<()> {
        let (home, generation) = self.context_identity().await?;
        let (cloud, descriptor) = {
            let inner = self.inner.lock().await;
            inner.check(&home, generation)?;
            (
                inner.cloud.clone().ok_or_else(AppError::auth)?,
                inner
                    .homes
                    .iter()
                    .find(|h| h.id == home)
                    .cloned()
                    .ok_or_else(AppError::stale)?,
            )
        };
        let devices = self
            .handle(&cloud, cloud.devices(&descriptor).await)
            .await?;
        self.sync_widget_inventory(&home, devices).await?;
        self.mark_inventory(&home).await;
        Ok(())
    }
    pub(crate) async fn select_inventory(&self, home_id: String) -> Result<()> {
        let (cloud, home, generation) = {
            let mut inner = self.inner.lock().await;
            let home = inner
                .homes
                .iter()
                .find(|h| h.id == home_id)
                .cloned()
                .ok_or_else(AppError::stale)?;
            inner.clear_home();
            inner.selected = Some(home_id.clone());
            (
                inner.cloud.clone().ok_or_else(AppError::auth)?,
                home,
                inner.generation,
            )
        };
        let devices = self.handle(&cloud, cloud.devices(&home).await).await?;
        let mut inner = self.inner.lock().await;
        inner.check(&home_id, generation)?;
        inner.devices = devices;
        drop(inner);
        self.mark_inventory(&home_id).await;
        Ok(())
    }
    #[cfg(test)]
    pub(crate) async fn mcp_snapshot(&self) -> Result<Self> {
        let (home, generation) = self.context_identity().await?;
        self.shared_context(true, Some((&home, generation))).await
    }
}
