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
    model.owns_control_channel = true; model.session.controllable = true; model.settings.available = true;
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

#[test]
fn sustained_ingress_yields_to_quit_and_render_without_backlog_idle_waits() {
    let now = Instant::now();
    let mut model = model();
    let produced = std::cell::Cell::new(0);
    let mut consumed = Vec::new();
    let count = drain_ingress_turn(|| {
        let index = produced.get(); produced.set(index + 1);
        Some(event_ingress::InboundEvent { value: json!({"event":"log","message":index.to_string()}),
            received_at: now, pending_at_dispatch: 4096 })
    }, |event| { consumed.push(event.value["message"].as_str().unwrap().parse::<usize>().unwrap());
        apply_ingress_event_at(&mut model, event, now); }, || Duration::ZERO);
    assert_eq!(count, INGRESS_EVENTS_PER_TURN);
    assert_eq!(produced.get(), INGRESS_EVENTS_PER_TURN as usize);
    assert_eq!(consumed, (0..count as usize).collect::<Vec<_>>());
    // The producer still has data. A UI turn reaches input and due drawing now,
    // rather than waiting for this deliberately inexhaustible source to empty.
    enqueue_terminal_key(&mut model, KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL));
    assert!(matches!(model.input_queue.front(), Some((_, InputCommand::Quit))));
    assert!(model.dirty);
    let mut terminal = Terminal::new(TestBackend::new(80, 24)).unwrap();
    terminal.draw(|frame| render_ui(frame, &model)).unwrap();
    assert!(terminal.backend().buffer().content().iter().any(|cell| cell.symbol() != " "));
    let mut child = InputChild(Command::new("node").args(["-e", "process.stdin.resume()"])
        .stdin(Stdio::piped()).spawn().unwrap());
    let mut job = 0;
    assert!(dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None, now).unwrap(),
        "queued quit dispatches while the producer remains nonempty");
    assert_eq!(input_poll_wait(4096, false), Duration::ZERO);
    assert_eq!(input_poll_wait(0, true), Duration::ZERO);
    assert_eq!(input_poll_wait(0, false), INPUT_POLL_INTERVAL);

    let elapsed = std::cell::Cell::new(Duration::ZERO);
    let mut applications = 0;
    let consumed = drain_ingress_turn(|| Some(event_ingress::InboundEvent {
        value: json!({"event":"runtime:metrics"}), received_at: now, pending_at_dispatch: 1 }),
        |_| { applications += 1; elapsed.set(INGRESS_TURN_BUDGET); }, || elapsed.get());
    assert_eq!(consumed, 1, "elapsed-time admission also yields before the count cap");
    assert_eq!(applications, 1);
}

#[test]
fn bounded_turns_preserve_finite_channel_order_and_charge_only_consumed_frames() {
    let now = Instant::now();
    let (sender, receiver) = event_ingress::channel();
    let mut actual = model();
    let mut reference = model();
    for index in 0..300 {
        let value = if index == 0 { json!({"event":"job:start","jobId":"owned"}) }
            else if index == 299 { json!({"event":"job:end","jobId":"owned","status":"done"}) }
            else { json!({"event":"log","jobId":"owned","message":format!("event {index}")}) };
        apply_protocol_event(&mut reference, value.clone(), 0);
        sender.send_at(value, now).unwrap();
    }
    let mut credits = 0;
    while receiver.pending() > 0 {
        let before = receiver.pending();
        let count = drain_ingress_turn(|| receiver.try_recv().ok(),
            |event| apply_ingress_event_at(&mut actual, event, now), || Duration::ZERO);
        assert_eq!(before - receiver.pending(), count as usize);
        assert!(count <= INGRESS_EVENTS_PER_TURN);
        credits += count;
    }
    assert_eq!(credits, 300);
    assert_eq!(actual.job_status, reference.job_status);
    assert_eq!(actual.logs.iter().map(|entry| &entry.text).collect::<Vec<_>>(),
        reference.logs.iter().map(|entry| &entry.text).collect::<Vec<_>>());
}

