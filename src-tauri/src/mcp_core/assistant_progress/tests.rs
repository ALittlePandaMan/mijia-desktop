use super::*;
use crate::cloud_assistant::{self as assistant, protocol, transport::{Wire, Endpoint, Emit, Io}};
use crate::auth::Credentials;
use serde_json::{json, Value};
use std::{path::PathBuf, sync::atomic::{AtomicUsize, Ordering}};

fn store(name: &str) -> (PathBuf, Arc<Journal>, super::super::journal::Record) {
    let root = std::env::temp_dir().join(format!("mijia-progress-{name}-{}", uuid::Uuid::new_v4()));
    std::fs::create_dir(&root).unwrap();
    let journal = Arc::new(Journal::open(root.join("requests.jsonl")).unwrap());
    let mut record = super::super::assistant_result::tests::fixture("");
    record.task_status = "running".into();
    let task = record.assistant.as_mut().unwrap(); task.remote = None; task.phase = "queued".into();
    task.scope.home_id = "1".into(); task.scope.owner_uid = "1".into();
    journal.admit(record.clone()).unwrap();
    (root, journal, record)
}
fn answer() -> protocol::Event { protocol::event("ANSWER", json!({"delta":"synthetic progress"})).unwrap() }

#[test]
fn duplicate_bounded_progress_does_not_write_but_phase_and_submit_boundaries_do() {
    let (root, journal, record) = store("coalesce");
    let recorder = Recorder::new(journal.clone(), record.scope.clone(), record.request_id.clone(), Instant::now(), CancellationToken::new());
    let writes = (0..1000).filter(|_| recorder.record(answer())).count(); assert_eq!(writes, 100);
    let before = std::fs::metadata(root.join("requests.jsonl")).unwrap().len();
    let mut event = answer(); event.status = "tool".into(); assert!(recorder.record(event));
    let submit = || protocol::Event { kind:"SUBMIT".into(),status:"submitting".into(),content:String::new(),session_id:String::new(),turn_id:String::new(),code:None,recoverable:false,answer_snapshot:false,metadata:vec![] };
    assert!(recorder.record(submit())); assert!(recorder.record(submit()));
    let current = journal.lookup(&record.scope, &record.request_id).unwrap().unwrap();
    let task = current.assistant.unwrap(); assert!(task.request_attempted); assert!(task.request_submitted.is_none());
    assert_eq!(task.events.len(), 100); assert_eq!(task.trace.len(), 100);
    assert!(std::fs::metadata(root.join("requests.jsonl")).unwrap().len() > before);
    journal.end(&record.scope, &record.request_id, "completed", None).unwrap();
    let revision = journal.lookup(&record.scope, &record.request_id).unwrap().unwrap().revision;
    assert!(!recorder.record(answer()));
    assert_eq!(journal.lookup(&record.scope, &record.request_id).unwrap().unwrap().revision, revision);
}

