use super::*;
use crate::{router_access as access, router_whitelist as white};
fn outcome(r: access::Report, p: &access::Pending) -> access::Outcome {
    let done = access::confirmed(&r, p);
    let progress = if done { None } else { white::progress(&r, p) };
    let message = if done {
        "防蹭网设置已回读确认。"
    } else if progress.as_ref().is_some_and(|v| v.can_finish) {
        "白名单已开启，本机接入尚未保留。请完成设置；不会重复切换模式。"
    } else {
        "防蹭网设置尚未回读确认，只会继续查询，不会重复发送。"
    };
    access::Outcome {
        status: if done { "confirmed" } else { "uncertain" }.into(),
        message: message.into(),
        report: Some(r),
        white_progress: progress,
    }
}
impl AppState {
    pub async fn read_router_block_records(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<crate::router_block_records::Report> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let report = self
            .handle(
                &cloud,
                crate::router_block_records::load(&cloud, &device).await,
            )
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        Ok(report)
    }
    fn access_key(cloud: &Cloud, home: &str, did: &str) -> String {
        Self::classification_key(cloud, home, did, "access")
    }
    pub async fn read_router_access(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<access::Read> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let report = self
            .handle(&cloud, access::load(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = Self::access_key(&cloud, &home_id, &did);
        let record = self.router_access_pending.lock().await.get(&key).cloned();
        let white_progress = record.as_ref().and_then(|p| white::progress(&report, p));
        Ok(access::Read {
            report,
            pending: record.map(|p| p.change),
            white_progress,
        })
    }
    pub async fn router_whitelist_ready(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<white::Readiness> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let report = self
            .handle(&cloud, access::load(&cloud, &device).await)
            .await?;
        let ready = self
            .handle(&cloud, white::readiness(&cloud, &device, &report).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        Ok(ready)
    }
    pub async fn change_router_access(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: access::Change,
        confirm_only: bool,
        finish_white: bool,
    ) -> Result<access::Outcome> {
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let key = Self::access_key(&cloud, &home_id, &did);
        let mut report = self
            .handle(&cloud, access::load(&cloud, &device).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let existing = self.router_access_pending.lock().await.get(&key).cloned();
        let mut p;
        if let Some(record) = existing {
            if record.change != change {
                return Err(AppError::new(
                    "busy",
                    "路由器上次防蹭网修改尚未确认。",
                    false,
                ));
            }
            if access::confirmed(&report, &record) {
                self.router_access_pending.lock().await.remove(&key);
                self.router_access_completed
                    .lock()
                    .await
                    .insert(key, record.clone());
                return Ok(outcome(report, &record));
            }
            if !finish_white {
                return Ok(outcome(report, &record));
            }
            if white::decision(&report, &record, true, false) != white::Decision::RetainSelf {
                return Err(AppError::new(
                    "unavailable",
                    "本机保留步骤尚不能继续，请等待当前状态确认。",
                    false,
                ));
            }
            p = record;
        } else {
            if confirm_only {
                let record = self
                    .router_access_completed
                    .lock()
                    .await
                    .get(&key)
                    .cloned()
                    .filter(|p| p.change == change)
                    .ok_or_else(|| {
                        AppError::new(
                            "accessNoPending",
                            "没有待确认的防蹭网修改，请读取当前设置。",
                            false,
                        )
                    })?;
                return Ok(outcome(report, &record));
            }
            if finish_white {
                return Err(AppError::new(
                    "accessNoPending",
                    "没有需要完成的白名单设置。",
                    false,
                ));
            }
            if matches!(change.operation, access::Operation::WhiteMode) {
                let session = self
                    .handle(
                        &cloud,
                        white::Session::prepare(&cloud, &device, &report).await,
                    )
                    .await?;
                self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
                    .await?;
                p = white::pending(&report, &change, &session.mac)?;
                if access::confirmed(&report, &p) {
                    return Ok(outcome(report, &p));
                }
                self.router_access_completed.lock().await.remove(&key);
                self.router_access_pending
                    .lock()
                    .await
                    .insert(key.clone(), p.clone());
                match session.switch_white().await {
                    Ok(()) => {
                        p.white.as_mut().ok_or_else(AppError::protocol)?.phase =
                            white::Phase::SelfReady
                    }
                    Err(e) if write_error_is_uncertain(&e) => {}
                    Err(e) => {
                        self.router_access_pending.lock().await.remove(&key);
                        return Err(e);
                    }
                }
                self.router_access_pending
                    .lock()
                    .await
                    .insert(key.clone(), p.clone());
                // A later confirmation only reads. It cannot start the second
                // write after an uncertain local request without a new click.
                for delay in [250, 600, 1000] {
                    tokio::time::sleep(Duration::from_millis(delay)).await;
                    match self
                        .handle(&cloud, access::load(&cloud, &device).await)
                        .await
                    {
                        Ok(r) => report = r,
                        Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                            return Err(e)
                        }
                        Err(_) => continue,
                    }
                    self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                        .await?;
                    if access::confirmed(&report, &p)
                        || white::progress(&report, &p).is_some_and(|v| v.can_finish)
                    {
                        break;
                    }
                }
                if access::confirmed(&report, &p) {
                    self.router_access_pending.lock().await.remove(&key);
                    self.router_access_completed
                        .lock()
                        .await
                        .insert(key, p.clone());
                    return Ok(outcome(report, &p));
                }
                if white::decision(&report, &p, false, true) != white::Decision::RetainSelf {
                    return Ok(outcome(report, &p));
                }
            } else {
                let (path, payload, record) = access::prepare(&device, &report, &change)?;
                p = record;
                if access::confirmed(&report, &p) {
                    return Ok(outcome(report, &p));
                }
                self.router_access_completed.lock().await.remove(&key);
                self.router_access_pending
                    .lock()
                    .await
                    .insert(key.clone(), p.clone());
                self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
                    .await?;
                match self
                    .handle(&cloud, cloud.request_router_access(path, payload).await)
                    .await
                {
                    Ok(_) => {}
                    Err(e) if write_error_is_uncertain(&e) => {}
                    Err(e) => {
                        self.router_access_pending.lock().await.remove(&key);
                        return Err(e);
                    }
                }
            }
        }
        if p.white.is_some() {
            let payload = white::self_payload(&device, &p)?;
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
                .await?;
            p.white.as_mut().ok_or_else(AppError::protocol)?.phase = white::Phase::SelfPending;
            self.router_access_pending
                .lock()
                .await
                .insert(key.clone(), p.clone());
            match self
                .handle(
                    &cloud,
                    cloud.request_router_access(access::EDIT, payload).await,
                )
                .await
            {
                Ok(_) => {}
                Err(e) if write_error_is_uncertain(&e) => {}
                Err(e) if e.kind == "authExpired" => return Err(e),
                Err(_) => {
                    p.white.as_mut().ok_or_else(AppError::protocol)?.phase =
                        white::Phase::SelfReady;
                    self.router_access_pending
                        .lock()
                        .await
                        .insert(key.clone(), p.clone());
                    return Ok(outcome(report, &p));
                }
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(&cloud, access::load(&cloud, &device).await)
                .await
            {
                Ok(r) => report = r,
                Err(e) if matches!(e.kind.as_str(), "authExpired" | "staleContext") => {
                    return Err(e)
                }
                Err(_) => continue,
            }
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            if access::confirmed(&report, &p) {
                self.router_access_pending.lock().await.remove(&key);
                self.router_access_completed
                    .lock()
                    .await
                    .insert(key, p.clone());
                return Ok(outcome(report, &p));
            }
        }
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        Ok(outcome(report, &p))
    }
}
