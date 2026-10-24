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

fn loaded_replay_events(events: Vec<Value>) -> recordings::RecordingUi {
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
    let total = events.len();
    let bytes: usize = events.iter().map(|event| serde_json::to_vec(event).unwrap().len()).sum();
    respond(
        &mut ui,
        "load",
        json!({"recordingId":id,"identity":"a".repeat(64),"runId":"saved-run",
        "eventCount":total,"eventBytes":bytes,"mode":"replay","controllable":false,"connection":"offline","source":"saved.jsonl"}),
    );
    for (page, rows) in events.chunks(128).enumerate() {
        let offset = page * 128;
        let next = offset + rows.len();
        respond(&mut ui, "page", json!({"recordingId":id,"identity":"a".repeat(64),"runId":"saved-run",
            "offset":offset,"nextOffset":if next < total { Some(next) } else { None },
            "total":total,"events":rows}));
    }
    ui
}

fn loaded_replay() -> recordings::RecordingUi {
    let events = vec![
        json!({"event":"hello","runId":"saved-run","session":{
        "mode":"supervised","source":"local-supervisor","scope":"saved-repository","controllable":true},
        "capabilities":{"supportsSearch":true,"supportsSettings":true,"supportsIndexWorkflows":true,"supportsArtifactActions":true}}),
        json!({"event":"job:start","runId":"saved-run","jobId":"saved-job","title":"Saved work"}),
        json!({"event":"job:end","runId":"saved-run","jobId":"saved-job","status":"done","exitCode":0}),
    ];
    loaded_replay_events(events)
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


fn seek_until_settled(ui: &mut recordings::RecordingUi, model: &mut AppModel, target: usize) -> usize {
    let (maximum_events, per_tick, max_checkpoints, max_bytes) = recordings::RecordingUi::replay_limits();
    ui.seek_requested = Some(target);
    let mut reductions = 0;
    for _ in 0..=maximum_events {
        ui.update_view(model);
        let (work, checkpoints, bytes, pending) = ui.replay_work();
        assert!(work <= per_tick);
        assert!(checkpoints <= max_checkpoints && bytes <= max_bytes);
        reductions += work;
        assert!(!has_live_control(model));
        assert!(model.repository_search.outbox.is_empty());
        assert!(model.settings.outbox.is_empty());
        assert!(model.job_inspection.outbox.is_empty());
        if pending.is_none() {
            assert_eq!(ui.active.as_ref().unwrap().position, target);
            return reductions;
        }
        assert!(model.session.note.contains("seeking"));
    }
    panic!("bounded replay failed to make progress");
}

fn replay_signature(model: &AppModel) -> Value {
    json!({"run":model.run_id,"jobs":model.job_status,"titles":model.job_titles,
        "tasks":model.task_status.iter().map(|(id,task)|(id,task.to_string())).collect::<BTreeMap<_,_>>(),
        "identity":model.task_identity,"taskOrder":model.task_order,"jobOrder":model.job_order,
        "logs":model.logs.iter().map(|entry|json!([entry.text,entry.level,entry.source,entry.job_id])).collect::<Vec<_>>(),
        "alerts":model.alerts.iter().map(|entry|json!([entry.level,entry.message])).collect::<Vec<_>>(),
        "scope":model.session.scope,"processed":model.telemetry.processed_events,
        "reassembled":model.telemetry.chunk_reassembled,"dropped":model.telemetry.dropped_chunks,
        "chunkBytes":model.chunk_assembly_bytes,"chunkOwners":model.chunk_assemblies.len()})
}

#[test]
fn mismatched_chunk_disposal_releases_its_retained_byte_charge() {
    let mut model = passive_model();
    apply_protocol_event(&mut model, json!({"event":"event:chunk","chunkId":"mismatch",
        "chunkIndex":0,"chunkCount":2,"chunk":"retained"}), 0);
    assert_eq!(model.chunk_assembly_bytes, 8);
    apply_protocol_event(&mut model, json!({"event":"event:chunk","chunkId":"mismatch",
        "chunkIndex":1,"chunkCount":3,"chunk":"rejected"}), 0);
    assert!(model.chunk_assemblies.is_empty());
    assert_eq!(model.chunk_assembly_bytes, 0);
    assert_eq!(model.telemetry.dropped_chunks, 1);
}

#[test]
fn maximum_recording_seeks_use_bounded_checkpoints_and_preserve_view_identity() {
    let (maximum, per_tick, _, _) = recordings::RecordingUi::replay_limits();
    let mut events = vec![
        json!({"event":"hello","runId":"saved-run","session":{"scope":"saved-repository"}}),
        json!({"event":"job:start","runId":"saved-run","jobId":"pinned-job","title":"Pinned"}),
        json!({"event":"task:start","runId":"saved-run","jobId":"pinned-job","taskId":"work"}),
    ];
    while events.len() < 255 {
        events.push(json!({"event":"log","runId":"saved-run","jobId":"pinned-job","message":"before checkpoint"}));
    }
    let chunked = json!({"event":"job:start","runId":"saved-run","jobId":"chunked-job","title":"Chunk owner"}).to_string();
    let split = chunked.len() / 2;
    for (index, chunk) in [&chunked[..split], &chunked[split..]].iter().enumerate() {
        events.push(json!({"event":"event:chunk","runId":"saved-run","chunkId":"split-at-checkpoint",
            "chunkIndex":index,"chunkCount":2,"chunk":chunk}));
    }
    while events.len() < maximum - 2 {
        events.push(json!({"event":"task:progress","runId":"saved-run","jobId":"pinned-job",
            "taskId":"work","message":format!("step {}",events.len())}));
    }
    events.push(json!({"event":"task:end","runId":"saved-run","jobId":"pinned-job","taskId":"work","status":"done"}));
    events.push(json!({"event":"job:end","runId":"saved-run","jobId":"pinned-job","status":"done"}));
    let mut reference = passive_model();
    for event in &events { apply_protocol_event(&mut reference, event.clone(), 0); }
    let expected = replay_signature(&reference);
    let mut ui = loaded_replay_events(events);
    let mut model = passive_model();
    model.owns_control_channel = true;
    model.session.controllable = true;
    model.job_status.insert("live-only".into(), "running".into());
    ui.update_view(&mut model);
    ui.seek_requested = Some(maximum);
    ui.update_view(&mut model);
    assert!(ui.replay_work().0 <= per_tick && ui.replay_work().3.is_some());
    // Replacement targets coalesce instead of completing a superseded End.
    ui.seek_requested = Some(2);
    ui.update_view(&mut model);
    assert_eq!(ui.active.as_ref().unwrap().position, 2);
    model.selected_job = Some("pinned-job".into());
    model.selected_job_pinned = true;
    model.job_scroll = 7; model.task_scroll = 5; model.log_scroll = 9;
    model.search_jobs = "Pinned".into(); model.follow_updates = false;
    seek_until_settled(&mut ui, &mut model, maximum);
    assert_eq!(replay_signature(&model), expected);
    assert_eq!(seek_until_settled(&mut ui, &mut model, maximum), 0, "identical End is a no-op");
    for target in (maximum - 64..maximum).rev() {
        assert!(seek_until_settled(&mut ui, &mut model, target) < 256);
        assert_eq!(model.selected_job.as_deref(), Some("pinned-job"));
        assert!(!model.selected_job_expired);
        assert_eq!((model.job_scroll, model.task_scroll, model.log_scroll), (7,5,9));
        assert_eq!(model.search_jobs, "Pinned");
    }
    seek_until_settled(&mut ui, &mut model, 256);
    assert_eq!(model.chunk_assemblies.len(), 1);
    seek_until_settled(&mut ui, &mut model, 257);
    assert_eq!(model.telemetry.chunk_reassembled, 1);
    assert!(model.job_status.contains_key("chunked-job"));
    seek_until_settled(&mut ui, &mut model, 0);
    assert_eq!(model.selected_job.as_deref(), Some("pinned-job"));
    assert!(model.selected_job_expired, "missing replay identity is explicit, never substituted");
    ui.detach_requested = true;
    ui.update_view(&mut model);
    assert!(has_live_control(&model));
    assert_eq!(model.job_status["live-only"], "running");
    assert!(!model.job_status.contains_key("pinned-job"));
    assert_eq!(ui.replay_work().1, 0);
}
