use super::*;

fn passive_model() -> AppModel {
    AppModel::new(
        "recorded-run".into(),
        TerminalCapabilities {
            color: false,
            unicode: true,
            mouse: false,
            alt_screen: false,
        },
        None,
    )
}

#[test]
fn a_saved_hello_cannot_grant_a_control_channel() {
    let mut model = passive_model();
    apply_protocol_event(
        &mut model,
        json!({"event":"hello", "runId":"saved-run",
        "session":{"mode":"supervised", "source":"local-supervisor", "controllable":true},
        "capabilities":{"supportsSearch":true,"supportsSettings":true,
          "supportsIndexWorkflows":true,"supportsArtifactActions":true}}),
        0,
    );
    assert!(
        !model.session.controllable,
        "data cannot manufacture an owned transport"
    );
    assert!(!model.repository_search.available);
    assert!(!model.settings.available);
    assert!(!model.index_workflows.available);
    assert!(!model.job_inspection.available);
    assert!(model.repository_search.outbox.is_empty());
}

fn respond(ui: &mut recordings::RecordingUi, method: &str, data: Value) {
    let request = ui.outbox.pop_front().expect("real typed UI request");
    assert_eq!(request["method"], method);
    ui.supervisor_event(
        &json!({"event":"job:end","jobId":request["jobId"],"status":"done",
        "result":{"method":method,"data":data}}),
        true,
    );
}

fn loaded_replay() -> recordings::RecordingUi {
    use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
    let mut ui = recordings::RecordingUi::default();
    ui.supervisor_event(
        &json!({"event":"hello","capabilities":{"supportsRecordings":true},
        "session":{"mode":"supervised","controllable":true}}),
        true,
    );
    ui.open(&std::env::temp_dir());
    ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    let id = "cda931bc-9b07-48a2-a2b8-80e53e828541";
    respond(
        &mut ui,
        "list",
        json!({"directoryId":id,"entries":[{"id":id,"filename":"saved.jsonl","valid":true}]}),
    );
    ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
    let events = vec![
        json!({"event":"hello","runId":"saved-run","session":{
        "mode":"supervised","source":"local-supervisor","scope":"saved-repository","controllable":true},
        "capabilities":{"supportsSearch":true,"supportsSettings":true,"supportsIndexWorkflows":true,"supportsArtifactActions":true}}),
        json!({"event":"job:start","runId":"saved-run","jobId":"saved-job","title":"Saved work"}),
        json!({"event":"job:end","runId":"saved-run","jobId":"saved-job","status":"done","exitCode":0}),
    ];
    respond(
        &mut ui,
        "load",
        json!({"recordingId":id,"identity":"a".repeat(64),"runId":"saved-run",
        "eventCount":3,"eventBytes":2000,"mode":"replay","controllable":false,"connection":"offline","source":"saved.jsonl"}),
    );
    respond(
        &mut ui,
        "page",
        json!({"recordingId":id,"identity":"a".repeat(64),"runId":"saved-run",
        "offset":0,"nextOffset":null,"total":3,"events":events}),
    );
    ui
}

#[test]
fn replay_seek_and_detach_keep_live_jobs_and_authority_separate() {
    let mut ui = loaded_replay();
    let mut model = passive_model();
    model.owns_control_channel = true;
    model.session.controllable = true;
    model
        .job_status
        .insert("owned-watch".into(), "running".into());
    ui.update_view(&mut model);
    assert_eq!(model.session.mode, "replay");
    assert!(!model.owns_control_channel);
    assert!(model.job_status.is_empty());
    assert_eq!(
        ui.live_model.as_ref().unwrap().job_status["owned-watch"],
        "running"
    );
    ui.seek_requested = Some(3);
    ui.update_view(&mut model);
    assert_eq!(model.job_status["saved-job"], "done");
    assert!(!has_live_control(&model));
    assert!(model.repository_search.outbox.is_empty());
    assert_eq!(model.session.source, "saved.jsonl");
    ui.seek_requested = Some(0);
    ui.update_view(&mut model);
    assert!(model.job_status.is_empty());
    ui.seek_requested = Some(3);
    ui.update_view(&mut model);
    assert_eq!(model.job_status["saved-job"], "done");
    ui.detach_requested = true;
    ui.update_view(&mut model);
    assert!(has_live_control(&model));
    assert_eq!(model.job_status["owned-watch"], "running");
    assert!(!model.job_status.contains_key("saved-job"));
    assert!(ui.active.is_none() && ui.live_model.is_none());
    assert!(ui
        .outbox
        .iter()
        .all(|r| r["op"] == "recording:run" && r["method"] == "discard"));
}
