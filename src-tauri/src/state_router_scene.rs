use super::*;
use crate::router_scene as scene;
fn key(c: &Cloud, _home: &str, did: &str) -> String {
    format!("{}\n{}\n{did}", c.credentials.user_id, c.credentials.region)
}
impl AppState {
    pub async fn router_scene(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<scene::Report> {
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let mut r = self.handle(&c, scene::load(&c, &d).await).await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        if let Some(p) = self
            .router_scene_attempts
            .lock()
            .await
            .get_mut(&key(&c, &home_id, &did))
        {
            scene::observe(&mut r, p);
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn router_scene_history(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        kind: scene::Kind,
        days: u8,
        page: u16,
    ) -> Result<scene::History> {
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let r = self
            .handle(&c, scene::history(&c, &d, kind, days, page).await)
            .await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn router_scene_detail(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        kind: scene::Kind,
        id: String,
    ) -> Result<scene::Row> {
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let r = self
            .handle(&c, scene::detail(&c, &d, kind, &id).await)
            .await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn start_router_scene(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: scene::Change,
    ) -> Result<scene::Report> {
        scene::valid_change(&change)?;
        let _gate = self.router_wifi_gate.lock().await;
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let k = key(&c, &home_id, &did);
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        // A replay never starts a second test, including when the first reply was lost.
        let previous = { self.router_scene_attempts.lock().await.get(&k).cloned() };
        if scene::start_decision(previous.as_ref(), &change)? == scene::StartDecision::Read {
            return self.router_scene(home_id, generation, did).await;
        }
        let r = self.handle(&c, scene::load(&c, &d).await).await?;
        self.handle(&c, scene::check_available(&c, &d).await)
            .await?;
        let resume = self
            .router_scene_attempts
            .lock()
            .await
            .get(&k)
            .is_some_and(|p| p.change == change && p.stage == "configured");
        if !r.start_enabled || (!resume && r.revision != change.baseline) {
            return Err(AppError::new(
                "conflict",
                "测速配置或运行状态已变化，请查看最新状态。",
                false,
            ));
        }
        let need_config = !scene::same_selection(&r.selected, &change.selected);
        let mut prior = previous
            .as_ref()
            .map(|p| p.prior.clone())
            .unwrap_or_default();
        if let Some(p) = previous
            .as_ref()
            .filter(|p| p.change.request_id != change.request_id)
        {
            prior.push(p.change.clone());
        }
        if prior.len() > 128 {
            return Err(AppError::new(
                "busy",
                "本次会话的测速操作记录已达上限。",
                false,
            ));
        }
        if resume && need_config {
            return Err(AppError::new(
                "conflict",
                "测速项目已变化，请重新打开页面。",
                false,
            ));
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        {
            let mut records = self.router_scene_attempts.lock().await;
            if records.len() >= 64 && !records.contains_key(&k) {
                return Err(AppError::new("busy", "待确认的测速记录过多。", false));
            }
            records.insert(
                k.clone(),
                scene::Pending {
                    prior,
                    created_at: crate::models::epoch_secs(),
                    change: change.clone(),
                    before: r.fingerprint,
                    stage: if need_config {
                        "configuring"
                    } else {
                        "starting"
                    }
                    .into(),
                    observed_running: false,
                },
            );
        }
        if need_config {
            self.handle(
                &c,
                scene::write(&c, &d, &scene::config_command(&change.selected)?).await,
            )
            .await?;
            let fresh = self
                .router_scene(home_id.clone(), generation, did.clone())
                .await?;
            if !scene::same_selection(&fresh.selected, &change.selected) || !fresh.start_enabled {
                return Ok(fresh);
            }
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        if let Some(p) = self.router_scene_attempts.lock().await.get_mut(&k) {
            p.stage = "starting".into();
        }
        self.handle(&c, scene::write(&c, &d, "manualstart").await)
            .await?;
        self.router_scene(home_id, generation, did).await
    }
    pub async fn stop_router_scene(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<scene::Report> {
        let _gate = self.router_wifi_gate.lock().await;
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let k = key(&c, &home_id, &did);
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        let r = self.handle(&c, scene::load(&c, &d).await).await?;
        let previous = { self.router_scene_attempts.lock().await.get(&k).cloned() };
        if r.start_enabled
            && previous
                .as_ref()
                .is_some_and(|p| ["configuring", "configured"].contains(&p.stage.as_str()))
        {
            if let Some(p) = self.router_scene_attempts.lock().await.get_mut(&k) {
                p.stage = "stopped".into();
            }
            return self.router_scene(home_id, generation, did).await;
        }
        if previous.as_ref().is_some_and(|p| p.stage == "stopping")
            || r.start_enabled
                && previous.as_ref().is_none_or(|p| {
                    !["starting", "running", "unconfirmed"].contains(&p.stage.as_str())
                })
        {
            return self.router_scene(home_id, generation, did).await;
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        {
            let mut records = self.router_scene_attempts.lock().await;
            if let Some(p) = records.get_mut(&k) {
                p.stage = "stopping".into();
            } else {
                if records.len() >= 64 {
                    return Err(AppError::new("busy", "待确认的测速记录过多。", false));
                }
                records.insert(
                    k,
                    scene::Pending {
                        prior: vec![],
                        created_at: crate::models::epoch_secs(),
                        change: scene::Change {
                            request_id: uuid::Uuid::new_v4().to_string(),
                            baseline: r.revision,
                            selected: r.selected,
                        },
                        before: r.fingerprint,
                        stage: "stopping".into(),
                        observed_running: false,
                    },
                );
            }
        }
        self.handle(&c, scene::write(&c, &d, "manualstop").await)
            .await?;
        self.router_scene(home_id, generation, did).await
    }
}
