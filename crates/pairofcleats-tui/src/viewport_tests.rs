use super::*;

#[test]
fn selected_palette_action_remains_visible_in_a_small_terminal() {
    let mut model = model();
    model.overlay = OverlayMode::Palette;
    model.palette_index = palette_actions().len() - 1;
    for height in [24, 18] {
        assert!(
            screen(&model, 90, height).contains("Quit TUI"),
            "selected action is hidden at height {height}"
        );
    }
}

#[test]
fn job_inspection_renders_payload_without_putting_it_in_layout_or_frame_identity() {
    let mut model = model();
    apply_protocol_event(
        &mut model,
        json!({"event":"job:start", "jobId":"inspected",
        "title":"Bounded result", "requested":{"resultPolicy":{"captureStdout":"json"}}}),
        0,
    );
    apply_protocol_event(
        &mut model,
        json!({"event":"job:end", "jobId":"inspected", "status":"done",
        "exitCode":0, "resultState":"complete", "result":{"value":"PAYLOAD_ONLY_MARKER"}}),
        0,
    );
    apply_local_input(&mut model, "inspect_job");
    assert!(model.overlay == OverlayMode::JobInspection);
    assert!(model.selected_job_pinned);
    enqueue_terminal_key(
        &mut model,
        KeyEvent::new(KeyCode::Char('2'), KeyModifiers::NONE),
    );
    let (_, InputCommand::TerminalKey(key)) = model.input_queue.pop_front().unwrap() else {
        panic!("result key must enter through the raw-key queue")
    };
    interpret_terminal_key(&mut model, key);
    assert!(screen(&model, 170, 40).contains("PAYLOAD_ONLY_MARKER"));
    assert!(!frame_signature(&model).contains("PAYLOAD_ONLY_MARKER"));
    assert!(!serde_json::to_string(&snapshot_from_model(&model))
        .unwrap()
        .contains("PAYLOAD_ONLY_MARKER"));
    enqueue_terminal_key(&mut model, KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
    let (_, InputCommand::TerminalKey(key)) = model.input_queue.pop_front().unwrap() else {
        panic!("escape must enter through the raw-key queue")
    };
    interpret_terminal_key(&mut model, key);
    assert!(model.overlay == OverlayMode::None);
}

#[test]
fn explicit_job_selection_stays_pinned_across_updates_and_follow() {
    let mut model = model();
    model.selected_job = Some("JMARK01".into());
    apply_local_input(&mut model, "select_previous_job");
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
    assert_eq!(
        model.job_scroll, 0,
        "selection is separate from viewport scroll"
    );
    model.update_job_status("JMARK01", "running", None);
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
    toggle_follow(&mut model);
    toggle_follow(&mut model);
    model.update_job_status("new job", "running", None);
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
}

#[test]
fn selected_job_log_view_excludes_other_jobs_and_retains_session_logs() {
    let mut model = model();
    model.selected_job = Some("JMARK00".into());
    for (id, message) in [
        (Some("JMARK00"), "SELECTED_LOG"),
        (Some("JMARK01"), "OTHER_JOB_LOG"),
        (None, "SESSION_LOG"),
    ] {
        apply_protocol_event(
            &mut model,
            json!({"event":"log", "jobId":id,
            "message":message,"level":"info"}),
            0,
        );
    }
    let logs = build_log_lines(&model, 100, 100);
    assert!(logs.contains("SELECTED_LOG"));
    assert!(logs.contains("SESSION_LOG"));
    assert!(!logs.contains("OTHER_JOB_LOG"));
}

#[test]
fn task_identity_uses_the_exact_job_and_task_pair() {
    let mut model = model();
    model.task_status.clear();
    model.task_order.clear();
    model.task_identity.clear();
    model.update_task_status("parent", "child:task", "running", Some("PARENT_TASK"));
    model.update_task_status("parent:child", "task", "running", Some("NESTED_TASK"));
    assert_eq!(
        model.task_status.len(),
        2,
        "colon-containing identities cannot overwrite each other"
    );
    model.selected_job = Some("parent".into());
    let frame = screen(&model, 170, 40);
    assert!(frame.contains("PARENT_TASK"));
    assert!(!frame.contains("NESTED_TASK"));
    model.selected_job = Some("parent:child".into());
    let frame = screen(&model, 170, 40);
    assert!(frame.contains("NESTED_TASK"));
    assert!(!frame.contains("PARENT_TASK"));
}

#[test]
fn reusing_a_job_id_cannot_rearm_an_old_pinned_selection() {
    let mut model = model();
    apply_session_descriptor(
        &mut model,
        &json!({"mode":"supervised", "controllable":true}),
    );
    apply_protocol_event(
        &mut model,
        json!({"event":"job:start", "jobId":"reused", "title":"old"}),
        0,
    );
    select_job(&mut model, 1);
    model.update_task_status("reused", "old task", "running", None);
    apply_protocol_event(
        &mut model,
        json!({"event":"log", "jobId":"reused", "message":"OLD_JOB_LOG"}),
        0,
    );
    apply_protocol_event(
        &mut model,
        json!({"event":"job:end", "jobId":"reused", "status":"done"}),
        0,
    );
    apply_protocol_event(
        &mut model,
        json!({"event":"job:start", "jobId":"reused", "title":"replacement"}),
        0,
    );
    model.update_task_status("reused", "new task", "running", None);
    apply_protocol_event(
        &mut model,
        json!({"event":"log", "jobId":"reused", "message":"NEW_JOB_LOG"}),
        0,
    );
    assert!(
        selected_job_cancel_request(&mut model).is_none(),
        "an old selection cannot silently target a replacement instance"
    );
    let rendered = screen(&model, 170, 40);
    assert!(!rendered.contains("NEW_JOB_LOG"));
    assert!(!rendered.contains("new task | running"));
    select_job(&mut model, 1);
    assert_eq!(
        selected_job_cancel_request(&mut model).unwrap()["jobId"],
        "reused"
    );
    let rendered = screen(&model, 170, 40);
    assert!(rendered.contains("NEW_JOB_LOG"));
    assert!(rendered.contains("new task | running"));
    assert!(!rendered.contains("OLD_JOB_LOG"));
    assert!(!rendered.contains("old task | running"));
}

#[test]
fn hidden_expired_or_unverified_jobs_cannot_be_cancelled_or_retargeted() {
    let mut model = model();
    model.selected_job = Some("JMARK01".into());
    select_job(&mut model, -1);
    assert!(selected_job_cancel_request(&mut model).is_none());
    apply_session_descriptor(
        &mut model,
        &json!({"mode":"supervised", "controllable":true}),
    );
    assert_eq!(
        selected_job_cancel_request(&mut model).unwrap()["jobId"],
        "JMARK00"
    );
    model.search_jobs = "JMARK01".into();
    assert!(selected_job_cancel_request(&mut model).is_none());
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
    assert!(operator_summary_text(&model, 300).contains("hidden/unavailable"));
    model.search_jobs.clear();
    for index in 0..JOB_RING_LIMIT {
        model.update_job_status(&format!("replacement-{index}"), "running", None);
    }
    assert!(!model.job_status.contains_key("JMARK00"));
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
    assert!(selected_job_cancel_request(&mut model).is_none());
    follow_latest_job(&mut model);
    assert_eq!(model.selected_job.as_deref(), Some("replacement-511"));
    assert!(!model.selected_job_pinned);
    apply_session_descriptor(&mut model, &json!({"mode":"replay", "controllable":true}));
    assert!(selected_job_cancel_request(&mut model).is_none());
}

#[test]
fn cancellation_and_navigation_use_the_exact_rendered_filter_text() {
    let mut model = model();
    model.selected_job = Some("JMARK01".into());
    select_job(&mut model, -1);
    apply_session_descriptor(
        &mut model,
        &json!({"mode":"supervised", "controllable":true}),
    );
    model.search_jobs = "running |".into();
    assert!(
        visible_job_ids(&model).is_empty(),
        "an absent title cannot introduce an invisible trailing separator"
    );
    assert!(selected_job_cancel_request(&mut model).is_none());
    assert!(screen(&model, 140, 40).contains("no jobs match"));
}

#[test]
fn medium_operator_summary_retains_selection_and_active_text_filter() {
    let mut model = model();
    model.selected_job = Some("JMARK01".into());
    model.focus_panel = FocusPanel::Logs;
    model.search_logs = "sourcekit".into();
    let summary = operator_summary_text(&model, 98);
    assert!(summary.contains("selected JMARK01"));
    assert!(summary.contains("search sourcekit"));
    assert!(Span::raw(&summary).width() <= 98);
}

#[test]
fn job_selection_keys_are_distinct_from_scroll_and_log_follow() {
    let mut model = model();
    for (key, expected) in [
        (KeyCode::Char('['), "previous"),
        (KeyCode::Up, "previous"),
        (KeyCode::Char(']'), "next"),
        (KeyCode::Down, "next"),
        (KeyCode::Char('g'), "follow"),
    ] {
        model.input_queue.clear();
        model.last_input_at = Instant::now() - Duration::from_secs(1);
        enqueue_terminal_key(&mut model, KeyEvent::new(key, KeyModifiers::NONE));
        let (_, InputCommand::TerminalKey(raw)) = model.input_queue.pop_front().unwrap() else {
            panic!("raw key expected")
        };
        interpret_terminal_key(&mut model, raw);
        let command = &model.input_queue.back().unwrap().1;
        assert!(match expected {
            "previous" => matches!(command, InputCommand::SelectPreviousJob),
            "next" => matches!(command, InputCommand::SelectNextJob),
            _ => matches!(command, InputCommand::FollowLatestJob),
        });
    }
    model.selected_job = Some("JMARK01".into());
    apply_local_input(&mut model, "select_previous_job");
    let rendered = screen(&model, 140, 40);
    assert!(
        rendered.contains(">JMARK00 | running"),
        "selection must be visible without color"
    );
    apply_local_input(&mut model, "jobs_up");
    assert_eq!(model.selected_job.as_deref(), Some("JMARK00"));
    assert_eq!(model.job_scroll, 1);
}

#[test]
fn distinct_key_presses_and_repeated_letters_keep_fifo_order() {
    let mut model = model();
    let last_dispatch = model.last_input_at;
    for _ in 0..2 {
        enqueue_terminal_key(
            &mut model,
            KeyEvent::new(KeyCode::Char('p'), KeyModifiers::NONE),
        );
    }
    assert_eq!(
        model.input_queue.len(),
        2,
        "two intentional presses are not one hardware repeat"
    );
    assert_eq!(
        model.last_input_at, last_dispatch,
        "new input cannot postpone an already eligible dispatch"
    );
    model.input_queue.clear();
    model.overlay = OverlayMode::Search;
    for _ in 0..2 {
        enqueue_terminal_key(
            &mut model,
            KeyEvent::new(KeyCode::Char('e'), KeyModifiers::NONE),
        );
    }
    assert_eq!(
        model.input_queue.len(),
        2,
        "typing or pasting repeated letters must preserve text"
    );
    assert!(model
        .input_queue
        .iter()
        .all(|(_, command)| matches!(command, InputCommand::TerminalKey(key) if key.code == KeyCode::Char('e'))));
}

#[test]
fn hardware_repeat_is_bounded_without_dropping_distinct_presses() {
    let mut model = model();
    let press = KeyEvent::new(KeyCode::Down, KeyModifiers::NONE);
    enqueue_terminal_key(&mut model, press);
    let mut repeat = press;
    repeat.kind = KeyEventKind::Repeat;
    enqueue_terminal_key(&mut model, repeat);
    assert_eq!(model.input_queue.len(), 1);
    model.last_key_at = Instant::now() - Duration::from_millis(INPUT_DEBOUNCE_MS as u64 + 1);
    enqueue_terminal_key(&mut model, repeat);
    assert_eq!(model.input_queue.len(), 2);
    assert!(model.input_queue[0].0 < model.input_queue[1].0);
    enqueue_terminal_key(&mut model, press);
    assert_eq!(model.input_queue.len(), 3);
    let mut release = press;
    release.kind = KeyEventKind::Release;
    enqueue_terminal_key(&mut model, release);
    assert_eq!(model.input_queue.len(), 3);
}

#[test]
fn fitted_labels_preserve_graphemes_and_terminal_columns() {
    for text in ["界界界界", "e\u{301}e\u{301}e\u{301}", "👩‍💻界alpha"] {
        for width in 0..10 {
            let fitted = fit_text(text, width);
            assert!(
                Span::raw(&fitted).width() <= width,
                "{text:?} exceeds {width} columns: {fitted:?}"
            );
        }
    }
    assert_eq!(
        fit_text("e\u{301}", 1),
        "e\u{301}",
        "a composed grapheme that fits must remain intact"
    );
}

fn model() -> AppModel {
    let mut model = AppModel::new(
        "viewport-test".into(),
        TerminalCapabilities {
            color: false,
            unicode: true,
            mouse: false,
            alt_screen: false,
        },
        None,
    );
    model.owns_control_channel = true;
    for index in 0..20 {
        let job = format!("JMARK{index:02}");
        model.job_order.push_back(job.clone());
        model.job_status.insert(job, "running".into());
        model.update_task_status("owner", &format!("TMARK{index:02}"), "running", None);
        model.push_log(format!("LMARK{index:02}"));
    }
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
fn rendered_viewports_scroll_independently_in_both_layouts() {
    for (width, height) in [(140, 32), (90, 18)] {
        let mut model = model();
        let baseline = screen(&model, width, height);
        assert!(baseline.contains("JMARK00"));
        assert!(!baseline.contains("JMARK19"));
        apply_local_input(&mut model, "jobs_up");
        let jobs = screen(&model, width, height);
        assert!(!jobs.contains("JMARK00"));
        assert!(jobs.contains("JMARK01"));
        model.focus_panel = FocusPanel::Tasks;
        assert!(screen(&model, width, height).contains("TMARK00"));
        apply_local_input(&mut model, "tasks_up");
        let tasks = screen(&model, width, height);
        assert!(!tasks.contains("TMARK00"));
        assert!(tasks.contains("TMARK01"));
        model.focus_panel = FocusPanel::Logs;
        let latest_logs = screen(&model, width, height);
        assert!(
            latest_logs.contains("LMARK19"),
            "Focused live log view must contain newest log"
        );
        assert!(!latest_logs.contains("LMARK00"));
        apply_local_input(&mut model, "logs_up");
        let logs = screen(&model, width, height);
        assert!(!logs.contains("LMARK19"));
        assert!(logs.contains("LMARK18"));
        for command in ["jobs_down", "tasks_down", "logs_down"] {
            apply_local_input(&mut model, command);
        }
        model.focus_panel = FocusPanel::Jobs;
        assert_eq!(screen(&model, width, height), baseline);
    }
}

#[test]
fn filters_and_stale_list_offsets_keep_matching_rows_visible() {
    let mut model = model();
    model.job_scroll = usize::MAX;
    model.task_scroll = usize::MAX;
    model.search_jobs = "JMARK19".into();
    model.search_tasks = "TMARK19".into();
    let rendered = screen(&model, 140, 32);
    assert!(rendered.contains("JMARK19 | running"));
    assert!(rendered.contains("TMARK19 | running"));
    assert!(!rendered.contains("JMARK00"));
    assert!(!rendered.contains("TMARK00"));
    model.job_filter = JobFilter::Failed;
    model.task_filter = TaskFilter::Failed;
    let rendered = screen(&model, 140, 32);
    assert!(!rendered.contains("JMARK19 | running"));
    assert!(!rendered.contains("TMARK19 | running"));
    assert!(rendered.contains("no jobs match"));
    assert!(rendered.contains("no tasks match"));
}

#[test]
fn wrapped_log_window_preserves_newest_lines_and_zero_dimensions() {
    let mut model = model();
    model.logs.clear();
    model.push_log("wrapA\nwrapB\nwrapC\nwrapD".into());
    assert_eq!(build_log_lines(&model, 50, 3), "wrapB\nwrapC\nwrapD");
    assert!(build_log_lines(&model, 0, 3).is_empty());
    assert!(build_log_lines(&model, 50, 0).is_empty());
}

#[test]
fn every_wrapped_row_is_reachable_and_stored_overscroll_is_clamped() {
    let mut model = model();
    model.logs.clear();
    model.push_log(
        (0..24)
            .map(|index| format!("ROW{index:02}"))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    let all = wrap_text_lines(
        &render_log_entry(model.logs.back().unwrap()),
        60,
        usize::MAX,
    );
    let height = 4;
    for offset in 0..=all.len() - height {
        model.log_scroll.set(offset);
        let end = all.len() - offset;
        assert_eq!(
            build_log_lines(&model, 60, height),
            all[end - height..end].join("\n")
        );
        assert_eq!(model.log_scroll.get(), offset);
    }
    model.log_scroll.set(usize::MAX);
    assert_eq!(
        build_log_lines(&model, 60, height),
        all[..height].join("\n")
    );
    assert_eq!(model.log_scroll.get(), all.len() - height);
    assert_eq!(snapshot_from_model(&model).log_scroll, all.len() - height);
    model.focus_panel = FocusPanel::Logs;
    assert!(screen(&model, 90, 18).contains("ROW00"));
    apply_local_input(&mut model, "logs_down");
    assert!(screen(&model, 90, 18).contains("ROW04"));
}

#[test]
fn paused_row_anchor_survives_multiline_arrivals_resize_and_filter_changes() {
    let mut model = model();
    model.logs.clear();
    for index in 0..8 {
        model.push_log_entry(
            format!("KEEP{index:02}\ninside{index:02}\nend{index:02}"),
            "warn",
            "events",
        );
    }
    model.log_level_filter = LogLevelFilter::WarnError;
    model.log_source_filter = LogSourceFilter::Events;
    model.search_logs = "KEEP".into();
    model.log_scroll.set(2);
    model.follow_updates = false;
    let before = build_log_lines(&model, 60, 4);
    let offset = model.log_scroll.get();
    model.push_log_entry("unmatched\nsecond\nthird".into(), "info", "supervisor");
    assert_eq!(build_log_lines(&model, 60, 4), before);
    model.push_log_entry(
        "KEEP-new\nnew-two\nnew-three\nnew-four".into(),
        "warn",
        "events",
    );
    assert_eq!(build_log_lines(&model, 60, 4), before);
    assert_eq!(
        model.log_scroll.get(),
        offset + 4,
        "arrival charge uses displayed rows, not one entry"
    );
    let narrowed = build_log_lines(&model, 24, 4);
    assert!(
        narrowed.ends_with("KEEP07"),
        "reflow preserves the source row at the paused bottom"
    );
    model.search_logs = "KEEP-new".into();
    assert!(build_log_lines(&model, 24, 4).contains("new-four"));
    assert_eq!(model.log_scroll.get(), 0);
    toggle_follow(&mut model);
    assert!(model.follow_updates);
    assert!(build_log_lines(&model, 60, 2).contains("new-four"));
}

#[test]
fn paused_evicted_anchor_clamps_to_retained_history_without_losing_rows() {
    let mut model = model();
    model.logs.clear();
    model.push_log("old-first\nold-second\nold-third\nold-fourth".into());
    model.follow_updates = false;
    build_log_lines(&model, 60, 2);
    let original = model.logs.back().unwrap().id;
    for index in 0..LOG_RING_LIMIT {
        model.push_log(format!("new-{index:04}\ncontinuation-{index:04}"));
    }
    assert!(!model.logs.iter().any(|entry| entry.id == original));
    let oldest = build_log_lines(&model, 60, 3);
    assert!(oldest.contains("new-0000"));
    assert!(oldest.contains("continuation-0000"));
    assert!(oldest.contains("new-0001"));
    assert_eq!(model.log_scroll.get(), LOG_RING_LIMIT * 2 - 3);
    assert!(model.log_layout_cache.borrow().bytes() <= 2 * 1024 * 1024);
    model.search_logs = "does not exist".into();
    assert!(build_log_lines(&model, 60, 3).contains("no logs"));
    assert_eq!(model.log_scroll.get(), 0);
}

#[test]
fn paused_short_history_keeps_its_bottom_in_a_larger_viewport() {
    let mut model = model();
    model.logs.clear();
    model.push_log("old-top\nold-bottom".into());
    model.follow_updates = false;
    let before = build_log_lines(&model, 60, 10);
    model.push_log("incoming-one\nincoming-two\nincoming-three".into());
    assert_eq!(build_log_lines(&model, 60, 10), before);
    assert_eq!(model.log_scroll.get(), 3);
    assert_eq!(build_log_lines(&model, 60, 20), before);
    toggle_follow(&mut model);
    assert!(build_log_lines(&model, 60, 20).contains("incoming-three"));
    assert_eq!(model.log_scroll.get(), 0);
}

#[test]
fn unicode_wrapping_never_uses_character_counts_as_byte_offsets() {
    // A long UTF-8 word must never be sliced using a character count as bytes.
    let lines = wrap_text_lines("ééééééééé", 3, 4);
    assert_eq!(lines, ["ééé", "ééé", "ééé"]);
    assert_eq!(wrap_text_lines("中文中文", 3, 4), ["中", "文", "中", "文"]);
    assert_eq!(
        wrap_text_lines("e\u{301}e\u{301}e\u{301}", 2, 3),
        ["e\u{301}e\u{301}", "e\u{301}"]
    );
    assert_eq!(wrap_text_lines("👨‍👩‍👧‍👦👨‍👩‍👧‍👦", 2, 3), ["👨‍👩‍👧‍👦", "👨‍👩‍👧‍👦"]);
    assert_eq!(wrap_text_lines("中", 1, 3), ["…"]);
}

#[test]
fn selected_job_scope_precedes_task_viewport_and_overscroll_is_bounded() {
    let mut model = model();
    model.update_task_status("elsewhere", "PRIVATE", "running", None);
    let private = model.task_order.pop_back().unwrap();
    model.task_order.push_front(private);
    model.selected_job = Some("owner".into());
    model.task_scroll = usize::MAX;
    model.job_scroll = usize::MAX;
    let rendered = screen(&model, 140, 32);
    assert!(!rendered.contains("PRIVATE"));
    assert!(rendered.contains("TMARK19"));
    assert!(rendered.contains("JMARK19"));
    assert!(list_viewport(vec![1, 2, 3], usize::MAX, 0).is_empty());
    assert_eq!(list_viewport(vec![1, 2, 3], usize::MAX, 2), [2, 3]);
}

#[test]
fn paused_filtered_log_anchor_survives_matching_and_unmatched_arrivals() {
    let mut model = model();
    model.search_logs = "LMARK".into();
    model.log_level_filter = LogLevelFilter::WarnError;
    model.log_source_filter = LogSourceFilter::Events;
    model.logs.clear();
    for index in 0..10 {
        model.push_log_entry(format!("LMARK{index:02}"), "warn", "events");
    }
    apply_local_input(&mut model, "toggle_follow");
    let paused = build_log_lines(&model, 60, 3);
    model.push_log_entry("unmatched".into(), "info", "supervisor");
    assert_eq!(build_log_lines(&model, 60, 3), paused);
    model.push_log_entry("LMARK10".into(), "warn", "events");
    assert_eq!(build_log_lines(&model, 60, 3), paused);
    apply_local_input(&mut model, "toggle_follow");
    assert!(build_log_lines(&model, 60, 3).contains("LMARK10"));
    model.focus_panel = FocusPanel::Logs;
    assert!(screen(&model, 140, 24).contains("LMARK10"));
}

#[test]
fn log_presentation_cache_reuses_immutable_tail_and_tracks_entry_eviction() {
    let mut model = model();
    model.logs.clear();
    model.log_layout_cache.borrow_mut().clear();
    model.push_log("long-tail ".repeat(6554));
    let actual = build_log_lines(&model, 80, 10);
    let all = wrap_text_lines(
        &render_log_entry(model.logs.back().unwrap()),
        80,
        usize::MAX,
    );
    assert_eq!(actual, all[all.len().saturating_sub(10)..].join("\n"));
    let scans = model.log_layout_cache.borrow().scans;
    let owned = model.log_layout_cache.borrow().owned_rows;
    assert_eq!(
        owned, 10,
        "hidden wrapped rows never become owned presentation strings"
    );
    for _ in 0..20 {
        assert_eq!(build_log_lines(&model, 80, 10), actual);
    }
    assert_eq!(model.log_layout_cache.borrow().scans, scans);
    assert!(model.log_layout_cache.borrow().hits >= 20);
    build_log_lines(&model, 79, 10);
    assert_eq!(model.log_layout_cache.borrow().scans, scans + 1);
    let old_id = model.logs.back().unwrap().id;
    for index in 0..LOG_RING_LIMIT {
        model.push_log(format!("replacement-{index}"));
    }
    model.log_scroll.set(usize::MAX);
    assert!(build_log_lines(&model, 80, 1).contains("replacement-0"));
    assert!(!model.logs.iter().any(|entry| entry.id == old_id));
    assert!(model.log_layout_cache.borrow().bytes() <= 2 * 1024 * 1024);
    model.search_logs = "REPLACEMENT-19".into();
    model.log_scroll.set(0);
    assert!(build_log_lines(&model, 80, 10).contains("replacement-19"));
}

#[test]
fn empty_log_search_formats_only_visible_entries_and_identity_rollover_is_safe() {
    let mut model = model();
    model.logs.clear();
    for index in 0..LOG_RING_LIMIT {
        model.push_log(format!("entry-{index}"));
    }
    LOG_FORMATS.with(|count| count.set(0));
    let first = build_log_lines(&model, 80, 10);
    assert_eq!(LOG_FORMATS.with(|count| count.get()), 10);
    assert_eq!(build_log_lines(&model, 80, 10), first);
    assert_eq!(
        LOG_FORMATS.with(|count| count.get()),
        10,
        "unchanged redraw does not reformat cached text"
    );
    let retained = model.log_layout_cache.borrow().bytes();
    model.next_log_id = u64::MAX;
    model.push_log("after-renumber".into());
    assert!(build_log_lines(&model, 80, 1).contains("after-renumber"));
    assert!(model.log_layout_cache.borrow().bytes() <= retained + 4096);
    assert_eq!(
        model
            .logs
            .iter()
            .map(|entry| entry.id)
            .collect::<std::collections::HashSet<_>>()
            .len(),
        LOG_RING_LIMIT
    );
}
