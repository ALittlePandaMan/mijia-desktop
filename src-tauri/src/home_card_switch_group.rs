//! Explicit physical-switch groups. No members or MIoT addresses come from UI input.
use super::*;
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SwitchGroup {
    pub read_started_at: u64,
    pub id: String,
    pub revision: u64,
    pub members: Vec<SwitchMember>,
}
#[derive(Clone, Debug, Serialize)]
pub struct SwitchMember {
    pub id: String,
    pub selected: Option<bool>,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupResult {
    pub readback: bool,
    pub home_id: String,
    pub request_id: String,
    pub sequence: u64,
    pub target: bool,
    pub card: HomeCardEntry,
    pub failed: Vec<String>,
}
pub(crate) fn member_id(p: &Property) -> String {
    format!("{}:{}", p.siid, p.piid)
}
fn properties(device: &Device, panel: &DevicePanel) -> Vec<Property> {
    if device.control_service_id.is_some()
        || device.hidden_on_home && !device.split_display_available
        || !device.online
        || device.shared_read_only
        || !matches!(
            panel.spec_type.as_deref().and_then(urn_name),
            Some("switch" | "relay" | "control-panel")
        )
    {
        return vec![];
    }
    panel
        .services
        .iter()
        .filter(|s| s.name == "switch")
        .flat_map(|s| &s.properties)
        .filter(|p| {
            p.name == "on"
                && p.unsupported_reason.is_none()
                && p.access.iter().any(|a| a == "read")
                && p.access.iter().any(|a| a == "write")
                && power_value(p, true).is_some()
                && power_value(p, false).is_some()
                && crate::capabilities::property_write_allowed(panel, p.siid, p.piid)
        })
        .cloned()
        .collect()
}
fn eligible(panel: &DevicePanel, props: Vec<Property>) -> Vec<Property> {
    props
        .into_iter()
        .filter(|p| crate::switch_mode::validate(panel, p.siid).is_ok())
        .collect()
}
pub(crate) async fn resolve(
    cloud: &Cloud,
    specs: &SpecRepository,
    device: &Device,
    revision: u64,
) -> Result<Option<(HomeCardEntry, Vec<Property>)>> {
    let mut panel = specs.panel(device).await?;
    let props = properties(device, &panel);
    if props.len() < 2 {
        return Ok(None);
    }
    let id = format!(
        "switch-group:{}",
        crate::widget_layout::device_fingerprint(device)
    );
    let mut request = vec![];
    for p in &props {
        request.push(json!({"did":device.control_did(),"siid":p.siid,"piid":p.piid}));
        if let Some(mode) = crate::switch_mode::property(&panel, p.siid) {
            request.push(json!({"did":device.control_did(),"siid":mode.siid,"piid":mode.piid}));
        }
    }
    let read_started_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;
    let reads = cloud.read(request).await?;
    crate::spec::apply_reads(&mut panel, &reads);
    let eligible = eligible(&panel, props);
    let Some(first) = eligible.first() else {
        return Ok(None);
    };
    let members: Vec<_> = eligible
        .iter()
        .map(|p| SwitchMember {
            id: member_id(p),
            selected: panel
                .services
                .iter()
                .flat_map(|s| &s.properties)
                .find(|q| q.siid == p.siid && q.piid == p.piid)
                .filter(|p| p.code == Some(0))
                .and_then(|p| p.value.as_ref())
                .and_then(truth),
        })
        .collect();
    let selected = Some(members.iter().all(|m| m.selected == Some(true)));
    let card = HomeCardEntry {
        did: device.did.clone(),
        selected,
        kind: "power".into(),
        visible: true,
        highlight: selected == Some(true),
        enabled: true,
        mode_allowed: Some(true),
        reason: None,
        binding: HomeCardBinding {
            siid: first.siid,
            piid: first.piid,
        },
        action: if selected == Some(true) { "off" } else { "on" }.into(),
        card_type: 1,
        group: Some(SwitchGroup {
            read_started_at,
            id,
            revision,
            members,
        }),
    };
    Ok(Some((card, eligible)))
}
impl HomeCardRepository {
    pub(crate) async fn prepare_switch_group(
        &self,
        cloud: &Cloud,
        specs: &SpecRepository,
        device: &Device,
    ) -> Result<Option<(HomeCardEntry, Vec<Property>)>> {
        let revision = self
            .presentation_clock
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
            + 1;
        resolve(cloud, specs, device, revision).await
    }
    pub(crate) async fn switch_group(
        &self,
        cloud: &Cloud,
        specs: &SpecRepository,
        device: &Device,
    ) -> Result<Option<HomeCardEntry>> {
        if device.control_service_id.is_some()
            || !matches!(
                device.spec_type.as_deref().and_then(urn_name),
                Some("switch" | "relay" | "control-panel")
            )
        {
            return Ok(None);
        }
        let revision = self
            .presentation_clock
            .fetch_add(1, std::sync::atomic::Ordering::AcqRel)
            + 1;
        Ok(resolve(cloud, specs, device, revision).await?.map(|v| v.0))
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    fn fixture() -> (Device, DevicePanel) {
        let d:Device=serde_json::from_value(json!({"did":"mock","model":"yeelink.switch.ylsw6","name":"Mock","online":true,"roomId":"r","roomName":"r","specType":"urn:miot-spec-v2:device:switch:fixture:1"})).unwrap();
        let services:Vec<_>=(2..=6).map(|siid|json!({"siid":siid,"name":"switch","description":"Key","actions":[],"properties":[{"siid":siid,"piid":1,"name":"on","description":"On","format":"bool","access":["read","write"],"code":0,"value":false},{"siid":siid,"piid":2,"name":"mode","description":"Mode","format":"uint8","access":["read"],"code":if siid==6{-1}else{0},"value":siid-2,"valueList":[{"value":0,"description":"Wired And Wireless"},{"value":1,"description":"Wireless"},{"value":2,"description":"Wireless"},{"value":3,"description":"Wireless"}]}]})).collect();
        let p = serde_json::from_value(
            json!({"did":"mock","model":d.model,"specType":d.spec_type,"services":services}),
        )
        .unwrap();
        (d, p)
    }
    #[test]
    fn group_excludes_wireless_flex_remote_and_unknown_modes() {
        let (d, p) = fixture();
        let all = properties(&d, &p);
        assert_eq!(all.len(), 5);
        let safe = eligible(&p, all);
        assert_eq!(safe.iter().map(|p| p.siid).collect::<Vec<_>>(), vec![2]);
    }
    #[test]
    fn split_keys_readonly_and_offline_devices_do_not_expand_to_groups() {
        let (mut d, p) = fixture();
        d.shared_read_only = true;
        assert!(properties(&d, &p).is_empty());
        d.shared_read_only = false;
        d.online = false;
        assert!(properties(&d, &p).is_empty());
        d.online = true;
        d.control_service_id = Some(2);
        assert!(properties(&d, &p).is_empty());
    }
    #[test]
    fn a_mode_change_is_checked_again_before_group_members_are_selected() {
        let (d, mut p) = fixture();
        let all = properties(&d, &p);
        p.services[0].properties[1].value = Some(json!(1));
        assert!(eligible(&p, all).is_empty());
    }
}
