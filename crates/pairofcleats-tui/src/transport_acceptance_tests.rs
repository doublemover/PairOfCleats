use super::*;
use std::io::{Cursor, Read, Seek, SeekFrom};

fn model() -> AppModel {
    AppModel::new(
        "transport-acceptance".into(),
        TerminalCapabilities {
            color: false,
            unicode: true,
            mouse: false,
            alt_screen: false,
        },
        None,
    )
}

// Consume the original bounded production reader/channel concurrently; a full
// channel cannot deadlock an in-memory fixture before its consumer starts.
pub(super) fn deliver(bytes: Vec<u8>, model: &mut AppModel, delay: Duration) -> usize {
    let (sender, receiver) = event_ingress::channel();
    std::thread::scope(|scope| {
        let reader =
            scope.spawn(move || supervisor_transport::read_events(Cursor::new(bytes), &sender));
        let mut count = 0;
        loop {
            match receiver.try_recv() {
                Ok(event) => {
                    let consumed_at = event.received_at + delay;
                    apply_ingress_event_at(model, event, consumed_at);
                    count += 1;
                }
                Err(std::sync::mpsc::TryRecvError::Empty) => std::thread::yield_now(),
                Err(std::sync::mpsc::TryRecvError::Disconnected) => break,
            }
        }
        reader.join().unwrap().unwrap();
        assert_eq!(receiver.pending(), 0);
        count
    })
}

#[test]
fn real_producer_pressure_keeps_chunked_success_failure_and_restarted_instances() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = process_command::background_command("node")
        .arg("tests/helpers/tui/lifecycle-pressure-frames.js")
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.len() < 8 * 1024 * 1024);
    let mut actual = model();
    let frames = deliver(output.stdout, &mut actual, Duration::from_millis(75));
    assert!(frames > 2048 && frames < 4096);
    for job in ["active-a", "active-b"] {
        assert_eq!(actual.job_status[job], "running");
        for (task, wanted) in [
            ("done", Lifecycle::Done),
            ("failed", Lifecycle::Failed),
            ("restart", Lifecycle::Done),
            ("still-active", Lifecycle::Active),
        ] {
            let key = json!([job, task]).to_string();
            assert_eq!(actual.task_status[&key].lifecycle(), wanted, "{job}/{task}");
        }
    }
    assert_eq!(actual.telemetry.lifecycle_dropped, 0);
    assert_eq!(actual.telemetry.dropped_chunks, 0);
    assert_eq!(actual.telemetry.chunk_reassembled, 4);
    assert_eq!(actual.telemetry.event_lag_ms_ewma, Some(75.0));
}

#[test]
fn actual_lifecycle_loss_notice_marks_uncertain_tasks_without_losing_critical_job_outcomes() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = process_command::background_command("node")
        .args(["tests/helpers/tui/lifecycle-pressure-frames.js", "loss"])
        .current_dir(root)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let mut actual = model();
    deliver(output.stdout, &mut actual, Duration::from_millis(75));
    assert_eq!(actual.job_status["active-a"], "running");
    assert_eq!(actual.job_status["independent-terminal"], "failed");
    assert_eq!(
        actual.task_status[&json!(["active-a", "lost-terminal"]).to_string()].lifecycle(),
        Lifecycle::Unknown
    );
    assert_eq!(actual.telemetry.lifecycle_dropped, 1);
    assert!(actual
        .task_status
        .values()
        .all(|task| task.lifecycle() != Lifecycle::Active));
}

#[test]
fn production_reader_latency_reaches_render_and_export_without_fake_backlog_samples() {
    let path = std::env::current_dir().unwrap().join(".tmp").join(format!(
        "tui-latency-{}-{}.jsonl",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    let file = fs::OpenOptions::new()
        .read(true)
        .write(true)
        .create_new(true)
        .open(&path)
        .unwrap();
    let mut exported = file.try_clone().unwrap();
    let mut actual = model();
    actual.telemetry_file = Some(file);
    assert_eq!(actual.telemetry.event_lag_ms_ewma, None);
    assert!(runtime_summary_text(&actual, 4096).contains("ingress lag ?ms"));
    let mut bytes = b"{\"event\":\"runtime:metrics\",\"flow\":{\"queueDepth\":42}}\n".to_vec();
    for _ in 0..100 {
        bytes.extend_from_slice(
            b"{\"event\":\"log\",\"ts\":\"1900-01-01T00:00:00.000Z\",\"message\":\"ordinary\"}\n",
        );
    }
    assert_eq!(deliver(bytes, &mut actual, Duration::from_millis(75)), 101);
    assert_eq!(actual.telemetry.event_lag_ms_ewma, Some(75.0));
    assert_eq!(actual.telemetry.queue_depth_ewma, Some(42.0));
    assert_eq!(actual.telemetry.native_inbound_pending, Some(0));
    assert!(runtime_summary_text(&actual, 4096).contains("ingress lag 75ms"));
    let before = actual.telemetry.event_lag_ms_ewma;
    // An idle render/export consumes no new ingress observation.
    actual.last_metrics_emit = Instant::now() - METRICS_EMIT_INTERVAL;
    append_runtime_metrics(&mut actual);
    assert_eq!(actual.telemetry.event_lag_ms_ewma, before);
    exported.seek(SeekFrom::Start(0)).unwrap();
    let mut body = String::new();
    exported.read_to_string(&mut body).unwrap();
    let value: Value = serde_json::from_str(body.lines().last().unwrap()).unwrap();
    assert_eq!(value["eventLagMsEwma"], 75.0);
    assert_eq!(value["queueDepthEwma"], 42.0);
    assert_eq!(value["nativeInboundPending"], 0);
    // A second real reader receives a fresh local stamp, not upstream wall age.
    deliver(
        b"{\"event\":\"hello\",\"runId\":\"resumed\"}\n".to_vec(),
        &mut actual,
        Duration::from_millis(175),
    );
    assert!(actual.telemetry.event_lag_ms_ewma.unwrap() > 75.0);
    assert!(actual.telemetry.event_lag_ms_ewma.unwrap() < 175.0);
    drop(actual);
    drop(exported);
    fs::remove_file(path).unwrap();
}
