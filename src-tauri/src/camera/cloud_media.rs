//! Authenticated cloud event assets. Store identifiers and signed URLs stay native.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
};
use aes::cipher::{block_padding::Pkcs7, BlockDecryptMut, KeyIvInit};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use serde_json::json;
const MAX_VIDEO: usize = 48 * 1024 * 1024;
#[derive(Serialize)]
pub struct Video {
    pub data: String,
    pub duration: f64,
}
pub(crate) fn asset_url(
    region: &str,
    service: &str,
    device: &Device,
    text: &str,
    key: bool,
) -> Result<url::Url> {
    let url = url::Url::parse(text).map_err(|_| AppError::protocol())?;
    let host = if service == "mijia" {
        "app.processor.smartcamera.api.mijia.tech".to_owned()
    } else if region == "cn" {
        "app.processor.smartcamera.api.io.mi.com".to_owned()
    } else {
        format!("{region}.app.processor.smartcamera.api.io.mi.com")
    };
    if url.scheme() != "https"
        || url.host_str() != Some(&host)
        || url.port().is_some()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.fragment().is_some()
        || url.path()
            != if key {
                "/common/app/play/v1/key"
            } else {
                "/common/app/play/v1/video"
            }
        || url
            .query_pairs()
            .find(|(k, _)| k == "did")
            .map(|(_, v)| v.to_string())
            .as_deref()
            != Some(device.control_did())
    {
        return Err(AppError::protocol());
    }
    Ok(url)
}
struct Manifest {
    key: String,
    iv: [u8; 16],
    segments: Vec<String>,
    duration: f64,
}
fn manifest(bytes: &[u8]) -> Result<Manifest> {
    let text = std::str::from_utf8(bytes).map_err(|_| AppError::protocol())?;
    if !text.starts_with("#EXTM3U") || !text.lines().any(|l| l.trim() == "#EXT-X-ENDLIST") {
        return Err(AppError::protocol());
    }
    let mut key = None;
    let mut iv = None;
    let mut segments = Vec::new();
    let mut duration = 0.;
    for line in text.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("#EXT-X-KEY:") {
            if key.is_some() || !rest.starts_with("METHOD=AES-128,") {
                return Err(AppError::protocol());
            }
            let key_start = rest.find("URI=\"").ok_or_else(AppError::protocol)? + 5;
            let end = rest[key_start..].find('"').ok_or_else(AppError::protocol)? + key_start;
            key = Some(rest[key_start..end].to_owned());
            let hex = rest
                .split(',')
                .find_map(|v| v.strip_prefix("IV=0x"))
                .filter(|v| v.len() == 32)
                .ok_or_else(AppError::protocol)?;
            let mut value = [0; 16];
            for (i, b) in value.iter_mut().enumerate() {
                *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16)
                    .map_err(|_| AppError::protocol())?;
            }
            iv = Some(value);
        } else if let Some(rest) = line.strip_prefix("#EXTINF:") {
            duration += rest
                .trim_end_matches(',')
                .parse::<f64>()
                .map_err(|_| AppError::protocol())?;
        } else if !line.is_empty() && !line.starts_with('#') {
            segments.push(line.to_owned());
        }
    }
    if segments.is_empty()
        || segments.len() > 100
        || !duration.is_finite()
        || duration <= 0.
        || duration > 600.
    {
        return Err(AppError::protocol());
    }
    Ok(Manifest {
        key: key.ok_or_else(AppError::protocol)?,
        iv: iv.ok_or_else(AppError::protocol)?,
        segments,
        duration,
    })
}
pub async fn video(cloud: &Cloud, device: &Device, date: &str, id: &str) -> Result<Video> {
    let manifest = manifest(&playlist(cloud, device, date, id).await?)?;
    // Validate the complete response before requesting any signed resource.
    asset_url(
        &cloud.credentials.region,
        &cloud.credentials.service_id,
        device,
        &manifest.key,
        true,
    )?;
    for segment in &manifest.segments {
        asset_url(
            &cloud.credentials.region,
            &cloud.credentials.service_id,
            device,
            segment,
            false,
        )?;
    }
    let key = cloud
        .camera_cloud_segment(device, &manifest.key, true)
        .await?;
    if key.len() != 16 {
        return Err(AppError::new(
            "cloudVideoKey",
            "云端录像暂时无法取得播放密钥。",
            true,
        ));
    }
    let mut segments = Vec::new();
    let mut total = 0usize;
    for segment in manifest.segments {
        let encrypted = cloud.camera_cloud_segment(device, &segment, false).await?;
        let plain = cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, &manifest.iv)
            .map_err(|_| AppError::protocol())?
            .decrypt_padded_vec_mut::<Pkcs7>(&encrypted)
            .map_err(|_| {
                AppError::new("cloudVideoDecrypt", "云端录像暂时无法解密，请重试。", true)
            })?;
        if plain.len() < 16
            || plain[4..8] != *b"ftyp"
            || total.saturating_add(plain.len()) > MAX_VIDEO
        {
            return Err(AppError::new(
                "cloudVideoFormat",
                "此云录像的媒体格式暂时无法播放。",
                true,
            ));
        }
        total += plain.len();
        segments.push(plain);
    }
    let data = super::cloud_mp4::join(segments)?;
    Ok(Video {
        data: STANDARD.encode(data),
        duration: manifest.duration,
    })
}

