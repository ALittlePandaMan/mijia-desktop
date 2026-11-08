use super::*;
use crate::router_daily as daily;
impl AppState {
    pub async fn router_daily(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<daily::Report> {
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        let mut r = self.handle(&c, daily::read(&c, &d).await).await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        let key = format!(
            "{}\n{}\n{}\n{}",
            c.credentials.region, c.credentials.user_id, home_id, did
        );
        let pending = self.router_daily_attempts.lock().await.get(&key).cloned();
        if let Some(p) = pending {
            r.configuration_verified = self.handle(&c, daily::verify(&c, &d, &p).await).await?;
            r.optimization_pending = !r.configuration_verified;
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        Ok(r)
    }
    pub async fn scan_router_daily(
        &self,
        home_id: String,
        generation: u64,
        did: String,
    ) -> Result<daily::Report> {
        let _gate = self.router_wifi_gate.lock().await;
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        let r = self.handle(&c, daily::read(&c, &d).await).await?;
        if !r.supported {
            return Err(AppError::invalid("此路由器未提供Wi-Fi检测。"));
        }
        let path = if r.kind == "network" {
            daily::START
        } else {
            daily::SCAN_START
        };
        let value=self.handle(&c,c.request_router_daily_action(path,serde_json::json!({"method":"GET","params":{"deviceId":crate::router::gateway_id(&d)?}})).await).await?;
        crate::router_family::success(&value)?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        let mut r = r;
        r.ready = false;
        r.reason = None;
        Ok(r)
    }
    pub async fn optimize_router_daily(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        baseline: String,
    ) -> Result<daily::Report> {
        let _gate = self.router_wifi_gate.lock().await;
        let (c, d, e) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        let mut r = self.handle(&c, daily::read(&c, &d).await).await?;
        if !r.ready || r.reason.is_some() || r.revision != baseline {
            return Err(AppError::new(
                "conflict",
                "检测结果已变化，请重新检测。",
                false,
            ));
        }
        let attempt_key = format!(
            "{}\n{}\n{}\n{}",
            c.credentials.region, c.credentials.user_id, home_id, did
        );
        if self
            .router_daily_attempts
            .lock()
            .await
            .get(&attempt_key)
            .is_some_and(|p| p.baseline == baseline)
        {
            return Err(AppError::new(
                "dailyPending",
                "上次优化已提交，请核实网络连接，不重复发送。",
                false,
            ));
        }
        let mut params = serde_json::json!({"deviceId":crate::router::gateway_id(&d)?});
        let path = if r.kind == "network" {
            params["start_op"] = serde_json::json!(1);
            daily::APPLY
        } else {
            let first = r
                .suggested_channels
                .first()
                .copied()
                .flatten()
                .ok_or_else(|| AppError::invalid("尚无可用的推荐信道。"))?;
            params["channel1"] = serde_json::json!(first);
            if let Some(Some(channel)) = r.suggested_channels.get(1) {
                params["channel2"] = serde_json::json!(channel);
            }
            daily::SCAN_APPLY
        };
        self.ensure_router_context(&home_id, generation, e, &c, &d, true)
            .await?;
        {
            let mut attempts = self.router_daily_attempts.lock().await;
            if attempts.len() >= 64 {
                return Err(AppError::new("busy", "待核实的优化记录过多。", false));
            }
            attempts.insert(
                attempt_key.clone(),
                daily::Pending {
                    baseline,
                    channels: r.suggested_channels.clone(),
                    modern: r.kind == "network",
                },
            );
        }
        self.handle(
            &c,
            c.request_router_daily_action(
                path,
                serde_json::json!({"method":"GET","params":params}),
            )
            .await,
        )
        .await?;
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        let pending = self
            .router_daily_attempts
            .lock()
            .await
            .get(&attempt_key)
            .cloned()
            .ok_or_else(AppError::protocol)?;
        r.optimization_pending = true;
        for delay in [800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            if let Ok(true) = self.handle(&c, daily::verify(&c, &d, &pending).await).await {
                r.configuration_verified = true;
                r.optimization_pending = false;
                break;
            }
        }
        self.ensure_router_context(&home_id, generation, e, &c, &d, false)
            .await?;
        Ok(r)
    }
}
