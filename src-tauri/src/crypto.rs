//! Xiaomi RC4-drop1024 transport. Protocol references and independent vectors:
//! docs/THIRD_PARTY_NOTICES.md. TLS is required; RC4 is protocol compatibility.
use crate::error::{AppError, Result};
use base64::{engine::general_purpose::STANDARD as B64, Engine};
use rand::RngCore;
use sha1::{Digest, Sha1};
use sha2::Sha256;
use std::collections::BTreeMap;
use zeroize::{Zeroize, Zeroizing};

/// APK XMPassport.getClientSign -> CloudCoder -> Coder.generateSignature.
pub fn sts_signature(nonce: i64, security: &str) -> String {
    let material = Zeroizing::new(format!("nonce={nonce}&{security}"));
    B64.encode(Sha1::digest(material.as_bytes()))
}

pub fn nonce(minute: u32, random: [u8; 8]) -> String {
    let mut bytes = random.to_vec();
    bytes.extend_from_slice(&minute.to_be_bytes());
    B64.encode(bytes)
}

pub fn random_nonce() -> String {
    let mut random = [0; 8];
    rand::rngs::OsRng.fill_bytes(&mut random);
    nonce((crate::models::epoch_secs() / 60) as u32, random)
}

pub fn signed_nonce(security: &str, nonce: &str) -> Result<Vec<u8>> {
    let mut bytes = Zeroizing::new(B64.decode(security).map_err(|_| AppError::auth())?);
    bytes.extend(B64.decode(nonce).map_err(|_| AppError::protocol())?);
    Ok(Sha256::digest(bytes.as_slice()).to_vec())
}

fn signature(method: &str, path: &str, key: &[u8], fields: &BTreeMap<String, String>) -> String {
    // APK ys2.OooO0O0 signs Uri.parse(relativePath).getEncodedPath(). All
    // callers use internal relative paths; query/fragment are never signed.
    let encoded_path = path.split(['?', '#']).next().unwrap_or(path);
    let mut parts = Zeroizing::new(vec![method.to_owned(), encoded_path.to_owned()]);
    parts.extend(fields.iter().map(|(k, v)| format!("{k}={v}")));
    parts.push(B64.encode(key));
    let material = Zeroizing::new(parts.join("&"));
    B64.encode(Sha1::digest(material.as_bytes()))
}

/// Each independent field and response starts from a fresh cipher and drops 1024 bytes.
pub fn rc4_drop(key: &[u8], data: &[u8]) -> Result<Vec<u8>> {
    Ok(Rc4Drop::new(key)?.apply(data))
}

struct Rc4Drop {
    s: [u8; 256],
    i: usize,
    j: usize,
}
impl Drop for Rc4Drop {
    fn drop(&mut self) {
        self.s.zeroize();
        self.i.zeroize();
        self.j.zeroize();
    }
}
impl Rc4Drop {
    fn new(key: &[u8]) -> Result<Self> {
        if key.is_empty() || key.len() > 256 {
            return Err(AppError::protocol());
        }
        let mut s = [0u8; 256];
        for (i, x) in s.iter_mut().enumerate() {
            *x = i as u8;
        }
        let mut j = 0usize;
        for i in 0..256 {
            j = (j + s[i] as usize + key[i % key.len()] as usize) & 255;
            s.swap(i, j);
        }
        let mut cipher = Self { s, i: 0, j: 0 };
        for _ in 0..1024 {
            cipher.next();
        }
        Ok(cipher)
    }
    fn next(&mut self) -> u8 {
        self.i = (self.i + 1) & 255;
        self.j = (self.j + self.s[self.i] as usize) & 255;
        self.s.swap(self.i, self.j);
        self.s[(self.s[self.i] as usize + self.s[self.j] as usize) & 255]
    }
    fn apply(&mut self, data: &[u8]) -> Vec<u8> {
        data.iter().map(|b| b ^ self.next()).collect()
    }
}

