use super::*;
use crate::router_qos as qos;

impl AppState {
    fn qos_key(cloud: &Cloud, home: &str, did: &str) -> String {
        Self::classification_key(cloud, home, did, "qos")
    }
    pub async fn read_router_qos(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        mac: Option<String>,
    ) -> Result<qos::Read> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let report = self
            .handle(&cloud, qos::load(&cloud, &device, mac.as_deref()).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = Self::qos_key(&cloud, &home_id, &did);
        let pending = self
            .router_qos_pending
            .lock()
            .await
            .get(&key)
            .map(|p| p.change.clone());
        Ok(qos::Read { report, pending })
    }
    pub async fn change_router_qos(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: qos::Change,
        confirm_only: bool,
    ) -> Result<qos::Outcome> {
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let key = Self::qos_key(&cloud, &home_id, &did);
        let mut report = self
            .handle(
                &cloud,
                qos::load(&cloud, &device, change.mac.as_deref()).await,
            )
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let existing = self.router_qos_pending.lock().await.get(&key).cloned();
        let outcome = |r: qos::Report, p: &qos::Pending| {
            let done = qos::confirmed(&r, p);
            qos::Outcome {
                status: if done { "confirmed" } else { "uncertain" }.into(),
                message: if done {
                    "智能限速设置已回读确认。"
                } else {
                    "智能限速设置尚未回读确认，只会继续查询，不会重复发送。"
                }
                .into(),
                report: Some(r),
            }
        };
        if let Some(p) = existing {
            if p.change != change {
                return Err(AppError::new(
                    "busy",
                    "路由器上次智能限速修改尚未确认。",
                    false,
                ));
            }
            let result = outcome(report, &p);
            if result.status == "confirmed" {
                self.router_qos_pending.lock().await.remove(&key);
                self.router_qos_completed.lock().await.insert(key, p);
            }
            return Ok(result);
        }
        if confirm_only {
            let p = self
                .router_qos_completed
                .lock()
                .await
                .get(&key)
                .cloned()
                .filter(|p| p.change == change)
                .ok_or_else(|| {
                    AppError::new(
                        "qosNoPending",
                        "没有待确认的智能限速修改，请读取当前设置。",
                        false,
                    )
                })?;
            return Ok(outcome(report, &p));
        }
        let (path, payload, p) = qos::prepare(&device, &report, &change)?;
        if qos::confirmed(&report, &p) {
            return Ok(outcome(report, &p));
        }
        self.router_qos_completed.lock().await.remove(&key);
        self.router_qos_pending
            .lock()
            .await
            .insert(key.clone(), p.clone());
        match self
            .handle(&cloud, cloud.request_router_qos(path, payload).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.router_qos_pending.lock().await.remove(&key);
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(
                    &cloud,
                    qos::load(&cloud, &device, change.mac.as_deref()).await,
                )
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
            if qos::confirmed(&report, &p) {
                self.router_qos_pending.lock().await.remove(&key);
                self.router_qos_completed
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
