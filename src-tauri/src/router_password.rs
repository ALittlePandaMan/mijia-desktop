//! rn02 module 10805: local disclosure and Wi-Fi connection QR, read-only.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router,
};
use serde::Serialize;
use serde_json::{json, Value};
use zeroize::Zeroize;

// Secrets never have Debug implementations or disk storage.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    pub label: String,
    pub ssid: String,
    pub password: String,
}
impl Drop for Row {
    fn drop(&mut self) {
        self.ssid.zeroize();
        self.password.zeroize();
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub rows: Vec<Row>,
    pub qr: Option<String>,
}
impl Drop for Report {
    fn drop(&mut self) {
        self.qr.zeroize();
    }
}
fn bit(v: &Value) -> Option<bool> {
    match v
        .as_i64()
        .or_else(|| v.as_str().and_then(|s| s.parse().ok()))
    {
        Some(0) => Some(false),
        Some(1) => Some(true),
        _ => v.as_bool(),
    }
}
fn escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if ['\\', ';', ',', '"', ':'].contains(&c) {
            out.push('\\');
        }
        out.push(c);
    }
    if !s.is_empty() && s.len() % 2 == 0 && s.bytes().all(|c| c.is_ascii_hexdigit()) {
        format!("\"{out}\"")
    } else {
        out
    }
}
fn parse(device: &Device, raw: &Value, routers: &Value) -> Result<Report> {
    let id = router::gateway_id(device)?;
    let info = raw["info"]
        .as_array()
        .filter(|a| (1..=3).contains(&a.len()))
        .ok_or_else(AppError::protocol)?;
    let caps = &routers["deviceList"]
        .as_array()
        .and_then(|a| a.iter().find(|r| r["id"].as_str() == Some(id)))
        .ok_or_else(AppError::protocol)?["capabilities"];
    if !caps.is_object() {
        return Err(AppError::protocol());
    }
    let merged = bit(&raw["bsd"]).ok_or_else(AppError::protocol)?;
    let six = bit(&caps["isSupport6g"]) == Some(true);
    let third =
        six || bit(&caps["tri_band"]) == Some(true) || bit(&raw["dwb_status"]) == Some(true);
    let mut rows = Vec::new();
    for (i, item) in info.iter().enumerate() {
        if i == 1 && merged || i == 2 && !third {
            continue;
        }
        let label = match i {
            0 if merged && six => "2.4GHz/5GHz Wi-Fi名称",
            0 if merged => "Wi-Fi名称",
            0 => "2.4GHz Wi-Fi",
            1 => "5GHz Wi-Fi",
            _ if six => "6GHz Wi-Fi",
            _ if bit(&caps["tri_band"]) == Some(true) => "5GHz Game Wi-Fi",
            _ => "5GHz-2 Wi-Fi",
        };
        rows.push(Row {
            label: label.into(),
            ssid: crate::router_wifi::text(item, "ssid")?,
            password: if item["password"].is_null() {
                String::new()
            } else {
                crate::router_wifi::text(item, "password")?
            },
        });
    }
    let base = info.get(1).unwrap_or(&info[0]);
    let qr_item = if six
        && info.len() == 3
        && bit(&info[0]["status"]) == Some(false)
        && bit(&info[1]["status"]) == Some(false)
        && bit(&info[2]["status"]) == Some(true)
    {
        &info[2]
    } else {
        base
    };
    let encryption = qr_item["encryption"]
        .as_str()
        .ok_or_else(AppError::protocol)?;
    // Original hides the button for SAE and literal nopass. Unknown modes never
    // produce an open-network code. Normal open/OWE modes follow its nopass mapping.
    let visible = !matches!(base["encryption"].as_str(), Some("ccmp" | "nopass"));
    let kind = match encryption {
        "ccmp" => Some("SAE"),
        "psk2" | "mixed-psk" | "psk2+ccmp" => Some("WPA"),
        "none" | "owe" => Some("nopass"),
        _ => None,
    };
    let qr = if let Some(kind) = kind.filter(|_| visible) {
        let ssid = crate::router_wifi::text(qr_item, "ssid")?;
        let password = if qr_item["password"].is_null() {
            String::new()
        } else {
            crate::router_wifi::text(qr_item, "password")?
        };
        let hidden = bit(&qr_item["hidden"]).unwrap_or(false);
        if ssid.is_empty() {
            None
        } else {
            Some(format!(
                "WIFI:T:{kind};P:{};S:{};H:{hidden};;",
                escape(&password),
                escape(&ssid)
            ))
        }
    } else {
        None
    };
    Ok(Report {
        did: device.did.clone(),
        model: device.model.clone(),
        rows,
        qr,
    })
}

