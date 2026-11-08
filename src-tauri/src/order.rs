//! APK union-order read schema. Saving/reordering is deliberately not exposed.
use crate::{
    error::{AppError, Result},
    models::{id, Home, HomeOrder},
};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};

pub fn request_data(home: &Home) -> Result<Value> {
    let owner = home
        .owner_id
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(AppError::protocol)?;
    let home_id = home
        .id
        .parse::<i64>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(AppError::protocol)?;
    Ok(
        json!({"owner_uid":owner,"home_id":[home_id],"platform":"android","source":"",
        "get_room_order":true,"get_front_order":true,"get_cate_order":true,
        "get_freq_camera_order":true,"get_default_camera_switch":true,"get_large_card_order":true,
        "get_front_order_v2":true,"get_module_order":true,"get_room_order_v2":true,
        "get_freq_camera_order_v2":true,"security_camera_order":true}),
    )
}

fn strings(value: &Value) -> Vec<String> {
    let mut seen = HashSet::new();
    value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .map(id)
        .filter(|s| !s.is_empty() && s != "-" && seen.insert(s.clone()))
        .collect()
}

fn rooms(value: &Value) -> Vec<(String, Vec<String>)> {
    let mut seen = HashSet::new();
    value
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or(&[])
        .iter()
        .filter_map(|room| {
            let room_id = id(&room["room_id"]);
            (!room_id.is_empty() && room_id != "-" && seen.insert(room_id.clone()))
                .then(|| (room_id, strings(&room["did_order"])))
        })
        .collect()
}

pub fn parse_order(result: &Value, home: &Home, device_ids: &HashSet<&str>) -> Result<HomeOrder> {
    let info = result["info"].as_array().ok_or_else(AppError::protocol)?;
    let record = info
        .iter()
        .find(|row| id(&row["home_id"]) == home.id)
        .ok_or_else(AppError::protocol)?;
    let legacy = rooms(&record["room_order"]);
    let mut current = rooms(&record["room_order_v2"]);
    // APK migration copies only room order when v2 has never held device order.
    if current.iter().all(|(_, devices)| devices.is_empty())
        && !current.iter().map(|r| &r.0).eq(legacy.iter().map(|r| &r.0))
    {
        current = legacy
            .iter()
            .map(|(room, _)| (room.clone(), vec![]))
            .collect();
    }
    let legacy_devices: HashMap<_, _> = legacy.into_iter().collect();
    let known_rooms: HashSet<_> = home.rooms.iter().map(|r| r.id.as_str()).collect();
    let mut room_ids = Vec::new();
    let mut room_devices = HashMap::new();
    for (room_id, dids) in current {
        if known_rooms.contains(room_id.as_str()) {
            // APK gu6.OooOo consumes legacy did_order for an empty/missing v2
            // room order; the earlier room-ID migration alone is insufficient.
            let dids = if dids.is_empty() {
                legacy_devices.get(&room_id).cloned().unwrap_or_default()
            } else {
                dids
            };
            room_ids.push(room_id.clone());
            room_devices.insert(
                room_id,
                dids.into_iter()
                    .filter(|did| device_ids.contains(did.as_str()))
                    .collect(),
            );
        }
    }
    let front_devices = strings(&record["front_order_v2"])
        .into_iter()
        .filter(|did| device_ids.contains(did.as_str()))
        .collect();
    Ok(HomeOrder {
        room_ids,
        room_devices,
        front_devices,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::Room;
    fn home() -> Home {
        Home {
            id: "12".into(),
            owner_id: "34".into(),
            name: "H".into(),
            shared: false,
            rooms: vec![
                Room {
                    id: "r1".into(),
                    name: "one".into(),
                },
                Room {
                    id: "r2".into(),
                    name: "two".into(),
                },
            ],
            room_devices: HashMap::new(),
        }
    }
    #[test]
    fn union_request_matches_apk_types_flags_and_signed_long_bounds() {
        let mut h = home();
        let data = request_data(&h).unwrap();
        assert_eq!(data["owner_uid"], 34);
        assert_eq!(data["home_id"], json!([12]));
        assert_eq!(data["security_camera_order"], true);
        assert!(data.get("get_security_camera_order").is_none());
        assert_eq!(data.as_object().unwrap().len(), 15);
        h.id = "9223372036854775808".into();
        assert!(request_data(&h).is_err());
    }
    #[test]
    fn v2_order_is_home_bound_deduplicated_and_cannot_add_unknown_devices() {
        let value = json!({"info":[{"home_id":"other","room_order_v2":[]},{"home_id":12,
            "room_order_v2":[{"room_id":"r2","did_order":["b","b","-","missing"]},{"room_id":"alien","did_order":["a"]},{"room_id":"r1","did_order":["a"]}],
            "front_order_v2":["b","aggregate-token","a","a"]}]});
        let order = parse_order(&value, &home(), &HashSet::from(["a", "b"])).unwrap();
        assert_eq!(order.room_ids, vec!["r2", "r1"]);
        assert_eq!(order.room_devices["r2"], vec!["b"]);
        assert_eq!(order.front_devices, vec!["b", "a"]);
        assert!(!order.room_devices.contains_key("alien"));
        assert!(parse_order(&json!({"info":[]}), &home(), &HashSet::new()).is_err());
    }
    #[test]
    fn unset_v2_migrates_room_ids_and_consumer_uses_legacy_device_order() {
        let value = json!({"info":[{"home_id":"12","room_order":[{"room_id":"r2","did_order":["b"]},{"room_id":"r1","did_order":["a"]}],"room_order_v2":[{"room_id":"r1","did_order":[]}]}]});
        let order = parse_order(&value, &home(), &HashSet::from(["a", "b"])).unwrap();
        assert_eq!(order.room_ids, vec!["r2", "r1"]);
        assert_eq!(order.room_devices["r2"], vec!["b"]);
        assert_eq!(order.room_devices["r1"], vec!["a"]);
        assert!(order.front_devices.is_empty());
    }
    #[test]
    fn empty_v2_room_falls_back_independently_of_other_populated_v2_rooms() {
        let value = json!({"info":[{"home_id":"12","room_order":[{"room_id":"r1","did_order":["a","b"]}],"room_order_v2":[{"room_id":"r2","did_order":["b"]},{"room_id":"r1","did_order":[]}]}]});
        let order = parse_order(&value, &home(), &HashSet::from(["a", "b"])).unwrap();
        assert_eq!(order.room_ids, vec!["r2", "r1"]);
        assert_eq!(order.room_devices["r1"], vec!["a", "b"]);
        assert_eq!(order.room_devices["r2"], vec!["b"]);
    }
}
