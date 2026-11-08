//! Protocol families recovered from original plugins; shared with front-end routing.
use serde::Deserialize;
use std::sync::OnceLock;
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Sd {
    pub family: String,
    pub array_playback: bool,
    pub channels: Vec<u32>,
    pub index_bytes: usize,
    pub index_declared: u32,
    pub models: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Doorbell {
    pub endpoint: String,
    pub free_retention_days: Option<u16>,
    pub models: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaTalk {
    pub codec: String,
    pub sample_rate: u32,
}
#[derive(Deserialize)]
pub struct MediaQuality {
    pub id: String,
    pub label: String,
    pub value: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MediaLens {
    pub id: u8,
    pub label: String,
    pub ptz: bool,
    pub quality_field: String,
    #[allow(dead_code)]
    pub default_quality: u8,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Media {
    pub models: Vec<String>,
    pub family: String,
    pub talk: Option<MediaTalk>,
    pub ptz: bool,
    pub care: bool,
    pub qualities: Vec<MediaQuality>,
    pub minimum_firmware: Option<String>,
    #[serde(default)]
    pub lenses: Vec<MediaLens>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Profiles {
    sd: Vec<Sd>,
    media: Vec<Media>,
    cloud_doorbells: Vec<Doorbell>,
}
fn registry() -> &'static Profiles {
    static DATA: OnceLock<Profiles> = OnceLock::new();
    DATA.get_or_init(|| {
        serde_json::from_str(include_str!("../../../src/camera-profiles.json"))
            .expect("checked camera protocol profiles")
    })
}
pub fn sd(model: &str) -> Option<&'static Sd> {
    registry().sd.iter().find(|p| {
        matches!(p.family.as_str(), "standard" | "hualai") && p.models.iter().any(|m| m == model)
    })
}
pub fn doorbell(model: &str) -> Option<&'static Doorbell> {
    registry()
        .cloud_doorbells
        .iter()
        .find(|p| p.models.iter().any(|m| m == model))
}
pub fn media(model: &str) -> Option<&'static Media> {
    registry().media.iter().find(|p| {
        p.family == "miss" && p.minimum_firmware.is_none() && p.models.iter().any(|m| m == model)
    })
}
pub fn lenses(model: &str) -> &'static [MediaLens] {
    media(model).map_or(&[], |p| p.lenses.as_slice())
}
pub fn quality_body(model: &str, quality: u8) -> serde_json::Value {
    let mut body = serde_json::json!({"videoquality":quality});
    for lens in lenses(model) {
        // Only fields recovered from the original dual layout are accepted.
        if matches!(
            lens.quality_field.as_str(),
            "videoquality" | "videoquality2"
        ) {
            body[lens.quality_field.as_str()] = serde_json::json!(quality);
        }
    }
    body
}
pub fn care(model: &str) -> bool {
    registry()
        .media
        .iter()
        .any(|p| p.family == "miss" && p.care && p.models.iter().any(|m| m == model))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn profiles_are_disjoint_bounded_and_use_only_inspected_routes() {
        let mut models = std::collections::HashSet::new();
        for p in &registry().sd {
            assert!(matches!(p.family.as_str(), "standard" | "hualai"));
            assert!(p.channels == [0] || p.channels == [0, 10]);
            for m in &p.models {
                assert!(models.insert(m));
                assert!(doorbell(m).is_none());
            }
        }
        for p in &registry().cloud_doorbells {
            assert!(matches!(
                p.endpoint.as_str(),
                "/common/app/get/eventlist" | "/common/app/get/cloudlist"
            ));
            for m in &p.models {
                assert!(models.insert(m));
                assert!(sd(m).is_none());
            }
        }
        assert!(sd("unverified.camera.fixture").is_none());
        assert!(doorbell("linp.doorbell.g04").is_none());
    }
}
