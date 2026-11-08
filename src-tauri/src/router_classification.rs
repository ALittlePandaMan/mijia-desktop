//! rn02 modules 11192/10619: authenticated catalogue, dependent choices and readback.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::Device,
    router::{self, RouterClient},
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, HashSet};

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Selection {
    pub product: String,
    pub company: String,
    pub model: String,
}
#[derive(Clone, Debug, Serialize)]
pub struct Entry {
    pub product: String,
    pub company: String,
    pub model: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Catalog {
    pub entries: Vec<Entry>,
    pub names: BTreeMap<String, String>,
    pub revision: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Field {
    Product,
    Company,
    Model,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Change {
    pub mac: String,
    pub baseline: String,
    pub field: Field,
    pub value: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Report {
    pub did: String,
    pub model: String,
    pub mac: String,
    pub selection: Selection,
    pub labels: Selection,
    pub summary: String,
    pub revision: String,
    pub model_enabled: bool,
    pub write_reason: Option<String>,
    pub catalog: Catalog,
}
#[derive(Serialize)]
pub struct Read {
    pub report: Report,
    pub pending: Option<Change>,
}
#[derive(Serialize)]
pub struct Outcome {
    pub status: String,
    pub message: String,
    pub report: Option<Report>,
}
#[derive(Clone)]
pub(crate) struct Pending {
    pub change: Change,
    pub target: Selection,
    pub name: String,
}

fn key(s: &str) -> bool {
    s.len() <= 256 && !s.chars().any(char::is_control)
}
fn text(v: &Value) -> Option<String> {
    v.as_str().filter(|s| key(s)).map(str::to_owned)
}
pub fn selection(row: &Value) -> Option<Selection> {
    let prefix = if row["userSpecified"].as_bool()? {
        "userSpecify"
    } else {
        ""
    };
    let get = |field: &str| {
        if prefix.is_empty() {
            text(&row[field])
        } else {
            let mut c = field.chars();
            text(&row[format!("{prefix}{}{}", c.next()?.to_ascii_uppercase(), c.as_str())])
        }
    };
    Some(Selection {
        product: get("product")?,
        company: get("company")?,
        model: get("model")?,
    })
}
pub fn miot_selection(row: &Value) -> Option<Selection> {
    let v = row.get("miotData")?.as_object()?;
    Some(Selection {
        product: v.get("product").and_then(text).unwrap_or_default(),
        company: v.get("company").and_then(text).unwrap_or_default(),
        model: v.get("model").and_then(text).unwrap_or_default(),
    })
}
pub fn allowed_config_url(value: &str) -> bool {
    url::Url::parse(value).is_ok_and(|u| {
        u.scheme() == "https"
            && u.host_str() == Some("cdn.cnbj1.fds.api.mi-img.com")
            && u.port_or_known_default() == Some(443)
            && u.username().is_empty()
            && u.password().is_none()
            && u.fragment().is_none()
    })
}
pub fn parse_catalog(source: &str) -> Result<Catalog> {
    if source.len() > 4_000_000 {
        return Err(AppError::protocol());
    }
    let source = source.trim_start_matches('\u{feff}').replace("\r\n", "\n");
    let (rows, terms) = source
        .split_once("[term_table]\n")
        .ok_or_else(AppError::protocol)?;
    if !rows.starts_with("[display_config]\n") {
        return Err(AppError::protocol());
    }
    let mut names = BTreeMap::new();
    for line in terms.lines().filter(|s| !s.is_empty()) {
        let (id, label) = line.split_once('\t').ok_or_else(AppError::protocol)?;
        if !key(id)
            || id.is_empty()
            || label.is_empty()
            || label.len() > 512
            || label.chars().any(char::is_control)
            || names.len() >= 20000
        {
            return Err(AppError::protocol());
        }
        if names.insert(id.into(), label.into()).is_some() {
            return Err(AppError::protocol());
        }
    }
    if !names.contains_key("default") {
        return Err(AppError::protocol());
    }
    let mut entries = vec![];
    let mut seen = HashSet::new();
    for line in rows.lines().skip(1).filter(|s| !s.is_empty()) {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() < 6 || !fields[1..=3].iter().all(|s| key(s)) {
            return Err(AppError::protocol());
        }
        let ids = (fields[2], fields[1], fields[3]);
        if seen.insert(ids) {
            entries.push(Entry {
                product: ids.0.into(),
                company: ids.1.into(),
                model: ids.2.into(),
            });
        }
        if entries.len() > 20000 {
            return Err(AppError::protocol());
        }
    }
    if entries.is_empty() {
        return Err(AppError::protocol());
    }
    let revision = format!("{:x}", Sha256::digest(source.as_bytes()));
    Ok(Catalog {
        entries,
        names,
        revision,
    })
}
pub async fn fetch_catalog(cloud: &Cloud) -> Result<Catalog> {
    let config = cloud
        .request_router_read(
            router::CLIENT_DISPLAY_CONFIG,
            json!({"method":"GET","params":{"locale":"zh_CN","ts":0}}),
        )
        .await?;
    let uri = config["data"]["data_url"]
        .as_str()
        .filter(|s| allowed_config_url(s))
        .ok_or_else(AppError::protocol)?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(8))
        .timeout(std::time::Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::none())
        .build()
        .map_err(AppError::network)?;
    let mut response = client.get(uri).send().await.map_err(AppError::network)?;
    if !response.status().is_success() || response.content_length().is_some_and(|n| n > 4_000_000) {
        return Err(AppError::protocol());
    }
    let mut bytes = vec![];
    while let Some(chunk) = response.chunk().await.map_err(AppError::network)? {
        if bytes.len() + chunk.len() > 4_000_000 {
            return Err(AppError::protocol());
        }
        bytes.extend_from_slice(&chunk);
    }
    parse_catalog(std::str::from_utf8(&bytes).map_err(|_| AppError::protocol())?)
}
fn selected<'a>(items: &'a [RouterClient], mac: &str) -> Result<&'a RouterClient> {
    crate::router_client_name::select(items, mac)
        .ok_or_else(|| AppError::invalid("设备已不在路由器列表中。"))
}
impl Catalog {
    pub fn options(&self, field: Field, s: &Selection) -> Vec<String> {
        let mut ids = vec![];
        for r in &self.entries {
            let id = match field {
                Field::Product => Some(&r.product),
                Field::Company if (s.product == r.product || s.product == "default") => {
                    Some(&r.company)
                }
                Field::Model if s.product == r.product && s.company == r.company => Some(&r.model),
                _ => None,
            };
            if let Some(id) = id.filter(|id| !id.is_empty() && self.names.contains_key(id.as_str()))
            {
                if !ids.contains(id) {
                    ids.push(id.clone());
                }
            }
        }
        if !ids.iter().any(|s| s == "default") {
            ids.push("default".into());
        }
        ids
    }
}
pub fn report(
    device: &Device,
    items: &[RouterClient],
    mac: &str,
    catalog: &Catalog,
) -> Result<Report> {
    let c = selected(items, mac)?;
    let selection = c
        .classification
        .clone()
        .ok_or_else(|| AppError::new("unsupported", "设备没有提供可核实的分类信息。", false))?;
    let name = |id: &str| {
        catalog
            .names
            .get(if id.is_empty() { "default" } else { id })
            .cloned()
            .unwrap_or_default()
    };
    let any_empty =
        selection.product.is_empty() || selection.company.is_empty() || selection.model.is_empty();
    let fallback = c
        .miot_classification
        .as_ref()
        .filter(|s| !s.product.is_empty() || !s.company.is_empty() || !s.model.is_empty());
    let mut labels = Selection {
        product: name(&selection.product),
        company: name(&selection.company),
        model: name(&selection.model),
    };
    if any_empty {
        if let Some(s) = fallback {
            labels = Selection {
                product: if s.product.is_empty() {
                    name("default")
                } else {
                    s.product.clone()
                },
                company: if s.company.is_empty() {
                    name("default")
                } else {
                    s.company.clone()
                },
                model: if s.model.is_empty() {
                    name("default")
                } else {
                    s.model.clone()
                },
            };
        }
    }
    let ids = [&selection.product, &selection.company, &selection.model];
    let missing = ids
        .iter()
        .any(|id| !catalog.names.contains_key(id.as_str()));
    let summary = if let Some(s) = fallback.filter(|_| missing) {
        [&s.product, &s.company, &s.model]
            .into_iter()
            .map(|v| {
                if v.is_empty() {
                    name("default")
                } else {
                    v.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("-")
    } else if ids
        .iter()
        .all(|id| !catalog.names.contains_key(id.as_str()))
    {
        name("default")
    } else {
        ids.into_iter()
            .map(|id| {
                catalog
                    .names
                    .get(id.as_str())
                    .cloned()
                    .unwrap_or_else(|| name("default"))
            })
            .collect::<Vec<_>>()
            .join("-")
    };
    let revision = format!(
        "{:x}",
        Sha256::digest(
            json!([
                c.mac.to_ascii_lowercase(),
                c.name,
                selection,
                c.user_specified,
                catalog.revision
            ])
            .to_string()
            .as_bytes()
        )
    );
    Ok(Report {
        did: device.did.clone(),
        model: device.model.clone(),
        mac: c.mac.clone(),
        selection: selection.clone(),
        labels,
        summary,
        revision,
        model_enabled: fallback.is_some() || catalog.options(Field::Model, &selection).len() > 1,
        write_reason: if device.shared_read_only {
            Some("此共享路由器只有读取权限。".into())
        } else if !device.online {
            Some("路由器已离线。".into())
        } else {
            None
        },
        catalog: catalog.clone(),
    })
}
pub(crate) fn prepare(
    device: &Device,
    items: &[RouterClient],
    catalog: &Catalog,
    change: &Change,
) -> Result<(Value, Pending)> {
    let r = report(device, items, &change.mac, catalog)?;
    if let Some(why) = r.write_reason {
        return Err(AppError::new("permissionDenied", why, false));
    }
    if r.revision != change.baseline {
        return Err(AppError::new(
            "conflict",
            "设备分类已改变，请重新打开。",
            false,
        ));
    }
    if !catalog
        .options(change.field, &r.selection)
        .contains(&change.value)
        || change.field == Field::Model && !r.model_enabled
    {
        return Err(AppError::invalid("此分类选项不可用。"));
    }
    let mut target = r.selection;
    match change.field {
        Field::Product => target.product = change.value.clone(),
        Field::Company => {
            target.company = change.value.clone();
            target.model.clear();
        }
        Field::Model => target.model = change.value.clone(),
    };
    let c = selected(items, &change.mac)?;
    let payload = json!({"method":"post","params":{"deviceId":router::gateway_id(device)?,"mac":c.mac,"nickname":"","owner":"","company":target.company,"product":target.product,"model":target.model}});
    Ok((
        payload,
        Pending {
            change: change.clone(),
            target,
            name: c.name.clone(),
        },
    ))
}
pub(crate) fn confirmed(items: &[RouterClient], p: &Pending) -> bool {
    selected(items, &p.change.mac).is_ok_and(|c| {
        c.user_specified && c.classification.as_ref() == Some(&p.target) && c.name == p.name
    })
}
#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE:&str="[display_config]\nbase\tbrand\tphone\tmodel1\tlist/a.png\tdetail/a.png\nalt\tbrand2\tphone\tmodel2\tlist/a.png\tdetail/a.png\nx\tbrand\tpad\tmodel3\tlist/a.png\tdetail/a.png\n[term_table]\nphone\t手机\npad\t平板\nbrand\t品牌甲\nbrand2\t品牌乙\nmodel1\t甲型号\nmodel2\t乙型号\nmodel3\t丙型号\ndefault\t其他\n";
    fn fixture() -> (Device, RouterClient, Catalog) {
        let device:Device=serde_json::from_value(json!({"did":"miwifi.fixture","model":router::MODEL,"name":"router","online":true,"roomId":"r","roomName":"r"})).unwrap();
        let raw =
            json!({"userSpecified":false,"product":"phone","company":"brand","model":"model1"});
        let mut client = RouterClient {
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
        client.classification = selection(&raw);
        (device, client, parse_catalog(FIXTURE).unwrap())
    }
    #[test]
    fn catalog_is_bounded_and_options_follow_selected_hierarchy() {
        let c = parse_catalog(FIXTURE).unwrap();
        let s = Selection {
            product: "phone".into(),
            company: "brand".into(),
            model: "model1".into(),
        };
        assert_eq!(c.options(Field::Product, &s), ["phone", "pad", "default"]);
        assert_eq!(
            c.options(Field::Company, &s),
            ["brand", "brand2", "default"]
        );
        assert_eq!(c.options(Field::Model, &s), ["model1", "default"]);
        assert!(parse_catalog("[term_table]\ndefault\t其他").is_err());
        assert!(parse_catalog(&format!("{FIXTURE}default\tduplicate\n")).is_err());
        for uri in [
            "http://cdn.cnbj1.fds.api.mi-img.com/a",
            "https://evil.example/a",
            "https://cdn.cnbj1.fds.api.mi-img.com.evil/a",
            "https://user@cdn.cnbj1.fds.api.mi-img.com/a",
        ] {
            assert!(!allowed_config_url(uri));
        }
        assert!(allowed_config_url(
            "https://cdn.cnbj1.fds.api.mi-img.com/a?token=synthetic"
        ));
    }
    #[test]
    fn exact_plugin_payload_checks_baseline_choices_and_readback() {
        let (d, c, catalog) = fixture();
        let items = vec![c.clone()];
        let report = report(&d, &items, &c.mac, &catalog).unwrap();
        let change = Change {
            mac: c.mac.clone(),
            baseline: report.revision,
            field: Field::Company,
            value: "brand2".into(),
        };
        let (payload, pending) = prepare(&d, &items, &catalog, &change).unwrap();
        assert_eq!(
            payload,
            json!({"method":"post","params":{"deviceId":"fixture","mac":c.mac,"nickname":"","owner":"","product":"phone","company":"brand2","model":""}})
        );
        assert!(!confirmed(&items, &pending));
        let mut updated = c;
        updated.classification = Some(pending.target.clone());
        updated.user_specified = true;
        assert!(confirmed(&[updated.clone()], &pending));
        updated.name = "changed elsewhere".into();
        assert!(!confirmed(&[updated], &pending));
        assert!(prepare(
            &d,
            &items,
            &catalog,
            &Change {
                baseline: "stale".into(),
                ..change.clone()
            }
        )
        .is_err());
        assert!(prepare(
            &d,
            &items,
            &catalog,
            &Change {
                value: "forged".into(),
                ..change.clone()
            }
        )
        .is_err());
        let mut shared = d;
        shared.shared_read_only = true;
        assert!(prepare(&shared, &items, &catalog, &change).is_err());
    }
    #[test]
    fn user_choice_and_miot_fallback_do_not_invent_missing_ids() {
        let row = json!({"userSpecified":true,"userSpecifyProduct":"pad","userSpecifyCompany":"brand","userSpecifyModel":"model3","product":"phone","company":"brand","model":"model1"});
        assert_eq!(selection(&row).unwrap().product, "pad");
        assert!(selection(&json!({"userSpecified":true})).is_none());
        let (d, mut c, cat) = fixture();
        c.classification.as_mut().unwrap().model = String::new();
        c.miot_classification = Some(Selection {
            product: "已识别类型".into(),
            company: "已识别品牌".into(),
            model: "已识别型号".into(),
        });
        let r = report(&d, &[c], "AA:BB:CC:DD:EE:FF", &cat).unwrap();
        assert_eq!(r.labels.model, "已识别型号");
        assert_eq!(r.summary, "已识别类型-已识别品牌-已识别型号");
    }
}
