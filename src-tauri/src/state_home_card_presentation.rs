use super::*;
use crate::home_cards::presentation::{
    CardControlChange, CardControlResult, HomeCardPresentation, PreparedControl,
};

impl AppState {
    pub(crate) async fn confirm_switch_group(
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
                let (card, _) = self
                    .home_cards
                    .prepare_switch_group(&cloud, &self.specs, &device)
                    .await?
                    .ok_or_else(|| AppError::new("readbackFailed", "", true))?;
                if card.group.as_ref().is_none_or(|g| g.id != group_id) {
                    return Err(AppError::stale());
                }
                let failed = card
                    .group
                    .as_ref()
                    .unwrap()
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
    pub(crate) async fn change_switch_group(
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
        let (card, members) = self
            .home_cards
            .prepare_switch_group(&cloud, &self.specs, &device)
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
    pub async fn home_card_presentations(
        &self,
        home: String,
        generation: u64,
        ids: Vec<String>,
    ) -> Result<Vec<HomeCardPresentation>> {
        if ids.len() > 1024 {
            return Err(AppError::invalid("卡片数量无效。"));
        }
        if ids.is_empty() {
            return Ok(vec![]);
        }
        let mut devices = vec![];
        let mut cloud = None;
        for did in ids {
            if devices.iter().any(|d: &Device| d.did == did) {
                continue;
            }
            let (c, d) = self.device(&home, generation, &did).await?;
            cloud = Some(c);
            devices.push(d);
        }
        let cloud = cloud.ok_or_else(AppError::stale)?;
        let result = Box::pin(self.home_cards.load_presentations(
            cloud.clone(),
            &self.specs,
            &home,
            &devices,
        ))
        .await;
        self.inner.lock().await.check(&home, generation)?;
        let current = self.device(&home, generation, &devices[0].did).await?.0;
        if !Arc::ptr_eq(&cloud, &current) {
            return Err(AppError::stale());
        }
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
                        card: None,
                        status: None,
                    });
                }
            } else {
                self.home_cards.invalidate(device.control_did()).await;
            }
            let mut presentations =
                Box::pin(self.home_card_presentations(home.clone(), generation, vec![did.clone()]))
                    .await?;
            let presentation = presentations.pop();
            let control = presentation
                .as_ref()
                .and_then(|p| p.controls.iter().find(|c| c.id == change.control_id));
            let verified = control.is_some_and(|c| {
                if c.kind == "action" {
                    action_confirmed(change.value.as_str().unwrap_or(""), c.state.as_deref())
                } else {
                    c.value.as_ref() == Some(&change.value)
                }
            });
            let actual = if verified {
                Some(change.value.clone())
            } else {
                control
                    .filter(|c| c.kind != "action")
                    .and_then(|c| c.value.clone())
            };
            let report = Box::pin(self.home_cards.load(
                cloud.clone(),
                &self.specs,
                &self.ui_resources,
                &home,
                generation,
                std::slice::from_ref(&device),
            ))
            .await?;
            let current = self.device(&home, generation, &did).await?.0;
            if !Arc::ptr_eq(&cloud, &current) {
                return Err(AppError::stale());
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
                presentation,
                card: report.cards.into_iter().next(),
                status: report.statuses.into_iter().next(),
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
                            request,
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
