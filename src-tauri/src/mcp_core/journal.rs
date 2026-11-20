//! Write-ahead request records. An attempted write is never replayed after restart.
use super::{catalog::PowerTarget, now_ms};
use crate::error::{AppError, Result};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    fs::{File, OpenOptions},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    sync::Mutex,
};
const RETENTION: u64 = 7 * 86400 * 1000;
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    pub state: String,
    pub attempted: bool,
    pub evidence: Value,
    pub issue: Option<String>,
}
impl Default for Entry {
    fn default() -> Self {
        Self {
            state: "waiting".into(),
            attempted: false,
            evidence: Value::Null,
            issue: None,
        }
    }
}
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Record {
    #[serde(default,skip_serializing_if="Option::is_none")]
    pub assistant: Option<crate::cloud_assistant::execution::Task>,
    pub scope: String,
    pub home: String,
    pub request_id: String,
    pub fingerprint: String,
    pub directory_revision: String,
    pub target: Value,
    pub on: bool,
    pub created_at: u64,
    pub deadline: u64,
    pub targets: Vec<PowerTarget>,
    pub entries: Vec<Entry>,
    pub issues: Vec<Value>,
    pub target_complete: bool,
    #[serde(default)]
    pub phase: String,
    pub task_status: String,
    pub revision: u64,
    pub legacy: bool,
    pub legacy_result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub memory_status: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub operation_memory: Option<Value>,
}
impl Record {
    pub fn counts(&self) -> Value {
        let count = |state: &str| self.entries.iter().filter(|e| e.state == state).count();
        json!({"total":self.targets.len(),"submitted":count("submitted"),"confirmed":count("confirmed"),"failed":count("failed"),"unconfirmed":count("unconfirmed"),"cancelled":count("cancelled"),"skipped":count("skipped")+self.issues.iter().filter(|i|i["state"]=="skipped").count(),"pending":self.entries.iter().filter(|e|matches!(e.state.as_str(),"waiting"|"running")).count()})
    }
    pub fn outcome(&self) -> &str {
        if self.legacy {
            return if self.task_status == "running" {
                "pending"
            } else {
                "unconfirmed"
            };
        }
        let submitted = self
            .entries
            .iter()
            .filter(|e| e.state == "submitted")
            .count();
        if self.task_status == "running" && submitted > 0 {
            return "partial";
        }
        if self.task_status != "running" && submitted > 0 {
            return if self
                .entries
                .iter()
                .all(|e| matches!(e.state.as_str(), "submitted" | "skipped"))
                && self.target_complete
            {
                "submitted"
            } else {
                "partial"
            };
        }
        if self.task_status != "running"
            && !self.entries.is_empty()
            && self.entries.iter().all(|e| e.state == "skipped")
        {
            return "skipped";
        }
        let confirmed = self
            .entries
            .iter()
            .filter(|e| e.state == "confirmed")
            .count();
        if self.task_status == "running" {
            if confirmed > 0 {
                "partial"
            } else {
                "pending"
            }
        } else if confirmed == self.entries.len()
            && !self.entries.is_empty()
            && self.target_complete
            && self.issues.iter().all(|i| i["state"] == "skipped")
        {
            "confirmed"
        } else if confirmed > 0 {
            "partial"
        } else if self
            .entries
            .iter()
            .any(|e| e.attempted && e.state != "failed")
        {
            "unconfirmed"
        } else {
            "failed"
        }
    }
    pub fn details(&self) -> Vec<Value> {
        if let Some(task)=&self.assistant{return task.details()}
        let mut rows = self.issues.clone();
        for (target, entry) in self.targets.iter().zip(&self.entries) {
            rows.push(json!({"deviceId":target.did,"channel":format!("{}.{}",target.siid,target.piid),"name":target.name,"state":entry.state,"evidence":entry.evidence,"issue":entry.issue}));
        }
        rows
    }
    pub fn summary(&self) -> Value {
        if let Some(task)=&self.assistant{return task.summary(&self.request_id,&self.task_status,self.revision)}
        let mut value = json!({"requestId":self.request_id,"taskStatus":self.task_status,"phase":if self.phase.is_empty(){"executing"}else{&self.phase},"targetsResolved":self.phase.is_empty()||self.phase=="executing","outcome":self.outcome(),"target":self.target,"on":self.on,"targetComplete":self.target_complete,"counts":self.counts(),"uniqueWriteTargets":self.targets.iter().map(|t|&t.key).collect::<std::collections::BTreeSet<_>>().len(),"revision":self.revision,"issuesTotal":self.issues.len()+self.entries.iter().filter(|e|e.issue.is_some()).count(),"detailsAvailable":true,"detailsComplete":false,"retryAfterMs":if self.task_status=="running"{1000}else{0}});
        if self.entries.iter().any(|e| e.state == "submitted") {
            value["verification"] = json!("notPerformed");
        }
        if let Some(status) = &self.memory_status {
            value["memory"] = json!(status);
        }
        if let Some(intent) = self.target.get("_intent") {
            value["target"].as_object_mut().unwrap().remove("_intent");
            value["action"] = intent["action"].clone();
            if intent["action"] != "power" {
                value.as_object_mut().unwrap().remove("on");
            }
        }
        value
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "event")]
enum Event {
    Assistant {key:String,task:crate::cloud_assistant::execution::Task},
    Resolve {
        record: Box<Record>,
    },
    Admit {
        record: Box<Record>,
    },
    Entry {
        key: String,
        index: usize,
        entry: Entry,
    },
    End {
        key: String,
        status: String,
        legacy_result: Option<Value>,
    },
    Expired {
        key: String,
        fingerprint: String,
        home: String,
    },
}
#[derive(Clone)]
struct Expired {
    fingerprint: String,
    home: String,
}
struct Inner {
    poisoned: bool,
    last_gc: u64,
    file: File,
    records: BTreeMap<String, Record>,
    expired: BTreeMap<String, Expired>,
}
pub struct Journal {
    inner: Mutex<Inner>,
    path: PathBuf,
}
fn failure(_: impl std::fmt::Display) -> AppError {
    AppError::new(
        "journalUnavailable",
        "请求日志不可用，未下发新的控制。",
        false,
    )
}
fn key(scope: &str, id: &str) -> String {
    format!("{scope}\n{id}")
}
impl Journal {
    pub fn open(path: PathBuf) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(failure)?;
        }
        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .read(true)
            .open(&path)
            .map_err(failure)?;
        let mut inner = Inner {
            poisoned: false,
            last_gc: now_ms(),
            file,
            records: BTreeMap::new(),
            expired: BTreeMap::new(),
        };
        let mut reader = BufReader::new(File::open(&path).map_err(failure)?);
        let mut line = String::new();
        loop {
            line.clear();
            if reader.read_line(&mut line).map_err(failure)? == 0 {
                break;
            }
            if !line.ends_with('\n') {
                break;
            }
            if line.len() > 8 * 1024 * 1024 {
                return Err(failure("oversize record"));
            }
            let event: Event = serde_json::from_str(&line).map_err(failure)?;
            Self::apply(&mut inner, event);
        }
        if inner.records.values().any(|r|r.assistant.is_none()) {
            let backup=path.with_file_name("requests-before-family-mcp-v1.jsonl");
            if !backup.exists(){std::fs::copy(&path,&backup).map_err(failure)?;}
            let retired:Vec<_>=inner.records.values().filter(|r|r.assistant.is_none()).cloned().collect();
            for r in retired {Self::apply(&mut inner,Event::Expired{key:key(&r.scope,&r.request_id),fingerprint:r.fingerprint,home:r.home});}
        }
        let now = now_ms();
        let mut events = vec![];
        for record in inner.records.values_mut() {
            if record.task_status == "running" {
                record.task_status = "interrupted".into();
                if let Some(task)=record.assistant.as_mut(){task.phase="interrupted".into();task.error=Some("assistantProcessRestarted".into());if task.request_attempted{task.request_submitted=None;}}
                record.revision += 1;
                for entry in &mut record.entries {
                    if matches!(entry.state.as_str(), "waiting" | "running") {
                        entry.state = if entry.attempted {
                            "unconfirmed"
                        } else {
                            "cancelled"
                        }
                        .into();
                        entry.issue = Some("服务重启，未自动恢复写入。".into());
                    }
                }
                if record.legacy {
                    record.legacy_result = Some(
                        json!({"status":"unconfirmed","retryWrite":false,"reason":"服务重启，写入未自动恢复。"}),
                    );
                }
            }
            if now.saturating_sub(record.created_at) > RETENTION {
                events.push(Event::Expired {
                    key: key(&record.scope, &record.request_id),
                    fingerprint: record.fingerprint.clone(),
                    home: record.home.clone(),
                });
            }
        }
        for event in events {
            Self::apply(&mut inner, event);
        }
        // Compact snapshots discard expired details; permanent tombstones prevent replay.
        let temporary = path.with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let mut output = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&temporary)
            .map_err(failure)?;
        for record in inner.records.values() {
            Self::write(
                &mut output,
                &Event::Admit {
                    record: Box::new(record.clone()),
                },
            )?;
        }
        for (k, e) in &inner.expired {
            Self::write(
                &mut output,
                &Event::Expired {
                    key: k.clone(),
                    fingerprint: e.fingerprint.clone(),
                    home: e.home.clone(),
                },
            )?;
        }
        output.sync_all().map_err(failure)?;
        drop(output);
        drop(inner.file);
        std::fs::rename(&temporary, &path).map_err(failure)?;
        inner.file = OpenOptions::new()
            .append(true)
            .read(true)
            .open(&path)
            .map_err(failure)?;
        Ok(Self {
            inner: Mutex::new(inner),
            path,
        })
    }
    fn write(file: &mut File, event: &Event) -> Result<()> {
        serde_json::to_writer(&mut *file, event).map_err(failure)?;
        file.write_all(b"\n").map_err(failure)
    }
    fn append(inner: &mut Inner, event: Event) -> Result<()> {
        if inner.poisoned {
            return Err(failure("previous append failed"));
        }
        let saved = Self::write(&mut inner.file, &event)
            .and_then(|_| inner.file.sync_all().map_err(failure));
        if saved.is_err() {
            inner.poisoned = true;
        }
        saved?;
        Self::apply(inner, event);
        Ok(())
    }
    fn apply(inner: &mut Inner, event: Event) {
        match event {
            Event::Assistant{key,task}=>{if let Some(record)=inner.records.get_mut(&key){record.assistant=Some(task);record.revision+=1;}},
            Event::Resolve { record } => {
                inner
                    .records
                    .insert(key(&record.scope, &record.request_id), *record);
            }
            Event::Admit { record } => {
                inner
                    .records
                    .insert(key(&record.scope, &record.request_id), *record);
            }
            Event::Entry { key, index, entry } => {
                if let Some(record) = inner.records.get_mut(&key) {
                    if let Some(current) = record.entries.get_mut(index) {
                        *current = entry;
                        record.revision += 1;
                    }
                }
            }
            Event::End {
                key,
                status,
                legacy_result,
            } => {
                if let Some(record) = inner.records.get_mut(&key) {
                    record.task_status = status;
                    record.legacy_result = legacy_result;
                    record.revision += 1;
                }
            }
            Event::Expired {
                key,
                fingerprint,
                home,
            } => {
                inner.records.remove(&key);
                inner.expired.insert(key, Expired { fingerprint, home });
            }
        }
    }
    pub fn lookup(&self, scope: &str, id: &str) -> Result<Option<Record>> {
        let inner = self.inner.lock().map_err(failure)?;
        let key = key(scope, id);
        if inner.expired.contains_key(&key)
            || inner
                .records
                .get(&key)
                .is_some_and(|r| now_ms().saturating_sub(r.created_at) > RETENTION)
        {
            return Err(AppError::new(
                "requestExpired",
                "请求明细已过期，旧请求 ID 不会重新执行。",
                false,
            ));
        }
        let mut record = inner.records.get(&key).cloned();
        if inner.poisoned {
            if let Some(r) = record.as_mut().filter(|r| r.task_status == "running") {
                r.task_status = "interrupted".into();
                for e in &mut r.entries {
                    if matches!(e.state.as_str(), "waiting" | "running") {
                        e.state = if e.attempted {
                            "unconfirmed"
                        } else {
                            "cancelled"
                        }
                        .into();
                        e.issue = Some("请求日志不可写，已停止后续操作。".into());
                    }
                }
            }
        }
        Ok(record)
    }
    pub fn admit(&self, record: Record) -> Result<bool> {
        uuid::Uuid::parse_str(&record.request_id)
            .map_err(|_| AppError::invalid("requestId 必须为 UUID。"))?;
        let mut inner = self.inner.lock().map_err(failure)?;
        let key = key(&record.scope, &record.request_id);
        if inner.expired.contains_key(&key) {
            return Err(AppError::new(
                "requestExpired",
                "旧请求 ID 已过期，不会重新执行。",
                false,
            ));
        }
        if let Some(old) = inner.records.get(&key) {
            if now_ms().saturating_sub(old.created_at) > RETENTION {
                return Err(AppError::new(
                    "requestExpired",
                    "旧请求 ID 已过期，不会重新执行。",
                    false,
                ));
            }
            if old.fingerprint != record.fingerprint || old.home != record.home {
                return Err(AppError::new(
                    "requestConflict",
                    "相同请求 ID 的目标或参数不同。",
                    false,
                ));
            }
            return Ok(false);
        }
        if inner
            .records
            .values()
            .filter(|r| r.task_status == "running")
            .count()
            >= 128
        {
            return Err(AppError::new("busy", "运行中的控制任务已达上限。", true));
        }
        Self::append(
            &mut inner,
            Event::Admit {
                record: Box::new(record),
            },
        )?;
        Ok(true)
    }
    pub fn resolve(&self, mut record: Record) -> Result<()> {
        let mut inner = self.inner.lock().map_err(failure)?;
        let old = inner
            .records
            .get(&key(&record.scope, &record.request_id))
            .ok_or_else(|| failure("missing receipt"))?;
        if old.phase != "resolving"
            || old.task_status != "running"
            || old.fingerprint != record.fingerprint
            || old.home != record.home
            || old.target != record.target
            || old.on != record.on
            || old.created_at != record.created_at
            || old.deadline != record.deadline
            || !old.targets.is_empty()
        {
            return Err(AppError::new(
                "requestConflict",
                "任务目标已经固定，不能再次解析。",
                false,
            ));
        }
        record.phase = if record.task_status == "completed" && record.targets.is_empty() {
            "resolutionFailed"
        } else {
            "executing"
        }
        .into();
        record.revision = old.revision + 1;
        Self::append(
            &mut inner,
            Event::Resolve {
                record: Box::new(record),
            },
        )
    }
    pub fn entry(&self, scope: &str, id: &str, index: usize, entry: Entry) -> Result<()> {
        let mut inner = self.inner.lock().map_err(failure)?;
        if !inner.records.contains_key(&key(scope, id)) {
            return Err(failure("missing job"));
        }
        Self::append(
            &mut inner,
            Event::Entry {
                key: key(scope, id),
                index,
                entry,
            },
        )
    }
    pub fn end(
        &self,
        scope: &str,
        id: &str,
        status: &str,
        legacy_result: Option<Value>,
    ) -> Result<()> {
        let mut inner = self.inner.lock().map_err(failure)?;
        Self::append(
            &mut inner,
            Event::End {
                key: key(scope, id),
                status: status.into(),
                legacy_result,
            },
        )
    }
    pub fn assistant(&self,scope:&str,id:&str,task:crate::cloud_assistant::execution::Task)->Result<()> {
        let mut inner=self.inner.lock().map_err(failure)?;
        if !inner.records.get(&key(scope,id)).is_some_and(|r|r.assistant.is_some()&&r.task_status=="running"){return Err(failure("missing or settled assistant job"))}
        Self::append(&mut inner,Event::Assistant{key:key(scope,id),task})
    }
    pub fn maintain(&self) -> Result<()> {
        let mut inner = self.inner.lock().map_err(failure)?;
        let now = now_ms();
        if now.saturating_sub(inner.last_gc) < 3600000 {
            return Ok(());
        }
        inner.last_gc = now;
        if inner.poisoned {
            return Err(failure("poisoned journal"));
        }
        let expired = inner
            .records
            .values()
            .filter(|r| now.saturating_sub(r.created_at) > RETENTION)
            .map(|r| Event::Expired {
                key: key(&r.scope, &r.request_id),
                fingerprint: r.fingerprint.clone(),
                home: r.home.clone(),
            })
            .collect::<Vec<_>>();
        if expired.is_empty() {
            return Ok(());
        }
        for event in expired {
            Self::append(&mut inner, event)?;
        }
        let path = self
            .path
            .with_extension(format!("{}.tmp", uuid::Uuid::new_v4()));
        let result = (|| {
            let mut output = OpenOptions::new()
                .create_new(true)
                .append(true)
                .read(true)
                .open(&path)
                .map_err(failure)?;
            for record in inner.records.values() {
                Self::write(
                    &mut output,
                    &Event::Admit {
                        record: Box::new(record.clone()),
                    },
                )?;
            }
            for (k, e) in &inner.expired {
                Self::write(
                    &mut output,
                    &Event::Expired {
                        key: k.clone(),
                        fingerprint: e.fingerprint.clone(),
                        home: e.home.clone(),
                    },
                )?;
            }
            output.sync_all().map_err(failure)?;
            let original = std::mem::replace(&mut inner.file, output);
            drop(original);
            std::fs::rename(&path, &self.path).map_err(failure)?;
            Ok(())
        })();
        if result.is_err() {
            inner.poisoned = true;
        }
        result
    }
    #[cfg(test)]
    pub(super) fn fail_storage(&self) {
        self.inner.lock().unwrap().file = File::open(&self.path).unwrap();
    }
    pub fn path(&self) -> &Path {
        &self.path
    }
}
