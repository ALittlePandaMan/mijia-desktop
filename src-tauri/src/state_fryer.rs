use super::*;
use crate::fryer_control as fryer;

impl AppState {
    async fn ensure_fryer(
        &self,
        home: &str,
        generation: u64,
        c: &Arc<Cloud>,
        p: &DevicePanel,
        write: bool,
    ) -> Result<()> {
        let i = self.inner.lock().await;
        if !i.cloud.as_ref().is_some_and(|v| Arc::ptr_eq(v, c)) {
            return Err(AppError::stale());
        }
        if write {
            i.check_control(home, generation, p)?;
        } else {
            i.check_panel(home, generation, p)?;
        }
        fryer::validate(p)
    }
    pub async fn fryer(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<fryer::Snapshot> {
        let (c, d) = self.device(&home_id, generation, &did).await?;
        let p = self.specs.panel(&d).await?;
        self.ensure_fryer(&home_id, generation, &c, &p, false)
            .await?;
        let r = self.handle(&c, fryer::read(&c, &p).await).await?;
        self.ensure_fryer(&home_id, generation, &c, &p, false)
            .await?;
        Ok(r)
    }
    pub async fn change_fryer(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
        request_id: String,
        change: fryer::Change,
    ) -> Result<fryer::Changed> {
        if request_id.len() != 36
            || !request_id
                .chars()
                .all(|c| c.is_ascii_hexdigit() || c == '-')
        {
            return Err(AppError::invalid("操作标识无效。"));
        }
        let _gate = self.fryer_write.lock().await;
        let (c, d) = self.device(&home_id, generation, &did).await?;
        let p = self.specs.panel(&d).await?;
        self.ensure_fryer(&home_id, generation, &c, &p, true)
            .await?;
        let before = self.handle(&c, fryer::read(&c, &p).await).await?;
        self.ensure_fryer(&home_id, generation, &c, &p, true)
            .await?;
        let key = format!(
            "{}:{}:{}:{}:{}",
            c.credentials.region, c.credentials.user_id, generation, did, request_id
        );
        let signature = serde_json::to_string(&change).map_err(|_| AppError::protocol())?;
        {
            let seen = self.fryer_requests.lock().await;
            if let Some(previous) = seen.get(&key) {
                if previous != &signature {
                    return Err(AppError::invalid("操作标识已被使用。"));
                }
                return Ok(fryer::Changed {
                    confirmed: fryer::matches(&before, &change),
                    report: before,
                });
            }
        }
        if before.revision != baseline {
            return Err(AppError::new(
                "conflict",
                "设备任务已变化，请按当前状态重新操作。",
                true,
            ));
        }
        let commands = fryer::commands(&p, &before, &change, crate::models::epoch_secs())?;
        {
            let mut seen = self.fryer_requests.lock().await;
            if seen.len() >= 1024 {
                return Err(AppError::new(
                    "busy",
                    "操作记录已满，请重新启动软件。",
                    false,
                ));
            }
            seen.insert(key, signature);
        }
        for command in commands {
            self.ensure_fryer(&home_id, generation, &c, &p, true)
                .await?;
            let sent = match command {
                fryer::Command::Write(id, value) => self
                    .handle(&c, c.write(p.control_did(), 2, id, value).await)
                    .await
                    .map(|_| ()),
                fryer::Command::Action(id, values) => self
                    .handle(&c, c.action(p.control_did(), 2, id, values).await)
                    .await
                    .map(|_| ()),
            };
            if let Err(e) = sent {
                if !write_error_is_uncertain(&e) {
                    return Err(e);
                }
                break;
            }
        }
        let mut latest = before;
        for delay in [250, 650, 1200] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            self.ensure_fryer(&home_id, generation, &c, &p, false)
                .await?;
            match self.handle(&c, fryer::read(&c, &p).await).await {
                Ok(r) => {
                    latest = r;
                    if fryer::matches(&latest, &change) {
                        break;
                    }
                }
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => {}
            }
        }
        self.ensure_fryer(&home_id, generation, &c, &p, false)
            .await?;
        Ok(fryer::Changed {
            confirmed: fryer::matches(&latest, &change),
            report: latest,
        })
    }
}
