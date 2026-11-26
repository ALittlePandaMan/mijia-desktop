//! Real Streamable HTTP framing against an offline-only tool adapter.
use super::*;
use rmcp::{model::*,service::RequestContext,RoleServer,ServerHandler};
use serde_json::{json,Value};
use std::sync::{Arc,Mutex};
use std::sync::atomic::{AtomicUsize,Ordering};
#[derive(Default)]
struct Calls {
 calls:Mutex<Vec<(String,Value)>>,
 gate:Mutex<Option<Arc<tokio::sync::Barrier>>>,
 active:AtomicUsize,
 peak:AtomicUsize,
}
#[derive(Clone,Default)]
struct Server(Arc<Mutex<std::collections::HashMap<String,Value>>>,Arc<Mutex<std::collections::HashMap<String,journal::Record>>>,Arc<Calls>);
impl ServerHandler for Server{
 fn get_info(&self)->ServerConfig{guide::server_config()}
 async fn list_resources(&self,_:Option<PaginatedRequestParams>,_:RequestContext<RoleServer>)->std::result::Result<ListResourcesResult,rmcp::ErrorData>{Ok(ListResourcesResult::with_all_items(guide::resources()))}
 async fn read_resource(&self,p:ReadResourceRequestParams,_:RequestContext<RoleServer>)->std::result::Result<ReadResourceResponse,rmcp::ErrorData>{Ok(guide::resource_result(&p.uri).unwrap().into())}
 async fn list_tools(&self,p:Option<PaginatedRequestParams>,_:RequestContext<RoleServer>)->std::result::Result<ListToolsResult,rmcp::ErrorData>{tools::require_first_page(p.as_ref().and_then(|p|p.cursor.as_deref()))?;Ok(ListToolsResult::with_all_items(tools::definitions()))}
 fn get_tool(&self,name:&str)->Option<Tool>{tools::definitions().into_iter().find(|t|t.name==name)}
 async fn call_tool(&self,p:CallToolRequestParams,_:RequestContext<RoleServer>)->std::result::Result<CallToolResponse,rmcp::ErrorData>{
  tools::require_known_tool(&p.name)?;
  let args=Value::Object(p.arguments.unwrap_or_default());
  if let Err(e)=tools::validate_arguments(&p.name,&args){return Ok(response::error(&p.name,e).into());}
  self.2.calls.lock().unwrap().push((p.name.to_string(),args.clone()));
  if p.name=="miot_ask_assistant" {
   let gate=self.2.gate.lock().unwrap().clone();
   if let Some(gate)=gate {
    let active=self.2.active.fetch_add(1,Ordering::SeqCst)+1;
    self.2.peak.fetch_max(active,Ordering::SeqCst);
    tokio::time::timeout(std::time::Duration::from_secs(2),gate.wait()).await.expect("Streamable HTTP serialized independent tool calls");
    self.2.active.fetch_sub(1,Ordering::SeqCst);
   }
  }
  if p.name=="get_assistant_task" {
   if let Some(record)=self.1.lock().unwrap().get(args["requestId"].as_str().unwrap()) {
    return Ok(assistant_result::render(record,&args).unwrap().into());
   }
  }
  let value=match p.name.as_ref(){
   "get_status"=>json!({"loggedIn":true,"scopeMode":"householdDelegation","serverEnforcedScope":"unverified"}),
   "skills_manage"=>guide::skill_index(args["skillId"].as_str()).unwrap(),
   "tools_search"=>tools::search(args["query"].as_str().unwrap()),
   "miot_list_devices"=>json!({"items":[{"home_id":"1","name":"模拟家庭"},{"home_id":"2","name":"模拟宿舍"}],"cursor":null}),
   "miot_ask_assistant"=>{
    let input:crate::cloud_assistant::protocol::Request=serde_json::from_value(args.clone()).unwrap();
    let homes=match crate::cloud_assistant::scope::select_homes(&input,&["1".into(),"2".into()]){Ok(h)=>h,Err(e)=>return Ok(response::error(&p.name,e).into())};
    let mut tasks=self.0.lock().unwrap();let id=input.request_id;
    if let Some(old)=tasks.get(&id){if old["intent"]!=fingerprint(&args){return Ok(response::error(&p.name,crate::error::AppError::new("requestConflict","参数不同",false)).into());}old.clone()}
    else{let task=json!({"requestId":id,"intent":fingerprint(&args),"taskStatus":"running","home_ids":homes,"retryWrite":false,"verification":"notPerformed","source":"offlineMockOnly"});tasks.insert(id,task.clone());task}
   },
   "get_assistant_task"=>self.0.lock().unwrap().get(args["requestId"].as_str().unwrap()).cloned().unwrap_or(json!({"kind":"notFound"})),
   "cancel_assistant_task"=>{let mut tasks=self.0.lock().unwrap();let task=tasks.get_mut(args["requestId"].as_str().unwrap()).unwrap();task["taskStatus"]=json!("cancelled");json!({"requestId":args["requestId"],"deviceActionsReversed":false,"taskStatus":"cancelled"})},
   _=>unreachable!(),
  };Ok(response::bounded(value,128*1024).unwrap().into())
 }
}
fn decode(bytes:&[u8])->Value{if let Ok(v)=serde_json::from_slice(bytes){return v;}let text=String::from_utf8_lossy(bytes);serde_json::from_str(text.lines().find_map(|l|l.strip_prefix("data:").filter(|v|!v.trim().is_empty())).unwrap()).unwrap()}
#[cfg(feature="desktop")]
#[tokio::test]
async fn modern_protocol_uses_production_guards_auth_challenge_and_sdk_metadata() {
 use axum::{body::Body,http::Request,middleware::{self,Next}};
 use rmcp::transport::streamable_http_server::{session::local::LocalSessionManager,StreamableHttpServerConfig,StreamableHttpService};
 let state=Server::default();let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();
 let factory=state.clone();let mut config=StreamableHttpServerConfig::default();config.json_response=true;config.allowed_hosts=vec![addr.to_string()];config.allowed_origins=vec![format!("http://{addr}")];
 let service=StreamableHttpService::new(move||Ok(factory.clone()),Arc::new(LocalSessionManager::default()),config);
 let app=axum::Router::new().nest_service("/mcp",service).layer(middleware::from_fn(|req:Request<Body>,next:Next|async move{
  if let Some(response)=crate::mcp::transport::bearer_rejection(req.headers().get("authorization"),b"Bearer offline-key"){return response;}next.run(req).await
 }));
 let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});let url=format!("http://{addr}/mcp");let client=reqwest::Client::new();
 let rpc=|method:&str,mut params:Value|{
  params["_meta"]=json!({"io.modelcontextprotocol/protocolVersion":"2026-07-28","io.modelcontextprotocol/clientInfo":{"name":"offline-modern","version":"1"},"io.modelcontextprotocol/clientCapabilities":{}});
  let mut request=client.post(&url).header("Accept","application/json, text/event-stream").header("Authorization","Bearer offline-key").header("MCP-Protocol-Version","2026-07-28").header("Mcp-Method",method);
  if let Some(name)=params["name"].as_str().or(params["uri"].as_str()){request=request.header("Mcp-Name",name);}
  request.json(&json!({"jsonrpc":"2.0","id":1,"method":method,"params":params}))
 };
 let missing=client.post(&url).json(&json!({})).send().await.unwrap();assert_eq!(missing.status(),401);assert_eq!(missing.headers()["www-authenticate"],"Bearer realm=\"mijia-desktop\"");
 let forbidden=rpc("tools/list",json!({})).header("Origin","https://invalid.example").send().await.unwrap();assert_eq!(forbidden.status(),403);
 for (method,params) in [("server/discover",json!({})),("tools/list",json!({})),("resources/list",json!({})),("resources/read",json!({"uri":guide::assistant_skill_uri()}))] {
  let response=rpc(method,params).send().await.unwrap();assert!(response.status().is_success());assert!(response.headers().get("mcp-session-id").is_none());let v=decode(&response.bytes().await.unwrap());assert!(v.get("error").is_none(),"{v}");assert_eq!(v["result"]["ttlMs"],0);assert_eq!(v["result"]["cacheScope"],"private");
 }
 for cursor in ["invalid",""] {let response=rpc("tools/list",json!({"cursor":cursor})).send().await.unwrap();let v=decode(&response.bytes().await.unwrap());assert_eq!(v["error"]["code"],-32602);}
 let v=decode(&rpc("tools/call",json!({"name":"unknown_tool","arguments":{}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(v["error"]["code"],-32602);assert!(state.2.calls.lock().unwrap().is_empty());
 let v=decode(&rpc("tools/call",json!({"name":"tools_search","arguments":{"query":""}})).send().await.unwrap().bytes().await.unwrap());assert!(v.get("error").is_none());assert_eq!(v["result"]["isError"],true);
 server.abort();
}
#[tokio::test]
async fn streamable_http_exposes_seven_tools_resources_task_poll_and_cancel(){
 use rmcp::transport::streamable_http_server::{session::local::LocalSessionManager,StreamableHttpServerConfig,StreamableHttpService};
 let state=Server::default();let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();
 let factory=state.clone();let mut config=StreamableHttpServerConfig::default();config.json_response=true;config.allowed_hosts=vec![addr.to_string()];
 let service=StreamableHttpService::new(move||Ok(factory.clone()),Arc::new(LocalSessionManager::default()),config);
 let app=axum::Router::new().nest_service("/mcp",service);let server=tokio::spawn(async move{axum::serve(listener,app).await.unwrap()});
 let client=reqwest::Client::new();let url=format!("http://{addr}/mcp");
 let init=client.post(&url).header("Accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"offline-family-fixture","version":"2"}}})).send().await.unwrap();
 assert!(init.status().is_success());let session=init.headers()["mcp-session-id"].to_str().unwrap().to_owned();let info=decode(&init.bytes().await.unwrap());assert!(info["result"]["instructions"].as_str().unwrap().contains("miot_ask_assistant"));assert!(info["result"]["capabilities"]["resources"].is_object());
 client.post(&url).header("Accept","application/json, text/event-stream").header("Mcp-Session-Id",&session).json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).send().await.unwrap();
 let rpc=|method:&str,params:Value|client.post(&url).header("Accept","application/json, text/event-stream").header("Mcp-Session-Id",&session).json(&json!({"jsonrpc":"2.0","id":2,"method":method,"params":params}));
 let listed=rpc("tools/list",json!({})).send().await.unwrap().bytes().await.unwrap();let list=decode(&listed);assert_eq!(list["result"]["tools"].as_array().unwrap().len(),7);assert!(listed.len()<16384);
 let resources=decode(&rpc("resources/list",json!({})).send().await.unwrap().bytes().await.unwrap());assert!(!resources["result"]["resources"].as_array().unwrap().is_empty());
 let skill=decode(&rpc("resources/read",json!({"uri":guide::assistant_skill_uri()})).send().await.unwrap().bytes().await.unwrap());assert!(skill["result"]["contents"][0]["text"].as_str().unwrap().contains("name: device-collaboration"));
 let search=decode(&rpc("tools/call",json!({"name":"tools_search","arguments":{"query":"select:miot_ask_assistant"}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(search["result"]["structuredContent"]["tools"][0]["name"],"miot_ask_assistant");assert_eq!(search["result"]["structuredContent"]["activationRequired"],false);
 let index=decode(&rpc("tools/call",json!({"name":"skills_manage","arguments":{"action":"readIndex","skillId":"device-collaboration"}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(index["result"]["structuredContent"]["skillMd"],guide::assistant_skill());
 let list=decode(&rpc("tools/call",json!({"name":"miot_list_devices","arguments":{}})).send().await.unwrap().bytes().await.unwrap());assert!(list["result"]["structuredContent"]["items"].as_array().unwrap().len()==2);
 let id=uuid::Uuid::new_v4().to_string();let args=json!({"query":"关闭模拟宿舍空调","complexity":"simple","requestId":id});
 for _ in 0..2{let r=decode(&rpc("tools/call",json!({"name":"miot_ask_assistant","arguments":args})).send().await.unwrap().bytes().await.unwrap());assert_eq!(r["result"]["structuredContent"]["home_ids"],json!(["1","2"]));}
 assert_eq!(state.0.lock().unwrap().len(),1);
 let r=decode(&rpc("tools/call",json!({"name":"get_assistant_task","arguments":{"requestId":id}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(r["result"]["structuredContent"]["taskStatus"],"running");
 let r=decode(&rpc("tools/call",json!({"name":"miot_ask_assistant","arguments":{"query":"关闭","complexity":"complex","requestId":uuid::Uuid::new_v4().to_string()}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(r["result"]["structuredContent"]["kind"],"clarificationRequired");
 for _ in 0..2{let r=decode(&rpc("tools/call",json!({"name":"cancel_assistant_task","arguments":{"requestId":id}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(r["result"]["structuredContent"]["deviceActionsReversed"],false);}
 let r=decode(&rpc("tools/call",json!({"name":"control_power","arguments":{}})).send().await.unwrap().bytes().await.unwrap());assert_eq!(r["error"]["code"],-32602);
 // Seed completed offline results, then exercise the production presentation over real HTTP.
 let record=assistant_result::tests::fixture("客厅温度25.9°C。");let result_id=record.request_id.clone();state.1.lock().unwrap().insert(result_id.clone(),record);
 let r=decode(&rpc("tools/call",json!({"name":"get_assistant_task","arguments":{"requestId":result_id}})).send().await.unwrap().bytes().await.unwrap());
 let v=&r["result"]["structuredContent"];assert_eq!(v["reply"],"客厅温度25.9°C。");assert_eq!(v["verification"],"notPerformed");assert_eq!(v["retryWrite"],false);assert!(v.get("elapsedMs").is_none());
 let record=assistant_result::tests::fixture(&"长答复25.9°C🌡️".repeat(800));let original=record.assistant.as_ref().unwrap().remote.as_ref().unwrap().reply.clone();let result_id=record.request_id.clone();state.1.lock().unwrap().insert(result_id.clone(),record);
 let mut args=json!({"requestId":result_id,"details":true});let mut restored=String::new();let mut count=0;
 loop {
  let r=decode(&rpc("tools/call",json!({"name":"get_assistant_task","arguments":args})).send().await.unwrap().bytes().await.unwrap());
  assert!(serde_json::to_vec(&r["result"]).unwrap().len()<=assistant_result::BUDGET);
  let v=&r["result"]["structuredContent"];for row in v["items"].as_array().unwrap(){if let Some(s)=row["reply"].as_str(){restored.push_str(s);}}
  count+=1;if let Some(c)=v["cursor"].as_str(){args=json!({"requestId":result_id,"cursor":c});}else{break;}assert!(count<100);
 }
 assert_eq!(restored,original);assert!(count>1);assert_eq!(state.0.lock().unwrap().len(),1); // No new intent was submitted for verification.
 server.abort();
}

#[tokio::test]
async fn streamable_http_accepts_parallel_independent_uuids_without_discovery_or_readback(){
 use rmcp::transport::streamable_http_server::{session::local::LocalSessionManager,StreamableHttpServerConfig,StreamableHttpService};
 let state=Server::default();*state.2.gate.lock().unwrap()=Some(Arc::new(tokio::sync::Barrier::new(2)));
 let listener=tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();let addr=listener.local_addr().unwrap();
 let factory=state.clone();let mut config=StreamableHttpServerConfig::default();config.json_response=true;config.allowed_hosts=vec![addr.to_string()];
 let service=StreamableHttpService::new(move||Ok(factory.clone()),Arc::new(LocalSessionManager::default()),config);
 let server=tokio::spawn(async move{axum::serve(listener,axum::Router::new().nest_service("/mcp",service)).await.unwrap()});
 let client=reqwest::Client::builder().timeout(std::time::Duration::from_secs(5)).build().unwrap();let url=format!("http://{addr}/mcp");
 let init=client.post(&url).header("Accept","application/json, text/event-stream").json(&json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"offline-parallel-fixture","version":"5"}}})).send().await.unwrap();
 let session=init.headers()["mcp-session-id"].to_str().unwrap().to_owned();let info=decode(&init.bytes().await.unwrap());
 assert!(info["result"]["instructions"].as_str().unwrap().contains("同轮并行"));
 client.post(&url).header("Accept","application/json, text/event-stream").header("Mcp-Session-Id",&session).json(&json!({"jsonrpc":"2.0","method":"notifications/initialized"})).send().await.unwrap();
 let call=|id:u64,name:&str,args:Value|client.post(&url).header("Accept","application/json, text/event-stream").header("Mcp-Session-Id",&session).json(&json!({"jsonrpc":"2.0","id":id,"method":"tools/call","params":{"name":name,"arguments":args}}));
 let light_id=uuid::Uuid::new_v4().to_string();let climate_id=uuid::Uuid::new_v4().to_string();assert_ne!(light_id,climate_id);
 let light=json!({"query":"打开客厅灯","complexity":"simple","requestId":light_id});
 let climate=json!({"query":"打开客厅空调","complexity":"simple","requestId":climate_id});
 let (a,b)=tokio::join!(call(2,"miot_ask_assistant",light.clone()).send(),call(3,"miot_ask_assistant",climate.clone()).send());
 for response in [a.unwrap(),b.unwrap()] {let value=decode(&response.bytes().await.unwrap());assert_eq!(value["result"]["structuredContent"]["taskStatus"],"running");}
 assert_eq!(state.2.peak.load(Ordering::SeqCst),2);assert_eq!(state.0.lock().unwrap().len(),2);
 *state.2.gate.lock().unwrap()=None;
 // Only unfinished original IDs are polled. Duplicate submissions stay one task.
 for (index,args) in [light,climate].into_iter().enumerate(){
  let id=args["requestId"].clone();
  let value=decode(&call(4+index as u64,"get_assistant_task",json!({"requestId":id})).send().await.unwrap().bytes().await.unwrap());
  assert_eq!(value["result"]["structuredContent"]["requestId"],id);
  let value=decode(&call(6+index as u64,"miot_ask_assistant",args).send().await.unwrap().bytes().await.unwrap());assert_eq!(value["result"]["structuredContent"]["requestId"],id);
 }
 assert_eq!(state.0.lock().unwrap().len(),2);
 let calls=state.2.calls.lock().unwrap();assert_eq!(calls.len(),6);
 assert!(calls.iter().all(|(name,_)|matches!(name.as_str(),"miot_ask_assistant"|"get_assistant_task")));
 assert_eq!(calls[0].1["complexity"],"simple");assert_eq!(calls[1].1["complexity"],"simple");
 assert!(calls.iter().filter(|(name,_)|name=="miot_ask_assistant").all(|(_,args)|args["query"]=="打开客厅灯"||args["query"]=="打开客厅空调"));
 server.abort();
}

