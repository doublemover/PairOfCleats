use super::*;

#[test]
fn failure_recovery_navigation_is_scope_bound_and_setup_is_metadata_only() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "NO_INDEX");
    key(&mut ui, KeyCode::Char('i'));
    assert_eq!(
        ui.take_recovery(),
        Some(("/selected repository".into(), "index.validate"))
    );
    assert!(ui.outbox.is_empty());
    ui.fields[0] = "/other repository".into();
    key(&mut ui, KeyCode::Char('i'));
    assert!(ui.take_recovery().is_none());
    ui.scope_changed("/selected repository");
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "CAPABILITY_MISSING");
    key(&mut ui, KeyCode::Char('p'));
    assert_eq!(
        ui.take_recovery(),
        Some(("/selected repository".into(), "tooling.doctor"))
    );
    key(&mut ui, KeyCode::Char('s'));
    assert_eq!(ui.outbox.pop_front().unwrap()["method"], "readiness");
    reply(
        &mut ui,
        "readiness",
        json!({"prepared":true,"qualification":"activation-metadata-only","nativeProbesRun":false}),
    );
    assert_eq!(
        ui.failure.as_ref().unwrap().definition.reason,
        "missing-capability"
    );
    assert!(ui
        .lines(24, 100)
        .join("\n")
        .contains("runtime qualification did not run"));
    assert!(ui.outbox.is_empty());
}

fn fail(ui: &mut SearchUi, code: &str) {
    let id = ui.pending.as_ref().unwrap().0.clone();
    ui.event(
        &json!({"event":"job:end","jobId":id,"status":"failed","result":null,
        "error":{"code":code,"message":"PRIVATE_SECRET C:/private\u{1b}[31m"}}),
    );
}

#[test]
fn failed_first_search_has_a_failure_and_never_claims_an_empty_response() {
    let mut ui = ready();
    ui.fields[1] = "private-query".into();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "NO_INDEX");
    assert_eq!(ui.outcome, SearchOutcome::QueryFailed);
    assert!(ui.result.is_none());
    assert!(ui.rows.is_empty());
    for (height, width) in [(24, 80), (24, 24)] {
        let lines = ui.lines(height, width);
        let text = lines.join("\n");
        assert!(text.contains("query-failed"));
        assert!(!text.contains("contains no hits"));
        assert!(!text.contains("PRIVATE_SECRET"));
        assert!(!text.contains("private-query"));
        assert!(lines.iter().all(|line| line.chars().count() <= width));
    }
    key(&mut ui, KeyCode::Char('r'));
    let request = ui.outbox.pop_front().unwrap();
    assert_eq!(request["params"]["repoPath"], "/selected repository");
    assert_eq!(request["params"]["search"]["query"], "private-query");
    reply(&mut ui, "query", page(vec![]));
    assert_eq!(ui.outcome, SearchOutcome::SuccessfulEmpty);
    assert!(ui.lines(24, 80).join("\n").contains("contains no hits"));
}

#[test]
fn narrow_failure_keeps_the_repository_reason_on_one_row() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "ERR_TUI_SCOPE_INVALID");
    assert!(
        ui.lines(24, 28)
            .iter()
            .any(|line| line == "Reason: invalid-repository"),
        "a narrow failure keeps its closed reason intact on a separate row"
    );
    assert!(ui.outbox.is_empty());
}

#[test]
fn failure_outcomes_remain_distinct_and_unknown_text_is_not_rendered() {
    for (code, expected) in [
        ("ABORT_ERR", SearchOutcome::Cancelled),
        ("ERR_TUI_OPERATION_TIMEOUT", SearchOutcome::TimedOut),
        ("ERR_TUI_RESOURCE_PENDING", SearchOutcome::ResourcePending),
        ("PRIVATE_SECRET", SearchOutcome::QueryFailed),
    ] {
        let mut ui = ready();
        key(&mut ui, KeyCode::Enter);
        ui.outbox.clear();
        fail(&mut ui, code);
        assert_eq!(ui.outcome, expected);
        assert!(!ui.lines(24, 80).join("\n").contains("PRIVATE_SECRET"));
        key(&mut ui, KeyCode::Char('d'));
        assert!(!ui
            .lines(24, 80)
            .join("\n")
            .contains("diagnostics were not recorded"));
    }
}

