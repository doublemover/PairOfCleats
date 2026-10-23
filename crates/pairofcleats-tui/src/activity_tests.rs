use super::*;

fn new_model() -> AppModel {
    AppModel::new("activity-consumer".into(), TerminalCapabilities {
        color: false, unicode: false, mouse: false, alt_screen: false,
    }, None)
}

fn screen(model: &AppModel, width: u16, height: u16) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal.draw(|frame| render_ui(frame, model)).unwrap();
    terminal.backend().buffer().content.iter().map(|cell| cell.symbol()).collect()
}

fn saved(model: &mut AppModel, event: &str, second: u64, fields: Value) {
    let mut value = json!({"event":event,"jobId":"owner","taskId":"scan",
        "ts":format!("2026-10-23T12:00:{second:02}.000Z")});
    value.as_object_mut().unwrap().extend(fields.as_object().unwrap().clone());
    apply_protocol_event(model, value, 0);
}

fn measured_replay() -> AppModel {
    let mut model = new_model(); model.session.mode = "replay".into();
    saved(&mut model, "job:start", 0, json!({}));
    saved(&mut model, "task:start", 1, json!({"current":0,"total":10,"unit":"files","stage":"scan"}));
    saved(&mut model, "task:progress", 2, json!({"current":4}));
    saved(&mut model, "task:progress", 5, json!({"state":"waiting"}));
    model
}

#[test]
fn measurement_changes_do_not_relabel_counts_and_heartbeats_do_not_advance_work() {
    let mut task = TaskState::new("running", None);
    task.observe(&json!({"current":0,"total":0,"unit":"files","stage":"scan"}), Some(1000));
    assert!(task.activity(2000, false).contains("0/0 files"));
    task.observe(&json!({"current":0,"total":0,"unit":"files","stage":"scan"}), Some(5000));
    let text = task.activity(6000, false);
    assert!(text.contains("last 1s ago")); assert!(text.contains("progress 5s ago"));
    task.observe(&json!({"current":3,"total":2}), Some(7000));
    assert!(task.activity(8000, false).contains("3 (total unknown)"));
    task.observe(&json!({"total":null}), Some(9000));
    assert_eq!(task.total, None);
    task.observe(&json!({"stage":"download","unit":"bytes","state":"waiting"}), Some(10000));
    assert_eq!(task.current, None); assert_eq!(task.total, None);
    let waiting = task.activity(14000, false);
    assert!(waiting.contains("indeterminate bytes")); assert!(waiting.contains("running (waiting)"));
    assert!(!waiting.contains("100%")); assert!(!waiting.contains("stalled"));
    task.observe(&json!({"unit":null,"stage":null,"state":null,"current":-2,"total":"8"}), Some(15000));
    assert!(task.unit.is_none() && task.stage.is_none() && task.state.is_none());
    assert!(task.current.is_none() && task.total.is_none());
}

#[test]
fn actual_reducer_and_both_frames_keep_progress_separate_from_newer_heartbeats() {
    let mut model = measured_replay();
    for (width, height) in [(220,40),(220,24)] {
        let frame = screen(&model, width, height);
        assert!(frame.contains("4/10 files")); assert!(frame.contains("running (waiting)"));
        assert!(frame.contains("last 0s ago")); assert!(frame.contains("progress 3s ago"));
    }
    saved(&mut model, "task:start", 6, json!({"taskId":"short-check","current":1,"total":1}));
    saved(&mut model, "task:end", 7, json!({"taskId":"short-check","status":"done"}));
    assert!(interaction::activity_text(&model).contains("scan | 4/10"), "an active task outranks a later completed sibling");
    let frozen = interaction::activity_text(&model);
    interaction::activity_tick_at(&mut model, u64::MAX);
    assert_eq!(interaction::activity_text(&model), frozen, "paused replay uses only saved time");
    saved(&mut model, "log", 9, json!({"message":"next replay observation"}));
    assert!(interaction::activity_text(&model).contains("last 4s ago"));
    for status in ["failed", "cancelled", "done"] {
        let mut terminal = measured_replay();
        saved(&mut terminal, "job:end", 10, json!({"status":status}));
        let observed = interaction::activity_text(&terminal);
        saved(&mut terminal, "log", 59, json!({"message":"later unrelated event"}));
        assert_eq!(interaction::activity_text(&terminal), observed);
        let scan = &terminal.task_status[&json!(["owner","scan"]).to_string()];
        assert_ne!(scan.lifecycle(), Lifecycle::Done, "owner success never supplies missing task:end evidence");
        assert_eq!(scan.current, Some(4.0));
    }
}

