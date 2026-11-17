use crate::{
    error::{AppError, Result},
    mcp_core::fingerprint,
};
use serde::{Deserialize, Serialize};
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TargetScope {
    pub home_id: String,
    #[serde(default)]
    pub home_ids: Vec<String>,
    /// Real owner of the selected target home; never inferred from the login.
    #[serde(default)]
    pub owner_uid: String,
    /// All homes delegated at admission. Old journal entries fall back to home_ids.
    #[serde(default)]
    pub auth_home_ids: Vec<String>,
    pub devices: Vec<String>,
    pub permission_ids: Vec<String>,
    pub channels: Vec<String>,
    pub grant_epoch: u64,
    pub key_epoch: u64,
    pub directory_revision: String,
    pub auth_generation: u64,
}
pub struct DelegatedScope {
    scope: TargetScope,
}
impl DelegatedScope {
    pub fn target(&self) -> &TargetScope {
        &self.scope
    }
    pub fn fingerprint(&self) -> String {
        fingerprint(&self.scope)
    }
    pub fn authorized_homes(&self) -> &[String] {
        if self.scope.auth_home_ids.is_empty() {
            &self.scope.home_ids
        } else {
            &self.scope.auth_home_ids
        }
    }
    pub(crate) fn complex_target(&self) -> Result<Self> {
        if self.scope.home_ids.len() != 1 {
            return Err(AppError::new("clarificationRequired", "复杂任务需要一个明确家庭。", false));
        }
        let mut scope = self.scope.clone();
        scope.home_id = scope.home_ids[0].clone();
        Ok(Self { scope })
    }
}
pub const EVIDENCE:&str="Household delegation: the client submits only selected account household IDs. The inspected client uses household parameters and empty device/room lists. Server-enforced exclusion of other households is not verified; device permissions and modes are resolved by the MiJia cloud assistant.";
pub fn delegate(mut scope: TargetScope, selected: &[String]) -> Result<DelegatedScope> {
    scope.home_ids.sort();
    scope.home_ids.dedup();
    scope.auth_home_ids.sort();
    scope.auth_home_ids.dedup();
    if scope.home_ids.is_empty() {
        return Err(AppError::new(
            "noSelectedHomes",
            "请先在设置 → MCP 勾选家庭。",
            false,
        ));
    }
    if !scope.devices.is_empty()
        || !scope.permission_ids.is_empty()
        || !scope.channels.is_empty()
        || scope.home_ids.iter().any(|h| {
            h.is_empty() || !h.bytes().all(|c| c.is_ascii_digit()) || !selected.contains(h)
        })
        || scope.auth_home_ids.iter().any(|h| {
            h.is_empty() || !h.bytes().all(|c| c.is_ascii_digit()) || !selected.contains(h)
        })
        || (!scope.auth_home_ids.is_empty() && scope.home_ids.iter().any(|h| !scope.auth_home_ids.contains(h)))
        || (!scope.owner_uid.is_empty() && !scope.owner_uid.bytes().all(|c| c.is_ascii_digit()))
        || (!scope.home_id.is_empty() && !scope.home_ids.contains(&scope.home_id))
    {
        return Err(AppError::new(
            "homeDenied",
            "只能委托当前账号已选家庭。",
            false,
        ));
    }
    Ok(DelegatedScope { scope })
}
#[cfg(test)]
pub fn mock_verified(mut scope: TargetScope) -> DelegatedScope {
    if scope.home_ids.is_empty() {
        scope.home_ids = vec![scope.home_id.clone()];
    }
    DelegatedScope { scope }
}

pub fn select_homes(
    request: &super::protocol::Request,
    selected: &[String],
) -> Result<Vec<String>> {
    if selected.is_empty() {
        return Err(AppError::new(
            "noSelectedHomes",
            "请先在设置 → MCP 勾选家庭。",
            false,
        ));
    }
    if let Some(home) = &request.home_id {
        if !selected.contains(home) {
            return Err(AppError::new(
                "homeDenied",
                "该家庭未勾选或不可访问。",
                false,
            ));
        }
        return Ok(vec![home.clone()]);
    }
    if request.complexity == "complex" && selected.len() != 1 {
        return Err(AppError::new(
            "clarificationRequired",
            "复杂任务需要指定一个已选home_id。",
            false,
        ));
    }
    let mut homes = selected.to_vec();
    homes.sort();
    homes.dedup();
    Ok(homes)
}
