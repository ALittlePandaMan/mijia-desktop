//! Official model resources and standard-plugin eligibility. No vendor JS runs.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{Device, DevicePanel},
    ui_resource_cache::{CachedUiResource, UiResourceCache},
};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::sync::Arc;

const API_VERSION: u64 = 10119;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UiRoute {
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub plugin_id: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub standard_version: Option<u64>,
    pub reason: String,
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceUiResources {
    pub did: String,
    pub model: String,
    pub spec_type: Option<String>,
    pub instance: Value,
    pub i18n: Value,
    pub custom_config: Value,
    pub route: UiRoute,
    pub fetched_at: u64,
    pub cache_state: String,
    pub diagnostics: Vec<String>,
}
#[derive(Clone)]
pub(crate) struct UiResourceRepository {
    cache: UiResourceCache,
}
#[derive(Clone, Debug, PartialEq, Eq)]
struct Candidate {
    model: String,
    plugin_id: u64,
}

fn key(cloud: &Cloud, purpose: &str, model: &str, urn: &str) -> String {
    let mut sha = Sha256::new();
    for part in [
        "mijia-ui-resources-v1",
        &cloud.credentials.user_id,
        &cloud.credentials.region,
        purpose,
        model,
        urn,
    ] {
        sha.update(part.as_bytes());
        sha.update([0]);
    }
    format!("{:x}", sha.finalize())
}
fn identifier(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-' || b == b'_')
}
fn parsed_object(value: &Value) -> Result<Value> {
    let value = if let Some(text) = value.as_str() {
        if text.len() > 4 * 1024 * 1024 {
            return Err(AppError::protocol());
        }
        serde_json::from_str(text).map_err(|_| AppError::protocol())?
    } else {
        value.clone()
    };
    value
        .is_object()
        .then_some(value)
        .ok_or_else(AppError::protocol)
}
fn config_for(result: &Value, model: &str) -> Result<Value> {
    let rows = result["std_operate_infos"]
        .as_object()
        .ok_or_else(AppError::protocol)?;
    let Some(row) = rows.get(model) else {
        return Ok(Value::Null);
    };
    if row["model"].as_str() != Some(model)
        || !row.is_object()
        || row
            .get("standard_infos")
            .is_some_and(|v| !v.is_null() && !v.is_array())
    {
        return Err(AppError::protocol());
    }
    if row["standard_infos"]
        .as_array()
        .is_some_and(|v| v.len() > 256)
    {
        return Err(AppError::protocol());
    }
    Ok(row.clone())
}
fn translations_for(result: &Value, urn: &str) -> Result<Value> {
    let Some(entry) = result.get(urn) else {
        return Ok(Value::Null);
    };
    let data = &entry["data"];
    if data.is_null() {
        return Ok(Value::Null);
    }
    parsed_object(data)
}
fn candidates(result: &Value, urn: &str) -> Result<Vec<Candidate>> {
    let mapping = result["hookmodel"]
        .as_object()
        .filter(|map| map.len() <= 128)
        .ok_or_else(AppError::protocol)?;
    let default = result["default"].as_str().ok_or_else(AppError::protocol)?;
    let category = urn.split(':').nth(3).ok_or_else(AppError::protocol)?;
    let mut out = Vec::new();
    for name in [category, default] {
        let Some(raw) = mapping.get(name) else {
            continue;
        };
        let row = parsed_object(raw)?;
        let model = row["model"]
            .as_str()
            .filter(|v| identifier(v))
            .ok_or_else(AppError::protocol)?;
        if row["package"].as_str().is_none_or(|v| !identifier(v)) {
            return Err(AppError::protocol());
        }
        let plugin_id = row["pluginId"]
            .as_u64()
            .filter(|id| *id > 0)
            .ok_or_else(AppError::protocol)?;
        let candidate = Candidate {
            model: model.into(),
            plugin_id,
        };
        if !out.contains(&candidate) {
            out.push(candidate);
        }
    }
    Ok(out)
}
fn manifest_for(result: &Value, candidate: &Candidate) -> Result<Value> {
    let list = result["full_define_plugin_info"]
        .as_array()
        .ok_or_else(AppError::protocol)?;
    let matches: Vec<_> = list
        .iter()
        .filter(|row| row["model"].as_str() == Some(&candidate.model))
        .collect();
    if matches.is_empty() {
        return Ok(Value::Null);
    }
    if matches.len() != 1
        || matches[0]["plugin_id"].as_u64() != Some(candidate.plugin_id)
        || matches[0]["version"].as_u64().is_none_or(|v| v == 0)
    {
        return Err(AppError::protocol());
    }
    // Download URLs are vendor-runtime metadata, not needed by our renderer.
    // Persist only the identity/version used to select the model whitelist.
    Ok(
        json!({"model":candidate.model,"plugin_id":candidate.plugin_id,"version":matches[0]["version"]}),
    )
}
fn allowed(result: &Value, model: &str) -> Result<bool> {
    let list = result["model_list"]
        .as_array()
        .filter(|list| list.len() <= 200000)
        .ok_or_else(AppError::protocol)?;
    if list.iter().any(|v| v.as_str().is_none()) {
        return Err(AppError::protocol());
    }
    let blocked = result
        .get("black_list")
        .filter(|v| !v.is_null())
        .map(|v| v.as_array().ok_or_else(AppError::protocol))
        .transpose()?;
    if blocked.is_some_and(|list| list.len() > 200000 || list.iter().any(|v| v.as_str().is_none()))
    {
        return Err(AppError::protocol());
    }
    Ok(list.iter().any(|v| v.as_str() == Some(model))
        && !blocked.is_some_and(|list| list.iter().any(|v| v.as_str() == Some(model))))
}
fn support_for(result: &Value, id: u64, version: u64) -> Result<Value> {
    if result["plugin_id"].as_u64() != Some(id) || result["version"].as_u64() != Some(version) {
        return Err(AppError::protocol());
    }
    allowed(result, "")?;
    Ok(
        json!({"plugin_id":id,"version":version,"model_list":result["model_list"],"black_list":result["black_list"]}),
    )
}
fn unknown(reason: &str) -> UiRoute {
    UiRoute {
        kind: "unknown".into(),
        plugin_id: None,
        standard_version: None,
        reason: reason.into(),
    }
}

impl UiResourceRepository {
    pub fn new() -> Self {
        Self {
            cache: UiResourceCache::new(),
        }
    }
    async fn custom(
        &self,
        cloud: Arc<Cloud>,
        model: String,
        urn: String,
    ) -> Result<CachedUiResource> {
        self.cache.get(key(&cloud,"custom",&model,&urn),move||async move{
            let result=cloud.request("/v2/plugin/get_standard_operation",json!({"latest_req":{"api_version":API_VERSION,"app_platform":"Android","plugins":[{"model":model}],"package_type":"rn"}})).await?;
            config_for(&result,&model)
        }).await
    }
    pub(crate) async fn language(
        &self,
        cloud: Arc<Cloud>,
        urn: String,
    ) -> Result<CachedUiResource> {
        self.cache
            .get(key(&cloud, "i18n", "", &urn), move || async move {
                let result = cloud
                    .request(
                        "/appgateway/gspec/Gspec/spec_multi_language",
                        json!({"urns":[format!("{urn},0")]}),
                    )
                    .await?;
                translations_for(&result, &urn)
            })
            .await
    }
    async fn category(&self, cloud: Arc<Cloud>) -> Result<CachedUiResource> {
        self.cache
            .get(key(&cloud, "categories", "", ""), move || async move {
                let result = cloud
                    .request(
                        "/v2/plugin/category_standard_model",
                        json!({"api_version":API_VERSION,"app_platform":"Android"}),
                    )
                    .await?;
                if !result["hookmodel"].is_object() || !result["default"].is_string() {
                    return Err(AppError::protocol());
                }
                Ok(result)
            })
            .await
    }
    async fn candidate_route(
        &self,
        cloud: Arc<Cloud>,
        candidate: Candidate,
        model: String,
    ) -> Result<Option<(UiRoute, bool, u64)>> {
        let selected = candidate.clone();
        let remote = cloud.clone();
        let manifest=self.cache.get(key(&cloud,"plugin-manifest",&candidate.model,&candidate.plugin_id.to_string()),move||async move{
            let plugins=json!([{"model":selected.model}]);
            let result=remote.request("/v2/plugin/fetch_plugin",json!({"is_car_mihome":false,"latest_req":{"api_version":API_VERSION,"app_platform":"Android","region":remote.credentials.region.to_uppercase(),"plugins":plugins,"package_type":""},"backup_req":{"plugins":plugins,"api_level":111,"app_platform":"phone"}})).await?;
            manifest_for(&result,&selected)
        }).await?;
        if manifest.value.is_null() {
            return Ok(None);
        }
        let version = manifest.value["version"]
            .as_u64()
            .ok_or_else(AppError::protocol)?;
        let id = candidate.plugin_id;
        let remote = cloud.clone();
        let whitelist = self
            .cache
            .get(
                key(
                    &cloud,
                    "support-models",
                    &candidate.model,
                    &format!("{id}:{version}"),
                ),
                move || async move {
                    let result = remote
                        .request(
                            "/v2/plugin/get_support_models",
                            json!({"plugin_id":id,"version":version}),
                        )
                        .await?;
                    support_for(&result, id, version)
                },
            )
            .await?;
        if !allowed(&whitelist.value, &model)? {
            return Ok(None);
        }
        Ok(Some((UiRoute{kind:"standard".into(),plugin_id:Some(id),standard_version:Some(version),reason:"型号在官方标准插件支持名单中；桌面使用自有标准渲染器，不代表Android实际插件启动分支。".into()},manifest.stale||whitelist.stale,manifest.fetched_at.min(whitelist.fetched_at))))
    }
    pub async fn load(
        &self,
        cloud: Arc<Cloud>,
        device: &Device,
        panel: &DevicePanel,
        instance: Value,
    ) -> Result<DeviceUiResources> {
        let mut report = DeviceUiResources {
            did: device.did.clone(),
            model: device.model.clone(),
            spec_type: panel.spec_type.clone(),
            instance,
            i18n: Value::Null,
            custom_config: Value::Null,
            route: unknown("尚未确认官方标准插件支持名单，保留模型或专用适配器。"),
            fetched_at: 0,
            cache_state: "missing".into(),
            diagnostics: vec![],
        };
        let Some(urn) = panel
            .spec_type
            .clone()
            .filter(|urn| urn.starts_with("urn:miot-spec-v2:device:"))
        else {
            report
                .diagnostics
                .push("未提供可用的MIoT v2模型资源。".into());
            return Ok(report);
        };
        let (custom, language, category) = tokio::join!(
            self.custom(cloud.clone(), device.model.clone(), urn.clone()),
            self.language(cloud.clone(), urn.clone()),
            self.category(cloud.clone())
        );
        let mut stamps = Vec::new();
        let mut stale = false;
        for (purpose, result) in [("custom", custom), ("i18n", language)] {
            match result {
                Ok(entry) => {
                    stamps.push(entry.fetched_at);
                    stale |= entry.stale;
                    if purpose == "custom" {
                        report.custom_config = (*entry.value).clone()
                    } else {
                        report.i18n = (*entry.value).clone()
                    }
                }
                Err(error) if error.kind == "authExpired" => return Err(error),
                Err(error) => report.diagnostics.push(format!(
                    "{}元数据暂不可用（{}），原有设备控制仍可使用。",
                    if purpose == "custom" {
                        "定制布局"
                    } else {
                        "多语言"
                    },
                    error.kind
                )),
            }
        }
        match category {
            Ok(entry) => {
                stale |= entry.stale;
                stamps.push(entry.fetched_at);
                match candidates(&entry.value, &urn) {
                    Ok(list) => {
                        let mut jobs = tokio::task::JoinSet::new();
                        for (index, candidate) in list.into_iter().enumerate() {
                            let repo = self.clone();
                            let cloud = cloud.clone();
                            let model = device.model.clone();
                            jobs.spawn(async move {
                                (index, repo.candidate_route(cloud, candidate, model).await)
                            });
                        }
                        let mut found = Vec::new();
                        while let Some(result) = jobs.join_next().await {
                            match result {
                                Ok((index, Ok(Some(route)))) => found.push((index, route)),
                                Ok((_, Ok(None))) => {}
                                Ok((_, Err(error))) if error.kind == "authExpired" => {
                                    return Err(error)
                                }
                                Ok((_, Err(error))) => report
                                    .diagnostics
                                    .push(format!("标准插件名单暂不可用（{}）。", error.kind)),
                                Err(_) => {
                                    report.diagnostics.push("标准插件资源任务未完成。".into())
                                }
                            }
                        }
                        found.sort_by_key(|(index, _)| *index);
                        if let Some((_, (route, was_stale, at))) = found.into_iter().next() {
                            report.route = route;
                            stale |= was_stale;
                            stamps.push(at)
                        }
                    }
                    Err(_) => report.diagnostics.push("标准插件品类配置无法识别。".into()),
                }
            }
            Err(error) if error.kind == "authExpired" => return Err(error),
            Err(error) => report
                .diagnostics
                .push(format!("标准插件品类资源暂不可用（{}）。", error.kind)),
        }
        if !stamps.is_empty() {
            report.fetched_at = *stamps.iter().min().unwrap();
            report.cache_state = if stale { "stale" } else { "fresh" }.into();
        }
        Ok(report)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn model_config_requires_exact_identity_and_real_schema() {
        let valid = json!({"std_operate_infos":{"brand.switch":{"model":"brand.switch","standard_infos":[{"note":"home-setting","customizeFuncList":[]}]}}});
        assert_eq!(
            config_for(&valid, "brand.switch").unwrap()["model"],
            "brand.switch"
        );
        assert!(config_for(&valid, "other").unwrap().is_null());
        assert!(config_for(
            &json!({"std_operate_infos":{"brand.switch":{"model":"foreign"}}}),
            "brand.switch"
        )
        .is_err());
    }
    #[test]
    fn category_precedes_default_without_guessing_model_names() {
        let raw = json!({"default":"common","hookmodel":{"common":{"model":"miot.switch.spec","package":"miot.plugin.spec","pluginId":1006883},"washer":"{\"model\":\"miot.washer.spec\",\"package\":\"miot.washer.spec\",\"pluginId\":1032355}"}});
        let list = candidates(&raw, "urn:miot-spec-v2:device:washer:0000A00C:vendor:1").unwrap();
        assert_eq!(
            list.iter().map(|v| v.model.as_str()).collect::<Vec<_>>(),
            vec!["miot.washer.spec", "miot.switch.spec"]
        );
    }
    #[test]
    fn whitelist_is_positive_and_blacklist_wins() {
        assert!(allowed(&json!({"model_list":["a","b"]}), "a").unwrap());
        assert!(!allowed(&json!({"model_list":["a"],"black_list":["a"]}), "a").unwrap());
        assert!(!allowed(&json!({"model_list":[]}), "a").unwrap());
        assert!(allowed(&json!({"model_list":[1]}), "a").is_err());
        assert!(allowed(&json!({"model_list":["a"],"black_list":[1]}), "a").is_err());
        assert!(support_for(&json!({"plugin_id":2,"version":7,"model_list":["a"]}), 2, 8).is_err());
    }
    #[test]
    fn manifests_cannot_cross_model_or_plugin_identity() {
        let c = Candidate {
            model: "miot.switch.spec".into(),
            plugin_id: 1006883,
        };
        let r = json!({"full_define_plugin_info":[{"model":"miot.switch.spec","plugin_id":1006883,"version":500}]});
        assert_eq!(manifest_for(&r, &c).unwrap()["version"], 500);
        assert!(manifest_for(&r, &Candidate { plugin_id: 7, ..c }).is_err());
    }
    #[test]
    fn language_data_accepts_json_objects_never_executable_strings() {
        assert_eq!(
            translations_for(&json!({"urn":{"data":{"zh_cn":{"p":"开关"}}}}), "urn").unwrap()
                ["zh_cn"]["p"],
            "开关"
        );
        assert!(translations_for(&json!({"urn":{"data":"alert(1)"}}), "urn").is_err());
        assert!(translations_for(&json!({}), "urn").unwrap().is_null());
    }
}
