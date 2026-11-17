//! Household delegation only. No local MCP device-control or learning routes.
mod assistant;
pub mod transport;
use crate::{
    app_settings::Store,
    error::{AppError, Result},
    models::Home,
    state::AppState,
};
use rmcp::{model::*, service::RequestContext, RoleServer, ServerHandler};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    sync::Arc,
    time::{Duration, Instant},
};
use tauri::Manager;
use tokio::sync::{Mutex, Semaphore};
pub struct Engine {
    pub app: tauri::AppHandle,
    pub settings: Arc<Store>,
    executor: Result<Arc<crate::mcp_core::executor::Executor>>,
    assistant_jobs: Mutex<HashMap<String, tokio_util::sync::CancellationToken>>,
    assistant_dispatch: crate::cloud_assistant::dispatch::Dispatcher,
    control_admission: Mutex<()>,
    account: Mutex<Option<String>>,
    directory: crate::mcp_core::directory::Directory,
    pub calls: Semaphore,
    pub key_epoch: Arc<std::sync::atomic::AtomicU64>,
}
fn invalid() -> AppError {
    AppError::invalid("MCP 参数无效。")
}
fn field<'a>(args: &'a Value, key: &str) -> Result<&'a str> {
    args[key]
        .as_str()
        .filter(|s| !s.is_empty() && s.chars().count() <= 2000)
        .ok_or_else(invalid)
}
impl Engine {
    pub fn new(app: tauri::AppHandle, settings: Arc<Store>) -> Arc<Self> {
        let executor = crate::app_settings::directory()
            .and_then(|root| {
                crate::mcp_core::journal::Journal::open(root.join("mcp/requests-v1.jsonl"))
            })
            .map(|j| crate::mcp_core::executor::Executor::new(Arc::new(j)));
        let directory=crate::mcp_core::directory::Directory::new(app.state::<AppState>().assistant.wire());
        Arc::new(Self {
            app,
            settings,
            executor,
            assistant_jobs: Mutex::new(HashMap::new()),
            assistant_dispatch: crate::cloud_assistant::dispatch::Dispatcher::default(),
            control_admission: Mutex::new(()),
            account: Mutex::new(None),
            directory,
            calls: Semaphore::new(16),
            key_epoch: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        })
    }
    fn executor(&self) -> Result<Arc<crate::mcp_core::executor::Executor>> {
        self.executor.clone()
    }
    pub async fn scope(&self) -> Result<String> {
        self.app.state::<AppState>().account_scope().await
    }
    pub async fn watch_account(self: &Arc<Self>) {
        if let Ok(e) = &self.executor {
            let _ = e.journal.maintain();
        }
        let scope = self.scope().await.ok();
        let changed = {
            let mut old = self.account.lock().await;
            let changed = *old != scope;
            *old = scope;
            changed
        };
        if changed {
            self.stop().await;
        }
    }
    pub async fn stop(&self) {
        for c in self.assistant_jobs.lock().await.values() {
            c.cancel();
        }
        self.directory.clear().await;
    }
    async fn catalog_homes(&self) -> Result<(Vec<crate::mcp_core::directory::CatalogHome>,u64)> {
        let scope=self.scope().await?;
        let (cloud,_)=self.app.state::<AppState>().assistant_identity().await?;
        let result=match self.directory.homes(&cloud.credentials).await {
            Ok(v)=>v,
            Err(e) if matches!(e.kind.as_str(),"authExpired"|"assistantAuthorizationRequired")=>{
                self.app.state::<AppState>().refresh_mijia_session().await?;
                let (fresh,_)=self.app.state::<AppState>().assistant_identity().await?;
                self.directory.homes(&fresh.credentials).await?
            },Err(e)=>return Err(e),
        };
        if self.scope().await? != scope {return Err(AppError::stale());}
        Ok(result)
    }
    async fn homes(&self) -> Result<Vec<Home>> {
        Ok(self.catalog_homes().await?.0.into_iter().map(|h|h.home).collect())
    }
    async fn home_context(&self) -> Result<Value> {
        let scope=self.scope().await?;
        let (homes,updated)=self.catalog_homes().await?;
        let homes=homes.into_iter().filter(|h|self.settings.home_selected(&scope,&h.home.id)).map(|h|h.home).collect::<Vec<_>>();
        if self.scope().await? != scope {return Err(AppError::stale());}
        Ok(crate::mcp_core::directory::context(&homes,updated))
    }
    async fn skill_index(&self,args:&Value)->Result<CallToolResult>{
        let mut value=crate::mcp_core::guide::skill_index(args["skillId"].as_str())?;
        value["homeContext"]=match tokio::time::timeout(Duration::from_secs(4),self.home_context()).await {
            Ok(Ok(v))=>v,
            Ok(Err(e))=>json!({"available":false,"reason":e.kind,"source":"accountUntrusted","homes":[],"truncated":false}),
            Err(_)=>json!({"available":false,"reason":"directoryUnavailable","source":"accountUntrusted","homes":[],"truncated":false}),
        };
        crate::mcp_core::response::bounded(value,128*1024)
    }
    async fn selected_homes(&self) -> Result<Vec<Home>> {
        let scope = self.scope().await?;
        Ok(self
            .homes()
            .await?
            .into_iter()
            .filter(|h| self.settings.home_selected(&scope, &h.id))
            .collect())
    }
    pub async fn validate_settings(
        &self,
        before: &crate::app_settings::AppSettings,
        value: &crate::app_settings::AppSettings,
    ) -> Result<()> {
        if before.mcp.excluded_homes == value.mcp.excluded_homes {
            return Ok(());
        }
        let scope = self.scope().await?;
        let others = |s: &crate::app_settings::AppSettings| {
            s.mcp
                .excluded_homes
                .iter()
                .filter(|h| h.scope != scope)
                .cloned()
                .collect::<Vec<_>>()
        };
        if others(before) != others(value) {
            return Err(AppError::new(
                "permissionDenied",
                "不能修改其他账号的家庭选择。",
                false,
            ));
        }
        let homes = self.homes().await?;
        if value
            .mcp
            .excluded_homes
            .iter()
            .filter(|h| h.scope == scope && !before.mcp.excluded_homes.contains(h))
            .any(|h| !homes.iter().any(|actual| actual.id == h.home_id))
        {
            return Err(AppError::new(
                "homeDenied",
                "家庭不在当前账号目录中。",
                false,
            ));
        }
        Ok(())
    }
    async fn list_devices(&self,args:Value)->Result<CallToolResult>{
        let scope=self.scope().await?;
        let (all,updated)=self.catalog_homes().await?;
        let homes=all.into_iter().filter(|h|self.settings.home_selected(&scope,&h.home.id)).collect::<Vec<_>>();
        let selected=args["home_id"].as_str();
        if selected.is_some_and(|id|!homes.iter().any(|h|h.home.id==id)){return Err(AppError::new("homeDenied","该家庭未勾选或不可访问。",false));}
        let chosen=homes.into_iter().filter(|h|selected.is_none_or(|id|h.home.id==id)).collect::<Vec<_>>();
        let unrestricted=selected.is_none()&&!chosen.is_empty()&&!self.settings.get().mcp.excluded_homes.iter().any(|h|h.scope==scope);
        let (cloud,_)=self.app.state::<AppState>().assistant_identity().await?;
        let result=self.directory.list(&cloud.credentials,&chosen,unrestricted).await;
        if self.scope().await?!=scope{return Err(AppError::stale());}
        let key=format!("directory:{scope}:{}:{}",selected.unwrap_or("*"),unrestricted);
        let revision=crate::mcp_core::fingerprint(&(&result.rows,&result.summary));
        let start=crate::mcp_core::response::offset(args["cursor"].as_str(),&key,&revision)?;
        crate::mcp_core::response::page(&key,&revision,start,&result.rows,json!({"summary":result.summary,"cachedAt":updated,"cacheTtlSeconds":300,"source":"accountUntrusted","scopeMode":"householdDelegation","serverEnforcedScope":"unverified"}),32*1024,100)
    }
    pub async fn call(self: &Arc<Self>, name: &str, args: Value) -> Result<CallToolResult> {
        crate::mcp_core::tools::validate_arguments(name, &args)?;
        if !self.settings.get().mcp.enabled {
            return Err(AppError::new("disabled", "MCP 服务已关闭。", false));
        }
        let epoch = self.key_epoch.load(std::sync::atomic::Ordering::Acquire);
        let grant = self
            .settings
            .grant_epoch
            .load(std::sync::atomic::Ordering::Acquire);
        let scope = self.scope().await.ok();
        let result = match name {
            "get_status" => {
                let state = self.app.state::<AppState>();
                let session = state.session().await?;
                let assistant = state.assistant_status(false).await?;
                let mut fallback=crate::cloud_assistant::fallback::status();
                fallback.as_object_mut().unwrap().remove("rules");
                fallback["resourceUri"]=json!("mijia://assistant/v1/recovery");
                let count = if session.logged_in {
                    tokio::time::timeout(Duration::from_secs(4),self.selected_homes()).await.ok().and_then(|v|v.ok()).map(|h| h.len())
                } else {
                    None
                };
                crate::mcp_core::response::bounded(
                    json!({"version":env!("CARGO_PKG_VERSION"),"loggedIn":session.logged_in,"transport":"streamable-http","selectedHomeCount":count,"scopeMode":"householdDelegation","serverEnforcedScope":"unverified","assistant":assistant,"taskJournalReady":self.executor.is_ok(),"fallback":fallback,"skillVersion":crate::mcp_core::guide::revision(),"homeContextResource":crate::mcp_core::directory::CONTEXT_URI}),
                    4096,
                )
            }
            "skills_manage" => self.skill_index(&args).await,
            "tools_search" => crate::mcp_core::response::bounded(crate::mcp_core::tools::search(field(&args,"query")?),32*1024),
            "miot_list_devices" => self.list_devices(args).await,
            "miot_ask_assistant" => self.assistant_call(args).await,
            "get_assistant_task" => self.get_assistant_task(args).await,
            "cancel_assistant_task" => self.cancel_assistant(args).await,
            _ => Err(invalid()),
        };
        if epoch != self.key_epoch.load(std::sync::atomic::Ordering::Acquire)
            || grant
                != self
                    .settings
                    .grant_epoch
                    .load(std::sync::atomic::Ordering::Acquire)
            || scope != self.scope().await.ok()
        {
            return Err(AppError::stale());
        }
        result
    }
}
#[derive(Clone)]
pub struct Handler(pub Arc<Engine>, pub u64);
fn tool_definitions() -> Vec<Tool> {
    crate::mcp_core::tools::definitions()
}
impl ServerHandler for Handler {
    fn get_info(&self) -> ServerConfig {
        crate::mcp_core::guide::server_config()
    }
    async fn list_resources(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<ListResourcesResult, rmcp::ErrorData> {
        if self.1 != self.0.key_epoch.load(std::sync::atomic::Ordering::Acquire)
            || !self.0.settings.get().mcp.enabled
        {
            return Err(rmcp::ErrorData::invalid_request("MCP 会话已失效。", None));
        }
        if request.is_some_and(|p| p.cursor.is_some()) {
            return Err(rmcp::ErrorData::invalid_params(
                "静态指南资源列表没有后续页。",
                None,
            ));
        }
        let mut resources=crate::mcp_core::guide::resources();
        resources.push(Resource::new(crate::mcp_core::directory::CONTEXT_URI,"selected-home-context").with_mime_type("application/json").with_description("当前账号已选家庭上下文；不可信账户数据，24KiB预算。"));
        Ok(ListResourcesResult::with_all_items(resources))
    }
    async fn read_resource(
        &self,
        request: ReadResourceRequestParams,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<ReadResourceResponse, rmcp::ErrorData> {
        if self.1 != self.0.key_epoch.load(std::sync::atomic::Ordering::Acquire)
            || !self.0.settings.get().mcp.enabled
        {
            return Err(rmcp::ErrorData::invalid_request("MCP 会话已失效。", None));
        }
        if request.uri==crate::mcp_core::directory::CONTEXT_URI {
            let value=self.0.home_context().await.map_err(|e|rmcp::ErrorData::invalid_request(e.message,None))?;
            return Ok(ReadResourceResult::new(vec![ResourceContents::text(serde_json::to_string(&value).unwrap(),request.uri)]).into());
        }
        let result = crate::mcp_core::guide::resource_result(&request.uri).map_err(|e| {
            if e.kind == "notFound" {
                rmcp::ErrorData::resource_not_found(e.message, None)
            } else {
                rmcp::ErrorData::invalid_params(e.message, None)
            }
        })?;
        Ok(result.into())
    }
    async fn list_tools(
        &self,
        request: Option<PaginatedRequestParams>,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<ListToolsResult, rmcp::ErrorData> {
        crate::mcp_core::tools::require_first_page(request.as_ref().and_then(|p|p.cursor.as_deref()))?;
        Ok(ListToolsResult::with_all_items(tool_definitions()))
    }
    fn get_tool(&self, name: &str) -> Option<Tool> {
        tool_definitions().into_iter().find(|t| t.name == name)
    }
    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        _: RequestContext<RoleServer>,
    ) -> std::result::Result<CallToolResponse, rmcp::ErrorData> {
        crate::mcp_core::tools::require_known_tool(&request.name)?;
        if self.1 != self.0.key_epoch.load(std::sync::atomic::Ordering::Acquire) {
            return Ok(CallToolResult::structured_error(json!({"kind":"revoked"})).into());
        }
        let Ok(_permit) = self.0.calls.try_acquire() else {
            return Ok(CallToolResult::structured_error(json!({"kind":"busy"})).into());
        };
        let args = Value::Object(request.arguments.clone().unwrap_or_default());
        let result = match tokio::time::timeout(
            Duration::from_secs(45),
            Box::pin(self.0.call(&request.name, args)),
        )
        .await
        {
            Ok(Ok(result)) => result,
            Ok(Err(error)) => crate::mcp_core::response::error(&request.name, error),
            Err(_) => CallToolResult::structured_error(
                json!({"kind":"timeout","retryWrite":false,"message":"请求超时；控制结果未知时仅查询原任务，不新建控制请求或重复下发。"}),
            ),
        };
        Ok(result.into())
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn mcp_entry_future_fits_windows_stack_budget() {
        std::thread::Builder::new()
            .stack_size(16 * 1024 * 1024)
            .spawn(|| {
                let engine: Option<std::sync::Arc<super::Engine>> = std::hint::black_box(None);
                let future = async {
                    engine
                        .as_ref()
                        .unwrap()
                        .call("get_status", serde_json::json!({}))
                        .await
                };
                let size = std::mem::size_of_val(&future);
                eprintln!("mcp entry future bytes={size}");
                assert!(size < 128 * 1024);
            })
            .unwrap()
            .join()
            .unwrap();
    }
}
