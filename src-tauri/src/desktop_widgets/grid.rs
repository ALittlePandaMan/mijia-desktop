//! Grid decisions are separate from input and device I/O. A drop changes at most two pins.
use super::*;
use crate::{
    widget_grid::{self, Anchor, Grid, Preset},
    widget_layout::{Layout, PixelRect},
};
use std::collections::BTreeMap;

#[derive(Clone)]
pub struct DropPlan {
    pub geometry: Geometry,
    pub changes: BTreeMap<String, Geometry>,
    pub valid: bool,
}
impl Widgets {
    pub(super) fn grid_for(layout: &Layout, screen: &platform::Display) -> Result<Grid> {
        Grid::padded(
            layout.grids.get(&screen.id).copied().unwrap_or_default(),
            screen.rect().width / screen.scale,
            screen.rect().height / screen.scale,
            layout.display(&screen.id).padding,
        )
    }
    /// All connected pins participate, including pins in other homes of this account.
    pub(super) fn normalized(
        mut layout: Layout,
        scope: &str,
        screens: &[platform::Display],
    ) -> Result<Layout> {
        for screen in screens
            .iter()
            .filter(|s| layout.display(&s.id).enabled)
            .collect::<Vec<_>>()
        {
            let ids: Vec<_> = layout
                .pins
                .values()
                .filter(|p| {
                    p.scope == scope
                        && (p.geometry.monitor == screen.id
                            || p.geometry.monitor.is_empty() && screen.primary)
                })
                .map(|p| p.id.clone())
                .collect();
            if ids.is_empty() {
                continue;
            }
            let grid = Self::grid_for(&layout, screen)?;
            let mut occupied = vec![];
            let mut waiting = vec![];
            for id in ids {
                let p = &layout.pins[&id];
                let saved = p
                    .layouts
                    .get(&screen.id)
                    .and_then(|m| m.get(grid.preset.key()))
                    .copied()
                    .or_else(|| {
                        p.geometry
                            .grid
                            .as_ref()
                            .filter(|g| g.preset == grid.preset)
                            .and_then(|_| widget_grid::anchor(&p.geometry))
                    });
                if let Some(a) = saved.filter(|a| {
                    grid.valid(*a) && occupied.iter().all(|b| !widget_grid::overlap(*a, *b))
                }) {
                    occupied.push(a);
                    Self::assign(&mut layout, &id, grid.geometry(&screen.id, a));
                } else {
                    waiting.push(id);
                }
            }
            for id in waiting {
                let p = &layout.pins[&id];
                let a = grid
                    .place(p.geometry.size, p.geometry.x, p.geometry.y, &occupied)
                    .ok_or_else(|| {
                        AppError::new(
                            "desktopGridFull",
                            "此栅格无法容纳全部卡片，已保留原布局。",
                            false,
                        )
                    })?;
                occupied.push(a);
                Self::assign(&mut layout, &id, grid.geometry(&screen.id, a));
            }
        }
        if !layout.displays.is_empty() {
            layout.version = 3;
        }
        Ok(layout)
    }
    pub(super) fn assign(layout: &mut Layout, id: &str, g: Geometry) {
        if let Some(p) = layout.pins.get_mut(id) {
            if let Some(a) = widget_grid::anchor(&g) {
                p.layouts
                    .entry(g.monitor.clone())
                    .or_default()
                    .insert(g.grid.as_ref().unwrap().preset.key().into(), a);
            }
            p.geometry = g;
        }
    }
    pub(super) fn ensure_grid(&self) -> Result<()> {
        let scope = self.current_scope()?;
        let mut store = self.store.lock().unwrap();
        let next = Self::normalized(store.layout.clone(), &scope, &platform::displays())?;
        if serde_json::to_vec(&next).ok() != serde_json::to_vec(&store.layout).ok() {
            store.save(next)?;
        }
        Ok(())
    }
    /// Disabled and disconnected screens keep their saved positions without fallback.
    pub(super) fn display_pins(&self, pins: Vec<Pin>, screens: &[platform::Display]) -> Vec<Pin> {
        let layout = self.store.lock().unwrap().layout.clone();
        pins.into_iter()
            .filter(|p| {
                layout.display(&p.geometry.monitor).enabled
                    && screens.iter().any(|s| s.id == p.geometry.monitor)
            })
            .collect()
    }
    pub(super) fn decide_drop(
        layout: &Layout,
        id: &str,
        g: &Geometry,
        resize: bool,
        screens: &[platform::Display],
    ) -> Result<DropPlan> {
        let pin = layout.pins.get(id).ok_or_else(AppError::stale)?;
        let screen = screens
            .iter()
            .find(|s| s.id == g.monitor)
            .ok_or_else(AppError::stale)?;
        if !layout.display(&screen.id).enabled {
            return Err(AppError::invalid("请先在设置中开启此屏幕的桌面卡片。"));
        }
        let grid = Self::grid_for(layout, screen)?;
        let a = grid.nearest(g.size, g.x, g.y);
        let snapped = grid.geometry(&screen.id, a);
        let mut changes = BTreeMap::new();
        changes.insert(id.into(), snapped.clone());
        let other: Vec<_> = layout
            .pins
            .values()
            .filter(|p| p.id != id && p.scope == pin.scope && p.geometry.monitor == g.monitor)
            .filter(|p| {
                widget_grid::anchor(&p.geometry).is_some_and(|b| widget_grid::overlap(a, b))
            })
            .collect();
        let mut valid = other.is_empty();
        if !resize && other.len() == 1 {
            let b = other[0];
            if let Some(source) = screens.iter().find(|s| s.id == pin.geometry.monitor) {
                let sg = Self::grid_for(layout, source)?;
                if let Some(mut back) = widget_grid::anchor(&pin.geometry) {
                    back.size = b.geometry.size;
                    valid = sg.valid(back)
                        && layout
                            .pins
                            .values()
                            .filter(|p| {
                                p.scope == pin.scope
                                    && p.id != id
                                    && p.id != b.id
                                    && p.geometry.monitor == source.id
                            })
                            .all(|p| {
                                widget_grid::anchor(&p.geometry)
                                    .is_none_or(|x| !widget_grid::overlap(back, x))
                            })
                        && (screen.id != source.id || !widget_grid::overlap(a, back));
                    if valid {
                        changes.insert(b.id.clone(), sg.geometry(&source.id, back));
                    }
                }
            }
        }
        Ok(DropPlan {
            geometry: snapped,
            changes,
            valid,
        })
    }
    pub(super) fn resize_geometry(
        layout: &Layout,
        id: &str,
        size: crate::preferences::CardSize,
        screens: &[platform::Display],
    ) -> Result<Geometry> {
        let pin = layout.pins.get(id).ok_or_else(AppError::stale)?;
        let screen = screens
            .iter()
            .find(|s| s.id == pin.geometry.monitor)
            .ok_or_else(AppError::stale)?;
        if !layout.display(&screen.id).enabled {
            return Err(AppError::invalid("请先在设置中开启此屏幕的桌面卡片。"));
        }
        let grid = Self::grid_for(layout, screen)?;
        let mut at = widget_grid::anchor(&pin.geometry)
            .unwrap_or_else(|| grid.nearest(pin.geometry.size, pin.geometry.x, pin.geometry.y));
        at.size = size;
        if size != crate::preferences::CardSize::Small {
            at.half_row = at.half_row / 2 * 2;
        }
        if !grid.valid(at) {
            return Err(AppError::new(
                "desktopGridOccupied",
                "周围空间不足，无法切换到此尺寸。",
                false,
            ));
        }
        let geometry = grid.geometry(&screen.id, at);
        if !Self::decide_drop(layout, id, &geometry, true, screens)?.valid {
            return Err(AppError::new(
                "desktopGridOccupied",
                "周围空间不足，无法切换到此尺寸。",
                false,
            ));
        }
        Ok(geometry)
    }
    pub(super) fn commit_drop(&self, id: &str, g: &Geometry, resize: bool) -> Result<()> {
        let mut store = self.store.lock().unwrap();
        let screens = platform::displays();
        let geometry = if resize {
            Self::resize_geometry(&store.layout, id, g.size, &screens)?
        } else {
            g.clone()
        };
        let plan = Self::decide_drop(&store.layout, id, &geometry, resize, &screens)?;
        if !plan.valid {
            return Err(AppError::new(
                "desktopGridOccupied",
                "该位置无法放置或交换卡片。",
                false,
            ));
        }
        if plan
            .changes
            .iter()
            .all(|(id, g)| store.layout.pins.get(id).is_some_and(|p| p.geometry == *g))
        {
            return Ok(());
        }
        let mut next = store.layout.clone();
        for (id, g) in plan.changes {
            Self::assign(&mut next, &id, g);
        }
        store.save(next)?;
        let mut views = self.views.lock().unwrap();
        for p in store.layout.pins.values() {
            if let Some(v) = views.get_mut(&p.id) {
                v.geometry = p.geometry.clone();
                v.revision = self.next();
            }
        }
        Ok(())
    }
    pub(super) fn grid_hints(
        &self,
        monitor: &str,
        screens: &[platform::Display],
    ) -> Vec<(PixelRect, &'static str)> {
        let drag = self
            .gestures
            .lock()
            .unwrap()
            .iter()
            .next()
            .map(|(id, d)| (id.clone(), d.geometry.clone()));
        let Some((id, g)) = drag.filter(|(_, g)| g.monitor == monitor) else {
            return vec![];
        };
        let Some(s) = screens.iter().find(|s| s.id == monitor) else {
            return vec![];
        };
        let layout = self.store.lock().unwrap().layout.clone();
        let Ok(grid) = Self::grid_for(&layout, s) else {
            return vec![];
        };
        let Some(pin) = layout.pins.get(&id) else {
            return vec![];
        };
        let occupied: Vec<_> = layout
            .pins
            .values()
            .filter(|p| p.scope == pin.scope && p.id != id && p.geometry.monitor == monitor)
            .filter_map(|p| widget_grid::anchor(&p.geometry))
            .collect();
        let mut hints: Vec<_> = grid
            .anchors(crate::preferences::CardSize::Small)
            .filter(|a| occupied.iter().all(|b| !widget_grid::overlap(*a, *b)))
            .filter_map(|a| {
                let full = Anchor {
                    half_row: a.half_row / 2 * 2,
                    size: crate::preferences::CardSize::Medium,
                    ..a
                };
                if occupied.iter().all(|b| !widget_grid::overlap(full, *b)) {
                    (a.half_row % 2 == 0).then_some((grid.rect(full), "empty"))
                } else {
                    Some((grid.rect(a), "empty"))
                }
            })
            .collect();
        if let Ok(plan) = Self::decide_drop(&layout, &id, &g, false, &screens) {
            hints.push((
                grid.rect(widget_grid::anchor(&plan.geometry).unwrap()),
                if plan.valid { "valid" } else { "invalid" },
            ));
        }
        for (r, _) in &mut hints {
            r.x = s.rect().x + r.x * s.scale;
            r.y = s.rect().y + r.y * s.scale;
            r.width *= s.scale;
            r.height *= s.scale;
        }
        hints
    }
}

