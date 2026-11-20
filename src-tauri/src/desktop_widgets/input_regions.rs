//! Normalized hit regions outlive transient native target tables and page sleep.
use crate::widget_layout::PixelRect;
use std::collections::HashMap;
pub type Regions = Vec<(String, PixelRect)>;
#[derive(Default)]
pub struct InputRegions {
    rows: HashMap<String, Regions>,
}
impl InputRegions {
    pub fn remember(&mut self, key: String, rows: Regions) {
        self.rows.insert(key, rows);
    }
    pub fn target(&self, key: &str) -> Regions {
        self.rows.get(key).cloned().unwrap_or_default()
    }
    pub fn remove_host(&mut self, owner: &str) {
        let prefix = format!("{owner}#");
        self.rows.retain(|key, _| !key.starts_with(&prefix));
    }
    pub fn clear(&mut self) {
        self.rows.clear();
    }
    pub fn remove_widget(&mut self, id: &str) {
        let suffix = format!("#{id}");
        self.rows.retain(|key, _| !key.ends_with(&suffix));
    }
    pub fn len(&self) -> usize {
        self.rows.len()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn rows() -> Regions {
        vec![(
            "control".into(),
            PixelRect {
                x: 0.8,
                y: 0.8,
                width: 0.22,
                height: 0.22,
            },
        )]
    }
    #[test]
    fn registration_before_target_and_repeated_target_rebuilds() {
        let mut cache = InputRegions::default();
        cache.remember("host#a".into(), rows());
        for _ in 0..20 {
            let target = cache.target("host#a");
            assert_eq!(target, rows());
            drop(target);
        }
        assert_eq!(cache.target("host#a"), rows());
    }
    #[test]
    fn only_real_host_teardown_releases_regions() {
        let mut cache = InputRegions::default();
        cache.remember("host#a".into(), rows());
        cache.remember("other#b".into(), rows());
        cache.remove_host("host");
        assert!(cache.target("host#a").is_empty());
        assert_eq!(cache.target("other#b"), rows());
        cache.clear();
        assert!(cache.target("other#b").is_empty());
    }
    #[test]
    fn repeated_unpins_do_not_accumulate_cached_regions() {
        let mut cache = InputRegions::default();
        cache.remember("host#keep".into(), rows());
        for n in 0..100 {
            let id = format!("pin-{n}");
            cache.remember(format!("host#{id}"), rows());
            cache.remove_widget(&id);
        }
        assert_eq!(cache.len(), 1);
        assert_eq!(cache.target("host#keep"), rows());
    }
}
