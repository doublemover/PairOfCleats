use super::*;

struct InputChild(std::process::Child);
impl std::ops::Deref for InputChild {
    type Target = std::process::Child;
    fn deref(&self) -> &Self::Target { &self.0 }
}
impl std::ops::DerefMut for InputChild {
    fn deref_mut(&mut self) -> &mut Self::Target { &mut self.0 }
}
impl Drop for InputChild {
    fn drop(&mut self) { let _ = self.0.kill(); let _ = self.0.wait(); }
}

fn model() -> AppModel {
    AppModel::new("ingress-test".into(), TerminalCapabilities {
        color: false, unicode: true, mouse: false, alt_screen: false,
    }, None)
}

#[test]
fn queued_keys_observe_prior_modal_transitions_on_both_sides_of_the_dispatch_boundary() {
    let mut model = model();
    let mut child = InputChild(Command::new("node").args(["-e", "process.stdin.resume()"])
        .stdin(Stdio::piped()).spawn().unwrap());
    let start = Instant::now();
    model.last_input_at = start;
    for code in [KeyCode::Char('/'), KeyCode::Char('q')] {
        enqueue_terminal_key(&mut model, KeyEvent::new(code, KeyModifiers::NONE));
    }
    let mut job = 0;
    assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None, start + Duration::from_millis(24)).unwrap());
    assert_eq!(model.input_queue.len(), 2);
    for milliseconds in [25, 50] {
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis(milliseconds)).unwrap(), "search text cannot become Quit");
    }
    assert_eq!(model.search_draft, "q");
    for code in [KeyCode::Esc, KeyCode::Char('/'), KeyCode::Char('e'), KeyCode::Char('e')] {
        enqueue_terminal_key(&mut model, KeyEvent::new(code, KeyModifiers::NONE));
    }
    for milliseconds in [75, 100, 125, 150] {
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis(milliseconds)).unwrap());
    }
    assert_eq!(model.search_draft, "ee");
    model.overlay = OverlayMode::None;
    model.palette_index = palette_actions().iter().position(|action| matches!(action, PaletteAction::Settings)).unwrap();
    for code in [KeyCode::Char(':'), KeyCode::Enter, KeyCode::Char('q')] {
        enqueue_terminal_key(&mut model, KeyEvent::new(code, KeyModifiers::NONE));
    }
    for milliseconds in [175, 200, 225] {
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis(milliseconds)).unwrap(), "settings-owned text cannot become a global shortcut");
    }
    assert!(model.overlay == OverlayMode::Settings);
    let _ = child.kill(); let _ = child.wait();
}

#[test]
fn real_ingress_residence_is_measured_without_invented_supervisor_depth_samples() {
    let mut model = model();
    assert_eq!(model.telemetry.event_lag_ms_ewma, None);
    assert_eq!(model.telemetry.queue_depth_ewma, None);
    let entered = Instant::now();
    let (sender, receiver) = event_ingress::channel();
    sender.send_at(json!({"event":"runtime:metrics","flow":{"queueDepth":42}}), entered).unwrap();
    apply_ingress_event_at(&mut model, receiver.try_recv().unwrap(), entered + Duration::from_millis(75));
    assert_eq!(model.telemetry.event_lag_ms_ewma, Some(75.0));
    for _ in 0..100 {
        sender.send_at(json!({"event":"log","message":"ordinary"}), entered).unwrap();
        apply_ingress_event_at(&mut model, receiver.try_recv().unwrap(), entered + Duration::from_millis(75));
    }
    assert_eq!(model.telemetry.queue_depth_ewma, Some(42.0));
    assert_eq!(model.telemetry.native_inbound_pending, Some(0));
    let mut replay = self::model();
    apply_protocol_event(&mut replay, json!({"event":"log","message":"saved"}), 999);
    assert_eq!(replay.telemetry.event_lag_ms_ewma, None, "replay cannot manufacture live age from queue length");
}

#[test]
fn actual_javascript_flow_keeps_terminal_task_state_while_its_job_remains_active() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node").arg("tests/helpers/tui/lifecycle-flow.js").current_dir(root).output().unwrap();
    assert!(output.status.success());
    let mut model = model();
    for line in String::from_utf8(output.stdout).unwrap().lines() {
        apply_protocol_event(&mut model, serde_json::from_str(line).unwrap(), 0);
    }
    let key = json!(["still-running-job", "finished-task"]).to_string();
    assert_eq!(model.task_status[&key].lifecycle(), Lifecycle::Done);
    assert_eq!(model.job_status["still-running-job"], "running");
    apply_protocol_event(&mut model, json!({"event":"task:progress","jobId":"still-running-job",
        "taskId":"finished-task","status":"running"}), 0);
    assert_eq!(model.task_status[&key].lifecycle(), Lifecycle::Done, "late progress cannot resurrect terminal state");
    apply_protocol_event(&mut model, json!({"event":"task:start","jobId":"still-running-job",
        "taskId":"finished-task","status":"running"}), 0);
    assert_eq!(model.task_status[&key].lifecycle(), Lifecycle::Active, "explicit restart establishes a new task instance");
    apply_protocol_event(&mut model, json!({"event":"runtime:metrics","flow":{"lifecycleDropped":1}}), 0);
    assert_eq!(model.task_status[&key].lifecycle(), Lifecycle::Unknown);
}