#[test]
fn cancellation_waits_for_actual_terminal_settlement() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    assert!(!key(&mut ui, KeyCode::Esc));
    assert!(ui.pending.is_some());
    assert_eq!(ui.outcome, SearchOutcome::Running);
    assert_eq!(ui.outbox.pop_front().unwrap()["op"], "job:cancel");
    fail(&mut ui, "ERR_TUI_RESOURCE_PENDING");
    assert_eq!(ui.outcome, SearchOutcome::ResourcePending);
}

#[test]
fn cleanup_status_does_not_retry_or_release_on_missing_fields() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "ERR_TUI_RESOURCE_PENDING");
    key(&mut ui, KeyCode::Char('r'));
    assert!(ui.outbox.is_empty());
    key(&mut ui, KeyCode::Char('t'));
    assert_eq!(ui.outbox.pop_front().unwrap()["method"], "status");
    reply(&mut ui, "status", json!({}));
    assert!(!ui.cleanup_ready);
    key(&mut ui, KeyCode::Char('r'));
    assert!(ui.outbox.is_empty());
    key(&mut ui, KeyCode::Char('t'));
    ui.outbox.clear();
    reply(
        &mut ui,
        "status",
        json!({"resourcePending":false,"closed":false}),
    );
    assert!(ui.cleanup_ready);
    assert!(ui.outbox.is_empty());
    key(&mut ui, KeyCode::Char('r'));
    assert_eq!(ui.outbox.pop_front().unwrap()["method"], "query");
}

#[test]
fn failure_correction_does_not_turn_typed_recovery_keys_into_actions() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    fail(&mut ui, "INVALID_REQUEST");
    key(&mut ui, KeyCode::Char('e'));
    for letter in "red".chars() {
        key(&mut ui, KeyCode::Char(letter));
    }
    assert_eq!(ui.fields[1], "red");
    assert!(ui.outbox.is_empty());
    key(&mut ui, KeyCode::Enter);
    assert_eq!(
        ui.outbox.pop_front().unwrap()["params"]["search"]["query"],
        "red"
    );
}

#[test]
fn old_failures_and_actions_cannot_retarget_a_new_repository() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    let old = ui.outbox.pop_front().unwrap();
    ui.scope_changed("/new repository");
    ui.outbox.clear();
    ui.event(&json!({"event":"job:end","jobId":old["jobId"],"status":"failed","error":{"code":"NO_INDEX"}}));
    assert!(ui.failure.is_none());
    assert!(ui.failed_request.is_none());
    key(&mut ui, KeyCode::Char('r'));
    assert!(ui.outbox.is_empty());
    assert_eq!(ui.fields[0], "/new repository");
}

#[test]
fn invalid_success_response_is_a_failure_without_discarding_previous_hits() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    reply(&mut ui, "query", page(vec![hit("code", 1, "one")]));
    ui.outbox.clear();
    assert_eq!(ui.outcome, SearchOutcome::SuccessfulResults);
    key(&mut ui, KeyCode::Char('n'));
    ui.outbox.clear();
    reply(&mut ui, "continue", page(vec![hit("code", 1, "one")]));
    assert_eq!(ui.outcome, SearchOutcome::QueryFailed);
    assert_eq!(ui.rows.len(), 1);
    assert!(ui
        .lines(24, 80)
        .join("\n")
        .contains("previous admitted response"));
}

