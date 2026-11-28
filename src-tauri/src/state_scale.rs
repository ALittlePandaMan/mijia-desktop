use super::*;
use crate::scale::{self, pending};

impl AppState {
    async fn ensure_scale_current(
        &self,
        home: &str,
        generation: u64,
        cloud: &Arc<Cloud>,
        device: &Device,
    ) -> Result<()> {
        let (active, current) = self.device(home, generation, &device.did).await?;
        if !Arc::ptr_eq(&active, cloud)
            || current.model != device.model
            || current.control_did() != device.control_did()
            || current.spec_type != device.spec_type
            || current.split_route.is_some()
            || current.shared_read_only != device.shared_read_only
        {
            return Err(AppError::stale());
        }
        Ok(())
    }

    async fn owns_scale_home(&self, home: &str, cloud: &Arc<Cloud>) -> bool {
        self.inner.lock().await.homes.iter().any(|item| {
            item.id == home && !item.shared && item.owner_id == cloud.credentials.user_id
        })
    }
}

impl AppState {
    pub(crate) async fn scale_history(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        query: scale::Query,
    ) -> Result<scale::History> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        if !scale::is_scale(&device) || device.split_route.is_some() {
            return Err(AppError::invalid("此设备没有已核实的称重读取绑定。"));
        }
        let now = epoch_secs() * 1000 + 999;
        let start = query.start.unwrap_or(scale::EARLIEST_MS);
        let before = query.before.unwrap_or(now);
        if start < scale::EARLIEST_MS || !(start..=now).contains(&before) {
            return Err(AppError::invalid("称重历史时间范围无效。"));
        }
        let ensure_current = || self.ensure_scale_current(&home_id, generation, &cloud, &device);
        let uid = &cloud.credentials.user_id;
        let mut report = scale::History {
            did,
            model: device.model.clone(),
            member_id: None,
            members: Vec::new(),
            source: scale::Source::Unavailable,
            composition_supported: false,
            pending_supported: false,
            pending_editable: false,
            pending_claim_member_ids: Vec::new(),
            latest_weight: None,
            page: scale::Page::default(),
        };
        if let Some(family) = scale::EcoScale::for_model(&device.model) {
            if query.pending && !family.pending_supported() {
                return Err(AppError::invalid("此型号未接入待认领记录。"));
            }
            if query.before.is_some() && query.start.is_none() && query.member_id.is_none() {
                return Err(AppError::invalid("请先选择称重成员。"));
            }
            let index = self
                .handle(&cloud, cloud.scale_index(&device).await)
                .await?;
            ensure_current().await?;
            let profiles = scale::profiles(&index, uid)?;
            let selected = match query.member_id {
                Some(id) => Some(
                    profiles
                        .iter()
                        .find(|profile| profile.member.id == id)
                        .ok_or_else(|| AppError::invalid("该成员当前不可用，请刷新。"))?,
                ),
                None => profiles
                    .iter()
                    .find(|profile| &profile.member.id == uid)
                    .or_else(|| profiles.first()),
            };
            if let Some(profile) = selected {
                let account = &profile.member.id;
                let history = self
                    .handle(
                        &cloud,
                        cloud
                            .scale_records(&device, account, start, before, query.pending)
                            .await,
                    )
                    .await?;
                ensure_current().await?;
                report.page = scale::page(
                    &history,
                    &device,
                    profile,
                    uid,
                    start,
                    before,
                    query.pending,
                )?;
                report.member_id = Some(account.clone());
                report.pending_editable = query.pending
                    && pending::supported(&device, &cloud.credentials.region)
                    && pending::owned_profile(&index, profile, uid, &device).is_some()
                    && self.owns_scale_home(&home_id, &cloud).await;
                ensure_current().await?;
                if report.pending_editable {
                    report.pending_claim_member_ids = profiles
                        .iter()
                        .filter(|profile| pending::owned_profile(&index, profile, uid, &device).is_some())
                        .map(|profile| profile.member.id.clone())
                        .collect();
                }
            }
            report.members = profiles.into_iter().map(|profile| profile.member).collect();
            report.source = scale::Source::MemberCloud;
            report.composition_supported = family != scale::EcoScale::S200;
            report.pending_supported = family.pending_supported();
            return Ok(report);
        }

