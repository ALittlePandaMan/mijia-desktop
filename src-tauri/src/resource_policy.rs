//! Pure resource decisions, independently tested without HWNDs or WebViews.
use crate::widget_layout::PixelRect;
use serde::Serialize;

pub const VISIBLE_REFRESH_MS: u64 = 10_000;

pub(crate) fn monitor_background(shown: bool, minimized: bool, locked: bool) -> bool {
    !shown || minimized || locked
}

pub(crate) fn keep_main_webview_awake(
    exposed: bool,
    monitoring: bool,
    monitor_background: bool,
) -> bool {
    exposed || (monitoring && !monitor_background)
}

/// Subtract only confirmed opaque rectangles. Uncertain windows never hide UI.
/// A bounded fragment count makes pathological desktop layouts conservative.
pub fn exposed(target: PixelRect, opaque: &[PixelRect]) -> bool {
    if ![target.x, target.y, target.width, target.height]
        .iter()
        .all(|n| n.is_finite())
        || target.width <= 0.
        || target.height <= 0.
    {
        return true;
    }
    let mut remaining = vec![target];
    for cover in opaque {
        if ![cover.x, cover.y, cover.width, cover.height]
            .iter()
            .all(|n| n.is_finite())
            || cover.width <= 0.
            || cover.height <= 0.
        {
            continue;
        }
        let mut next = Vec::new();
        for r in remaining {
            let Some(c) = r.intersection(cover) else {
                next.push(r);
                continue;
            };
            for piece in [
                PixelRect {
                    x: r.x,
                    y: r.y,
                    width: r.width,
                    height: c.y - r.y,
                },
                PixelRect {
                    x: r.x,
                    y: c.y + c.height,
                    width: r.width,
                    height: r.y + r.height - c.y - c.height,
                },
                PixelRect {
                    x: r.x,
                    y: c.y,
                    width: c.x - r.x,
                    height: c.height,
                },
                PixelRect {
                    x: c.x + c.width,
                    y: c.y,
                    width: r.x + r.width - c.x - c.width,
                    height: c.height,
                },
            ] {
                if piece.width > 0. && piece.height > 0. {
                    next.push(piece);
                }
            }
        }
        if next.is_empty() {
            return false;
        }
        if next.len() > 128 {
            return true;
        }
        remaining = next;
    }
    true
}

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceState {
    pub version: u32,
    pub revision: u64,
    pub visible: bool,
    pub refresh_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub visible_cards: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub monitor_background: Option<bool>,
}
impl ResourceState {
    pub fn new(revision: u64, visible: bool) -> Self {
        Self {
            version: 1,
            revision,
            visible,
            refresh_ms: if visible {
                VISIBLE_REFRESH_MS
            } else {
                0
            },
            visible_cards: None,
            monitor_background: None,
        }
    }
}

/// A successful refresh advances the deadline. Reusing a cached inventory does not.
#[derive(Default)]
pub struct RefreshDeadline {
    pub last_success: Option<u64>,
    next_retry: u64,
    force: bool,
}
impl RefreshDeadline {
    pub fn due(&self, now: u64, visible: bool) -> bool {
        visible && now >= self.next_retry
            && (self.force
                || self.last_success.is_none_or(|at| {
                    now.saturating_sub(at) >= VISIBLE_REFRESH_MS
                }))
    }
    pub fn success(&mut self, now: u64) {
        self.last_success = Some(now);
        self.next_retry = 0;
        self.force = false;
    }
    pub fn wake(&mut self) {
        self.force = true;
    }
    pub fn failed(&mut self, now: u64, attempt: u32) {
        self.next_retry = now.saturating_add((2_000u64 << attempt.min(4)).min(30_000));
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn covered_monitor_does_not_suspend_but_hidden_minimized_and_locked_do() {
        let mut idle = crate::idle_policy::IdlePolicy::default();
        for now in [0, 30_001, 90_000] {
            let background = monitor_background(true, false, false);
            assert!(!background);
            assert!(!keep_main_webview_awake(false, false, background));
            idle.visibility(keep_main_webview_awake(false, true, background), now);
            idle.report(true, now);
            assert!(idle.attempt(now).is_none());
        }
        for (shown, minimized, locked) in [(false, false, false), (true, true, false), (true, false, true)] {
            assert!(monitor_background(shown, minimized, locked));
            assert!(!keep_main_webview_awake(false, true, monitor_background(shown, minimized, locked)));
        }
        idle.visibility(false, 90_001);
        idle.report(true, 120_001);
        let epoch = idle.attempt(120_001).expect("hidden monitor may suspend");
        assert!(idle.visibility(keep_main_webview_awake(false, true, false), 120_002));
        assert!(!idle.complete(epoch, true, 120_003));
    }
    fn r(x: f64, y: f64, w: f64, h: f64) -> PixelRect {
        PixelRect {
            x,
            y,
            width: w,
            height: h,
        }
    }
    #[test]
    fn complete_and_partial_cover() {
        assert!(!exposed(r(0., 0., 100., 100.), &[r(-1., -1., 102., 102.)]));
        assert!(exposed(r(0., 0., 100., 100.), &[r(0., 0., 99., 100.)]));
    }
    #[test]
    fn multiple_windows_cover_union() {
        assert!(!exposed(
            r(0., 0., 100., 100.),
            &[r(0., 0., 50., 100.), r(50., 0., 50., 100.)]
        ));
        assert!(exposed(
            r(0., 0., 100., 100.),
            &[r(0., 0., 49., 100.), r(50., 0., 50., 100.)]
        ));
    }
    #[test]
    fn another_monitor_does_not_hide_card() {
        assert!(exposed(
            r(-1920., 0., 200., 160.),
            &[r(0., 0., 2560., 1440.)]
        ));
    }
    #[test]
    fn unknown_bounds_remain_visible() {
        assert!(exposed(
            r(0., 0., f64::NAN, 100.),
            &[r(0., 0., 1000., 1000.)]
        ));
    }
    #[test]
    fn covered_polling_and_immediate_return() {
        let mut d = RefreshDeadline::default();
        assert!(!d.due(0, false));
        d.success(0);
        assert!(!d.due(119999, false));
        assert!(!d.due(120000, false));
        assert!(!d.due(9999, true));
        assert!(d.due(10000, true));
    }
    #[test]
    fn failure_backoff_is_not_success() {
        let mut d = RefreshDeadline::default();
        d.failed(0, 1);
        assert_eq!(d.last_success, None);
        assert!(!d.due(3999, true));
        assert!(d.due(4000, true));
    }
    #[test]
    fn returning_visible_does_not_relabel_old_data() {
        let mut d = RefreshDeadline::default();
        d.success(10);
        d.wake();
        assert_eq!(d.last_success, Some(10));
        assert!(d.due(20, true));
        d.failed(20, 1);
        assert!(!d.due(21, true));
    }
}