#[test]
fn pasted_middle_query_and_rendered_result_click_never_submit_or_open_implicitly() {
    let mut ui = ready();
    ui.outbox.clear();
    ui.fields[1] = "ab界e\u{301}😀".into();
    ui.key(KeyCode::Left.into());
    ui.key(KeyCode::Backspace.into());
    ui.paste("echo q\n\u{1b}\u{3}");
    assert_eq!(ui.fields[1], "ab界echo q 😀");
    assert!(ui.outbox.is_empty());
    ui.page = Page::Results;
    ui.rows = vec![hit("code", 1, "first"), hit("code", 2, "second")];
    ui.result = Some(page(ui.rows.clone()));
    ui.selected = 0;
    let rows = ui.lines(20, 76);
    let second = rows.iter().position(|row| row.contains("#2")).unwrap();
    ui.click(second);
    assert_eq!(ui.rows[ui.selected]["hitId"], "second");
    assert!(
        ui.outbox.is_empty(),
        "click selects; Enter alone requests source"
    );
    ui.key(KeyCode::Enter.into());
    assert_eq!(ui.outbox.back().unwrap()["params"]["hitId"], "second");
    assert_eq!(ui.outbox.back().unwrap()["method"], "source");
}

#[test]
fn diagnostics_are_recorded_read_only_and_bound_to_the_current_response() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    let mut data = page(vec![hit("code", 1, "one"), hit("code", 2, "two")]);
    data["searchDiagnostics"] = json!({"schemaVersion":1,"state":"recorded",
        "summary":"Backend: memory; fidelity: fallback-derived; requested: sqlite",
        "backend":{"selected":"memory","requested":"sqlite","fidelity":"fallback-derived"},
        "reasons":[],"details":["Backend: memory; fidelity: fallback-derived",
        "Recorded index identity does not verify the current worktree.",
        "Recorded code generation: old-generation", "coverage-check: inspect indexed coverage"],"truncated":false});
    reply(&mut ui, "query", data);
    key(&mut ui, KeyCode::Down);
    assert_eq!(ui.selected, 1);
    assert!(ui.status.contains("fallback results"));
    key(&mut ui, KeyCode::Char('d'));
    assert!(ui.page == Page::Diagnostics);
    let text = ui.lines(20, 100).join("\n");
    for expected in [
        "old-generation",
        "coverage-check",
        "does not verify",
        "runs no command",
    ] {
        assert!(text.contains(expected), "{expected}");
    }
    for _ in 0..40 {
        key(&mut ui, KeyCode::PageDown);
    }
    assert!(ui
        .lines(8, 20)
        .iter()
        .all(|line| line.chars().count() <= 20));
    key(&mut ui, KeyCode::Home);
    assert!(ui.lines(20, 100).join("\n").contains("old-generation"));
    assert!(ui.outbox.is_empty());
    assert!(!key(&mut ui, KeyCode::Esc));
    assert_eq!(ui.selected, 1);
    assert!(ui.page == Page::Results);
    ui.scope_changed("/new repository");
    assert!(ui.result.is_none());
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(&mut ui, "query", page(vec![]));
    assert!(ui
        .lines(20, 100)
        .join("\n")
        .contains("diagnostics were not recorded"));
    key(&mut ui, KeyCode::Char('d'));
    assert!(!ui.lines(20, 100).join("\n").contains("old-generation"));
    assert!(ui.outbox.is_empty());
}

fn key(ui: &mut SearchUi, code: KeyCode) -> bool {
    ui.key(KeyEvent::new(code, KeyModifiers::NONE))
}

fn reply(ui: &mut SearchUi, method: &str, data: Value) {
    let id = ui.pending.as_ref().unwrap().0.clone();
    assert!(
        ui.event(&json!({"jobId":id,"event":"job:end","status":"done",
        "resultState":"complete","result":{"method":method,"data":data}}))
    );
}

fn ready() -> SearchUi {
    let mut ui = SearchUi {
        available: true,
        ..SearchUi::default()
    };
    ui.open("/selected repository");
    let describe = ui.outbox.pop_front().unwrap();
    assert_eq!(describe["method"], "describe");
    reply(
        &mut ui,
        "describe",
        json!({"schema":{"properties":{"mode":{"enum":["all","code"]},
        "backend":{"enum":["auto","memory"]}}},"resultModes":["code","prose","extracted-prose","records"],
        "defaults":{"mode":"all","backend":"auto","top":10}}),
    );
    ui
}

fn hit(mode: &str, rank: u64, id: &str) -> Value {
    json!({"hitId":id,"mode":mode,"rank":rank,"score":7,"file":"src/answer.js",
        "startLine":1,"endLine":2,"name":"answer"})
}

