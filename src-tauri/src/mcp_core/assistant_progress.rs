//! Durable execution boundaries; unchanged bounded progress needs no disk write.
use super::journal::Journal;
use crate::{cloud_assistant::protocol::Event, error::AppError};
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tokio_util::sync::CancellationToken;

pub struct Recorder {
    journal: Arc<Journal>, scope: String, id: String, started: Instant,
    cancel: CancellationToken, error: Mutex<Option<AppError>>, gate: Mutex<()>,
}
impl Recorder {
    pub fn new(journal: Arc<Journal>, scope: String, id: String, started: Instant, cancel: CancellationToken) -> Self {
        Self { journal, scope, id, started, cancel, error: Mutex::new(None), gate: Mutex::new(()) }
    }
    pub fn record(&self, event: Event) -> bool {
        let _gate = self.gate.lock().unwrap();
        let result = (|| {
            let Some(record) = self.journal.lookup(&self.scope, &self.id)? else { self.cancel.cancel(); return Ok(false); };
            // A poisoned journal projects admitted jobs as interrupted. They
            // must not begin a later submission just because lookup succeeds.
            if record.task_status != "running" { self.cancel.cancel(); return Ok(false); }
            let Some(mut task) = record.assistant else { self.cancel.cancel(); return Ok(false); };
            if !task.record_progress(event, self.started.elapsed().as_millis() as u64) { return Ok(false); }
            self.journal.assistant(&self.scope, &self.id, task)?;
            Ok(true)
        })();
        match result {
            Ok(changed) => changed,
            Err(error) => { self.error.lock().unwrap().get_or_insert(error); self.cancel.cancel(); false }
        }
    }
    pub fn error(&self) -> Option<AppError> { self.error.lock().unwrap().clone() }
}

#[cfg(test)]
mod tests;
