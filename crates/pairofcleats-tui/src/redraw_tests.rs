use super::*;

#[test]
fn actual_javascript_unicode_frames_decode_and_settle_terminal_jobs() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let output = Command::new("node")
        .arg("tests/helpers/tui/unicode-frames.js")
        .current_dir(root)
        .output()
        .expect("launch bounded actual producer fixture");
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(output.stdout.len() < 8 * 1024 * 1024);
    let mut expected = BTreeMap::new();
    let mut observed = BTreeMap::new();
    let mut model = model();
    for line in String::from_utf8(output.stdout).unwrap().lines() {
        let frame: Value = serde_json::from_str(line)
            .expect("each actual wire frame must decode with serde_json Value");
        if frame["event"] == "fixture:expected" {
            expected.insert(
                frame["jobId"].as_str().unwrap().to_owned(),
                frame["value"].as_str().unwrap().to_owned(),
            );
            continue;
        }
        let rebuilt = handle_chunk_event(&mut model, &frame);
        if let Some(event) = rebuilt {
            observed.insert(
                event["jobId"].as_str().unwrap().to_owned(),
                event["result"]["value"].as_str().unwrap().to_owned(),
            );
            apply_protocol_event(&mut model, event, 0);
        }
    }
    assert_eq!(observed, expected);
    assert_eq!(model.telemetry.dropped_chunks, 0);
    assert_eq!(job_status_counts(&model).0, 0);
    assert!(model.job_status.values().all(|status| status == "done"));
}

#[test]
fn structured_task_status_ignores_messages_and_terminal_owner_closes_only_its_tasks() {
    for terminal in ["done", "failed", "cancelled"] {
        let mut model = model();
        for job in ["owner", "other"] {
            apply_protocol_event(&mut model, json!({"event":"job:start","jobId":job}), 0);
            apply_protocol_event(
                &mut model,
                json!({"event":"task:progress","jobId":job,"taskId":"live",
                "status":"running","message":"batch done failed cancelled.rs"}),
                0,
            );
        }
        model.update_task_status("owner", "complete", "done", Some("preserved"));
        assert_eq!(task_status_counts(&model), (2, 0));
        model.selected_job = Some("owner".into());
        model.focus_panel = FocusPanel::Tasks;
        model.task_filter = TaskFilter::Active;
        assert!(screen(&model, 80, 24).contains("live"));
        model.task_filter = TaskFilter::Done;
        assert!(!screen(&model, 80, 24).contains("batch done failed"));
        apply_protocol_event(
            &mut model,
            json!({"event":"job:end","jobId":"owner","status":terminal}),
            0,
        );
        assert_eq!(task_status_counts(&model), (1, 1));
        let key = json!(["owner", "complete"]).to_string();
        assert_eq!(model.task_status[&key].status, "done");
        apply_protocol_event(
            &mut model,
            json!({"event":"task:progress","jobId":"owner","taskId":"live","status":"running"}),
            0,
        );
        assert_eq!(
            task_status_counts(&model),
            (1, 1),
            "late progress cannot resurrect terminal ownership"
        );
        assert!(!matches_job_filter(terminal, JobFilter::Active));
        apply_protocol_event(&mut model, json!({"event":"job:start","jobId":"owner"}), 0);
        model.update_task_status("owner", "new", "running", None);
        assert_eq!(task_status_counts(&model), (2, 0));
    }
}

#[test]
fn runtime_metrics_update_telemetry_without_entering_user_logs() {
    let mut model = model();
    model.logs.clear();
    apply_protocol_event(
        &mut model,
        json!({"event":"log","jobId":"selected",
        "message":"retained user log","level":"info"}),
        0,
    );
    let before = model.telemetry.processed_events;
    for _ in 0..100 {
        apply_protocol_event(
            &mut model,
            json!({"event":"runtime:metrics","flow":{"queueDepth":42}}),
            0,
        );
    }
    assert_eq!(model.telemetry.processed_events, before + 100);
    assert!(model
        .telemetry
        .queue_depth_ewma
        .is_some_and(|value| value > 0.0));
    assert_eq!(model.logs.len(), 1);
    assert_eq!(model.logs[0].text, "retained user log");
    assert_eq!(model.logs[0].job_id.as_deref(), Some("selected"));
    apply_protocol_event(
        &mut model,
        json!({"event":"log","message":"session log","level":"info"}),
        0,
    );
    assert_eq!(model.logs.len(), 2);
    assert_eq!(model.logs[1].job_id, None);
}

