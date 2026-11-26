use super::journal::{Journal, Record};
use crate::error::{AppError, Result};
use std::{sync::Arc, time::Duration};
use tokio::sync::Notify;
pub struct Executor {
    pub journal: Arc<Journal>,
    pub changed: Notify,
}
impl Executor {
    pub fn new(journal: Arc<Journal>) -> Arc<Self> {
        Arc::new(Self {
            journal,
            changed: Notify::new(),
        })
    }
    pub async fn wait(
        &self,
        scope: &str,
        id: &str,
        after: Option<u64>,
        wait_ms: u64,
    ) -> Result<Record> {
        let deadline = tokio::time::Instant::now() + Duration::from_millis(wait_ms.min(5000));
        loop {
            let notified = self.changed.notified();
            let record = self
                .journal
                .lookup(scope, id)?
                .ok_or_else(|| AppError::new("notFound", "请求不存在。", false))?;
            if record.task_status != "running"
                || after.is_some_and(|v| record.revision > v)
                || tokio::time::Instant::now() >= deadline
            {
                return Ok(record);
            }
            if tokio::time::timeout_at(deadline, notified).await.is_err() {
                return self.journal.lookup(scope, id)?.ok_or_else(AppError::stale);
            }
        }
    }
}
