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
    pub available_homes: Vec<HomeChoice>,
    pub incomplete: bool,
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeChoice {
    pub id: String,
    pub name: String,
    pub shared: bool,
}
#[derive(Clone, Default)]
pub(crate) struct Directory {
    pub homes: Vec<Household>,
    pub choices: Vec<HomeChoice>,
}
#[derive(Default)]
pub struct Catalog {
    cache: Mutex<Option<(String, Instant, Directory)>>,
    flight: Mutex<()>,
}
impl Catalog {
    pub(crate) async fn load(
        &self,
        key: String,
        force: bool,
        cloud: Arc<Cloud>,
        home_id: Option<&str>,
    ) -> Result<Directory> {
        self.cached(key, force, || fetch(cloud, home_id)).await
    }
    async fn cached<F, Fut>(&self, key: String, force: bool, fetch: F) -> Result<Directory>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<Directory>>,
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
async fn fetch(cloud: Arc<Cloud>, home_id: Option<&str>) -> Result<Directory> {
    let mut homes = cloud.homes().await?;
    let choices = homes.iter().map(|home| HomeChoice {
        id: home.id.clone(),
        name: home.name.clone(),
        shared: home.shared,
    }).collect();
    if let Some(home_id) = home_id {
        homes.retain(|home| home.id == home_id);
        if homes.is_empty() {
            return Err(AppError::new("permissionDenied", "当前账号无法访问此家庭。", false));
        }
    }
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
    Ok(Directory { homes, choices })
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
                Err(e) if e.kind == "authExpired" => return Err(e),
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
    selected_members(homes)
        .map(|(home, device)| ((*home).clone(), (*device).clone()))
        .collect()
}

fn selected_members(homes: &[Household]) -> impl Iterator<Item = (&Home, &Device)> {
    let mut seen = std::collections::HashSet::new();
    homes
        .iter()
        .filter(|h| h.error.is_none())
        .flat_map(|h| {
            h.devices
                .iter()
                .filter(move |d| !h.excluded_device_ids.contains(&d.did))
                .map(move |d| (&h.home, d))
        })
        .filter(move |&(_, d)| seen.insert(d.did.as_str()))
}

pub(crate) fn selected_page(homes: &[Household], dids: &[String]) -> Result<Vec<(Home, Device)>> {
    let requested: std::collections::HashSet<_> = dids.iter().map(String::as_str).collect();
    let mut members: std::collections::HashMap<_, _> = selected_members(homes)
        .filter(|(_, device)| requested.contains(device.did.as_str()))
        .map(|(home, device)| (device.did.as_str(), (home, device)))
        .collect();
    // Removing a member also rejects duplicate IDs without losing request order.
    dids.iter()
        .map(|did| {
            members.remove(did.as_str())
                .map(|(home, device)| ((*home).clone(), (*device).clone()))
                .ok_or_else(AppError::stale)
        })
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
    #[test]
    fn a_monitor_page_keeps_requested_order_and_original_household_permissions() {
        let mut shared = device("shared");
        shared.shared_read_only = true;
        let homes = vec![
            Household {
                home: home("shared-home"), devices: vec![shared, device("excluded")],
                excluded_device_ids: vec!["excluded".into()], error: None,
            },
            Household {
                home: home("other-home"), devices: vec![device("shared"), device("other"), device("off-page")],
                excluded_device_ids: vec![], error: None,
            },
            Household {
                home: home("missing-home"), devices: vec![device("unavailable")],
                excluded_device_ids: vec![], error: Some(AppError::stale()),
            },
        ];
        let members = selected_page(&homes, &["other".into(), "shared".into()]).unwrap();
        let routes: Vec<_> = members.iter().map(|(h, d)| (h.id.as_str(), d.did.as_str())).collect();
        assert_eq!(routes, vec![("other-home", "other"), ("shared-home", "shared")]);
        assert!(members[1].1.shared_read_only);
        for invalid in ["excluded", "unavailable", "unknown"] {
            assert!(selected_page(&homes, &["other".into(), invalid.into()]).is_err());
        }
    }

    #[test]
    fn page_size_and_duplicates_are_rejected_before_catalog_or_session_work() {
        let mut ids = (0..16).map(|n| n.to_string()).collect::<Vec<_>>();
        assert!(crate::monitor::valid_page(&ids));
        ids.push("16".into());
        assert!(!crate::monitor::valid_page(&ids));
        assert!(!crate::monitor::valid_page(&[]));
        assert!(!crate::monitor::valid_page(&["one".into(), "one".into()]));
    }

    #[tokio::test]
    async fn an_expired_account_is_not_cached_as_a_partial_household_result() {
        let result = collect(vec![home("a"), home("b")], |home| async move {
            if home.id == "b" { Err(AppError::auth()) } else { Ok(vec![device("a")]) }
        }).await;
        assert_eq!(result.err().unwrap().kind, "authExpired");
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
            Ok(Directory::default())
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
