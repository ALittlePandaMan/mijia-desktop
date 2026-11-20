use crate::{
    error::{AppError, Result},
    home_cards::{ConfigBundle, HomeCardRepository, presentation::preview::{self, Change, Preview, Scenario}},
    models::{Device, DevicePanel},
    spec::{parse_panel, SpecRepository},
};
use serde::{Deserialize, Serialize};
use std::{
    collections::{BTreeMap, HashMap},
    sync::{Arc, atomic::{AtomicU32, Ordering}},
};
use tokio::sync::{Mutex, OnceCell};

const PAGE_SIZE: usize = 48;
const FEATURED: i32 = -10000;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Catalog {
    version: u32,
    date: String,
    categories: Vec<Category>,
    products: Vec<Product>,
}

#[derive(Deserialize)]
struct Category {
    id: i32,
    name: String,
    types: Vec<ProductType>,
}

#[derive(Deserialize)]
struct ProductType {
    id: u32,
    name: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Product {
    model: String,
    name: String,
    brand: String,
    icon: Option<String>,
    category: i32,
    type_id: u32,
    featured: bool,
    spec: Option<String>,
}

#[derive(Clone, Serialize)]
pub(crate) struct CategoryView {
    id: i32,
    name: String,
    rooms: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct CatalogView {
    session: u32,
    date: String,
    total: usize,
    categories: Vec<CategoryView>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct Query {
    category: i32,
    room: Option<String>,
    keyword: String,
    page: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct Page {
    products: Vec<ProductRow>,
    total: usize,
    page: usize,
    page_size: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductRow {
    model: String,
    name: String,
    brand: String,
    icon: Option<String>,
    room: String,
    spec: Option<String>,
}

struct CatalogIndex {
    data: Catalog,
    by_model: HashMap<String, usize>,
    official_count: usize,
    labels: HashMap<u32, String>,
    categories: Vec<CategoryView>,
}

fn category_example_index(index: &HashMap<String, usize>, model: &str, products: &[Product]) -> Option<(i32, u32)> {
    let product = products.get(*index.get(model)?)?;
    Some((product.category, product.type_id))
}

impl CatalogIndex {
    fn load() -> Result<Self> {
        let mut data: Catalog = serde_json::from_str(include_str!("developer-catalog.json"))
            .map_err(|_| AppError::invalid("无法读取随客户端提供的产品目录。"))?;
        let mut by_model: HashMap<_, _> = data.products.iter().enumerate()
            .map(|(index, product)| (product.model.clone(), index)).collect();
        if data.version != 1 || by_model.len() != data.products.len() {
            return Err(AppError::invalid("产品目录版本或型号记录无效。"));
        }
        let official_count = data.products.len();
        // Published catalog snapshots may omit models which already have a dedicated page.
        // Keep those verified local samples searchable, outside the official product count.
        for (model, name, category_example, spec) in [
            ("midjd8.washer.42", "米家洗衣机（专用页样本）", "midjd8.washer.42a", "urn:miot-spec-v2:device:washer:0000A01F:midjd8-42:1"),
            ("hyd.airer.1s", "米家智能晾衣机（专用页样本）", "hyd.airer.1s1", "urn:miot-spec-v2:device:airer:0000A00D:hyd-1s:1"),
            ("madv.cateye.mi3iot", "智能猫眼（专用页样本）", "xiaomi.camera.069a03", ""),
            ("mijia.light.group3", "灯组（专用页样本）", "yeelink.light.bslamp2", ""),
        ] {
            if by_model.contains_key(model) { continue; }
            let example = category_example_index(&by_model, category_example, &data.products);
            let Some((category, type_id)) = example else { continue; };
            by_model.insert(model.into(), data.products.len());
            data.products.push(Product { model: model.into(), name: name.into(), brand: "米家".into(),
                icon: None, category, type_id, featured: false, spec: Some(spec.into()) });
        }
        let labels = data.categories.iter().flat_map(|category| &category.types)
            .map(|typ| (typ.id, typ.name.clone())).collect();
        let mut categories: Vec<_> = data.categories.iter().map(|category| {
            let mut rooms: Vec<_> = category.types.iter().map(|typ| typ.name.clone()).collect();
            let mut seen = std::collections::HashSet::new();
            rooms.retain(|room| seen.insert(room.clone()));
            if let Some(index) = rooms.iter().position(|room| room == "其他") {
                rooms.remove(index);
                rooms.push("其他".into());
            }
            CategoryView { id: category.id, name: category.name.clone(), rooms }
        }).collect();
        // The rotating shelf also uses the verified product type labels.
        let mut featured_rooms: Vec<_> = data.products.iter().filter(|p| p.featured)
            .map(|p| Self::label(&labels, p.type_id).to_owned()).collect();
        featured_rooms.sort_by_key(|room| (room == "其他", room.clone()));
        featured_rooms.dedup();
        if let Some(featured) = categories.iter_mut().find(|category| category.id == FEATURED) {
            featured.rooms = featured_rooms;
        }
        Ok(Self { data, by_model, labels, categories, official_count })
    }

    fn label(labels: &HashMap<u32, String>, type_id: u32) -> &str {
        labels.get(&type_id).map(String::as_str).unwrap_or("其他")
    }

    fn product(&self, model: &str) -> Result<&Product> {
        self.by_model.get(model).map(|index| &self.data.products[*index])
            .ok_or_else(|| AppError::invalid("产品目录中没有该型号。"))
    }

    fn page(&self, query: Query) -> Result<Page> {
        let category = self.categories.iter().find(|category| category.id == query.category)
            .ok_or_else(|| AppError::invalid("产品分类无效。"))?;
        if query.keyword.chars().count() > 120
            || query.room.as_ref().is_some_and(|room| !category.rooms.contains(room))
        {
            return Err(AppError::invalid("产品筛选条件无效。"));
        }
        let keyword = query.keyword.trim().to_lowercase();
        let matches: Vec<_> = self.data.products.iter().filter(|product| {
            if !keyword.is_empty() {
                return [&product.name, &product.brand, &product.model].into_iter()
                    .any(|value| value.to_lowercase().contains(&keyword));
            }
            let member = if category.id == FEATURED { product.featured } else {
                product.category == category.id
            };
            member && query.room.as_deref().is_none_or(|room|
                room == Self::label(&self.labels, product.type_id))
        }).collect();
        let total = matches.len();
        let page = query.page.min(total.saturating_sub(1) / PAGE_SIZE);
        let products = matches.into_iter().skip(page * PAGE_SIZE).take(PAGE_SIZE)
            .map(|product| ProductRow {
                model: product.model.clone(),
                name: product.name.clone(),
                brand: product.brand.clone(),
                icon: product.icon.clone(),
                room: Self::label(&self.labels, product.type_id).into(),
                spec: product.spec.clone(),
            }).collect();
        Ok(Page { products, total, page, page_size: PAGE_SIZE })
    }
}

struct Session {
    id: u32,
    catalog: CatalogIndex,
    specs: SpecRepository,
    config: preview::Config,
    active_config: OnceCell<Option<Arc<ConfigBundle>>>,
    previews: Mutex<HashMap<String, preview::ValuesByScenario>>,
    flight: Mutex<()>,
}

#[derive(Default)]
pub(crate) struct DeveloperCatalog {
    sequence: AtomicU32,
    current: Mutex<Option<Arc<Session>>>,
}

impl DeveloperCatalog {
    pub(crate) async fn open(&self) -> Result<CatalogView> {
        let mut current = self.current.lock().await;
        let id = self.sequence.fetch_add(1, Ordering::Relaxed).wrapping_add(1);
        let session = tokio::task::spawn_blocking(move || -> Result<Session> {
            Ok(Session {
                id,
                catalog: CatalogIndex::load()?,
                specs: SpecRepository::new()?,
                config: preview::Config::load()?,
                active_config: OnceCell::new(),
                previews: Mutex::default(),
                flight: Mutex::default(),
            })
        }).await.map_err(|_| AppError::invalid("无法打开产品目录。"))??;
        let view = CatalogView {
            session: id, date: session.catalog.data.date.clone(),
            total: session.catalog.official_count, categories: session.catalog.categories.clone(),
        };
        *current = Some(Arc::new(session));
        Ok(view)
    }

    pub(crate) async fn close(&self, id: u32) {
        let mut current = self.current.lock().await;
        if current.as_ref().is_some_and(|session| session.id == id) {
            *current = None;
        }
    }

    async fn session(&self, id: u32) -> Result<Arc<Session>> {
        self.current.lock().await.as_ref().filter(|session| session.id == id).cloned()
            .ok_or_else(|| AppError::invalid("开发者预览已关闭。"))
    }

    pub(crate) async fn page(&self, id: u32, query: Query) -> Result<Page> {
        self.session(id).await?.catalog.page(query)
    }

    #[cfg(test)]
    pub(crate) async fn preview(
        &self, id: u32, model: &str, scenario: Scenario, change: Option<Change>,
    ) -> Result<Option<Preview>> {
        self.preview_with_configuration(id, model, scenario, change, None).await
    }

    pub(crate) async fn preview_with_configuration(
        &self, id: u32, model: &str, scenario: Scenario, change: Option<Change>,
        cards: Option<&HomeCardRepository>,
    ) -> Result<Option<Preview>> {
        let session = self.session(id).await?;
        let product = session.catalog.product(model)?;
        let Some(typ) = product.spec.as_deref() else { return Ok(None) };
        // Fetch public descriptions only for an explicit preview. One instance
        // lookup at a time; the coalesced public metadata cache stays session-owned.
        let _flight = session.flight.lock().await;
        self.session(id).await?;
        let device: Device = serde_json::from_value(serde_json::json!({
            "did": format!("developer-preview:{model}"),
            "name": product.name,
            "model": product.model,
            "roomId": product.type_id.to_string(),
            "roomName": CatalogIndex::label(&session.catalog.labels, product.type_id),
            "online": true,
            "specType": typ,
            "productIcon": product.icon,
        })).map_err(|_| AppError::protocol())?;
        let panel = if let Some(raw) = embedded_panel(model) {
            let mut panel: DevicePanel = serde_json::from_str(raw).map_err(|_| AppError::protocol())?;
            panel.did = device.did.clone();
            panel
        } else {
            let description = match embedded_spec(model) {
                Some(spec) => Arc::new(serde_json::from_str(spec).map_err(|_| AppError::protocol())?),
                None => session.specs.instance(typ).await?,
            };
            let Ok(panel) = parse_panel(&device, &description) else { return Ok(None) };
            panel
        };
        let configuration = session.active_config.get_or_init(|| async {
            let repository = cards?;
            tokio::time::timeout(std::time::Duration::from_secs(3), repository.configuration())
                .await.ok()?.ok()
        }).await;
        self.session(id).await?;
        let mut previews = session.previews.lock().await;
        let mut empty = BTreeMap::new();
        let values = if change.is_some() {
            previews.entry(model.into()).or_default()
        } else {
            previews.get_mut(model).unwrap_or(&mut empty)
        };
        preview::render(configuration.as_deref().unwrap_or(&session.config.0), device, panel, scenario, values, change).map(Some)
    }
}

fn embedded_panel(model: &str) -> Option<&'static str> {
    Some(match model {
        "midjd8.washer.42" => include_str!("fixtures/washer-panel.json"),
        "xiaomi.waterpuri.lx32" => include_str!("fixtures/purifier-panel.json"),
        "xiaomi.ysj.gxj" => include_str!("fixtures/dispenser-panel.json"),
        "midjd.fridge.f01" => include_str!("fixtures/fridge-panel.json"),
        "hyd.airer.1s" => include_str!("fixtures/airer-panel.json"),
        _ => return None,
    })
}

fn embedded_spec(model: &str) -> Option<&'static str> {
    Some(match model {
        "mijia.light.group3" => include_str!("fixtures/home_cards_group3_spec.json"),
        "cuco.acpartner.cp6" => include_str!("fixtures/catalog/air-condition-outlet--cuco.acpartner.cp6.json"),
        "yeelink.switch.sw1" => include_str!("fixtures/compatibility/switch--yeelink.switch.sw1.json"),
        "yeelink.light.bslamp2" => include_str!("fixtures/compatibility/light--yeelink.light.bslamp2.json"),
        "cleargrass.sensor_ht.dk1" => include_str!("fixtures/compatibility/temperature-humidity-sensor--cleargrass.sensor_ht.dk1.json"),
        "zhimi.fan.za1" => include_str!("fixtures/expansion/zhimi.fan.za1.json"),
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_contains_every_model_and_pages_search_and_categories() {
        let catalog = CatalogIndex::load().unwrap();
        assert_eq!(catalog.official_count, 10_973);
        assert!(catalog.product("midjd8.washer.42").is_ok());
        assert_eq!(catalog.categories.len(), 17);
        assert_eq!(catalog.data.products.iter().filter(|p| p.icon.is_some()).count(), 10_972);
        assert_eq!(catalog.data.products.iter().take(catalog.official_count).filter(|p| p.spec.is_some()).count(), 10_879);
        let page = |category, room, keyword: &str, page| catalog.page(Query {
            category, room, keyword: keyword.into(), page,
        }).unwrap();
        let switches = page(11, None, "", 0);
        assert_eq!(switches.total, 3_144);
        assert_eq!(switches.products.len(), PAGE_SIZE);
        let last = page(11, None, "", usize::MAX);
        assert_eq!(last.products.len(), 24);
        assert_eq!(last.page, 65);
        assert_eq!(page(7, Some("空调".into()), "", 0).total, 396);
        assert_eq!(page(7, None, "CHUANGMI.CAMERA.72AC1", 0).total, 1);
        assert_eq!(page(7, None, "体脂秤 S400 Pro", 0).total, 1);
        assert_eq!(page(FEATURED, None, "", 0).total, 521);
        assert!(catalog.product("unknown.model").is_err());
        assert!(catalog.product("ows.heater.pdeh1a").unwrap().icon.is_none());
    }

    #[tokio::test]
    async fn preview_rejects_old_sessions_and_unknown_models_before_loading_spec() {
        let catalog = DeveloperCatalog::default();
        let view = catalog.open().await.unwrap();
        let query = Query { category: 7, room: None, keyword: "cuco.acpartner.cp6".into(), page: 0 };
        assert_eq!(catalog.page(view.session, query).await.unwrap().total, 1);
        assert!(catalog.preview(view.session, "unknown", Scenario::On, None).await.is_err());
        catalog.close(view.session).await;
        assert!(catalog.preview(view.session, "cuco.acpartner.cp6", Scenario::On, None).await.is_err());
    }

    #[tokio::test]
    async fn preview_uses_local_capabilities_and_keeps_simulation_state_per_session() {
        let catalog = DeveloperCatalog::default();
        let view = catalog.open().await.unwrap();
        let model = "cuco.acpartner.cp6";
        let state = async |scenario, change| {
            serde_json::to_value(catalog.preview(view.session, model, scenario, change).await.unwrap().unwrap()).unwrap()
        };
        let on = state(Scenario::On, None).await;
        assert_eq!(on["presentation"]["controls"][1]["enabled"], true);
        let off = state(Scenario::On, Some(Change::Property { siid: 3, piid: 1, value: serde_json::json!(false) })).await;
        assert_eq!(off["presentation"]["controls"][1]["enabled"], false);
        assert_eq!(off["panel"]["services"][1]["properties"][0]["value"], true);
        assert_eq!(off["presentation"]["controls"], state(Scenario::On, None).await["presentation"]["controls"]);
        assert!(catalog.preview(view.session, model, Scenario::Readonly, Some(Change::Property {
            siid: 3, piid: 1, value: serde_json::json!(false),
        })).await.is_err());
        for sample in ["yeelink.light.bslamp2", "yeelink.switch.sw1", "cleargrass.sensor_ht.dk1"] {
            assert!(catalog.preview(view.session, sample, Scenario::On, None).await.unwrap().is_some(), "{sample}");
        }
        catalog.close(view.session).await;
        let view = catalog.open().await.unwrap();
        let on_again = serde_json::to_value(catalog.preview(view.session, model, Scenario::On, None)
            .await.unwrap().unwrap()).unwrap();
        assert_eq!(on_again["presentation"]["controls"][1]["enabled"], true);
    }
}