fn page(hits: Vec<Value>) -> Value {
    json!({"resultId":"result-1","scopeId":"scope-1","queryGeneration":1,"repoPath":"/selected repository",
        "hits":hits,"pagination":{"nextCursor":"canonical-cursor"},"freshness":{"generationKey":"index-1"}})
}

#[test]
fn composer_uses_described_defaults_and_preserves_shared_filters() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Char('a'));
    ui.fields[7] = "{\"lang\":\"javascript\",\"riskTag\":\"user-input\"}".into();
    key(&mut ui, KeyCode::Enter);
    let query = ui.outbox.pop_front().unwrap();
    assert_eq!(query["op"], "search:run");
    assert_eq!(query["method"], "query");
    assert_eq!(query["params"]["repoPath"], "/selected repository");
    assert_eq!(
        query["params"]["search"],
        json!({"query":"a","mode":"all","backend":"auto", "top":10,
        "lang":"javascript","riskTag":"user-input"})
    );
}

#[test]
fn conflicts_and_invalid_filters_cannot_submit() {
    let mut ui = ready();
    ui.fields[5] = "snapshot-id".into();
    ui.fields[6] = "commit:other".into();
    key(&mut ui, KeyCode::Enter);
    assert!(ui.outbox.is_empty());
    assert!(ui.status.contains("Snapshot or As of"));
    ui.fields[5].clear();
    ui.fields[6].clear();
    ui.fields[7] = "[]".into();
    key(&mut ui, KeyCode::Enter);
    assert!(ui.outbox.is_empty());
    ui.fields[7] = "{\"mode\":\"code\"}".into();
    key(&mut ui, KeyCode::Enter);
    assert!(ui.status.contains("set in both"));
}

#[test]
fn edited_query_cancels_and_discards_old_responses() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Char('a'));
    key(&mut ui, KeyCode::Enter);
    let old = ui.outbox.pop_front().unwrap();
    key(&mut ui, KeyCode::Char('e'));
    let cancel = ui.outbox.pop_front().unwrap();
    assert_eq!(cancel["op"], "job:cancel");
    assert_eq!(cancel["jobId"], old["jobId"]);
    key(&mut ui, KeyCode::Char('b'));
    key(&mut ui, KeyCode::Enter);
    let replacement = ui.outbox.pop_front().unwrap();
    assert!(ui.event(&json!({"jobId":old["jobId"],"event":"job:end","status":"done",
        "resultState":"complete","result":{"method":"query","data":page(vec![hit("code",1,"old")])}})));
    assert!(ui.rows.is_empty());
    assert_eq!(
        ui.pending.as_ref().unwrap().0,
        replacement["jobId"].as_str().unwrap()
    );
    reply(&mut ui, "query", page(vec![hit("code", 1, "new")]));
    assert_eq!(ui.rows[0]["hitId"], "new");
}

#[test]
fn continuation_preserves_per_mode_rank_and_rejects_duplicate_hits() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(
        &mut ui,
        "query",
        page(vec![hit("code", 1, "c1"), hit("prose", 1, "p1")]),
    );
    key(&mut ui, KeyCode::Char('n'));
    let request = ui.outbox.pop_front().unwrap();
    assert_eq!(request["params"], json!({"resultId":"result-1"}));
    ui.selected = 1; // User navigation while continuation is pending owns response-time selection.
    reply(
        &mut ui,
        "continue",
        page(vec![hit("code", 2, "c2"), hit("prose", 2, "p2")]),
    );
    assert_eq!(
        ui.rows
            .iter()
            .map(|row| row["hitId"].as_str().unwrap())
            .collect::<Vec<_>>(),
        vec!["c1", "c2", "p1", "p2"]
    );
    assert_eq!(ui.rows[ui.selected]["hitId"], "p1");
    key(&mut ui, KeyCode::Char('n'));
    ui.outbox.clear();
    reply(&mut ui, "continue", page(vec![hit("code", 2, "c2")]));
    assert_eq!(ui.rows.len(), 4);
    assert!(ui.status.contains("invalid or repeated"));
}

