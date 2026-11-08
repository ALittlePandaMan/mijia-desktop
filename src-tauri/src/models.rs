use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionView {
    pub logged_in: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub user_id: Option<String>,
    pub region: String,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountProfile {
    pub display_name: Option<String>,
    pub avatar_url: Option<String>,
    pub fetched_at: u64,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct QrView {
    pub attempt_id: String,
    pub qr_data_url: String,
    pub expires_at: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PollView {
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session: Option<SessionView>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Room {
    pub id: String,
    pub name: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Home {
    pub id: String,
    pub name: String,
    pub owner_id: String,
    pub rooms: Vec<Room>,
    pub shared: bool,
    #[serde(skip)]
    pub room_devices: std::collections::HashMap<String, String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    pub did: String,
    pub name: String,
    pub model: String,
    pub online: bool,
    /// APK Device.partnerId from authenticated inventory, never exposed to IPC.
    #[serde(skip)]
    pub partner_id: Option<String>,
    /// Authenticated inventory metadata for firmware-specific configuration.
    #[serde(skip)]
    pub firmware_version: Option<String>,
    /// Android SDK10923 Device.lastVersion: fw_version plus mcu_version,
    /// falling back to the native version. Kept inside the business layer.
    #[serde(skip)]
    pub plugin_version: Option<String>,
    /// Main-page flags and split/group postprocessing; routing records remain.
    #[serde(default)]
    pub hidden_on_home: bool,
    /// Valid split channel hidden only by the cloud's combined-view bit 16.
    /// Local single-key display may reveal it; other hide/group flags still win.
    #[serde(default)]
    pub split_display_available: bool,
    /// Authenticated sharing permissions; used to suppress write shortcuts.
    #[serde(default)]
    pub shared_read_only: bool,
    pub room_id: String,
    pub room_name: String,
    pub icon: Option<String>,
    /// Canonical product image, distinct from a device's customized card logo.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_icon: Option<String>,
    pub spec_type: Option<String>,
    pub unsupported_reason: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_group: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_group_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub control_service_id: Option<u32>,
    /// Exact authenticated group membership; never inferred from rooms/names.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub group_members: Option<Vec<String>>,
    /// Private routing metadata from the authenticated device list. The logical
    /// device remains the IPC identity; clients cannot supply a physical route.
    #[serde(skip)]
    pub split_route: Option<SplitRoute>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct SplitRoute {
    pub parent_did: String,
    pub service_iid: u32,
}

impl Device {
    pub fn control_did(&self) -> &str {
        self.split_route
            .as_ref()
            .map(|route| route.parent_did.as_str())
            .unwrap_or(&self.did)
    }
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeSnapshot {
    pub home_id: String,
    pub generation: u64,
    pub devices: Vec<Device>,
    pub order: Option<HomeOrder>,
    pub order_notice: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HomeOrder {
    pub room_ids: Vec<String>,
    pub room_devices: std::collections::HashMap<String, Vec<String>>,
    pub front_devices: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ValueLabel {
    pub value: Value,
    pub description: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReportedValue {
    pub value: Value,
    pub updated_at: Option<u64>,
    pub retrieved_at: u64,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryPoint {
    pub time: u64,
    pub low: f64,
    pub high: f64,
    /// Gateway samples belong to the following local hour boundary in the APK.
    pub gateway: bool,
    pub source: String,
    pub bucket_time: u64,
    pub state: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChannel {
    pub name: String,
    pub unit: String,
    pub points: Vec<HistoryPoint>,
    pub error: Option<String>,
    pub complete: bool,
    pub sources: Vec<String>,
    pub completeness: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SensorHistory {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub start: u64,
    pub end: u64,
    pub reference_time: u64,
    pub selection: Option<HistorySelection>,
    pub channels: Vec<HistoryChannel>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum HistoryPeriod {
    Day,
    Month,
    Year,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct HistorySelection {
    pub period: HistoryPeriod,
    pub date: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum EnergyPeriod {
    Week,
    Month,
    Year,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct EnergySelection {
    pub period: EnergyPeriod,
    pub date: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyPoint {
    pub time: u64,
    pub value: f64,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergySummary {
    pub today: Option<f64>,
    pub yesterday: Option<f64>,
    pub month: Option<f64>,
    pub switches: Option<u32>,
    pub switches_more: bool,
    pub complete: bool,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnergyReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub selection: EnergySelection,
    pub start: u64,
    pub end: u64,
    pub points: Vec<EnergyPoint>,
    pub summary: EnergySummary,
    pub complete: bool,
    pub error: Option<crate::error::AppError>,
    pub warnings: Vec<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerEntry {
    pub key: String,
    pub on: bool,
    pub enabled: bool,
    pub time: String,
    pub repeat: String,
    pub due_at: Option<u64>,
    pub end_time: Option<String>,
    pub weekdays: Vec<u8>,
    pub edit_reason: Option<String>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountdownView {
    pub on: bool,
    pub key: Option<String>,
    pub write_reason: Option<String>,
    /// None means an unreadable countdown prevented a reliable conclusion.
    pub active: Option<bool>,
    pub due_at: Option<u64>,
    pub hours: Option<u32>,
    pub minutes: Option<u32>,
    pub duration_source: String,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerReport {
    pub did: String,
    pub model: String,
    pub fetched_at: u64,
    pub entries: Vec<TimerEntry>,
    pub countdowns: Vec<CountdownView>,
    pub unsupported_count: u32,
    pub warnings: Vec<String>,
    pub write_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum TimerMode {
    On,
    Off,
    Period,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TimerDraft {
    pub key: Option<String>,
    pub mode: TimerMode,
    pub on_time: Option<String>,
    pub off_time: Option<String>,
    pub weekdays: Vec<u8>,
    pub enabled: bool,
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum TimerChange {
    Save { draft: TimerDraft },
    SetEnabled { key: String, enabled: bool },
    Delete { key: String },
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimerChangeResult {
    pub verified: bool,
    pub message: String,
    pub report: Option<TimerReport>,
    pub changed_key: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "operation", rename_all = "camelCase", deny_unknown_fields)]
pub enum CountdownChange {
    Set {
        on: bool,
        key: Option<String>,
        hours: u32,
        minutes: u32,
    },
    Cancel {
        on: bool,
        key: String,
    },
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CountdownChangeResult {
    pub scene_verified: bool,
    pub preferences_verified: Option<bool>,
    pub message: String,
    pub report: Option<TimerReport>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Property {
    pub siid: u32,
    pub piid: u32,
    pub name: String,
    pub description: String,
    pub format: String,
    pub access: Vec<String>,
    pub unit: Option<String>,
    pub value: Option<Value>,
    pub code: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_reported: Option<ReportedValue>,
    pub value_list: Option<Vec<ValueLabel>>,
    pub value_range: Option<Vec<f64>>,
    pub unsupported_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Action {
    pub siid: u32,
    pub aiid: u32,
    pub name: String,
    pub description: String,
    #[serde(rename = "in")]
    pub inputs: Vec<u32>,
    pub out: Vec<u32>,
    pub unsupported_reason: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Service {
    pub siid: u32,
    pub name: String,
    pub description: String,
    pub properties: Vec<Property>,
    pub actions: Vec<Action>,
    #[serde(default)]
    pub events: Vec<DeviceEvent>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DeviceEvent {
    pub siid: u32,
    pub eiid: u32,
    pub name: String,
    pub description: String,
    pub arguments: Vec<u32>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DevicePanel {
    pub did: String,
    pub model: String,
    #[serde(default)]
    pub spec_type: Option<String>,
    pub services: Vec<Service>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capabilities: Option<crate::capabilities::DeviceCapabilities>,
    pub unsupported_reason: Option<String>,
    #[serde(skip)]
    pub route_did: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub washer_runtime: Option<crate::washer_runtime::RuntimeSnapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purifier: Option<crate::purifier::Snapshot>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dispenser: Option<crate::dispenser_config::Snapshot>,
}

impl DevicePanel {
    pub fn control_did(&self) -> &str {
        self.route_did.as_deref().unwrap_or(&self.did)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ControlResult {
    pub verified: bool,
    pub message: String,
    pub panel: DevicePanel,
}

pub fn id(value: &Value) -> String {
    value
        .as_str()
        .map(str::to_owned)
        .unwrap_or_else(|| value.as_u64().map(|v| v.to_string()).unwrap_or_default())
}

pub fn epoch_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PanelPreview {
    pub panel: DevicePanel,
    pub cached_at: Option<u64>,
    pub has_cached_state: bool,
}
