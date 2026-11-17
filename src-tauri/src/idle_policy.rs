//! Deterministic lifecycle policy; no platform handles and no wall-clock dates.
use serde::Serialize;
#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct IdlePolicy {
    pub epoch: u64,
    pub hidden: bool,
    pub idle: bool,
    pub pending: bool,
    pub suspended: bool,
    pub attempts: u64,
    pub successes: u64,
    pub unsupported: bool,
    hidden_at: u64,
    idle_at: u64,
    last_report: u64,
    next_retry: u64,
}
impl IdlePolicy {
    pub fn visibility(&mut self, visible: bool, now: u64) -> bool {
        if visible == !self.hidden {
            return false;
        }
        self.epoch += 1;
        self.hidden = !visible;
        self.pending = false;
        self.suspended = false;
        self.hidden_at = now;
        self.next_retry = now;
        visible
    }
    pub fn report(&mut self, idle: bool, now: u64) {
        self.last_report = now;
        if self.idle != idle {
            self.idle = idle;
            self.idle_at = now;
            if !idle {
                self.epoch += 1;
                self.pending = false;
                self.suspended = false;
            }
        }
    }
    pub fn attempt(&mut self, now: u64) -> Option<u64> {
        if !self.hidden
            || !self.idle
            || self.pending
            || self.suspended
            || self.unsupported
            || now.saturating_sub(self.last_report) > 5000
            || now.saturating_sub(self.hidden_at.max(self.idle_at)) < 30000
            || now < self.next_retry
        {
            return None;
        }
        self.pending = true;
        self.attempts += 1;
        Some(self.epoch)
    }
    pub fn complete(&mut self, epoch: u64, success: bool, now: u64) -> bool {
        if self.epoch != epoch || !self.hidden || !self.idle {
            return false;
        }
        self.pending = false;
        self.suspended = success;
        self.next_retry = now + 30000;
        if success {
            self.successes += 1;
        }
        true
    }
    pub fn wake(&mut self) {
        self.epoch += 1;
        self.hidden = false;
        self.suspended = false;
        self.pending = false;
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn ready() -> IdlePolicy {
        let mut p = IdlePolicy::default();
        p.visibility(false, 0);
        p.report(true, 0);
        p.report(true, 30000);
        p
    }
    #[test]
    fn waits_for_idle_and_hidden() {
        let mut p = ready();
        assert_eq!(p.attempt(29999), None);
        assert_eq!(p.attempt(30000), Some(p.epoch));
        assert_eq!(p.attempt(30001), None);
    }
    #[test]
    fn records_and_pending_work_restart_idle_deadline() {
        let mut p = ready();
        p.report(false, 30001);
        assert_eq!(p.attempt(60000), None);
        p.report(true, 60000);
        assert_eq!(p.attempt(60001), None);
        p.report(true, 90000);
        assert!(p.attempt(90000).is_some());
    }
    #[test]
    fn no_heartbeat_no_suspension() {
        let mut p = ready();
        assert_eq!(p.attempt(36000), None);
    }
    #[test]
    fn old_callback_cannot_suspend_restored_window() {
        let mut p = ready();
        let epoch = p.attempt(30000).unwrap();
        p.wake();
        assert!(!p.complete(epoch, true, 30001));
        assert!(!p.suspended);
    }
    #[test]
    fn failed_attempt_is_backed_off() {
        let mut p = ready();
        let epoch = p.attempt(30000).unwrap();
        assert!(p.complete(epoch, false, 30001));
        p.report(true, 40000);
        assert_eq!(p.attempt(40000), None);
        p.report(true, 60001);
        assert!(p.attempt(60001).is_some());
    }
    #[test]
    fn suspension_needs_no_frontend_heartbeat() {
        let mut p = ready();
        let epoch = p.attempt(30000).unwrap();
        p.complete(epoch, true, 30001);
        assert!(p.suspended);
        assert_eq!(p.attempt(200000), None);
    }
}