#[test]
fn an_open_search_recovers_when_its_real_control_handshake_arrives() {
    for (visible, controllable) in [(true, true), (false, true), (true, false)] {
        let mut model = model();
        if visible {
            model.repository_search.open("selected-repository");
            model.overlay = OverlayMode::RepositorySearch;
        }
        assert!(model.repository_search.outbox.is_empty());
        let hello = json!({"event":"hello", "capabilities":{"supportsSearch":true},
            "session":{"mode":"supervised","controllable":controllable,
                "scope":"selected-repository","connection":"connected"}});
        apply_protocol_event(&mut model, hello.clone(), 0);
        assert_eq!(
            model.repository_search.outbox.len(),
            usize::from(visible && controllable)
        );
        if visible && controllable {
            assert_eq!(model.repository_search.outbox[0]["method"], "describe");
        }
        apply_protocol_event(&mut model, hello, 0);
        assert_eq!(
            model.repository_search.outbox.len(),
            usize::from(visible && controllable)
        );
    }
}

#[test]
fn new_job_captures_selected_scope_without_retargeting_an_existing_request() {
    let mut model = model();
    model.settings.scope = Some(json!({"configRoot":"first-repository"}));
    let first = sample_job_request(&model, "first");
    model.settings.scope = Some(json!({"configRoot":"second-repository"}));
    let second = sample_job_request(&model, "second");
    assert_eq!(first["cwd"], "first-repository");
    assert_eq!(second["cwd"], "second-repository");
    let snapshot = serde_json::to_string(&snapshot_from_model(&model)).unwrap();
    assert!(!snapshot.contains("first-repository"));
    assert!(!snapshot.contains("second-repository"));
}

#[test]
fn control_c_is_global_shutdown_in_every_overlay_and_job_state() {
    for overlay in [
        OverlayMode::None,
        OverlayMode::Help,
        OverlayMode::Palette,
        OverlayMode::Search,
        OverlayMode::Settings,
        OverlayMode::RepositorySearch,
        OverlayMode::JobInspection,
    ] {
        for active in [false, true] {
            for (code, modifiers) in [
                (KeyCode::Char('c'), KeyModifiers::CONTROL),
                (
                    KeyCode::Char('C'),
                    KeyModifiers::CONTROL | KeyModifiers::SHIFT,
                ),
            ] {
                let mut model = model();
                model.overlay = overlay;
                model.search_draft = "preserve-search".into();
                if active {
                    model.selected_job = Some("owned-active-job".into());
                    model
                        .job_status
                        .insert("owned-active-job".into(), "running".into());
                }
                model.input_queue.push_back((0, InputCommand::RunJob));
                model
                    .input_queue
                    .push_back((1, InputCommand::SearchChar('x')));
                enqueue_terminal_key(&mut model, KeyEvent::new(code, modifiers));
                let queued_seq = model.next_input_seq;
                let mut repeated = KeyEvent::new(code, modifiers);
                repeated.kind = KeyEventKind::Repeat;
                enqueue_terminal_key(&mut model, repeated);
                assert_eq!(
                    model.next_input_seq, queued_seq,
                    "Repeated interrupt preserves the queued shutdown"
                );
                assert_eq!(model.input_queue.len(), 1);
                assert!(
                    matches!(model.input_queue.front(), Some((_, InputCommand::Quit))),
                    "Ctrl+C must request shutdown before overlay dispatch"
                );
                assert_eq!(model.search_draft, "preserve-search");
            }
        }
    }
}

