//! UI-only submission lanes. Confirmed caches never receive these intentions.
use super::*;
use std::{future::Future, pin::Pin, time::Instant};
#[cfg(feature="desktop")]
use tauri::Emitter;

// Do not embed a device protocol future in every IPC, queue and task-local
// frame that awaits it. Their combined stack use can exceed a Windows worker's
// reserve, especially in debug builds. Poll in the same task to keep its scope.
pub(super) type ControlFuture<'a, T> = Pin<Box<dyn Future<Output = Result<T>> + Send + 'a>>;

#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Submission {
    pub home_id: String,
    pub user_id: String,
    pub region: String,
    pub dids: Vec<String>,
    pub siid: u32,
    pub piid: u32,
    pub value: Value,
    pub sequence: u64,
    pub control_ids: Vec<String>,
}

#[derive(Clone)]
pub(crate) struct Target {
    pub sequence: u64,
    pub siid: u32,
    pub piid: u32,
    pub value: Value,
    at: Instant,
}
#[derive(Default)]
pub(crate) struct UiControls {
    publish_failure: std::sync::Mutex<Option<Arc<dyn Fn(ReadbackFailure) + Send + Sync>>>,
    latest: std::sync::Mutex<HashMap<String, (u64, Instant)>>,
    clock: std::sync::atomic::AtomicU64,
    lanes: Mutex<HashMap<String, Arc<Mutex<()>>>>,
    targets: Mutex<HashMap<String, Vec<Target>>>,
    settings: Mutex<HashMap<String, HashMap<String, (Instant, Value)>>>,
    publish: std::sync::Mutex<Option<Arc<dyn Fn(Submission) + Send + Sync>>>,
}
#[derive(Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct ReadbackFailure {
    pub home_id: String,
    pub user_id: String,
    pub region: String,
    pub dids: Vec<String>,
    pub fields: Vec<FailedField>,
}
#[derive(Clone, serde::Serialize)]
pub(crate) struct FailedField {
    pub id: String,
    pub sequence: u64,
}
#[derive(Clone)]
struct Frame {
    created: Instant,
    key: String,
    sequence: u64,
    identity: Option<(String, String, String, Vec<String>)>,
    controls: Arc<UiControls>,
}
tokio::task_local! { static FRAME:Frame; }
pub(crate) fn dispatch_only() -> bool {
    FRAME.try_with(|_| true).unwrap_or(false)
}
pub(crate) fn current() -> bool {
    FRAME
        .try_with(|f| f.created.elapsed() < Duration::from_secs(30))
        .unwrap_or(true)
}
pub(crate) fn sequence() -> u64 {
    FRAME.try_with(|f| f.sequence).unwrap_or(0)
}
pub(crate) fn delays(values: &[u64]) -> Vec<u64> {
    if dispatch_only() {
        vec![]
    } else {
        values.to_vec()
    }
}
pub(crate) async fn targets() -> Vec<Target> {
    if !current() {
        return vec![];
    }
    let Ok(frame) = FRAME.try_with(Clone::clone) else {
        return vec![];
    };
    let result = frame
        .controls
        .targets
        .lock()
        .await
        .get(&frame.key)
        .into_iter()
        .flatten()
        .filter(|t| t.at.elapsed() < Duration::from_secs(30))
        .cloned()
        .collect();
    result
}
pub(crate) async fn record(siid: u32, piid: u32, value: Value, control_ids: Vec<String>) {
    if !current() {
        return;
    }
    let Ok(frame) = FRAME.try_with(Clone::clone) else {
        return;
    };
    let mut values = frame.controls.targets.lock().await;
    values.retain(|_, v| {
        v.retain(|t| t.at.elapsed() < Duration::from_secs(30));
        !v.is_empty()
    });
    let entry = values.entry(frame.key).or_default();
    entry.retain(|t| t.siid != siid || t.piid != piid);
    entry.push(Target {
        sequence: frame.sequence,
        siid,
        piid,
        value,
        at: Instant::now(),
    });
    let value = entry.last().unwrap().value.clone();
    drop(values);
    if let Some((home_id, user_id, region, dids)) = frame.identity {
        let publish = frame.controls.publish.lock().unwrap().clone();
        if let Some(publish) = publish {
            publish(Submission {
                home_id,
                user_id,
                region,
                dids,
                siid,
                piid,
                value,
                sequence: frame.sequence,
                control_ids,
            });
        }
    }
}
pub(crate) async fn setting(name: &str) -> Option<Value> {
    if !current() {
        return None;
    }
    let frame = FRAME.try_with(Clone::clone).ok()?;
    let values = frame.controls.settings.lock().await;
    values
        .get(&frame.key)?
        .get(name)
        .filter(|(at, _)| at.elapsed() < Duration::from_secs(30))
        .map(|(_, v)| v.clone())
}
pub(crate) async fn record_setting(name: &str, value: Value) {
    if !current() {
        return;
    }
    let Ok(frame) = FRAME.try_with(Clone::clone) else {
        return;
    };
    let mut values = frame.controls.settings.lock().await;
    values.retain(|_, v| {
        v.retain(|_, (at, _)| at.elapsed() < Duration::from_secs(30));
        !v.is_empty()
    });
    values
        .entry(frame.key)
        .or_default()
        .insert(name.into(), (Instant::now(), value));
}
pub(crate) async fn forget_setting(name: &str) {
    let Ok(frame) = FRAME.try_with(Clone::clone) else { return; };
    let mut active = frame.controls.settings.lock().await;
    if let Some(settings) = active.get_mut(&frame.key) {
        settings.remove(name);
    }
}
pub(crate) async fn washer_gate(panel: &DevicePanel, generation: u64, siid:u32) -> DevicePanel {
    let mut projected = panel.clone();
    let drum=crate::washer_runtime::drum_status(panel,siid);
    let Some((service, status)) = drum.or_else(||crate::washer_runtime::status_binding(panel)) else {
        return projected;
    };
    let state_key=if drum.is_some(){format!("washer.state.{siid}")}else{"washer.state".into()};
    let Some(target) = setting(&state_key).await else {
        return projected;
    };
    if target["generation"].as_u64() != Some(generation)
        || target["did"].as_str() != Some(panel.did.as_str())
        || target["siid"].as_u64() != Some(u64::from(service.siid))
        || !crate::washer_runtime::live_state(status).is_some_and(|state| matches!(state, "busy" | "paused")) {
        return projected;
    }
    let expected = target["state"].as_str();
    let mut matches = status.value_list.iter().flatten().filter(|o|
        crate::washer_runtime::state_label(&o.description).is_some_and(|(state, phase)| expected == Some(state) && phase.is_none()));
    if let Some(value) = matches.next().filter(|_| matches.next().is_none()).map(|o| o.value.clone()) {
        if let Some(p) = projected.services.iter_mut().find(|s| s.siid == service.siid)
            .and_then(|s| s.properties.iter_mut().find(|p| p.piid == status.piid)) {
            p.value = Some(value);
        }
    }
    projected
}
impl AppState {
    pub(crate) async fn confirm_washer_runtime(
        &self, home: String, generation: u64, did: String, expected: Option<String>, intent: Option<String>,
    ) -> Result<DevicePanel> {
        let (cloud, device) = self.device(&home, generation, &did).await?;
        let scope = format!("{}:{}:{}:{}", cloud.credentials.region, cloud.credentials.user_id, home, device.control_did());
        let target = self.ui_controls.settings.lock().await.get(&scope)
            .and_then(|settings| settings.iter().find(|(key,(_,value))| (key.as_str()=="washer.state"||key.starts_with("washer.state."))
                && value["generation"].as_u64() == Some(generation)
                && value["did"].as_str() == Some(did.as_str())
                && value["intent"].as_str() == intent.as_deref()
                && value["state"].as_str() == expected.as_deref()))
            .map(|(key,(_,value))| (key.clone(),value.clone()));
        let drum_id=target.as_ref().and_then(|(key,value)| key.starts_with("washer.state.").then_some(value["siid"].as_u64()? as u32));
        let read = async {
            let schema = self.specs.panel(&device).await?;
            if !crate::washer_runtime::is_laundry(&schema) {
                return Err(AppError::invalid("设备洗涤状态不可用。"));
            }
            let mut live = schema;
            let rows = cloud.read_panel_properties(&live).await?;
            spec::apply_reads(&mut live, &rows);
            crate::washer_runtime::refresh(&mut live);
            self.inner.lock().await.check_panel(&home, generation, &live)?;
            let observed=drum_id.and_then(|id|live.washer_drums.iter().find(|snapshot|snapshot.service_id==Some(id))).or(live.washer_runtime.as_ref());
            if observed.is_none_or(|runtime| runtime.state == "unknown")
                && (drum_id.is_some() || live.washer_drums.iter().all(|drum|drum.state=="unknown")) {
                return Err(AppError::new("readbackFailed", "", true));
            }
            Ok(live)
        };
        let result = tokio::time::timeout(Duration::from_secs(10), Box::pin(read))
            .await.unwrap_or_else(|_| Err(AppError::new("timeout", "", true)));
        if let Some((key,target)) = target {
            if result.as_ref().is_err() || result.as_ref().ok().and_then(|p| drum_id.and_then(|id|p.washer_drums.iter().find(|s|s.service_id==Some(id))).or(p.washer_runtime.as_ref()))
                .is_some_and(|r| Some(r.state.as_str()) == expected.as_deref()
                    || expected.as_deref() == Some("idle") && matches!(r.state.as_str(), "off" | "completed")) {
                if let Some(settings) = self.ui_controls.settings.lock().await.get_mut(&scope) {
                    if settings.get(&key).is_some_and(|(_, value)| *value == target) {
                        settings.remove(&key);
                    }
                }
            }
        }
        if let Err(error) = &result {
            return self.handle(&cloud, Err(error.clone())).await;
        }
        result
    }

