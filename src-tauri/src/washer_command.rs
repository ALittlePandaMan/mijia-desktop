//! Start is a one-shot chain: optional power, validated batch, action. Only
//! reads are retried. Lost/partial replies never trigger automatic re-submits.
use crate::{
    cloud::Cloud,
    error::{AppError, Result},
    models::{Device, DevicePanel},
    spec,
    washer_programs::{self, ProgramPlan},
};
use serde::Serialize;
use serde_json::{json, Value};
use std::{future::Future, time::Duration};

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandStatus {
    Confirmed,
    NotStarted,
    Uncertain,
}
#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum CommandPhase {
    Power,
    Parameters,
    Start,
}
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandResult {
    pub status: CommandStatus,
    pub phase: CommandPhase,
    pub message: String,
    pub panel: Option<DevicePanel>,
}
pub(crate) trait Transport: Sync {
    fn read(&self) -> impl Future<Output = Result<DevicePanel>> + Send;
    fn power(&self) -> impl Future<Output = Result<()>> + Send;
    fn parameters(&self, plan: &ProgramPlan) -> impl Future<Output = Result<()>> + Send;
    fn start(&self, plan: &ProgramPlan) -> impl Future<Output = Result<()>> + Send;
}
pub(crate) struct CloudTransport<'a> {
    pub cloud: &'a Cloud,
    pub device: &'a Device,
    pub schema: &'a DevicePanel,
}
fn batch_accepted(device: &Device, plan: &ProgramPlan, response: &Value) -> Result<()> {
    let rows = response
        .as_array()
        .filter(|r| r.len() == plan.writes.len())
        .ok_or_else(AppError::protocol)?;
    for target in &plan.writes {
        let matched = rows
            .iter()
            .filter(|r| {
                r["did"] == device.did && r["siid"] == target.siid && r["piid"] == target.piid
            })
            .collect::<Vec<_>>();
        if matched.len() != 1 {
            return Err(AppError::protocol());
        }
        match matched[0]["code"].as_i64() {
            Some(0 | 1) => {}
            Some(code) => return Err(AppError::device(code)),
            None => return Err(AppError::protocol()),
        }
    }
    Ok(())
}
impl Transport for CloudTransport<'_> {
    async fn read(&self) -> Result<DevicePanel> {
        let mut panel = self.schema.clone();
        let values = self.cloud.read_panel_properties(&panel).await?;
        spec::apply_reads(&mut panel, &values);
        crate::washer_runtime::refresh(&mut panel);
        Ok(panel)
    }
    async fn power(&self) -> Result<()> {
        let p = if crate::washer_zones::device_kind(self.device) {
            crate::washer_zones::power(self.schema).ok_or_else(AppError::protocol)?
        } else if crate::dryer::panel_kind(self.schema) {
            crate::dryer::service(self.schema).and_then(|service|crate::dryer::property(service,"on")).ok_or_else(AppError::protocol)?
        } else { washer_programs::property(self.schema, "washer", "on")? };
        if !p.access.iter().any(|a| a == "write") || p.unsupported_reason.is_some() {
            return Err(AppError::invalid("此洗衣机当前不支持开机控制。"));
        }
        spec::validate_value(p, &json!(true))?;
        self.cloud
            .write(&self.device.did, p.siid, p.piid, json!(true))
            .await?;
        Ok(())
    }
    async fn parameters(&self, plan: &ProgramPlan) -> Result<()> {
        let params = plan
            .writes
            .iter()
            .map(|p| json!({"did":self.device.did,"siid":p.siid,"piid":p.piid,"value":p.value}))
            .collect::<Vec<_>>();
        let rows = self
            .cloud
            .request("/miotspec/prop/set", json!({"params":params}))
            .await?;
        batch_accepted(self.device, plan, &rows)
    }
    async fn start(&self, plan: &ProgramPlan) -> Result<()> {
        self.cloud
            .action(&self.device.did, plan.start_siid, plan.start_aiid, vec![])
            .await?;
        Ok(())
    }
}
fn fatal(error: &AppError) -> bool {
    matches!(error.kind.as_str(), "authExpired" | "staleContext")
}
pub(crate) fn uncertain(phase: CommandPhase, message: &str) -> CommandResult {
    CommandResult {
        status: CommandStatus::Uncertain,
        phase,
        message: message.into(),
        panel: None,
    }
}
fn matches(panel: &DevicePanel, siid: u32, piid: u32, value: &Value) -> bool {
    panel.services.iter().flat_map(|s| &s.properties).any(|p| {
        p.siid == siid
            && p.piid == piid
            && p.code == Some(0)
            && p.value
                .as_ref()
                .is_some_and(|v| spec::values_equal(v, value))
    })
}
fn started(panel: &DevicePanel, plan: &ProgramPlan) -> bool {
    if let Some((service,status))=crate::washer_runtime::drum_status(panel,plan.start_siid) {
        return crate::dryer::property(service,"mode").is_some_and(|p|matches(panel,p.siid,p.piid,&plan.mode))
            && crate::washer_runtime::live_state(status)==Some("busy");
    }
    if crate::dryer::panel_kind(panel) {
        let Some(service)=crate::dryer::service(panel) else {return false;};
        return service.siid==plan.start_siid && crate::dryer::property(service,"mode")
            .is_some_and(|p|matches(panel,p.siid,p.piid,&plan.mode))
            && crate::dryer::property(service,"status").and_then(crate::dryer::state)==Some(if plan.reservation_minutes.is_some(){"delay"}else{"busy"});
    }
    let Ok(mode) = washer_programs::property(panel, "washer", "mode") else {
        return false;
    };
    let Ok(status) = washer_programs::property(panel, "washer", "status") else {
        return false;
    };
    let expected = if plan.reservation_minutes.is_some() {
        "Delay"
    } else {
        "Busy"
    };
    let state = status.value_list.as_ref().and_then(|list| {
        list.iter()
            .find(|v| v.description.eq_ignore_ascii_case(expected))
    });
    matches(panel, mode.siid, mode.piid, &plan.mode)
        && state.is_some_and(|v| matches(panel, status.siid, status.piid, &v.value))
}