#[test]
fn plain_c_keeps_overlay_scope_and_release_never_submits_input() {
    for overlay in [
        OverlayMode::None,
        OverlayMode::Help,
        OverlayMode::Palette,
        OverlayMode::Search,
        OverlayMode::Settings,
        OverlayMode::RepositorySearch,
        OverlayMode::JobInspection,
    ] {
        for active in [false, true] {
            let mut model = model();
            model.overlay = overlay;
            if active {
                model.selected_job = Some("owned-active-job".into());
                model
                    .job_status
                    .insert("owned-active-job".into(), "running".into());
            }
            let mut release = KeyEvent::new(KeyCode::Char('c'), KeyModifiers::CONTROL);
            release.kind = KeyEventKind::Release;
            enqueue_terminal_key(&mut model, release);
            assert!(model.input_queue.is_empty());
            enqueue_terminal_key(
                &mut model,
                KeyEvent::new(KeyCode::Char('c'), KeyModifiers::NONE),
            );
            let (_, InputCommand::TerminalKey(key)) = model.input_queue.pop_front().unwrap() else {
                panic!("plain key must retain raw FIFO identity")
            };
            interpret_terminal_key(&mut model, key);
            match overlay {
                OverlayMode::None => assert!(matches!(
                    model.input_queue.front(),
                    Some((_, InputCommand::CancelSelected))
                )),
                OverlayMode::Search => assert!(matches!(
                    model.input_queue.front(),
                    Some((_, InputCommand::SearchChar('c')))
                )),
                _ => assert!(model.input_queue.is_empty()),
            }
        }
    }
}

#[test]
fn tail_window_ranges_are_bounded_and_deterministic() {
    let items: Vec<_> = (0..10).collect();
    assert_eq!(tail_window_slice(&items, 0, 3), vec![7, 8, 9]);
    assert_eq!(tail_window_slice(&items, 2, 3), vec![5, 6, 7]);
    assert_eq!(tail_window_slice(&items, 0, 0), vec![9]);
    assert_eq!(tail_window_slice(&items, 0, usize::MAX), items);
    assert!(tail_window_slice(&items, usize::MAX, 3).is_empty());
    assert!(tail_window_slice::<u8>(&[], 0, 3).is_empty());
}

fn model() -> AppModel {
    let mut model = AppModel::new(
        "redraw-test".into(),
        TerminalCapabilities {
            color: true,
            unicode: true,
            mouse: false,
            alt_screen: true,
        },
        None,
    );
    model.owns_control_channel = true;
    model
}

fn screen(model: &AppModel, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal.draw(|frame| render_ui(frame, model)).unwrap();
    terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}

#[test]
fn restored_paused_selection_reconciles_with_new_supervisor_jobs() {
    let mut original = model();
    original.selected_job = Some("job-2".into());
    original.follow_updates = false;
    let mut restored = model();
    restore_snapshot(&mut restored, snapshot_from_model(&original));
    apply_protocol_event(
        &mut restored,
        json!({"event":"hello", "session":{
        "mode":"supervised", "source":"local-supervisor", "controllable":true,
        "connection":"connected"}}),
        0,
    );
    apply_protocol_event(
        &mut restored,
        json!({"event":"job:start", "jobId":"job-1", "title":"New session"}),
        0,
    );
    restored.update_task_status("job-1", "visible-new-task", "running", None);
    assert!(
        !restored.follow_updates,
        "restoration retains the pause preference"
    );
    assert_eq!(restored.selected_job.as_deref(), Some("job-1"));
    assert!(screen(&restored, 120, 40).contains("visible-new-task"));
    let node_name = if cfg!(windows) { "node.exe" } else { "node" };
    let node = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|directory| directory.join(node_name))
        .find(|candidate| candidate.is_absolute() && candidate.is_file())
        .and_then(|candidate| candidate.canonicalize().ok())
        .expect("protocol fixture requires the supported external Node runtime on PATH");
    let mut supervisor = std::process::Command::new(node)
        .args(["-e", "process.stdin.once('data', bytes => { process.stdout.write(bytes); process.exit(0); });"])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().unwrap();
    restored.last_input_at =
        Instant::now() - Duration::from_millis(INPUT_DISPATCH_INTERVAL_MS as u64 + 1);
    restored
        .input_queue
        .push_back((1, InputCommand::CancelSelected));
    dispatch_input(&mut restored, &mut supervisor, &mut 1).unwrap();
    let output = supervisor.wait_with_output().unwrap();
    assert!(output.status.success());
    let request: Value = serde_json::from_slice(&output.stdout).unwrap();
    assert_eq!(request["op"], "job:cancel");
    assert_eq!(request["jobId"], "job-1");
}