#[test]
fn compact_frame_keys_exclude_retained_text_and_track_same_count_mutations() {
    let mut model = model();
    let empty_key = frame_signature(&model);
    for _ in 0..LOG_RING_LIMIT { model.push_log("payload-never-in-frame-key".repeat(180)); }
    let full_key = frame_signature(&model);
    assert!(full_key.len() < 4096);
    assert!(!full_key.contains("payload-never-in-frame-key"));
    assert_ne!(empty_key, full_key);
    for input in ["focus_logs", "logs_up", "toggle_help", "toggle_help", "toggle_follow"] {
        let before = frame_signature(&model);
        apply_local_input(&mut model, input);
        let after = frame_signature(&model);
        assert_ne!(before, after, "view mutation {input}");
        assert!(after.len() < 4096 && !after.contains("payload-never-in-frame-key"));
    }
    let before = frame_signature(&model);
    model.push_log("evicts one retained entry".into());
    assert_eq!(model.logs.len(), LOG_RING_LIMIT);
    assert_ne!(before, frame_signature(&model));
    model.update_job_status("job", "running", Some("original"));
    let before = frame_signature(&model);
    model.update_job_status("job", "running", Some("same-count title replacement"));
    assert_ne!(before, frame_signature(&model));
    model.update_task_status("job", "task", "running", Some("first"));
    let before = frame_signature(&model);
    model.update_task_status("job", "task", "running", Some("same-count message replacement"));
    assert_ne!(before, frame_signature(&model));
    let before = frame_signature(&model);
    model.flow_credit_pending += 1;
    model.telemetry.render_ms_ewma += 5.0;
    model.last_metrics_emit = Instant::now();
    assert_eq!(before, frame_signature(&model));
    model.terminal_caps.color = !model.terminal_caps.color;
    assert_ne!(before, frame_signature(&model));
}

#[test]
fn job_and_task_presentation_is_bounded_by_the_admitted_viewport() {
    let mut model = model();
    for index in 0..JOB_RING_LIMIT {
        model.update_job_status(&format!("job-{index:04}"), "running", Some("日本語 work"));
    }
    model.selected_job = Some("job-0400".into()); model.selected_job_pinned = true;
    for index in 0..TASK_RING_LIMIT {
        model.update_task_status("job-0400", &format!("task-{index:04}"), "running", Some("work 😀"));
    }
    for query in ["", "日本語", "job-04", "absent"] {
        model.search_jobs = query.into();
        for scroll in [0, 250, usize::MAX] {
            model.job_scroll = scroll;
            ROW_PRESENTATIONS.with(|count| count.set((0,0)));
            let ids = visible_job_ids(&model);
            let start = scroll.min(ids.len().saturating_sub(20));
            let expected_selected = ids.iter().position(|id| Some(*id) == model.selected_job.as_deref())
                .filter(|index| *index >= start && *index < start + 20).map(|index| index-start);
            let (rows, marker) = build_job_rows(&model, 80, 20);
            assert!(rows.len() <= 20);
            assert_eq!(marker, expected_selected);
            assert_eq!(ROW_PRESENTATIONS.with(|count| count.get().0), ids.len().saturating_sub(start).min(20));
        }
    }
    for query in ["", "work 😀", "task-10", "absent"] {
        model.search_tasks = query.into();
        for scroll in [0, 1000, usize::MAX] {
            model.task_scroll = scroll;
            ROW_PRESENTATIONS.with(|count| count.set((0,0)));
            let rows = build_task_rows(&model, 80, 20);
            assert!(rows.len() <= 20);
            let rendered = ROW_PRESENTATIONS.with(|count| count.get().1);
            assert!(rendered <= 20);
            if query != "absent" { assert_eq!(rendered, 20); }
        }
    }
    model.selected_job_expired = true;
    ROW_PRESENTATIONS.with(|count| count.set((0,0)));
    assert_eq!(build_task_rows(&model, 80, 20).len(), 1);
    assert_eq!(ROW_PRESENTATIONS.with(|count| count.get()), (0,0));
    assert!(build_task_rows(&model, 80, 0).is_empty());
    assert!(build_job_rows(&model, 80, 0).0.is_empty());
}

