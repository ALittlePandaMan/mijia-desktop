//! A captured button sequence is ended by its release event, never by a sampled
//! async key state (which can be zero for intercepted or inaccessible input).
use std::sync::atomic::{AtomicU64, AtomicU8, Ordering};

const DOWN: u8 = 1;
const ACTIVE: u8 = 2;
const CANCELLED: u8 = 4;
const MOVED: u8 = 8;
pub struct PointerSequence {
    start: (i32, i32),
    scale: f64,
    position: AtomicU64,
    flags: AtomicU8,
}
fn pack(p: (i32, i32)) -> u64 {
    (p.0 as u32 as u64) << 32 | p.1 as u32 as u64
}
fn unpack(p: u64) -> (i32, i32) {
    ((p >> 32) as u32 as i32, p as u32 as i32)
}
impl PointerSequence {
    pub fn new(start: (i32, i32), scale: f64) -> Self {
        Self {
            start,
            scale,
            position: AtomicU64::new(pack(start)),
            flags: AtomicU8::new(DOWN),
        }
    }
    pub fn point(&self) -> (i32, i32) {
        unpack(self.position.load(Ordering::Acquire))
    }
    pub fn sample(&self, p: (i32, i32), _elapsed_ms: u64) {
        let flags = self.flags.load(Ordering::Acquire);
        if flags & DOWN == 0 || flags & CANCELLED != 0 {
            return;
        }
        self.position.store(pack(p), Ordering::Release);
        if flags & ACTIVE == 0
            && crate::widget_grid::drag_intent(
                (p.0 - self.start.0) as f64,
                (p.1 - self.start.1) as f64,
                self.scale,
            )
        {
            self.flags.fetch_or(MOVED, Ordering::AcqRel);
        }
    }
    pub fn release(&self, p: (i32, i32)) {
        if self.flags.load(Ordering::Acquire) & DOWN == 0 {
            return;
        }
        self.sample(p, 0);
        self.position.store(pack(p), Ordering::Release);
        self.flags.fetch_and(!DOWN, Ordering::AcqRel);
    }
    pub fn cancel(&self) {
        self.flags
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |f| {
                Some((f | CANCELLED) & !DOWN)
            })
            .ok();
    }
    pub fn activate(&self) -> bool {
        self.flags
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |f| {
                if f & (DOWN | MOVED | ACTIVE) != 0 && f & CANCELLED == 0 {
                    Some(f | ACTIVE)
                } else {
                    None
                }
            })
            .is_ok()
    }
    pub fn status(&self, elapsed_ms: u64) -> (bool, bool, bool) {
        let f = self.flags.load(Ordering::Acquire);
        (
            f & DOWN != 0,
            f & CANCELLED != 0,
            elapsed_ms >= 280 || f & (ACTIVE | MOVED) != 0,
        )
    }
    pub fn suppress_click(&self, elapsed_ms: u64) -> bool {
        let f = self.flags.load(Ordering::Acquire);
        f & (ACTIVE | MOVED | CANCELLED) != 0 || elapsed_ms >= 280
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn captured_press_survives_80ms_without_release() {
        let p = PointerSequence::new((10, 20), 1.);
        assert_eq!(p.status(81), (true, false, false));
        assert_eq!(p.status(280), (true, false, true));
        assert!(p.activate());
        assert!(p.status(500).0);
    }
    #[test]
    fn early_release_cannot_activate() {
        let p = PointerSequence::new((0, 0), 1.);
        p.release((2, 3));
        assert!(!p.activate());
        assert!(!p.status(100).0);
        assert!(!p.suppress_click(100));
    }
    #[test]
    fn moved_capture_can_activate_before_hold_threshold() {
        let p = PointerSequence::new((20, 30), 1.);
        p.sample((60, 30), 40);
        assert!(p.activate());
        assert!(p.suppress_click(40));
        p.release((60, 30));
        assert_eq!(p.point(), (60, 30));
        assert!(!p.status(40).0);
    }
    #[test]
    fn finishing_an_old_sequence_cannot_change_a_new_press() {
        let old = PointerSequence::new((1, 2), 1.);
        old.release((5, 6));
        let next = PointerSequence::new((10, 20), 1.);
        old.cancel();
        assert_eq!(old.point(), (5, 6));
        assert_eq!(next.status(300), (true, false, true));
        assert_eq!(next.point(), (10, 20));
    }
    #[test]
    fn short_tap_decision_is_fixed_before_worker_retirement() {
        let p = PointerSequence::new((0, 0), 1.);
        let suppress = p.suppress_click(90);
        p.release((0, 0));
        p.cancel();
        assert!(!suppress);
    }
    #[test]
    fn release_outside_card_preserves_terminal_position() {
        let p = PointerSequence::new((0, 0), 1.5);
        assert!(p.activate());
        p.sample((-300, 1500), 400);
        p.release((-400, 1600));
        p.sample((100, 100), 500);
        p.release((1, 1));
        assert_eq!(p.point(), (-400, 1600));
        assert!(!p.status(500).0);
    }
    #[test]
    fn cancellation_is_terminal() {
        let p = PointerSequence::new((0, 0), 1.);
        p.cancel();
        assert!(!p.activate());
        p.sample((100, 100), 500);
        assert_eq!(p.status(500).0, false);
        assert!(p.status(500).1);
        assert_eq!(p.point(), (0, 0));
    }
    #[test]
    fn moving_before_hold_is_immediate_intent_and_survives_release() {
        let p = PointerSequence::new((0, 0), 1.5);
        p.sample((13, 0), 279);
        assert!(p.status(1).2);
        p.release((13, 0));
        assert!(p.activate());
        let p = PointerSequence::new((0, 0), 1.5);
        p.sample((100, 100), 300);
        assert!(p.status(300).2);
    }
    #[test]
    fn final_sample_before_first_tick_is_consumed_for_every_independent_sequence() {
        for scale in [1., 1.25, 1.5, 2.] {
            for n in 0..20 {
                let p = PointerSequence::new((-400, 300), scale);
                p.release((-400 + (4. * scale) as i32, 300));
                assert_eq!(p.status(0), (false, false, true));
                assert!(p.activate(), "sequence {n} at scale {scale}");
                assert!(p.suppress_click(0));
                p.sample((900, 800), 1);
                assert_eq!(p.point(), (-400 + (4. * scale) as i32, 300));
            }
        }
    }
}