#[test]
fn session_snapshot_preserves_refinement_and_accepts_old_state() {
    let mut original = model();
    original.selected_job = Some("job-7".into());
    original.search_logs = "parse failure".into();
    original.search_jobs = "index".into();
    original.search_tasks = "typescript".into();
    original.focus_panel = FocusPanel::Logs;
    original.log_level_filter = LogLevelFilter::Error;
    original.follow_updates = false;
    original.log_scroll.set(12);
    let encoded = serde_json::to_string(&snapshot_from_model(&original)).unwrap();
    let mut restored = model();
    restore_snapshot(&mut restored, serde_json::from_str(&encoded).unwrap());
    assert_eq!(
        restored.selected_job, None,
        "a new supervisor has no persisted job inventory"
    );
    assert_eq!(restored.search_logs, original.search_logs);
    assert_eq!(restored.search_jobs, original.search_jobs);
    assert_eq!(restored.search_tasks, original.search_tasks);
    assert!(restored.focus_panel == FocusPanel::Logs);
    assert!(restored.log_level_filter == LogLevelFilter::Error);
    assert!(!restored.follow_updates);
    assert_eq!(restored.log_scroll.get(), 12);
    let mut known_jobs = model();
    known_jobs.update_job_status("job-7", "running", None);
    restore_snapshot(&mut known_jobs, snapshot_from_model(&original));
    assert_eq!(
        known_jobs.selected_job, original.selected_job,
        "selection survives when its job is actually known"
    );
    let old = r#"{"selected_job":null,"job_scroll":0,"task_scroll":0,"log_scroll":0}"#;
    let mut legacy = model();
    restore_snapshot(&mut legacy, serde_json::from_str(old).unwrap());
    assert!(legacy.follow_updates);
    assert!(legacy.search_logs.is_empty());
}

#[test]
fn overlays_and_search_change_rendered_frames_and_signature() {
    let mut model = model();
    let baseline = screen(&model, 120, 40);
    let signature = frame_signature(&model);
    apply_local_input(&mut model, "toggle_help");
    let help = screen(&model, 120, 40);
    assert_ne!(help, baseline);
    assert!(help.contains("Help | Esc close"));
    assert_ne!(frame_signature(&model), signature);
    apply_local_input(&mut model, "toggle_help");
    assert_eq!(screen(&model, 120, 40), baseline);
    assert_eq!(frame_signature(&model), signature);
    apply_local_input(&mut model, "toggle_palette");
    let palette = screen(&model, 120, 40);
    let palette_signature = frame_signature(&model);
    assert!(palette.contains("Actions"));
    assert_ne!(palette, baseline);
    apply_local_input(&mut model, "palette_down");
    assert_ne!(screen(&model, 120, 40), palette);
    assert_ne!(frame_signature(&model), palette_signature);
    apply_local_input(&mut model, "toggle_palette");
    apply_local_input(&mut model, "focus_logs");
    model.push_log("cache refresh".into());
    model.push_log("unrelated entry".into());
    apply_local_input(&mut model, "search_open");
    let search = screen(&model, 120, 40);
    let search_signature = frame_signature(&model);
    assert!(search.contains("Type to filter"));
    apply_local_input(&mut model, "search_type:cache");
    assert_ne!(screen(&model, 120, 40), search);
    assert_ne!(frame_signature(&model), search_signature);
    apply_local_input(&mut model, "search_apply");
    let applied = screen(&model, 120, 40);
    assert!(applied.contains("cache refresh"));
    assert!(!applied.contains("unrelated entry"));
    let applied_signature = frame_signature(&model);
    apply_local_input(&mut model, "clear_search");
    assert!(screen(&model, 120, 40).contains("unrelated entry"));
    assert_ne!(frame_signature(&model), applied_signature);
}

