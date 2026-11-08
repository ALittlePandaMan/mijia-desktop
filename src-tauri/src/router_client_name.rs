//! rn02 plugin 11162: rename a network client; no network permission changes.
use crate::{
    error::{AppError, Result},
    models::Device,
    router::{self, RouterClient},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub mac: String,
    pub expected: String,
    pub name: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Outcome {
    pub status: String,
    pub message: String,
    pub client: Option<RouterClient>,
}
pub fn valid_mac(mac: &str) -> bool {
    mac.len() == 17
        && mac.bytes().enumerate().all(|(i, b)| {
            if i % 3 == 2 {
                b == b':'
            } else {
                b.is_ascii_hexdigit()
            }
        })
}
pub fn valid_name(name: &str) -> bool {
    !name.trim().is_empty()
        && name.encode_utf16().count() <= 24
        && !name.chars().any(char::is_control)
}
pub fn select<'a>(items: &'a [RouterClient], mac: &str) -> Option<&'a RouterClient> {
    if !valid_mac(mac) {
        return None;
    }
    let mut matched = items.iter().filter(|c| c.mac.eq_ignore_ascii_case(mac));
    let item = matched.next()?;
    if matched.next().is_some() {
        return None;
    }
    Some(item)
}
pub fn payload(device: &Device, items: &[RouterClient], change: &Change) -> Result<Option<Value>> {
    if !valid_mac(&change.mac)
        || !valid_name(&change.name)
        || change.expected.len() > 512
        || change.expected.chars().any(char::is_control)
    {
        return Err(AppError::invalid("设备名称或设备标识无效。"));
    }
    let item = select(items, &change.mac)
        .ok_or_else(|| AppError::invalid("设备已不在路由器的设备列表中。"))?;
    if item.name != change.expected {
        return Err(AppError::new(
            "conflict",
            "设备名称已改变，请返回后重新打开。",
            false,
        ));
    }
    if item.name == change.name {
        return Ok(None);
    }
    Ok(Some(
        json!({"method":"POST","params":{"deviceId":router::gateway_id(device)?,"mac":item.mac,"nickname":change.name}}),
    ))
}
#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    fn fixture() -> (Device, RouterClient) {
        let mut d:Device=serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        d.partner_id = Some("fixture-router".into());
        let c = RouterClient {
            mac: "AA:BB:CC:DD:EE:FF".into(),
            name: "fixture".into(),
            ip: None,
            icon: None,
            online: Some(true),
            connection: Some(1),
            download_bps: Some(0),
            upload_bps: Some(0),
            event_time: None,
            blocked: false,
            signal: None,
            wifi_protocol: None,
            port: None,
            port_speed: None,
            tx_rate: None,
            rx_rate: None,
            classification: None,
            user_specified: false,
            miot_classification: None,
        };
        (d, c)
    }
    #[test]
    fn exact_payload_and_noop() {
        let (d, c) = fixture();
        let change = Change {
            mac: c.mac.clone(),
            expected: c.name.clone(),
            name: "客厅设备".into(),
        };
        let p = payload(&d, std::slice::from_ref(&c), &change)
            .unwrap()
            .unwrap();
        assert_eq!(
            p,
            json!({"method":"POST","params":{"deviceId":"fixture-router","mac":"AA:BB:CC:DD:EE:FF","nickname":"客厅设备"}})
        );
        let no = Change {
            name: c.name.clone(),
            ..change
        };
        assert!(payload(&d, &[c], &no).unwrap().is_none());
    }
    #[test]
    fn reject_wrong_identity_bad_name_and_concurrent_change() {
        let (d, c) = fixture();
        let change = Change {
            mac: c.mac.clone(),
            expected: c.name.clone(),
            name: "x".into(),
        };
        assert!(payload(
            &d,
            std::slice::from_ref(&c),
            &Change {
                expected: "other".into(),
                ..change.clone()
            }
        )
        .is_err());
        assert!(payload(
            &d,
            std::slice::from_ref(&c),
            &Change {
                mac: "aa\nname".into(),
                ..change.clone()
            }
        )
        .is_err());
        assert!(payload(
            &d,
            std::slice::from_ref(&c),
            &Change {
                name: " ".into(),
                ..change.clone()
            }
        )
        .is_err());
        assert!(payload(&d, &[c.clone(), c], &change).is_err());
        assert!(valid_name(&"😀".repeat(12)));
        assert!(!valid_name(&"😀".repeat(13)));
    }
}
