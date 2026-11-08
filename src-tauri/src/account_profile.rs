//! APK kcg.OooOO0o: POST /home/profile {id}, Crypto.RC4.
//! qbg case 8 -> UserInfo.OooO00o: userid/userId, nickname, userName, icon.
use crate::{
    error::{AppError, Result},
    models::{epoch_secs, id, AccountProfile},
};
use serde_json::Value;

pub fn parse_profile(data: &Value, expected_user_id: &str) -> Result<AccountProfile> {
    let user_id = if data.get("userId").is_some() {
        id(&data["userId"])
    } else {
        id(&data["userid"])
    };
    if user_id != expected_user_id || user_id.is_empty() {
        return Err(AppError::protocol());
    }
    let display_name = data["nickname"]
        .as_str()
        .filter(|s| !s.trim().is_empty())
        .or_else(|| data["userName"].as_str())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| {
            s.chars()
                .filter(|c| !c.is_control())
                .take(100)
                .collect::<String>()
        })
        .filter(|s| !s.is_empty());
    let avatar_url = data["icon"].as_str().and_then(|s| {
        let mut url = url::Url::parse(s).ok()?;
        if url.scheme() != "https"
            || url.host_str().is_none()
            || !url.username().is_empty()
            || url.password().is_some()
        {
            return None;
        }
        url.set_fragment(None);
        Some(url.to_string())
    });
    if display_name.is_none() && avatar_url.is_none() {
        return Err(AppError::new(
            "profileUnavailable",
            "暂时无法读取小米账号资料。",
            true,
        ));
    }
    Ok(AccountProfile {
        display_name,
        avatar_url,
        fetched_at: epoch_secs(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn profile_is_bound_to_logged_in_account_and_uses_real_fields() {
        let data = json!({"userid":"123","nickname":"  昵称  ","userName":"unused","icon":"https://example.com/avatar.png","email":"never-returned"});
        let profile = parse_profile(&data, "123").unwrap();
        assert_eq!(profile.display_name.as_deref(), Some("昵称"));
        assert_eq!(
            profile.avatar_url.as_deref(),
            Some("https://example.com/avatar.png")
        );
        let serialized = serde_json::to_string(&profile).unwrap();
        assert!(!serialized.contains("email"));
        assert!(!serialized.contains("userid"));
        assert!(parse_profile(&data, "other-account").is_err());
        assert!(parse_profile(&json!({"nickname":"missing-identity"}), "123").is_err());
        assert_eq!(
            parse_profile(&json!({"userId":123,"userName":"fallback"}), "123")
                .unwrap()
                .display_name
                .as_deref(),
            Some("fallback")
        );
    }
    #[test]
    fn unsafe_urls_and_empty_profile_data_are_not_invented() {
        for url in [
            "http://example.com/a",
            "javascript:alert(1)",
            "https://secret@example.com/a",
        ] {
            let profile = parse_profile(
                &json!({"userid":"123","nickname":"真正\n的名字","icon":url}),
                "123",
            )
            .unwrap();
            assert_eq!(profile.display_name.as_deref(), Some("真正的名字"));
            assert!(profile.avatar_url.is_none());
        }
        assert!(parse_profile(&json!({"userid":"123"}), "123").is_err());
    }
}
