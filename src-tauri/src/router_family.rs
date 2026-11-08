//! Native rn02 family protection: 12182 + utils 11186. One opt_list POST.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
#[cfg(test)]
#[path = "router_family_tests.rs"]
mod tests;
pub const USERS: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_get_user_list";
pub const DEVICES: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_get_device_list";
pub const TIMES: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_get_deny_time";
pub const URLS: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_get_filting_net";
pub const APPS: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_get_app_antiaddict";
pub const SET: &str = "/appgateway/third/miwifi/app/r/api/misystem/mipctl_set";
pub const APP_CONFIG: &str = "/appgateway/third/miwifi/app/s/parent_control/app_config";
pub(crate) fn is_read_path(path: &str) -> bool {
    [USERS, DEVICES, TIMES, URLS, APPS, APP_CONFIG].contains(&path)
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Time {
    pub id: Option<Value>,
    pub start: u16,
    pub end: u16,
    pub enable: [u8; 7],
    #[serde(default)]
    pub deleted: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct App {
    pub name: String,
    pub enable: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Category {
    pub class_name: String,
    pub enable: bool,
    pub time_quota: u16,
    pub apps: Vec<App>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct User {
    pub user_id: Value,
    pub name: String,
    pub icon: String,
    pub devices: Vec<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub user: User,
    pub times: Vec<Time>,
    pub urls: Vec<String>,
    pub apps: Vec<Category>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Client {
    pub mac: String,
    pub name: String,
    pub online: Option<bool>,
    pub connection: Option<u8>,
    pub icon: Option<String>,
    pub owner: Option<Value>,
    pub owner_name: Option<String>,
    pub event_time: Option<u64>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub mac: String,
    pub revision: String,
    pub supported: bool,
    pub write_reason: Option<String>,
    pub users: Vec<User>,
    pub current: Option<Profile>,
    pub clients: Vec<Client>,
    pub apps: Vec<Category>,
    pub labels: HashMap<String, String>,
    pub icons: HashMap<String, String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Draft {
    pub user_id: Option<Value>,
    pub name: String,
    pub icon: String,
    pub devices: Vec<String>,
    pub times: Vec<Time>,
    pub urls: Vec<String>,
    pub apps: Vec<Category>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Operation {
    Save { draft: Draft },
    Delete { user_id: Value },
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub baseline: String,
    pub mac: String,
    pub operation: Operation,
}
#[derive(Clone, Debug)]
pub(crate) struct Pending {
    pub change: Change,
    pub before_ids: Vec<Value>,
}
#[derive(Serialize)]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
}
#[derive(Serialize)]
pub struct Outcome {
    pub status: String,
    pub message: String,
    pub report: Option<Report>,
}
pub(crate) fn success(v: &Value) -> Result<()> {
    if v["code"] == 0 || v["code"] == "0" {
        Ok(())
    } else {
        Err(AppError::new(
            "routerGateway",
            "路由器未接受家人上网保护请求。",
            false,
        ))
    }
}
fn text(v: &Value) -> Result<String> {
    v.as_str()
        .filter(|s| s.len() <= 512 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(AppError::protocol)
}
fn array<'a>(v: &'a Value, key: &str, max: usize) -> Result<&'a Vec<Value>> {
    success(v)?;
    v[key]
        .as_array()
        .filter(|a| a.len() <= max)
        .ok_or_else(AppError::protocol)
}
fn id(v: &Value) -> Result<String> {
    if let Some(n) = v.as_u64().filter(|n| *n <= 9_007_199_254_740_991) {
        return Ok(n.to_string());
    }
    v.as_str()
        .filter(|s| !s.is_empty() && s.len() <= 128 && !s.chars().any(char::is_control))
        .map(str::to_owned)
        .ok_or_else(AppError::protocol)
}
fn eqid(a: &Value, b: &Value) -> bool {
    id(a).ok().zip(id(b).ok()).is_some_and(|(a, b)| a == b)
}
fn macs(a: &Value, max: usize) -> Result<Vec<String>> {
    let mut seen = HashSet::new();
    a.as_array()
        .filter(|a| a.len() <= max)
        .ok_or_else(AppError::protocol)?
        .iter()
        .map(|v| {
            let mac = v
                .as_str()
                .filter(|s| crate::router_client_name::valid_mac(s))
                .ok_or_else(AppError::protocol)?
                .to_ascii_lowercase();
            if !seen.insert(mac.clone()) {
                return Err(AppError::protocol());
            }
            Ok(mac)
        })
        .collect()
}
pub fn parse_users(users: &Value, mapping: &Value) -> Result<Vec<User>> {
    let mut rows = vec![];
    let mut ids = HashSet::new();
    for u in array(users, "user_list", 8)? {
        let key = id(&u["user_id"])?;
        if key == "0" || !ids.insert(key) {
            return Err(AppError::protocol());
        }
        let icon = if let Some(s) = u["icon"].as_str() {
            s.to_owned()
        } else {
            u["icon"]
                .as_u64()
                .ok_or_else(AppError::protocol)?
                .to_string()
        };
        rows.push(User {
            user_id: u["user_id"].clone(),
            name: text(&u["user_name"])?,
            icon,
            devices: vec![],
        });
    }
    let mut mapped = HashSet::new();
    let mut owned = HashSet::new();
    for m in array(mapping, "list", 8)? {
        let key = id(&m["user_id"])?;
        if !mapped.insert(key) {
            return Err(AppError::protocol());
        }
        let u = rows
            .iter_mut()
            .find(|u| eqid(&u.user_id, &m["user_id"]))
            .ok_or_else(AppError::protocol)?;
        u.devices = macs(&m["devices"], 10)?;
        if u.devices.iter().any(|mac| !owned.insert(mac.clone())) {
            return Err(AppError::protocol());
        }
    }
    Ok(rows)
}
pub fn parse_apps(v: &Value) -> Result<Vec<Category>> {
    let mut keys = HashSet::new();
    let mut result = vec![];
    for c in array(v, "list", 64)? {
        let key = text(&c["class_name"])?;
        if key.is_empty() || !keys.insert(key.clone()) {
            return Err(AppError::protocol());
        }
        let quota = c["time_quota"]
            .as_u64()
            .filter(|v| *v <= 720 && v % 30 == 0)
            .ok_or_else(AppError::protocol)? as u16;
        let enable = c["enable"].as_bool().ok_or_else(AppError::protocol)?;
        let a = c["app_list"]
            .as_array()
            .filter(|a| a.len() <= 512)
            .ok_or_else(AppError::protocol)?;
        let mut names = HashSet::new();
        let mut apps = vec![];
        for a in a {
            let name = text(&a["name"])?;
            if name.is_empty() || !names.insert(name.clone()) {
                return Err(AppError::protocol());
            }
            apps.push(App {
                name,
                enable: a["enable"].as_bool().ok_or_else(AppError::protocol)?,
            });
        }
        result.push(Category {
            class_name: key,
            enable,
            time_quota: quota,
            apps,
        });
    }
    Ok(result)
}
fn valid_time(t: &Time) -> bool {
    t.start < 1440 && t.end > t.start && t.end <= t.start + 1440 && t.enable.iter().all(|b| *b <= 1)
}
pub fn parse_profile(user: &User, times: &Value, urls: &Value, apps: &Value) -> Result<Profile> {
    let mut ts = vec![];
    let mut ids = HashSet::new();
    for t in array(times, "time_list", 4)? {
        let tid = t.get("id").cloned().filter(|v| !v.is_null());
        if let Some(tid) = &tid {
            if !ids.insert(id(tid)?) {
                return Err(AppError::protocol());
            }
        }
        let start = t["start"]
            .as_u64()
            .filter(|n| *n < 1440)
            .ok_or_else(AppError::protocol)? as u16;
        let end = t["end"]
            .as_u64()
            .filter(|n| *n <= 2880)
            .ok_or_else(AppError::protocol)? as u16;
        let enable: Vec<u8> = t["enable"]
            .as_array()
            .filter(|a| a.len() == 7)
            .ok_or_else(AppError::protocol)?
            .iter()
            .map(|b| {
                b.as_u64()
                    .filter(|n| *n <= 1)
                    .map(|n| n as u8)
                    .ok_or_else(AppError::protocol)
            })
            .collect::<Result<_>>()?;
        let t = Time {
            id: tid,
            start,
            end,
            enable: enable.try_into().map_err(|_| AppError::protocol())?,
            deleted: false,
        };
        if !valid_time(&t) {
            return Err(AppError::protocol());
        }
        ts.push(t);
    }
    let mut us = vec![];
    for u in array(urls, "list", 1024)? {
        let s = text(u)?;
        if s.is_empty() || us.contains(&s) {
            return Err(AppError::protocol());
        }
        us.push(s);
    }
    Ok(Profile {
        user: user.clone(),
        times: ts,
        urls: us,
        apps: parse_apps(apps)?,
    })
}
fn normalized_profile(p: &Profile) -> Value {
    let mut devices = p.user.devices.clone();
    devices.sort();
    let mut urls = p.urls.clone();
    urls.sort();
    let mut times = p
        .times
        .iter()
        .map(|t| json!({"start":t.start,"end":t.end,"enable":t.enable}))
        .collect::<Vec<_>>();
    times.sort_by_key(Value::to_string);
    let mut apps = p
        .apps
        .iter()
        .map(|c| {
            let mut a = c
                .apps
                .iter()
                .map(|a| json!({"name":a.name,"enable":a.enable}))
                .collect::<Vec<_>>();
            a.sort_by_key(Value::to_string);
            json!({"class":c.class_name,"enable":c.enable,"quota":c.time_quota,"apps":a})
        })
        .collect::<Vec<_>>();
    apps.sort_by_key(Value::to_string);
    json!({"name":p.user.name,"icon":p.user.icon,"devices":devices,"times":times,"urls":urls,"apps":apps})
}
fn revision(r: &Report) -> Result<String> {
    let mut users = r
        .users
        .iter()
        .map(|u| {
            let mut devices = u.devices.clone();
            devices.sort();
            json!({"id":id(&u.user_id).ok(),"name":u.name,"icon":u.icon,"devices":devices})
        })
        .collect::<Vec<_>>();
    users.sort_by_key(Value::to_string);
    let current = r.current.as_ref().map(normalized_profile);
    Ok(format!("{:x}",Sha256::digest(serde_json::to_vec(&json!({"did":r.did,"mac":r.mac,"supported":r.supported,"reason":r.write_reason,"users":users,"current":current,"template":if current.is_none(){serde_json::to_value(&r.apps).ok()}else{None}})).map_err(|_|AppError::protocol())?)))
}
pub fn parse_catalog(data: &str) -> (HashMap<String, String>, HashMap<String, String>) {
    let mut labels = HashMap::new();
    let mut icons = HashMap::new();
    let Some((display, terms)) = data.split_once("[term_table]") else {
        return (labels, icons);
    };
    for line in terms.lines().skip(1) {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() >= 2
            && !parts[0].is_empty()
            && parts[0].len() <= 512
            && parts[1].len() <= 512
        {
            labels.insert(parts[0].into(), parts[1].into());
        }
    }
    for line in display.lines().skip(1) {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() >= 3
            && !parts[0].is_empty()
            && parts[2].len() <= 512
            && !parts[2].contains([':', '\\'])
            && !parts[2].contains("..")
            && !parts[2].starts_with('/')
        {
            icons.insert(
                parts[0].into(),
                format!("https://s.miwifi.com/icon/{}", parts[2]),
            );
        }
    }
    (labels, icons)
}
async fn catalog(
    cloud: &Cloud,
    device: &Device,
) -> Result<(HashMap<String, String>, HashMap<String, String>)> {
    let raw=cloud.request_router_read(APP_CONFIG,json!({"method":"GET","params":{"deviceId":router::gateway_id(device)?,"locale":"zh_CN"}})).await?;
    success(&raw)?;
    let url = url::Url::parse(
        raw["data"]["data_url"]
            .as_str()
            .ok_or_else(AppError::protocol)?,
    )
    .map_err(|_| AppError::protocol())?;
    if url.scheme() != "https"
        || !url.username().is_empty()
        || url.password().is_some()
        || url.host_str() != Some("cdn.cnbj1.fds.api.mi-img.com")
    {
        return Err(AppError::protocol());
    }
    let client = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(AppError::network)?;
    let mut response = client.get(url).send().await.map_err(AppError::network)?;
    if !response.status().is_success() {
        return Err(AppError::protocol());
    }
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await.map_err(AppError::network)? {
        if bytes.len() + chunk.len() > 2 * 1024 * 1024 {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    let s = String::from_utf8(bytes).map_err(|_| AppError::protocol())?;
    Ok(parse_catalog(&s))
}
pub async fn load(
    cloud: &Cloud,
    device: &Device,
    mac: &str,
    hint: Option<&Value>,
) -> Result<Report> {
    let device_id = router::gateway_id(device)?;
    if !crate::router_client_name::valid_mac(mac) {
        return Err(AppError::invalid("设备标识无效。"));
    }
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (init, routers, clients) = tokio::try_join!(
        cloud.request_router_read(
            router::INIT,
            json!({"method":"POST","params":{"deviceId":device_id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":device_id}})
        ),
        router::read_clients(cloud, device)
    )?;
    success(&init)?;
    success(&routers)?;
    if !clients.iter().any(|c| c.mac.eq_ignore_ascii_case(mac)) {
        return Err(AppError::invalid("设备已不在当前路由器列表中。"));
    }
    let rows = routers["deviceList"]
        .as_array()
        .ok_or_else(AppError::protocol)?
        .iter()
        .filter(|r| r["id"].as_str() == Some(device_id))
        .collect::<Vec<_>>();
    if rows.len() != 1 {
        return Err(AppError::protocol());
    }
    let row = rows[0];
    let supported = crate::router_url::family_protection(&init, row)?;
    let work = row["work_mode"]
        .as_u64()
        .or_else(|| row["work_mode"].as_str()?.parse().ok());
    let reason = if !supported {
        Some("此路由器未提供家人上网保护。".into())
    } else if work != Some(0) {
        Some("中继模式或工作模式尚未确认，家人上网保护不可修改。".into())
    } else if device.shared_read_only {
        Some("此共享设备只有读取权限。".into())
    } else {
        None
    };
    let mut r = Report {
        did: device.did.clone(),
        model: device.model.clone(),
        mac: mac.to_ascii_lowercase(),
        revision: String::new(),
        supported,
        write_reason: reason,
        users: vec![],
        current: None,
        clients: vec![],
        apps: vec![],
        labels: HashMap::new(),
        icons: HashMap::new(),
    };
    if !supported {
        r.revision = revision(&r)?;
        return Ok(r);
    }
    let req = |path, user_id: Option<&Value>| {
        let mut params = json!({"deviceId":device_id});
        if let Some(user_id) = user_id {
            params["user_id"] = user_id.clone();
        }
        cloud.request_router_read(path, json!({"method":"GET","params":params}))
    };
    let (users, mapping) = tokio::try_join!(req(USERS, None), req(DEVICES, None))?;
    r.users = parse_users(&users, &mapping)?;
    let current = if let Some(hint) = hint {
        r.users.iter().find(|u| eqid(&u.user_id, hint))
    } else {
        r.users
            .iter()
            .find(|u| u.devices.iter().any(|m| m.eq_ignore_ascii_case(mac)))
    }
    .cloned();
    let zero = json!(0);
    let selected = current.as_ref().map(|u| &u.user_id).unwrap_or(&zero);
    let apps = req(APPS, Some(selected)).await?;
    r.apps = parse_apps(&apps)?;
    if let Some(user) = current {
        let (times, urls) = tokio::try_join!(
            req(TIMES, Some(&user.user_id)),
            req(URLS, Some(&user.user_id))
        )?;
        r.current = Some(parse_profile(&user, &times, &urls, &apps)?);
    }
    for c in clients {
        let owner = r
            .users
            .iter()
            .find(|u| u.devices.iter().any(|m| m.eq_ignore_ascii_case(&c.mac)));
        r.clients.push(Client {
            mac: c.mac.to_ascii_lowercase(),
            name: c.name,
            online: c.online,
            connection: c.connection,
            icon: c.icon,
            owner: owner.map(|u| u.user_id.clone()),
            owner_name: owner.map(|u| u.name.clone()),
            event_time: c.event_time,
        });
    }
    let extra = r
        .users
        .iter()
        .flat_map(|u| u.devices.iter().map(move |m| (u, m)))
        .filter(|(_, m)| !r.clients.iter().any(|c| c.mac == **m))
        .collect::<Vec<_>>();
    for (u, m) in extra {
        r.clients.push(Client {
            mac: m.clone(),
            name: m.clone(),
            online: None,
            connection: None,
            icon: None,
            owner: Some(u.user_id.clone()),
            owner_name: Some(u.name.clone()),
            event_time: None,
        });
    }
    match catalog(cloud, device).await {
        Ok((labels, icons)) => {
            r.labels = labels;
            r.icons = icons;
        }
        Err(e) if e.kind == "authExpired" => return Err(e),
        Err(_) => {}
    }
    r.revision = revision(&r)?;
    Ok(r)
}
pub fn valid_name(name: &str) -> bool {
    !name.trim().is_empty()
        && !name.chars().any(char::is_control)
        && name
            .encode_utf16()
            .map(|c| {
                if (1..=0x7e).contains(&c) || (0xff60..=0xff9f).contains(&c) {
                    1
                } else {
                    2
                }
            })
            .sum::<usize>()
            <= 12
}
pub fn valid_url(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 512
        && s.is_ascii()
        && !s.chars().any(|c| {
            c.is_control() || c.is_whitespace() || "-_!@#$%^&*()+=<>?/\\|~`\"'{}[]".contains(c)
        })
}
fn draft_profile(d: &Draft, user_id: Value) -> Profile {
    Profile {
        user: User {
            user_id,
            name: d.name.clone(),
            icon: d.icon.clone(),
            devices: d.devices.iter().map(|s| s.to_ascii_lowercase()).collect(),
        },
        times: d
            .times
            .iter()
            .filter(|t| !t.deleted)
            .map(|t| {
                let mut t = t.clone();
                t.id = None;
                t
            })
            .collect(),
        urls: d.urls.clone(),
        apps: d.apps.clone(),
    }
}
pub(crate) fn prepare(device: &Device, r: &Report, c: &Change) -> Result<(Value, Pending)> {
    crate::router_indicator::writable(device)?;
    if !r.supported {
        return Err(AppError::new(
            "unsupported",
            "此路由器未提供家人上网保护。",
            false,
        ));
    }
    if let Some(reason) = &r.write_reason {
        return Err(AppError::new("unavailable", reason, false));
    }
    if r.did != device.did
        || r.model != device.model
        || !r.mac.eq_ignore_ascii_case(&c.mac)
        || r.revision != c.baseline
    {
        return Err(AppError::new(
            "conflict",
            "家人上网保护已变化，请核对当前配置。",
            false,
        ));
    }
    let opts = match &c.operation {
        Operation::Delete { user_id } => {
            if r.current
                .as_ref()
                .is_none_or(|p| !eqid(&p.user.user_id, user_id))
            {
                return Err(AppError::invalid("待删除的保护配置与当前设备不匹配。"));
            }
            vec![json!({"opt":"mipctl_del_user","user_id":user_id})]
        }
        Operation::Save { draft: d } => {
            if d.user_id.as_ref().is_some_and(|v| id(v).is_err())
                || d.user_id.as_ref().map(id).transpose()?.as_ref()
                    != r.current
                        .as_ref()
                        .map(|p| id(&p.user.user_id))
                        .transpose()?
                        .as_ref()
            {
                return Err(AppError::invalid("保护配置身份已变化。"));
            }
            if d.user_id.is_none() && r.users.len() >= 8 {
                return Err(AppError::invalid("最多可以添加8个家人。"));
            }
            if !valid_name(&d.name) || !d.icon.parse::<u8>().is_ok_and(|i| i <= 10) {
                return Err(AppError::invalid("家人名称或头像无效。"));
            }
            if d.devices.is_empty()
                || d.devices.len() > 10
                || d.devices
                    .iter()
                    .any(|s| !crate::router_client_name::valid_mac(s))
                || d.devices
                    .iter()
                    .map(|m| m.to_ascii_lowercase())
                    .collect::<HashSet<_>>()
                    .len()
                    != d.devices.len()
            {
                return Err(AppError::invalid("请选择1至10台有效设备。"));
            }
            for mac in &d.devices {
                let client = r
                    .clients
                    .iter()
                    .find(|v| v.mac.eq_ignore_ascii_case(mac))
                    .ok_or_else(|| AppError::invalid("设备已不在可选列表中。"))?;
                if client
                    .owner
                    .as_ref()
                    .is_some_and(|owner| d.user_id.as_ref().is_none_or(|own| !eqid(owner, own)))
                {
                    return Err(AppError::invalid("设备已加入其他家人的保护。"));
                }
            }
            if d.urls.len() > 1024
                || d.urls.iter().any(|u| !valid_url(u))
                || d.urls.iter().collect::<HashSet<_>>().len() != d.urls.len()
            {
                return Err(AppError::invalid("网址过滤列表无效或包含重复网址。"));
            }
            if d.times.iter().filter(|t| !t.deleted).count() > 4
                || d.times.len() > 8
                || d.times.iter().any(|t| !valid_time(t))
            {
                return Err(AppError::invalid("不可用时段无效，最多4个。"));
            }
            let before = r
                .current
                .as_ref()
                .map(|p| p.times.as_slice())
                .unwrap_or(&[]);
            let mut seen = HashSet::new();
            for t in &d.times {
                if let Some(tid) = &t.id {
                    let key = id(tid)?;
                    if !seen.insert(key)
                        || !before
                            .iter()
                            .any(|old| old.id.as_ref().is_some_and(|v| eqid(v, tid)))
                    {
                        return Err(AppError::invalid("时段标识已变化。"));
                    }
                } else if t.deleted {
                    return Err(AppError::invalid("新时段无需发送删除操作。"));
                }
            }
            if before.iter().any(|t| {
                t.id.as_ref().is_none_or(|tid| {
                    !d.times
                        .iter()
                        .any(|t| t.id.as_ref().is_some_and(|v| eqid(v, tid)))
                })
            }) {
                return Err(AppError::invalid("已有时段缺少标识或删除记录。"));
            }
            let base = &r.apps;
            if d.apps.len() != base.len() {
                return Err(AppError::invalid("应用分类已经变化。"));
            }
            let mut classes = HashSet::new();
            for c in &d.apps {
                let b = base
                    .iter()
                    .find(|b| b.class_name == c.class_name)
                    .ok_or_else(|| AppError::invalid("应用分类无效。"))?;
                if !classes.insert(&c.class_name)
                    || c.time_quota > 720
                    || c.time_quota % 30 != 0
                    || c.apps.len() != b.apps.len()
                    || c.apps.iter().map(|a| &a.name).collect::<HashSet<_>>().len() != c.apps.len()
                    || c.apps
                        .iter()
                        .any(|a| !b.apps.iter().any(|b| b.name == a.name))
                {
                    return Err(AppError::invalid("应用限制或可用时长无效。"));
                }
            }
            let mut user = json!({"opt":if d.user_id.is_some(){"mipctl_edit_user"}else{"mipctl_add_user"},"icon":d.icon,"user_name":d.name});
            if let Some(tid) = &d.user_id {
                user["user_id"] = tid.clone();
            }
            let times = d
                .times
                .iter()
                .map(|t| {
                    if t.deleted {
                        json!({"id":t.id})
                    } else {
                        let mut v = json!({"start":t.start,"end":t.end,"enable":t.enable});
                        if let Some(tid) = &t.id {
                            v["id"] = tid.clone();
                        }
                        v
                    }
                })
                .collect::<Vec<_>>();
            let apps=d.apps.iter().map(|c|json!({"class_name":c.class_name,"enable":c.enable,"time_quota":c.time_quota,"app_list":c.apps.iter().map(|a|json!({"name":a.name,"enable":a.enable})).collect::<Vec<_>>()})).collect::<Vec<_>>();
            vec![
                user,
                json!({"opt":"mipctl_set_device","devices":d.devices}),
                json!({"opt":"mipctl_set_deny_time","time_list":times}),
                json!({"opt":"mipctl_set_filting_net","list":d.urls}),
                json!({"opt":"mipctl_set_app_antiaddict","list":apps}),
            ]
        }
    };
    Ok((
        json!({"method":"POST","params":{"deviceId":router::gateway_id(device)?,"opt_list":opts}}),
        Pending {
            change: c.clone(),
            before_ids: r.users.iter().map(|u| u.user_id.clone()).collect(),
        },
    ))
}
pub(crate) fn hint(p: &Pending, r: &Report) -> Option<Value> {
    match &p.change.operation {
        Operation::Delete { user_id } => Some(user_id.clone()),
        Operation::Save { draft } => {
            if let Some(tid) = &draft.user_id {
                Some(tid.clone())
            } else {
                let candidates = r
                    .users
                    .iter()
                    .filter(|u| {
                        u.name == draft.name
                            && u.icon == draft.icon
                            && !p.before_ids.iter().any(|i| eqid(i, &u.user_id))
                    })
                    .collect::<Vec<_>>();
                (candidates.len() == 1).then(|| candidates[0].user_id.clone())
            }
        }
    }
}
pub(crate) fn confirmed(r: &Report, p: &Pending) -> bool {
    if !r.supported || r.write_reason.is_some() || !r.mac.eq_ignore_ascii_case(&p.change.mac) {
        return false;
    }
    match &p.change.operation {
        Operation::Delete { user_id } => !r.users.iter().any(|u| eqid(&u.user_id, user_id)),
        Operation::Save { draft } => r.current.as_ref().is_some_and(|current| {
            let identity = if let Some(uid) = &draft.user_id {
                eqid(uid, &current.user.user_id)
            } else {
                !p.before_ids.iter().any(|i| eqid(i, &current.user.user_id))
            };
            identity
                && normalized_profile(current)
                    == normalized_profile(&draft_profile(draft, current.user.user_id.clone()))
        }),
    }
}
pub(crate) async fn read_pending(cloud: &Cloud, d: &Device, p: &Pending) -> Result<Report> {
    let base = load(cloud, d, &p.change.mac, None).await?;
    if let Some(tid) = hint(p, &base) {
        if base
            .current
            .as_ref()
            .is_some_and(|v| eqid(&v.user.user_id, &tid))
        {
            return Ok(base);
        }
        return load(cloud, d, &p.change.mac, Some(&tid)).await;
    }
    Ok(base)
}
