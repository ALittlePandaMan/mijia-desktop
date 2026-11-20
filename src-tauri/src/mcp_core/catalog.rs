//! Shared endpoint identity and backward-compatible retired journal fields.
use super::fingerprint;
use crate::models::Device;
use serde::{Serialize,Deserialize};
use serde_json::Value;
pub fn device_fingerprint(d: &Device) -> String {
    fingerprint(&(
        &d.did,
        &d.name,
        &d.model,
        &d.spec_type,
        &d.room_id,
        &d.room_name,
        &d.firmware_version,
        &d.plugin_version,
        d.control_did(),
        d.split_route.as_ref().map(|r| r.service_iid),
        d.control_service_id,
        &d.group_members,
        d.shared_read_only,
        &d.unsupported_reason,
    ))
}
pub fn endpoint(scope: &str, home: &str, did: &str, siid: u32, piid: u32) -> String {
    format!("{scope}\n{home}\n{did}\n{siid}.{piid}")
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PowerTarget {
    pub did: String,
    pub name: String,
    pub room: String,
    pub control_did: String,
    pub siid: u32,
    pub piid: u32,
    pub key: String,
    pub fingerprint: String,
    pub mapping_fingerprint: Option<String>,
    pub on_value: Value,
    pub off_value: Value,
    pub powers: Vec<String>,
    pub lighting: bool,
    #[serde(default)]
    pub native: Option<Value>,
    #[serde(default)]
    pub adjustment: Option<Value>,
}