#[test]
fn actual_dispatch_keeps_paste_inert_and_grapheme_cursor_edits_in_the_focused_field() {
    let mut model = model();
    let mut child = InputChild(Command::new("node").args(["-e", "process.stdin.resume()"])
        .stdin(Stdio::piped()).spawn().unwrap());
    let start = Instant::now(); model.last_input_at = start;
    model.overlay = OverlayMode::Search; model.search_draft = "A界e\u{301}😀Z".into();
    let mut job = 0;
    for (turn, input) in [InputCommand::TerminalKey(KeyCode::Home.into()),
        InputCommand::TerminalKey(KeyCode::Right.into()), InputCommand::TerminalKey(KeyCode::Delete.into()),
        InputCommand::Paste("q\n\u{1b}\u{3}; rm -rf".into())].into_iter().enumerate() {
        enqueue_input(&mut model, input, "actual-paste-and-cursor");
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis((turn as u64 + 1) * 25)).unwrap());
    }
    assert_eq!(model.search_draft, "Aq ; rm -rfe\u{301}😀Z");
    assert!(model.overlay == OverlayMode::Search && model.search_jobs.is_empty());
    assert_eq!(job, 0, "pasted control and shell-looking text cannot start or cancel work");
    enqueue_terminal_key(&mut model, KeyCode::Enter.into());
    assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
        start + Duration::from_millis(125)).unwrap());
    assert_eq!(model.search_jobs, "Aq ; rm -rfe\u{301}😀Z");
    model.settings.available = true; model.overlay = OverlayMode::Settings;
    model.settings.open("initial directory");
    enqueue_terminal_key(&mut model, KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
    enqueue_input(&mut model, InputCommand::Paste("C:/界/qq\n\u{1b}\u{3}".into()), "scope-paste");
    for milliseconds in [150, 175] {
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis(milliseconds)).unwrap());
    }
    assert!(model.settings.outbox.is_empty());
    enqueue_terminal_key(&mut model, KeyCode::Enter.into());
    assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
        start + Duration::from_millis(200)).unwrap());
    assert_eq!(model.settings.outbox.back().unwrap()["params"]["target"], "C:/界/qq ");
    assert_eq!(model.settings.outbox.back().unwrap()["method"], "select");
}

#[test]
fn queued_mouse_respects_prior_focus_and_passive_palette_admission() {
    use crossterm::event::{MouseEvent, MouseEventKind, MouseButton};
    let mut model = model(); model.terminal_caps.mouse = true;
    model.update_job_status("rendered-job", "running", None); model.selected_job_pinned = false;
    let mut terminal = Terminal::new(TestBackend::new(80,24)).unwrap();
    terminal.draw(|frame| render_ui(frame, &model)).unwrap();
    enqueue_terminal_key(&mut model, KeyCode::Tab.into());
    interaction::mouse(&mut model, MouseEvent { kind: MouseEventKind::Down(MouseButton::Left),
        column: 4, row: 3, modifiers: KeyModifiers::NONE });
    let mut child = InputChild(Command::new("node").args(["-e", "process.stdin.resume()"])
        .stdin(Stdio::piped()).spawn().unwrap());
    let mut job = 0; let start = Instant::now(); model.last_input_at = start;
    for milliseconds in [25, 50] {
        assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
            start + Duration::from_millis(milliseconds)).unwrap());
    }
    assert!(model.focus_panel == FocusPanel::Tasks && !model.selected_job_pinned);
    model.overlay = OverlayMode::Palette;
    model.palette_index = palette_actions().iter().position(|action| *action == PaletteAction::Settings).unwrap();
    enqueue_terminal_key(&mut model, KeyCode::Enter.into());
    assert!(!dispatch_input_with_recordings_at(&mut model, &mut child, &mut job, None,
        start + Duration::from_millis(75)).unwrap());
    assert!(model.overlay == OverlayMode::Palette && model.settings.outbox.is_empty());
}
