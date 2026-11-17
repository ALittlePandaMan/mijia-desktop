//! Account-scoped camera metadata. Selecting a scope never starts a stream.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{Device, Home},
};
use serde::Serialize;
use std::{
    sync::Arc,
    time::{Duration, Instant},
};
use tokio::sync::Mutex;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Household {
    pub home: Home,
    pub devices: Vec<Device>,
    pub excluded_device_ids: Vec<String>,
    pub error: Option<AppError>,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct View {
    pub scope: String,
    pub generation: u64,
    pub all_homes: bool,
    pub homes: Vec<Household>,
    pub incomplete: bool,
}
#[derive(Default)]
pub struct Catalog {
    cache: Mutex<Option<(String, Instant, Vec<Household>)>>,
    flight: Mutex<()>,
}
impl Catalog {
    pub async fn load(
        &self,
        key: String,
        force: bool,
        cloud: Arc<Cloud>,
    ) -> Result<Vec<Household>> {
        self.cached(key, force, || fetch(cloud)).await
    }
    async fn cached<F, Fut>(&self, key: String, force: bool, fetch: F) -> Result<Vec<Household>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Vec<Household>>>,
    {
        let requested = Instant::now();
        let _flight = self.flight.lock().await;
        if let Some((stored, at, homes)) = self.cache.lock().await.as_ref() {
            if stored == &key
                && at.elapsed() < Duration::from_secs(300)
                && (!force || *at >= requested)
            {
                return Ok(homes.clone());
            }
        }
        let homes = fetch().await?;
        *self.cache.lock().await = Some((key, Instant::now(), homes.clone()));
        Ok(homes)
    }
}
async fn fetch(cloud: Arc<Cloud>) -> Result<Vec<Household>> {
    let homes = cloud.homes().await?;
    let metadata_cloud = cloud.clone();
    let mut homes = collect(homes, move |home| {
        let cloud = metadata_cloud.clone();
        async move { cloud.monitor_devices(&home).await }
    })
    .await?;
    // One model batch across all homes, using the same account-scoped image
    // cache as home cards. Preserve each membership's custom cover and identity.
    let mut cameras: Vec<_> = homes
        .iter()
        .flat_map(|home| home.devices.iter().cloned())
        .collect();
    cloud.attach_artwork(&mut cameras).await?;
    for (device, artwork) in homes
        .iter_mut()
        .flat_map(|home| &mut home.devices)
        .zip(cameras)
    {
        *device = artwork;
    }
    Ok(homes)
}
async fn collect<F, Fut>(homes: Vec<Home>, load: F) -> Result<Vec<Household>>
where
    F: Fn(Home) -> Fut + Clone + Send + 'static,
    Fut: std::future::Future<Output = Result<Vec<Device>>> + Send + 'static,
{
    let mut result = vec![];
    for chunk in homes.chunks(3) {
        let mut jobs = tokio::task::JoinSet::new();
        for (index, home) in chunk.iter().cloned().enumerate() {
            let load = load.clone();
            jobs.spawn(async move {
                let devices = load(home.clone()).await;
                (index, home, devices)
            });
        }
        let mut rows = vec![];
        while let Some(job) = jobs.join_next().await {
            let (index, home, devices) = job.map_err(|_| AppError::stale())?;
            let (devices, error) = match devices {
                Ok(d) => (
                    d.into_iter().filter(crate::monitor::eligible).collect(),
                    None,
                ),
                Err(e) => (vec![], Some(e)),
            };
            rows.push((
                index,
                Household {
                    home,
                    devices,
                    error,
                    excluded_device_ids: vec![],
                },
            ));
        }
        rows.sort_by_key(|(index, _)| *index);
        result.extend(rows.into_iter().map(|(_, home)| home));
    }
    Ok(result)
}
/// A repeated DID uses the first selected real household, including its permissions.
pub fn selected(homes: &[Household]) -> Vec<(Home, Device)> {
    let mut seen = std::collections::HashSet::new();
    homes
        .iter()
        .filter(|h| h.error.is_none())
        .flat_map(|h| {
            h.devices
                .iter()
                .filter(|d| !h.excluded_device_ids.contains(&d.did))
                .map(move |d| (h.home.clone(), d.clone()))
        })
        .filter(|(_, d)| seen.insert(d.did.clone()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn home(id: &str) -> Home {
        serde_json::from_value(
            serde_json::json!({"id":id,"name":id,"ownerId":"1","rooms":[],"shared":false}),
        )
        .unwrap()
    }
    fn device(did: &str) -> Device {
        serde_json::from_value(serde_json::json!({"did":did,"name":"same","model":"fixture.camera.a","online":true,"roomId":"r","roomName":"room"})).unwrap()
    }
    #[tokio::test]
    async fn three_households_at_most_partial_failure_order_and_first_selected_identity() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let active = Arc::new(AtomicUsize::new(0));
        let peak = Arc::new(AtomicUsize::new(0));
        let rows = collect((0..7).map(|i| home(&i.to_string())).collect(), {
            let active = active.clone();
            let peak = peak.clone();
            move |home| {
                let active = active.clone();
                let peak = peak.clone();
                async move {
                    peak.fetch_max(active.fetch_add(1, Ordering::SeqCst) + 1, Ordering::SeqCst);
                    tokio::time::sleep(Duration::from_millis(5)).await;
                    active.fetch_sub(1, Ordering::SeqCst);
                    if home.id == "2" {
                        Err(AppError::stale())
                    } else {
                        Ok(vec![device(&home.id)])
                    }
                }
            }
        })
        .await
        .unwrap();
        assert_eq!(peak.load(Ordering::SeqCst), 3);
        assert_eq!(
            rows.iter().map(|h| h.home.id.as_str()).collect::<Vec<_>>(),
            vec!["0", "1", "2", "3", "4", "5", "6"]
        );
        assert!(rows[2].error.is_some());
        assert_eq!(selected(&rows).len(), 6);
        let mut first = device("same");
        first.shared_read_only = true;
        let mut rows = vec![
            Household {
                home: home("a"),
                devices: vec![first],
                excluded_device_ids: vec![],
                error: None,
            },
            Household {
                home: home("b"),
                devices: vec![device("same")],
                excluded_device_ids: vec![],
                error: None,
            },
        ];
        assert!(selected(&rows)[0].1.shared_read_only);
        assert_eq!(selected(&rows).len(), 1);
        rows[0].excluded_device_ids.push("same".into());
        assert_eq!(selected(&rows)[0].0.id, "b");
        rows[1].excluded_device_ids.push("same".into());
        assert!(selected(&rows).is_empty());
    }
    #[tokio::test]
    async fn cache_coalesces_and_isolates_accounts_and_does_not_cache_errors() {
        let cache = Catalog::default();
        let calls = std::sync::atomic::AtomicUsize::new(0);
        let fetch = || async {
            calls.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            tokio::task::yield_now().await;
            Ok(vec![])
        };
        let (a, b) = tokio::join!(
            cache.cached("a".into(), false, fetch),
            cache.cached("a".into(), false, fetch)
        );
        a.unwrap();
        b.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 1);
        cache.cached("b".into(), false, fetch).await.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 2);
        assert!(cache
            .cached("c".into(), false, || async { Err(AppError::stale()) })
            .await
            .is_err());
        cache.cached("c".into(), false, fetch).await.unwrap();
        assert_eq!(calls.load(std::sync::atomic::Ordering::SeqCst), 3);
    }
}
