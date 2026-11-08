use super::*;
use crate::router_family as family;
fn outcome(report: family::Report, p: &family::Pending) -> family::Outcome {
    let confirmed = family::confirmed(&report, p);
    family::Outcome {
        status: if confirmed { "confirmed" } else { "uncertain" }.into(),
        message: if confirmed {
            "家人上网保护已回读确认。"
        } else {
            "家人上网保护尚未回读确认，只会继续查询，不会重复发送。"
        }
        .into(),
        report: Some(report),
    }
}
impl AppState {
    fn family_key(cloud: &Cloud, home: &str, did: &str) -> String {
        Self::classification_key(cloud, home, did, "family")
    }
    pub async fn read_router_family(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<family::Read> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let key = Self::family_key(&cloud, &home_id, &did);
        let pending = self.router_family_pending.lock().await.get(&key).cloned();
        let own = pending
            .as_ref()
            .filter(|p| p.change.mac.eq_ignore_ascii_case(&mac));
        let mut report = self
            .handle(
                &cloud,
                if let Some(p) = own {
                    family::read_pending(&cloud, &device, p).await
                } else {
                    family::load(&cloud, &device, &mac, None).await
                },
            )
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        if pending.is_some() && own.is_none() {
            report.write_reason =
                Some("路由器上次家人设置尚未确认，请先完成该设置的状态确认。".into());
        }
        Ok(family::Read {
            report,
            pending: own.map(|p| p.change.clone()),
        })
    }
    pub async fn change_router_family(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: family::Change,
        confirm_only: bool,
    ) -> Result<family::Outcome> {
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let key = Self::family_key(&cloud, &home_id, &did);
        let existing = self.router_family_pending.lock().await.get(&key).cloned();
        if let Some(p) = existing {
            if p.change != change {
                return Err(AppError::new("busy", "路由器上次家人设置尚未确认。", false));
            }
            let r = self
                .handle(&cloud, family::read_pending(&cloud, &device, &p).await)
                .await?;
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            let result = outcome(r, &p);
            if result.status == "confirmed" {
                self.router_family_pending.lock().await.remove(&key);
                self.router_family_completed.lock().await.insert(key, p);
            }
            return Ok(result);
        }
        if confirm_only {
            let p = self
                .router_family_completed
                .lock()
                .await
                .get(&key)
                .cloned()
                .filter(|p| p.change == change)
                .ok_or_else(|| {
                    AppError::new(
                        "familyNoPending",
                        "没有待确认的家人设置，请读取当前配置。",
                        false,
                    )
                })?;
            let r = self
                .handle(&cloud, family::read_pending(&cloud, &device, &p).await)
                .await?;
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            return Ok(outcome(r, &p));
        }
        let mut r = self
            .handle(
                &cloud,
                family::load(&cloud, &device, &change.mac, None).await,
            )
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, true)
            .await?;
        let (payload, p) = family::prepare(&device, &r, &change)?;
        if family::confirmed(&r, &p) {
            return Ok(outcome(r, &p));
        }
        self.router_family_completed.lock().await.remove(&key);
        self.router_family_pending
            .lock()
            .await
            .insert(key.clone(), p.clone());
        match self
            .handle(&cloud, cloud.request_router_family(payload).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.router_family_pending.lock().await.remove(&key);
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(&cloud, family::read_pending(&cloud, &device, &p).await)
                .await
            {
                Ok(actual) => r = actual,
                Err(e) if e.kind == "authExpired" || e.kind == "staleContext" => return Err(e),
                Err(_) => continue,
            }
            self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
                .await?;
            if family::confirmed(&r, &p) {
                self.router_family_pending.lock().await.remove(&key);
                self.router_family_completed
                    .lock()
                    .await
                    .insert(key, p.clone());
                return Ok(outcome(r, &p));
            }
        }
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        Ok(outcome(r, &p))
    }
}
