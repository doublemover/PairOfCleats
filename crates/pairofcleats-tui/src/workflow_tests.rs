use super::workflows::*;
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::json;

fn key(ui: &mut WorkflowUi, code: KeyCode) {
    ui.key(KeyEvent::new(code, KeyModifiers::NONE));
}

#[test]
fn rendered_workflow_catalog_and_long_preview_reach_selected_identity_and_both_ends() {
    use crate::overlay_viewport::render_test_rows;
    for (width, height) in [(80u16, 24u16), (90, 18)] {
        let mut ui = WorkflowUi::default();
        ui.available = true;
        ui.open("fixture");
        key(&mut ui, KeyCode::Enter);
        let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
        ui.event(&json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
            "result":{"method":"select","data":{"id":"scope","kind":"repo","target":format!("FIRST/{}", "long-directory/".repeat(100))}}}));
        let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
        let commands: Vec<_> = (0..60).map(|index| json!({"id":format!("CMD-{index:02}"),"scopeKind":"repo","fields":[],"description":"long description ".repeat(20)})).collect();
        ui.event(
            &json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
            "result":{"method":"describe","data":{"commands":commands}}}),
        );
        for index in 0..60 {
            let screen = render_test_rows(
                ui.lines((height - 2) as usize, (width - 2) as usize),
                width,
                height,
            );
            assert!(screen.contains(&format!("> CMD-{index:02}")));
            if index < 59 {
                key(&mut ui, KeyCode::Down);
            }
        }
        key(&mut ui, KeyCode::Enter);
        key(&mut ui, KeyCode::Char('p'));
        let request = ui.outbox.pop_front().unwrap();
        assert_eq!(request["params"]["commandId"], "CMD-59");
        ui.event(&json!({"event":"job:end","jobId":request["jobId"],"status":"done","resultState":"complete",
            "result":{"method":"preview","data":{"launchable":false,"canonicalArgv":["START", "界😀 ".repeat(500)],"observations":{"zz_end":"LAST"}}}}));
        let first = render_test_rows(
            ui.lines((height - 2) as usize, (width - 2) as usize),
            width,
            height,
        );
        assert!(first.contains("FIRST"));
        for _ in 0..10000 {
            key(&mut ui, KeyCode::Down);
        }
        let last = render_test_rows(
            ui.lines((height - 2) as usize, (width - 2) as usize),
            width,
            height,
        );
        assert!(last.contains("LAST"));
        for _ in 0..10000 {
            key(&mut ui, KeyCode::Up);
        }
        assert!(render_test_rows(
            ui.lines((height - 2) as usize, (width - 2) as usize),
            width,
            height
        )
        .contains("FIRST"));
    }
}

#[test]
fn passive_workflow_never_enqueues_launch_or_cancel() {
    let mut ui = WorkflowUi::default();
    ui.open("private-repository");
    for code in [KeyCode::Char('c'), KeyCode::Enter, KeyCode::Char('p')] {
        key(&mut ui, code);
    }
    assert!(ui.outbox.is_empty());
    assert!(ui.lines(30, 100).join("\n").contains("unavailable"));
}

#[test]
fn semantic_next_uses_owned_scope_capability_and_escape_disposes_before_replacing_result() {
    let mut ui = WorkflowUi::default();
    ui.available = true;
    ui.open("repo");
    key(&mut ui, KeyCode::Enter);
    let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
        "result":{"method":"select","data":{"id":"scope-a","kind":"repo"}}}),
    );
    let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(&json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
        "result":{"method":"describe","data":{"commands":[{"id":"semantic.trace","scopeKind":"repo","fields":[]}]}}}));
    key(&mut ui, KeyCode::Enter);
    key(&mut ui, KeyCode::Char('p'));
    let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(&json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
        "result":{"method":"preview","data":{"launchable":true,"previewId":"plan","plannedJobId":"workflow-page"}}}));
    key(&mut ui, KeyCode::Enter);
    let id = ui.outbox.pop_front().unwrap()["jobId"].clone();
    ui.event(
        &json!({"event":"job:end","jobId":id,"status":"done","resultState":"complete",
        "result":{"method":"launch","data":{"jobId":"workflow-page"}}}),
    );
    ui.event(
        &json!({"event":"job:end","jobId":"workflow-page","status":"done","resultState":"complete",
        "result":{"rows":[1],"nativeContinuation":{"id":"private-session","scopeId":"scope-a"}}}),
    );
    key(&mut ui, KeyCode::Char('t'));
    assert!(
        ui.outbox.is_empty(),
        "a status refresh cannot discard the only continuation capability"
    );
    key(&mut ui, KeyCode::Char('n'));
    let next = ui.outbox.pop_front().unwrap();
    assert_eq!(next["method"], "next");
    assert_eq!(
        next["params"],
        json!({"scopeId":"scope-a","continuationId":"private-session"})
    );
    assert!(next["params"].get("cursor").is_none());
    ui.event(&json!({"event":"job:end","jobId":next["jobId"],"status":"done","resultState":"complete",
        "result":{"method":"next","data":{"rows":[2],"nativeContinuation":{"id":"private-session","scopeId":"scope-a"}}}}));
    key(&mut ui, KeyCode::Esc);
    let close = ui.outbox.pop_front().unwrap();
    assert_eq!(close["method"], "close-continuation");
    ui.event(
        &json!({"event":"job:end","jobId":close["jobId"],"status":"done","resultState":"complete",
        "result":{"method":"close-continuation","data":{"discarded":true}}}),
    );
    key(&mut ui, KeyCode::Char('n'));
    assert!(
        ui.outbox.is_empty(),
        "a disposed continuation cannot be replayed by native input"
    );
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
    let display = ui.lines(50, 100).join("\n");
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
