use super::*;
use std::collections::HashSet;
use crate::home_cards::presentation::{
    CardControlChange, CardControlResult, PresentationUpdate, PreparedControl,
};

impl AppState {
    pub(crate) async fn control_switch_group(
        &self,
        home: String,
        generation: u64,
        did: String,
        group_id: String,
        on: bool,
        request_id: String,
        confirm_only: bool,
    ) -> Result<crate::home_cards::switch_group::GroupResult> {
        if confirm_only {
            return self.confirm_switch_group(home, generation, did, group_id, on, request_id).await;
        }
        let lane = format!("group:{group_id}");
        self.with_ui_control_key(
            &home,
            generation,
            &did,
            Some(lane),
            Box::pin(self.change_switch_group(home.clone(), generation, did.clone(), group_id, on, request_id)),
        ).await
    }

    async fn confirm_switch_group(
        &self,
        home: String,
        generation: u64,
        did: String,
        group_id: String,
        on: bool,
        request_id: String,
    ) -> Result<crate::home_cards::switch_group::GroupResult> {
        let (cloud, device) = self.device(&home, generation, &did).await?;
        let panel = self.specs.panel(&device).await?;
        let fields = panel
            .services
            .iter()
            .filter(|s| s.name == "switch")
            .flat_map(|s| &s.properties)
            .filter(|p| p.name == "on")
            .map(|p| format!("{}:{}", p.siid, p.piid))
            .collect();
        self.with_ui_readback(
            &home,
            generation,
            &did,
            fields,
            Box::pin(async {
                let (card, _) = Box::pin(self.home_cards.prepare_switch_group(&cloud, &self.specs, &device))
                    .await?
                    .ok_or_else(|| AppError::new("readbackFailed", "", true))?;
                let failed = card
                    .group
                    .as_ref()
                    .filter(|group| group.id == group_id)
                    .ok_or_else(AppError::stale)?
                    .members
                    .iter()
                    .filter(|m| m.selected.is_none())
                    .map(|m| m.id.clone())
                    .collect();
                Ok(crate::home_cards::switch_group::GroupResult {
                    home_id: home.clone(),
                    request_id,
                    sequence: 0,
                    target: on,
                    card,
                    failed,
                    readback: true,
                })
            }),
        )
        .await
    }
    async fn change_switch_group(
        &self,
        home: String,
        generation: u64,
        did: String,
        group_id: String,
        on: bool,
        request_id: String,
    ) -> Result<crate::home_cards::switch_group::GroupResult> {
        if request_id.is_empty() || request_id.len() > 128 {
            return Err(AppError::invalid("操作标识无效。"));
        }
        let (cloud, device) = self.device(&home, generation, &did).await?;
        let (card, members) = Box::pin(self.home_cards.prepare_switch_group(&cloud, &self.specs, &device))
            .await?
            .ok_or_else(AppError::stale)?;
        if card.group.as_ref().is_none_or(|g| g.id != group_id) {
            return Err(AppError::stale());
        }
        let mut failed = vec![];
        for member in members {
            let value = if member.format == "bool" {
                serde_json::json!(on)
            } else {
                serde_json::json!(if on { 1 } else { 0 })
            };
            if let Err(error) = self
                .set_property(
                    home.clone(),
                    generation,
                    did.clone(),
                    member.siid,
                    member.piid,
                    value,
                )
                .await
            {
                if matches!(error.kind.as_str(), "authExpired" | "staleContext") {
                    return Err(error);
                }
                failed.push(crate::home_cards::switch_group::member_id(&member));
            }
        }
        self.inner.lock().await.check(&home, generation)?;
        Ok(crate::home_cards::switch_group::GroupResult {
            readback: false,
            home_id: home,
            request_id,
            sequence: crate::state::ui_control::sequence(),
            target: on,
            card,
            failed,
        })
    }
    pub(crate) async fn home_card_large_available(&self, home: &str, generation: u64, did: &str) -> Result<bool> {
        let (cloud, device) = self.device(home, generation, did).await?;
        self.large_layout_for_device(home, generation, &cloud, &device).await
    }