        // Standard MIoT readings identify a device rather than a member.
        // Never query a shared household owner's weight records.
        if query.member_id.is_some() || query.pending {
            return Err(AppError::invalid("此型号没有称重成员接口。"));
        }
        if device.shared_read_only || !self.owns_scale_home(&home_id, &cloud).await {
            return Ok(report);
        }
        let panel = self.specs.panel(&device).await?;
        ensure_current().await?;
        let Some(property) = scale::weight_binding(&panel) else {
            return Ok(report);
        };
        let has_history = property.access.iter().any(|access| access == "notify");
        report.source = if has_history {
            scale::Source::DeviceHistory
        } else {
            scale::Source::DeviceReading
        };
        let start_secs = start.saturating_sub(1) / 1000;
        let before_secs = before / 1000;
        if has_history && start_secs < before_secs {
            let key = format!("{}.{}", property.siid, property.piid);
            let rows = self
                .handle(
                    &cloud,
                    cloud
                        .history_page(
                            &device,
                            uid,
                            &key,
                            start_secs,
                            before_secs,
                            scale::PAGE_SIZE as u16,
                        )
                        .await,
                )
                .await?;
            ensure_current().await?;
            report.page = scale::device_history_page(
                &rows,
                device.control_did(),
                uid,
                &key,
                property,
                start,
                before,
            )?;
        }
        if query.start.is_none()
            && query.before.is_none()
            && report.page.records.is_empty()
            && device.online
            && property.access.iter().any(|access| access == "read")
        {
            let rows = self
                .handle(
                    &cloud,
                    cloud
                        .read_panel_property(&panel, property.siid, property.piid)
                        .await,
                )
                .await?;
            ensure_current().await?;
            report.latest_weight = scale::live_weight(&rows, device.control_did(), property);
        }
        Ok(report)
    }

    pub(crate) async fn change_scale_pending(
        &self,
        home_id: String,
        generation: u64,
        did: String,
        change: pending::Change,
    ) -> Result<()> {
        let (cloud, device) = self.device(&home_id, generation, &did).await?;
        let now = epoch_secs() * 1000 + 999;
        change.validate(now)?;
        let scope = PendingScope {
            state: self,
            home: &home_id,
            generation,
            cloud: &cloud,
            device: &device,
            now,
        };
        scope.verify().await?;
        // Keep the write gate across same-account credential renewals.
        let _guard = self
            .scale_pending_write
            .try_lock()
            .map_err(|_| AppError::new("scaleBusy", "另一项称重记录操作正在进行。", false))?;
        let index = self
            .handle(&cloud, cloud.scale_index(&device).await)
            .await?;
        scope.verify().await?;
        let uid = &cloud.credentials.user_id;
        let profiles = scale::profiles(&index, uid)?;
        let members = profiles
            .iter()
            .filter_map(|profile| {
                pending::owned_profile(&index, profile, uid, &device).map(|user| (profile, user))
            })
            .collect::<Vec<_>>();
        let member = |id: &str| {
            members.iter().copied().find(|(profile, _)| profile.member.id == id)
                .ok_or_else(scale_permission)
        };
        let (profile, user) = member(&change.member_id)?;
        let target = if change.kind == pending::Operation::Claim {
            let (profile, user) = member(change.target_member_id.as_deref().unwrap_or(&change.member_id))?;
            let mut user = user.clone();
            if user["uid"].is_null() {
                user["uid"] = Value::String(uid.clone());
            }
            Some((profile, user))
        } else {
            None
        };

        // Resolve every reference before starting a batch. The UI passes only
        // the original time and fingerprint. The cloud supplies the payload.
        let mut selected = Vec::with_capacity(change.records.len());
        for reference in &change.records {
            let rows = scope
                .records(&change.member_id, reference.time_ms, true)
                .await?;
            let [row] = rows.as_slice() else {
                return Err(changed_selection());
            };
            pending::Record::read(row, reference, &device, profile, uid).ok_or_else(changed_selection)?;
            selected.push(rows);
        }
        for (reference, rows) in change.records.iter().zip(&selected) {
            let record = pending::Record::read(&rows[0], reference, &device, profile, uid)
                .ok_or_else(changed_selection)?;
            if let Some((profile, user)) = &target {
                Box::pin(scope.save_claim(reference, &record, profile, user, &members)).await?;
            }
            Box::pin(scope.remove_pending(reference, profile, user, change.kind)).await?;
        }
        Ok(())
    }
}

fn scale_permission() -> AppError {
    AppError::new(
        "permissionDenied",
        "当前账号没有处理此体脂秤待认领记录的权限。",
        false,
    )
}

fn changed_selection() -> AppError {
    AppError::invalid("所选称重记录已变化，请刷新后重新选择。")
}

fn unconfirmed() -> AppError {
    AppError::new(
        "scaleUnconfirmed",
        "云端结果尚未确认，请刷新记录后核对。",
        true,
    )
}

struct PendingScope<'a> {
    state: &'a AppState,
    home: &'a str,
    generation: u64,
    cloud: &'a Arc<Cloud>,
    device: &'a Device,
    now: u64,
}

