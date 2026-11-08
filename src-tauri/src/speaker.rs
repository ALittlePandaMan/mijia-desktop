//! Player metadata and output controls, bound to the original plugin family.
use crate::models::Device;
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::epoch_secs,
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
pub fn supported(device: &Device) -> bool {
    device.split_route.is_none()
        && matches!(
            device.model.as_str(),
            "xiaomi.wifispeaker.s12" | "xiaomi.wifispeaker.l05c" | "xiaomi.wifispeaker.lx06"
        )
}
#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum Change {
    Volume { value: u8 },
    Previous,
    Next,
}
/// Original plugin 10112: output volume and player controls, independently of
/// microphone privacy. In particular, zero is sent without a MIoT minimum clamp.
pub fn command(change: &Change) -> Result<(&'static str, Value)> {
    match change {
        Change::Volume { value } if *value <= 100 => {
            Ok(("player_set_volume", json!({"volume":value})))
        }
        Change::Previous => Ok(("player_play_operation", json!({"action":"prev"}))),
        Change::Next => Ok(("player_play_operation", json!({"action":"next"}))),
        _ => Err(AppError::invalid("音量需在0至100之间。")),
    }
}
pub fn accepted(value: &Value) -> Result<()> {
    let response = decode(value)?;
    match response["code"].as_i64() {
        Some(0) => Ok(()),
        Some(_) => Err(AppError::new(
            "unavailable",
            "音箱拒绝了播放器操作。",
            false,
        )),
        None => Err(AppError::protocol()),
    }
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Player {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub status: Option<u8>,
    pub has_song: bool,
    pub title: Option<String>,
    pub artist: Option<String>,
    pub cover: Option<String>,
    pub position: Option<f64>,
    pub duration: Option<f64>,
    pub volume: Option<f64>,
}
fn decode(value: &Value) -> Result<Value> {
    match value {
        Value::String(s) if s.len() <= 262144 => {
            serde_json::from_str(s).map_err(|_| AppError::protocol())
        }
        Value::Object(_) => Ok(value.clone()),
        _ => Err(AppError::protocol()),
    }
}
fn text(value: &Value) -> Option<String> {
    value
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty() && s.chars().count() <= 512)
        .map(str::to_owned)
}
pub fn parse(device: &Device, value: &Value) -> Result<Player> {
    let envelope = decode(value)?;
    if envelope["code"] != 0 {
        return Err(AppError::new(
            "unavailable",
            "音箱未返回有效播放状态。",
            true,
        ));
    }
    if envelope.get("info").is_none() {
        return Err(AppError::new(
            "unavailable",
            "音箱暂未返回播放详情，请稍后重试。",
            true,
        ));
    }
    let info = decode(&envelope["info"])?;
    let status = info["status"]
        .as_u64()
        .filter(|v| *v <= 2)
        .ok_or_else(AppError::protocol)? as u8;
    let detail = &info["play_song_detail"];
    let has_song = status != 0
        && (text(&detail["title"]).is_some()
            || text(&detail["audio_id"]).is_some()
            || text(&detail["global_id"]).is_some());
    let cover = text(&detail["cover"]).filter(|s| {
        reqwest::Url::parse(s).ok().is_some_and(|u| {
            u.scheme() == "https" && u.username().is_empty() && u.password().is_none()
        })
    });
    let nonnegative = |v: &Value| v.as_f64().filter(|n| n.is_finite() && *n >= 0.0);
    Ok(Player {
        did: device.did.clone(),
        model: device.model.clone(),
        fetched_at: epoch_secs(),
        status: Some(status),
        has_song,
        title: has_song.then(|| text(&detail["title"])).flatten(),
        artist: has_song.then(|| text(&detail["artist"])).flatten(),
        cover: has_song.then_some(cover).flatten(),
        position: nonnegative(&detail["position"]),
        duration: nonnegative(&detail["duration"]),
        volume: nonnegative(&info["volume"]).filter(|v| *v <= 100.0),
    })
}
pub async fn load(cloud: &Cloud, device: &Device) -> Result<Player> {
    if !supported(device) {
        return Err(AppError::invalid("此音箱未接入播放器协议。"));
    }
    // Some idle l05c firmware returns only {code:0}. Volume is an independent
    // readable setting; absence of track metadata must not erase that setting.
    let (player, settings) = tokio::join!(
        tokio::time::timeout(
            std::time::Duration::from_secs(5),
            cloud.speaker_player_status(device)
        ),
        cloud.read(vec![json!({"did":device.control_did(),"siid":2,"piid":1})])
    );
    let player = player
        .map_err(|_| AppError::new("network", "播放详情读取超时。", true))
        .and_then(|v| v)
        .and_then(|v| parse(device, &v));
    let volume = settings
        .ok()
        .and_then(|rows| volume_readback(device, &rows));
    merge_volume(device, player, volume)
}
fn volume_readback(device: &Device, rows: &[Value]) -> Option<f64> {
    rows.iter()
        .find(|r| {
            r["did"] == device.control_did() && r["siid"] == 2 && r["piid"] == 1 && r["code"] == 0
        })
        .and_then(|r| r["value"].as_f64())
        .filter(|v| v.is_finite() && *v >= 0.0 && *v <= 100.0 && v.fract() == 0.0)
}
fn merge_volume(device: &Device, player: Result<Player>, volume: Option<f64>) -> Result<Player> {
    match player {
        Ok(mut p) => {
            if p.volume.is_none() {
                p.volume = volume;
            }
            Ok(p)
        }
        Err(_) if volume.is_some() => Ok(Player {
            did: device.did.clone(),
            model: device.model.clone(),
            fetched_at: epoch_secs(),
            status: None,
            has_song: false,
            title: None,
            artist: None,
            cover: None,
            position: None,
            duration: None,
            volume,
        }),
        Err(e) => Err(e),
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn device() -> Device {
        serde_json::from_value(json!({"did":"fixture","model":"xiaomi.wifispeaker.l05c","name":"音箱","online":true,"roomId":"r","roomName":"房间"})).unwrap()
    }
    #[test]
    fn player_commands_keep_zero_and_never_target_microphone() {
        assert_eq!(
            command(&Change::Volume { value: 0 }).unwrap(),
            ("player_set_volume", json!({"volume":0}))
        );
        assert_eq!(
            command(&Change::Previous).unwrap(),
            ("player_play_operation", json!({"action":"prev"}))
        );
        assert_eq!(
            command(&Change::Next).unwrap(),
            ("player_play_operation", json!({"action":"next"}))
        );
        assert!(command(&Change::Volume { value: 101 }).is_err());
        assert!(
            serde_json::from_value::<Change>(json!({"operation":"volume","value":-1})).is_err()
        );
        assert!(serde_json::from_value::<Change>(
            json!({"operation":"volume","value":0,"path":"microphone"})
        )
        .is_err());
    }
    #[test]
    fn only_explicit_success_is_an_accepted_command() {
        assert!(accepted(&json!({"code":0})).is_ok());
        assert!(accepted(&json!("{\"code\":0}")).is_ok());
        assert_eq!(
            accepted(&json!({"code":-1})).unwrap_err().kind,
            "unavailable"
        );
        assert!(accepted(&json!({"result":"ok"})).is_err());
    }
    #[test]
    fn nested_legacy_status_retains_paused_track_without_inventing_metadata() {
        let p=parse(&device(),&json!(json!({"code":0,"info":json!({"status":2,"volume":30,"play_song_detail":{"audio_id":"532694288404582","position":0,"duration":255512}}).to_string()}).to_string())).unwrap();
        assert!(p.has_song);
        assert_eq!(p.status, Some(2));
        assert_eq!(p.title, None);
        assert_eq!(p.position, Some(0.0))
    }
    #[test]
    fn stopped_stale_song_is_empty_and_sensitive_cover_urls_are_rejected() {
        let p=parse(&device(),&json!({"code":0,"info":{"status":0,"play_song_detail":{"title":"old","cover":"https://user:secret@example.org/a.png"}}})).unwrap();
        assert!(!p.has_song);
        assert!(p.title.is_none() && p.cover.is_none())
    }
    #[test]
    fn failures_and_unknown_status_are_not_idle() {
        for raw in [
            json!("bad"),
            json!({"code":1}),
            json!({"code":0,"info":{"status":4}}),
            json!({"code":0,"info":{}}),
        ] {
            assert!(parse(&device(), &raw).is_err())
        }
    }
    #[test]
    fn missing_metadata_preserves_verified_volume_without_inventing_player_status() {
        let d = device();
        let rows = vec![json!({"did":d.did,"siid":2,"piid":1,"code":0,"value":30})];
        let v = volume_readback(&d, &rows);
        assert_eq!(v, Some(30.0));
        let p = merge_volume(&d, parse(&d, &json!({"code":0})), v).unwrap();
        assert_eq!(p.volume, Some(30.0));
        assert_eq!(p.status, None);
        assert!(!p.has_song);
        assert!(merge_volume(&d, parse(&d, &json!({"code":0})), None).is_err());
        for row in [
            json!({"did":"other","siid":2,"piid":1,"code":0,"value":30}),
            json!({"did":d.did,"siid":4,"piid":1,"code":0,"value":30}),
            json!({"did":d.did,"siid":2,"piid":1,"code":-1,"value":30}),
            json!({"did":d.did,"siid":2,"piid":1,"code":0,"value":101}),
        ] {
            assert_eq!(volume_readback(&d, &[row]), None);
        }
    }
}
