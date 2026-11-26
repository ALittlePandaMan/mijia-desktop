use super::{Engine, Handler};
use crate::{
    app_settings::Store,
    error::{AppError, Result},
    local_secret,
};
use axum::{
    body::Body,
    extract::DefaultBodyLimit,
    http::{Request, StatusCode},
    middleware::{self, Next},
    response::Response,
    Router,
};
use rmcp::transport::streamable_http_server::{
    session::local::LocalSessionManager, StreamableHttpServerConfig, StreamableHttpService,
};
use serde_json::{json, Value};
use std::{
    net::SocketAddr,
    sync::{Arc, Mutex},
};
use subtle::ConstantTimeEq;
use tokio_util::sync::CancellationToken;
pub(crate) fn bearer_rejection(supplied:Option<&axum::http::HeaderValue>,expected:&[u8])->Option<Response> {
    if supplied.is_some_and(|value|bool::from(value.as_bytes().ct_eq(expected))){None}
    else{Some(Response::builder().status(StatusCode::UNAUTHORIZED)
        .header("WWW-Authenticate","Bearer realm=\"mijia-desktop\"")
        .body(Body::empty()).unwrap())}
}
pub struct Manager {
    pub engine: Arc<Engine>,
    cancel: Mutex<CancellationToken>,
    pub status: Mutex<Value>,
    tasks: Mutex<Vec<tokio::task::JoinHandle<()>>>,
    restart: tokio::sync::Mutex<()>,
}
impl Manager {
    pub fn new(app: tauri::AppHandle, settings: Arc<Store>) -> Arc<Self> {
        Arc::new(Self {
            engine: Engine::new(app, settings),
            cancel: Mutex::new(CancellationToken::new()),
            status: Mutex::new(json!({"state":"stopped"})),
            tasks: Mutex::new(vec![]),
            restart: tokio::sync::Mutex::new(()),
        })
    }
    pub fn status(&self) -> Value {
        self.status
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone()
    }
    pub async fn stop(&self) {
        self.cancel.lock().unwrap().cancel();
        self.engine
            .key_epoch
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel);
        let tasks = std::mem::take(&mut *self.tasks.lock().unwrap());
        for mut task in tasks {
            if tokio::time::timeout(std::time::Duration::from_secs(3), &mut task)
                .await
                .is_err()
            {
                task.abort();
                let _ = task.await;
            }
        }
        self.engine.stop().await;
        *self.status.lock().unwrap() = json!({"state":"stopped"});
    }
    pub async fn restart(self: &Arc<Self>) -> Result<()> {
        let _guard = self.restart.lock().await;
        self.stop().await;
        self.engine.watch_account().await;
        let settings = self.engine.settings.get().mcp;
        if !settings.enabled {
            return Ok(());
        }
        let key = local_secret::access_key()?;
        let cancel = CancellationToken::new();
        *self.cancel.lock().unwrap() = cancel.clone();
        let address = SocketAddr::from(([127, 0, 0, 1], settings.local_port));
        let local = tokio::net::TcpListener::bind(address)
            .await
            .map_err(|_| AppError::new("portInUse", "本机 MCP 端口不可用。", false))?;
        let app = router(self.engine.clone(), key, address, cancel.clone());
        let local_cancel = cancel.clone();
        let task = tokio::spawn(async move {
            let _ = axum::serve(local, app)
                .with_graceful_shutdown(local_cancel.cancelled_owned())
                .await;
        });
        self.tasks.lock().unwrap().push(task);
        *self.status.lock().unwrap() = json!({"state":"running","localUrl":format!("http://127.0.0.1:{}/mcp",settings.local_port)});
        Ok(())
    }
    pub async fn apply(self: &Arc<Self>) {
        if let Err(error) = self.restart().await {
            *self.status.lock().unwrap() = json!({"state":"error","error":error});
        }
        use tauri::Emitter;
        let _ = self.engine.app.emit("application-settings-changed", ());
    }
}
fn router(
    engine: Arc<Engine>,
    key: String,
    address: SocketAddr,
    cancel: CancellationToken,
) -> Router {
    let epoch = engine.key_epoch.load(std::sync::atomic::Ordering::Acquire);
    let factory = engine.clone();
    let mut config = StreamableHttpServerConfig::default();
    config.cancellation_token = cancel;
    config.json_response = true;
    config.allowed_hosts = vec![address.to_string()];
    config.allowed_origins = vec![format!("http://{}", address)];
    if address.ip().is_loopback() {
        config
            .allowed_hosts
            .push(format!("localhost:{}", address.port()));
        config
            .allowed_origins
            .push(format!("http://localhost:{}", address.port()));
    }
    let service = StreamableHttpService::new(
        move || Ok(Handler(factory.clone(), epoch)),
        Arc::new(LocalSessionManager::default()),
        config,
    );
    let concurrency = Arc::new(tokio::sync::Semaphore::new(16));
    let bearer = Arc::new(zeroize::Zeroizing::new(format!("Bearer {key}")));
    Router::new()
        .nest_service("/mcp", service)
        .layer(DefaultBodyLimit::max(2 * 1024 * 1024))
        .layer(middleware::from_fn(
            move |req: Request<Body>, next: Next| {
                let expected = bearer.clone();
                let permits = concurrency.clone();
                let engine = engine.clone();
                async move {
                    if epoch != engine.key_epoch.load(std::sync::atomic::Ordering::Acquire)
                        || !engine.settings.get().mcp.enabled
                    {
                        return Response::builder()
                            .status(StatusCode::SERVICE_UNAVAILABLE)
                            .body(Body::empty())
                            .unwrap();
                    }
                    if let Some(response)=bearer_rejection(req.headers().get("authorization"),expected.as_bytes()){return response;}
                    let Ok(_permit) = permits.try_acquire_owned() else {
                        return Response::builder()
                            .status(StatusCode::TOO_MANY_REQUESTS)
                            .body(Body::empty())
                            .unwrap();
                    };
                    let (parts, body) = req.into_parts();
                    let body = match tokio::time::timeout(
                        std::time::Duration::from_secs(5),
                        axum::body::to_bytes(body, 2 * 1024 * 1024),
                    )
                    .await
                    {
                        Ok(Ok(bytes)) => bytes,
                        _ => {
                            return Response::builder()
                                .status(StatusCode::PAYLOAD_TOO_LARGE)
                                .body(Body::empty())
                                .unwrap()
                        }
                    };
                    next.run(Request::from_parts(parts, Body::from(body))).await
                }
            },
        ))
}