#[test]
fn every_scroll_filter_and_search_panel_invalidates_visible_state() {
    let changes: &[fn(&mut AppModel)] = &[
        |m| m.job_scroll += 1,
        |m| m.task_scroll += 1,
        |m| m.log_scroll.set(m.log_scroll.get() + 1),
        |m| m.job_filter = m.job_filter.next(),
        |m| m.task_filter = m.task_filter.next(),
        |m| m.log_level_filter = m.log_level_filter.next(),
        |m| m.log_source_filter = m.log_source_filter.next(),
        |m| m.search_jobs = "cache".into(),
        |m| m.search_tasks = "cache".into(),
        |m| m.search_logs = "cache".into(),
        |m| m.search_target = FocusPanel::Logs,
        |m| m.follow_updates = false,
        |m| m.focus_panel = FocusPanel::Tasks,
    ];
    for change in changes {
        let mut model = model();
        let before = frame_signature(&model);
        change(&mut model);
        assert_ne!(frame_signature(&model), before);
    }
}

#[test]
fn resize_invalidates_cached_frame_and_layout_returns_to_wide() {
    let mut model = model();
    let wide = screen(&model, 120, 40);
    model.last_render_signature = frame_signature(&model);
    model.dirty = false;
    invalidate_frame(&mut model);
    assert!(model.dirty);
    assert!(model.last_render_signature.is_empty());
    let narrow = screen(&model, 64, 30);
    assert_ne!(narrow, wide);
    assert_eq!(narrow.chars().count(), 64 * 30);
    assert_eq!(screen(&model, 120, 40), wide);
}

#[test]
fn same_count_job_updates_redraw_but_idle_bookkeeping_does_not() {
    let mut model = model();
    model.update_job_status("job-1", "running", None);
    let running = frame_signature(&model);
    model.update_job_status("job-1", "cancelled", None);
    assert_ne!(frame_signature(&model), running);
    assert!(screen(&model, 120, 40).contains("cancelled"));
    let idle = frame_signature(&model);
    model.flow_credit_pending += 1;
    model.next_input_seq += 1;
    model.last_metrics_emit = Instant::now();
    model.telemetry.render_ms_ewma = 16.0;
    model.dirty = true;
    assert_eq!(frame_signature(&model), idle);
}

#[test]
fn running_to_cancelled_moves_the_runtime_count() {
    let mut model = model();
    apply_protocol_event(
        &mut model,
        json!({
            "event": "job:start", "jobId": "job-1", "title": "Search Help"
        }),
        0,
    );
    assert_eq!(job_status_counts(&model), (1, 0, 0, 0));
    let running = frame_signature(&model);
    apply_protocol_event(
        &mut model,
        json!({
            "event": "job:end", "jobId": "job-1", "status": "cancelled", "exitCode": 130
        }),
        0,
    );
    assert_eq!(job_status_counts(&model), (0, 0, 0, 1));
    assert_ne!(frame_signature(&model), running);
    assert!(runtime_summary_text(&model, 62).contains("jobs 0run/0fail/0done/1cancel"));
    assert!(screen(&model, 64, 30).contains("jobs 0run/0fail/0done/1cancel"));
}

#[test]
fn known_terminal_states_preserve_failed_done_and_cancelled_counts() {
    let mut model = model();
    for (id, status) in [
        ("running", "running"),
        ("accepted", "accepted"),
        ("cancelling", "cancelling"),
        ("failed", "failed"),
        ("done", "done"),
        ("cancelled", "cancelled"),
    ] {
        model.job_status.insert(id.into(), status.into());
    }
    assert_eq!(job_status_counts(&model), (3, 1, 1, 1));
    assert!(runtime_summary_text(&model, 120).contains("jobs 3run/1fail/1done/1cancel"));
    model.job_status.remove("cancelled");
    assert_eq!(job_status_counts(&model), (3, 1, 1, 0));
}