/// Read-only display metadata keeps native enumeration and identifiers intact.
fn settings_snapshot(layout: &Layout, screens: &[platform::Display]) -> serde_json::Value {
    serde_json::json!({"supported":platform::supported(),"displays":screens.iter().enumerate().map(|(i,s)|serde_json::json!({"id":s.id,"name":format!("显示器 {}{}",i+1,if s.primary{" · 主屏幕"}else{""}),"primary":s.primary,"width":s.rect().width,"height":s.rect().height,"scale":s.scale,"enabled":layout.display(&s.id).enabled,"padding":layout.display(&s.id).padding,"preset":layout.grids.get(&s.id).copied().unwrap_or_default(),"available":([Preset::Six,Preset::Eight].into_iter().filter(|p|Grid::padded(*p,s.rect().width/s.scale,s.rect().height/s.scale,layout.display(&s.id).padding).is_ok()).collect::<Vec<_>>())})).collect::<Vec<_>>()})
}

#[tauri::command]
pub async fn desktop_widget_grids(
    window: WebviewWindow,
    app: tauri::AppHandle,
    monitor: Option<String>,
    preset: Option<Preset>,
    enabled: Option<bool>,
    padding: Option<crate::widget_layout::Padding>,
) -> Result<serde_json::Value> {
    main_only(&window)?;
    let w = app.state::<Arc<Widgets>>();
    if let Some(monitor) = monitor {
        let _lifecycle = w.lifecycle.lock().await;
        if !w.gestures.lock().unwrap().is_empty()
            || w.hosts
                .lock()
                .unwrap()
                .keys()
                .any(|label| platform::candidate(label))
        {
            return Err(AppError::new("busy", "请先结束卡片拖动。", true));
        }
        let screens = platform::displays();
        let screen = screens
            .iter()
            .find(|s| s.id == monitor)
            .ok_or_else(AppError::stale)?;
        {
            let mut store = w.store.lock().unwrap();
            let mut next = store.layout.clone();
            if let Some(p) = preset {
                next.grids.insert(monitor.clone(), p);
            }
            let mut preferences = next.display(&monitor);
            if let Some(value) = enabled {
                preferences.enabled = value;
            }
            if let Some(value) = padding {
                value.validate()?;
                preferences.padding = value;
            }
            next.displays.insert(monitor, preferences);
            next.version = 3;
            // A disabled screen can still be configured, but invalid padding never commits.
            if enabled != Some(false) || preset.is_some() || padding.is_some() {
                Widgets::grid_for(&next, screen)?;
            }
            // Validate every stored account, so a global screen preference cannot break another account.
            let scopes: std::collections::BTreeSet<_> =
                next.pins.values().map(|p| p.scope.clone()).collect();
            for scope in scopes {
                next = Widgets::normalized(next, &scope, &screens)?;
            }
            store.save(next)?;
        }
        drop(_lifecycle);
        w.contexts.lock().await.clear();
        w.refresh_deadlines.lock().unwrap().clear();
        if let Err(e) = w.reconcile().await {
            let _ = app.emit_to("main", "desktop-widget-error", e);
        }
        if let Err(e) = w.sync_hosts().await {
            let _ = app.emit_to("main", "desktop-widget-error", e);
        }
        w.refresh_wake.notify_one();
        let _ = app.emit_to("main", "desktop-widgets-changed", ());
    }
    let layout = w.store.lock().unwrap().layout.clone();
    Ok(settings_snapshot(&layout, &platform::displays()))
}