#[test]
fn older_lifecycle_events_and_late_starts_cannot_reset_terminal_ownership() {
    let mut model = new_model(); model.session.mode = "replay".into();
    saved(&mut model, "job:start", 0, json!({}));
    saved(&mut model, "task:start", 1, json!({"current":0,"total":8}));
    saved(&mut model, "task:progress", 5, json!({"current":4}));
    for event in ["task:start","task:progress","task:end"] {
        saved(&mut model, event, 2, json!({"current":1,"status":"done"}));
        let retained = &model.task_status[&json!(["owner","scan"]).to_string()];
        assert_eq!(retained.current, Some(4.0)); assert_eq!(retained.lifecycle(), Lifecycle::Active);
    }
    saved(&mut model, "task:start", 6, json!({"stage":"retry","state":"retrying"}));
    let retry = &model.task_status[&json!(["owner","scan"]).to_string()];
    assert_eq!(retry.current, None); assert_eq!(retry.total, None);
    saved(&mut model, "job:end", 7, json!({"status":"failed"}));
    saved(&mut model, "task:start", 8, json!({"current":8,"total":8}));
    let terminal = &model.task_status[&json!(["owner","scan"]).to_string()];
    assert_eq!(terminal.lifecycle(), Lifecycle::Interrupted); assert_eq!(terminal.current, None);
    saved(&mut model, "job:start", 9, json!({}));
    assert!(model.task_status.is_empty(), "new owner instance retires all previous task facts");
}

#[test]
fn live_clock_invalidates_once_per_visible_second_without_reformatting_retained_logs() {
    let mut model = new_model(); model.owns_control_channel = true;
    model.update_job_status("owner", "running", None);
    model.update_task_status("owner", "scan", "running", None);
    model.task_status.get_mut(&json!(["owner","scan"]).to_string()).unwrap()
        .observe(&json!({"current":2,"total":10,"unit":"files"}), Some(0));
    model.push_log("immutable retained log".into());
    screen(&model,220,40);
    let log_pointer = model.logs.back().unwrap().text.as_ptr();
    LOG_FORMATS.with(|count| count.set(0));
    let revision = model.content_revision;
    let baseline = frame_signature(&model);
    model.dirty = false; interaction::activity_tick_at(&mut model, 999);
    assert!(!model.dirty); assert_eq!(frame_signature(&model), baseline);
    interaction::activity_tick_at(&mut model, 2000);
    assert!(model.dirty); assert_ne!(frame_signature(&model), baseline);
    assert!(screen(&model,220,40).contains("last 2s ago"));
    model.dirty = false; interaction::activity_tick_at(&mut model, 2999); assert!(!model.dirty);
    assert_eq!(LOG_FORMATS.with(|count| count.get()), 0);
    assert_eq!(model.logs.back().unwrap().text.as_ptr(), log_pointer);
    assert_eq!(model.content_revision, revision);
    model.job_status.insert("owner".into(), "cancelling".into());
    assert!(interaction::activity_text(&model).starts_with("cancel requested |"));
    for condition in ["overlay","expired","replay","passive","terminal","idle"] {
        let mut paused = new_model(); paused.owns_control_channel = true;
        paused.update_job_status("owner", "running", None);
        paused.activity_second = 2; paused.dirty = false;
        match condition {
            "overlay" => paused.overlay = OverlayMode::Help,
            "expired" => paused.selected_job_expired = true,
            "replay" => paused.session.mode = "replay".into(),
            "passive" => paused.owns_control_channel = false,
            "terminal" => { paused.job_status.insert("owner".into(), "done".into()); },
            _ => paused.selected_job = None,
        }
        interaction::activity_tick_at(&mut paused, 9000); assert!(!paused.dirty, "{condition} must not animate");
    }
}

#[test]
fn retained_cleanup_failure_never_becomes_published_success_or_resurrected_progress() {
    let mut model = measured_replay();
    saved(&mut model, "task:end", 6, json!({"status":"failed","message":"unconfirmed resource cleanup; admission remains fenced"}));
    saved(&mut model, "job:end", 7, json!({"status":"failed","exitCode":null,
        "error":{"code":"QUEUE_CLEANUP_PENDING"}}));
    let frozen = interaction::activity_text(&model);
    assert!(frozen.contains("failed")); assert!(frozen.contains("4/10 files"));
    saved(&mut model, "task:progress", 8, json!({"status":"running","current":10,"total":10}));
    assert_eq!(interaction::activity_text(&model), frozen);
    assert_eq!(model.job_status["owner"], "failed");
    assert!(screen(&model,220,40).contains("unconfirmed resource cleanup"));
    assert!(!interaction::activity_text(&model).contains("10/10"));
}

#[test]
fn missing_terminal_observations_are_interrupted_without_overwriting_real_outcomes() {
    let mut model = measured_replay();
    model.update_job_status("observed-done", "done", None);
    model.update_job_status("observed-failed", "failed", None);
    model.update_job_status("observed-cancelled", "cancelled", None);
    interrupt_unobserved_jobs(&mut model);
    assert_eq!(model.job_status["owner"], "interrupted");
    assert_eq!(model.job_status["observed-done"], "done");
    assert_eq!(model.job_status["observed-failed"], "failed");
    assert_eq!(model.job_status["observed-cancelled"], "cancelled");
    let task = &model.task_status[&json!(["owner","scan"]).to_string()];
    assert_eq!(task.lifecycle(), Lifecycle::Interrupted); assert_eq!(task.current, Some(4.0));
    assert!(snapshot_from_model(&model).final_job_statuses["owner"] == "interrupted");
}
