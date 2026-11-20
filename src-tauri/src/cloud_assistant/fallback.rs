//! HyperConnect 2.0.4.577 recovery candidates, not evidence of execution safety.
//!
//! The shipped Afn / Dfn / Wir branches establish routing behavior only. A code
//! is never an automatic retry permission until an independent execution-before-
//! refusal contract is supplied by the backend Recovery implementation.
use serde::Serialize;
use serde_json::{json, Value};

pub const EVIDENCE: &str = "HyperConnect 2.0.4.577 app.asar SHA256 4fdcbef16bf4b283a67c7cf738284c1cc568583595ea44bbf772a334e493e044; dist-electron/main.js Afn/Dfn/Wir (lines 7340-7342); REA ev_bd89e292c093a72d84f869a9f30706b0b7fa421862c14500325bb64775bac3e9";
pub const ROUTE_CODES: &[i64] = &[
    2001000, 2001004, 2002004, 2002008, 2002011, 2002012, 2002015, 2002018,
    2002019, 2003001, 2003002, 2003003, 2003004, 2003005, 2003006, 2003007,
    2003008, 2003009, 2003010, 2003011, 2003012, 2003013, 2003014, 2003015,
    2003017, 2003018, 2003019, 2003101, 2003102, 2003103, 2003104, 2003105,
    2003106, 2003107, 2003108, 2003109, 2003110, 2003115, 2003116, 2003117,
    2003118, 2003120, 2003123, 2003124, 2003125, 2004101, 2004102,
];
pub const AUTH_CODES: &[i64] = &[
    2001002, 2003111, 2003112, 2003113, 2003114, 2003119, 2003127, 2004100,
];
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Branch {
    Complex,
    RefreshAssistant,
    RefreshMijia,
}
#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Rule {
    pub code: i64,
    pub branch: Branch,
    pub evidence: &'static str,
    pub verification: &'static str,
    pub enabled: bool,
}
impl Rule {
    pub fn blocked(self) -> Value {
        json!({"code":self.code,"candidateBranch":self.branch,"enabled":false,
            "verification":self.verification,"reason":"preExecutionGuaranteeUnverified",
            "evidence":self.evidence})
    }
}
pub fn candidate(code: i64) -> Option<Rule> {
    let branch = if AUTH_CODES.contains(&code) {
        Branch::RefreshAssistant
    } else if ROUTE_CODES.contains(&code) {
        Branch::Complex
    } else {
        return None;
    };
    Some(rule(code, branch))
}
pub fn chat_init_unauthorized() -> Rule {
    rule(401, Branch::RefreshMijia)
}
pub fn complex_candidate(code: i64) -> Option<Rule> {
    candidate(code).map(|_|rule(code, Branch::Complex))
}
fn rule(code: i64, branch: Branch) -> Rule {
    Rule { code, branch, evidence: EVIDENCE, verification: "unverified", enabled: false }
}
pub fn rules() -> Vec<Rule> {
    ROUTE_CODES.iter().chain(AUTH_CODES).filter_map(|&c|candidate(c))
        .chain(AUTH_CODES.iter().filter_map(|&c|complex_candidate(c)))
        .chain(std::iter::once(chat_init_unauthorized())).collect()
}
pub fn status() -> Value {
    json!({"mode":"verifiedPreExecutionRejectionOnly","candidateCount":ROUTE_CODES.len()+AUTH_CODES.len()*2+1,
        "enabledCount":0,"verification":"unverified","rules":rules(),"retryUnknown":false})
}