pub async fn playlist(cloud: &Cloud, device: &Device, date: &str, id: &str) -> Result<Vec<u8>> {
    let record = super::events::record(cloud, device, date, id).await?;
    let file = record
        .file
        .ok_or_else(|| AppError::invalid("此事件没有可播放的云录像。"))?;
    cloud.camera_cloud_file(device,"/common/app/m3u8",json!({"did":device.control_did(),"model":device.model,"fileId":file,"isAlarm":true,"videoCodec":"H265"}),1024*1024).await
}
pub async fn thumbnail(cloud: &Cloud, device: &Device, date: &str, id: &str) -> Result<Vec<u8>> {
    use rand::RngCore;
    let record = super::events::record(cloud, device, date, id).await?;
    let image = record
        .image
        .ok_or_else(|| AppError::invalid("此事件没有缩略图。"))?;
    let mut iv = [0; 16];
    rand::rngs::OsRng.fill_bytes(&mut iv);
    let encrypted=cloud.camera_cloud_file(device,"/common/app/v1/img",json!({"did":device.control_did(),"stoId":image,"region":cloud.credentials.region.to_uppercase(),"segmentIv":STANDARD.encode(iv)}),2*1024*1024).await?;
    let key = STANDARD
        .decode(&cloud.credentials.security)
        .map_err(|_| AppError::protocol())?;
    cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, &iv)
        .map_err(|_| AppError::protocol())?
        .decrypt_padded_vec_mut::<Pkcs7>(&encrypted)
        .map_err(|_| AppError::protocol())
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn thumbnail_decryption_matches_independent_android_compatible_vector() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "../fixtures/regression/protocol-cloud-thumbnail-vector.json"
        ))
        .unwrap();
        let decode = |field: &str| STANDARD.decode(v[field].as_str().unwrap()).unwrap();
        let key = decode("securityBase64");
        let iv = decode("segmentIvBase64");
        let encrypted = decode("ciphertextBase64");
        let plain = cbc::Decryptor::<aes::Aes128>::new_from_slices(&key, &iv)
            .unwrap()
            .decrypt_padded_vec_mut::<Pkcs7>(&encrypted)
            .unwrap();
        assert_eq!(plain, decode("plaintextBase64"));
    }
    #[test]
    fn closed_manifest() {
        let good=b"#EXTM3U\n#EXT-X-KEY:METHOD=AES-128,URI=\"https://example.invalid/key\",IV=0x00112233445566778899AABBCCDDEEFF\n#EXTINF:3.0\nhttps://example.invalid/segment\n#EXT-X-ENDLIST";
        let parsed = manifest(good).unwrap();
        assert_eq!(parsed.duration, 3.);
        assert_eq!(parsed.iv[15], 255);
        assert_eq!(parsed.segments.len(), 1);
        for bad in [
            "#EXTM3U\n",
            "#EXTM3U\n#EXT-X-ENDLIST",
            "#EXTM3U\n#EXT-X-KEY:METHOD=NONE\n#EXTINF:3\nsegment\n#EXT-X-ENDLIST",
        ] {
            assert!(manifest(bad.as_bytes()).is_err());
        }
        let huge = String::from_utf8(good.to_vec())
            .unwrap()
            .replace("#EXTINF:3.0", "#EXTINF:601");
        assert!(manifest(huge.as_bytes()).is_err());
    }
    #[test]
    fn media_urls_cannot_escape_device_or_processor() {
        let device:Device=serde_json::from_value(json!({"did":"fixture-device","name":"camera","model":"chuangmi.camera.81ac1","online":true,"roomId":"","roomName":""})).unwrap();
        let good="https://app.processor.smartcamera.api.mijia.tech/common/app/play/v1/key?did=fixture-device&keyInfo=fixture&yetAnotherServiceToken=fixture";
        assert!(asset_url("cn", "mijia", &device, good, true).is_ok());
        for bad in [
            good.replace("https:", "http:"),
            good.replace(
                "app.processor.smartcamera.api.mijia.tech",
                "example.invalid",
            ),
            good.replace("did=fixture-device", "did=another"),
            good.replace("/key?", "/video?"),
            good.replace("https://", "https://user:pass@"),
            good.replace(".tech/", ".tech:444/"),
        ] {
            assert!(asset_url("cn", "mijia", &device, &bad, true).is_err());
        }
    }
}