pub fn encrypt_request(
    path: &str,
    data: &str,
    security: &str,
    nonce: &str,
) -> Result<(BTreeMap<String, String>, Vec<u8>)> {
    encrypt_request_profile(path, data, security, nonce, false)
}

pub fn encrypt_request_profile(
    path: &str,
    data: &str,
    security: &str,
    nonce: &str,
    continuous: bool,
) -> Result<(BTreeMap<String, String>, Vec<u8>)> {
    encrypt_request_method_profile("POST", path, data, security, nonce, continuous)
}

pub fn encrypt_request_method_profile(
    method: &str,
    path: &str,
    data: &str,
    security: &str,
    nonce: &str,
    continuous: bool,
) -> Result<(BTreeMap<String, String>, Vec<u8>)> {
    encrypt_optional_request_method_profile(method, path, Some(data), security, nonce, continuous)
}

/// APK f7e.OooOO0o omits a null/empty data pair before both signatures. Washer
/// log standardCall has no second argument; its URL query remains unencrypted.
pub(crate) fn encrypt_optional_request_method_profile(
    method: &str,
    path: &str,
    data: Option<&str>,
    security: &str,
    nonce: &str,
    continuous: bool,
) -> Result<(BTreeMap<String, String>, Vec<u8>)> {
    if !matches!(method, "GET" | "POST") {
        return Err(AppError::protocol());
    }
    let key = signed_nonce(security, nonce)?;
    let mut fields = BTreeMap::new();
    if let Some(data) = data.filter(|v| !v.is_empty()) {
        fields.insert("data".into(), data.into());
    }
    fields.insert("rc4_hash__".into(), signature(method, path, &key, &fields));
    let mut cipher = Rc4Drop::new(&key)?;
    for value in fields.values_mut() {
        *value = B64.encode(if continuous {
            cipher.apply(value.as_bytes())
        } else {
            rc4_drop(&key, value.as_bytes())?
        });
    }
    fields.insert("signature".into(), signature(method, path, &key, &fields));
    fields.insert("ssecurity".into(), security.into());
    fields.insert("_nonce".into(), nonce.into());
    Ok((fields, key))
}

