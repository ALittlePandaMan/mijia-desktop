//! One prepared, fixed WorkerW child per enabled monitor. No device I/O here.
use super::*;
use crate::widget_layout::PixelRect;
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GesturePresentation {
    pub sequence: u64,
    pub kind: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CardPlacement {
    pub view: View,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub z: usize,
    pub interactive: bool,
    pub content_scale: f64,
    pub base_width: f64,
    pub preview: bool,
    pub gesture: Option<GesturePresentation>,
}
#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Viewport {
    pub monitor: String,
    pub width: f64,
    pub height: f64,
    pub scale: f64,
    pub clip: PixelRect,
}
#[derive(Clone, Serialize, PartialEq)]
pub struct GridHint {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub state: String,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HostFrame {
    pub revision: u64,
    pub reset: bool,
    pub viewport: Viewport,
    pub cards: Vec<CardPlacement>,
    pub removed: Vec<String>,
    pub hints: Vec<GridHint>,
}
#[derive(Clone)]
pub struct Host {
    pub bounds: PixelRect,
    pub viewport: Viewport,
    pub cards: Vec<CardPlacement>,
    pub revision: u64,
    pub menu: Option<PixelRect>,
    pub dirty: bool,
    pub ready: bool,
    pub hints: Vec<GridHint>,
}
#[derive(Clone)]
pub struct Drag {
    pub owner: String,
    pub native: platform::Gesture,
    pub geometry: Geometry,
}
fn label(monitor: &str) -> String {
    use sha2::{Digest, Sha256};
    format!("widget-host-{:x}", Sha256::digest(monitor.as_bytes()))
}
// Keep the HWND and renderer in the same coordinate space for the entire
// lifetime of a display. Moving a cropped HWND before JS repaints shows the
// previous card texture at the new origin for a frame.
fn host_bounds(work: PixelRect, scale: f64) -> PixelRect {
    PixelRect {
        x: work.x - 4. * scale,
        y: work.y - 4. * scale,
        width: work.width + 8. * scale,
        height: work.height + 8. * scale,
    }
    .rounded()
}
impl Widgets {
    pub(super) fn schedule_hosts(&self) {
        self.host_requested.store(true, Ordering::Release);
        if self.host_scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(Duration::from_millis(16)).await;
            let w = app.state::<Arc<Widgets>>();
            loop {
                w.host_requested.store(false, Ordering::Release);
                if let Err(e) = w.sync_hosts().await {
                    let _ = app.emit_to("main", "desktop-widget-error", e);
                }
                w.host_scheduled.store(false, Ordering::Release);
                // One worker, plus one pending request. Recheck after retiring
                // so a request arriving during sync cannot be lost or pile up.
                if !w.host_requested.load(Ordering::Acquire)
                    || w.host_scheduled.swap(true, Ordering::AcqRel)
                {
                    break;
                }
            }
        });
    }
    pub(super) async fn sync_hosts(&self) -> Result<()> {
        let _flight = self.host_flight.lock().await;
        let force = self.host_force.swap(false, Ordering::AcqRel);
        if self.stopped.load(Ordering::Acquire) {
            return Ok(());
        }
        if force && self.gestures.lock().unwrap().is_empty() {
            let _ = self.ensure_grid();
        }
        let scope = self.scope.lock().unwrap().clone();
        let pins: Vec<_> = self
            .store
            .lock()
            .unwrap()
            .layout
            .pins
            .values()
            .filter(|p| Some(&p.scope) == scope.as_ref())
            .cloned()
            .collect();
        let screens: Vec<_> = {
            let store = self.store.lock().unwrap();
            platform::displays()
                .into_iter()
                .filter(|s| scope.is_some() && store.layout.display(&s.id).enabled)
                .collect()
        };
        let pins = self.display_pins(pins, &screens);
        let drags = self.gestures.lock().unwrap().clone();
        let views = self.views.lock().unwrap().clone();
        let layout = self.store.lock().unwrap().layout.clone();
        let present = |geometry: &Geometry| {
            platform::project_on(geometry, true, &screens).map(|(s, r)| motion::Presentation {
                geometry: geometry.clone(),
                rect: r,
                base_width: geometry.width,
                scale: s.scale,
                preview: false,
            })
        };
        let baseline: BTreeMap<_, _> = pins
            .iter()
            .filter_map(|p| present(&p.geometry).map(|v| (p.id.clone(), v)))
            .collect();
        let mut desired = BTreeMap::new();
        for (id, d) in &drags {
            {
                if let Ok(plan) = Self::decide_drop(&layout, id, &d.geometry, false, &screens) {
                    if plan.valid {
                        for (other, g) in plan.changes {
                            if &other != id {
                                if let Some(p) = present(&g) {
                                    desired.insert(other, p);
                                }
                            }
                        }
                    }
                }
            }
        }
        let dragged: BTreeMap<_, _> = drags
            .iter()
            .filter_map(|(id, d)| {
                let mut p = present(&d.geometry)?;
                if let Some(rect) = platform::gesture_preview(&d.native) {
                    p.rect = rect;
                }
                p.base_width = platform::gesture_base_width(&d.native);
                p.scale = platform::gesture_scale(&d.native);
                Some((id.clone(), p))
            })
            .collect();
        let presentation = if self.reduced_motion.load(Ordering::Acquire) {
            self.previews
                .lock()
                .unwrap()
                .snap(&baseline, &desired, &dragged, Instant::now())
        } else {
            self.previews
                .lock()
                .unwrap()
                .resolve(&baseline, &desired, &dragged, Instant::now())
        };
        let mut groups: BTreeMap<String, Vec<(View, motion::Presentation, bool, usize)>> =
            screens.iter().map(|s| (s.id.clone(), vec![])).collect();
        for (z, pin) in pins.iter().enumerate() {
            let Some(mut view) = views.get(&pin.id).cloned() else {
                continue;
            };
            let Some(p) = presentation.get(&pin.id) else {
                continue;
            };
            view.geometry = p.geometry.clone();
            let center = (p.rect.x + p.rect.width / 2., p.rect.y + p.rect.height / 2.);
            let owner_screen = screens
                .iter()
                .find(|s| {
                    let r = s.rect();
                    center.0 >= r.x
                        && center.0 < r.x + r.width
                        && center.1 >= r.y
                        && center.1 < r.y + r.height
                })
                .map(|s| s.id.as_str())
                .unwrap_or(&p.geometry.monitor);
            for display in &screens {
                if p.rect.intersection(&display.rect()).is_none() {
                    continue;
                }
                // Capture lives in the native sequence, independent of its
                // originating WebView. Keep a current hit target for the next
                // press even before the previous worker consumes its release.
                let owner = owner_screen == display.id;
                groups.entry(display.id.clone()).or_default().push((
                    view.clone(),
                    p.clone(),
                    owner,
                    if drags.contains_key(&pin.id) {
                        usize::MAX / 2
                    } else {
                        z
                    },
                ));
            }
        }
        let desired: HashSet<_> = groups.keys().map(|id| label(id)).collect();
        let old_labels: Vec<_> = self
            .hosts
            .lock()
            .unwrap()
            .keys()
            .filter(|l| !desired.contains(*l))
            .cloned()
            .collect();
        for old in old_labels {
            platform::unregister(&old);
            if let Some(window) = self.app.get_webview_window(&old) {
                platform::hide(&window);
            }
            self.hosts.lock().unwrap().remove(&old);
            self.zooms.lock().unwrap().remove(&old);
            // Hosts now survive unpinning the last card. Removal only comes
            // from screen/account lifecycle changes, never from this host's IPC.
            if let Some(window) = self.app.get_webview_window(&old) {
                let _ = window.destroy();
            }
            self.app
                .state::<Arc<crate::resources::Resources>>()
                .forget(&old);
        }
        for (monitor, rows) in groups {
            let Some(screen) = screens.iter().find(|s| s.id == monitor) else {
                continue;
            };
            let name = label(&monitor);
            let previous = self.hosts.lock().unwrap().get(&name).cloned();
            let bounds = host_bounds(screen.rect(), screen.scale);
            let raw_hints = self.grid_hints(&monitor, &screens);
            let viewport = Viewport {
                monitor: monitor.clone(),
                width: bounds.width / screen.scale,
                height: bounds.height / screen.scale,
                scale: screen.scale,
                clip: PixelRect {
                    x: (screen.rect().x - bounds.x) / screen.scale,
                    y: (screen.rect().y - bounds.y) / screen.scale,
                    width: screen.rect().width / screen.scale,
                    height: screen.rect().height / screen.scale,
                },
            };
            let hints: Vec<_> = raw_hints
                .into_iter()
                .map(|(r, state)| GridHint {
                    x: (r.x - bounds.x) / screen.scale,
                    y: (r.y - bounds.y) / screen.scale,
                    width: r.width / screen.scale,
                    height: r.height / screen.scale,
                    state: state.into(),
                })
                .collect();
            let hints_changed = previous.as_ref().is_none_or(|p| p.hints != hints);
            let cards: Vec<_> = rows
                .into_iter()
                .map(|(view, p, interactive, z)| {
                    let r = p.rect;
                    CardPlacement {
                        content_scale: p.scale / screen.scale,
                        base_width: p.base_width,
                        preview: p.preview,
                        gesture: drags.get(&view.id).map(|d| GesturePresentation {
                            sequence: platform::gesture_sequence(&d.native),
                            kind: "move".into(),
                        }),
                        view,
                        x: (r.x - bounds.x) / screen.scale,
                        y: (r.y - bounds.y) / screen.scale,
                        width: r.width / screen.scale,
                        height: r.height / screen.scale,
                        interactive,
                        z,
                    }
                })
                .collect();
            let mut changed: Vec<_> = cards
                .iter()
                .filter(|c| {
                    previous
                        .as_ref()
                        .and_then(|h| h.cards.iter().find(|old| old.view.id == c.view.id))
                        .is_none_or(|old| !same_card(old, c))
                })
                .cloned()
                .collect();
            let removed: Vec<_> = previous
                .as_ref()
                .map(|h| {
                    h.cards
                        .iter()
                        .filter(|c| !cards.iter().any(|new| new.view.id == c.view.id))
                        .map(|c| c.view.id.clone())
                        .collect()
                })
                .unwrap_or_default();
            let viewport_changed = previous.as_ref().is_none_or(|h| h.viewport != viewport);
            if viewport_changed {
                changed = cards.clone();
            }
            let is_new = self.app.get_webview_window(&name).is_none();
            let revision = if is_new
                || hints_changed
                || viewport_changed
                || !changed.is_empty()
                || !removed.is_empty()
            {
                self.next()
            } else {
                previous.as_ref().unwrap().revision
            };
            let host = Host {
                hints: hints.clone(),
                bounds,
                viewport: viewport.clone(),
                cards,
                revision,
                menu: previous.as_ref().and_then(|p| p.menu),
                dirty: previous.as_ref().is_some_and(|p| p.dirty),
                ready: !is_new
                    && previous
                        .as_ref()
                        .is_some_and(|p| p.ready && !viewport_changed),
            };
            self.hosts
                .lock()
                .unwrap()
                .insert(name.clone(), host.clone());
            let window = if let Some(window) = self.app.get_webview_window(&name) {
                window
            } else {
                self.app
                    .state::<Arc<crate::resources::Resources>>()
                    .forget(&name);
                let window = self
                    .create_host_window(name.clone(), viewport.clone())
                    .await?;
                if let Err(e) = platform::attach(&window) {
                    let _ = window.destroy();
                    self.hosts.lock().unwrap().remove(&name);
                    return Err(e);
                }
                self.zooms.lock().unwrap().insert(name.clone(), 1.);
                window
            };
            if is_new || force || previous.as_ref().is_none_or(|h| h.bounds != bounds) {
                if let Err(e) = platform::apply_host(&window, &bounds).and_then(|_| {
                    if host.ready {
                        platform::show(&window)
                    } else {
                        platform::hide(&window);
                        Ok(())
                    }
                }) {
                    platform::unregister(&name);
                    platform::hide(&window);
                    return Err(e);
                }
            }
            if is_new
                || force
                || previous.as_ref().is_none_or(|h| {
                    h.bounds != bounds
                        || h.cards.len() != host.cards.len()
                        || h.cards.iter().zip(&host.cards).any(|(a, b)| {
                            a.x != b.x
                                || a.y != b.y
                                || a.width != b.width
                                || a.height != b.height
                                || a.interactive != b.interactive
                                || a.z != b.z
                        })
                })
            {
                self.register_host_targets(&window, &host);
            }
            if is_new
                || host.dirty
                || revision != previous.as_ref().map(|h| h.revision).unwrap_or(0)
            {
                let reset = is_new || previous.is_none() || host.dirty;
                let _ = self.app.emit_to(
                    &name,
                    "desktop-widget-host-state",
                    HostFrame {
                        revision,
                        reset,
                        viewport,
                        cards: if reset { host.cards.clone() } else { changed },
                        removed,
                        hints,
                    },
                );
                if let Some(host) = self.hosts.lock().unwrap().get_mut(&name) {
                    host.dirty = false;
                }
            }
        }
        if self.gestures.lock().unwrap().is_empty() && self.previews.lock().unwrap().active() {
            self.schedule_animation();
        }
        Ok(())
    }
    fn schedule_animation(&self) {
        if self.animation_scheduled.swap(true, Ordering::AcqRel) {
            return;
        }
        let app = self.app.clone();
        tauri::async_runtime::spawn(async move {
            let w = app.state::<Arc<Widgets>>();
            loop {
                tokio::time::sleep(Duration::from_millis(16)).await;
                if !w.gestures.lock().unwrap().is_empty() || w.stopped.load(Ordering::Acquire) {
                    break;
                }
                let active = w.previews.lock().unwrap().active();
                if let Err(e) = w.sync_hosts().await {
                    let _ = app.emit_to("main", "desktop-widget-error", e);
                    break;
                }
                if !active {
                    break;
                }
            }
            w.animation_scheduled.store(false, Ordering::Release);
            if w.gestures.lock().unwrap().is_empty() && w.previews.lock().unwrap().active() {
                w.schedule_animation();
            }
        });
    }
    #[cfg(windows)]
    async fn create_host_window(&self, name: String, viewport: Viewport) -> Result<WebviewWindow> {
        let main = self
            .app
            .get_webview_window("main")
            .ok_or_else(AppError::stale)?;
        let (tx, rx) = tokio::sync::oneshot::channel();
        let app = self.app.clone();
        // COM pointers remain in their UI apartment; only Tauri's completed
        // window handle crosses back to the async worker.
        main.with_webview(move |webview| {
            let result = tauri::WebviewWindowBuilder::new(
                &app,
                &name,
                tauri::WebviewUrl::App("widget.html".into()),
            )
            .with_environment(webview.environment())
            .title("米家桌面卡片")
            .inner_size(viewport.width.max(1.), viewport.height.max(1.))
            .transparent(true)
            .background_color(tauri::webview::Color(0, 0, 0, 0))
            .decorations(false)
            .shadow(false)
            .resizable(false)
            .maximizable(false)
            .minimizable(false)
            .skip_taskbar(true)
            .focused(false)
            .visible(false)
            .build()
            .map_err(crate::app_settings::storage);
            let _ = tx.send(result);
        })
        .map_err(crate::app_settings::storage)?;
        rx.await.map_err(crate::app_settings::storage)?
    }
    #[cfg(not(windows))]
    async fn create_host_window(&self, _: String, _: Viewport) -> Result<WebviewWindow> {
        Err(AppError::new(
            "unsupported",
            "当前平台不支持桌面组件。",
            false,
        ))
    }
    pub(super) fn register_host_targets(&self, window: &WebviewWindow, host: &Host) {
        if !host.ready {
            platform::set_targets(window, vec![]);
            return;
        }
        // Hit testing must survive controller suspension. Native desktop/icon
        // checks decide whether input is allowed; a sleeping page cannot wake itself.
        let mut targets: Vec<_> = host
            .cards
            .iter()
            .filter(|c| c.interactive)
            .map(|c| {
                (
                    c.view.id.clone(),
                    PixelRect {
                        x: host.bounds.x + c.x * host.viewport.scale,
                        y: host.bounds.y + c.y * host.viewport.scale,
                        width: c.width * host.viewport.scale,
                        height: c.height * host.viewport.scale,
                    },
                    20. * host.viewport.scale * c.content_scale,
                    c.base_width,
                    c.z,
                )
            })
            .collect();
        if let Some(menu) = host.menu {
            targets.push((
                "menu".into(),
                menu,
                10. * host.viewport.scale,
                240.,
                usize::MAX,
            ));
        }
        platform::set_targets(window, targets);
    }
    pub(super) fn host_snapshot(&self, window: &WebviewWindow) -> Result<HostFrame> {
        let hosts = self.hosts.lock().unwrap();
        let host = hosts.get(window.label()).ok_or_else(AppError::stale)?;
        Ok(HostFrame {
            revision: host.revision,
            reset: true,
            viewport: host.viewport.clone(),
            cards: host.cards.clone(),
            removed: vec![],
            hints: host.hints.clone(),
        })
    }
}
fn same_card(a: &CardPlacement, b: &CardPlacement) -> bool {
    a.view.revision == b.view.revision
        && a.x == b.x
        && a.y == b.y
        && a.width == b.width
        && a.height == b.height
        && a.z == b.z
        && a.interactive == b.interactive
        && a.content_scale == b.content_scale
        && a.base_width == b.base_width
        && a.preview == b.preview
        && a.gesture.as_ref().map(|g| (g.sequence, &g.kind))
            == b.gesture.as_ref().map(|g| (g.sequence, &g.kind))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn widget_host_coordinates_stay_fixed_across_repeated_drags_and_mixed_dpi() {
        for (x, y, scale) in [(0., 0., 1.), (-2560., -180., 1.5), (1920., 40., 1.25)] {
            let work = PixelRect {
                x,
                y,
                width: 1920.,
                height: 1040.,
            };
            let bounds = host_bounds(work, scale);
            assert!(bounds.x <= x - 3. * scale && bounds.y <= y - 3. * scale);
            assert!(bounds.x + bounds.width >= x + work.width + 3. * scale);
            // Idle, hold, free movement and release all use this same origin.
            for _ in 0..20 {
                for (cx, cy) in [(30., 25.), (600., 350.), (650., 380.), (600., 350.)] {
                    let css_x = (x + cx * scale - bounds.x) / scale;
                    let css_y = (y + cy * scale - bounds.y) / scale;
                    assert!((bounds.x + css_x * scale - (x + cx * scale)).abs() < 1e-6);
                    assert!((bounds.y + css_y * scale - (y + cy * scale)).abs() < 1e-6);
                }
                assert_eq!(host_bounds(work, scale), bounds);
            }
            let changed = host_bounds(
                PixelRect {
                    width: 1600.,
                    ..work
                },
                scale,
            );
            assert_ne!(changed, bounds);
        }
    }
}
