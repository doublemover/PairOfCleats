use super::workflows::*;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::json;

fn key(ui: &mut WorkflowUi, code: KeyCode) {
    ui.key(KeyEvent::new(code, KeyModifiers::NONE));
}

#[test]
fn passive_workflow_never_enqueues_launch_or_cancel() {
    let mut ui = WorkflowUi::default();
    ui.open("private-repository");
    for code in [KeyCode::Char('c'), KeyCode::Enter, KeyCode::Char('p')] {
        key(&mut ui, code);
    }
    assert!(ui.outbox.is_empty());
    assert!(ui.lines(30).join("\n").contains("unavailable"));
}

#[test]
fn completion_before_admission_preserves_actual_failure_and_matching_job_identity() {
    let mut ui = WorkflowUi::default();
    ui.available = true;
    ui.open("repo");
    key(&mut ui, KeyCode::Enter);
    let select_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":select_id,"status":"done","resultState":"complete",
        "result":{"method":"select","data":{"id":"scope","kind":"repo"}}}),
    );
    let describe_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(&json!({"event":"job:end","jobId":describe_id,"status":"done","resultState":"complete",
        "result":{"method":"describe","data":{"commands":[{"id":"index.build","scopeKind":"repo","fields":[]}]}}}));
    key(&mut ui, KeyCode::Enter);
    key(&mut ui, KeyCode::Char('p'));
    let preview_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":preview_id,"status":"done","resultState":"complete",
        "result":{"method":"preview","data":{"launchable":true,"previewId":"plan","plannedJobId":"workflow-real"}}}),
    );
    key(&mut ui, KeyCode::Enter);
    let launch_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    assert!(!ui.event(&json!({"event":"job:end","jobId":"workflow-real","status":"failed","resultState":"incomplete",
        "error":{"code":"ERR_TUI_WORKFLOW_STALE"},"workflow":{"publications":[{"producedReadyGeneration":false}]}})));
    for index in 0..5 {
        ui.event(&json!({"event":"job:end","jobId":format!("workflow-other-{index}"),"status":"done","resultState":"complete"}));
    }
    assert!(ui.event(
        &json!({"event":"job:end","jobId":launch_id,"status":"done","resultState":"complete",
        "result":{"method":"launch","data":{"launched":true,"jobId":"workflow-real"}}})
    ));
    let display = ui.lines(50).join("\n");
    assert!(display.contains("ERR_TUI_WORKFLOW_STALE"));
    assert!(display.contains("failed"));
    key(&mut ui, KeyCode::Char('c'));
    assert_eq!(ui.outbox.back().unwrap()["jobId"], "workflow-real");
    ui.outbox.clear();
    key(&mut ui, KeyCode::Esc);
    key(&mut ui, KeyCode::Char('s'));
    key(&mut ui, KeyCode::Enter);
    let select_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(&json!({"event":"job:end","jobId":select_id,"status":"done","resultState":"complete",
        "result":{"method":"select","data":{"id":"other-scope","kind":"repo","target":"other-repository"}}}));
    let describe_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":describe_id,"status":"done","resultState":"complete",
        "result":{"method":"describe","data":{"commands":[]}}}),
    );
    key(&mut ui, KeyCode::Char('t'));
    let status_id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":status_id,"status":"done","resultState":"complete",
        "result":{"method":"status","data":{"publications":[]}}}),
    );
    key(&mut ui, KeyCode::Char('c'));
    assert!(
        ui.outbox.is_empty(),
        "a new scope cannot inherit the previous scope's cancel target"
    );
}
