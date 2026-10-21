use super::*;

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
    for index in 0..20 {
        let job = format!("JMARK{index:02}");
        model.job_order.push_back(job.clone());
        model.job_status.insert(job, "running".into());
        let task = format!("owner:TMARK{index:02}");
        model.task_order.push_back(task.clone());
        model.task_status.insert(task, "running".into());
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
    for (width, height) in [(140, 24), (90, 36)] {
        let mut model = model();
        let baseline = screen(&model, width, height);
        assert!(baseline.contains("JMARK00"));
        assert!(baseline.contains("TMARK00"));
        assert!(!baseline.contains("JMARK19"));
        assert!(!baseline.contains("TMARK19"));
        apply_local_input(&mut model, "jobs_up");
        let jobs = screen(&model, width, height);
        assert!(!jobs.contains("JMARK00"));
        assert!(jobs.contains("JMARK01"));
        assert!(jobs.contains("TMARK00"));
        apply_local_input(&mut model, "tasks_up");
        let tasks = screen(&model, width, height);
        assert!(!tasks.contains("TMARK00"));
        assert!(tasks.contains("TMARK01"));
        assert!(
            tasks.contains("LMARK19"),
            "Live view must contain newest log"
        );
        assert!(!tasks.contains("LMARK00"));
        apply_local_input(&mut model, "logs_up");
        let logs = screen(&model, width, height);
        assert!(!logs.contains("LMARK19"));
        assert!(logs.contains("LMARK18"));
        for command in ["jobs_down", "tasks_down", "logs_down"] {
            apply_local_input(&mut model, command);
        }
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
    let rendered = screen(&model, 140, 24);
    assert!(rendered.contains("JMARK19 | running"));
    assert!(rendered.contains("TMARK19 | running"));
    assert!(!rendered.contains("JMARK00"));
    assert!(!rendered.contains("TMARK00"));
    model.job_filter = JobFilter::Failed;
    model.task_filter = TaskFilter::Failed;
    let rendered = screen(&model, 140, 24);
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
    model.task_order.push_front("elsewhere:PRIVATE".into());
    model
        .task_status
        .insert("elsewhere:PRIVATE".into(), "running".into());
    model.selected_job = Some("owner".into());
    model.task_scroll = usize::MAX;
    model.job_scroll = usize::MAX;
    let rendered = screen(&model, 140, 24);
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
    assert!(screen(&model, 140, 24).contains("LMARK10"));
}
