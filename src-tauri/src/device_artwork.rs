//! Mi Home's built-in replacement icons, selected per device by subclass_id.
use crate::{
    cloud::custom_artwork_url,
    error::{AppError, Result},
    models::Device,
};
use serde_json::Value;
use std::collections::HashMap;

// APK kk3.OooOO0O reads this catalog with an empty object. Changing a device's
// selection is a different endpoint and is deliberately not implemented here.
pub(crate) const CATALOG_PATH: &str = "/v2/device/switch_subclass";

#[derive(Default)]
pub(crate) struct Catalog {
    pub next_read: u64,
    pub icons: HashMap<u32, String>,
}

pub(crate) fn selected_id(value: &Value) -> Option<u32> {
    let number = value.as_u64().or_else(|| {
        let text = value.as_str()?;
        (!text.is_empty() && text.len() <= 10 && text.bytes().all(|c| c.is_ascii_digit()))
            .then(|| text.parse::<u64>().ok())
            .flatten()
    })?;
    u32::try_from(number).ok().filter(|id| *id > 0)
}

pub(crate) fn parse_catalog(value: &Value) -> Result<HashMap<u32, String>> {
    let rows = value
        .as_array()
        .filter(|rows| rows.len() <= 10_000)
        .ok_or_else(AppError::protocol)?;
    let mut icons = HashMap::new();
    for row in rows {
        let Some(id) = selected_id(&row["id"]) else {
            continue;
        };
        let Some(url) = row["proxy_category_icon"]
            .as_str()
            .and_then(custom_artwork_url)
        else {
            continue;
        };
        if icons.insert(id, url).is_some() {
            return Err(AppError::protocol());
        }
    }
    Ok(icons)
}

pub(crate) fn apply_catalog(
    devices: &mut [Device],
    selections: &HashMap<String, u32>,
    icons: &HashMap<u32, String>,
) {
    for device in devices {
        // A directly uploaded cover remains first. Never infer a selection from
        // model/name: two instances of the same outlet can have different icons.
        if device.custom_icon.is_some() {
            continue;
        }
        if let Some(url) = selections.get(&device.did).and_then(|id| icons.get(id)) {
            device.custom_icon = Some(url.clone());
            device.icon = Some(url.clone());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn device(did: &str, custom: Option<&str>) -> Device {
        serde_json::from_value(json!({"did":did,"name":"same name","model":"same.plug.v1","online":true,"roomId":"r","roomName":"room","icon":"https://example.com/default.png","customIcon":custom})).unwrap()
    }
    #[test]
    fn accepts_numeric_and_string_selections_but_not_urls_or_default_zero() {
        assert_eq!(selected_id(&json!(26)), Some(26));
        assert_eq!(selected_id(&json!("53")), Some(53));
        for value in [
            json!(0),
            json!("0"),
            json!(-1),
            json!(2.5),
            json!(true),
            json!(null),
            json!(" 26"),
            json!("4294967296"),
            json!("https://example.com/custom.png"),
        ] {
            assert_eq!(selected_id(&value), None);
        }
    }
    #[test]
    fn resolves_exact_per_device_choices_without_overwriting_uploaded_covers() {
        let icons = parse_catalog(&json!([
            {"id":26,"proxy_category_icon":"https://example.com/computer.png?signature=kept"},
            {"id":53,"proxy_category_icon":"http://cdn.cnbj1.fds.api.mi-img.com/projector.png?signature=kept"}
        ])).unwrap();
        let mut devices = vec![
            device("a", None),
            device("b", None),
            device("upload", Some("https://example.com/upload.png")),
            device("unknown", None),
            device("default", None),
        ];
        let selections = HashMap::from([
            ("a".into(), 26),
            ("b".into(), 53),
            ("upload".into(), 26),
            ("unknown".into(), 999),
        ]);
        apply_catalog(&mut devices, &selections, &icons);
        assert_eq!(
            devices[0].custom_icon.as_deref(),
            Some("https://example.com/computer.png?signature=kept")
        );
        assert_eq!(
            devices[1].custom_icon.as_deref(),
            Some("http://cdn.cnbj1.fds.api.mi-img.com/projector.png?signature=kept")
        );
        assert_eq!(devices[0].icon, devices[0].custom_icon);
        assert_eq!(
            devices[2].custom_icon.as_deref(),
            Some("https://example.com/upload.png")
        );
        assert!(devices[3].custom_icon.is_none());
        assert!(devices[4].custom_icon.is_none());
    }
    #[test]
    fn ignores_unusable_images_and_rejects_ambiguous_catalog_ids() {
        let icons = parse_catalog(&json!([
            {"id":1,"proxy_category_icon":"javascript:alert(1)"},
            {"id":2,"proxy_category_icon":"http://unrelated.example/image.png"},
            {"id":3,"proxy_category_icon":"https://user:secret@example.com/image.png"},
            {"id":4,"proxy_category_icon":"//cdn.fds.api.xiaomi.com/image.png"}
        ]))
        .unwrap();
        assert_eq!(icons.len(), 1);
        assert_eq!(icons[&4], "https://cdn.fds.api.xiaomi.com/image.png");
        assert!(parse_catalog(&json!({"list":[]})).is_err());
        assert!(parse_catalog(&json!([{"id":26,"proxy_category_icon":"https://example.com/a.png"},{"id":26,"proxy_category_icon":"https://example.com/b.png"}])).is_err());
    }
    #[test]
    fn switching_or_clearing_a_choice_does_not_reuse_the_previous_device_binding() {
        let icons = HashMap::from([
            (26, "https://example.com/computer.png".into()),
            (53, "https://example.com/projector.png".into()),
        ]);
        for (selected, expected) in [
            (Some(26), Some("https://example.com/computer.png")),
            (Some(53), Some("https://example.com/projector.png")),
            (None, None),
        ] {
            let mut devices = vec![device("a", None)];
            let selections = selected
                .map(|id| HashMap::from([("a".into(), id)]))
                .unwrap_or_default();
            apply_catalog(&mut devices, &selections, &icons);
            assert_eq!(devices[0].custom_icon.as_deref(), expected);
        }
    }
}