pub fn decrypt_response(key: &[u8], text: &str) -> Result<Vec<u8>> {
    rc4_drop(
        key,
        &B64.decode(text.trim()).map_err(|_| AppError::protocol())?,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn washer_post_query_and_absent_data_match_independent_java_uri_vector() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "fixtures/regression/protocol-washer-log-vector.json"
        ))
        .unwrap();
        let path = v["path"].as_str().unwrap();
        let security = v["ssecurity"].as_str().unwrap();
        let nonce = v["nonce"].as_str().unwrap();
        let (fields, key) =
            encrypt_optional_request_method_profile("POST", path, None, security, nonce, true)
                .unwrap();
        assert_eq!(B64.encode(key), v["signed_nonce"]);
        assert!(!fields.contains_key("data"));
        assert_eq!(fields.len(), 4);
        assert_eq!(fields["rc4_hash__"], v["encrypted_hash"]);
        assert_eq!(fields["signature"], v["signature"]);
        let (bare, _) = encrypt_optional_request_method_profile(
            "POST",
            v["encoded_path"].as_str().unwrap(),
            None,
            security,
            nonce,
            true,
        )
        .unwrap();
        assert_eq!(fields, bare);
        let (empty_json, _) = encrypt_optional_request_method_profile(
            "POST",
            path,
            Some("{}"),
            security,
            nonce,
            true,
        )
        .unwrap();
        assert_ne!(fields["signature"], empty_json["signature"]);
        let (get, _) =
            encrypt_optional_request_method_profile("GET", path, None, security, nonce, true)
                .unwrap();
        assert_ne!(fields["signature"], get["signature"]);
    }
    #[test]
    fn nonce_layout_is_eight_random_bytes_then_big_endian_minute() {
        assert_eq!(
            nonce(0x01020304, [0, 1, 2, 3, 4, 5, 6, 7]),
            "AAECAwQFBgcBAgME"
        );
    }
    #[test]
    fn get_signatures_match_independent_java_vector_and_do_not_reuse_post() {
        let v: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/regression/protocol-get-vector.json")).unwrap();
        let method = v["method"].as_str().unwrap();
        let path = v["path"].as_str().unwrap();
        let data = v["data"].as_str().unwrap();
        let security = v["ssecurity"].as_str().unwrap();
        let nonce = v["nonce"].as_str().unwrap();
        let (fields, key) =
            encrypt_request_method_profile(method, path, data, security, nonce, true).unwrap();
        assert_eq!(B64.encode(key), v["signed_nonce"]);
        assert_eq!(fields["data"], v["encrypted_data"]);
        assert_eq!(fields["rc4_hash__"], v["encrypted_hash_continuous"]);
        assert_eq!(fields["signature"], v["signature_continuous"]);
        let (post, _) = encrypt_request_profile(path, data, security, nonce, true).unwrap();
        assert_ne!(fields["signature"], post["signature"]);
        assert!(
            encrypt_request_method_profile("DELETE", path, data, security, nonce, true).is_err()
        );
    }
    #[test]
    fn rfc6229_rc4_drop1024_vector() {
        // RFC 6229 key 0x0102030405, stream offset 1024.
        assert_eq!(
            rc4_drop(&[1, 2, 3, 4, 5], &[0; 16]).unwrap(),
            [
                0x30, 0xab, 0xbc, 0xc7, 0xc2, 0x0b, 0x01, 0x60, 0x9f, 0x23, 0xee, 0x2d, 0x5f, 0x6b,
                0xb7, 0xdf
            ]
        );
    }
    #[test]
    fn empty_rc4_key_is_rejected() {
        assert!(rc4_drop(&[], b"a").is_err());
    }
    #[test]
    fn xiaomi_envelope_matches_independent_openssl_vectors() {
        let vectors: serde_json::Value =
            serde_json::from_str(include_str!("fixtures/regression/protocol-vectors.json")).unwrap();
        let security = vectors["ssecurity_base64"].as_str().unwrap();
        let nonce = vectors["nonce_base64"].as_str().unwrap();
        let key = signed_nonce(security, nonce).unwrap();
        assert_eq!(B64.encode(&key), vectors["signed_nonce_base64"]);
        for vector in vectors["vectors"].as_array().unwrap() {
            let (fields, _) = encrypt_request(
                vector["signature_path"].as_str().unwrap(),
                vector["data"].as_str().unwrap(),
                security,
                nonce,
            )
            .unwrap();
            assert_eq!(fields["data"], vector["encrypted_data_base64"]);
            assert_eq!(fields["rc4_hash__"], vector["encrypted_rc4_hash_base64"]);
            assert_eq!(fields["signature"], vector["final_signature_base64"]);
        }
        assert_eq!(
            String::from_utf8(
                decrypt_response(
                    &key,
                    vectors["response_ciphertext_base64"].as_str().unwrap()
                )
                .unwrap()
            )
            .unwrap(),
            vectors["response_plaintext"]
        );
    }
    #[test]
    fn apk_119623_continuous_cipher_matches_independent_java_vector() {
        let v: serde_json::Value = serde_json::from_str(include_str!(
            "fixtures/regression/protocol-continuous-vector.json"
        ))
        .unwrap();
        let (fields, key) = encrypt_request_profile(
            v["path"].as_str().unwrap(),
            v["data"].as_str().unwrap(),
            v["ssecurity"].as_str().unwrap(),
            v["nonce"].as_str().unwrap(),
            true,
        )
        .unwrap();
        assert_eq!(B64.encode(key), v["signed_nonce"]);
        assert_eq!(fields["data"], v["encrypted_data"]);
        assert_eq!(fields["rc4_hash__"], v["encrypted_hash_continuous"]);
        assert_eq!(fields["signature"], v["signature_continuous"]);
    }
}