impl PendingScope<'_> {
    async fn verify(&self) -> Result<()> {
        if !pending::supported(self.device, &self.cloud.credentials.region)
            || !self.state.owns_scale_home(self.home, self.cloud).await
        {
            return Err(scale_permission());
        }
        self.state
            .ensure_scale_current(self.home, self.generation, self.cloud, self.device)
            .await
    }

    async fn records(&self, member: &str, time: u64, pending: bool) -> Result<Vec<Value>> {
        self.verify().await?;
        let after = time.saturating_sub(1).max(scale::EARLIEST_MS);
        let before = (time + 999).min(self.now);
        let reply = self
            .state
            .handle(
                self.cloud,
                self.cloud
                    .scale_records(self.device, member, after, before, pending)
                    .await,
            )
            .await?;
        self.verify().await?;
        let rows = reply
            .as_array()
            .filter(|rows| rows.len() < scale::PAGE_SIZE)
            .ok_or_else(AppError::protocol)?;
        let mut matches = Vec::new();
        for row in rows {
            let timestamp = scale::time_ms(&row["createTime"])
                .filter(|timestamp| (after..=before).contains(timestamp))
                .ok_or_else(AppError::protocol)?;
            if timestamp == time {
                matches.push(row.clone());
            }
        }
        Ok(matches)
    }

    async fn submit(&self, path: &str, payload: Value) -> Result<Value> {
        self.verify().await?;
        self.state
            .handle(self.cloud, self.cloud.scale_pending_request(self.device, path, payload).await)
            .await
    }

    async fn write_for_confirmation(&self, path: &str, payload: Value) -> Result<()> {
        // A missing or unrecognized acknowledgment can follow a committed
        // write. Confirm through scoped reads without replaying the request.
        match Box::pin(self.submit(path, payload)).await {
            Err(error) if !matches!(error.kind.as_str(), "network" | "timeout" | "protocol") => Err(error),
            _ => Ok(()),
        }
    }

    async fn save_claim(
        &self,
        reference: &pending::Reference,
        record: &pending::Record<'_>,
        profile: &scale::Profile,
        user: &Value,
        members: &[(&scale::Profile, &Value)],
    ) -> Result<()> {
        let uid = &self.cloud.credentials.user_id;
        let member = &profile.member.id;
        let saved = |row: &Value| record.saved(row, self.device, profile, uid);
        let existing = self.records(member, reference.time_ms, false).await?;
        if let [row] = existing.as_slice() {
            if saved(row) {
                return Ok(());
            }
        }
        if !existing.is_empty() {
            return Err(AppError::invalid("该时间已有其他称重记录，请刷新后核对。"));
        }
        // The pending row may remain after another member's save succeeded.
        for (other, _) in members.iter().filter(|(other, _)| other.member.id != *member) {
            let rows = self.records(&other.member.id, reference.time_ms, false).await?;
            if rows.iter().any(|row| record.saved(row, self.device, other, uid)) {
                return Err(AppError::invalid("这条记录已保存到其他成员，请选择原成员完成认领。"));
            }
        }
        let calculated = match record.calculation(profile, user, self.now)? {
            Some(payload) => Some(self.submit(pending::CALCULATE, payload).await?),
            None => None,
        };
        let claimed = record.claimed(
            user,
            calculated
                .as_ref()
                .map(pending::calculated_reading)
                .transpose()?,
        );
        self.write_for_confirmation(
            pending::SAVE,
            record.payload(self.device, uid, user, Some(&claimed)),
        )
        .await?;
        // An older successful reading may lag behind the submission. Read
        // again within a small budget, with no write replay on any outcome.
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            let rows = self.records(member, reference.time_ms, false).await?;
            if let [row] = rows.as_slice() {
                if saved(row) {
                    return Ok(());
                }
            }
            if !rows.is_empty() {
                break;
            }
        }
        Err(unconfirmed())
    }

    async fn remove_pending(
        &self,
        reference: &pending::Reference,
        profile: &scale::Profile,
        user: &Value,
        operation: pending::Operation,
    ) -> Result<()> {
        let uid = &self.cloud.credentials.user_id;
        let member = &profile.member.id;
        let rows = self.records(member, reference.time_ms, true).await?;
        if rows.is_empty() && operation == pending::Operation::Claim {
            return Ok(());
        }
        let [row] = rows.as_slice() else {
            return Err(changed_selection());
        };
        let record = pending::Record::read(row, reference, self.device, profile, uid)
            .ok_or_else(changed_selection)?;
        self.write_for_confirmation(
            pending::REMOVE,
            record.payload(self.device, uid, user, None),
        )
        .await?;
        for attempt in 0..3 {
            if attempt > 0 {
                tokio::time::sleep(Duration::from_millis(250)).await;
            }
            if self.records(member, reference.time_ms, true).await?.is_empty() {
                return Ok(());
            }
        }
        Err(unconfirmed())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Default)]
    struct PendingFixture {
        pending: Vec<Value>,
        history: Vec<Value>,
        calls: Vec<String>,
        uncertain_acknowledgement: bool,
        reject_remove: bool,
        stale_pending_page: Option<Vec<Value>>,
    }

    async fn pending_fixture(
        confirm_save: bool,
    ) -> (AppState, Arc<std::sync::Mutex<PendingFixture>>) {
        let time = (epoch_secs() - 120) * 1000;
        let replies = Arc::new(std::sync::Mutex::new(PendingFixture {
            pending: vec![
                json!({"did":"scale","model":scale::MODEL,"uid":10,"accountId":0,"createTime":time,
                    "sn":"fixture-a","fromSource":3,"data":{"weight":"65.25","bodyRes":450,"bodyRes2":320}}),
                json!({"did":"scale","model":scale::MODEL,"uid":10,"accountId":0,"createTime":time-60_000,
                    "sn":"fixture-b","fromSource":2,"data":"{\"weight\":64.2}"}),
            ],
            ..Default::default()
        }));
        let transport = replies.clone();
        let cloud = Cloud::new(auth::Credentials {
            user_id: "10".into(), security: "AAAAAAAAAAAAAAAAAAAAAA==".into(), service_token: "fixture".into(),
            region: "cn".into(), device_id: "fixture".into(), service_id: "mijia".into(), c_user_id: "fixture".into(),
        }).unwrap().with_test_request(move |path, payload| {
            let mut guard = transport.lock().unwrap();
            guard.calls.push(path.into());
            let payload = payload.unwrap();
            match path {
                scale::INDEX => Ok(json!({"accountInfoList":[
                    {"accountId":"10","uid":"10","id":91,"name":"示例成员","height":172,
                        "sex":1,"birth":915148800000_i64,"accountCode":2,"type":1},
                    {"accountId":"11","uid":"10","id":92,"name":"家庭成员","height":164,
                        "sex":2,"birth":915148800000_i64,"accountCode":3,"type":2},
                    {"accountId":"12","uid":"99","id":93,"name":"其他账号"},
                    {"accountId":"13","uid":"10","id":94,"deviceId":"different-scale","name":"其他设备成员"}
                ]})),
                scale::PENDING | scale::RECORDS => {
                    assert_eq!(payload["did"], "scale");
                    assert_eq!(payload["model"], scale::MODEL);
                    let stale = if path == scale::PENDING { guard.stale_pending_page.take() } else { None };
                    let (params, rows) = if path == scale::PENDING {
                        (&payload, stale.as_ref().unwrap_or(&guard.pending))
                    } else {
                        (&payload["param"], &guard.history)
                    };
                    let start = params["endTime"].as_u64().unwrap();
                    let before = params["beginTime"].as_u64().unwrap();
                    Ok(json!(rows.iter().filter(|row| (start..=before).contains(&row["createTime"].as_u64().unwrap())
                        && (path == scale::PENDING || id(&row["accountId"]) == id(&payload["accountId"])))
                        .collect::<Vec<_>>()))
                }
                pending::CALCULATE => {
                    assert_eq!(payload["version"], "235");
                    assert_eq!(payload["list"][0]["current_impedance"], json!([4500.0, 3200.0]));
                    Ok(json!([{"bfp":19.4,"slm":48.2,"heartRate":123}]))
                }
                pending::SAVE => {
                    assert_eq!(payload["did"], "scale");
                    let profile_id = match payload["accountId"].as_str() {
                        Some("10") => 91,
                        Some("11") => 92,
                        _ => panic!("Unexpected claim target"),
                    };
                    assert_eq!(payload["createTime"], time);
                    assert_eq!(payload["sn"], "fixture-a");
                    let data: Value = serde_json::from_str(payload["data"].as_str().unwrap()).unwrap();
                    assert_eq!(data["user"]["id"], profile_id);
                    assert_eq!(data["user"]["accountId"], payload["accountId"]);
                    assert_eq!(data["reportFrom"], "Claimed");
                    assert_eq!(data["weight"], 65.25);
                    assert_eq!(data["bfp"], 19.4);
                    assert!(data.get("heartRate").is_none());
                    if confirm_save { guard.history.push(payload); }
                    if guard.uncertain_acknowledgement { Err(AppError::protocol()) } else { Ok(json!({})) }
                }
                pending::REMOVE => {
                    assert_eq!(payload["did"], "scale");
                    assert_eq!(payload["accountId"], "10");
                    if guard.reject_remove { return Err(AppError::invalid("Fixture cleanup rejected")); }
                    if payload["createTime"] == time { assert_eq!(guard.history.len(), 1); }
                    if guard.uncertain_acknowledgement { guard.stale_pending_page = Some(guard.pending.clone()); }
                    guard.pending.retain(|row| row["createTime"] != payload["createTime"]);
                    Ok(if guard.uncertain_acknowledgement { json!({"code":0}) } else { json!({}) })
                }
                _ => panic!("Unexpected pending scale path"),
            }
        });
        let state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.selected = Some("home".into());
            inner.generation = 7;
            inner.homes.push(Home {
                id: "home".into(),
                name: "示例家庭".into(),
                owner_id: "10".into(),
                rooms: vec![],
                shared: false,
                room_devices: Default::default(),
            });
            inner.devices.push(
                serde_json::from_value(json!({"did":"scale","model":scale::MODEL,"name":"S400",
                "online":false,"roomId":"room","roomName":"room"}))
                .unwrap(),
            );
        }
        (state, replies)
    }

    async fn read_pending(state: &AppState) -> scale::History {
        state
            .scale_history(
                "home".into(),
                7,
                "scale".into(),
                scale::Query {
                    pending: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap()
    }

    fn change_for(row: &scale::Measurement, kind: pending::Operation) -> pending::Change {
        pending::Change {
            kind,
            member_id: "10".into(),
            target_member_id: None,
            records: vec![pending::Reference {
                key: row.key.clone(),
                time_ms: row.time_ms,
            }],
        }
    }

    #[test]
    fn pending_claim_and_delete_confirm_uncertain_replies_on_windows_stack() {
        std::thread::Builder::new()
            .stack_size(2 * 1024 * 1024)
            .spawn(|| {
                tokio::runtime::Builder::new_current_thread()
                    .enable_all()
                    .build()
                    .unwrap()
                    .block_on(Box::pin(async {
                        let (state, replies) = pending_fixture(true).await;
                        replies.lock().unwrap().uncertain_acknowledgement = true;
                        let report = read_pending(&state).await;
                        assert!(report.pending_editable);
                        assert_eq!(report.pending_claim_member_ids, ["10", "11"]);
                        let [first, second] = report.page.records.as_slice() else {
                            panic!("Expected two fixture records");
                        };
                        let mut claim = change_for(first, pending::Operation::Claim);
                        claim.target_member_id = Some("11".into());
                        Box::pin(state.change_scale_pending(
                            "home".into(),
                            7,
                            "scale".into(),
                            claim,
                        ))
                        .await
                        .unwrap();
                        Box::pin(state.change_scale_pending(
                            "home".into(),
                            7,
                            "scale".into(),
                            change_for(second, pending::Operation::Remove),
                        ))
                        .await
                        .unwrap();
                        assert!(read_pending(&state).await.page.records.is_empty());

                        let replies = replies.lock().unwrap();
                        assert_eq!(replies.history.len(), 1);
                        assert_eq!(replies.history[0]["accountId"], "11");
                        assert_eq!(replies.calls.iter().filter(|path| *path == pending::SAVE).count(), 1);
                        assert_eq!(replies.calls.iter().filter(|path| *path == pending::REMOVE).count(), 2);
                        let saved = replies
                            .calls
                            .iter()
                            .position(|path| path == pending::SAVE)
                            .unwrap();
                        let removed = replies
                            .calls
                            .iter()
                            .position(|path| path == pending::REMOVE)
                            .unwrap();
                        assert!(replies.calls[saved + 1..removed]
                            .iter()
                            .any(|path| path == scale::RECORDS));
                    }));
            })
            .unwrap()
            .join()
            .unwrap();
    }

    #[tokio::test]
    async fn pending_claim_rejects_out_of_scope_and_already_claimed_destinations() {
        let (state, replies) = pending_fixture(true).await;
        let report = read_pending(&state).await;
        let claim = |target: &str| {
            let mut change = change_for(&report.page.records[0], pending::Operation::Claim);
            change.target_member_id = Some(target.into());
            Box::pin(state.change_scale_pending("home".into(), 7, "scale".into(), change))
        };
        for target in ["12", "13"] {
            assert_eq!(claim(target).await.unwrap_err().kind, "permissionDenied");
        }
        assert!(replies.lock().unwrap().history.is_empty());

        replies.lock().unwrap().reject_remove = true;
        assert!(claim("11").await.is_err());
        replies.lock().unwrap().reject_remove = false;
        assert_eq!(claim("10").await.unwrap_err().kind, "invalidInput");
        assert_eq!(read_pending(&state).await.page.records.len(), 2);
        claim("11").await.unwrap();
        assert_eq!(read_pending(&state).await.page.records.len(), 1);

        let replies = replies.lock().unwrap();
        assert_eq!(replies.history.len(), 1);
        assert_eq!(replies.history[0]["accountId"], "11");
        assert_eq!(replies.calls.iter().filter(|path| *path == pending::SAVE).count(), 1);
    }

    #[tokio::test]
    async fn pending_write_rejects_stale_selection_and_preserves_record_when_save_unconfirmed() {
        let (state, replies) = pending_fixture(false).await;
        let report = read_pending(&state).await;
        let row = &report.page.records[0];
        let mut stale = change_for(row, pending::Operation::Remove);
        stale.records[0].key = "a".repeat(64);
        let error = Box::pin(state.change_scale_pending("home".into(), 7, "scale".into(), stale))
            .await
            .unwrap_err();
        assert_eq!(error.kind, "invalidInput");
        assert!(Box::pin(state.change_scale_pending(
            "home".into(),
            6,
            "scale".into(),
            change_for(row, pending::Operation::Remove)
        ))
        .await
        .is_err());

        let error = Box::pin(state.change_scale_pending(
            "home".into(),
            7,
            "scale".into(),
            change_for(row, pending::Operation::Claim),
        ))
        .await
        .unwrap_err();
        assert_eq!(error.kind, "scaleUnconfirmed");
        let replies = replies.lock().unwrap();
        assert_eq!(replies.pending.len(), 2);
        assert!(!replies.calls.iter().any(|path| path == pending::REMOVE));
        assert_eq!(
            replies
                .calls
                .iter()
                .filter(|path| *path == pending::SAVE)
                .count(),
            1
        );
    }

    #[tokio::test]
    async fn refreshing_credentials_retains_the_pending_write_gate() {
        let (state, _) = pending_fixture(true).await;
        let report = read_pending(&state).await;
        let (renewed, replies) = pending_fixture(true).await;
        let _guard = state.scale_pending_write.try_lock().unwrap();
        state.inner.lock().await.cloud = renewed.inner.lock().await.cloud.clone();

        let result = Box::pin(state.change_scale_pending(
            "home".into(),
            7,
            "scale".into(),
            change_for(&report.page.records[0], pending::Operation::Claim),
        )).await;
        assert_eq!(result.unwrap_err().kind, "scaleBusy");
        assert!(replies.lock().unwrap().calls.is_empty());
    }

    #[tokio::test]
    async fn s400_history_only_reads_scoped_members_and_records() {
        let measured = (epoch_secs() - 60) * 1000;
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = requests.clone();
        let cloud = Cloud::new(auth::Credentials {
            user_id: "10".into(),
            security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            service_token: "fixture".into(),
            region: "cn".into(),
            device_id: "fixture".into(),
            service_id: "mijia".into(),
            c_user_id: "fixture".into(),
        })
        .unwrap()
        .with_test_request(move |path, data| {
            let data = data.unwrap();
            captured.lock().unwrap().push(path.to_string());
            match path {
                scale::INDEX => {
                    assert_eq!(data, json!({"uid":"10","accountId":"10","deviceId":"scale"}));
                    Ok(json!({"accountInfoList":[
                        {"accountId":11,"id":92,"uid":10,"name":"第二位示例成员","icon":"https://untrusted.example/a.png"},
                        {"accountId":"10","id":"91","uid":"10","accountCode":2,"name":"示例成员","icon":"3","birth":631152000000_i64},
                        {"accountId":"12","id":"93","uid":"99","name":"其他账号"}
                    ]}))
                }
                scale::RECORDS => {
                    assert_eq!(data["uid"], 10);
                    assert_eq!(data["accountId"], 10);
                    assert_eq!(data["did"], "scale");
                    assert_eq!(data["model"], scale::MODEL);
                    assert_eq!(data["param"]["filterMode"], 3);
                    assert_eq!(data["param"]["pageSize"], scale::PAGE_SIZE);
                    if data["param"]["endTime"] != scale::EARLIEST_MS {
                        assert_eq!(data["param"]["endTime"], measured - 500);
                        assert_eq!(data["param"]["beginTime"], measured);
                    }
                    let body = json!({"weight":"64.85","user":{"id":91,"accountId":10},
                        "bodyResData":"{\"bfp\":19.4,\"slm\":48.2,\"bmi\":21.7,\"heartRate\":0}"});
                    Ok(json!([
                        {"createTime":measured,"accountId":10,"uid":10,"did":"scale",
                            "model":scale::MODEL,"data":body.to_string()},
                        {"createTime":measured,"accountId":10,"uid":10,"did":"scale","data":body},
                        {"createTime":measured-1,"accountId":10,"data":{"weight":65.1,"user":{"id":2}}},
                        {"createTime":measured-1,"accountId":10,"data":{"weight":65.1,"user":{"id":91,"accountId":11}}},
                        {"createTime":measured-1,"accountId":10,"uid":99,"data":{"weight":65.1}},
                        {"createTime":measured-1,"accountId":10,"did":"another-scale","data":{"weight":65.1}},
                        {"createTime":measured-1,"data":{"weight":65.1}},
                        {"createTime":measured/1000-1,"accountId":"10","data":{"weight":65.0}}
                    ]))
                }
                scale::PENDING => {
                    assert_eq!(data["uid"], "10");
                    assert_eq!(data["accountId"], "10");
                    assert_eq!(data["did"], "scale");
                    assert_eq!(data["model"], scale::MODEL);
                    assert_eq!(data["pageSize"], scale::PAGE_SIZE);
                    assert_eq!(data["endTime"], scale::EARLIEST_MS);
                    Ok(json!([
                        {"createTime":measured,"accountId":0,"uid":10,"data":{"weight":67.3,"bfp":20}},
                        {"createTime":measured-1,"uid":99,"data":{"weight":69.0}},
                        {"createTime":measured-1,"uid":10,"accountId":11,"data":{"weight":70.0}},
                        {"createTime":measured-1,"uid":10,"did":"different-scale","data":{"weight":71.0}}
                    ]))
                }
                _ => panic!("Unexpected scale transport path"),
            }
        });
        let state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
        let device: Device =
            serde_json::from_value(json!({"did":"scale","model":scale::MODEL,"name":"S400",
            "online":false,"sharedReadOnly":true,"roomId":"room","roomName":"room"}))
            .unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.selected = Some("home".into());
            inner.generation = 7;
            let other = Device {
                did: "other-scale".into(),
                model: "test.sensor.invalid".into(),
                ..device.clone()
            };
            inner.devices = vec![device, other];
        }
        let report = state
            .scale_history("home".into(), 7, "scale".into(), scale::Query::default())
            .await
            .unwrap();
        assert_eq!(report.member_id.as_deref(), Some("10"));
        assert_eq!(report.members.len(), 2);
        let serialized = serde_json::to_value(&report).unwrap();
        assert!(serialized["members"][0].get("icon").is_none());
        assert_eq!(serialized["members"][1]["icon"], "3");
        assert!(serialized["members"][1].get("birth").is_none());
        assert_eq!(serialized["records"][0]["adultBmi"], true);
        assert_eq!(report.page.records.len(), 2);
        assert_eq!(report.page.omitted, 5);
        assert_eq!(report.page.records[0].time_ms, measured);
        assert_eq!(report.page.records[0].weight, 64.85);
        assert_eq!(report.page.records[0].metrics["bodyFat"], 19.4);
        assert_eq!(report.page.records[0].metrics["muscle"], 48.2);
        assert!(!report.page.records[0].metrics.contains_key("heartRate"));
        assert!(report.page.records[1].metrics.is_empty());
        assert_eq!(report.page.next_before, None);

        let ranged = state
            .scale_history(
                "home".into(),
                7,
                "scale".into(),
                scale::Query {
                    start: Some(measured - 500),
                    before: Some(measured),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(ranged.page.records.len(), 1);
        assert_eq!(ranged.member_id.as_deref(), Some("10"));
        assert_eq!(ranged.page.records[0].key, report.page.records[0].key);

        let pending = state
            .scale_history(
                "home".into(),
                7,
                "scale".into(),
                scale::Query {
                    member_id: Some("10".into()),
                    pending: true,
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(pending.page.records.len(), 1);
        assert_eq!(pending.page.omitted, 3);
        assert_eq!(pending.page.records[0].weight, 67.3);
        assert!(pending.page.records[0].metrics.is_empty());
        assert!(!pending.pending_editable);
        assert!(pending.pending_claim_member_ids.is_empty());

        assert!(state
            .scale_history(
                "home".into(),
                7,
                "scale".into(),
                scale::Query {
                    member_id: Some("12".into()),
                    ..Default::default()
                }
            )
            .await
            .is_err());
        assert!(state
            .scale_history(
                "home".into(),
                7,
                "other-scale".into(),
                scale::Query::default()
            )
            .await
            .is_err());
        assert!(state
            .scale_history(
                "another-home".into(),
                7,
                "scale".into(),
                scale::Query::default()
            )
            .await
            .is_err());
        assert!(state
            .scale_history("home".into(), 6, "scale".into(), scale::Query::default())
            .await
            .is_err());
        assert_eq!(
            *requests.lock().unwrap(),
            [
                scale::INDEX,
                scale::RECORDS,
                scale::INDEX,
                scale::RECORDS,
                scale::INDEX,
                scale::PENDING,
                scale::INDEX
            ]
        );
    }

    #[tokio::test]
    async fn scale_families_use_the_scoped_model_and_region() {
        for (model, region, body_composition, pending_supported) in [
            ("yunmai.scales.ms107", "cn", true, true),
            ("yunmai.scales.ms104", "de", true, true),
            ("xiaomi.scales.ms110", "cn", true, false),
            ("yunmai.scales.ms106", "cn", false, true),
            ("xiaomi.scales.ms112", "cn", false, true),
            ("xiaomi.scales.ms113", "de", false, true),
            ("xiaomi.scales.ms116", "cn", true, false),
            ("xiaomi.scales.ms117", "cn", true, false),
            ("xiaomi.scales.s401", "cn", true, false),
        ] {
            let measured = (epoch_secs() - 30) * 1000;
            let cloud = Cloud::new(auth::Credentials {
                user_id: "10".into(),
                security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
                service_token: "fixture".into(),
                region: region.into(),
                device_id: "fixture".into(),
                service_id: "mijia".into(),
                c_user_id: "fixture".into(),
            })
            .unwrap()
            .with_test_request(move |path, params| {
                let params = params.unwrap();
                if path == scale::INDEX {
                    assert_eq!(params["deviceId"], "scale");
                    assert_eq!(params["uid"], "10");
                    return Ok(
                        json!({"accountInfoList":[{"accountId":10,"uid":10,"name":"示例成员"}]}),
                    );
                }
                if path == scale::PENDING {
                    assert!(pending_supported);
                    assert_eq!(params["accountId"], "10");
                    assert_eq!(params["did"], "scale");
                    assert_eq!(params["model"], model);
                    return Ok(json!([{"createTime":measured,"model":model,"did":"scale","uid":10,"accountId":0,
                        "data":{"weight":65.1,"bfp":20}}]));
                }
                if region == "cn" {
                    assert_eq!(path, scale::RECORDS);
                    assert_eq!(params["param"]["pageSize"], 20);
                    assert_eq!(params["uid"], 10);
                } else {
                    assert_eq!(path, scale::REGIONAL_RECORDS);
                    assert_eq!(params["pageSize"], 20);
                    assert_eq!(params["uid"], "10");
                }
                assert_eq!(params["did"], "scale");
                assert_eq!(params["model"], model);
                assert_eq!(params["accountId"], 10);
                Ok(json!([
                    {"createTime":measured,"model":model,"did":"scale","uid":10,"accountId":10,
                      "data":{"bodyResData":{"weight":66.4,"bfp":21.0}}},
                    {"createTime":measured,"model":"unrelated.scales.model","uid":10,"accountId":10,
                      "data":{"weight":61}},
                    {"createTime":measured,"accountId":10,"data":{"weight":70}},
                    {"createTime":measured,"model":model,"accountId":11,"data":{"weight":83}}
                ]))
            });
            let state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
            {
                let mut inner = state.inner.lock().await;
                inner.selected = Some("home".into());
                inner.generation = 7;
                inner.devices = vec![serde_json::from_value(json!({
                    "did":"scale","model":model,"name":"scale",
                    "online":false,"roomId":"room","roomName":"room"
                }))
                .unwrap()];
            }
            let report = state
                .scale_history("home".into(), 7, "scale".into(), Default::default())
                .await
                .unwrap();
            assert_eq!(report.source, scale::Source::MemberCloud);
            assert_eq!(report.member_id.as_deref(), Some("10"));
            assert_eq!(report.page.omitted, 3);
            assert_eq!(report.page.records.len(), 1);
            assert_eq!(report.page.records[0].weight, 66.4);
            assert_eq!(report.pending_supported, pending_supported);
            assert_eq!(
                report.page.records[0].metrics.contains_key("bodyFat"),
                body_composition
            );
            if pending_supported {
                let pending = read_pending(&state).await;
                assert_eq!(pending.page.records.len(), 1);
                assert_eq!(pending.page.records[0].weight, 65.1);
                assert!(pending.page.records[0].metrics.is_empty());
                assert!(!pending.pending_editable);
                assert!(pending.pending_claim_member_ids.is_empty());
            }
        }
    }

    #[tokio::test]
    async fn standard_weight_uses_the_exact_spec_and_own_account_and_keeps_live_readings_out_of_history(
    ) {
        use crate::metadata_cache::{Key, MetadataCache};
        let typ = "urn:miot-spec-v2:device:scale:0000A07D:z9527-1356:1";
        let specs = SpecRepository::from_test_metadata(MetadataCache::fixture(
            Key::Instance(typ.into()),
            json!({"type":typ,"services":[{
                "iid":2,"type":"urn:miot-spec-v2:service:scale:0000784D:z9527-1356:1",
                "properties":[{"iid":1,"type":"urn:miot-spec-v2:property:body-weight:000000A2:z9527-1356:1",
                    "format":"float","unit":"kg","access":["read","notify"],"value-range":[1,200,0.1]}]
            }]}),
        ).await);
        let measured = epoch_secs() - 60;
        let requests = Arc::new(std::sync::Mutex::new(Vec::new()));
        let captured = requests.clone();
        let current_only = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let simulate_current = current_only.clone();
        let cloud = Cloud::new(auth::Credentials {
            user_id: "10".into(),
            security: "AAAAAAAAAAAAAAAAAAAAAA==".into(),
            service_token: "fixture".into(),
            region: "cn".into(),
            device_id: "fixture".into(),
            service_id: "mijia".into(),
            c_user_id: "fixture".into(),
        })
        .unwrap()
        .with_test_request(move |path, params| {
            captured.lock().unwrap().push(path.to_string());
            let params = params.unwrap();
            if path == "/miotspec/prop/get" {
                assert_eq!(params["params"], json!([{"did":"scale","siid":2,"piid":1}]));
                return Ok(json!([{"did":"scale","siid":2,"piid":1,"code":0,"value":62.4}]));
            }
            assert_eq!(path, "/user/get_user_device_data");
            assert_eq!(params["did"], "scale");
            assert_eq!(params["uid"], "10");
            assert_eq!(params["key"], "2.1");
            assert_eq!(params["limit"], 20);
            if simulate_current.load(std::sync::atomic::Ordering::Relaxed) {
                return Ok(json!([]));
            }
            Ok(json!([
                {"did":"scale","uid":10,"key":"2.1","time":measured,"value":"[64.8]"},
                {"did":"scale","uid":11,"key":"2.1","time":measured,"value":"[61.2]"},
                {"did":"another","uid":10,"key":"2.1","time":measured,"value":"[65.1]"},
                {"did":"scale","uid":10,"key":"2.2","time":measured,"value":"[69.3]"},
                {"did":"scale","uid":10,"key":"2.1","time":measured,"value":"[64000]"}
            ]))
        });
        let mut state = AppState::with_session(Some(Arc::new(cloud)), None).unwrap();
        state.specs = Arc::new(specs);
        let device = serde_json::from_value(
            json!({"did":"scale","model":"z9527.scales.1356","name":"scale",
            "specType":typ,"online":false,"roomId":"room","roomName":"room"}),
        )
        .unwrap();
        {
            let mut inner = state.inner.lock().await;
            inner.selected = Some("home".into());
            inner.generation = 7;
            inner.homes = vec![Home {
                id: "home".into(),
                name: "home".into(),
                owner_id: "10".into(),
                shared: false,
                rooms: vec![],
                room_devices: Default::default(),
            }];
            inner.devices = vec![device];
        }
        let report = state
            .scale_history("home".into(), 7, "scale".into(), Default::default())
            .await
            .unwrap();
        assert_eq!(report.source, scale::Source::DeviceHistory);
        assert_eq!(report.members.len(), 0);
        assert_eq!(report.member_id, None);
        assert_eq!(report.page.records.len(), 1);
        assert_eq!(report.page.records[0].weight, 64.8);
        assert_eq!(report.page.omitted, 4);
        current_only.store(true, std::sync::atomic::Ordering::Relaxed);
        state.inner.lock().await.devices[0].online = true;
        let live = state
            .scale_history("home".into(), 7, "scale".into(), Default::default())
            .await
            .unwrap();
        assert_eq!(live.latest_weight, Some(62.4));
        assert!(live.page.records.is_empty());
        {
            let mut inner = state.inner.lock().await;
            inner.homes[0].shared = true;
            inner.homes[0].owner_id = "11".into();
        }
        let shared = state
            .scale_history("home".into(), 7, "scale".into(), Default::default())
            .await
            .unwrap();
        assert_eq!(shared.source, scale::Source::Unavailable);
        assert!(shared.page.records.is_empty());
        assert_eq!(
            requests.lock().unwrap().as_slice(),
            [
                "/user/get_user_device_data",
                "/user/get_user_device_data",
                "/miotspec/prop/get",
            ]
        );
    }
}