pub(crate) fn live_program(device:&Device)->bool {
    crate::dryer::device_kind(device)||crate::washer_zones::device_kind(device)
}

pub(crate) fn ready(device:&Device,panel:&DevicePanel,plan:&ProgramPlan)->Result<bool> {
    if crate::washer_zones::device_kind(device) { return crate::washer_zones::ready(device,panel,plan.start_siid); }
    washer_programs::ready(device,panel)
}
async fn read_until<T, F, Fut, P>(
    transport: &T,
    check: &F,
    predicate: P,
    delay: Duration,
) -> Result<Option<DevicePanel>>
where
    T: Transport,
    F: Fn() -> Fut + Sync,
    Fut: Future<Output = Result<()>> + Send,
    P: Fn(&DevicePanel) -> bool + Send,
{
    for attempt in 0..3 {
        check().await?;
        match transport.read().await {
            Ok(panel) => {
                check().await?;
                if predicate(&panel) {
                    return Ok(Some(panel));
                }
            }
            Err(e) if fatal(&e) => return Err(e),
            Err(_) => {}
        }
        if attempt < 2 {
            tokio::time::sleep(delay).await;
        }
    }
    Ok(None)
}
pub(crate) async fn commit<T, F, Fut>(
    transport: &T,
    device: &Device,
    panel: &DevicePanel,
    plan: &ProgramPlan,
    check: &F,
    delay: Duration,
) -> Result<CommandResult>
where
    T: Transport,
    F: Fn() -> Fut + Sync,
    Fut: Future<Output = Result<()>> + Send,
{
    check().await?;
    let on = ready(device, panel, plan)?;
    if live_program(device) {
        if !on {
            if let Err(error) = transport.power().await {
                if fatal(&error) { return Err(error); }
                return Ok(uncertain(CommandPhase::Power, ""));
            }
        }
        let mut write=plan.clone();
        for target in &plan.writes {
            check().await?;
            write.writes=vec![target.clone()];
            if let Err(error) = transport.parameters(&write).await {
                if fatal(&error) { return Err(error); }
                return Ok(uncertain(CommandPhase::Parameters, ""));
            }
        }
        check().await?;
        if let Err(error) = transport.start(plan).await {
            if fatal(&error) { return Err(error); }
            if matches!(error.kind.as_str(), "invalidValue" | "permissionDenied" | "unsupported") {
                return Ok(CommandResult { status: CommandStatus::NotStarted, phase: CommandPhase::Start, message: String::new(), panel: None });
            }
        }
        return Ok(uncertain(CommandPhase::Start,""));
    }
    let mut current = panel.clone();
    if !on {
        if let Err(e) = transport.power().await {
            if fatal(&e) {
                return Err(e);
            }
            return Ok(uncertain(
                CommandPhase::Power,
                "开机请求尚未确认，未提交程序或开始动作。请先重新读取状态。",
            ));
        }
        let p = washer_programs::property(panel, "washer", "on")?;
        if let Some(panel) = read_until(
            transport,
            check,
            |panel| matches(panel, p.siid, p.piid, &json!(true)),
            delay,
        )
        .await?
        {
            current = panel;
        } else {
            return Ok(uncertain(
                CommandPhase::Power,
                "开机状态未回读确认，未提交程序或开始动作。",
            ));
        }
    }
    match washer_programs::ready(device, &current) {
        Ok(true) => {}
        Ok(false) => return Ok(uncertain(CommandPhase::Power, "洗衣机开机状态尚未确认。")),
        Err(e) => return Ok(uncertain(CommandPhase::Power, &e.message)),
    }
    check().await?;
    if let Err(e) = transport.parameters(plan).await {
        if fatal(&e) {
            return Err(e);
        }
        return Ok(uncertain(CommandPhase::Parameters,"部分程序参数可能已经改变；参数回复未完整确认，未发送开始动作。请重新读取，勿重复提交。"));
    }
    let parameters = read_until(
        transport,
        check,
        |panel| {
            plan.writes
                .iter()
                .all(|w| matches(panel, w.siid, w.piid, &w.value))
        },
        delay,
    )
    .await?;
    let Some(parameters) = parameters else {
        return Ok(uncertain(
            CommandPhase::Parameters,
            "程序参数尚未完整回读确认，未发送开始动作。请重新读取，勿重复提交。",
        ));
    };
    match washer_programs::ready(device, &parameters) {
        Ok(true) => {}
        Ok(false) => {
            return Ok(uncertain(
                CommandPhase::Parameters,
                "洗衣机已经关机，未发送开始动作。",
            ))
        }
        Err(e) => return Ok(uncertain(CommandPhase::Parameters, &e.message)),
    }
    check().await?;
    let action = transport.start(plan).await;
    if let Err(e) = &action {
        if fatal(e) {
            return Err(e.clone());
        }
    }
    let result = read_until(transport, check, |panel| started(panel, plan), delay).await?;
    if let Some(panel) = result {
        return Ok(CommandResult {
            status: CommandStatus::Confirmed,
            phase: CommandPhase::Start,
            message: if plan.reservation_minutes.is_some() {
                "设备已回读确认预约程序。"
            } else {
                "设备已回读确认程序正在运行。"
            }
            .into(),
            panel: Some(panel),
        });
    }
    Ok(uncertain(
        CommandPhase::Start,
        "开始请求已发出，但设备运行状态尚未确认。请重新读取状态，勿重复提交。",
    ))
}
/// Explicit confirmation only reads; it cannot replay any stage of commit.
pub(crate) async fn confirm<T, F, Fut>(
    transport: &T,
    device: &Device,
    plan: &ProgramPlan,
    phase: CommandPhase,
    check: &F,
    delay: Duration,
) -> Result<CommandResult>
where
    T: Transport,
    F: Fn() -> Fut + Sync,
    Fut: Future<Output = Result<()>> + Send,
{
    if live_program(device) {
        return tokio::time::timeout(Duration::from_secs(30), async {
            loop {
                check().await?;
                let panel = transport.read().await?;
                check().await?;
                let readable=if crate::washer_zones::device_kind(device) {
                    crate::washer_runtime::drum_status(&panel,plan.start_siid).is_some_and(|(s,status)|
                        crate::washer_runtime::live_state(status).is_some()&&crate::dryer::property(s,"mode").and_then(crate::washer_runtime::choice).is_some())
                }else{crate::dryer::readable_run_state(&panel)};
                if !readable {
                    return Err(AppError::new("stateUnavailable", "当前运行状态无法确认。", true));
                }
                let status = if phase != CommandPhase::Start {
                    Some(CommandStatus::NotStarted)
                } else {
                    started(&panel, plan).then_some(CommandStatus::Confirmed)
                };
                if let Some(status) = status {
                    return Ok(CommandResult { status, phase, message: String::new(), panel: Some(panel) });
                }
                tokio::time::sleep(delay).await;
            }
        }).await.unwrap_or_else(|_| Ok(uncertain(phase, "")));
    }
    if phase != CommandPhase::Start {
        return Ok(
            if let Some(panel) = read_until(
                transport,
                check,
                |panel| washer_programs::ready(device, panel).is_ok(),
                delay,
            )
            .await?
            {
                CommandResult {
                    status: CommandStatus::NotStarted,
                    phase,
                    message: "已重新读取设备；此前未发送开始动作，请核对参数后再开始。".into(),
                    panel: Some(panel),
                }
            } else {
                uncertain(phase, "洗衣机实时状态仍无法确认，请核实设备后重新读取。")
            },
        );
    }
    if let Some(panel) = read_until(transport, check, |panel| started(panel, plan), delay).await? {
        Ok(CommandResult {
            status: CommandStatus::Confirmed,
            phase,
            message: "设备已回读确认洗涤程序状态。".into(),
            panel: Some(panel),
        })
    } else {
        Ok(uncertain(
            phase,
            "设备仍未确认该程序正在运行，请核实洗衣机实际状态。",
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{
        washer::{self, WasherConfigReport},
        washer_programs::ProgramDraft,
    };
    use std::{
        collections::{BTreeMap, VecDeque},
        sync::{
            atomic::{AtomicUsize, Ordering},
            Mutex,
        },
    };
    fn fixture() -> (Device, DevicePanel, ProgramPlan) {
        let mut panel: DevicePanel =
            serde_json::from_str(include_str!("fixtures/washer-panel.json")).unwrap();
        for s in &mut panel.services {
            for p in &mut s.properties {
                p.code = Some(0);
                p.value = Some(match (s.name.as_str(), p.name.as_str()) {
                    ("washer", "on")
                    | ("physical-controls-locked", _)
                    | ("washer", "child-protected-enabled")
                    | ("washer", "child-protected-status") => json!(false),
                    ("washer", "door-state") => json!(2),
                    _ => json!(0),
                });
            }
        }
        let mut device:Device=serde_json::from_value(json!({"did":panel.did,"model":washer::MODEL,"name":"washer","online":true,"roomId":"r","roomName":"r"})).unwrap();
        device.firmware_version = Some("2.2.5".into());
        let config: Value =
            serde_json::from_str(include_str!("fixtures/washer-config.json")).unwrap();
        let program = config["modesData"]
            .as_array()
            .unwrap()
            .iter()
            .find(|p| p["modeName"] == "smart")
            .unwrap();
        let values = program["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|item| {
                let name = item["propertyName"].as_str().unwrap();
                (
                    name.into(),
                    item.get("defaultValue")
                        .or_else(|| config["itemsConfig"][name].get("defaultValue"))
                        .cloned()
                        .unwrap_or(json!(false)),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let config = WasherConfigReport {
            did: device.did.clone(),
            model: device.model.clone(),
            firmware: "2.2.5".into(),
            fetched_at: 1,
            config,
        };
        let plan = washer_programs::prepare(
            &device,
            &panel,
            &config,
            &ProgramDraft {
                program: "smart".into(),
                values,
                reservation_at: None,
            },
            1,
        )
        .unwrap();
        (device, panel, plan)
    }
    fn set(panel: &mut DevicePanel, name: &str, value: Value) {
        let p = panel
            .services
            .iter_mut()
            .flat_map(|s| &mut s.properties)
            .find(|p| p.name == name)
            .unwrap();
        p.value = Some(value);
        p.code = Some(0);
    }
    fn applied(panel: &DevicePanel, plan: &ProgramPlan) -> DevicePanel {
        let mut panel = panel.clone();
        set(&mut panel, "on", json!(true));
        for w in &plan.writes {
            let p = panel
                .services
                .iter_mut()
                .flat_map(|s| &mut s.properties)
                .find(|p| p.siid == w.siid && p.piid == w.piid)
                .unwrap();
            p.value = Some(w.value.clone());
        }
        panel
    }
    fn running(panel: &DevicePanel, plan: &ProgramPlan) -> DevicePanel {
        let mut panel = applied(panel, plan);
        let p = washer_programs::property(&panel, "washer", "status").unwrap();
        let value = p
            .value_list
            .as_ref()
            .unwrap()
            .iter()
            .find(|v| {
                v.description
                    == if plan.reservation_minutes.is_some() {
                        "Delay"
                    } else {
                        "Busy"
                    }
            })
            .unwrap()
            .value
            .clone();
        set(&mut panel, "status", value);
        panel
    }
    struct Fake {
        reads: Mutex<VecDeque<Result<DevicePanel>>>,
        events: Mutex<Vec<&'static str>>,
        fail: Option<&'static str>,
    }
    impl Fake {
        fn new(reads: Vec<DevicePanel>, fail: Option<&'static str>) -> Self {
            Self {
                reads: Mutex::new(reads.into_iter().map(Ok).collect()),
                events: Mutex::new(vec![]),
                fail,
            }
        }
        fn call(&self, name: &'static str) -> Result<()> {
            self.events.lock().unwrap().push(name);
            if self.fail == Some(name) {
                Err(AppError::protocol())
            } else {
                Ok(())
            }
        }
        fn events(&self) -> Vec<&'static str> {
            self.events.lock().unwrap().clone()
        }
    }
    impl Transport for Fake {
        async fn read(&self) -> Result<DevicePanel> {
            self.call("read")?;
            self.reads
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Err(AppError::protocol()))
        }
        async fn power(&self) -> Result<()> {
            self.call("power")
        }
        async fn parameters(&self, _: &ProgramPlan) -> Result<()> {
            self.call("parameters")
        }
        async fn start(&self, _: &ProgramPlan) -> Result<()> {
            self.call("start")
        }
    }
    async fn valid() -> Result<()> {
        Ok(())
    }
    #[test]
    fn drum_start_and_runtime_bind_only_the_selected_service_on_a_windows_worker_stack() {
        std::thread::Builder::new().stack_size(1024 * 1024).spawn(|| {
            tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap().block_on(async {
                let urn = "urn:miot-spec-v2:device:washer:0000A01F:mibx2-v10d:1";
                let device: Device = serde_json::from_value(json!({"did":"drums","model":"mibx2.washer.v10d",
                    "specType":urn,"name":"分区洗衣机","online":true,"roomId":"r","roomName":"r"})).unwrap();
                let property = |iid,name,fields:Value| {
                    let mut p=json!({"iid":iid,"type":format!("urn:test:property:{name}:"),"description":name,"format":"uint8","access":["read"]});
                    p.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone()); p
                };
                let drum = |iid,desc| json!({"iid":iid,"type":"urn:test:service:washer:","description":desc,"properties":[
                    property(1,"status",json!({"value-list":[{"value":1,"description":"Idle"},{"value":2,"description":"Busy"},{"value":3,"description":"Paused"}]})),
                    property(2,"fault",json!({"value-list":[{"value":0,"description":"No Faults"}]})),
                    property(10,"door-state",json!({"value-list":[{"value":0,"description":"Closed And Can Be Opened"},{"value":1,"description":"Open"}]})),
                    property(19,"mode",json!({"access":["read","write"],"value-list":[{"value":1,"description":"Quick Wash"}]})),
                ],"actions":[{"iid":2,"type":"urn:test:action:start-wash:","in":[]},{"iid":3,"type":"urn:test:action:pause:","in":[]}]});
                let raw=json!({"type":urn,"services":[{"iid":2,"type":"urn:test:service:washer:","description":"Washer","properties":[
                    property(3,"on",json!({"format":"bool","access":["read","write"]}))]},drum(3,"Upper Drum"),drum(4,"Lower Drum")]});
                let mut panel=spec::parse_panel(&device,&raw).unwrap();
                let reading=|siid,piid,value|json!({"did":"drums","siid":siid,"piid":piid,"value":value,"code":0});
                let mut rows=vec![reading(2,3,json!(true))];
                for (siid,state) in [(3,2),(4,1)] {
                    rows.extend([reading(siid,1,json!(state)),reading(siid,2,json!(0)),reading(siid,10,json!(0)),reading(siid,19,json!(1))]);
                }
                spec::apply_reads(&mut panel,&rows);
                assert_eq!(panel.washer_drums.len(),2);
                let draft=ProgramDraft {program:"drum-4-19-1".into(),values:BTreeMap::new(),reservation_at:None};
                let plan=crate::washer_zones::prepare(&panel,&draft).unwrap();
                assert_eq!((plan.start_siid,plan.start_aiid),(4,2));
                assert!(plan.writes.iter().all(|w|w.siid==4));
                assert!(crate::washer_zones::ready(&device,&panel,3).is_err());
                assert!(crate::washer_runtime::validate_action(&panel,3,3).unwrap().is_some());
                assert!(crate::washer_runtime::validate_action(&panel,4,3).is_err());
                let transport=Fake::new(vec![],None);
                let submitted=Box::pin(commit(&transport,&device,&panel,&plan,&valid,Duration::ZERO)).await.unwrap();
                assert_eq!(transport.events(),["parameters","start"]);
                assert_eq!(submitted.status,CommandStatus::Uncertain);
                let mut running=panel.clone();
                rows.iter_mut().find(|row|row["siid"]==4&&row["piid"]==1).unwrap()["value"]=json!(2);
                spec::apply_reads(&mut running,&rows);
                let readback=Fake::new(vec![panel,running],None);
                assert_eq!(Box::pin(confirm(&readback,&device,&plan,submitted.phase,&valid,Duration::ZERO)).await.unwrap().status,CommandStatus::Confirmed);
                assert_eq!(readback.events(),["read","read"]);
            });
        }).unwrap().join().unwrap();
    }
    #[test]
    fn dryer_submits_once_in_order_and_uses_only_live_confirmation_on_a_windows_worker_stack() {
        std::thread::Builder::new().stack_size(1024 * 1024).spawn(|| {
            tokio::runtime::Builder::new_current_thread().enable_time().build().unwrap().block_on(async {
                let raw: Value = serde_json::from_str(include_str!("fixtures/catalog/dryer--mibx5.dry.v2.json")).unwrap();
                let device: Device = serde_json::from_value(json!({"did":"dryer-fixture","model":"mibx5.dry.v2",
                    "specType":raw["type"],"name":"干衣机","online":true,"roomId":"r","roomName":"r"})).unwrap();
                let mut panel = spec::parse_panel(&device, &raw).unwrap();
                for (name, value) in [("on",json!(false)),("status",json!(1)),("fault",json!(0)),("mode",json!(0)),
                    ("door-state",json!(1)),("physical-controls-locked",json!(false)),("current-physical-control-lock",json!(false)),("drying-time",json!(60))] {
                    set(&mut panel, name, value);
                }
                let mut draft = ProgramDraft {program:"dryer-2-3-8".into(),values:BTreeMap::from([("drying-time".into(),json!(75))]),reservation_at:None};
                let plan = crate::dryer::prepare(&device,&panel,&draft,1).unwrap();
                assert_eq!(plan.estimated_minutes,75);
                assert_eq!(plan.writes.iter().map(|w|(w.siid,w.piid)).collect::<Vec<_>>(),[(2,3),(2,7)]);
                draft.program = "dryer-2-3-0".into();
                assert!(crate::dryer::prepare(&device,&panel,&draft,1).is_err());
                let mock = Fake::new(vec![], Some("start"));
                let submitted = Box::pin(commit(&mock,&device,&panel,&plan,&valid,Duration::ZERO)).await.unwrap();
                assert_eq!(submitted.status,CommandStatus::Uncertain);
                assert_eq!(mock.events(),["power","parameters","parameters","start"]);
                let mut running = applied(&panel,&plan);
                set(&mut running,"status",json!(2));
                let reading = Fake::new(vec![panel.clone(), running.clone()],None);
                let confirmed = Box::pin(confirm(&reading,&device,&plan,submitted.phase,&valid,Duration::ZERO)).await.unwrap();
                assert_eq!(confirmed.status,CommandStatus::Confirmed);
                assert_eq!(reading.events(),["read","read"]);
                let runtime = crate::dryer::snapshot(&running).unwrap();
                assert_eq!(runtime.controls.iter().map(|c|c.key.as_str()).collect::<Vec<_>>(),["pause"]);
                let failure = Fake::new(vec![running],Some("read"));
                assert!(Box::pin(confirm(&failure,&device,&plan,submitted.phase,&valid,Duration::ZERO)).await.is_err());
                assert_eq!(failure.events(),["read"]);
                set(&mut panel,"door-state",json!(0));
                let blocked = Fake::new(vec![],None);
                assert!(Box::pin(commit(&blocked,&device,&panel,&plan,&valid,Duration::ZERO)).await.is_err());
                assert!(blocked.events().is_empty());
            });
        }).unwrap().join().unwrap();
    }
    #[tokio::test]
    async fn power_and_parameters_must_be_read_back_before_the_single_start() {
        let (d, p, plan) = fixture();
        let mut powered = p.clone();
        set(&mut powered, "on", json!(true));
        let f = Fake::new(vec![powered, applied(&p, &plan), running(&p, &plan)], None);
        let result = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(result.status, CommandStatus::Confirmed);
        assert_eq!(
            f.events(),
            ["power", "read", "parameters", "read", "start", "read"]
        );
    }
    #[tokio::test]
    async fn lost_power_or_partial_parameter_reply_never_sends_start() {
        let (d, mut p, plan) = fixture();
        let f = Fake::new(vec![], Some("power"));
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.phase, CommandPhase::Power);
        assert_eq!(f.events(), ["power"]);
        set(&mut p, "on", json!(true));
        let f = Fake::new(vec![], Some("parameters"));
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.phase, CommandPhase::Parameters);
        assert_eq!(r.status, CommandStatus::Uncertain);
        assert_eq!(f.events(), ["parameters"]);
    }
    #[tokio::test]
    async fn parameter_readback_failure_new_lock_or_power_off_stops_before_start() {
        let (d, mut p, plan) = fixture();
        set(&mut p, "on", json!(true));
        let f = Fake::new(vec![p.clone(); 3], None);
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.phase, CommandPhase::Parameters);
        assert_eq!(f.events(), ["parameters", "read", "read", "read"]);
        let mut unsafe_panel = applied(&p, &plan);
        set(&mut unsafe_panel, "physical-controls-locked", json!(true));
        let f = Fake::new(vec![unsafe_panel], None);
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.status, CommandStatus::Uncertain);
        assert_eq!(f.events(), ["parameters", "read"]);
        let mut powered_off = applied(&p, &plan);
        set(&mut powered_off, "on", json!(false));
        let f = Fake::new(vec![powered_off], None);
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.status, CommandStatus::Uncertain);
        assert_eq!(f.events(), ["parameters", "read"]);
    }
    #[tokio::test]
    async fn door_state_is_not_an_extra_start_gate_and_cannot_fake_running_confirmation() {
        let (d, mut p, plan) = fixture();
        set(&mut p, "on", json!(true));
        set(&mut p, "door-state", json!(0));
        let f = Fake::new(vec![applied(&p, &plan); 4], None);
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.phase, CommandPhase::Start);
        assert_eq!(r.status, CommandStatus::Uncertain);
        assert_eq!(
            f.events(),
            ["parameters", "read", "start", "read", "read", "read"]
        );
    }
    #[tokio::test]
    async fn lost_action_reply_is_confirmed_only_by_running_state_and_is_never_replayed() {
        let (d, mut p, plan) = fixture();
        set(&mut p, "on", json!(true));
        let f = Fake::new(vec![applied(&p, &plan), running(&p, &plan)], Some("start"));
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.status, CommandStatus::Confirmed);
        assert_eq!(f.events(), ["parameters", "read", "start", "read"]);
        let f = Fake::new(vec![applied(&p, &plan); 4], Some("start"));
        let r = commit(&f, &d, &p, &plan, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.status, CommandStatus::Uncertain);
        assert_eq!(f.events().iter().filter(|e| **e == "start").count(), 1);
    }
    #[tokio::test]
    async fn context_change_after_parameter_read_cannot_start_a_different_home() {
        let (d, mut p, plan) = fixture();
        set(&mut p, "on", json!(true));
        let f = Fake::new(vec![applied(&p, &plan)], None);
        let calls = AtomicUsize::new(0);
        let check = || async {
            if calls.fetch_add(1, Ordering::SeqCst) >= 3 {
                Err(AppError::stale())
            } else {
                Ok(())
            }
        };
        assert_eq!(
            commit(&f, &d, &p, &plan, &check, Duration::ZERO)
                .await
                .unwrap_err()
                .kind,
            "staleContext"
        );
        assert_eq!(f.events(), ["parameters", "read"]);
    }
    #[tokio::test]
    async fn explicit_confirmation_reads_only_and_distinguishes_unsent_start() {
        let (d, p, plan) = fixture();
        let f = Fake::new(vec![running(&p, &plan)], None);
        let r = confirm(&f, &d, &plan, CommandPhase::Start, &valid, Duration::ZERO)
            .await
            .unwrap();
        assert_eq!(r.status, CommandStatus::Confirmed);
        assert_eq!(f.events(), ["read"]);
        let f = Fake::new(vec![applied(&p, &plan)], None);
        let r = confirm(
            &f,
            &d,
            &plan,
            CommandPhase::Parameters,
            &valid,
            Duration::ZERO,
        )
        .await
        .unwrap();
        assert_eq!(r.status, CommandStatus::NotStarted);
        assert_eq!(f.events(), ["read"]);
    }
    #[test]
    fn batch_response_requires_every_exact_device_property_once() {
        let (d, _, plan) = fixture();
        let rows = plan
            .writes
            .iter()
            .map(|w| json!({"did":d.did,"siid":w.siid,"piid":w.piid,"code":0}))
            .collect::<Vec<_>>();
        assert!(batch_accepted(&d, &plan, &json!(rows)).is_ok());
        let mut bad = rows.clone();
        bad[0]["did"] = json!("other-device");
        assert!(batch_accepted(&d, &plan, &json!(bad)).is_err());
        let mut bad = rows.clone();
        bad[0]["code"] = json!(-704220043);
        assert!(batch_accepted(&d, &plan, &json!(bad)).is_err());
        let mut bad = rows.clone();
        bad[0] = bad[1].clone();
        assert!(batch_accepted(&d, &plan, &json!(bad)).is_err());
        assert!(batch_accepted(&d, &plan, &json!(&rows[1..])).is_err());
    }
}