    pub(crate) async fn with_ui_readback<T>(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        fields: Vec<String>,
        read: ControlFuture<'_, T>,
    ) -> Result<T> {
        let (cloud, device) = self.device(home, generation, did).await?;
        let scope = format!(
            "{}:{}:{}:{}",
            cloud.credentials.region,
            cloud.credentials.user_id,
            home,
            device.control_did()
        );
        let targets: Vec<_> = self
            .ui_controls
            .targets
            .lock()
            .await
            .get(&scope)
            .into_iter()
            .flatten()
            .filter(|t| {
                t.at.elapsed() < Duration::from_secs(30)
                    && fields.contains(&format!("{}:{}", t.siid, t.piid))
            })
            .cloned()
            .collect();
        let result = read.await;
        if result.as_ref().is_err_and(|error| error.kind != "stateSuperseded") && !targets.is_empty() {
            if let Ok((current, _)) = self.device(home, generation, did).await {
                if Arc::ptr_eq(&current, &cloud) {
                    let dids = self
                        .context_devices()
                        .await?
                        .into_iter()
                        .filter(|d| d.control_did() == device.control_did())
                        .map(|d| d.did)
                        .collect();
                    let event = ReadbackFailure {
                        home_id: home.into(),
                        user_id: cloud.credentials.user_id.clone(),
                        region: cloud.credentials.region.clone(),
                        dids,
                        fields: targets
                            .iter()
                            .map(|t| FailedField {
                                id: format!("{}:{}", t.siid, t.piid),
                                sequence: t.sequence,
                            })
                            .collect(),
                    };
                    let publish = self.ui_controls.publish_failure.lock().unwrap().clone();
                    if let Some(publish) = publish {
                        publish(event);
                    }
                    let mut records = self.ui_controls.targets.lock().await;
                    if let Some(current) = records.get_mut(&scope) {
                        current.retain(|t| {
                            !targets.iter().any(|old| {
                                old.siid == t.siid
                                    && old.piid == t.piid
                                    && old.sequence == t.sequence
                            })
                        });
                    }
                }
            }
        }
        result
    }
    #[cfg(feature="desktop")]
    pub(crate) fn install_ui_events(&self, app: tauri::AppHandle) {
        let _ = self.desktop_app.set(app.clone());
        let failure_app = app.clone();
        *self.ui_controls.publish_failure.lock().unwrap() = Some(Arc::new(move |event| {
            let _ = failure_app.emit("ui-control-readback-failed", event);
        }));
        *self.ui_controls.publish.lock().unwrap() = Some(Arc::new(move |event| {
            let _ = app.emit("ui-control-submitted", event);
        }));
    }
    pub(crate) async fn with_ui_control<T>(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        future: ControlFuture<'_, T>,
    ) -> Result<T> {
        self.with_ui_control_key(home, generation, did, None, future)
            .await
    }
    pub(crate) async fn with_ui_control_key<T>(
        &self,
        home: &str,
        generation: u64,
        did: &str,
        field: Option<String>,
        future: ControlFuture<'_, T>,
    ) -> Result<T> {
        let (cloud, device) = self.device(home, generation, did).await?;
        let key = format!(
            "{}:{}:{}:{}",
            cloud.credentials.region,
            cloud.credentials.user_id,
            home,
            device.control_did()
        );
        if FRAME
            .try_with(|f| f.key == key && Arc::ptr_eq(&f.controls, &self.ui_controls))
            .unwrap_or(false)
        {
            return future.await;
        }
        let created = Instant::now();
        let sequence = self
            .ui_controls
            .clock
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
            + 1;
        let field = field.map(|f| format!("{key}:{f}"));
        if let Some(field) = &field {
            let mut latest = self.ui_controls.latest.lock().unwrap();
            latest.retain(|_, (_, at)| at.elapsed() < Duration::from_secs(30));
            latest.insert(field.clone(), (sequence, created));
        }
        let lane = {
            let mut lanes = self.ui_controls.lanes.lock().await;
            if lanes.len() > 512 {
                lanes.retain(|_, l| Arc::strong_count(l) > 1);
            }
            lanes.entry(key.clone()).or_default().clone()
        };
        let _guard = lane.lock().await;
        if created.elapsed() >= Duration::from_secs(30) {
            return Err(AppError::new("timeout", "", false));
        }
        if field.as_ref().is_some_and(|f| {
            self.ui_controls
                .latest
                .lock()
                .unwrap()
                .get(f)
                .is_none_or(|(v, _)| *v != sequence)
        }) {
            return Err(AppError::new("superseded", "", false));
        }
        let (current, _) = self.device(home, generation, did).await?;
        if !Arc::ptr_eq(&current, &cloud) {
            return Err(AppError::stale());
        }
        let dids = self
            .context_devices()
            .await?
            .into_iter()
            .filter(|d| d.control_did() == device.control_did())
            .map(|d| d.did)
            .collect();
        FRAME
            .scope(
                Frame {
                    created,
                    key,
                    sequence,
                    identity: Some((
                        home.into(),
                        cloud.credentials.user_id.clone(),
                        cloud.credentials.region.clone(),
                        dids,
                    )),
                    controls: self.ui_controls.clone(),
                },
                async {
                    let result = self
                        .with_control_intent(home, generation, did, future)
                        .await;
                    let (current, _) = self.device(home, generation, did).await?;
                    if !Arc::ptr_eq(&current, &cloud) {
                        return Err(AppError::stale());
                    }
                    result
                },
            )
            .await
    }
}
#[cfg(test)]
mod tests {
    #[test]
    fn washer_writes_and_live_confirmation_fit_a_windows_worker_stack() {
        std::thread::Builder::new().stack_size(1024 * 1024).spawn(|| {
            let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
            runtime.block_on(Box::pin(async {
                use super::*;
                use serde_json::json;
                let spec: Value = serde_json::from_str(include_str!("fixtures/catalog/washer--whp.washer.wgf80870bi.json")).unwrap();
                let typ = spec["type"].as_str().unwrap().to_owned();
                let feedback = Arc::new(std::sync::atomic::AtomicI32::new(110));
                let writes = Arc::new(std::sync::Mutex::new(Vec::new()));
                let (live, sent) = (feedback.clone(), writes.clone());
                let cloud = Cloud::new(auth::Credentials {
                    user_id: "0".into(), security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                    service_token: "fixture".into(), region: "cn".into(), device_id: "fixture".into(),
                    service_id: "xiaomiio".into(), c_user_id: "fixture".into(),
                }).unwrap().with_test_request(move |path, data| {
                    let data = data.unwrap();
                    match path {
                        "/miotspec/action" => {
                            assert_eq!(data["params"]["did"], "fixture");
                            assert_eq!(data["params"]["siid"], 2);
                            sent.lock().unwrap().push(data["params"]["aiid"].as_u64().unwrap());
                            Ok(json!({"code":0}))
                        }
                        "/miotspec/prop/get" => {
                            let raw = data["params"].as_array().unwrap();
                            Ok(json!(raw.iter().map(|p| {
                                let state = live.load(std::sync::atomic::Ordering::Relaxed);
                                let missing = p["siid"] == 2 && p["piid"] == 4 && state < 0;
                                let value = match (p["siid"].as_u64(), p["piid"].as_u64()) {
                                    (Some(2), Some(4)) => json!(state),
                                    (Some(2), Some(3)) => json!(true),
                                    (Some(3), Some(1)) => json!(false),
                                    _ => json!(0),
                                };
                                json!({"did":"fixture","siid":p["siid"],"piid":p["piid"],"code":if missing{-1}else{0},"value":value})
                            }).collect::<Vec<_>>()))
                        }
                        _ => panic!("unexpected mock request {path}"),
                    }
                });
                let mut state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
                let metadata = crate::metadata_cache::MetadataCache::fixture(
                    crate::metadata_cache::Key::Instance(typ.clone()), spec,
                ).await;
                state.specs = Arc::new(SpecRepository::from_test_metadata(metadata));
                let device = serde_json::from_value(json!({
                    "did":"fixture","name":"Fixture","model":"whp.washer.wgf80870bi",
                    "online":true,"roomId":"r","roomName":"r","specType":typ
                })).unwrap();
                {
                    let mut inner = state.inner.lock().await;
                    inner.selected = Some("home".into());
                    inner.generation = 1;
                    inner.devices = vec![device];
                }
                let send = |aiid| state.with_ui_control("home", 1, "fixture",
                    Box::pin(state.run_action("home".into(), 1, "fixture".into(), 2, aiid, vec![], Some(format!("fixture-{aiid}")))));
                let confirm = |expected: &str| Box::pin(state.confirm_washer_runtime(
                    "home".into(), 1, "fixture".into(), Some(expected.into()),
                    Some(if expected == "paused" {"fixture-1"} else {"fixture-2"}.into())));
                let first = send(1).await.unwrap();
                assert!(!first.verified);
                assert_eq!(first.panel.washer_runtime.unwrap().state, "busy");
                assert_eq!(confirm("paused").await.unwrap().washer_runtime.unwrap().state, "busy");
                send(2).await.unwrap();
                assert_eq!(confirm("busy").await.unwrap().washer_runtime.unwrap().state, "busy");
                send(1).await.unwrap();
                feedback.store(1, std::sync::atomic::Ordering::Relaxed);
                assert!(send(2).await.is_err(), "an acknowledged pause must not allow a new start from idle");
                feedback.store(-1, std::sync::atomic::Ordering::Relaxed);
                let Err(error) = confirm("paused").await else { panic!("missing live read should fail"); };
                assert_eq!(error.kind, "readbackFailed");
                feedback.store(110, std::sync::atomic::Ordering::Relaxed);
                assert!(send(2).await.is_err());
                assert_eq!(*writes.lock().unwrap(), [1, 2, 1]);
            }));
        }).unwrap().join().unwrap();
    }
    use super::*;
    async fn mock_state() -> AppState {
        let cloud = Arc::new(
            Cloud::new(auth::Credentials {
                user_id: "0".into(),
                security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                service_token: "mock".into(),
                region: "cn".into(),
                device_id: "mock".into(),
                service_id: "xiaomiio".into(),
                c_user_id: "mock".into(),
            })
            .unwrap(),
        );
        let state = AppState::with_session(Some(cloud), None).unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.selected = Some("h".into());
            inner.generation = 1;
            inner.devices = vec![serde_json::from_value(serde_json::json!({"did":"d","name":"Mock","model":"mock.light","online":true,"roomId":"r","roomName":"r"})).unwrap()];
        }
        state
    }
    async fn mock_target(state: &AppState, piid: u32, value: Value) {
        state
            .with_ui_control("h", 1, "d", Box::pin(async {
                record(2, piid, value, vec![]).await;
                Ok(())
            }))
            .await
            .unwrap();
    }
    #[tokio::test]
    async fn first_read_error_publishes_failed_sequence_and_clears_only_that_target() {
        let state = mock_state().await;
        let events = Arc::new(std::sync::Mutex::new(vec![]));
        let sink = events.clone();
        *state.ui_controls.publish_failure.lock().unwrap() =
            Some(Arc::new(move |e| sink.lock().unwrap().push(e)));
        mock_target(&state, 1, serde_json::json!(true)).await;
        mock_target(&state, 2, serde_json::json!(60)).await;
        let result: Result<()> = state
            .with_ui_readback("h", 1, "d", vec!["2:1".into()], Box::pin(async {
                Err(AppError::new("network", "", false))
            }))
            .await;
        assert_eq!(result.unwrap_err().kind, "network");
        let events = events.lock().unwrap();
        assert_eq!(events.len(), 1);
        assert_eq!(
            (&events[0].home_id, &events[0].user_id, &events[0].region),
            (&"h".to_string(), &"0".to_string(), &"cn".to_string())
        );
        assert_eq!(events[0].dids, vec!["d"]);
        assert_eq!(events[0].fields[0].id, "2:1");
        assert_eq!(events[0].fields[0].sequence, 1);
        drop(events);
        let targets = state.ui_controls.targets.lock().await;
        assert_eq!(targets["cn:0:h:d"].len(), 1);
        assert_eq!(targets["cn:0:h:d"][0].piid, 2);
    }
    #[tokio::test]
    async fn old_failed_read_cannot_erase_a_newer_intention_and_old_live_values_are_not_errors() {
        let state = mock_state().await;
        mock_target(&state, 1, serde_json::json!(true)).await;
        let result: Result<()> = state
            .with_ui_readback("h", 1, "d", vec!["2:1".into()], Box::pin(async {
                mock_target(&state, 1, serde_json::json!(false)).await;
                Err(AppError::new("timeout", "", false))
            }))
            .await;
        assert!(result.is_err());
        let result = state
            .with_ui_readback("h", 1, "d", vec!["2:1".into()], Box::pin(async {
                Ok(serde_json::json!(true))
            }))
            .await;
        assert_eq!(result.unwrap(), serde_json::json!(true));
        let targets = state.ui_controls.targets.lock().await;
        assert_eq!(targets["cn:0:h:d"][0].sequence, 2);
        assert_eq!(targets["cn:0:h:d"][0].value, serde_json::json!(false));
    }
    #[tokio::test]
    async fn failed_read_after_context_change_cannot_publish_to_the_new_session() {
        let state = mock_state().await;
        let events = Arc::new(std::sync::Mutex::new(vec![]));
        let sink = events.clone();
        *state.ui_controls.publish_failure.lock().unwrap() =
            Some(Arc::new(move |e| sink.lock().unwrap().push(e)));
        mock_target(&state, 1, serde_json::json!(true)).await;
        let result: Result<()> = state
            .with_ui_readback("h", 1, "d", vec!["2:1".into()], Box::pin(async {
                state.inner.lock().await.generation = 2;
                Err(AppError::new("network", "", false))
            }))
            .await;
        assert!(result.is_err());
        assert!(events.lock().unwrap().is_empty());
    }
    #[tokio::test]
    async fn expired_submission_cannot_publish_or_extend_an_optimistic_target() {
        let controls = Arc::new(UiControls::default());
        FRAME
            .scope(
                Frame {
                    created: Instant::now() - Duration::from_secs(31),
                    key: "a:h:d".into(),
                    sequence: 1,
                    identity: None,
                    controls: controls.clone(),
                },
                async {
                    assert!(!current());
                    record(2, 1, serde_json::json!(true), vec![]).await;
                    record_setting("ceiling.light", serde_json::json!(true)).await;
                    assert!(targets().await.is_empty());
                    assert!(setting("ceiling.light").await.is_none());
                },
            )
            .await;
        assert!(controls.targets.lock().await.is_empty());
        assert!(controls.settings.lock().await.is_empty());
    }
    #[tokio::test]
    async fn queued_same_field_coalesces_but_an_independent_property_still_submits() {
        let cloud = Arc::new(
            Cloud::new(auth::Credentials {
                user_id: "0".into(),
                security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                service_token: "mock".into(),
                region: "cn".into(),
                device_id: "mock".into(),
                service_id: "xiaomiio".into(),
                c_user_id: "mock".into(),
            })
            .unwrap(),
        );
        let state = AppState::with_session(Some(cloud), None).unwrap();
        let device:Device=serde_json::from_value(serde_json::json!({"did":"d","name":"Mock","model":"mock.light","online":true,"roomId":"r","roomName":"r"})).unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.selected = Some("h".into());
            inner.generation = 1;
            inner.devices = vec![device];
        }
        let lane = Arc::new(Mutex::new(()));
        state
            .ui_controls
            .lanes
            .lock()
            .await
            .insert("cn:0:h:d".into(), lane.clone());
        let guard = lane.lock().await;
        let sent = std::sync::Mutex::new(vec![]);
        let old = state.with_ui_control_key("h", 1, "d", Some("power".into()), Box::pin(async {
            sent.lock().unwrap().push(1);
            Ok(())
        }));
        let latest = state.with_ui_control_key("h", 1, "d", Some("power".into()), Box::pin(async {
            sent.lock().unwrap().push(2);
            Ok(())
        }));
        let other = state.with_ui_control_key("h", 1, "d", Some("brightness".into()), Box::pin(async {
            sent.lock().unwrap().push(3);
            Ok(())
        }));
        let release = async {
            while state
                .ui_controls
                .clock
                .load(std::sync::atomic::Ordering::Acquire)
                < 3
            {
                tokio::task::yield_now().await;
            }
            drop(guard);
        };
        let (a, b, c, ()) = tokio::join!(old, latest, other, release);
        assert_eq!(a.unwrap_err().kind, "superseded");
        assert!(b.is_ok());
        assert!(c.is_ok());
        assert_eq!(*sent.lock().unwrap(), vec![2, 3]);
    }
    #[tokio::test]
    async fn predictions_are_scope_local_and_never_replace_readings() {
        let controls = Arc::new(UiControls::default());
        FRAME
            .scope(
                Frame {
                    created: Instant::now(),
                    key: "a:h:d".into(),
                    sequence: 1,
                    identity: None,
                    controls: controls.clone(),
                },
                async {
                    assert!(dispatch_only());
                    assert!(delays(&[350, 800]).is_empty());
                    record(2, 1, serde_json::json!(true), vec![]).await;
                    assert_eq!(targets().await[0].value, serde_json::json!(true));
                    record(2, 1, serde_json::json!(false), vec![]).await;
                    assert_eq!(targets().await.len(), 1);
                },
            )
            .await;
        FRAME
            .scope(
                Frame {
                    created: Instant::now(),
                    key: "b:h:d".into(),
                    sequence: 2,
                    identity: None,
                    controls,
                },
                async {
                    assert!(targets().await.is_empty());
                },
            )
            .await;
        assert!(!dispatch_only());
        assert_eq!(delays(&[350]), vec![350]);
    }
}
