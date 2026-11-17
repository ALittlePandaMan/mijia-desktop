//! Pure desktop grid arithmetic. Coordinates are work-area DIP, never pixels.
use crate::{
    error::{AppError, Result},
    preferences::CardSize,
    widget_layout::{Geometry, PixelRect},
};
use serde::{Deserialize, Serialize};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub enum Preset {
    #[default]
    #[serde(rename = "6x4")]
    Six,
    #[serde(rename = "8x6")]
    Eight,
}
impl Preset {
    pub fn dimensions(self) -> (u8, u8) {
        match self {
            Self::Six => (6, 4),
            Self::Eight => (8, 6),
        }
    }
    pub fn key(self) -> &'static str {
        match self {
            Self::Six => "6x4",
            Self::Eight => "8x6",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Anchor {
    pub column: u8,
    pub half_row: u8,
    pub size: CardSize,
}
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Placement {
    pub preset: Preset,
    pub column: u8,
    pub half_row: u8,
    pub step: f64,
}
#[derive(Clone, Copy, Debug)]
pub struct Grid {
    pub left: f64,
    pub top: f64,
    pub preset: Preset,
    pub cell_w: f64,
    pub cell_h: f64,
    pub width: f64,
    pub height: f64,
}
impl Grid {
    pub fn new(preset: Preset, width: f64, height: f64) -> Result<Self> {
        let (c, r) = preset.dimensions();
        let cell_w = (width - 24. - (c - 1) as f64 * 12.) / c as f64;
        let cell_h = (height - 24. - (r - 1) as f64 * 12.) / r as f64;
        let w = cell_w.min(cell_h / 0.8);
        if !w.is_finite() || w < 120. {
            return Err(AppError::new(
                "desktopGridTooSmall",
                "此显示器的可用空间不足以使用该栅格。",
                false,
            ));
        }
        Ok(Self {
            left: 0.,
            top: 0.,
            preset,
            cell_w,
            cell_h,
            width: w,
            height: w * 0.8,
        })
    }
    pub fn padded(
        preset: Preset,
        width: f64,
        height: f64,
        padding: crate::widget_layout::Padding,
    ) -> Result<Self> {
        padding.validate()?;
        let mut grid = Self::new(
            preset,
            width - padding.left - padding.right,
            height - padding.top - padding.bottom,
        )?;
        grid.left = padding.left;
        grid.top = padding.top;
        Ok(grid)
    }
    pub fn valid(self, a: Anchor) -> bool {
        let (c, r) = self.preset.dimensions();
        a.column < c
            && a.half_row < r * 2
            && (a.size == CardSize::Small || a.half_row % 2 == 0)
            && (a.size != CardSize::Large || a.column + 1 < c)
    }
    pub fn anchors(self, size: CardSize) -> impl Iterator<Item = Anchor> {
        let (c, r) = self.preset.dimensions();
        (0..r * 2)
            .flat_map(move |half_row| {
                (0..c).map(move |column| Anchor {
                    column,
                    half_row,
                    size,
                })
            })
            .filter(move |a| self.valid(*a))
    }
    pub fn rect(self, a: Anchor) -> PixelRect {
        PixelRect {
            x: self.left
                + 12.
                + a.column as f64 * (self.cell_w + 12.)
                + (self.cell_w - self.width) / 2.,
            y: self.top
                + 12.
                + (a.half_row / 2) as f64 * (self.cell_h + 12.)
                + (self.cell_h - self.height) / 2.
                + if a.half_row % 2 == 1 {
                    (self.height + 12.) / 2.
                } else {
                    0.
                },
            width: if a.size == CardSize::Large {
                self.width + self.cell_w + 12.
            } else {
                self.width
            },
            height: if a.size == CardSize::Small {
                (self.height - 12.) / 2.
            } else {
                self.height
            },
        }
    }
    pub fn nearest(self, size: CardSize, x: f64, y: f64) -> Anchor {
        self.anchors(size)
            .min_by(|a, b| {
                let d = |a: Anchor| {
                    let r = self.rect(a);
                    (r.x - x).hypot(r.y - y)
                };
                d(*a).total_cmp(&d(*b))
            })
            .unwrap()
    }
    pub fn geometry(self, monitor: &str, a: Anchor) -> Geometry {
        let r = self.rect(a);
        Geometry {
            size: a.size,
            monitor: monitor.into(),
            x: r.x,
            y: r.y,
            width: self.width,
            grid: Some(Placement {
                preset: self.preset,
                column: a.column,
                half_row: a.half_row,
                step: self.cell_w + 12.,
            }),
        }
    }
    pub fn place(self, size: CardSize, x: f64, y: f64, occupied: &[Anchor]) -> Option<Anchor> {
        self.anchors(size)
            .filter(|a| occupied.iter().all(|b| !overlap(*a, *b)))
            .min_by(|a, b| {
                let d = |a: Anchor| {
                    let r = self.rect(a);
                    (r.x - x).hypot(r.y - y)
                };
                d(*a).total_cmp(&d(*b))
            })
    }
}
pub fn overlap(a: Anchor, b: Anchor) -> bool {
    let extent = |s: CardSize| {
        (
            if s == CardSize::Large { 2 } else { 1 },
            if s == CardSize::Small { 1 } else { 2 },
        )
    };
    let (aw, ah) = extent(a.size);
    let (bw, bh) = extent(b.size);
    a.column < b.column + bw
        && b.column < a.column + aw
        && a.half_row < b.half_row + bh
        && b.half_row < a.half_row + ah
}
pub fn anchor(g: &Geometry) -> Option<Anchor> {
    g.grid.as_ref().map(|p| Anchor {
        column: p.column,
        half_row: p.half_row,
        size: g.size,
    })
}
/// Mouse drag intent is independent of renderer/worker timing.
pub fn drag_intent(dx: f64, dy: f64, scale: f64) -> bool {
    dx.hypot(dy) >= 4. * scale
}
#[cfg(test)]
mod tests {
    use super::*;
    fn a(c: u8, r: u8, s: CardSize) -> Anchor {
        Anchor {
            column: c,
            half_row: r,
            size: s,
        }
    }
    #[test]
    fn counts_and_shapes() {
        for (p, c, r) in [(Preset::Six, 6, 4), (Preset::Eight, 8, 6)] {
            let g = Grid::new(p, 1706., 930.).unwrap();
            assert_eq!(g.anchors(CardSize::Medium).count(), c * r);
            assert_eq!(g.anchors(CardSize::Small).count(), c * r * 2);
            let m = g.rect(a(0, 0, CardSize::Medium));
            let s = g.rect(a(0, 0, CardSize::Small));
            let l = g.rect(a(0, 0, CardSize::Large));
            assert!((m.width / m.height - 1.25).abs() < 0.001);
            assert_eq!(s.height * 2. + 12., m.height);
            assert!(
                (l.width - (g.rect(a(1, 0, CardSize::Medium)).x + m.width - m.x)).abs() < 0.001
            );
        }
    }
    #[test]
    fn holes_and_half_cells() {
        let g = Grid::new(Preset::Six, 1920., 1040.).unwrap();
        let top = a(0, 0, CardSize::Small);
        let bottom = a(0, 1, CardSize::Small);
        assert!(!overlap(top, bottom));
        assert!(overlap(top, a(0, 0, CardSize::Medium)));
        assert_eq!(g.place(CardSize::Small, 12., 12., &[top]), Some(bottom));
        assert!(!g.valid(a(5, 0, CardSize::Large)));
        assert!(!g.valid(a(0, 1, CardSize::Medium)));
    }
    #[test]
    fn dense_and_tiny() {
        assert!(Grid::new(Preset::Eight, 1100., 650.).is_err());
        assert!(Grid::new(Preset::Eight, 1536., 830.).is_ok());
        assert!(Grid::new(Preset::Six, 1280., 690.).is_ok());
    }
    #[test]
    fn instant_drag_intent() {
        assert!(!drag_intent(3., 0., 1.));
        assert!(drag_intent(4., 0., 1.));
        assert!(drag_intent(6., 0., 1.5));
    }
}
#[cfg(test)]
mod padding_tests {
    use super::*;
    use crate::{preferences::CardSize, widget_layout::Padding};
    #[test]
    fn each_edge_reserves_space_without_changing_slot_counts() {
        let padding = Padding {
            top: 40.,
            right: 70.,
            bottom: 180.,
            left: 90.,
        };
        for preset in [Preset::Six, Preset::Eight] {
            let grid = Grid::padded(preset, 1920., 1200., padding).unwrap();
            let (cols, rows) = preset.dimensions();
            assert_eq!(
                grid.anchors(CardSize::Medium).count(),
                (cols * rows) as usize
            );
            for size in [CardSize::Small, CardSize::Medium, CardSize::Large] {
                for a in grid.anchors(size) {
                    let r = grid.rect(a);
                    assert!(r.x >= padding.left && r.y >= padding.top);
                    assert!(
                        r.x + r.width <= 1920. - padding.right
                            && r.y + r.height <= 1200. - padding.bottom
                    );
                    assert_eq!(grid.nearest(size, r.x, r.y), a);
                }
            }
        }
    }
    #[test]
    fn insufficient_or_invalid_padding_is_rejected() {
        for value in [-1., f64::NAN, 0.5, 1900.] {
            assert!(Grid::padded(
                Preset::Six,
                1920.,
                1080.,
                Padding {
                    left: value,
                    ..Default::default()
                }
            )
            .is_err());
        }
    }
}
