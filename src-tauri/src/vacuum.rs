//! xiaomi.vacuum.d103cn, original plugin 1019185-v35. Fixed RPC bindings only.
//! Map refresh (6.1) reads the robot's current I frame; it never starts mapping.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, io::Read, sync::OnceLock, time::Duration};
pub const MODEL: &str = "xiaomi.vacuum.d103cn";
const MAX_FILE: usize = 8 * 1024 * 1024;
const MAX_MAP: usize = 16 * 1024 * 1024;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x: f64,
    pub y: f64,
    pub angle: i16,
}
#[derive(Clone, Debug, Serialize)]
pub struct Room {
    pub id: u8,
    pub name: String,
    pub x: f64,
    pub y: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PathPoint {
    pub x: f64,
    pub y: f64,
    /// False starts a separate stroke; true continues the preceding stroke.
    pub is_line: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Map {
    pub width: u16,
    pub height: u16,
    pub grid_size: u16,
    pub origin: [f64; 2],
    pub cells: String,
    pub rooms: Vec<Room>,
    pub robot: Option<Point>,
    pub dock: Option<Point>,
    pub rotation: i16,
    pub path: Vec<PathPoint>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub baseline: String,
    pub status: i64,
    pub battery: u8,
    pub mode: u8,
    pub suction: u8,
    pub water: i16,
    pub in_station: bool,
    pub cleaning: bool,
    pub paused: bool,
    pub wash_station: i64,
    pub dust_status: i64,
    pub dust_enable: i64,
    pub child_lock: bool,
    pub map: Option<Map>,
    pub map_reason: Option<String>,
    #[serde(skip)]
    pub clean_setting: u32,
    #[serde(skip)]
    pub work_mode: i64,
    #[serde(skip)]
    pub task: i64,
    #[serde(skip)]
    pub fault: i64,
    #[serde(skip)]
    pub waterbox: i64,
}
#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Mode { value: u8 },
    Suction { value: u8 },
    Water { value: i16 },
    Start {},
    Pause {},
    Dock {},
    Wash { on: bool },
    Dry { on: bool },
    Collect {},
}
#[derive(Serialize)]
pub struct Changed {
    pub report: Report,
    pub confirmed: bool,
}
pub fn validate_device(d: &Device) -> Result<()> {
    if d.model != MODEL || d.split_route.is_some() {
        Err(AppError::invalid("此扫地机器人的控制绑定尚未核实。"))
    } else {
        crate::dispenser::rpc_path(d.control_did()).map(|_| ())
    }
}
async fn rpc(c: &Cloud, d: &Device, method: &str, params: Value) -> Result<Value> {
    validate_device(d)?;
    if !matches!(method, "get_properties" | "set_properties" | "action") {
        return Err(AppError::invalid("未验证的扫地机器人指令。"));
    }
    c.request(
        &crate::dispenser::rpc_path(d.control_did())?,
        json!({"id":(rand::random::<u32>()&0x7fff_ffff).max(1),"method":method,"params":params}),
    )
    .await
}
const PROPS: &[(u8, u8)] = &[
    (2, 1),
    (2, 2),
    (3, 1),
    (3, 2),
    (4, 1),
    (4, 4),
    (4, 6),
    (4, 7),
    (4, 23),
    (4, 25),
    (4, 27),
    (15, 3),
    (15, 5),
    (28, 1),
];
fn value(rows: &[Value], s: u8, p: u8) -> Result<i64> {
    let r = rows
        .iter()
        .find(|r| r["siid"] == s && r["piid"] == p)
        .ok_or_else(AppError::protocol)?;
    let code = r["code"].as_i64().ok_or_else(AppError::protocol)?;
    if code != 0 {
        return Err(AppError::device(code));
    }
    r["value"].as_i64().ok_or_else(AppError::protocol)
}
pub fn parse(d: &Device, raw: &Value) -> Result<Report> {
    validate_device(d)?;
    let a = raw
        .as_array()
        .filter(|a| a.len() == PROPS.len())
        .ok_or_else(AppError::protocol)?;
    let status = value(a, 2, 1)?;
    let fault = value(a, 2, 2)?;
    let battery = value(a, 3, 1)?;
    let charging = value(a, 3, 2)?;
    let work = value(a, 4, 1)?;
    let suction = value(a, 4, 4)?;
    let waterbox = value(a, 4, 6)?;
    let task = value(a, 4, 7)?;
    let clean = value(a, 4, 23)?;
    let wash = value(a, 4, 25)?;
    let lock = value(a, 4, 27)?;
    let dust_enable = value(a, 15, 3)?;
    let dust = value(a, 15, 5)?;
    let water = value(a, 28, 1)?;
    if !(0..=100).contains(&battery)
        || !(0..=3).contains(&suction)
        || !(0..=u32::MAX as i64).contains(&clean)
        || !valid_water(water)
        || ![0, 1].contains(&lock)
    {
        return Err(AppError::protocol());
    }
    let mut r = Report {
        did: d.did.clone(),
        model: d.model.clone(),
        baseline: String::new(),
        status,
        battery: battery as u8,
        mode: (clean & 3) as u8,
        suction: suction as u8,
        water: water as i16,
        in_station: work == 6 || charging == 1 || [1, 2, 5].contains(&wash),
        cleaning: [2, 4, 5, 13, 18, 19, 20, 24].contains(&work),
        paused: work == 1 || status == 3,
        wash_station: wash,
        dust_status: dust,
        dust_enable,
        child_lock: lock == 1,
        map: None,
        map_reason: None,
        clean_setting: clean as u32,
        work_mode: work,
        task,
        fault,
        waterbox,
    };
    r.baseline = format!(
        "{:x}",
        Sha256::digest(
            serde_json::to_vec(&(
                MODEL,
                d.control_did(),
                status,
                charging,
                work,
                suction,
                water,
                task,
                clean,
                wash,
                lock,
                dust,
                dust_enable,
                fault,
                waterbox
            ))
            .map_err(|_| AppError::protocol())?
        )
    );
    Ok(r)
}
fn valid_water(v: i64) -> bool {
    [-5, -10, -15].contains(&v) || (1..=15).contains(&v)
}
pub async fn read(c: &Cloud, d: &Device, with_map: bool) -> Result<Report> {
    let props: Vec<_> = PROPS
        .iter()
        .map(|(s, p)| json!({"did":d.control_did(),"siid":s,"piid":p}))
        .collect();
    let mut r = parse(d, &rpc(c, d, "get_properties", json!(props)).await?)?;
    if with_map {
        match map(c, d).await {
            Ok(m) => r.map = Some(m),
            Err(e) if e.kind == "authExpired" => return Err(e),
            Err(_) => r.map_reason = Some("地图暂未读取到，稍后会自动更新。".into()),
        }
    }
    Ok(r)
}
pub fn command(d: &Device, r: &Report, change: &Change) -> Result<(&'static str, Value)> {
    validate_device(d)?;
    if r.did != d.did || r.model != MODEL {
        return Err(AppError::stale());
    }
    if r.child_lock {
        return Err(AppError::new(
            "permissionDenied",
            "请先在米家 App 关闭童锁。",
            false,
        ));
    }
    if [7, 8, 9, 15, 21, 1501].contains(&r.work_mode) || [11, 14, 16, 19].contains(&r.status) {
        return Err(AppError::new(
            "unavailable",
            "当前设备任务结束后可操作。",
            true,
        ));
    }
    let set = |s: u8, p: u8, v: i64| {
        (
            "set_properties",
            json!([{"did":d.control_did(),"siid":s,"piid":p,"value":v}]),
        )
    };
    let action = |s: u8, a: u8, input: Value| {
        (
            "action",
            json!({"did":d.control_did(),"siid":s,"aiid":a,"in":input}),
        )
    };
    let idle_settings = || {
        if r.cleaning
            || [7, 8, 9, 21, 1501].contains(&r.work_mode)
            || [1, 7, 11, 12, 14, 15, 19, 23, 25].contains(&r.status)
        {
            Err(AppError::new(
                "unavailable",
                "当前任务结束后可调整清洁设置。",
                true,
            ))
        } else {
            Ok(())
        }
    };
    Ok(match change {
        Change::Mode { value } if *value <= 3 => {
            idle_settings()?;
            if *value == 3 && r.task != 0 {
                return Err(AppError::invalid("结束当前清洁后可切换先扫后拖。"));
            }
            set(4, 23, ((r.clean_setting & !3) | *value as u32) as i64)
        }
        Change::Suction { value } if *value <= 3 => {
            idle_settings()?;
            if r.mode == 1 {
                return Err(AppError::invalid("只拖地模式不使用吸力。"));
            }
            set(4, 4, *value as i64)
        }
        Change::Water { value } if valid_water(*value as i64) => {
            idle_settings()?;
            if r.mode == 2 {
                return Err(AppError::invalid("只扫地模式不使用拖布水量。"));
            }
            set(28, 1, *value as i64)
        }
        Change::Start {} => {
            if r.cleaning
                || [1, 2, 3, 4, 5, 6].contains(&r.wash_station)
                || r.dust_status == 1
                || [7, 8, 9, 21, 1501].contains(&r.work_mode)
            {
                return Err(AppError::invalid("请待当前设备任务结束后开始清洁。"));
            }
            if r.mode != 2 && r.waterbox != 1 {
                return Err(AppError::invalid("请先安装拖布后开始拖地。"));
            }
            action(2, 1, json!([]))
        }
        Change::Pause {} if r.cleaning || r.work_mode == 3 => action(2, 2, json!([])),
        Change::Dock {} if !r.in_station => action(3, 1, json!([])),
        Change::Wash { on }
            if r.in_station
                && (*on && r.wash_station == 0 || !*on && [1, 4].contains(&r.wash_station)) =>
        {
            if r.dust_status == 1 {
                return Err(AppError::invalid("请待集尘结束后操作。"));
            }
            if *on {
                action(4, 4, json!([{"piid":10,"value":"2,1"}]))
            } else {
                action(4, 2, json!([]))
            }
        }
        Change::Dry { on }
            if r.in_station && (*on && r.wash_station == 0 || !*on && r.wash_station == 2) =>
        {
            if r.dust_status == 1 {
                return Err(AppError::invalid("请待当前基座任务结束后操作。"));
            }
            action(4, 4, json!([{"piid":10,"value":if *on{"3,1"}else{"3,0"}}]))
        }
        Change::Collect {}
            if r.in_station && r.dust_enable == 1 && r.dust_status != 1 && r.wash_station == 0 =>
        {
            action(15, 1, json!([]))
        }
        _ => return Err(AppError::invalid("当前状态不支持此项操作。")),
    })
}
pub async fn send(c: &Cloud, d: &Device, method: &str, params: Value) -> Result<()> {
    let raw = rpc(c, d, method, params).await?;
    if method == "set_properties" {
        let a = raw
            .as_array()
            .filter(|a| a.len() == 1)
            .ok_or_else(AppError::protocol)?;
        code(&a[0])
    } else {
        code(&raw)
    }
}
fn code(v: &Value) -> Result<()> {
    let c = v["code"].as_i64().ok_or_else(AppError::protocol)?;
    if c == 0 {
        Ok(())
    } else {
        Err(AppError::device(c))
    }
}
pub fn matches(r: &Report, c: &Change) -> bool {
    match c {
        Change::Mode { value } => r.mode == *value,
        Change::Suction { value } => r.suction == *value,
        Change::Water { value } => r.water == *value,
        Change::Start {} => r.cleaning || r.wash_station == 3,
        Change::Pause {} => r.paused || r.work_mode == 17,
        Change::Dock {} => r.in_station || r.work_mode == 3,
        Change::Wash { on } => {
            if *on {
                [1, 3, 5].contains(&r.wash_station)
            } else {
                ![1, 3, 4, 5].contains(&r.wash_station)
            }
        }
        Change::Dry { on } => {
            if *on {
                r.wash_station == 2
            } else {
                r.wash_station != 2
            }
        }
        Change::Collect {} => r.dust_status == 1,
    }
}

// Original module 10070 requestMap. Unlike fastMapping (6.3), this action only
// asks the current stored map frame and never changes robot movement/settings.
async fn map(c: &Cloud, d: &Device) -> Result<Map> {
    let request = json!({"did":d.control_did(),"siid":6,"aiid":1,"in":[{"piid":2,"value":json!({"req_type":1,"frame_type":"I","force_type":1}).to_string()}]});
    let v = rpc(c, d, "action", request).await?;
    code(&v)?;
    let a = v["out"]
        .as_array()
        .filter(|a| a.len() <= 16)
        .ok_or_else(AppError::protocol)?;
    let item = |p| {
        a.iter()
            .find(|v| v["piid"] == p)
            .and_then(|v| v["value"].as_str())
            .filter(|s| !s.is_empty())
    };
    if let Some(s) = item(1) {
        return decode_map(s);
    }
    if let Some(s) = item(3) {
        return decode_map(&file(c, s).await?);
    }
    if let Some(s) = item(13) {
        let mut parts = s.splitn(2, ',');
        match (parts.next(), parts.next()) {
            (Some("0"), Some(data)) => return decode_map(data),
            (Some(_), Some(name)) => return decode_map(&file(c, name).await?),
            _ => {}
        }
    }
    Err(AppError::new("unavailable", "地图尚未生成。", true))
}
fn safe_object(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 512
        && !name.starts_with('/')
        && !name.contains("..")
        && name
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b"/_-.".contains(&b))
}
fn safe_url(url: &str) -> Result<url::Url> {
    let u = url::Url::parse(url).map_err(|_| AppError::protocol())?;
    let h = u.host_str().unwrap_or_default();
    if u.scheme() != "https"
        || !u.username().is_empty()
        || u.password().is_some()
        || u.port().is_some_and(|p| p != 443)
        || !(["fds.api.xiaomi.com", "ksyuncs.com"]
            .iter()
            .any(|base| h == *base || h.ends_with(&format!(".{base}"))))
    {
        return Err(AppError::protocol());
    }
    Ok(u)
}
async fn file(c: &Cloud, descriptor: &str) -> Result<String> {
    let mut p = descriptor.splitn(2, ',');
    let name = p.next().unwrap_or_default();
    let seed = p.next();
    if !safe_object(name)
        || seed.is_some_and(|s| {
            s.is_empty()
                || s.len() > 128
                || !s
                    .bytes()
                    .all(|b| b.is_ascii_alphanumeric() || b"_-".contains(&b))
        })
    {
        return Err(AppError::protocol());
    }
    let v = c
        .request(
            "/v2/home/get_interim_file_url_pro",
            json!({"obj_name":name}),
        )
        .await?;
    let url = safe_url(v["url"].as_str().ok_or_else(AppError::protocol)?)?;
    // Share the download connection pool across updates. This client never
    // receives account cookies/credentials and every URL is checked above.
    // A page refresh therefore does not create a new client/TCP/TLS connection.
    static CLIENT: OnceLock<Result<reqwest::Client>> = OnceLock::new();
    let client = CLIENT
        .get_or_init(|| {
            reqwest::Client::builder()
                .retry(reqwest::retry::never())
                .redirect(reqwest::redirect::Policy::none())
                .timeout(Duration::from_secs(20))
                .connect_timeout(Duration::from_secs(10))
                .build()
                .map_err(AppError::network)
        })
        .as_ref()
        .map_err(Clone::clone)?;
    let mut res = client.get(url).send().await.map_err(AppError::network)?;
    if !res.status().is_success() || res.content_length().is_some_and(|l| l > MAX_FILE as u64) {
        return Err(AppError::protocol());
    }
    let mut bytes = Vec::new();
    while let Some(chunk) = res.chunk().await.map_err(AppError::network)? {
        if bytes.len().saturating_add(chunk.len()) > MAX_FILE {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    let mut text = String::from_utf8(bytes).map_err(|_| AppError::protocol())?;
    if let Some(s) = seed {
        text.push(',');
        text.push_str(s);
    }
    Ok(text)
}
struct Frame {
    width: u16,
    height: u16,
    grid: u16,
    x: f64,
    y: f64,
    cells: Vec<u8>,
    robot: Point,
    dock: Point,
    extra: Value,
}
// Plugin 1019185-v35 / 10121.decodeTrace. S = absolute move, L = relative
// line, l = absolute line. This is device-recorded history, never inferred
// from periodic robot positions. Keep independent strokes disconnected.
fn decode_trace(source: &str) -> Result<Vec<PathPoint>> {
    const MAX_POINTS: usize = 100_000;
    if source.len() > 4 * 1024 * 1024 {
        return Err(AppError::protocol());
    }
    let bytes = source.as_bytes();
    let mut at = 0;
    let mut result: Vec<PathPoint> = Vec::new();
    let number = |at: &mut usize| -> Result<f64> {
        let start = *at;
        if bytes.get(*at) == Some(&b'-') {
            *at += 1;
        }
        let digits = *at;
        while bytes.get(*at).is_some_and(u8::is_ascii_digit) {
            *at += 1;
        }
        if digits == *at {
            return Err(AppError::protocol());
        }
        source[start..*at]
            .parse::<i32>()
            .ok()
            .filter(|n| n.unsigned_abs() <= 10_000_000)
            .map(|n| n as f64)
            .ok_or_else(AppError::protocol)
    };
    while at < bytes.len() {
        let marker = bytes[at];
        if !matches!(marker, b'S' | b'L' | b'l') || result.len() >= MAX_POINTS {
            return Err(AppError::protocol());
        }
        at += 1;
        let mut x = number(&mut at)?;
        if bytes.get(at) != Some(&b',') {
            return Err(AppError::protocol());
        }
        at += 1;
        let mut y = number(&mut at)?;
        if marker == b'L' {
            let last = result.last().ok_or_else(AppError::protocol)?;
            x += last.x;
            y += last.y;
        }
        if x.abs() > 10_000_000. || y.abs() > 10_000_000. {
            return Err(AppError::protocol());
        }
        result.push(PathPoint {
            x,
            y,
            is_line: marker != b'S' && !result.is_empty(),
        });
    }
    Ok(result)
}
fn frame(source: &str) -> Result<Frame> {
    if source.len() > MAX_FILE {
        return Err(AppError::protocol());
    }
    let mut parts = source.trim().splitn(2, ',');
    let source = parts
        .next()
        .unwrap_or_default()
        .trim()
        .replace('-', "+")
        .replace('_', "/");
    let encoded = STANDARD.decode(&source).map_err(|_| AppError::protocol())?;
    let compressed = if let Some(seed) = parts.next() {
        let key = format!("{:x}", Sha256::digest(seed.as_bytes()));
        cbc::Decryptor::<aes::Aes256>::new_from_slices(&key.as_bytes()[..32], b"OFULk9To37qRdXY3")
            .map_err(|_| AppError::protocol())?
            .decrypt_padded_vec_mut::<Pkcs7>(&encoded)
            .map_err(|_| AppError::protocol())?
    } else {
        encoded
    };
    let mut bytes = Vec::new();
    flate2::read::ZlibDecoder::new(compressed.as_slice())
        .take((MAX_MAP + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| AppError::protocol())?;
    if bytes.len() < 29 || bytes.len() > MAX_MAP || bytes[4] != 73 {
        return Err(AppError::protocol());
    }
    let i16at = |n| i16::from_le_bytes([bytes[n], bytes[n + 1]]);
    let (w, h, g) = (i16at(19), i16at(21), i16at(17));
    if w <= 0 || h <= 0 || g <= 0 || g > 500 || w > 2048 || h > 2048 {
        return Err(AppError::protocol());
    }
    let count = (w as usize)
        .checked_mul(h as usize)
        .filter(|n| *n <= 2_000_000 && 27 + n < bytes.len())
        .ok_or_else(AppError::protocol)?;
    let extra: Value =
        serde_json::from_slice(&bytes[27 + count..]).map_err(|_| AppError::protocol())?;
    if !extra.is_object() {
        return Err(AppError::protocol());
    }
    let point = |p: usize, name: &str| {
        let a = extra[name].as_array();
        Point {
            x: a.and_then(|a| a.first())
                .and_then(Value::as_f64)
                .unwrap_or(i16at(p) as f64),
            y: a.and_then(|a| a.get(1))
                .and_then(Value::as_f64)
                .unwrap_or(i16at(p + 2) as f64),
            angle: i16at(p + 4),
        }
    };
    let origin = extra["origin"].as_array();
    let x = origin
        .and_then(|a| a.first())
        .and_then(Value::as_f64)
        .unwrap_or(i16at(23) as f64)
        - g as f64 / 2.;
    let y = origin
        .and_then(|a| a.get(1))
        .and_then(Value::as_f64)
        .unwrap_or(i16at(25) as f64)
        - g as f64 / 2.;
    Ok(Frame {
        width: w as u16,
        height: h as u16,
        grid: g as u16,
        x,
        y,
        cells: bytes[27..27 + count].to_vec(),
        robot: point(5, "robot"),
        dock: point(11, "charger"),
        extra,
    })
}
pub fn decode_map(source: &str) -> Result<Map> {
    let current = frame(source)?;
    let embedded = current.extra["rism"]
        .as_str()
        .filter(|s| !s.is_empty())
        .map(frame)
        .transpose()?;
    let saved = embedded.as_ref().unwrap_or(&current);
    let is_saved = embedded.is_some() || saved.extra.get("seg_inf").is_some();
    let mut bounds: BTreeMap<u8, (usize, usize, usize, usize)> = BTreeMap::new();
    let cells: Vec<u8> = saved
        .cells
        .iter()
        .enumerate()
        .map(|(i, v)| {
            let room = if is_saved { v & 63 } else { v >> 2 };
            let pixel = if is_saved && v >> 7 == 1 {
                255
            } else if room > 0 && room <= 50 {
                room
            } else if !is_saved && room >= 61 {
                255
            } else {
                0
            };
            if pixel > 0 && pixel < 51 {
                let x = i % saved.width as usize;
                let y = i / saved.width as usize;
                bounds
                    .entry(pixel)
                    .and_modify(|b| {
                        b.0 = b.0.min(x);
                        b.1 = b.1.min(y);
                        b.2 = b.2.max(x);
                        b.3 = b.3.max(y)
                    })
                    .or_insert((x, y, x, y));
            }
            pixel
        })
        .collect();
    let rooms = bounds
        .into_iter()
        .map(|(id, (x0, y0, x1, y1))| {
            let info = &saved.extra["seg_inf"][id.to_string()];
            let types = [
                "房间",
                "客厅",
                "卧室",
                "书房",
                "厨房",
                "餐厅",
                "卫生间",
                "阳台",
                "走廊",
                "杂物间",
                "衣帽间",
                "会客室",
                "办公室",
                "健身区",
                "休闲区",
            ];
            let t = info["type"].as_u64().unwrap_or(0) as usize;
            let custom = info["name"]
                .as_str()
                .and_then(|s| STANDARD.decode(s).ok())
                .and_then(|v| String::from_utf8(v).ok())
                .filter(|s| !s.is_empty() && s.chars().count() <= 40);
            let name = if t == 0 {
                custom.unwrap_or_else(|| format!("房间{id}"))
            } else {
                let index = info["index"].as_u64().unwrap_or(0);
                format!(
                    "{}{}",
                    types.get(t).unwrap_or(&"房间"),
                    if index > 0 {
                        index.to_string()
                    } else {
                        String::new()
                    }
                )
            };
            Room {
                id,
                name,
                x: (x0 + x1) as f64 / 2.,
                y: (y0 + y1) as f64 / 2.,
            }
        })
        .collect();
    let projected = |p: &Point| {
        let x = (p.x - saved.x) / saved.grid as f64;
        let y = (p.y - saved.y) / saved.grid as f64;
        if p.angle == 32767
            || !x.is_finite()
            || !y.is_finite()
            || x < -50.
            || y < -50.
            || x > saved.width as f64 + 50.
            || y > saved.height as f64 + 50.
        {
            None
        } else {
            Some(Point {
                x,
                y,
                angle: p.angle,
            })
        }
    };
    let rotation = current.extra["mra"]
        .as_i64()
        .or_else(|| current.extra["mra"].as_str().and_then(|s| s.parse().ok()))
        .filter(|a| [0, 90, 180, 270].contains(a))
        .unwrap_or(0) as i16;
    let mut traces = match current.extra.get("tr") {
        Some(Value::String(s)) => decode_trace(s)?,
        None | Some(Value::Null) => Vec::new(),
        _ => return Err(AppError::protocol()),
    };
    // Original 10112.getMapData connects the last recorded trace to the current
    // robot only when the map itself explicitly marks l2r.
    if current.extra["l2r"] == 1
        && !traces.is_empty()
        && traces.len() < 100_000
        && current.robot.angle != 32767
    {
        traces.push(PathPoint {
            x: current.robot.x,
            y: current.robot.y,
            is_line: true,
        });
    }
    let mut path = Vec::with_capacity(traces.len());
    let mut pen_down = false;
    for point in traces {
        let x = (point.x - saved.x) / saved.grid as f64;
        let y = (point.y - saved.y) / saved.grid as f64;
        if !x.is_finite()
            || !y.is_finite()
            || x < -50.
            || y < -50.
            || x > saved.width as f64 + 50.
            || y > saved.height as f64 + 50.
        {
            pen_down = false;
            continue;
        }
        path.push(PathPoint {
            x,
            y,
            is_line: point.is_line && pen_down,
        });
        pen_down = true;
    }
    Ok(Map {
        width: saved.width,
        height: saved.height,
        grid_size: saved.grid,
        origin: [saved.x, saved.y],
        cells: STANDARD.encode(cells),
        rooms,
        robot: projected(&current.robot),
        dock: projected(&current.dock),
        rotation,
        path,
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    use aes::cipher::BlockEncryptMut;
    use std::io::Write;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"123456789","name":"Fixture robot","model":MODEL,"online":true,"roomId":"fixture","roomName":"fixture","icon":null,"specType":null,"unsupportedReason":null})).unwrap()
    }
    fn raw() -> Value {
        let values = [13, 0, 100, 1, 14, 1, 1, 0, 5123, 0, 0, 1, 0, -10];
        json!(PROPS
            .iter()
            .zip(values)
            .map(|((s, p), v)| json!({"siid":s,"piid":p,"code":0,"value":v}))
            .collect::<Vec<_>>())
    }
    fn map_source(w: i16, h: i16, cells: &[u8], extra: Value, seed: Option<&str>) -> String {
        let mut b = vec![0u8; 27];
        b[4] = 73;
        for (i, v) in [(17, 50i16), (19, w), (21, h)] {
            b[i..i + 2].copy_from_slice(&v.to_le_bytes());
        }
        b.extend(cells);
        b.extend(serde_json::to_vec(&extra).unwrap());
        let mut z = flate2::write::ZlibEncoder::new(Vec::new(), flate2::Compression::default());
        z.write_all(&b).unwrap();
        let compressed = z.finish().unwrap();
        if let Some(seed) = seed {
            let key = format!("{:x}", Sha256::digest(seed.as_bytes()));
            let encrypted = cbc::Encryptor::<aes::Aes256>::new_from_slices(
                &key.as_bytes()[..32],
                b"OFULk9To37qRdXY3",
            )
            .unwrap()
            .encrypt_padded_vec_mut::<Pkcs7>(&compressed);
            format!("{}\n,{seed}", STANDARD.encode(encrypted))
        } else {
            STANDARD.encode(compressed)
        }
    }
    #[test]
    fn exact_robot_route_and_read_snapshot_are_required() {
        let d = device();
        let r = parse(&d, &raw()).unwrap();
        assert_eq!((r.mode, r.suction, r.water), (3, 1, -10));
        assert!(r.in_station);
        for name in ["xiaomi.vacuum.d103", "dreame.vacuum.ma1808"] {
            let mut wrong = d.clone();
            wrong.model = name.into();
            assert!(parse(&wrong, &raw()).is_err());
        }
        let mut duplicate = raw();
        duplicate[1] = duplicate[0].clone();
        assert!(parse(&d, &duplicate).is_err());
        let mut denied = raw();
        denied[0]["code"] = json!(-704042011);
        assert!(parse(&d, &denied).is_err());
    }
    #[test]
    fn mode_write_preserves_other_clean_setting_bits() {
        let d = device();
        let r = parse(&d, &raw()).unwrap();
        for mode in 0..=3 {
            let (method, p) = command(&d, &r, &Change::Mode { value: mode }).unwrap();
            assert_eq!(method, "set_properties");
            assert_eq!(p[0]["siid"], 4);
            assert_eq!(p[0]["piid"], 23);
            assert_eq!(p[0]["value"].as_u64().unwrap() & !3, 5123 & !3);
            assert_eq!(p[0]["value"].as_u64().unwrap() & 3, mode as u64);
        }
    }
    #[test]
    fn inputs_and_state_gates_never_become_generic_rpc() {
        let d = device();
        let mut r = parse(&d, &raw()).unwrap();
        for c in [
            Change::Mode { value: 4 },
            Change::Suction { value: 4 },
            Change::Water { value: 0 },
            Change::Water { value: 16 },
            Change::Water { value: -4 },
            Change::Pause {},
            Change::Dock {},
        ] {
            assert!(command(&d, &r, &c).is_err());
        }
        r.mode = 2;
        assert!(command(&d, &r, &Change::Water { value: -10 }).is_err());
        r.mode = 1;
        assert!(command(&d, &r, &Change::Suction { value: 1 }).is_err());
        r.child_lock = true;
        assert!(command(&d, &r, &Change::Start {}).is_err());
        r.child_lock = false;
        r.in_station = false;
        r.work_mode = 15;
        assert_eq!(
            command(&d, &r, &Change::Dock {}).unwrap_err().kind,
            "unavailable"
        );
        assert!(serde_json::from_value::<Change>(json!({"operation":"factoryReset"})).is_err());
        assert!(serde_json::from_value::<Change>(json!({"operation":"start","siid":6})).is_err());
    }
    #[test]
    fn cleaning_locks_settings_but_retains_pause_and_dock() {
        let d = device();
        let mut r = parse(&d, &raw()).unwrap();
        for status in [1, 7, 12, 15, 23, 25, 13] {
            r.status = status;
            r.cleaning = status == 13;
            for c in [
                Change::Mode { value: 0 },
                Change::Suction { value: 3 },
                Change::Water { value: 12 },
            ] {
                assert_eq!(command(&d, &r, &c).unwrap_err().kind, "unavailable");
            }
        }
        r.cleaning = true;
        r.status = 1;
        r.in_station = false;
        assert!(command(&d, &r, &Change::Pause {}).is_ok());
        assert!(command(&d, &r, &Change::Dock {}).is_ok());
        r.cleaning = false;
        r.status = 3;
        assert!(command(&d, &r, &Change::Suction { value: 3 }).is_ok());
    }
    #[test]
    fn cleaning_and_dock_actions_match_original_siids() {
        let d = device();
        let mut r = parse(&d, &raw()).unwrap();
        let (_, p) = command(&d, &r, &Change::Start {}).unwrap();
        assert_eq!(p, json!({"did":"123456789","siid":2,"aiid":1,"in":[]}));
        r.cleaning = true;
        assert!(command(&d, &r, &Change::Start {}).is_err());
        let (_, p) = command(&d, &r, &Change::Pause {}).unwrap();
        assert_eq!(p["siid"], 2);
        assert_eq!(p["aiid"], 2);
        r.in_station = false;
        let (_, p) = command(&d, &r, &Change::Dock {}).unwrap();
        assert_eq!(p["siid"], 3);
        assert_eq!(p["aiid"], 1);
    }
    #[test]
    fn station_actions_are_explicit_and_never_issued_by_reads() {
        let d = device();
        let mut r = parse(&d, &raw()).unwrap();
        for (c, station, siid, aiid, input) in [
            (
                Change::Wash { on: true },
                0,
                4,
                4,
                json!([{"piid":10,"value":"2,1"}]),
            ),
            (Change::Wash { on: false }, 1, 4, 2, json!([])),
            (
                Change::Dry { on: true },
                0,
                4,
                4,
                json!([{"piid":10,"value":"3,1"}]),
            ),
            (
                Change::Dry { on: false },
                2,
                4,
                4,
                json!([{"piid":10,"value":"3,0"}]),
            ),
            (Change::Collect {}, 0, 15, 1, json!([])),
        ] {
            r.wash_station = station;
            let (_, p) = command(&d, &r, &c).unwrap();
            assert_eq!(p["siid"], siid);
            assert_eq!(p["aiid"], aiid);
            assert_eq!(p["in"], input);
        }
    }
    #[test]
    fn actual_binary_contract_decrypts_and_uses_embedded_saved_cells() {
        let saved = map_source(
            2,
            2,
            &[1, 129, 2, 2],
            json!({"seg_inf":{"1":{"type":4},"2":{"type":0,"name":STANDARD.encode("客厅".as_bytes())}}}),
            None,
        );
        let current = map_source(
            1,
            1,
            &[0],
            json!({"rism":saved,"mra":"90","robot":[25,25],"charger":[25,25]}),
            Some("synthetic-map-seed"),
        );
        let m = decode_map(&current).unwrap();
        assert_eq!((m.width, m.height, m.rotation), (2, 2, 90));
        assert_eq!(STANDARD.decode(&m.cells).unwrap(), [1, 255, 2, 2]);
        assert_eq!(m.rooms.len(), 2);
        assert!(m.rooms.iter().any(|r| r.name == "厨房"));
        assert!(m.rooms.iter().any(|r| r.name == "客厅"));
        assert!(m.robot.is_some() && m.dock.is_some());
        let public = serde_json::to_string(&m).unwrap();
        assert!(!public.contains("synthetic-map-seed") && !public.contains("rism"));
    }
    #[test]
    fn recorded_trace_preserves_relative_absolute_and_disconnected_strokes() {
        let points = decode_trace("S10,20L5,-6L-3,2S100,200l109,212").unwrap();
        let compact: Vec<_> = points.iter().map(|p| (p.x, p.y, p.is_line)).collect();
        assert_eq!(
            compact,
            vec![
                (10., 20., false),
                (15., 14., true),
                (12., 16., true),
                (100., 200., false),
                (109., 212., true)
            ]
        );
        assert!(decode_trace("").unwrap().is_empty());
        for input in [
            "L1,2",
            "S1",
            "S1,",
            "S1,2junk",
            "S1.5,2",
            "S999999999,1",
            "S1,2,L3,4",
            "S1,2L3,",
        ] {
            assert!(decode_trace(input).is_err(), "{input}");
        }
        assert!(decode_trace(&"S0,0".repeat(100_001)).is_err());
    }
    #[test]
    fn recorded_trace_uses_saved_origin_and_explicit_robot_connection() {
        let saved = map_source(
            2,
            2,
            &[1, 1, 1, 1],
            json!({"seg_inf":{},"origin":[100,200]}),
            None,
        );
        let source = map_source(
            1,
            1,
            &[0],
            json!({"rism":saved,"tr":"S100,200L50,0S1000000,1000000L-999850,-999750L0,50","robot":[150,300],"l2r":1}),
            None,
        );
        let map = decode_map(&source).unwrap();
        let compact: Vec<_> = map.path.iter().map(|p| (p.x, p.y, p.is_line)).collect();
        assert_eq!(
            compact,
            vec![
                (0.5, 0.5, false),
                (1.5, 0.5, true),
                (1.5, 1.5, false),
                (1.5, 2.5, true),
                (1.5, 2.5, true)
            ]
        );
        let empty = decode_map(&map_source(1, 1, &[1], json!({"robot":[25,25]}), None)).unwrap();
        assert!(
            empty.path.is_empty(),
            "robot samples must never invent a path"
        );
    }
    #[test]
    fn malformed_or_oversized_maps_and_untrusted_urls_fail_closed() {
        for s in ["", ",seed", "not-base64", "eA=="] {
            assert!(decode_map(s).is_err());
        }
        assert!(decode_map(&map_source(-1, 1, &[], json!({}), None)).is_err());
        assert!(decode_map(&map_source(2049, 1, &[], json!({}), None)).is_err());
        for u in [
            "https://127.0.0.1/map",
            "http://cnbj1.fds.api.xiaomi.com/map",
            "https://evil-fds.api.xiaomi.com/map",
            "https://cnbj1.fds.api.xiaomi.com.evil.test/map",
            "https://user@cnbj1.fds.api.xiaomi.com/map",
            "https://cnbj1.fds.api.xiaomi.com:8443/map",
        ] {
            assert!(safe_url(u).is_err(), "{u}");
        }
        assert!(safe_url("https://cnbj1.fds.api.xiaomi.com/map?signature=fixture").is_ok());
        for s in [
            "../file",
            "/private",
            "https://host/file",
            "a/../../file",
            "a?key",
        ] {
            assert!(!safe_object(s));
        }
    }
    #[test]
    fn baseline_binds_route_and_mutable_settings_but_excludes_map_refresh() {
        let d = device();
        let a = parse(&d, &raw()).unwrap();
        let mut changed = raw();
        changed[5]["value"] = json!(2);
        assert_ne!(a.baseline, parse(&d, &changed).unwrap().baseline);
        let mut other = d.clone();
        other.did = "987654321".into();
        assert_ne!(a.baseline, parse(&other, &raw()).unwrap().baseline);
    }
}
