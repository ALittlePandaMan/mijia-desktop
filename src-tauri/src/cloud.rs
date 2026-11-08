use crate::{
    auth::{Credentials, USER_AGENT},
    crypto,
    error::{AppError, Result},
    models::{id, AccountProfile, Device, DevicePanel, Home, HomeOrder, Room, SplitRoute},
};
use reqwest::{Client, Method};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io::Read,
    time::Duration,
};

pub struct Cloud {
    pub credentials: Credentials,
    client: Client,
    artwork: tokio::sync::Mutex<HashMap<String, (u64, Option<String>)>>,
    profile: tokio::sync::Mutex<Option<AccountProfile>>,
    pub(crate) camera_event_cache: tokio::sync::Mutex<crate::camera::events::EventCache>,
}

async fn bounded_bytes(mut response: reqwest::Response, limit: usize) -> Result<Vec<u8>> {
    if response.content_length().is_some_and(|n| n > limit as u64) {
        return Err(AppError::protocol());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(AppError::network)? {
        if bytes.len().saturating_add(chunk.len()) > limit {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    Ok(bytes)
}
enum DeviceRpc {
    Read,
    Write,
    Action,
}
impl DeviceRpc {
    fn method(&self) -> &'static str {
        match self {
            Self::Read => "get_properties",
            Self::Write => "set_properties",
            Self::Action => "action",
        }
    }
}

impl Cloud {
    pub(crate) async fn scale_index(&self, device: &Device) -> Result<Value> {
        crate::scale::validate_device(device)?;
        self.request_method(Method::POST, crate::scale::INDEX,
            json!({"uid":self.credentials.user_id,"accountId":self.credentials.user_id,"deviceId":device.control_did()}), Some(&device.model)).await
    }
    pub(crate) async fn scale_records(
        &self,
        device: &Device,
        account: &str,
        before: u64,
        after: u64,
        summary: bool,
        unclaimed: bool,
    ) -> Result<Value> {
        crate::scale::validate_device(device)?;
        let uid = self
            .credentials
            .user_id
            .parse::<u64>()
            .map_err(|_| AppError::protocol())?;
        let account = account.parse::<u64>().map_err(|_| AppError::protocol())?;
        let params=if unclaimed {json!({"uid":self.credentials.user_id,"accountId":account.to_string(),"did":device.control_did(),"model":device.model,"beginTime":before,"endTime":after,"pageSize":crate::scale::PAGE_SIZE})}else{json!({"uid":uid,"accountId":account,"did":device.control_did(),"model":device.model,"param":{"filter":if summary{1}else{0},"filterTime":0,"filterMode":if summary{1}else{3},"pageSize":if summary{14}else{crate::scale::PAGE_SIZE},"beginTime":before,"endTime":after}})};
        self.request_method(Method::POST,if unclaimed{crate::scale::UNCLAIMED}else{crate::scale::RECORDS},params,Some(&device.model)).await
    }
    pub(crate) async fn scale_call(&self,device:&Device,path:&str,params:Value)->Result<Value>{
        crate::scale::validate_device(device)?;
        if !["/eco/scale/account/add","/eco/scale/account/update","/eco/scale/account/remove","/eco/scale/account/addAccountCode","/eco/common/scale/add","/eco/common/scale/remove","/eco/common/scale/addClaimDel","/eco/scale/batch_bcalc"].contains(&path){return Err(AppError::invalid("未核实的体脂秤云端操作。"));}
        let result=self.request_method(Method::POST,path,params,Some(&device.model)).await?;
        if result.get("code").is_some_and(|v|v.as_i64().or_else(||v.as_str().and_then(|s|s.parse::<i64>().ok()))!=Some(0)) {
            return Err(AppError::new("scaleCloud","体脂秤云端未确认此操作，请刷新核对。",false));
        }
        if path=="/eco/common/scale/addClaimDel" && !result.as_object().is_some_and(|v|v.is_empty()) {return Err(AppError::protocol());}
        Ok(result)
    }
    pub(crate) async fn bath_heater_rpc(
        &self,
        device: &Device,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        crate::bath_heater::validate_device(device)?;
        if !["get_prop", "set_power", "set_bh_mode"].contains(&method) {
            return Err(AppError::invalid("未验证的浴霸指令。"));
        }
        let path = crate::dispenser::rpc_path(device.control_did())?;
        self.request(&path,json!({"id":(rand::random::<u32>()&0x7fff_ffff).max(1),"method":method,"params":params})).await
    }
    pub(crate) async fn ceiling_fan_rpc(
        &self,
        device: &Device,
        method: &str,
        params: Value,
    ) -> Result<Value> {
        crate::ceiling_fan::validate_device(device)?;
        if ![
            "get_prop",
            "set_power",
            "set_bh_mode",
            "set_gears_idx",
            "set_swing",
            "set_bright",
        ]
        .contains(&method)
        {
            return Err(AppError::invalid("未验证的凉霸指令。"));
        }
        let path = crate::dispenser::rpc_path(device.control_did())?;
        self.request(&path,json!({"id":(rand::random::<u32>()&0x7fff_ffff).max(1),"method":method,"params":params})).await
    }
    pub async fn account_profile(&self) -> Result<AccountProfile> {
        let mut cached = self.profile.lock().await;
        if let Some(profile) = cached
            .as_ref()
            .filter(|p| crate::models::epoch_secs().saturating_sub(p.fetched_at) < 3600)
        {
            return Ok(profile.clone());
        }
        let data = self
            .request("/home/profile", json!({"id":self.credentials.user_id}))
            .await?;
        let profile = crate::account_profile::parse_profile(&data, &self.credentials.user_id)?;
        *cached = Some(profile.clone());
        Ok(profile)
    }
    pub fn new(credentials: Credentials) -> Result<Self> {
        credentials.validate()?;
        let client = Client::builder()
            .user_agent(USER_AGENT)
            // Mutations are tracked and independently confirmed by AppState.
            // Never let transport policy replay them outside that state machine.
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(15))
            .timeout(Duration::from_secs(35))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(AppError::network)?;
        Ok(Self {
            credentials,
            client,
            artwork: tokio::sync::Mutex::new(HashMap::new()),
            profile: tokio::sync::Mutex::new(None),
            camera_event_cache: tokio::sync::Mutex::new(Default::default()),
        })
    }
    pub async fn request(&self, path: &str, data: Value) -> Result<Value> {
        self.request_method(Method::POST, path, data, None).await
    }
    pub async fn request_get(&self, path: &str, data: Value) -> Result<Value> {
        self.request_method(Method::GET, path, data, None).await
    }
    pub(crate) async fn request_router_daily_action(
        &self,
        path: &str,
        data: Value,
    ) -> Result<Value> {
        if ![
            crate::router_daily::START,
            crate::router_daily::APPLY,
            crate::router_daily::SCAN_START,
            crate::router_daily::SCAN_APPLY,
        ]
        .contains(&path)
            || data["method"] != "GET"
        {
            return Err(AppError::invalid("不支持的Wi-Fi优化请求。"));
        }
        let r = self
            .request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await?;
        crate::router_family::success(&r)?;
        Ok(r)
    }
    pub(crate) async fn request_router_scene_read(&self, data: Value) -> Result<Value> {
        let payload = data["params"]["payload"]
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .ok_or_else(AppError::protocol)?;
        if data["method"] != "GET"
            || payload["api"] != 610
            || payload["pluginID"] != crate::router_scene::PLUGIN
            || !payload["cmd"]
                .as_str()
                .is_some_and(crate::router_scene::read_command)
        {
            return Err(AppError::invalid("不支持的测速读取请求。"));
        }
        self.request_method(
            Method::POST,
            crate::router_scene::PATH,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub(crate) async fn request_router_scene_write(&self, data: Value) -> Result<Value> {
        let payload = data["params"]["payload"]
            .as_str()
            .and_then(|s| serde_json::from_str::<Value>(s).ok())
            .ok_or_else(AppError::protocol)?;
        if data["method"] != "GET"
            || payload["api"] != 610
            || payload["pluginID"] != crate::router_scene::PLUGIN
            || !payload["cmd"]
                .as_str()
                .is_some_and(crate::router_scene::write_command)
        {
            return Err(AppError::invalid("不支持的测速操作请求。"));
        }
        self.request_method(
            Method::POST,
            crate::router_scene::PATH,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub async fn request_router_read(&self, path: &str, data: Value) -> Result<Value> {
        if !crate::router::is_read_path(path) {
            return Err(AppError::invalid("不支持的路由器读取接口。"));
        }
        let expected = if path == crate::router::INIT {
            "POST"
        } else {
            "GET"
        };
        if data["method"] != expected {
            return Err(AppError::invalid("路由器只读请求的方法无效。"));
        }
        self.request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await
    }
    pub(crate) async fn request_router_client_rename(&self, data: Value) -> Result<Value> {
        if data["method"] != "POST" {
            return Err(AppError::invalid("设备名称请求的方法无效。"));
        }
        self.request_method(
            Method::POST,
            crate::router::CLIENT_RENAME,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub(crate) async fn request_router_classification(&self, data: Value) -> Result<Value> {
        if data["method"] != "post" {
            return Err(AppError::invalid("设备分类请求方法无效。"));
        }
        self.request_method(
            Method::POST,
            crate::router::CLIENT_CLASSIFY,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub(crate) async fn request_router_qos(&self, path: &str, data: Value) -> Result<Value> {
        if !crate::router_qos::is_write_path(path) || data["method"] != "GET" {
            return Err(AppError::invalid("不支持的智能限速请求。"));
        }
        self.request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await
    }
    pub(crate) async fn request_router_family(&self, data: Value) -> Result<Value> {
        if data["method"] != "POST" {
            return Err(AppError::invalid("家人上网保护请求方法无效。"));
        }
        let response = self
            .request_method(
                Method::POST,
                crate::router_family::SET,
                data,
                Some(crate::router::MODEL),
            )
            .await?;
        crate::router_family::success(&response)?;
        Ok(response)
    }
    pub(crate) async fn request_router_url(&self, path: &str, data: Value) -> Result<Value> {
        if !crate::router_url::is_write_path(path) || data["method"] != "GET" {
            return Err(AppError::invalid("不支持的网址访问控制请求。"));
        }
        let response = self
            .request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await?;
        crate::router_url::success(&response)?;
        Ok(response)
    }
    pub(crate) async fn request_router_access(&self, path: &str, data: Value) -> Result<Value> {
        if !crate::router_access::is_write_path(path) || data["method"] != "GET" {
            return Err(AppError::invalid("不支持的防蹭网请求。"));
        }
        self.request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await
    }
    pub(crate) async fn request_router_led_write(&self, data: Value) -> Result<Value> {
        self.request_method(
            Method::POST,
            crate::router::LED,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub(crate) async fn request_router_wifi_write(&self, data: Value) -> Result<Value> {
        // Plugin 11195 uses the helper's default inner GET even for this write.
        // Keep the mutating route separate from the read-only allowlist.
        if data["method"] != "GET" {
            return Err(AppError::invalid("Wi-Fi设置请求的方法无效。"));
        }
        self.request_method(
            Method::POST,
            crate::router::WIFI_SAVE,
            data,
            Some(crate::router::MODEL),
        )
        .await
    }
    pub(crate) async fn request_router_advanced_write(
        &self,
        path: &str,
        data: Value,
    ) -> Result<Value> {
        if !crate::router_advanced::is_write_path(path) || data["method"] != "GET" {
            return Err(AppError::invalid("不支持的高级Wi-Fi设置请求。"));
        }
        self.request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await
    }
    pub(crate) async fn request_router_network_write(
        &self,
        path: &str,
        data: Value,
    ) -> Result<Value> {
        if !crate::router_network::is_write_path(path) || data["method"] != "POST" {
            return Err(AppError::invalid("不支持的网络设置请求。"));
        }
        self.request_method(Method::POST, path, data, Some(crate::router::MODEL))
            .await
    }
    pub(crate) async fn request_washer_config(
        &self,
        device: &Device,
        data: Value,
    ) -> Result<Value> {
        self.request_method(
            Method::POST,
            "/eco/major_appliance/washer/config/query",
            data,
            Some(&device.model),
        )
        .await
    }
    pub(crate) async fn request_washer_log(&self, path: &str) -> Result<Value> {
        if !path.contains('?')
            || path.contains('#')
            || !matches!(
                path.split('?').next(),
                Some(
                    "/appliance/washer/log/statistics"
                        | "/appliance/washer/log/list"
                        | "/appliance/washer/log/id"
                        | "/eco/common/scale/indexInfo"
                        | "/eco/scale/getData"
                )
            )
        {
            return Err(AppError::invalid("不支持的洗衣记录接口。"));
        }
        self.request_optional_method(Method::POST, path, None, Some(crate::washer::MODEL))
            .await
    }
    pub(crate) async fn request_favorite(
        &self,
        device: &Device,
        path: &str,
        data: Value,
    ) -> Result<Value> {
        if !matches!(
            path,
            "/user/get_user_coll"
                | "/user/set_user_coll"
                | "/user/edit_user_coll"
                | "/user/del_user_coll"
        ) {
            return Err(AppError::invalid("不支持的收藏接口。"));
        }
        self.request_method(Method::POST, path, data, Some(&device.model))
            .await
    }
    async fn request_method(
        &self,
        method: Method,
        path: &str,
        data: Value,
        model: Option<&str>,
    ) -> Result<Value> {
        self.request_optional_method(method, path, Some(data), model)
            .await
    }
    async fn request_optional_method(
        &self,
        method: Method,
        path: &str,
        data: Option<Value>,
        model: Option<&str>,
    ) -> Result<Value> {
        self.request_scoped_method(method, path, data, model, false)
            .await
    }
    /// Closed camera metadata route from the original camera API provider.
    /// Endpoint, domain, device and range are selected by the backend adapter.
    pub(crate) async fn camera_events(
        &self,
        device: &Device,
        start: u64,
        end: u64,
    ) -> Result<Value> {
        let mut params = json!({
            "did":device.control_did(),"model":device.model,"eventType":"Default",
            "beginTime":start,"endTime":end,"limit":50,"needMerge":true
        });
        // HL4G plugin 1031395-v52 Util.getEventList: all channels when channel
        // is omitted. This is cloud metadata, independent of the SD protocol.
        if device.model == "xiaomi.camera.hl4g" {
            params["doorBell"] = json!(false);
        }
        self.request_scoped_method(
            Method::GET,
            "/common/app/get/eventlist",
            Some(params),
            Some(&device.model),
            true,
        )
        .await
    }
    /// Original CloudVideoNetUtils.getVideoFileUrl. Identifiers originate in
    /// the authenticated event list; callers never supply an upstream URL.
    pub(crate) async fn camera_cloud_file(
        &self,
        device: &Device,
        path: &str,
        data: Value,
        limit: usize,
    ) -> Result<Vec<u8>> {
        if !matches!(path, "/common/app/m3u8" | "/common/app/v1/img")
            || !(crate::camera::profiles::care(&device.model)
                || crate::camera::profiles::doorbell(&device.model).is_some())
            || device.split_route.is_some()
        {
            return Err(AppError::invalid("没有已核实的云录像资源绑定。"));
        }
        let role = if path.ends_with("/img") {
            "processor"
        } else {
            "business"
        };
        let host = if self.credentials.service_id == "mijia" {
            format!("app.{role}.smartcamera.api.mijia.tech")
        } else if self.credentials.region == "cn" {
            format!("app.{role}.smartcamera.api.io.mi.com")
        } else {
            format!(
                "{}.app.{role}.smartcamera.api.io.mi.com",
                self.credentials.region
            )
        };
        let nonce = crypto::random_nonce();
        let (fields, _) = crypto::encrypt_request_method_profile(
            "GET",
            path,
            &data.to_string(),
            &self.credentials.security,
            &nonce,
            true,
        )?;
        let cookie = format!(
            "userId={}; cUserId={}; serviceToken={}; yetAnotherServiceToken={}",
            self.credentials.user_id,
            self.credentials.c_user_id,
            self.credentials.service_token,
            self.credentials.service_token
        );
        let response = self
            .client
            .get(format!("https://{host}{path}"))
            .query(&fields)
            .header(reqwest::header::COOKIE, cookie)
            .header("MIOT-REQUEST-MODEL", &device.model)
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(AppError::network)?;
        if !response.status().is_success() {
            return Err(cloud_http_error(response).await);
        }
        if response.content_length().is_some_and(|n| n > limit as u64) {
            return Err(AppError::protocol());
        }
        bounded_bytes(response, limit).await
    }
    pub(crate) async fn camera_cloud_segment(
        &self,
        device: &Device,
        url: &str,
        key: bool,
    ) -> Result<Vec<u8>> {
        let url = crate::camera::cloud_media::asset_url(
            &self.credentials.region,
            &self.credentials.service_id,
            device,
            url,
            key,
        )?;
        let response = self
            .client
            .get(url)
            .header("Accept-Encoding", "identity")
            .send()
            .await
            .map_err(AppError::network)?;
        if !response.status().is_success() {
            return Err(cloud_http_error(response).await);
        }
        bounded_bytes(response, if key { 1024 } else { 16 * 1024 * 1024 }).await
    }
    pub(crate) async fn doorbell_cloud_events(
        &self,
        device: &Device,
        start: u64,
        end: u64,
        limit: usize,
    ) -> Result<Value> {
        crate::camera::doorbell_cloud::validate_device(device)?;
        if start > end || end - start > 86_400_000 || limit == 0 || limit > 20 {
            return Err(AppError::invalid("门铃云录像查询范围无效。"));
        }
        self.request_scoped_method(
            Method::GET,
            &crate::camera::profiles::doorbell(&device.model).ok_or_else(AppError::protocol)?.endpoint,
            Some(json!({"did":device.control_did(),"region":self.credentials.region.to_uppercase(),"model":device.model,"eventType":"Default","beginTime":start,"endTime":end,"limit":limit,"needMerge":true,"doorBell":true,"sortType":"DESC"})),
            Some(&device.model),
            true,
        ).await
    }
    pub(crate) async fn doorbell_cloud_status(&self, device: &Device) -> Result<Value> {
        crate::camera::doorbell_cloud::validate_device(device)?;
        self.request_scoped_method(
            Method::GET,
            "/miot/camera/app/v1/vip/status",
            Some(json!({"did":device.control_did(),"region":self.credentials.region.to_uppercase(),"language":"zh"})),
            Some(&device.model),
            true,
        )
        .await
    }
    async fn request_scoped_method(
        &self,
        method: Method,
        path: &str,
        data: Option<Value>,
        model: Option<&str>,
        camera: bool,
    ) -> Result<Value> {
        let host = if self.credentials.service_id == "mijia" {
            if crate::dispenser::is_rpc_path(path)
                || crate::router::is_gateway_path(path)
                || matches!(
                    path.split('?').next().unwrap_or(path),
                    "/v2/homeroom/get_dev_room_page"
                        | "/v2/plugin/get_standard_operation"
                        | "/v2/plugin/category_standard_model"
                        | "/appgateway/gspec/Gspec/spec_multi_language"
                        | "/user/get_user_device_data"
                        | "/user/get_user_coll"
                        | "/user/set_user_coll"
                        | "/user/edit_user_coll"
                        | "/user/del_user_coll"
                        | "/v2/user/statistics"
                        | "/v2/remote/ubus"
                        | "/scene/list"
                        | "/scene/edit"
                        | "/v2/device/batch_set_props"
                        | "/scene/delete"
                        | "/v2/device/getsettingv2"
                        | "/device/setsetting"
                        | "/eco/major_appliance/washer/config/query"
                        | "/appliance/washer/log/statistics"
                        | "/appliance/washer/log/list"
                        | "/appliance/washer/log/id"
                )
            {
                "api.mijia.tech".to_owned()
            } else {
                "core.api.mijia.tech".to_owned()
            }
        } else if self.credentials.region == "cn" {
            "api.io.mi.com".to_owned()
        } else {
            format!("{}.api.io.mi.com", self.credentials.region)
        };
        let host = if camera {
            if self.credentials.service_id == "mijia" {
                "app.business.smartcamera.api.mijia.tech".to_owned()
            } else if self.credentials.region == "cn" {
                "app.business.smartcamera.api.io.mi.com".to_owned()
            } else {
                format!(
                    "{}.app.business.smartcamera.api.io.mi.com",
                    self.credentials.region
                )
            }
        } else {
            host
        };
        let nonce = crypto::random_nonce();
        let serialized = data.map(|value| value.to_string());
        let (fields, key) = crypto::encrypt_optional_request_method_profile(
            method.as_str(),
            path,
            serialized.as_deref(),
            &self.credentials.security,
            &nonce,
            self.credentials.service_id == "mijia",
        )?;
        let cookie = format!("userId={}; cUserId={}; serviceToken={}; yetAnotherServiceToken={}; locale=zh_CN; timezone=GMT%2B08%3A00; is_daylight=0; dst_offset=0; channel=MI_APP_STORE; deviceId={}", self.credentials.user_id,self.credentials.c_user_id, self.credentials.service_token, self.credentials.service_token, self.credentials.device_id);
        let request = self
            .client
            .request(
                method.clone(),
                format!("https://{host}{}{path}", if camera { "" } else { "/app" }),
            )
            .header("MIOT-ENCRYPT-ALGORITHM", "ENCRYPT-RC4")
            .header("x-xiaomi-protocal-flag-cli", "PROTOCAL-HTTP2")
            .header("Accept-Encoding", "identity")
            .header(reqwest::header::COOKIE, cookie);
        let request = if let Some(model) = model {
            request.header("MIOT-REQUEST-MODEL", model)
        } else {
            request
        };
        let request = if method == Method::GET {
            request.query(&fields)
        } else {
            request.form(&fields)
        };
        let response = request.send().await.map_err(AppError::network)?;
        let status = response.status();
        if !status.is_success() {
            return Err(cloud_http_error(response).await);
        }
        let gzip = response
            .headers()
            .get("MIOT-CONTENT-ENCODING")
            .and_then(|v| v.to_str().ok())
            == Some("GZIP");
        let text = response.text().await.map_err(AppError::network)?;
        // Service errors can arrive unencrypted even when RC4 was requested.
        let body: Value = if text.trim_start().starts_with('{') {
            serde_json::from_str(&text).map_err(|_| AppError::protocol())?
        } else {
            let decrypted = crypto::decrypt_response(&key, &text)?;
            let bytes = if gzip {
                let mut bytes = Vec::new();
                flate2::read::GzDecoder::new(decrypted.as_slice())
                    .take(16_000_001)
                    .read_to_end(&mut bytes)
                    .map_err(|_| AppError::protocol())?;
                if bytes.len() > 16_000_000 {
                    return Err(AppError::protocol());
                }
                bytes
            } else {
                decrypted
            };
            serde_json::from_slice(&bytes).map_err(|_| AppError::protocol())?
        };
        if camera {
            let code = body
                .get("code")
                .and_then(|v| {
                    v.as_str()
                        .map(str::to_owned)
                        .or_else(|| v.as_i64().map(|n| n.to_string()))
                })
                .ok_or_else(AppError::protocol)?;
            if code == "0" || code == "00" {
                return body.get("data").cloned().ok_or_else(AppError::protocol);
            }
            return Err(AppError::new(
                "cameraEvents",
                format!(
                    "看家助手读取失败（代码 {code}，{}）。",
                    body.get("message")
                        .or_else(|| body.get("msg"))
                        .or_else(|| body.get("description"))
                        .and_then(Value::as_str)
                        .unwrap_or("云端拒绝请求")
                        .chars()
                        .take(160)
                        .collect::<String>()
                ),
                true,
            ));
        }
        let code = response_code(path, &body)?;
        // Router gateway returns the raw vendor object, not {code,result}.
        // The admin list uses a string "0". Keep both exceptions on these
        // verified gateway paths; a router error code is not account expiry.
        if crate::router::is_gateway_path(path) {
            return if code == 0 || (path == crate::router_scene::PATH && code == 3012) {
                Ok(body)
            } else {
                Err(AppError::new(
                    "routerGateway",
                    format!("路由器请求失败（代码 {code}）。"),
                    false,
                ))
            };
        }
        match code {
            0 => body.get("result").cloned().ok_or_else(|| {
                if path == "/appgateway/gspec/Gspec/spec_multi_language" {
                    AppError::new(
                        "uiResourceProtocol",
                        "多语言元数据成功响应没有result。",
                        true,
                    )
                } else {
                    AppError::protocol()
                }
            }),
            3 => Err(AppError::auth()),
            _ => Err(AppError::new(
                "cloud",
                format!("小米云请求失败（代码 {code}）。"),
                false,
            )),
        }
    }

    /// APK SDK getDeviceData -> standardCall -> POST, default namespace host.
    /// Caller selects keys from the verified device adapter, never from UI input.
    pub async fn history_page(
        &self,
        device: &Device,
        owner_id: &str,
        key: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        // Native month queries include the current month's future last day.
        // Public IPC accepts a validated calendar selection, never these bounds.
        if start >= end || end > crate::models::epoch_secs().saturating_add(32 * 86400 + 1800) {
            return Err(AppError::invalid("历史记录时间范围无效。"));
        }
        let result = self
            .request_method(
                Method::POST,
                "/user/get_user_device_data",
                json!({
                    "did":device.control_did(),"uid":owner_id,"key":key,"type":"prop",
                    "time_start":start,"time_end":end,"limit":1000
                }),
                Some(&device.model),
            )
            .await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }

    pub(crate) async fn device_event_rows(
        &self,
        device: &Device,
        owner: &str,
        key: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if start > end
            || end > crate::models::epoch_secs()
            || end - start > 90000
            || key.len() > 24
            || key.split('.').count() != 2
            || !key
                .split('.')
                .all(|n| n.parse::<u32>().is_ok_and(|i| i > 0))
        {
            return Err(AppError::invalid("设备事件查询范围无效。"));
        }
        let result=self.request_method(Method::POST,"/user/get_user_device_data",json!({"did":device.control_did(),"uid":owner,"key":key,"type":"event","time_start":start,"time_end":end,"limit":1000}),Some(&device.model)).await?;
        result
            .as_array()
            .filter(|r| r.len() <= 1000)
            .cloned()
            .ok_or_else(AppError::protocol)
    }

    /// Standard plugin 14846 -> SDK 10065/10008 -> native POST/RC4.
    /// Internal callers bind the key to the authorized device's actual MIoT spec.
    pub async fn statistics(
        &self,
        device: &Device,
        key: &str,
        kind: &str,
        start: u64,
        end: u64,
        limit: u32,
    ) -> Result<Vec<Value>> {
        if !matches!(kind, "stat_day_v3" | "stat_month_v3" | "stat_hour_v3")
            || start >= end
            || end > crate::models::epoch_secs().saturating_add(86400)
            || !(1..=366).contains(&limit)
        {
            return Err(AppError::invalid("统计查询范围无效。"));
        }
        let result = self
            .request_method(
                Method::POST,
                "/v2/user/statistics",
                json!({
                    "did":device.control_did(),"data_type":kind,"key":key,
                    "time_start":start,"time_end":end,"limit":limit,"startTime":start,"endTime":end
                }),
                Some(&device.model),
            )
            .await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }

    /// Original speaker plugin 10043: shared-device read transport. No ubus
    /// method, path or device identifier is accepted from the frontend.
    pub async fn speaker_player_status(&self, device: &Device) -> Result<Value> {
        if !crate::speaker::supported(device) {
            return Err(AppError::invalid("此型号尚未接入歌曲信息协议。"));
        }
        self.request_method(
            Method::POST,
            "/v2/remote/ubus",
            json!({
                "did":device.control_did(), "path":"mediaplayer",
                "method":"player_get_play_status", "message":{}
            }),
            Some(&device.model),
        )
        .await
    }

    pub async fn change_speaker(
        &self,
        device: &Device,
        change: &crate::speaker::Change,
    ) -> Result<()> {
        if !crate::speaker::supported(device) {
            return Err(AppError::invalid("此音箱未接入播放器控制协议。"));
        }
        let (method, message) = crate::speaker::command(change)?;
        let reply = self.request_method(Method::POST, "/v2/remote/ubus", json!({
            "did":device.control_did(),"path":"mediaplayer","method":method,"message":message
        }), Some(&device.model)).await?;
        crate::speaker::accepted(&reply)
    }

    /// Standard plugin 14846: mcn02 has no energy-counter property; its
    /// verified legacy adapter queries powerCost in Wh using date strings.
    pub async fn acpartner_statistics(
        &self,
        device: &Device,
        monthly: bool,
        start: u64,
        end: u64,
        limit: u32,
    ) -> Result<Vec<Value>> {
        use chrono::{Local, TimeZone};
        if device.model != "lumi.acpartner.mcn02"
            || device.split_route.is_some()
            || start >= end
            || end > crate::models::epoch_secs().saturating_add(2 * 86400)
            || !(1..=366).contains(&limit)
        {
            return Err(AppError::invalid("统计查询范围无效。"));
        }
        let date = |time| {
            Local
                .timestamp_opt(time as i64, 0)
                .single()
                .map(|d| d.format("%Y/%m/%d").to_string())
                .ok_or_else(AppError::protocol)
        };
        let result=self.request_method(Method::POST,"/v2/user/statistics",json!({
            "did":device.control_did(),"data_type":if monthly {"stat_month"} else {"stat_day"},
            "key":"powerCost","start_date":date(start)?,"end_date":date(end)?,
            "limit":limit,"startTime":start,"endTime":end
        }),Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }

    /// lx32 vendor v39: event 8.1 and event-derived prop.8.2 aggregates.
    /// These are closed exact-model read contracts, not arbitrary IPC queries.
    pub async fn purifier_records(
        &self,
        device: &Device,
        owner: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if device.model != crate::purifier::MODEL
            || device.split_route.is_some()
            || start >= end
            || end > crate::models::epoch_secs().saturating_add(86400)
            || end - start > 367 * 86400
        {
            return Err(AppError::invalid("净水器记录查询范围无效。"));
        }
        let result=self.request_method(Method::POST,"/user/get_user_device_data",json!({"did":device.control_did(),"uid":owner,"key":"8.1","type":"event","time_start":start,"time_end":end,"limit":1000}),Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }
    pub async fn purifier_statistics(
        &self,
        device: &Device,
        kind: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if device.model != crate::purifier::MODEL
            || device.split_route.is_some()
            || !matches!(kind, "stat_day_v3" | "stat_week_v3" | "stat_month_v3")
            || start >= end
            || end > crate::models::epoch_secs().saturating_add(367 * 86400)
            || end - start > 367 * 86400
        {
            return Err(AppError::invalid("净水器统计查询范围无效。"));
        }
        let result=self.request_method(Method::POST,"/v2/user/statistics",json!({"did":device.control_did(),"data_type":kind,"key":"prop.8.2","time_start":start,"time_end":end,"limit":100}),Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }
    /// gxj v29 11759: SDK getDeviceData, event6.1; no caller-selected key.
    pub async fn dispenser_records(
        &self,
        device: &Device,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if device.model != crate::dispenser::MODEL
            || device.split_route.is_some()
            || start >= end
            || end > crate::models::epoch_secs()
            || end - start > 367 * 86400
        {
            return Err(AppError::invalid("饮水记录查询范围无效。"));
        }
        let result=self.request_method(Method::POST,"/user/get_user_device_data",json!({"did":device.control_did(),"key":"6.1","type":"event","time_start":start,"time_end":end,"limit":1000}),Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }
    /// gxj v29 module 11759: read self-check event 7.1 only.
    pub async fn dispenser_selfcheck_records(
        &self,
        device: &Device,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if device.model != crate::dispenser::MODEL
            || device.split_route.is_some()
            || start >= end
            || end > crate::models::epoch_secs()
            || end - start > 367 * 86400
        {
            return Err(AppError::invalid("自检记录查询范围无效。"));
        }
        let result = self.request_method(Method::POST, "/user/get_user_device_data",
            json!({"did":device.control_did(),"key":"7.1","type":"event","time_start":start,"time_end":end,"limit":1000}),
            Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }
    /// gxj v29 11618: getUserStatistics, event-derived prop.6.2.
    pub async fn dispenser_statistics(
        &self,
        device: &Device,
        kind: &str,
        start: u64,
        end: u64,
    ) -> Result<Vec<Value>> {
        if device.model != crate::dispenser::MODEL
            || device.split_route.is_some()
            || !matches!(kind, "stat_day_v3" | "stat_month_v3")
            || start >= end
            || end > crate::models::epoch_secs().saturating_add(367 * 86400)
            || end - start > 367 * 86400
        {
            return Err(AppError::invalid("饮水统计查询范围无效。"));
        }
        let result=self.request_method(Method::POST,"/v2/user/statistics",json!({"did":device.control_did(),"key":"prop.6.2","data_type":kind,"time_start":start,"time_end":end,"limit":100}),Some(&device.model)).await?;
        result.as_array().cloned().ok_or_else(AppError::protocol)
    }
    /// Purifier v39 Appointment: loadTimerScenes with identify=timer.
    pub async fn purifier_dnd_scenes(&self, device: &Device) -> Result<Value> {
        if device.model != crate::purifier::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的勿扰定时绑定未确认。"));
        }
        self.request_method(Method::POST,"/scene/list",json!({"did":device.control_did(),"identify":"timer","type":0,"st_id":8,"support_second":true}),Some(&device.model)).await
    }
    /// gxj appointment10853 calls SDK loadTimerScenes(did) without identify.
    /// Retain all scenes so conflicting 5/1 effects cannot be silently ignored.
    pub async fn dispenser_dnd_scenes(&self, device: &Device) -> Result<Value> {
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此管线机的勿扰定时绑定尚未确认。"));
        }
        self.request_method(
            Method::POST,
            "/scene/list",
            json!({"did":device.control_did(),"st_id":8,"type":0}),
            Some(&device.model),
        )
        .await
    }
    /// SDK10065 and vendor10973; scoped to lx32's published push setting.
    pub async fn purifier_push_setting(&self, device: &Device) -> Result<Value> {
        if device.model != crate::purifier::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的冲洗提醒绑定未确认。"));
        }
        self.request_method(
            Method::POST,
            "/v2/device/getsettingv2",
            serde_json::json!({"did":device.control_did(),"prefix_filter":"push_enable"}),
            Some(&device.model),
        )
        .await
    }
    pub(crate) async fn change_purifier_push(
        &self,
        device: &Device,
        enabled: bool,
    ) -> Result<Value> {
        if device.model != crate::purifier::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的冲洗提醒绑定未确认。"));
        }
        self.request_method(Method::POST,"/device/setsetting",serde_json::json!({"did":device.control_did(),"settings":{"push_enable_27067":if enabled {"1"} else {"0"}}}),Some(&device.model)).await
    }
    /// gxj10700, same SDK setting endpoints, two closed notification keys.
    pub async fn dispenser_push_setting(&self, device: &Device) -> Result<Value> {
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的提醒绑定尚未确认。"));
        }
        self.request_method(
            Method::POST,
            "/v2/device/getsettingv2",
            json!({"did":device.control_did(),"prefix_filter":"push_enable"}),
            Some(&device.model),
        )
        .await
    }
    pub(crate) async fn change_dispenser_push(
        &self,
        device: &Device,
        field: crate::dispenser_reminders::PushField,
        enabled: bool,
    ) -> Result<Value> {
        if device.model != crate::dispenser::MODEL || device.split_route.is_some() {
            return Err(AppError::invalid("此设备的提醒绑定尚未确认。"));
        }
        self.request_method(
            Method::POST,
            "/device/setsetting",
            json!({"did":device.control_did(),"settings":{field.key():if enabled{"1"}else{"0"}}}),
            Some(&device.model),
        )
        .await
    }
    /// APK countdown dispatcher 14891. Read-only timer inventory for this device.
    pub async fn timer_scenes(&self, device: &Device) -> Result<Value> {
        self.request_method(Method::POST,"/scene/list",json!({"did":device.control_did(),"identify":"","type":0,"st_id":8,"support_second":true}),Some(&device.model)).await
    }
    /// SDK10032 scene.save and native XmPluginHostApi.delScenes contracts.
    pub(crate) async fn change_timer_scene(
        &self,
        device: &Device,
        delete: bool,
        body: Value,
    ) -> Result<Value> {
        self.request_method(
            Method::POST,
            if delete {
                "/scene/delete"
            } else {
                "/scene/edit"
            },
            body,
            Some(&device.model),
        )
        .await
    }
    /// APK cloudVariable 10058 uses exact keys derived from the bound property.
    pub async fn timer_preferences(&self, device: &Device, siid: u32, piid: u32) -> Result<Value> {
        let props: Vec<_> = ["onHour", "onMinute", "offHour", "offMinute"]
            .iter()
            .map(|suffix| format!("prop.s_{siid}.{piid}.{suffix}"))
            .collect();
        self.request_method(
            Method::POST,
            "/device/batchdevicedatas",
            json!([{"did":device.control_did(),"props":props}]),
            Some(&device.model),
        )
        .await
    }

    /// SDK10065 batchSetDeviceDatas -> standardCall; payloads are assembled
    /// only by the validated, device-bound countdown adapter.
    pub(crate) async fn set_timer_preferences(
        &self,
        device: &Device,
        body: Value,
    ) -> Result<Value> {
        self.request_method(
            Method::POST,
            "/v2/device/batch_set_props",
            body,
            Some(&device.model),
        )
        .await
    }

    pub async fn homes(&self) -> Result<Vec<Home>> {
        let mut result = if self.credentials.service_id == "mijia" {
            self.request("/v2/homeroom/gethome_merged",json!({"fg":true,"fetch_share":true,"fetch_share_dev":true,"limit":300,"app_ver":12,"fetch_cariot":true,"plat_form":0})).await?
        } else {
            self.request("/v2/homeroom/gethome", json!({"fg":true,"fetch_share":true,"fetch_share_dev":true,"limit":300,"app_ver":7})).await?
        };
        let mut seen = HashSet::new();
        for _ in 0..100 {
            if result["has_more"].as_bool() != Some(true) {
                return parse_homes(&result, &self.credentials.user_id);
            }
            let cursor = id(&result["max_id"]);
            if cursor.is_empty() || !seen.insert(cursor.clone()) {
                return Err(AppError::new(
                    "pagination",
                    "家庭房间分页未继续，无法保证数据完整。",
                    true,
                ));
            }
            let page = self
                .request(
                    "/v2/homeroom/get_dev_room_page",
                    json!({"start_id":cursor,"limit":300}),
                )
                .await?;
            merge_home_page(&mut result, &page)?;
        }
        Err(AppError::new(
            "pagination",
            "家庭房间列表超过分页限制。",
            false,
        ))
    }

    pub async fn home_order(&self, home: &Home, devices: &[Device]) -> Result<HomeOrder> {
        if self.credentials.service_id != "mijia" {
            return Err(AppError::new(
                "unsupported",
                "当前地区暂无法同步米家排列顺序。",
                false,
            ));
        }
        let result = self
            .request_get(
                "/v2/home/get_union_order",
                crate::order::request_data(home)?,
            )
            .await?;
        crate::order::parse_order(
            &result,
            home,
            &devices.iter().map(|d| d.did.as_str()).collect(),
        )
    }

    pub async fn devices(&self, home: &Home) -> Result<Vec<Device>> {
        let mut devices = Vec::new();
        let mut seen = HashSet::new();
        let mut cursor = String::new();
        let mut visibility = HomeVisibility::default();
        for _ in 0..100 {
            let mut data = json!({"home_owner":home.owner_id.parse::<u64>().map_err(|_| AppError::protocol())?, "home_id":home.id.parse::<u64>().map_err(|_| AppError::protocol())?, "limit":300, "get_split_device":true,"support_smart_home":true});
            if self.credentials.service_id == "mijia" {
                data["limit"] = json!(200);
                data["get_cariot_device"] = json!(true);
                data["get_third_device"] = json!(true);
            }
            if !cursor.is_empty() {
                data["start_did"] = json!(cursor);
            }
            let result = self.request("/v2/home/home_device_list", data).await?;
            let list = result["device_info"]
                .as_array()
                .ok_or_else(AppError::protocol)?;
            let mut room_by_did = std::collections::HashMap::new();
            // Room assignment belongs to this page's home_info, not necessarily device_info.
            for room in result["home_info"]["roomlist"]
                .as_array()
                .map(Vec::as_slice)
                .unwrap_or(&[])
            {
                let room_id = id(&room["id"]);
                for did in room["dids"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
                    room_by_did.insert(id(did), room_id.clone());
                }
            }
            for raw in list {
                visibility.observe(raw);
                let mut device = parse_device(raw, home)?;
                if let Some(room_id) = room_by_did.get(&device.did) {
                    device.room_id = room_id.clone();
                    device.room_name = home
                        .rooms
                        .iter()
                        .find(|r| &r.id == room_id)
                        .map(|r| r.name.clone())
                        .unwrap_or_else(|| "未分配房间".into());
                }
                if seen.insert(device.did.clone()) {
                    devices.push(device);
                }
            }
            if !result["has_more"].as_bool().unwrap_or(false) {
                self.attach_artwork(&mut devices).await?;
                assign_control_groups(&mut devices);
                for device in &mut devices {
                    let grouped = visibility.hides(&device.did);
                    device.hidden_on_home |= grouped;
                    if grouped {
                        device.split_display_available = false;
                    }
                }
                return Ok(devices);
            }
            let next = id(&result["max_did"]);
            if next.is_empty() || next == cursor {
                return Err(AppError::new(
                    "pagination",
                    "设备列表分页未继续，无法保证设备完整，请重试。",
                    true,
                ));
            }
            cursor = next;
        }
        Err(AppError::new(
            "pagination",
            "设备列表超过当前分页限制，无法保证完整性。",
            false,
        ))
    }

    async fn attach_artwork(&self, devices: &mut [Device]) -> Result<()> {
        let now = crate::models::epoch_secs();
        let cache = self.artwork.lock().await;
        let models: Vec<_> = devices
            .iter()
            .filter(|d| !d.model.is_empty())
            .filter(|d| {
                !cache
                    .get(&d.model)
                    .is_some_and(|(expires, _)| *expires > now)
            })
            .map(|d| d.model.clone())
            .collect::<HashSet<_>>()
            .into_iter()
            .collect();
        drop(cache);
        for batch in models.chunks(100) {
            // APK MiuiDeviceCacheManager.requestDeviceIcon; these are current
            // API-provided URLs. Never persist or log their signatures.
            let response = tokio::time::timeout(
                Duration::from_secs(8),
                self.request(
                    "/v2/productconfig/single_pull",
                    json!({"models":batch,"keys":["model","name","icon_real"]}),
                ),
            )
            .await;
            // Optional artwork must not hold the device list behind the full
            // cloud timeout. Briefly cache misses to avoid repeated retries.
            let mut cache = self.artwork.lock().await;
            for model in batch {
                cache.insert(model.clone(), (now + 60, None));
            }
            drop(cache);
            match response {
                Ok(Ok(rows)) => {
                    let Some(rows) = rows.as_array() else {
                        continue;
                    };
                    let mut cache = self.artwork.lock().await;
                    for row in rows {
                        if let Some(model) = row["model"]
                            .as_str()
                            .filter(|m| batch.iter().any(|item| item == m))
                        {
                            cache.insert(
                                model.into(),
                                (now + 300, row["icon_real"].as_str().and_then(artwork_url)),
                            );
                        }
                    }
                }
                Ok(Err(error)) if error.kind == "authExpired" => return Err(error),
                _ => {} // Artwork failure does not hide accessible devices.
            }
        }
        let cache = self.artwork.lock().await;
        apply_product_artwork(devices, &cache, now);
        Ok(())
    }

    pub async fn read(&self, params: Vec<Value>) -> Result<Vec<Value>> {
        self.read_source(params, 2, 90).await
    }
    /// Read the authenticated schema using the verified transport and request
    /// scope. Server admission (90) is not a device firmware guarantee.
    pub async fn read_panel_properties(&self, panel: &DevicePanel) -> Result<Vec<Value>> {
        if panel.model == crate::fryer::MODEL {
            return self
                .read_source(
                    crate::fryer::read_params(panel)?,
                    2,
                    crate::fryer::READ_BATCH_SIZE,
                )
                .await;
        }
        if panel.model == crate::dispenser::MODEL {
            let params = crate::dispenser::read_params(panel)?;
            return self.read_dispenser(panel.control_did(), params).await;
        }
        if let Some(batches) = outlet_read_batches(panel) {
            let mut rows = Vec::new();
            for batch in batches {
                rows.extend(self.read(batch).await?);
            }
            return Ok(rows);
        }
        self.read_source(
            crate::spec::read_params(panel),
            2,
            panel_read_batch_size(&panel.model),
        )
        .await
    }
    pub async fn read_panel_property(
        &self,
        panel: &DevicePanel,
        siid: u32,
        piid: u32,
    ) -> Result<Vec<Value>> {
        if panel.model == crate::dispenser::MODEL {
            let params = crate::dispenser::read_params(panel)?
                .into_iter()
                .filter(|p| p["siid"] == siid && p["piid"] == piid)
                .collect::<Vec<_>>();
            if params.len() != 1 {
                return Err(AppError::invalid("此属性没有已核实的读取绑定。"));
            }
            return self.read_dispenser(panel.control_did(), params).await;
        }
        self.read(vec![
            json!({"did":panel.control_did(),"siid":siid,"piid":piid}),
        ])
        .await
    }
    pub(crate) async fn read_dispenser(&self, did: &str, params: Vec<Value>) -> Result<Vec<Value>> {
        let mut values = Vec::new();
        for batch in params.chunks(crate::dispenser::READ_BATCH_SIZE) {
            let raw = self.device_rpc(did, DeviceRpc::Read, json!(batch)).await?;
            values.extend(crate::dispenser::read_rows(batch, raw)?);
        }
        Ok(values)
    }
    async fn device_rpc(&self, did: &str, method: DeviceRpc, params: Value) -> Result<Value> {
        let path = crate::dispenser::rpc_path(did)?;
        // Opaque request correlation, independent of the encrypted request nonce.
        let correlation = (rand::random::<u32>() & 0x7fff_ffff).max(1);
        self.request(
            &path,
            json!({"id":correlation,"method":method.method(),"params":params}),
        )
        .await
    }
    pub async fn write_panel_property(
        &self,
        panel: &DevicePanel,
        siid: u32,
        piid: u32,
        value: Value,
    ) -> Result<i64> {
        if panel.model == crate::dispenser::MODEL {
            let params = crate::dispenser::property_write(panel, siid, piid, value)?;
            let raw = self
                .device_rpc(panel.control_did(), DeviceRpc::Write, params.clone())
                .await?;
            return crate::dispenser::write_receipt(&params, raw);
        }
        self.write(panel.control_did(), siid, piid, value).await
    }
    pub async fn panel_action(
        &self,
        panel: &DevicePanel,
        siid: u32,
        aiid: u32,
        inputs: Vec<Value>,
    ) -> Result<Value> {
        if panel.model == crate::dispenser::MODEL {
            let params = crate::dispenser::action_params(panel, siid, aiid, inputs)?;
            let raw = self
                .device_rpc(panel.control_did(), DeviceRpc::Action, params.clone())
                .await?;
            return crate::dispenser::action_receipt(&params, raw);
        }
        self.action(panel.control_did(), siid, aiid, inputs).await
    }
    /// Cache-only records are display metadata, never a direct device readback.
    pub async fn read_cached(&self, params: Vec<Value>) -> Result<Vec<Value>> {
        self.read_source(params, 3, 90).await
    }
    async fn read_source(
        &self,
        params: Vec<Value>,
        datasource: u8,
        batch_size: usize,
    ) -> Result<Vec<Value>> {
        let mut values = Vec::new();
        // APK ho4 explicitly admits at most 90 properties per request.
        for batch in params.chunks(batch_size) {
            let result = self
                .request(
                    "/miotspec/prop/get",
                    json!({"params":batch,"datasource":datasource}),
                )
                .await?;
            values.extend(
                result
                    .as_array()
                    .ok_or_else(AppError::protocol)?
                    .iter()
                    .cloned(),
            );
        }
        Ok(values)
    }
    pub(crate) async fn write_airer_night(
        &self,
        device: &Device,
        params: Vec<Value>,
    ) -> Result<()> {
        let ids = [5, 1, 2, 3, 4, 6];
        if device.model != crate::airer::MODEL
            || device.split_route.is_some()
            || params.len() != ids.len()
            || params.iter().zip(ids).any(|(p, id)| {
                crate::models::id(&p["did"]) != device.control_did()
                    || p["siid"] != 4
                    || p["piid"] != id
            })
        {
            return Err(AppError::invalid("夜灯设置绑定无效。"));
        }
        let raw = self
            .request("/miotspec/prop/set", json!({"params":params}))
            .await?;
        let rows = raw.as_array().ok_or_else(AppError::protocol)?;
        if ids.into_iter().all(|id| {
            rows.iter().any(|p| {
                crate::models::id(&p["did"]) == device.control_did()
                    && p["siid"] == 4
                    && p["piid"] == id
                    && p["code"].as_i64().is_some_and(|c| c == 0 || c == 1)
            })
        }) {
            Ok(())
        } else {
            Err(AppError::new(
                "partialWrite",
                "部分夜灯属性未被设备接受，请重新读取。",
                true,
            ))
        }
    }
    pub async fn write(&self, did: &str, siid: u32, piid: u32, value: Value) -> Result<i64> {
        let result = self
            .request(
                "/miotspec/prop/set",
                json!({"params":[{"did":did,"siid":siid,"piid":piid,"value":value}]}),
            )
            .await?;
        let row = result
            .as_array()
            .and_then(|r| {
                r.iter()
                    .find(|v| id(&v["did"]) == did && v["siid"] == siid && v["piid"] == piid)
            })
            .ok_or_else(AppError::protocol)?;
        let code = row["code"].as_i64().ok_or_else(AppError::protocol)?;
        if code == 0 || code == 1 {
            Ok(code)
        } else {
            Err(AppError::device(code))
        }
    }
    pub async fn action(
        &self,
        did: &str,
        siid: u32,
        aiid: u32,
        inputs: Vec<Value>,
    ) -> Result<Value> {
        let result = self
            .request(
                "/miotspec/action",
                json!({"params":{"did":did,"siid":siid,"aiid":aiid,"in":inputs}}),
            )
            .await?;
        let code = result["code"].as_i64().ok_or_else(AppError::protocol)?;
        if code == 0 || code == 1 {
            Ok(result)
        } else {
            Err(AppError::device(code))
        }
    }
}

const CLOUD_ERROR_BODY_LIMIT: usize = 4096;

async fn cloud_http_error(mut response: reqwest::Response) -> AppError {
    let status = response.status().as_u16();
    // A live CN response uses 426/code=0 for expired service tokens. Only this
    // status needs a small plaintext error body; never expose the body or retry
    // a request here (it may have been a mutation).
    let mut body = Vec::new();
    if status == 426 {
        loop {
            match response.chunk().await {
                Ok(Some(chunk)) if body.len() + chunk.len() <= CLOUD_ERROR_BODY_LIMIT => {
                    body.extend_from_slice(&chunk);
                }
                Ok(None) => break,
                _ => return classify_cloud_http_error(status, &[]),
            }
        }
    }
    classify_cloud_http_error(status, &body)
}

fn classify_cloud_http_error(status: u16, body: &[u8]) -> AppError {
    if status == 401 {
        return AppError::auth();
    }
    if status == 403 {
        return AppError::new(
            "permissionDenied",
            "小米服务拒绝访问，请检查账号权限或稍后重新登录。",
            false,
        );
    }
    if status == 426 && body.len() <= CLOUD_ERROR_BODY_LIMIT {
        if let Ok(error) = serde_json::from_slice::<Value>(body) {
            if error["code"].as_i64() == Some(0)
                && error["message"].as_str() == Some("SERVICETOKEN_EXPIRED")
            {
                return AppError::auth();
            }
        }
    }
    AppError::new(
        "cloud",
        format!("小米服务暂时不可用（HTTP {status}）。"),
        true,
    )
}

fn response_code(path: &str, body: &Value) -> Result<i64> {
    if crate::router::is_gateway_path(path) {
        return body["code"]
            .as_i64()
            .or_else(|| body["code"].as_str()?.parse().ok())
            .ok_or_else(AppError::protocol);
    }
    // SpecCacheSource uses JSONObject.optInt("code", 0). The live language
    // endpoint returns {message,result} without code; keep this exception local.
    if path == "/appgateway/gspec/Gspec/spec_multi_language" {
        return match body.get("code") {
            Some(value) => value
                .as_i64()
                .or_else(|| value.as_str()?.parse().ok())
                .ok_or_else(AppError::protocol),
            None if body["result"].is_object() => Ok(0),
            _ => Err(AppError::protocol()),
        };
    }
    body["code"].as_i64().ok_or_else(AppError::protocol)
}
/// APK get_dev_room_page adds device IDs to already inventoried home/room objects.
fn merge_home_page(result: &mut Value, page: &Value) -> Result<()> {
    let info = page["info"].as_array().ok_or_else(AppError::protocol)?;
    let homes = result["homelist"]
        .as_array_mut()
        .ok_or_else(AppError::protocol)?;
    for h in info {
        let home_id = id(&h["id"]);
        let home = homes
            .iter_mut()
            .find(|v| id(&v["id"]) == home_id)
            .ok_or_else(AppError::protocol)?;
        append_dids(home, h)?;
        for room in h["roomlist"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
            let room_id = id(&room["id"]);
            let rooms = home["roomlist"]
                .as_array_mut()
                .ok_or_else(AppError::protocol)?;
            let target = rooms
                .iter_mut()
                .find(|r| id(&r["id"]) == room_id)
                .ok_or_else(AppError::protocol)?;
            append_dids(target, room)?;
        }
    }
    result["has_more"] = page.get("has_more").cloned().unwrap_or(Value::Bool(false));
    result["max_id"] = page.get("max_id").cloned().unwrap_or(Value::Null);
    Ok(())
}
fn append_dids(target: &mut Value, source: &Value) -> Result<()> {
    let Some(additions) = source["dids"].as_array() else {
        return Ok(());
    };
    if target.get("dids").is_none() {
        target["dids"] = json!([]);
    }
    let list = target["dids"]
        .as_array_mut()
        .ok_or_else(AppError::protocol)?;
    let mut seen: HashSet<_> = list.iter().map(id).collect();
    for item in additions {
        if seen.insert(id(item)) {
            list.push(item.clone());
        }
    }
    Ok(())
}

pub fn parse_homes(result: &Value, user_id: &str) -> Result<Vec<Home>> {
    let mut homes = Vec::new();
    let mut seen = HashSet::new();
    let list = result["homelist"]
        .as_array()
        .ok_or_else(AppError::protocol)?;
    let shared = result["share_home_list"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[]);
    for h in list.iter().chain(shared) {
        let home_id = id(&h["id"]);
        let owner = id(&h["uid"]);
        if home_id.is_empty() || owner.is_empty() {
            return Err(AppError::protocol());
        }
        if !seen.insert(home_id.clone()) {
            continue;
        }
        let mut room_devices = std::collections::HashMap::new();
        for room in h["roomlist"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
            let room_id = id(&room["id"]);
            for did in room["dids"].as_array().map(Vec::as_slice).unwrap_or(&[]) {
                room_devices.insert(id(did), room_id.clone());
            }
        }
        let rooms = h["roomlist"]
            .as_array()
            .map(|r| {
                r.iter()
                    .map(|r| Room {
                        id: id(&r["id"]),
                        name: r["name"].as_str().unwrap_or("未命名房间").into(),
                    })
                    .collect()
            })
            .unwrap_or_default();
        homes.push(Home {
            id: home_id,
            name: h["name"].as_str().unwrap_or("未命名家庭").into(),
            owner_id: owner.clone(),
            rooms,
            shared: owner != user_id,
            room_devices,
        });
    }
    Ok(homes)
}

/// Core relay reads are independent of optional metering/settings. In the real
/// xiaomi.plug.04, 35 together fail power (-704083036), while one succeeds.
/// Use descriptor IDs and the physical route for every standard outlet family.
fn outlet_read_batches(panel: &DevicePanel) -> Option<Vec<Vec<Value>>> {
    if crate::capabilities::resolve_device_capabilities(panel)
        .category
        .as_deref()
        != Some("outlet")
    {
        return None;
    }
    let power: HashSet<_> = panel
        .services
        .iter()
        .filter(|s| ["switch", "outlet"].contains(&s.name.as_str()))
        .flat_map(|s| &s.properties)
        .filter(|p| p.name == "on" && p.format == "bool" && p.access.iter().any(|a| a == "read"))
        .map(|p| (p.siid, p.piid))
        .collect();
    let mut batches = Vec::new();
    let mut remaining = Vec::new();
    for p in crate::spec::read_params(panel) {
        if power.contains(&(p["siid"].as_u64()? as u32, p["piid"].as_u64()? as u32)) {
            batches.push(vec![p]);
        } else {
            remaining.push(p);
        }
    }
    batches.extend(remaining.chunks(8).map(<[Value]>::to_vec));
    Some(batches)
}

fn panel_read_batch_size(model: &str) -> usize {
    // Real datasource=2 comparisons: 30/39 fail, partitions of ten return all
    // 30 washer properties and the four auxiliary controls. This is a verified
    // working size for this exact model, not a claimed universal MIoT limit.
    // lx32: an independent 31-property read failed 27; ten-item partitions
    // returned 30/31 live (only the serial number still failed).
    if model == crate::washer::MODEL || model == crate::purifier::MODEL {
        10
    } else if model == crate::airer::MODEL {
        // Exact hyd.1s comparison: 23 at once left only four information
        // fields readable; 15-item partitions returned 22/23 current values.
        15
    } else if model == "cuco.plug.v3" {
        // 33-property real read returned -704220043 for power. Partitions of
        // eight and four both returned 32/33 live, including the power switch.
        8
    } else if model == "xiaomi.curtain.acn009" {
        // Original plugin reads eight curtain fields together. A full panel
        // returned -704083036 for every field; independent reads succeeded.
        8
    } else {
        90
    }
}

fn android_plugin_version(raw: &Value) -> Option<String> {
    // SDK10923 only appends MCU when a nonempty firmware string exists.
    let version = |value: &Value| {
        value
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 64)
            .map(str::to_owned)
    };
    if let Some(fw) = version(&raw["extra"]["fw_version"]) {
        return Some(
            version(&raw["extra"]["mcu_version"]).map_or(fw.clone(), |mcu| format!("{fw}.{mcu}")),
        );
    }
    version(&raw["version"])
}
fn parse_device(raw: &Value, home: &Home) -> Result<Device> {
    let did = id(&raw["did"]);
    if did.is_empty() {
        return Err(AppError::protocol());
    }
    let room_id = home
        .room_devices
        .get(&did)
        .cloned()
        .unwrap_or_else(|| id(&raw["room_id"]));
    let room_name = home
        .rooms
        .iter()
        .find(|r| r.id == room_id)
        .map(|r| r.name.clone())
        .unwrap_or_else(|| "未分配房间".into());
    let model = raw["model"].as_str().unwrap_or("").to_owned();
    let (split_route, split_error) = parse_split_route(raw);
    let unsupported_reason = if model.is_empty() {
        Some("设备未提供型号，无法匹配 MIoT 描述。".into())
    } else {
        split_error
    };
    let group_members = parse_group_members(raw, &did);
    Ok(Device {
        did,
        name: raw["name"].as_str().unwrap_or("未命名设备").into(),
        model,
        partner_id: raw["partner_id"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 256 && !id.chars().any(char::is_control))
            .map(str::to_owned),
        plugin_version: android_plugin_version(raw),
        firmware_version: raw["extra"]["fw_version"]
            .as_str()
            .filter(|v| !v.is_empty() && v.len() <= 64)
            .map(str::to_owned),
        online: raw["isOnline"]
            .as_bool()
            .or_else(|| raw["isOnline"].as_u64().map(|v| v != 0))
            .unwrap_or(false),
        hidden_on_home: device_hidden_on_home(raw),
        split_display_available: split_route.is_some() && split_hidden_by_parent(raw),
        // APK Device.isSharedReadOnly: permission bit 32, with an owner. The
        // Device constructor defaults canAuth to true; it is not a list field.
        shared_read_only: raw["permitLevel"].as_u64().unwrap_or(0) & 32 != 0
            && (raw["owner"]["nickname"]
                .as_str()
                .is_some_and(|s| !s.is_empty())
                || !id(&raw["owner"]["userid"]).is_empty()),
        room_id,
        room_name,
        icon: raw["devPicInfo"]
            .as_str()
            .and_then(|text| serde_json::from_str::<Value>(text).ok())
            .and_then(|v| v["logo"].as_str().and_then(artwork_url))
            .or_else(|| raw["icon"].as_str().and_then(artwork_url)),
        product_icon: None,
        spec_type: raw["spec_type"]
            .as_str()
            .filter(|s| !s.is_empty())
            .map(str::to_owned),
        unsupported_reason,
        control_group: None,
        control_group_name: None,
        control_service_id: split_route.as_ref().map(|route| route.service_iid),
        group_members,
        split_route,
    })
}

fn apply_product_artwork(
    devices: &mut [Device],
    cache: &HashMap<String, (u64, Option<String>)>,
    now: u64,
) {
    for device in devices {
        // APK eoc.OooOOOo -> PluginDeviceInfo.OooO -> icon_real. The
        // plugin's default hero is not the customized device-card logo.
        device.product_icon = cache
            .get(&device.model)
            .filter(|(expires, _)| *expires > now)
            .and_then(|(_, url)| url.clone());
        if device.icon.is_none() {
            device.icon = device.product_icon.clone();
        }
    }
}

fn device_flag(raw: &Value, key: &str) -> i64 {
    raw[key]
        .as_i64()
        .or_else(|| raw[key].as_str().and_then(|s| s.parse::<i64>().ok()))
        .unwrap_or(0)
}
fn split_hidden_by_parent(raw: &Value) -> bool {
    device_flag(raw, "hide_mode") == 0 && device_flag(raw, "comFlag") & (4096 | 16) == 16
}
fn device_hidden_on_home(raw: &Value) -> bool {
    // APK hide/solo and bit-16 flags. The requested desktop merged view keeps
    // split parents; the frontend collapses their validated channel cards.
    device_flag(raw, "hide_mode") != 0 || (device_flag(raw, "comFlag") & (4096 | 16)) != 0
}

#[derive(Default)]
struct HomeVisibility {
    groups: HashSet<String>,
    hidden: HashSet<String>,
    kept: HashSet<String>,
}
impl HomeVisibility {
    fn observe(&mut self, raw: &Value) {
        // APK sqb.PostProcess: virtual groups (PID 17), member_ship keys;
        // comFlag bit 32 keeps ordinary members when another group hides them.
        if raw["pid"].as_i64() != Some(17) {
            return;
        }
        let did = id(&raw["did"]);
        if !did.is_empty() {
            self.groups.insert(did);
        }
        let Some(members) = raw["extra"]["member_list"]["member_ship"].as_object() else {
            return;
        };
        let keep = raw["comFlag"].as_i64().unwrap_or(0) & 32 == 32;
        let target = if keep {
            &mut self.kept
        } else {
            &mut self.hidden
        };
        target.extend(members.keys().filter(|id| !id.is_empty()).cloned());
    }
    fn hides(&self, did: &str) -> bool {
        if self.groups.contains(did) {
            self.hidden.contains(did) || self.kept.contains(did)
        } else {
            self.hidden.contains(did) && !self.kept.contains(did)
        }
    }
}

fn parse_group_members(raw: &Value, did: &str) -> Option<Vec<String>> {
    // APK sqb handles virtual PID17 groups independently of a brand/model.
    // This projects exact membership only; it never invents a control protocol.
    if raw["pid"].as_i64() != Some(17) {
        return None;
    }
    let group = &raw["extra"]["member_list"];
    if id(&group["group_did"]) != did {
        return None;
    }
    // APK sqb and the group plugin use member_ship object KEYS as DIDs.
    // Values are membership flags, not model names or relay service IDs.
    let members = group["member_ship"].as_object()?;
    if members
        .keys()
        .any(|member| member.is_empty() || member == did)
    {
        return None;
    }
    let mut members: Vec<_> = members.keys().cloned().collect();
    members.sort();
    Some(members)
}

fn artwork_url(raw: &str) -> Option<String> {
    if raw.is_empty() {
        return None;
    }
    // APK pm4.OooO00o only prefixes relative icon_real. Do not strip signed
    // queries, rewrite hosts, upgrade HTTP, or treat APK fallback names as URLs.
    let absolute = if raw.starts_with('/') {
        format!("https://cdn.fds.api.xiaomi.com{raw}")
    } else {
        raw.to_owned()
    };
    let url = url::Url::parse(&absolute).ok()?;
    if url.scheme() != "https" || !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    Some(absolute)
}

/// Group controls only through authenticated split.parentId links. Public
/// descriptors expose an opaque group key and optional parent display name,
/// while the physical request DID stays in private routing metadata.
fn assign_control_groups(devices: &mut [Device]) {
    let parent_ids: HashSet<_> = devices
        .iter()
        .filter_map(|device| {
            device
                .split_route
                .as_ref()
                .map(|route| route.parent_did.clone())
        })
        .collect();
    let parents: std::collections::HashMap<_, _> = parent_ids
        .into_iter()
        .map(|parent_did| {
            let mut digest = Sha256::new();
            digest.update(b"mijia-desktop-control-group-v1\0");
            digest.update(parent_did.as_bytes());
            let key = format!("{:x}", digest.finalize());
            let name = devices
                .iter()
                .find(|device| device.did == parent_did)
                .map(|device| device.name.clone());
            (parent_did, (key, name))
        })
        .collect();
    for device in devices {
        let group = parents.get(device.control_did());
        device.control_group = group.map(|(key, _)| key.clone());
        device.control_group_name = group.and_then(|(_, name)| name.clone());
        device.control_service_id = device.split_route.as_ref().map(|route| route.service_iid);
    }
}

/// APK c00.Oooo000 uses extra.split.parentId as the physical DID; xa2.invoke
/// compares extra.split.moduleId directly with a SPEC_V2 service IID. A split
/// parent may instead carry only subDids, which does not change its own route.
fn parse_split_route(raw: &Value) -> (Option<SplitRoute>, Option<String>) {
    let split = &raw["extra"]["split"];
    let parent = id(&split["parentId"]);
    let module = id(&split["moduleId"]);
    if parent.is_empty() && module.is_empty() {
        if split.get("parentId").is_some() || split.get("moduleId").is_some() {
            return (
                None,
                Some("拆分设备未提供完整的父设备和服务映射，无法可靠控制。".into()),
            );
        }
        return (None, None);
    }
    let service_iid = module
        .parse::<u32>()
        .ok()
        .filter(|iid| *iid > 0 && iid.to_string() == module);
    match service_iid {
        Some(service_iid) if !parent.is_empty() => (
            Some(SplitRoute {
                parent_did: parent,
                service_iid,
            }),
            None,
        ),
        _ => (
            None,
            Some("拆分设备的父设备或服务映射无效，无法可靠控制。".into()),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn expired_service_token_426_requires_reauthentication_even_with_code_zero() {
        let error =
            classify_cloud_http_error(426, br#"{"code":0,"message":"SERVICETOKEN_EXPIRED"}"#);
        assert_eq!(error.kind, "authExpired");
        assert!(!error.retryable);
        assert!(error.message.contains("重新扫码登录"));
    }

    #[test]
    fn unrelated_or_malformed_426_does_not_expire_the_account() {
        for body in [
            br#"{"code":0,"message":"HTTP2_REQUIRED"}"#.as_slice(),
            br#"{"code":0,"message":"SERVICETOKEN_EXPIRED synthetic-secret"}"#,
            br#"{"code":5,"message":"SERVICETOKEN_EXPIRED"}"#,
            br#"{"message":"SERVICETOKEN_EXPIRED"}"#,
            b"SERVICETOKEN_EXPIRED synthetic-secret",
            b"",
        ] {
            let error = classify_cloud_http_error(426, body);
            assert_eq!(error.kind, "cloud");
            assert!(error.retryable);
            assert!(!error.message.contains("synthetic-secret"));
        }
        let mut oversized = br#"{"code":0,"message":"SERVICETOKEN_EXPIRED"}"#.to_vec();
        oversized.resize(CLOUD_ERROR_BODY_LIMIT + 1, b' ');
        assert_eq!(classify_cloud_http_error(426, &oversized).kind, "cloud");
    }

    #[test]
    fn other_http_errors_keep_the_existing_auth_permission_and_cloud_meanings() {
        let body = br#"{"code":0,"message":"SERVICETOKEN_EXPIRED"}"#;
        assert_eq!(classify_cloud_http_error(401, b"").kind, "authExpired");
        assert_eq!(
            classify_cloud_http_error(403, body).kind,
            "permissionDenied"
        );
        assert_eq!(classify_cloud_http_error(500, body).kind, "cloud");
    }
    #[test]
    fn exact_washer_read_partition_keeps_every_authenticated_property_and_routing_identity() {
        let panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/washer-panel.json")).unwrap();
        let params = crate::spec::read_params(&panel);
        // This sanitized fixture omits the five device-information properties.
        assert_eq!(params.len(), 34);
        let batches = params
            .chunks(panel_read_batch_size(&panel.model))
            .collect::<Vec<_>>();
        assert_eq!(
            batches.iter().map(|b| b.len()).collect::<Vec<_>>(),
            [10, 10, 10, 4]
        );
        assert_eq!(batches.concat(), params);
        assert!(batches
            .iter()
            .flat_map(|batch| batch.iter())
            .all(|p| p["did"] == panel.control_did()));
        assert_eq!(
            params
                .iter()
                .map(|p| (p["siid"].as_u64().unwrap(), p["piid"].as_u64().unwrap()))
                .collect::<HashSet<_>>()
                .len(),
            34
        );
        for model in [
            "midjd8.washer.41",
            "midjd8.washer.42.extra",
            "cuco.plug.v4",
            "",
        ] {
            assert_eq!(panel_read_batch_size(model), 90);
        }
    }
    #[test]
    fn purifier_batching_is_exact_model_and_keeps_all_requests() {
        let panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/purifier-panel.json")).unwrap();
        let params = crate::spec::read_params(&panel);
        assert_eq!(params.len(), 26);
        let batches = params
            .chunks(panel_read_batch_size(&panel.model))
            .collect::<Vec<_>>();
        assert_eq!(
            batches.iter().map(|b| b.len()).collect::<Vec<_>>(),
            [10, 10, 6]
        );
        assert_eq!(batches.concat(), params);
        assert_eq!(panel_read_batch_size("xiaomi.waterpuri.lx33"), 90);
        assert_eq!(panel_read_batch_size("xiaomi.waterpuri.lx32.extra"), 90);
    }
    #[test]
    fn outlet_power_isolated_for_all_pinned_models_and_physical_channels() {
        let fixtures: Value =
            serde_json::from_str(include_str!("fixtures/outlet-power-models.json")).unwrap();
        assert_eq!(fixtures.as_array().unwrap().len(), 183);
        let mut controllable = 0;
        for row in fixtures.as_array().unwrap() {
            let device:Device=serde_json::from_value(json!({"did":"logical","name":"fixture","model":row["model"],"online":true,"roomId":"","roomName":"","icon":null,"specType":row["instance"]["type"],"unsupportedReason":null})).unwrap();
            let mut panel = crate::spec::parse_panel(&device, &row["instance"]).unwrap();
            panel.route_did = Some("physical-fixture".into());
            let batches = outlet_read_batches(&panel).unwrap();
            let mut actual = batches.concat();
            let mut expected = crate::spec::read_params(&panel);
            let key = |p: &Value| (p["siid"].as_u64().unwrap(), p["piid"].as_u64().unwrap());
            actual.sort_by_key(key);
            expected.sort_by_key(key);
            assert_eq!(actual, expected, "{}", panel.model);
            assert!(batches.iter().all(|b| !b.is_empty() && b.len() <= 8));
            assert!(actual.iter().all(|p| p["did"] == "physical-fixture"));
            let mut rw = false;
            for s in panel
                .services
                .iter()
                .filter(|s| ["switch", "outlet"].contains(&s.name.as_str()))
            {
                for p in s.properties.iter().filter(|p| {
                    p.name == "on" && p.format == "bool" && p.access.iter().any(|a| a == "read")
                }) {
                    assert!(batches
                        .iter()
                        .any(|b| b.len() == 1 && b[0]["siid"] == p.siid && b[0]["piid"] == p.piid));
                    if p.access.iter().any(|a| a == "write") {
                        rw = true;
                        for target in [true, false] {
                            crate::spec::validate_value(p, &json!(target)).unwrap();
                        }
                        assert!(crate::capabilities::property_write_allowed(
                            &panel, p.siid, p.piid
                        ));
                    }
                }
            }
            if rw {
                controllable += 1;
            }
        }
        assert_eq!(controllable, 182);
    }
    #[test]
    fn modern_outlet_power_does_not_inherit_optional_field_failures() {
        let mut p: DevicePanel =
            serde_json::from_str(include_str!("fixtures/outlet-xiaomi-04-panel.json")).unwrap();
        let batches = outlet_read_batches(&p).unwrap();
        assert_eq!(batches[0], vec![json!({"did":p.did,"siid":2,"piid":1})]);
        let rows:Vec<_>=batches.concat().iter().map(|r|json!({"did":r["did"],"siid":r["siid"],"piid":r["piid"],"code":if r["siid"]==2&&r["piid"]==1{0}else{-704083036_i64},"value":true})).collect();
        crate::spec::apply_reads(&mut p, &rows);
        let power = p
            .services
            .iter()
            .flat_map(|s| &s.properties)
            .find(|p| p.siid == 2 && p.piid == 1)
            .unwrap();
        assert_eq!(power.code, Some(0));
        assert_eq!(power.value, Some(json!(true)));
        p.spec_type = Some("urn:miot-spec-v2:device:light:0000A001:fixture:1".into());
        assert!(outlet_read_batches(&p).is_none());
    }
    #[test]
    fn outlet_partition_keeps_every_property_and_is_exact_model() {
        let requests: Vec<_> = (1..=33)
            .map(|piid| json!({"did":"fixture","siid":2,"piid":piid}))
            .collect();
        let groups: Vec<_> = requests
            .chunks(panel_read_batch_size("cuco.plug.v3"))
            .collect();
        assert_eq!(
            groups.iter().map(|g| g.len()).collect::<Vec<_>>(),
            [8, 8, 8, 8, 1]
        );
        assert_eq!(groups.concat(), requests);
        assert_eq!(panel_read_batch_size("cuco.plug.v3.extra"), 90);
        assert_eq!(panel_read_batch_size("cuco.plug.v4"), 90);
    }
    #[test]
    fn curtain_partition_is_exact_model_and_keeps_all_requested_properties() {
        let requests: Vec<_> = (1..=18)
            .map(|piid| json!({"did":"fixture","siid":2,"piid":piid}))
            .collect();
        let groups: Vec<_> = requests
            .chunks(panel_read_batch_size("xiaomi.curtain.acn009"))
            .collect();
        assert_eq!(
            groups.iter().map(|g| g.len()).collect::<Vec<_>>(),
            [8, 8, 2]
        );
        assert_eq!(groups.concat(), requests);
        assert_eq!(panel_read_batch_size("xiaomi.curtain.acn009.extra"), 90);
        assert_eq!(panel_read_batch_size("lumi.curtain.acn002"), 90);
    }
    #[test]
    fn airer_exact_model_partition_does_not_drop_properties() {
        let panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/airer-panel.json")).unwrap();
        let params = crate::spec::read_params(&panel);
        let batches = params
            .chunks(panel_read_batch_size(&panel.model))
            .collect::<Vec<_>>();
        assert_eq!(batches.iter().map(|b| b.len()).collect::<Vec<_>>(), [15, 8]);
        assert_eq!(batches.concat(), params);
        assert_eq!(panel_read_batch_size("hyd.airer.pro"), 90);
    }
    #[test]
    fn router_string_code_exception_stays_on_the_exact_gateway_paths() {
        for path in [
            crate::router::INIT,
            crate::router::ROUTERS,
            crate::router::CLIENTS,
            crate::router::FILTER,
            crate::router::LED,
        ] {
            assert_eq!(response_code(path, &json!({"code":"0"})).unwrap(), 0);
            assert_eq!(response_code(path, &json!({"code":3})).unwrap(), 3);
            assert!(response_code(path, &json!({"result":{}})).is_err());
            assert!(response_code(path, &json!({"code":"unknown"})).is_err());
        }
        assert!(response_code("/miotspec/prop/set", &json!({"code":"0"})).is_err());
        assert!(response_code("/appgateway/third/miwifi/unknown", &json!({"code":"0"})).is_err());
    }
    #[test]
    fn optional_code_is_limited_to_the_verified_language_endpoint() {
        let language = "/appgateway/gspec/Gspec/spec_multi_language";
        assert_eq!(
            response_code(language, &json!({"message":"ok","result":{}})).unwrap(),
            0
        );
        assert_eq!(
            response_code(language, &json!({"code":3,"result":{}})).unwrap(),
            3
        );
        assert_eq!(
            response_code(language, &json!({"code":"0","result":{}})).unwrap(),
            0
        );
        assert!(response_code(language, &json!({"result":[]})).is_err());
        assert!(response_code(language, &json!({"code":"unknown","result":{}})).is_err());
        assert!(response_code("/miotspec/prop/set", &json!({"result":{}})).is_err());
        assert!(response_code("/miotspec/prop/set", &json!({"code":"0","result":{}})).is_err());
    }
    #[test]
    fn light_group_members_require_the_exact_authenticated_group_relationship() {
        let raw = json!({"pid":17,"extra":{"member_list":{"group_did":"group-a","member_ship":{"light-b":"1","light-a":"1"}}}});
        assert_eq!(
            parse_group_members(&raw, "group-a"),
            Some(vec!["light-a".into(), "light-b".into()])
        );
        assert!(parse_group_members(&raw, "group-b").is_none());
        let mut ordinary = raw.clone();
        ordinary["pid"] = json!(0);
        assert!(parse_group_members(&ordinary, "group-a").is_none());
        let mut another_model = raw.clone();
        another_model["model"] = json!("different.vendor.group");
        assert!(parse_group_members(&another_model, "group-a").is_some());
        for members in [json!(["light-a"]), json!({"group-a":"1"}), json!({"":"1"})] {
            let mut invalid = raw.clone();
            invalid["extra"]["member_list"]["member_ship"] = members;
            assert!(parse_group_members(&invalid, "group-a").is_none());
        }
    }
    #[test]
    fn shared_homes_retain_owner_and_rooms() {
        let homes = parse_homes(&json!({"homelist":[{"id":1,"uid":5,"name":"A","roomlist":[{"id":"3","name":"客厅"}]}], "share_home_list":[{"id":"2","uid":"7","name":"B"}]}), "5").unwrap();
        assert!(!homes[0].shared);
        assert!(homes[1].shared);
        assert_eq!(homes[1].owner_id, "7");
        assert_eq!(homes[0].rooms[0].id, "3");
    }
    #[test]
    fn device_projection_does_not_forward_cloud_tokens() {
        let home = Home {
            id: "1".into(),
            owner_id: "2".into(),
            name: "A".into(),
            rooms: vec![],
            shared: false,
            room_devices: Default::default(),
        };
        let d = parse_device(&json!({"did":"3","model":"test.test.a","token":"SECRET","localip":"192.168.1.2","isOnline":true}), &home).unwrap();
        let serialized = serde_json::to_string(&d).unwrap();
        assert!(!serialized.contains("SECRET"));
        assert!(!serialized.contains("192.168"));
    }
    #[test]
    fn firmware_config_selector_comes_from_authenticated_extra_and_is_not_forwarded() {
        let home = Home {
            id: "h".into(),
            owner_id: "o".into(),
            name: "home".into(),
            rooms: vec![],
            shared: false,
            room_devices: Default::default(),
        };
        let d = parse_device(
            &json!({"did":"d","model":"midjd8.washer.42","extra":{"fw_version":"2.2.5"}}),
            &home,
        )
        .unwrap();
        assert_eq!(d.firmware_version.as_deref(), Some("2.2.5"));
        assert!(!serde_json::to_string(&d).unwrap().contains("2.2.5"));
        assert!(parse_device(
            &json!({"did":"d","model":"test","extra":{"fw_version":5}}),
            &home
        )
        .unwrap()
        .firmware_version
        .is_none());
    }
    #[test]
    fn android_plugin_version_matches_sdk_firmware_mcu_and_native_fallback() {
        assert_eq!(
            android_plugin_version(
                &json!({"extra":{"fw_version":"1.1.3","mcu_version":"0017"},"version":"native"})
            )
            .as_deref(),
            Some("1.1.3.0017")
        );
        assert_eq!(
            android_plugin_version(&json!({"extra":{"fw_version":"1.1.3","mcu_version":""}}))
                .as_deref(),
            Some("1.1.3")
        );
        assert_eq!(
            android_plugin_version(
                &json!({"extra":{"fw_version":"","mcu_version":"0017"},"version":"fallback"})
            )
            .as_deref(),
            Some("fallback")
        );
        assert!(
            android_plugin_version(&json!({"extra":{"fw_version":3,"mcu_version":"0017"}}))
                .is_none()
        );
    }
    #[test]
    fn read_only_share_requires_permission_bit_and_authenticated_owner_shape() {
        let home = Home {
            id: "h".into(),
            owner_id: "o".into(),
            name: "h".into(),
            rooms: vec![],
            shared: true,
            room_devices: Default::default(),
        };
        for (permission, owner, expected) in [
            (32, json!({"nickname":"owner"}), true),
            (32, json!({"userid":"123"}), true),
            (16, json!({"userid":"123"}), false),
            (32, json!({}), false),
        ] {
            let d = parse_device(&json!({"did":"fixture","model":"fixture.model.v1","permitLevel":permission,"owner":owner}),&home).unwrap();
            assert_eq!(d.shared_read_only, expected);
            assert_eq!(serde_json::to_value(d).unwrap()["sharedReadOnly"], expected);
        }
    }
    #[test]
    fn canonical_artwork_preserves_custom_card_images_and_respects_model_and_expiry() {
        let mut devices: Vec<Device> = [
            json!({"did":"custom","model":"same","icon":"https://example.com/custom.png"}),
            json!({"did":"fallback","model":"same","icon":null}),
            json!({"did":"expired","model":"old","icon":null}),
            json!({"did":"missing","model":"unrelated","icon":null}),
        ]
        .into_iter()
        .map(|mut value| {
            value["name"] = json!("fixture");
            value["online"] = json!(true);
            value["roomId"] = json!("r");
            value["roomName"] = json!("room");
            serde_json::from_value(value).unwrap()
        })
        .collect();
        let cache = HashMap::from([
            (
                "same".into(),
                (101, Some("https://example.com/product.png".into())),
            ),
            (
                "old".into(),
                (100, Some("https://example.com/expired.png".into())),
            ),
        ]);
        apply_product_artwork(&mut devices, &cache, 100);
        assert_eq!(
            devices[0].icon.as_deref(),
            Some("https://example.com/custom.png")
        );
        assert_eq!(
            devices[0].product_icon.as_deref(),
            Some("https://example.com/product.png")
        );
        assert_eq!(devices[1].icon, devices[1].product_icon);
        for device in &devices[2..] {
            assert!(device.product_icon.is_none());
            assert!(device.icon.is_none());
        }
        let public = serde_json::to_value(&devices[0]).unwrap();
        assert_eq!(public["productIcon"], "https://example.com/product.png");
        assert!(public.get("product_icon").is_none());
    }
    #[test]
    fn main_list_visibility_uses_exact_cloud_flags_without_guessing_model_or_groups() {
        for raw in [
            json!({"hide_mode":1}),
            json!({"hide_mode":"2"}),
            json!({"hide_mode":-1}),
            json!({"comFlag":4096}),
            json!({"comFlag":4097}),
        ] {
            assert!(device_hidden_on_home(&raw));
        }
        for raw in [
            json!({}),
            json!({"hide_mode":0,"show_mode":1}),
            json!({"comFlag":32}),
            json!({"model":"mijia.light.group3","extra":{"split":{"parentId":"a"}}}),
        ] {
            assert!(!device_hidden_on_home(&raw));
        }
    }
    #[test]
    fn local_split_display_can_override_only_combined_flag_on_validated_channels() {
        let home = parse_homes(
            &json!({"homelist":[{"id":1,"uid":5,"name":"A","roomlist":[]}]}),
            "5",
        )
        .unwrap()
        .remove(0);
        let mut raw = json!({"did":"logical","model":"test.switch","comFlag":656,"hide_mode":0,"extra":{"split":{"parentId":"physical","moduleId":7}}});
        let d = parse_device(&raw, &home).unwrap();
        assert!(d.hidden_on_home && d.split_display_available);
        assert_eq!(d.control_service_id, Some(7));
        for flags in [4096 | 16, 4096, 640] {
            raw["comFlag"] = json!(flags);
            assert!(!parse_device(&raw, &home).unwrap().split_display_available);
        }
        raw["comFlag"] = json!(656);
        raw["hide_mode"] = json!(1);
        assert!(!parse_device(&raw, &home).unwrap().split_display_available);
        raw["hide_mode"] = json!(0);
        raw["extra"]["split"]["moduleId"] = json!("invalid");
        assert!(!parse_device(&raw, &home).unwrap().split_display_available);
        raw["extra"]["split"] = json!({"subDids":["child"]});
        assert!(!parse_device(&raw, &home).unwrap().split_display_available);
    }
    #[test]
    fn group_visibility_is_metadata_driven_and_keep_flags_override_ordinary_members() {
        let mut view = HomeVisibility::default();
        view.observe(&json!({"did":"g1","pid":17,"comFlag":0,"extra":{"member_list":{"member_ship":{"a":1,"b":1,"g2":1}}}}));
        assert!(view.hides("a"));
        assert!(!view.hides("g1"));
        view.observe(&json!({"did":"g2","pid":17,"comFlag":32,"extra":{"member_list":{"member_ship":{"b":1}}}}));
        assert!(!view.hides("b"));
        assert!(view.hides("g2"));
        assert!(!view.hides("unrelated"));
        view.observe(&json!({"did":"ordinary","pid":0,"extra":{"member_list":{"member_ship":{"unrelated":1}}}}));
        assert!(!view.hides("unrelated"));
        assert!(!device_hidden_on_home(
            &json!({"extra":{"split":{"subDids":["channel"]}}})
        ));
        assert!(!device_hidden_on_home(
            &json!({"extra":{"split":{"subDids":[]}}})
        ));
        assert!(device_hidden_on_home(&json!({"comFlag":16})));
    }
    #[test]
    fn paged_room_membership_is_merged_without_losing_earlier_devices() {
        let mut result = json!({"homelist":[{"id":"1","uid":"2","dids":["a"],"roomlist":[{"id":"r","name":"客厅","dids":["a"]}]}],"has_more":true,"max_id":"a"});
        merge_home_page(&mut result,&json!({"info":[{"id":"1","dids":["a","b"],"roomlist":[{"id":"r","dids":["b"]}]}],"has_more":false})).unwrap();
        let homes = parse_homes(&result, "2").unwrap();
        assert_eq!(homes[0].room_devices.len(), 2);
        assert_eq!(homes[0].room_devices["b"], "r");
        assert_eq!(result["homelist"][0]["dids"].as_array().unwrap().len(), 2);
    }
    #[test]
    fn split_route_comes_only_from_complete_cloud_metadata() {
        let raw = json!({"extra":{"channel":[1],"split":{"parentId":"physical","moduleId":2}}});
        let (route, error) = parse_split_route(&raw);
        assert_eq!(
            route,
            Some(SplitRoute {
                parent_did: "physical".into(),
                service_iid: 2
            })
        );
        assert!(error.is_none());
        for split in [
            json!({"parentId":"physical"}),
            json!({"moduleId":2}),
            json!({"parentId":"physical","moduleId":"bogus"}),
            json!({"parentId":"physical","moduleId":0}),
            json!({"parentId":"physical","moduleId":"02"}),
        ] {
            let (route, error) = parse_split_route(&json!({"extra":{"split":split}}));
            assert!(route.is_none());
            assert!(error.is_some());
        }
        assert_eq!(
            parse_split_route(&json!({"extra":{"split":{"subDids":["logical.s2"]}}})),
            (None, None)
        );
    }
    #[test]
    fn control_groups_follow_server_parent_links_and_distinguish_physical_parent() {
        let home = Home {
            id: "home".into(),
            name: "home".into(),
            owner_id: "owner".into(),
            rooms: vec![],
            shared: false,
            room_devices: Default::default(),
        };
        let raws = [
            json!({"did":"physical","model":"test.switch.v1","name":"Wall Switch","isOnline":true}),
            json!({"did":"logical-a","model":"test.switch.v1","name":"Left","isOnline":true,"extra":{"split":{"parentId":"physical","moduleId":2}}}),
            json!({"did":"logical-b","model":"test.switch.v1","name":"Right","isOnline":true,"extra":{"split":{"parentId":"physical","moduleId":3}}}),
            json!({"did":"unrelated","model":"test.switch.v1","name":"Left","isOnline":true}),
        ];
        let mut devices: Vec<_> = raws
            .iter()
            .map(|raw| parse_device(raw, &home).unwrap())
            .collect();
        assign_control_groups(&mut devices);
        let group = devices[0].control_group.clone().unwrap();
        assert_eq!(group.len(), 64);
        assert!(!group.contains("physical"));
        assert_eq!(devices[0].control_service_id, None);
        for (index, service_iid) in [(1, 2), (2, 3)] {
            assert_eq!(
                devices[index].control_group.as_deref(),
                Some(group.as_str())
            );
            assert_eq!(
                devices[index].control_group_name.as_deref(),
                Some("Wall Switch")
            );
            assert_eq!(devices[index].control_service_id, Some(service_iid));
            let serialized = serde_json::to_string(&devices[index]).unwrap();
            assert!(!serialized.contains("physical"));
            assert!(serialized.contains("controlGroup"));
            assert!(serialized.contains("controlServiceId"));
        }
        assert!(devices[3].control_group.is_none());
        // A hidden/omitted physical parent still leaves children correctly
        // grouped, without inventing a parent display name.
        let mut children = devices[1..3].to_vec();
        assign_control_groups(&mut children);
        assert_eq!(children[0].control_group, children[1].control_group);
        assert!(children[0].control_group_name.is_none());
        assert_eq!(children[0].control_group.as_deref(), Some(group.as_str()));
    }
}
