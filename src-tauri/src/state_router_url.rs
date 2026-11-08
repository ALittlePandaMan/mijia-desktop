use super::*;
use crate::router_url as url;

impl AppState {
    fn url_key(cloud: &Cloud, home: &str, did: &str) -> String {
        Self::classification_key(cloud, home, did, "url")
    }
    pub async fn read_router_url(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        mac: String,
    ) -> Result<url::Read> {
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        let report = self
            .handle(&cloud, url::load(&cloud, &device, &mac).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, false)
            .await?;
        let key = Self::url_key(
            &cloud,
            &home_id,
            &format!("{did}\n{}", mac.to_ascii_lowercase()),
        );
        let pending = self
            .router_url_pending
            .lock()
            .await
            .get(&key)
            .map(|p| p.change.clone());
        Ok(url::Read { report, pending })
    }
    pub async fn change_router_url(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: url::Change,
        confirm_only: bool,
    ) -> Result<url::Outcome> {
        let _guard = self.router_wifi_gate.lock().await;
        let (cloud, device, epoch) = self.router_context(&home_id, generation, &did).await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let key = Self::url_key(
            &cloud,
            &home_id,
            &format!("{did}\n{}", change.mac.to_ascii_lowercase()),
        );
        let mut report = self
            .handle(&cloud, url::load(&cloud, &device, &change.mac).await)
            .await?;
        self.ensure_router_context(&home_id, generation, epoch, &cloud, &device, !confirm_only)
            .await?;
        let existing = self.router_url_pending.lock().await.get(&key).cloned();
        let outcome = |r: url::Report, p: &url::Pending| {
            let done = url::confirmed(&r, p);
            url::Outcome {
                status: if done { "confirmed" } else { "uncertain" }.into(),
                message: if done {
                    "网址访问控制设置已回读确认。"
                } else {
                    "网址访问控制设置尚未回读确认，只会继续查询，不会重复发送。"
                }
                .into(),
                report: Some(r),
            }
        };
        if let Some(p) = existing {
            if p.change != change {
                return Err(AppError::new(
                    "busy",
                    "路由器上次网址访问控制修改尚未确认。",
                    false,
                ));
            }
            let result = outcome(report, &p);
            if result.status == "confirmed" {
                self.router_url_pending.lock().await.remove(&key);
                self.router_url_completed.lock().await.insert(key, p);
            }
            return Ok(result);
        }
        if confirm_only {
            let p = self
                .router_url_completed
                .lock()
                .await
                .get(&key)
                .cloned()
                .filter(|p| p.change == change)
                .ok_or_else(|| {
                    AppError::new(
                        "urlNoPending",
                        "没有待确认的网址访问控制修改，请读取当前设置。",
                        false,
                    )
                })?;
            return Ok(outcome(report, &p));
        }
        let (path, payload, p) = url::prepare(&device, &report, &change)?;
        if url::confirmed(&report, &p) {
            return Ok(outcome(report, &p));
        }
        self.router_url_completed.lock().await.remove(&key);
        self.router_url_pending
            .lock()
            .await
            .insert(key.clone(), p.clone());
        match self
            .handle(&cloud, cloud.request_router_url(path, payload).await)
            .await
        {
            Ok(_) => {}
            Err(e) if write_error_is_uncertain(&e) => {}
            Err(e) => {
                self.router_url_pending.lock().await.remove(&key);
                return Err(e);
            }
        }
        for delay in [350, 800, 1500] {
            tokio::time::sleep(Duration::from_millis(delay)).await;
            match self
                .handle(&cloud, url::load(&cloud, &device, &change.mac).await)
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
            if url::confirmed(&report, &p) {
                self.router_url_pending.lock().await.remove(&key);
                self.router_url_completed
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
