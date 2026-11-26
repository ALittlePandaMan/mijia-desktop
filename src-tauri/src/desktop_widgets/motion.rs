//! Transient world-coordinate previews. Never persisted with layout/device data.
use crate::widget_layout::{Geometry, PixelRect};
use std::{
    collections::BTreeMap,
    time::{Duration, Instant},
};
#[derive(Clone, Debug, PartialEq)]
pub struct Presentation {
    pub geometry: Geometry,
    pub rect: PixelRect,
    pub base_width: f64,
    pub scale: f64,
    pub preview: bool,
}
#[derive(Clone)]
struct Motion {
    from: Presentation,
    to: Presentation,
    at: Instant,
    settled: bool,
}
impl Motion {
    fn value(&self, now: Instant) -> Presentation {
        let t = if self.settled {
            1.
        } else {
            (now.saturating_duration_since(self.at).as_secs_f64() / 0.2).clamp(0., 1.)
        };
        // Smoothstep has exact endpoints and can be retargeted from any current frame.
        let t = t * t * (3. - 2. * t);
        let mix = |a: f64, b: f64| a + (b - a) * t;
        Presentation {
            geometry: self.to.geometry.clone(),
            rect: PixelRect {
                x: mix(self.from.rect.x, self.to.rect.x),
                y: mix(self.from.rect.y, self.to.rect.y),
                width: mix(self.from.rect.width, self.to.rect.width),
                height: mix(self.from.rect.height, self.to.rect.height),
            },
            base_width: mix(self.from.base_width, self.to.base_width),
            scale: mix(self.from.scale, self.to.scale),
            preview: true,
        }
    }
    fn active(&self, now: Instant) -> bool {
        !self.settled && now.saturating_duration_since(self.at) < Duration::from_millis(200)
    }
}
#[derive(Default)]
pub struct Previews {
    motions: BTreeMap<String, Motion>,
    dragged: BTreeMap<String, Presentation>,
}
impl Previews {
    pub fn active(&self) -> bool {
        self.motions.values().any(|m| !m.settled)
    }
    pub fn snap(
        &mut self,
        base: &BTreeMap<String, Presentation>,
        desired: &BTreeMap<String, Presentation>,
        dragged: &BTreeMap<String, Presentation>,
        now: Instant,
    ) -> BTreeMap<String, Presentation> {
        self.motions.clear();
        self.dragged = dragged.clone();
        let mut result = base.clone();
        for (id, to) in desired {
            self.motions.insert(
                id.clone(),
                Motion {
                    from: to.clone(),
                    to: to.clone(),
                    at: now,
                    settled: true,
                },
            );
            result.insert(id.clone(), to.clone());
        }
        result.extend(dragged.clone());
        result
    }
    pub fn resolve(
        &mut self,
        base: &BTreeMap<String, Presentation>,
        desired: &BTreeMap<String, Presentation>,
        dragged: &BTreeMap<String, Presentation>,
        now: Instant,
    ) -> BTreeMap<String, Presentation> {
        self.motions.retain(|id, _| base.contains_key(id));
        for (id, from) in &self.dragged {
            if !dragged.contains_key(id) {
                if let Some(to) = base.get(id).filter(|to| to.rect != from.rect) {
                    self.motions.insert(
                        id.clone(),
                        Motion {
                            from: from.clone(),
                            to: to.clone(),
                            at: now,
                            settled: false,
                        },
                    );
                }
            }
        }
        self.dragged = dragged.clone();
        for (id, baseline) in base {
            if dragged.contains_key(id) {
                self.motions.remove(id);
                continue;
            }
            let to = desired.get(id).unwrap_or(baseline);
            if let Some(old) = self.motions.get(id) {
                if old.to.geometry != to.geometry || old.to.rect != to.rect {
                    let from = old.value(now);
                    self.motions.insert(
                        id.clone(),
                        Motion {
                            from,
                            to: to.clone(),
                            at: now,
                            settled: false,
                        },
                    );
                }
            } else if to != baseline {
                self.motions.insert(
                    id.clone(),
                    Motion {
                        from: baseline.clone(),
                        to: to.clone(),
                        at: now,
                        settled: false,
                    },
                );
            }
        }
        self.motions
            .retain(|id, m| m.active(now) || desired.contains_key(id));
        let mut result = base.clone();
        for (id, m) in &mut self.motions {
            result.insert(id.clone(), m.value(now));
            m.settled = !m.active(now);
        }
        for (id, p) in dragged {
            result.insert(id.clone(), p.clone());
        }
        result
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn p(x: f64) -> Presentation {
        Presentation {
            geometry: Geometry {
                x,
                ..Default::default()
            },
            rect: PixelRect {
                x,
                y: 0.,
                width: 240.,
                height: 192.,
            },
            base_width: 240.,
            scale: 1.,
            preview: false,
        }
    }
    #[test]
    fn widget_swap_preview_reverses_without_touching_baseline() {
        let now = Instant::now();
        let base = BTreeMap::from([("b".into(), p(500.))]);
        let before = base.clone();
        let mut state = Previews::default();
        let desired = BTreeMap::from([("b".into(), p(0.))]);
        let start = state.resolve(&base, &desired, &BTreeMap::new(), now);
        assert_eq!(start["b"].rect.x, 500.);
        let half = state.resolve(
            &base,
            &desired,
            &BTreeMap::new(),
            now + Duration::from_millis(100),
        );
        assert!((half["b"].rect.x - 250.).abs() < 0.01);
        let reverse = state.resolve(
            &base,
            &BTreeMap::new(),
            &BTreeMap::new(),
            now + Duration::from_millis(100),
        );
        assert_eq!(half["b"].rect, reverse["b"].rect);
        let done = state.resolve(
            &base,
            &BTreeMap::new(),
            &BTreeMap::new(),
            now + Duration::from_millis(301),
        );
        assert_eq!(done["b"].rect.x, 500.);
        assert_eq!(base, before);
    }
    #[test]
    fn widget_commit_keeps_the_existing_preview_timeline() {
        let now = Instant::now();
        let base = BTreeMap::from([("b".into(), p(500.))]);
        let desired = BTreeMap::from([("b".into(), p(-300.))]);
        let mut state = Previews::default();
        state.resolve(&base, &desired, &BTreeMap::new(), now);
        let half = state.resolve(
            &desired,
            &BTreeMap::new(),
            &BTreeMap::new(),
            now + Duration::from_millis(100),
        );
        assert!((half["b"].rect.x - 100.).abs() < 0.01);
        let done = state.resolve(
            &desired,
            &BTreeMap::new(),
            &BTreeMap::new(),
            now + Duration::from_millis(201),
        );
        assert_eq!(done["b"].rect.x, -300.);
    }
    #[test]
    fn widget_reduced_motion_does_not_restart_a_settled_preview() {
        let now = Instant::now();
        let base = BTreeMap::from([("b".into(), p(500.))]);
        let desired = BTreeMap::from([("b".into(), p(0.))]);
        let mut state = Previews::default();
        assert_eq!(
            state.snap(&base, &desired, &BTreeMap::new(), now)["b"]
                .rect
                .x,
            0.
        );
        assert!(!state.active());
        for ms in [1, 16, 32, 201] {
            assert_eq!(
                state.resolve(
                    &base,
                    &desired,
                    &BTreeMap::new(),
                    now + Duration::from_millis(ms)
                )["b"]
                    .rect
                    .x,
                0.
            );
        }
    }
}