pub async fn read(cloud: &Cloud, device: &Device) -> Result<Report> {
    let id = router::gateway_id(device)?;
    if !device.online {
        return Err(AppError::new("offline", "路由器已离线。", false));
    }
    let (wifi, routers) = tokio::join!(
        cloud.request_router_read(
            router::WIFI,
            json!({"method":"GET","params":{"deviceId":id}})
        ),
        cloud.request_router_read(
            router::ROUTERS,
            json!({"method":"GET","params":{"deviceId":id}})
        )
    );
    parse(device, &wifi?, &routers?)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Device, Value, Value) {
        let mut device: Device = serde_json::from_value(json!({"did":"fixture","model":router::MODEL,"online":true,"name":"router","roomId":"r","roomName":"r"})).unwrap();
        device.partner_id = Some("fixture-route".into());
        let band = json!({"status":1,"ssid":"fixture","password":"fixture-pass","encryption":"psk2","hidden":false});
        (
            device,
            json!({"bsd":0,"info":[band.clone(),band]}),
            json!({"deviceList":[{"id":"fixture-route","capabilities":{}}]}),
        )
    }
    #[test]
    fn separate_and_merged_bands_follow_the_plugin() {
        let (d, mut raw, routers) = fixture();
        raw["info"][1]["ssid"] = json!("a;b:中");
        raw["info"][1]["password"] = json!("pass\\word");
        let result = parse(&d, &raw, &routers).unwrap();
        assert_eq!(result.rows.len(), 2);
        assert_eq!(
            result.qr.as_deref(),
            Some("WIFI:T:WPA;P:pass\\\\word;S:a\\;b\\:中;H:false;;")
        );
        raw["bsd"] = json!(true);
        let result = parse(&d, &raw, &routers).unwrap();
        assert_eq!(result.rows.len(), 1);
        assert_eq!(result.rows[0].label, "Wi-Fi名称");
    }
    #[test]
    fn ambiguous_hex_is_quoted_and_unknown_security_has_no_qr() {
        let (d, mut raw, routers) = fixture();
        raw["info"][1]["ssid"] = json!("AABB");
        raw["info"][1]["password"] = json!("ABCD");
        let result = parse(&d, &raw, &routers).unwrap();
        assert_eq!(
            result.qr.as_deref(),
            Some("WIFI:T:WPA;P:\"ABCD\";S:\"AABB\";H:false;;")
        );
        raw["info"][1]["encryption"] = json!("unknown");
        assert!(parse(&d, &raw, &routers).unwrap().qr.is_none());
        raw["info"][1]["encryption"] = json!("ccmp");
        assert!(parse(&d, &raw, &routers).unwrap().qr.is_none());
    }
    #[test]
    fn six_ghz_fallback_and_context_identity_are_checked() {
        let (d, mut raw, mut routers) = fixture();
        raw["info"][0]["status"] = json!(0);
        raw["info"][1]["status"] = json!(0);
        raw["info"].as_array_mut().unwrap().push(json!({"status":1,"ssid":"six","password":"fixture-pass","encryption":"psk2","hidden":1}));
        routers["deviceList"][0]["capabilities"]["isSupport6g"] = json!(1);
        let result = parse(&d, &raw, &routers).unwrap();
        assert_eq!(result.rows.len(), 3);
        assert!(result.qr.as_deref().unwrap().contains("S:six;H:true"));
        routers["deviceList"][0]["id"] = json!("other-router");
        assert!(parse(&d, &raw, &routers).is_err());
    }
}