    pub(super) async fn large_layout_for_device(&self, home: &str, generation: u64, cloud: &Arc<Cloud>, device: &Device) -> Result<bool> {
        let result = self.home_cards.has_large_layout(&self.specs, device).await;
        let (current_cloud, current_device) = self.device(home, generation, &device.did).await?;
        if !Arc::ptr_eq(cloud, &current_cloud) || crate::widget_layout::device_fingerprint(device) != crate::widget_layout::device_fingerprint(&current_device) {
            return Err(AppError::stale());
        }
        result
    }

    pub async fn home_card_presentations(
        &self,
        home: String,
        generation: u64,
        ids: Vec<String>,
    ) -> Result<Vec<PresentationUpdate>> {
        if ids.len() > 1024 {
            return Err(AppError::invalid("卡片数量无效。"));
        }
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let ids: HashSet<_> = ids.into_iter().collect();
        let (cloud, devices) = {
            let inner = self.inner.lock().await;
            inner.check(&home, generation)?;
            (inner.cloud.clone().ok_or_else(AppError::stale)?,
             inner.devices.iter().filter(|d| ids.contains(&d.did)).cloned().collect::<Vec<_>>())
        };
        let result = Box::pin(self.home_cards.load_presentations(
            cloud.clone(),
            &self.specs,
            &home,
            &devices,
        ))
        .await;
        let inner = self.inner.lock().await;
        inner.check(&home, generation)?;
        if inner.cloud.as_ref().is_none_or(|current| !Arc::ptr_eq(&cloud, current)) { return Err(AppError::stale()); }
        let result = result.map(|mut updates| {
            updates.retain(|update| devices.iter().find(|d| d.did == update.did).is_some_and(|old|
                inner.devices.iter().any(|d| d.did == old.did && d.control_did() == old.control_did()
                    && d.spec_type == old.spec_type && d.online == old.online && d.shared_read_only == old.shared_read_only)));
            updates
        });
        drop(inner);
        self.handle(&cloud, result).await
    }
    pub async fn change_home_card_control(
        &self,
        home: String,
        generation: u64,
        did: String,
        change: CardControlChange,
    ) -> Result<CardControlResult> {
        let (cloud, device) = self.device(&home, generation, &did).await?;
        // Bound large protocol futures before composing submission and readback.
        // Keeping them inline can exhaust a Windows worker's stack on a slider write.
        let prepared =
            Box::pin(
                self.home_cards
                    .prepare_card_control(&cloud, &self.specs, &device, &change),
            )
            .await;
        let prepared = self.handle(&cloud, prepared).await?;
        if !change.confirm_only {
            let scope = format!(
                "{}:{}:{}:{}",
                cloud.credentials.region, cloud.credentials.user_id, home, did
            );
            if let Some(result) = self
                .home_cards
                .reserve_card_request(&scope, &change)
                .await?
            {
                return Ok(result);
            }
        }
        let watch_home = home.clone();
        let watch_did = did.clone();
        let fields = match &prepared {
            PreparedControl::Property(p) => vec![format!("{}:{}", p.siid, p.piid)],
            PreparedControl::Action {
                effect: Some(p), ..
            } => vec![format!("{}:{}", p.siid, p.piid)],
            _ => vec![],
        };
        let read = async {
            self.inner.lock().await.check(&home, generation)?;
            let current = self.device(&home, generation, &did).await?.0;
            if !Arc::ptr_eq(&cloud, &current) {
                return Err(AppError::stale());
            }
            if !change.confirm_only {
                let sent = match prepared {
                    PreparedControl::Property(p) => {
                        Box::pin(self.set_property(
                            home.clone(),
                            generation,
                            did.clone(),
                            p.siid,
                            p.piid,
                            p.value,
                        ))
                        .await
                    }
                    PreparedControl::Action { siid, aiid, effect } => {
                        let result = Box::pin(self.run_action(
                            home.clone(),
                            generation,
                            did.clone(),
                            siid,
                            aiid,
                            vec![],
                            None,
                        ))
                        .await;
                        if result.is_ok() {
                            if let Some(effect) = effect {
                                crate::state::ui_control::record(
                                    effect.siid,
                                    effect.piid,
                                    effect.value,
                                    vec![],
                                )
                                .await;
                            }
                        }
                        result
                    }
                };
                self.home_cards.invalidate(device.control_did()).await;
                sent?;
                if crate::state::ui_control::dispatch_only() {
                    return Ok(CardControlResult {
                        sequence: crate::state::ui_control::sequence(),
                        submitted: true,
                        target: Some(change.value.clone()),
                        home_id: home,
                        did,
                        control_id: change.control_id.clone(),
                        request_id: change.request_id.clone(),
                        verified: false,
                        actual: None,
                        message: String::new(),
                        presentation: None,
                        confirmation: None,
                        card: None,
                        status: None,
                    });
                }
            }
            let read_version = self.inner.lock().await.state_revision;
            let confirmation = self.handle(
                &cloud, Box::pin(self.home_cards.confirm_card_reading(&cloud, &self.specs, &device, &change)).await,
            ).await?;
            let control = &confirmation.control;
            let verified = if control.kind == "action" {
                action_confirmed(change.value.as_str().unwrap_or(""), control.state.as_deref())
            } else {
                control.value.as_ref() == Some(&change.value)
            };
            let actual = if verified {
                Some(change.value.clone())
            } else {
                (control.kind != "action").then(|| control.value.clone()).flatten()
            };
            let (current, latest) = self.device(&home, generation, &did).await?;
            if !Arc::ptr_eq(&cloud, &current)
                || latest.control_did() != device.control_did() || latest.spec_type != device.spec_type {
                return Err(AppError::stale());
            }
            if !latest.online || latest.shared_read_only {
                return Err(AppError::device(if latest.online { -704010000 } else { -704042011 }));
            }
            if let Some((siid, piid)) = control.field_id.split_once(':') {
                if self.inner.lock().await.property_versions
                    .get(&format!("{did}\n{siid}\n{piid}")).is_some_and(|version| *version > read_version) {
                    return Err(AppError::new("stateSuperseded", "", true));
                }
            }
            Ok(CardControlResult {
                sequence: crate::state::ui_control::sequence(),
                submitted: false,
                target: None,
                home_id: home,
                did,
                control_id: change.control_id.clone(),
                request_id: change.request_id.clone(),
                verified,
                actual,
                message: if verified {
                    "已确认设备状态"
                } else {
                    "操作已发出，状态待确认"
                }
                .into(),
                presentation: None,
                confirmation: Some(confirmation),
                card: None,
                status: None,
            })
        };
        let result = if change.confirm_only {
            self.with_ui_readback(&watch_home, generation, &watch_did, fields, Box::pin(read))
                .await
        } else {
            Box::pin(read).await
        };
        if !change.confirm_only {
            self.home_cards
                .finish_card_request(&change.request_id, result.clone())
                .await;
        }
        result
    }
}
fn action_confirmed(action: &str, state: Option<&str>) -> bool {
    let Some(state) = state else {
        return false;
    };
    let state: String = state
        .chars()
        .filter(|c| c.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    let action = action.split(':').next_back().unwrap_or("");
    match action {
        "start-sweep" | "start-only-sweep" | "start-mop" => {
            state.contains("sweeping") || state.contains("mopping")
        }
        "pause" | "pause-sweeping" => state == "paused",
        "start-charge" => matches!(
            state.as_str(),
            "gocharging" | "charging" | "gotodock" | "returning"
        ),
        "stop-sweeping" => matches!(
            state.as_str(),
            "idle" | "standby" | "paused" | "notcharging"
        ),
        _ => false,
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn card_control_and_confirmation_futures_fit_windows_worker_stacks() {
        // Construct, but never poll, the real request futures: no transport calls.
        // The larger test stack lets this assertion report a regression instead of
        // crashing the test runner before it can measure the offending future.
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let state = AppState::with_session(None, None).unwrap();
                let change = CardControlChange {
                    template_id: "mock".into(),
                    control_id: "brightness".into(),
                    value: serde_json::json!(60),
                    request_id: "mock-only".into(),
                    confirm_only: false,
                };
                let control =
                    state.change_home_card_control("mock".into(), 1, "mock".into(), change);
                let read = state.confirm_property(
                    "mock".into(),
                    1,
                    "mock".into(),
                    2,
                    2,
                    serde_json::json!(60),
                );
                let presentation =
                    state.home_card_presentations("mock".into(), 1, vec!["mock".into()]);
                for (name, size) in [
                    ("control", std::mem::size_of_val(&control)),
                    ("confirm", std::mem::size_of_val(&read)),
                    ("presentation", std::mem::size_of_val(&presentation)),
                ] {
                    eprintln!("{name} future: {size} bytes");
                    assert!(
                        size < 128 * 1024,
                        "{name} future exceeds the bounded Windows stack budget: {size}"
                    );
                }
            })
            .unwrap()
            .join()
            .unwrap();
    }
    #[test]
    fn card_control_ipc_starts_on_one_mib_stack_without_device_commands() {
        std::thread::Builder::new()
            .stack_size(1024 * 1024)
            .spawn(|| {
                let state = AppState::with_session(None, None).unwrap();
                let runtime = tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap();
                runtime.block_on(async {
                    for index in 0..20 {
                        let change = CardControlChange {
                            template_id: "mock".into(),
                            control_id: "brightness".into(),
                            value: serde_json::json!(index),
                            request_id: format!("mock-only-{index}"),
                            confirm_only: index % 2 == 1,
                        };
                        let request =
                            state.change_home_card_control("mock".into(), 1, "mock".into(), change);
                        let request = state.with_ui_control_key(
                            "mock",
                            1,
                            "mock",
                            Some("brightness".into()),
                            Box::pin(request),
                        );
                        assert!(std::mem::size_of_val(&request) < 128 * 1024);
                        // No authenticated device exists, so the real dispatch path must
                        // reject before sending, while still constructing/polling safely.
                        assert!(request.await.is_err());
                    }
                });
            })
            .unwrap()
            .join()
            .unwrap();
    }

    #[test]
    fn switch_group_and_detail_controls_use_a_one_mib_stack_with_mock_transport() {
        std::thread::Builder::new()
            .stack_size(1024 * 1024)
            .spawn(|| {
                let runtime = tokio::runtime::Builder::new_current_thread().enable_all().build().unwrap();
                runtime.block_on(Box::pin(async {
                    use serde_json::json;
                    type RelayValues = (HashMap<u32, bool>, Vec<(u32, bool)>);
                    let relay = Arc::new(std::sync::Mutex::new(RelayValues::default()));
                    let reply = relay.clone();
                    let cloud = Cloud::new(auth::Credentials {
                        user_id: "0".into(), security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                        service_token: "fixture".into(), region: "cn".into(),
                        device_id: "fixture".into(), service_id: "xiaomiio".into(), c_user_id: "fixture".into(),
                    }).unwrap().with_test_request(move |path, data| {
                        let data = data.unwrap();
                        let mut relay = reply.lock().unwrap();
                        let rows: Vec<_> = data["params"].as_array().unwrap().iter().map(|p| {
                            assert_eq!(p["did"], "fixture");
                            let siid = p["siid"].as_u64().unwrap() as u32;
                            let piid = p["piid"].as_u64().unwrap() as u32;
                            let value = match (path, piid) {
                                ("/miotspec/prop/get", 1) => json!(relay.0.get(&siid).copied().unwrap_or(false)),
                                ("/miotspec/prop/get", 2) => json!(match siid { 2 | 3 => 0, 4 => 1, 5 => 2, 6 => 99, _ => unreachable!() }),
                                ("/miotspec/prop/set", 1) => {
                                    assert!(matches!(siid, 2 | 3), "a protected relay was written");
                                    let on = p["value"].as_bool().unwrap();
                                    relay.0.insert(siid, on);
                                    relay.1.push((siid, on));
                                    json!(on)
                                }
                                _ => panic!("unexpected mock {path} {siid}:{piid}"),
                            };
                            json!({"did":"fixture","siid":siid,"piid":piid,"code":0,"value":value})
                        }).collect();
                        Ok(json!(rows))
                    });
                    let mut state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
                    let typ = "urn:miot-spec-v2:device:switch:fixture:1";
                    let services: Vec<_> = (2..=6).map(|siid| json!({"iid":siid,"type":"urn:miot-spec-v2:service:switch:fixture:1","properties":[
                        {"iid":1,"type":"urn:miot-spec-v2:property:on:fixture:1","format":"bool","access":["read","write"]},
                        {"iid":2,"type":"urn:miot-spec-v2:property:mode:fixture:1","format":"uint8","access":["read"],"value-list":[
                            {"value":0,"description":"Wired And Wireless"},{"value":1,"description":"Wireless"},{"value":2,"description":"Flex"}
                        ]}
                    ]})).collect();
                    let metadata = crate::metadata_cache::MetadataCache::fixture(
                        crate::metadata_cache::Key::Instance(typ.into()), json!({"type":typ,"services":services}),
                    ).await;
                    state.specs = Arc::new(SpecRepository::from_test_metadata(metadata));
                    let device: Device = serde_json::from_value(json!({"did":"fixture","name":"Fixture","model":"fixture.switch","online":true,"roomId":"r","roomName":"r","specType":typ})).unwrap();
                    let group = format!("switch-group:{}", crate::widget_layout::device_fingerprint(&device));
                    {
                        let mut inner = state.inner.lock().await;
                        inner.selected = Some("home".into());
                        inner.generation = 1;
                        inner.devices = vec![device];
                    }
                    for on in [true, false] {
                        let sent = state.control_switch_group("home".into(),1,"fixture".into(),group.clone(),on,format!("set-{on}"),false);
                        let future_bytes = std::mem::size_of_val(&sent);
                        assert!(future_bytes < 32 * 1024, "switch IPC state uses {future_bytes} bytes");
                        assert!(sent.await.unwrap().failed.is_empty());
                        let report = state.control_switch_group("home".into(),1,"fixture".into(),group.clone(),on,format!("read-{on}"),true).await.unwrap();
                        assert!(report.failed.is_empty());
                        assert_eq!(report.card.selected, Some(on));
                        let group = report.card.group.unwrap();
                        assert_eq!(group.members.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["2:1", "3:1"]);
                    }
                    for siid in 2..=6 {
                        let send = state.with_ui_control_key("home", 1, "fixture", Some(format!("property:{siid}:1")),
                            Box::pin(state.set_property("home".into(), 1, "fixture".into(), siid, 1, json!(true))));
                        if siid <= 3 {
                            send.await.unwrap();
                            assert!(state.confirm_property("home".into(), 1, "fixture".into(), siid, 1, json!(true)).await.unwrap().verified);
                        } else {
                            let expected = if siid == 6 { "switchModeUnavailable" } else { "switchModeRestricted" };
                            let Err(error) = send.await else { panic!("relay {siid} should have been rejected") };
                            assert_eq!(error.kind, expected);
                        }
                    }
                    assert_eq!(relay.lock().unwrap().1, [(2,true),(3,true),(2,false),(3,false),(2,true),(3,true)]);
                }));
            }).unwrap().join().unwrap();
    }

    #[test]
    fn action_readback_requires_the_expected_effect() {
        assert!(action_confirmed("vacuum:start-sweep", Some("Sweeping")));
        assert!(!action_confirmed("vacuum:start-sweep", Some("Error")));
        assert!(action_confirmed("vacuum:pause", Some("Paused")));
        assert!(!action_confirmed("vacuum:pause", Some("Idle")));
        assert!(action_confirmed(
            "battery:start-charge",
            Some("Go Charging")
        ));
        assert!(!action_confirmed(
            "battery:start-charge",
            Some("Not Charging")
        ));
        assert!(!action_confirmed("vacuum:start-sweep", None));
    }
}