#[test]
fn source_is_bound_to_the_current_hit_and_scope_changes_clear_it() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(&mut ui, "query", page(vec![hit("code", 1, "selected")]));
    key(&mut ui, KeyCode::Enter);
    let source_request = ui.outbox.pop_front().unwrap();
    assert_eq!(
        source_request["params"],
        json!({"resultId":"result-1","hitId":"selected"})
    );
    reply(
        &mut ui,
        "source",
        json!({"resultId":"result-1","hitId":"other","available":true,"excerpt":"wrong"}),
    );
    assert!(ui.source.is_none());
    assert!(ui.status.contains("STALE"));
    ui.scope_changed("/different repository");
    assert!(ui.result.is_none());
    assert!(ui.rows.is_empty());
    assert!(ui.source.is_none());
}

#[test]
fn passive_sessions_cannot_dispatch_search_or_source() {
    let mut ui = SearchUi::default();
    ui.open("/repository");
    key(&mut ui, KeyCode::Enter);
    assert!(ui.outbox.is_empty());
    assert!(ui.lines(20, 100).join("\n").contains("Read only"));
    assert!(key(&mut ui, KeyCode::Esc));
}

#[test]
fn returning_from_source_restores_the_results_status() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(&mut ui, "query", page(vec![hit("code", 1, "selected")]));
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(
        &mut ui,
        "source",
        json!({"resultId":"result-1","hitId":"selected","available":true,"excerpt":"return 42"}),
    );
    assert!(ui.status.contains("source preview"));
    assert!(!key(&mut ui, KeyCode::Esc));
    assert!(ui.status.contains("1 indexed hits"));
    assert!(key(&mut ui, KeyCode::Esc));
}

#[test]
fn selected_results_remain_visible_below_long_headers() {
    use ratatui::{
        backend::TestBackend,
        widgets::{Paragraph, Wrap},
        Terminal,
    };
    let mut ui = ready();
    ui.fields[4] = "50".into();
    key(&mut ui, KeyCode::Char('a'));
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    let mut data = page(
        (1..=50)
            .map(|rank| hit("code", rank, &format!("hit-{rank}")))
            .collect(),
    );
    data["repoPath"] = json!(format!("/{}", "long-repository/".repeat(20)));
    reply(&mut ui, "query", data);
    for _ in 0..49 {
        key(&mut ui, KeyCode::Down);
    }
    let mut terminal = Terminal::new(TestBackend::new(40, 8)).unwrap();
    terminal
        .draw(|frame| {
            frame.render_widget(
                Paragraph::new(ui.lines(8, 40).join("\n")).wrap(Wrap { trim: false }),
                frame.area(),
            )
        })
        .unwrap();
    let screen = terminal
        .backend()
        .buffer()
        .content
        .iter()
        .map(|cell| cell.symbol())
        .collect::<String>();
    assert!(
        screen.contains("> code #50"),
        "selected result must survive the real paragraph renderer: {screen}"
    );
}

#[test]
fn editor_navigation_requires_confirmation_and_the_preview_identity() {
    let mut ui = ready();
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(&mut ui, "query", page(vec![hit("code", 1, "selected")]));
    key(&mut ui, KeyCode::Enter);
    ui.outbox.clear();
    reply(
        &mut ui,
        "source",
        json!({"resultId":"result-1","hitId":"selected","available":true,
        "excerpt":"return 42", "sourceIdentity":{"currentHash":format!("sha1:{}", "a".repeat(40))}}),
    );
    key(&mut ui, KeyCode::Char('o'));
    assert!(ui.lines(20, 100).join("\n").contains("Enter confirms"));
    assert!(ui.outbox.is_empty());
    assert!(!key(&mut ui, KeyCode::Esc));
    assert!(ui.outbox.is_empty());
    key(&mut ui, KeyCode::Char('o'));
    key(&mut ui, KeyCode::Enter);
    let request = ui.outbox.pop_front().unwrap();
    assert_eq!(request["method"], "open");
    assert_eq!(
        request["params"],
        json!({"resultId":"result-1","hitId":"selected", "editor":"code",
        "confirmed":true,"sourceHash":format!("sha1:{}", "a".repeat(40))})
    );
}