#[cfg(all(test, windows))]
mod tests {
    use super::*;
    use crate::preferences::CardSize::{Large, Medium, Small};
    fn screen(id: &str, x: i32, scale: f64) -> platform::Display {
        platform::Display {
            id: id.into(),
            x,
            y: 0,
            w: 2560,
            h: 1400,
            scale,
            primary: x == 0,
            full: PixelRect {
                x: x as f64,
                y: 0.,
                width: 2560.,
                height: 1440.,
            },
        }
    }
    fn pin(id: &str, scope: &str, home: &str, g: Geometry) -> Pin {
        Pin {
            id: id.into(),
            scope: scope.into(),
            home_id: home.into(),
            did: id.into(),
            name: id.into(),
            fingerprint: "fixture".into(),
            geometry: g,
            layouts: Default::default(),
        }
    }
    fn put(l: &mut Layout, id: &str, scope: &str, home: &str, g: Geometry) {
        if !g.monitor.is_empty() {
            l.displays.entry(g.monitor.clone()).or_default().enabled = true;
        }
        let p = pin(id, scope, home, g);
        l.pins.insert(id.into(), p);
    }
    fn a(c: u8, r: u8, size: crate::preferences::CardSize) -> Anchor {
        Anchor {
            column: c,
            half_row: r,
            size,
        }
    }
    fn geometry(l: &Layout, s: &platform::Display, a: Anchor) -> Geometry {
        Widgets::grid_for(l, s).unwrap().geometry(&s.id, a)
    }
    #[test]
    fn settings_snapshot_exposes_primary_without_renumbering_or_mutating_layout() {
        let screens = [screen("secondary", -2560, 1.25), screen("primary", 0, 1.5)];
        let layout = Layout::default();
        let before = serde_json::to_value(&layout).unwrap();
        let view = settings_snapshot(&layout, &screens);
        assert_eq!(view["displays"][0]["id"], "secondary");
        assert_eq!(view["displays"][0]["primary"], false);
        assert_eq!(view["displays"][0]["name"], "显示器 1");
        assert_eq!(view["displays"][1]["id"], "primary");
        assert_eq!(view["displays"][1]["primary"], true);
        assert_eq!(view["displays"][1]["name"], "显示器 2 · 主屏幕");
        assert_eq!(view["displays"][1]["scale"], 1.5);
        assert_eq!(serde_json::to_value(&layout).unwrap(), before);
    }
    #[test]
    fn only_two_cards_swap_no_sorting() {
        let s = screen("one", 0, 1.25);
        let mut l = Layout::default();
        for (id, c) in [("a", 0), ("b", 2), ("c", 4)] {
            let g = geometry(&l, &s, a(c, 0, Medium));
            put(&mut l, id, "account", "home", g);
        }
        let target = geometry(&l, &s, a(2, 0, Medium));
        let p = Widgets::decide_drop(&l, "a", &target, false, &[s]).unwrap();
        assert!(p.valid);
        assert_eq!(p.changes.len(), 2);
        assert_eq!(widget_grid::anchor(&p.changes["b"]).unwrap().column, 0);
        assert!(!p.changes.contains_key("c"));
    }
    #[test]
    fn widget_menu_size_selection_preserves_anchor_and_never_exchanges_neighbors() {
        let s = screen("one", -2560, 1.5);
        let mut layout = Layout::default();
        let g = geometry(&layout, &s, a(2, 2, Medium));
        put(&mut layout, "a", "account", "home", g);
        let neighbor = geometry(&layout, &s, a(3, 2, Medium));
        put(&mut layout, "b", "account", "home", neighbor);
        let before = serde_json::to_value(&layout).unwrap();
        assert!(Widgets::resize_geometry(&layout, "a", Large, &[s.clone()]).is_err());
        assert_eq!(before, serde_json::to_value(&layout).unwrap());
        let small = Widgets::resize_geometry(&layout, "a", Small, &[s.clone()]).unwrap();
        assert_eq!(widget_grid::anchor(&small).unwrap(), a(2, 2, Small));
        layout.pins.remove("b");
        let large = Widgets::resize_geometry(&layout, "a", Large, &[s.clone()]).unwrap();
        assert_eq!(widget_grid::anchor(&large).unwrap(), a(2, 2, Large));
        assert!(large.y + large.height() <= s.h as f64 / s.scale);
        layout.displays.get_mut("one").unwrap().enabled = false;
        assert!(Widgets::resize_geometry(&layout, "a", Medium, &[s]).is_err());
    }
    #[test]
    fn widget_menu_size_refuses_edge_growth_and_occupied_upper_half() {
        let s = screen("one", 0, 1.25);
        let mut layout = Layout::default();
        let g = geometry(&layout, &s, a(5, 0, Medium));
        put(&mut layout, "edge", "account", "home", g);
        assert!(Widgets::resize_geometry(&layout, "edge", Large, &[s.clone()]).is_err());
        for (id, row) in [("top", 0), ("bottom", 1)] {
            let g = geometry(&layout, &s, a(0, row, Small));
            put(&mut layout, id, "account", "home", g);
        }
        assert!(Widgets::resize_geometry(&layout, "bottom", Medium, &[s.clone()]).is_err());
        layout.pins.remove("top");
        assert_eq!(
            widget_grid::anchor(
                &Widgets::resize_geometry(&layout, "bottom", Medium, &[s]).unwrap()
            )
            .unwrap(),
            a(0, 0, Medium)
        );
    }
    #[test]
    fn multi_collision_and_resize_never_shuffle() {
        let s = screen("one", 0, 1.);
        let mut l = Layout::default();
        for (id, c) in [("a", 0), ("b", 2), ("c", 3)] {
            let g = geometry(&l, &s, a(c, 0, Medium));
            put(&mut l, id, "account", "home", g);
        }
        let target = geometry(&l, &s, a(2, 0, Large));
        assert!(
            !Widgets::decide_drop(&l, "a", &target, false, &[s.clone()])
                .unwrap()
                .valid
        );
        let target = geometry(&l, &s, a(2, 0, Medium));
        assert!(
            !Widgets::decide_drop(&l, "a", &target, true, &[s])
                .unwrap()
                .valid
        );
    }
    #[test]
    fn incompatible_half_slot_swap_rejected() {
        let s = screen("one", 0, 1.);
        let mut l = Layout::default();
        for (id, slot) in [("a", a(0, 1, Small)), ("b", a(2, 0, Medium))] {
            let g = geometry(&l, &s, slot);
            put(&mut l, id, "account", "home", g);
        }
        let target = geometry(&l, &s, a(2, 0, Small));
        assert!(
            !Widgets::decide_drop(&l, "a", &target, false, &[s])
                .unwrap()
                .valid
        );
    }
    #[test]
    fn cross_display_swap_uses_each_grid_and_dpi() {
        let one = screen("one", 0, 1.25);
        let two = screen("two", -2560, 1.5);
        let mut l = Layout::default();
        l.grids.insert("two".into(), Preset::Eight);
        let ga = geometry(&l, &one, a(1, 2, Medium));
        put(&mut l, "a", "account", "h1", ga);
        let gb = geometry(&l, &two, a(5, 6, Medium));
        put(&mut l, "b", "account", "h2", gb.clone());
        let p = Widgets::decide_drop(&l, "a", &gb, false, &[one, two]).unwrap();
        assert!(p.valid);
        assert_eq!(p.changes["a"].monitor, "two");
        assert_eq!(p.changes["b"].monitor, "one");
        assert_ne!(p.changes["a"].width, p.changes["b"].width);
    }
    #[test]
    fn presets_restore_positions_and_sizes() {
        let s = screen("one", 0, 1.25);
        let mut l = Layout::default();
        let g = geometry(&l, &s, a(3, 4, Medium));
        put(&mut l, "a", "account", "home", g);
        l = Widgets::normalized(l, "account", &[s.clone()]).unwrap();
        let original = l.pins["a"].geometry.clone();
        l.grids.insert("one".into(), Preset::Eight);
        l = Widgets::normalized(l, "account", &[s.clone()]).unwrap();
        let g = geometry(&l, &s, a(6, 8, Small));
        Widgets::assign(&mut l, "a", g.clone());
        l.grids.insert("one".into(), Preset::Six);
        l = Widgets::normalized(l, "account", &[s.clone()]).unwrap();
        assert_eq!(l.pins["a"].geometry, original);
        l.grids.insert("one".into(), Preset::Eight);
        l = Widgets::normalized(l, "account", &[s]).unwrap();
        assert_eq!(l.pins["a"].geometry, g);
    }
    #[test]
    fn same_account_other_homes_collide_other_accounts_do_not() {
        let s = screen("one", 0, 1.);
        let mut l = Layout::default();
        for (id, scope, home, c) in [
            ("a", "account", "h1", 0),
            ("b", "account", "h2", 2),
            ("c", "other", "h1", 4),
        ] {
            let g = geometry(&l, &s, a(c, 0, Medium));
            put(&mut l, id, scope, home, g);
        }
        let g = geometry(&l, &s, a(2, 0, Medium));
        assert_eq!(
            Widgets::decide_drop(&l, "a", &g, false, &[s.clone()])
                .unwrap()
                .changes
                .len(),
            2
        );
        let g = geometry(&l, &s, a(4, 0, Medium));
        assert_eq!(
            Widgets::decide_drop(&l, "a", &g, false, &[s])
                .unwrap()
                .changes
                .len(),
            1
        );
    }
    #[test]
    fn migration_deduplicates_positions_without_changing_identity() {
        let s = screen("one", 0, 1.);
        let mut l = Layout::default();
        l.version = 1;
        l.displays.entry("one".into()).or_default().enabled = true;
        for id in ["a", "b", "c"] {
            put(&mut l, id, "account", "home", Geometry::default());
        }
        let n = Widgets::normalized(l, "account", &[s]).unwrap();
        assert_eq!(n.version, 3);
        assert_eq!(n.pins.len(), 3);
        let slots: Vec<_> = n
            .pins
            .values()
            .map(|p| widget_grid::anchor(&p.geometry).unwrap())
            .collect();
        for (i, a) in slots.iter().enumerate() {
            assert!(slots
                .iter()
                .skip(i + 1)
                .all(|b| !widget_grid::overlap(*a, *b)));
        }
    }
    #[test]
    fn full_grid_change_is_atomic_and_disconnected_layout_untouched() {
        let s = screen("one", 0, 1.);
        let mut l = Layout::default();
        l.grids.insert("one".into(), Preset::Eight);
        for i in 0..25 {
            let g = geometry(&l, &s, a(i % 8, (i / 8) * 2, Medium));
            put(&mut l, &format!("p{i}"), "account", "home", g);
        }
        let before = serde_json::to_vec(&l).unwrap();
        let mut changed = l.clone();
        changed.grids.insert("one".into(), Preset::Six);
        assert!(Widgets::normalized(changed, "account", &[s.clone()]).is_err());
        assert_eq!(before, serde_json::to_vec(&l).unwrap());
        let detached =
            Widgets::normalized(l.clone(), "account", &[screen("elsewhere", 0, 1.5)]).unwrap();
        assert_eq!(detached.pins["p1"].geometry, l.pins["p1"].geometry);
    }
    #[test]
    fn disabled_screens_preserve_anchors_and_reenable_with_new_padding() {
        let s = screen("one", 0, 1.25);
        let mut l = Layout::default();
        let g = geometry(&l, &s, a(3, 4, Medium));
        put(&mut l, "a", "account", "home", g);
        l = Widgets::normalized(l, "account", &[s.clone()]).unwrap();
        let before = l.pins["a"].geometry.clone();
        l.displays.get_mut("one").unwrap().enabled = false;
        l.displays.get_mut("one").unwrap().padding.bottom = 180.;
        l = Widgets::normalized(l, "account", &[s.clone()]).unwrap();
        assert_eq!(before, l.pins["a"].geometry);
        assert!(Widgets::decide_drop(&l, "a", &before, false, &[s.clone()]).is_err());
        l.displays.get_mut("one").unwrap().enabled = true;
        let n = Widgets::normalized(l, "account", &[s]).unwrap();
        assert_eq!(
            widget_grid::anchor(&before),
            widget_grid::anchor(&n.pins["a"].geometry)
        );
        assert!(n.pins["a"].geometry.width < before.width);
    }
}
