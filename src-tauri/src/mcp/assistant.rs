use super::*;
use crate::{
    cloud_assistant::{self as assistant, execution::Task, protocol::Request, scope::TargetScope},
    mcp_core::{self as core, journal::Record, response},
};
use tokio_util::sync::CancellationToken;
struct TaskRecovery {engine:Arc<Engine>,scope:String,target:TargetScope}
impl assistant::execution::Recovery for TaskRecovery {
    fn permits(&self,rule:assistant::fallback::Rule)->bool {rule.enabled&&rule.verification=="verifiedPreExecutionRejection"}
    fn prepare_phase<'a>(&'a self,parent:&'a str,phase:assistant::execution::RecoveryPhase)->assistant::transport::Io<'a,String>{
        Box::pin(async move{
            self.engine.check_assistant_scope(&self.scope,&self.target).await?;
            let executor=self.engine.executor()?;
            let record=executor.journal.lookup(&self.scope,parent)?.ok_or_else(invalid)?;
            if record.task_status!="running"{return Err(AppError::stale())}
            let mut task=record.assistant.ok_or_else(invalid)?;
            if task.attempts.len()>=3{return Err(invalid())}
            let id=uuid::Uuid::new_v4().to_string();
            task.attempts.push(json!({"source":"backendAttempt","parentRequestId":parent,"requestId":id,"phase":format!("{phase:?}"),"preparedAt":core::now_ms()}));
            executor.journal.assistant(&self.scope,parent,task)?;
            Ok(id)
        })
    }
    fn refresh_access<'a>(&'a self,_:&'a crate::auth::Credentials)->assistant::transport::Io<'a,zeroize::Zeroizing<String>>{
        Box::pin(async move{self.engine.check_assistant_scope(&self.scope,&self.target).await?;let state=self.engine.app.state::<AppState>();let (cloud,epoch)=state.assistant_identity().await?;state.assistant.refresh_access(&cloud.credentials,epoch).await})
    }
    fn refresh_mijia<'a>(&'a self,_:&'a crate::auth::Credentials)->assistant::transport::Io<'a,crate::auth::Credentials>{
        Box::pin(async move{self.engine.check_assistant_scope(&self.scope,&self.target).await?;let state=self.engine.app.state::<AppState>();state.refresh_mijia_session().await?;Ok(state.assistant_identity().await?.0.credentials.copy_secret())})
    }
}
impl Engine {
    pub(super) async fn assistant_call(self: &Arc<Self>, args: Value) -> Result<CallToolResult> {
        let requested_at = Instant::now();
        let request: Request = serde_json::from_value(args).map_err(|_| invalid())?;
        request.validate()?;
        let scope = self.scope().await?;
        let executor = self.executor()?;
        let fingerprint = core::fingerprint(&json!({"kind":"familyCloudAssistant","query":request.query,"complexity":request.complexity,"home_id":request.home_id}));
        if let Some(old)=executor.journal.lookup(&scope,&request.request_id)? {
            if old.fingerprint!=fingerprint||old.assistant.is_none(){return Err(AppError::new("requestConflict","相同请求ID的任务或参数不同。",false));}
            self.can_view_assistant(&old)?;
            return self.assistant_response(&old,&json!({}));
        }
        let homes=tokio::time::timeout(Duration::from_secs(4),self.selected_homes()).await.map_err(|_|AppError::new("directoryUnavailable","家庭目录暂不可用，未发送请求。",true))??;
        let selected:Vec<String>=homes.iter().map(|h|h.id.clone()).collect();
        let home_ids = match assistant::scope::select_homes(&request, &selected) {
            Ok(ids) => ids,
            Err(e) if e.kind == "clarificationRequired" => {
                return Ok(CallToolResult::structured_error(
                    json!({"kind":e.kind,"requestId":request.request_id,"submitted":false,"message":e.message,"candidates":homes.iter().map(|h|json!({"home_id":h.id,"name":h.name})).collect::<Vec<_>>()}),
                ))
            }
            Err(e) => return Err(e),
        };
        let home = if home_ids.len() == 1 {
            home_ids[0].clone()
        } else {
            core::fingerprint(&home_ids)
        };
        let state = self.app.state::<AppState>();
        let status = state.assistant_status(false).await?;
        if !status.region_supported {
            return Err(assistant::error("assistantRegionUnsupported"));
        }
        if status.expires_at.is_none() {
            return Err(assistant::error("assistantAuthorizationRequired"));
        }
        let generation = state.assistant.generation().await;
        let target_scope = TargetScope {
            home_id: if request.complexity == "complex" {
                home.clone()
            } else {
                String::new()
            },
            owner_uid: if home_ids.len()==1 {homes.iter().find(|h|h.id==home_ids[0]).map(|h|h.owner_id.clone()).unwrap_or_default()}else{String::new()},
            auth_home_ids:selected.clone(),
            home_ids,
            devices: vec![],
            permission_ids: vec![],
            channels: vec![],
            grant_epoch: self
                .settings
                .grant_epoch
                .load(std::sync::atomic::Ordering::Acquire),
            key_epoch: self.key_epoch.load(std::sync::atomic::Ordering::Acquire),
            directory_revision: core::fingerprint(&selected),
            auth_generation: generation,
        };
        let proof = assistant::scope::delegate(target_scope.clone(), &selected);
        let blocked = proof.as_ref().err().map(|e| e.kind.clone());
        let task = Task {
            route_requested: request.complexity.clone(),
            route_used: None,
            intent_hash: core::fingerprint(&request.query),
            scope: target_scope.clone(),
            authorization_generation: generation,
            phase: if blocked.is_some() {
                "blocked"
            } else {
                "queued"
            }
            .into(),
            request_attempted: false,
            request_submitted: Some(false),
            remote: None,
            error: blocked,
            events: vec![],
            elapsed_ms: 0,
            trace: vec![],
            attempts: vec![],
        };
        let receipt = Record {
            assistant: Some(task),
            scope: scope.clone(),
            home: home.clone(),
            request_id: request.request_id.clone(),
            fingerprint,
            directory_revision: core::fingerprint(&selected),
            target: json!({"home_ids":target_scope.home_ids}),
            on: false,
            created_at: core::now_ms(),
            deadline: core::now_ms() + 185000,
            targets: vec![],
            entries: vec![],
            issues: vec![],
            target_complete: true,
            phase: "assistant".into(),
            task_status: if proof.is_err() {
                "completed"
            } else {
                "running"
            }
            .into(),
            revision: 1,
            legacy: false,
            legacy_result: None,
            memory_status: None,
            operation_memory: None,
        };
        let admission = self.control_admission.lock().await;
        self.check_assistant_scope(&scope, &target_scope).await?;
        let admitted = executor.journal.admit(receipt)?;
        drop(admission);
        if let Ok(proof) = proof {
            if admitted {
                let cancel = CancellationToken::new();
                let job_key = format!("{scope}:{}", request.request_id);
                self.assistant_jobs
                    .lock()
                    .await
                    .insert(job_key.clone(), cancel.clone());
                let engine = self.clone();
                let request_clone = request.clone();
                let scope_clone = scope.clone();
                tokio::spawn(Box::pin(async move {
                    engine
                        .run_assistant(request_clone, scope_clone, proof, cancel, job_key)
                        .await;
                }));
            }
        }
        let record = executor
            .wait(
                &scope,
                &request.request_id,
                None,
                5000u64.saturating_sub(requested_at.elapsed().as_millis() as u64),
            )
            .await?;
        self.assistant_response(&record, &json!({}))
    }
    fn can_view_assistant(&self, r: &Record) -> Result<()> {
        let task = r
            .assistant
            .as_ref()
            .ok_or_else(|| AppError::new("notFound", "助手任务不存在。", false))?;
        if task.scope.home_ids.is_empty()
            || task.scope.home_ids.iter().chain(&task.scope.auth_home_ids).any(|id| !self.settings.home_selected(&r.scope,id))
        {
            return Err(AppError::new(
                "permissionDenied",
                "任务的家庭选择已变化。",
                false,
            ));
        }
        Ok(())
    }
    async fn check_assistant_scope(&self, scope: &str, t: &TargetScope) -> Result<()> {
        if self.scope().await? != scope
            || self
                .settings
                .grant_epoch
                .load(std::sync::atomic::Ordering::Acquire)
                != t.grant_epoch
            || self.key_epoch.load(std::sync::atomic::Ordering::Acquire) != t.key_epoch
            || self.app.state::<AppState>().assistant.generation().await != t.auth_generation
            || !self.settings.get().mcp.enabled
            || t.home_ids
                .iter().chain(&t.auth_home_ids)
                .any(|id| !self.settings.home_selected(scope, id))
        {
            return Err(AppError::stale());
        }
        Ok(())
    }
    async fn run_assistant(
        self: Arc<Self>,
        request: Request,
        scope: String,
        proof: assistant::scope::DelegatedScope,
        cancel: CancellationToken,
        key: String,
    ) {
        let Ok(executor) = self.executor() else {
            return;
        };
        let started = Instant::now();
        let id = request.request_id.clone();
        let progress = Arc::new(core::assistant_progress::Recorder::new(executor.journal.clone(), scope.clone(), id.clone(), started, cancel.clone()));
        let recorder = progress.clone();
        let progress_executor = executor.clone();
        let emit: assistant::transport::Emit = Arc::new(move |event| {
            if recorder.record(event) { progress_executor.changed.notify_waiters(); }
        });
        let outcome=tokio::time::timeout(Duration::from_secs(185),self.assistant_dispatch.run(&cancel,async{
        self.check_assistant_scope(&scope,proof.target()).await?;
        let(cloud,epoch)=self.app.state::<AppState>().assistant_identity().await?;
        let auth=self.app.state::<AppState>().assistant.clone();let token=auth.access(&cloud.credentials,epoch).await?;
        self.check_assistant_scope(&scope,proof.target()).await?;
        let recovery=Arc::new(TaskRecovery{engine:self.clone(),scope:scope.clone(),target:proof.target().clone()});
        let future=assistant::execution::run_with_recovery(auth.wire(),&cloud.credentials,&token,&request,&proof,cancel.clone(),emit,recovery);
        tokio::pin!(future);
        let mut check=tokio::time::interval(Duration::from_millis(100));
        loop{tokio::select!{r=&mut future=>{if self.check_assistant_scope(&scope,proof.target()).await.is_err(){break Err(AppError::stale())}break r},_=check.tick()=>{if self.check_assistant_scope(&scope,proof.target()).await.is_err(){cancel.cancel();}}}}
    })).await.unwrap_or_else(|_|{cancel.cancel();Err(assistant::error("assistantTimeout"))});
        let outcome = match progress.error() { Some(error) => Err(error), None => outcome };
        if let Ok(Some(record)) = executor.journal.lookup(&scope, &id) {
            if record.task_status == "running" {
                if let Some(mut task) = record.assistant {
                    task.elapsed_ms = started.elapsed().as_millis() as u64;
                    let mut status = "completed";
                    match outcome {
                        Ok(remote) => {
                            task.phase = "finished".into();
                            task.request_submitted = Some(true);
                            task.trace.push(assistant::execution::Stage {
                                phase: "response".into(),
                                endpoint_category: if remote.route_used == "simple" {
                                    "subAgent"
                                } else {
                                    "complexStream"
                                }
                                .into(),
                                business_code: remote.code,
                                elapsed_ms: task.elapsed_ms,
                            });
                            task.route_used=Some(remote.route_used.clone());
                            task.remote = Some(remote)
                        }
                        Err(e) => {
                            if e.kind == "assistantCancelled" {
                                status = "cancelled";
                                task.phase = "cancelled".into();
                            } else if e.kind == "assistantTimeout" {
                                status = "timedOut";
                                task.phase = "timedOut".into();
                            } else {
                                task.phase = "finished".into();
                            }
                            task.error = Some(e.kind)
                        }
                    }
                    let _ = executor.journal.assistant(&scope, &id, task);
                    let _ = executor.journal.end(&scope, &id, status, None);
                    executor.changed.notify_waiters();
                }
            }
        }
        self.assistant_jobs.lock().await.remove(&key);
    }
    pub(super) fn assistant_response(&self, r: &Record, args: &Value) -> Result<CallToolResult> {
        core::assistant_result::render(r, args)
    }
    pub(super) async fn get_assistant_task(
        self: &Arc<Self>,
        args: Value,
    ) -> Result<CallToolResult> {
        let scope = self.scope().await?;
        let executor = self.executor()?;
        let id = field(&args, "requestId")?;
        let record = executor
            .journal
            .lookup(&scope, id)?
            .ok_or_else(|| AppError::new("notFound", "助手任务不存在。", false))?;
        self.can_view_assistant(&record)?;
        let record = executor
            .wait(
                &scope,
                id,
                args["afterRevision"].as_u64(),
                args["waitMs"].as_u64().unwrap_or(0),
            )
            .await?;
        self.assistant_response(&record, &args)
    }
    pub(super) async fn cancel_assistant(self: &Arc<Self>, args: Value) -> Result<CallToolResult> {
        let scope = self.scope().await?;
        let id = field(&args, "requestId")?;
        let executor = self.executor()?;
        let record = executor
            .journal
            .lookup(&scope, id)?
            .ok_or_else(|| AppError::new("notFound", "助手任务不存在。", false))?;
        self.can_view_assistant(&record)?;
        if let Some(cancel) = self
            .assistant_jobs
            .lock()
            .await
            .get(&format!("{scope}:{id}"))
        {
            cancel.cancel();
        }
        response::bounded(
            json!({"requestId":id,"cancelRequested":record.task_status=="running","taskStatus":record.task_status,"deviceActionsReversed":false,"retryWrite":false}),
            4096,
        )
    }
}
