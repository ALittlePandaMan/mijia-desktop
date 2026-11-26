//! Home-level, user-triggered scenes. No automation editing or condition toggles.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{id, Home},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::{HashSet, VecDeque};

pub const LIST_PATH: &str = "/appgateway/miot/appsceneservice/AppSceneService/GetSceneList";
pub const RUN_PATH: &str = "/appgateway/miot/appsceneservice/AppSceneService/NewRunScene";
pub fn is_path(path: &str) -> bool {
    matches!(path, LIST_PATH | RUN_PATH)
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Scene {
    pub id: String,
    pub name: String,
    pub room_ids: Vec<String>,
    pub icon: Option<String>,
    pub common: bool,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub home_id: String,
    pub generation: u64,
    pub scenes: Vec<Scene>,
}

// Only authenticated cloud room assignments are used. An action can control
// another room; deriving its display room from action targets would be wrong.
pub fn parse(value: &Value, home: &Home) -> Result<Vec<Scene>> {
    if value.is_null() {
        return Ok(vec![]);
    }
    let rows = value
        .get("scene_info_list")
        .and_then(Value::as_array)
        .ok_or_else(AppError::protocol)?;
    if rows.len() > 10000 {
        return Err(AppError::protocol());
    }
    let rooms: HashSet<_> = home.rooms.iter().map(|r| r.id.as_str()).collect();
    let mut seen = HashSet::new();
    let mut scenes = Vec::new();
    for row in rows {
        if id(&row["home_id"]) != home.id || row["enable"].as_bool() != Some(true) {
            continue;
        }
        if !row
            .pointer("/scene_trigger/triggers")
            .and_then(Value::as_array)
            .is_some_and(|triggers| {
                triggers
                    .iter()
                    .any(|t| t["src"] == "user" && t["key"] == "user.click")
            })
        {
            continue;
        }
        let scene_id = id(&row["scene_id"]);
        let name = row["name"].as_str().unwrap_or("").trim();
        if scene_id.is_empty()
            || scene_id.len() > 160
            || name.is_empty()
            || !seen.insert(scene_id.clone())
        {
            continue;
        }
        let mut room_ids = Vec::new();
        if let Some(values) = row["common_used_roomIds"].as_array() {
            for value in values {
                let room = id(value);
                if rooms.contains(room.as_str()) && !room_ids.contains(&room) {
                    room_ids.push(room);
                }
            }
        }
        let room = id(&row["room_id"]);
        if rooms.contains(room.as_str()) && !room_ids.contains(&room) {
            room_ids.push(room);
        }
        let icon = row["icon_url"]
            .as_str()
            .filter(|url| {
                url::Url::parse(url).ok().is_some_and(|u| {
                    u.scheme() == "https"
                        && u.username().is_empty()
                        && u.password().is_none()
                        && u.port().is_none()
                        && u.host_str().is_some_and(|h| {
                            h == "fds.api.xiaomi.com" || h.ends_with(".fds.api.xiaomi.com")
                        })
                })
            })
            .map(str::to_owned);
        scenes.push(Scene {
            id: scene_id,
            name: name.chars().take(160).collect(),
            room_ids,
            icon,
            common: row["common_use"].as_bool() == Some(true),
        });
    }
    scenes.sort_by_key(|s| !s.common);
    Ok(scenes)
}
pub async fn load(cloud: &Cloud, home: &Home) -> Result<Vec<Scene>> {
    let home_id = home
        .id
        .parse::<u64>()
        .map_err(|_| AppError::invalid("家庭信息无效，请重新选择家庭。"))?;
    parse(
        &cloud.request(LIST_PATH, json!({"home_id":home_id})).await?,
        home,
    )
}
pub fn run_params(home: &Home, scenes: &[Scene], scene_id: &str) -> Result<Value> {
    if !scenes.iter().any(|scene| scene.id == scene_id) {
        return Err(AppError::new(
            "sceneUnavailable",
            "此任务已被移除或不可执行，请刷新后重试。",
            false,
        ));
    }
    Ok(
        json!({"scene_id":scene_id,"scene_type":2,"trigger_key":"user.click","home_id":home.id,"owner_uid":home.owner_id}),
    )
}
pub fn take_request(records: &mut VecDeque<String>, request_id: &str) -> Result<()> {
    if request_id.len() != 36
        || !request_id
            .bytes()
            .all(|b| b.is_ascii_hexdigit() || b == b'-')
    {
        return Err(AppError::invalid("执行请求无效。"));
    }
    if records.iter().any(|id| id == request_id) {
        return Err(AppError::new(
            "duplicateRequest",
            "此执行请求已经发送。",
            false,
        ));
    }
    records.push_back(request_id.into());
    while records.len() > 128 {
        records.pop_front();
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn home() -> Home {
        serde_json::from_value(json!({"id":"12","name":"家","ownerId":"34","rooms":[{"id":"r","name":"客厅"}],"shared":false})).unwrap()
    }
    fn manual() -> Value {
        json!({"home_id":"12","scene_id":"a","name":"回家","enable":true,"type":0,"room_id":"r","common_used_roomIds":["unknown","r"],"scene_trigger":{"triggers":[{"src":"user","key":"user.click"}]}})
    }
    #[test]
    fn excludes_automatic_disabled_foreign_and_duplicates() {
        let good = manual();
        let mut auto = good.clone();
        auto["scene_id"] = json!("auto");
        auto["scene_trigger"]["triggers"][0]["src"] = json!("timer");
        let mut disabled = good.clone();
        disabled["enable"] = json!(false);
        let mut foreign = good.clone();
        foreign["home_id"] = json!("99");
        let rows = parse(
            &json!({"scene_info_list":[good.clone(),auto,disabled,foreign,good]}),
            &home(),
        )
        .unwrap();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].room_ids, vec!["r"]);
        assert!(run_params(&home(), &rows, "auto").is_err());
        let params = run_params(&home(), &rows, "a").unwrap();
        assert_eq!(params["scene_type"], 2);
        assert_eq!(params["trigger_key"], "user.click");
    }
    #[test]
    fn absent_and_malformed_lists_differ() {
        assert!(parse(&Value::Null, &home()).unwrap().is_empty());
        assert!(parse(&json!({}), &home()).is_err());
    }
    #[test]
    fn request_is_consumed_before_dispatch() {
        let mut q = VecDeque::new();
        let id = "12345678-1234-1234-1234-123456789abc";
        assert!(take_request(&mut q, id).is_ok());
        assert!(take_request(&mut q, id).is_err());
        assert!(take_request(&mut q, "arbitrary").is_err());
    }
}