#[derive(Default)]
struct NoSubmission(AtomicUsize);
impl Wire for NoSubmission {
    fn scope<'a>(&'a self, _: &'a str, _: CancellationToken) -> Io<'a, String> { Box::pin(async { panic!("unexpected authorization") }) }
    fn post<'a>(&'a self, _: &'a Credentials, _: &'a str, _: Endpoint, _: Value, _: &'a str, _: CancellationToken) -> Io<'a, Value> {
        Box::pin(async move { self.0.fetch_add(1, Ordering::SeqCst); Ok(json!({})) })
    }
    fn stream<'a>(&'a self, _: &'a Credentials, _: &'a str, _: &'a str, _: &'a str, _: CancellationToken, _: Emit) -> Io<'a, ()> {
        Box::pin(async move { self.0.fetch_add(1, Ordering::SeqCst); Ok(()) })
    }
}
#[tokio::test]
async fn production_recorder_disk_failure_cancels_before_simple_or_complex_submission() {
    for route in ["simple", "complex"] {
        let (_, journal, record) = store(route);
        let proof = assistant::scope::delegate(record.assistant.as_ref().unwrap().scope.clone(), &["1".into()]).unwrap();
        let cancel = CancellationToken::new();
        let recorder = Arc::new(Recorder::new(journal.clone(), record.scope.clone(), record.request_id.clone(), Instant::now(), cancel.clone()));
        let mut queued = record.clone(); queued.request_id = uuid::Uuid::new_v4().to_string(); journal.admit(queued.clone()).unwrap();
        journal.fail_storage();
        let credentials = Credentials { user_id:"1".into(),security:"AAECAwQFBgcICQoLDA0ODw==".into(),service_token:"synthetic".into(),region:"cn".into(),device_id:"mock".into(),service_id:"mijia".into(),c_user_id:"mock".into() };
        let request = protocol::Request {query:"模拟请求".into(),complexity:route.into(),request_id:record.request_id.clone(),home_id:Some("1".into())};
        let wire = Arc::new(NoSubmission::default()); let progress = recorder.clone();
        let dispatcher = assistant::dispatch::Dispatcher::default();
        let result = dispatcher.run(&cancel, assistant::execution::run(wire.clone(), &credentials, "synthetic", &request, &proof, cancel.clone(), Arc::new(move |event| { progress.record(event); }))).await;
        assert_eq!(result.unwrap_err().kind, "assistantCancelled");
        assert_eq!(recorder.error().unwrap().kind, "journalUnavailable");
        assert_eq!(wire.0.load(Ordering::SeqCst), 0); assert!(cancel.is_cancelled());
        let cancel = CancellationToken::new();
        let queued_progress = Arc::new(Recorder::new(journal.clone(),queued.scope.clone(),queued.request_id.clone(),Instant::now(),cancel.clone()));
        let mut request = request.clone(); request.request_id = queued.request_id;
        let result = dispatcher.run(&cancel,assistant::execution::run(wire.clone(),&credentials,"synthetic",&request,&proof,cancel.clone(),Arc::new(move|event|{queued_progress.record(event);}))).await;
        assert_eq!(result.unwrap_err().kind,"assistantCancelled");assert!(cancel.is_cancelled());assert_eq!(wire.0.load(Ordering::SeqCst),0);
    }
}

#[test]
#[ignore = "explicit offline journal IO benchmark"]
fn benchmark_duplicate_progress_journal_io() {
    let output = PathBuf::from(std::env::var("MIJIA_PROGRESS_BENCHMARK_OUTPUT").expect("explicit local report path"));
    let root = output.parent().unwrap().join(format!("progress-io-{}", uuid::Uuid::new_v4())); std::fs::create_dir_all(&root).unwrap();
    let mut samples = vec![];
    for repeat in 0..3 {
        let mut record = super::super::assistant_result::tests::fixture(""); record.task_status = "running".into();
        let task = record.assistant.as_mut().unwrap(); task.remote = None; task.phase = "queued".into();
        let old_path = root.join(format!("old-{repeat}.jsonl")); let new_path = root.join(format!("new-{repeat}.jsonl"));
        let old = Arc::new(Journal::open(old_path.clone()).unwrap()); old.admit(record.clone()).unwrap();
        let started = Instant::now();
        for _ in 0..1000 { let mut task = old.lookup(&record.scope, &record.request_id).unwrap().unwrap().assistant.unwrap(); task.record_progress(answer(),started.elapsed().as_millis() as u64); old.assistant(&record.scope,&record.request_id,task).unwrap(); }
        let old_ms = started.elapsed().as_secs_f64()*1000.;
        let new = Arc::new(Journal::open(new_path.clone()).unwrap()); new.admit(record.clone()).unwrap();
        let recorder = Recorder::new(new.clone(),record.scope.clone(),record.request_id.clone(),Instant::now(),CancellationToken::new());
        let started = Instant::now(); let writes = (0..1000).filter(|_|recorder.record(answer())).count(); let new_ms=started.elapsed().as_secs_f64()*1000.;
        assert_eq!(writes,100);
        let normalize = |journal:&Journal| { let mut task=journal.lookup(&record.scope,&record.request_id).unwrap().unwrap().assistant.unwrap(); for stage in &mut task.trace {stage.elapsed_ms=0;} serde_json::to_value(task).unwrap() };
        assert_eq!(normalize(&old),normalize(&new));
        samples.push(json!({"repeat":repeat,"events":1000,"oldWrites":1000,"newWrites":writes,"oldMs":old_ms,"newMs":new_ms,"oldBytes":std::fs::metadata(&old_path).unwrap().len(),"newBytes":std::fs::metadata(&new_path).unwrap().len()}));
    }
    let report=json!({"mockOnly":true,"deviceWrites":0,"method":"same production Journal; persist-every-callback baseline versus production Recorder","samples":samples});
    std::fs::write(&output,serde_json::to_vec_pretty(&report).unwrap()).unwrap(); println!("{report}");
}
