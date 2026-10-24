mod replay_state;
use replay_state::ReplayState;
use std::collections::VecDeque;
use std::path::Path;
use std::time::{Duration, Instant};

use super::{apply_protocol_event, AppModel};
use crate::overlay_viewport::{selected_rows, selected_window};
use crate::text_editor::TextCursor;
use crossterm::event::{KeyCode, KeyEvent};
use serde_json::{json, Value};

const MAX_EVENTS: usize = 32768;
const MAX_BYTES: usize = 8 * 1024 * 1024;
const SEEK_EVENTS_PER_TICK: usize = 128;
const SEEK_TICK_BUDGET: Duration = Duration::from_millis(4);
const CHECKPOINT_INTERVAL: usize = 256;
const MAX_CHECKPOINTS: usize = 8;
const MAX_CHECKPOINT_BYTES: usize = 8 * 1024 * 1024;

struct ReplayCheckpoint {
    position: usize,
    state: ReplayState,
    bytes: usize,
}

#[derive(PartialEq, Eq)]
enum Page {
    Path,
    Entries,
    Loading,
}

pub(crate) struct Recording {
    pub summary: Value,
    pub events: Vec<Value>,
    pub position: usize,
    pub playing: bool,
    seek_target: Option<usize>,
    last_tick: Instant,
}

/// Loader requests only consume the owned supervisor channel. Recorded events
/// are handed to a separate passive model and never enter this response path.
pub(crate) struct RecordingUi {
    pub outbox: VecDeque<Value>,
    pub revision: u64,
    pub active: Option<Recording>,
    pub live_model: Option<Box<AppModel>>,
    pub attach_requested: bool,
    pub detach_requested: bool,
    pub seek_requested: Option<usize>,
    available: bool,
    page: Page,
    draft: String,
    cursor: TextCursor,
    entries: Vec<Value>,
    directory_id: String,
    selected: usize,
    pending: Option<(String, String)>,
    summary: Option<Value>,
    loaded: Vec<Value>,
    loaded_bytes: usize,
    status: String,
    next_id: u64,
    checkpoints: VecDeque<ReplayCheckpoint>,
    checkpoint_bytes: usize,
    last_seek_reductions: usize,
    rendered_clicks: std::cell::RefCell<Vec<(usize, String)>>,
    rendered_revision: std::cell::Cell<Option<u64>>,
}

impl Default for RecordingUi {
    fn default() -> Self {
        Self {
            outbox: VecDeque::new(),
            revision: 0,
            active: None,
            live_model: None,
            attach_requested: false,
            detach_requested: false,
            seek_requested: None,
            available: false,
            page: Page::Path,
            draft: String::new(),
            cursor: TextCursor::default(),
            entries: vec![],
            directory_id: String::new(),
            selected: 0,
            pending: None,
            summary: None,
            loaded: vec![],
            loaded_bytes: 0,
            status: String::new(),
            next_id: 1,
            checkpoints: VecDeque::new(),
            checkpoint_bytes: 0,
            last_seek_reductions: 0,
            rendered_clicks: std::cell::RefCell::new(vec![]),
            rendered_revision: std::cell::Cell::new(None),
        }
    }
}

impl RecordingUi {
    pub fn open(&mut self, directory: &Path) {
        if self.draft.is_empty() {
            self.draft = directory.display().to_string();
        }
        if self.pending.is_none() {
            self.page = Page::Path;
        }
        self.revision += 1;
    }

    fn request(&mut self, method: &str, params: Value) {
        if !self.available || self.pending.is_some() {
            return;
        }
        let id = format!("native-recording-{}", self.next_id);
        self.next_id += 1;
        self.outbox
            .push_back(json!({"proto":"poc.tui@1","op":"recording:run",
            "jobId":id,"method":method,"params":params}));
        self.pending = Some((id, method.into()));
        self.status = format!("Waiting for {method}; Esc cancels the read");
        self.page = Page::Loading;
        self.revision += 1;
    }

    fn discard_cached(&mut self, recording_id: Value) {
        if self.available && recording_id.is_string() {
            self.outbox
                .push_back(json!({"proto":"poc.tui@1","op":"recording:run",
                "jobId":format!("native-recording-{}", self.next_id), "method":"discard",
                "params":{"recordingId":recording_id}}));
            self.next_id += 1;
        }
    }

    pub fn paste(&mut self, text: &str) {
        if !self.available || self.pending.is_some() || self.page != Page::Path {
            return;
        }
        if self.cursor.paste(&mut self.draft, text, 4096) {
            self.revision += 1;
        }
    }

    pub fn click(&mut self, row: usize) {
        if !self.available
            || self.pending.is_some()
            || self.page != Page::Entries
            || self.rendered_revision.get() != Some(self.revision)
        {
            return;
        }
        let id = self
            .rendered_clicks
            .borrow()
            .iter()
            .find(|(line, _)| *line == row)
            .map(|(_, id)| id.clone());
        if let Some(id) = id {
            if let Some(index) = self
                .entries
                .iter()
                .position(|entry| entry["id"].as_str() == Some(id.as_str()))
            {
                self.selected = index;
                self.revision += 1;
            }
        }
    }

    pub fn key(&mut self, key: KeyEvent) -> bool {
        if key.kind == crossterm::event::KeyEventKind::Release {
            return false;
        }
        self.revision += 1;
        if key.code == KeyCode::Esc {
            if let Some((job, _)) = self.pending.take() {
                self.outbox
                    .push_back(json!({"proto":"poc.tui@1","op":"job:cancel",
                    "jobId":job,"reason":"recording_read_cancelled"}));
                self.loaded.clear();
                self.loaded_bytes = 0;
                if let Some(summary) = self.summary.take() {
                    self.discard_cached(summary["recordingId"].clone());
                }
                self.page = Page::Path;
                self.status = "Recording read cancelled; live work continues".into();
                return false;
            }
            if self.page == Page::Entries {
                self.page = Page::Path;
                return false;
            }
            return true;
        }
        if self.pending.is_some() {
            return false;
        }
        if self.page == Page::Path
            && key.code != KeyCode::Enter
            && self.cursor.key(&mut self.draft, key, 4096)
        {
            return false;
        }
        match self.page {
            Page::Path => {
                if key.code == KeyCode::Enter {
                    let selected = self.draft.trim().to_owned();
                    let path = Path::new(&selected);
                    if !path.is_absolute() {
                        self.status = "Enter an absolute JSONL file or recording directory".into();
                    } else if path.extension().and_then(|x| x.to_str()) == Some("jsonl") {
                        if let (Some(parent), Some(filename)) = (path.parent(), path.file_name()) {
                            self.request("list", json!({"directory":parent.display().to_string(), "filename":filename.to_string_lossy()}));
                        }
                    } else {
                        self.request("list", json!({"directory":selected}));
                    }
                }
            }
            Page::Entries => match key.code {
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Down | KeyCode::Char('j') => {
                    self.selected = (self.selected + 1).min(self.entries.len().saturating_sub(1))
                }
                KeyCode::Enter => {
                    if let Some(entry) = self.entries.get(self.selected).cloned() {
                        if entry["valid"] == true {
                            self.request(
                                "load",
                                json!({"directoryId":self.directory_id,"entryId":entry["id"]}),
                            );
                        } else {
                            self.status = format!(
                                "Invalid recording metadata: {}",
                                entry["errorCode"].as_str().unwrap_or("unknown")
                            );
                        }
                    }
                }
                _ => {}
            },
            Page::Loading => {}
        }
        false
    }

    fn fail(&mut self, message: &str) {
        self.pending = None;
        if let Some(summary) = self.summary.take() {
            self.discard_cached(summary["recordingId"].clone());
        }
        self.loaded.clear();
        self.loaded_bytes = 0;
        self.page = Page::Path;
        self.status = message.into();
        self.revision += 1;
    }

    pub fn supervisor_event(&mut self, event: &Value, owned_channel: bool) {
        if event["event"] == "hello" {
            self.available = owned_channel
                && event["capabilities"]["supportsRecordings"] == true
                && event["session"]["mode"] == "supervised"
                && event["session"]["controllable"] == true;
            self.revision += 1;
        }
        let Some((id, method)) = self.pending.clone() else {
            return;
        };
        if !owned_channel || event["event"] != "job:end" || event["jobId"] != id {
            return;
        }
        self.pending = None;
        if event["status"] != "done" {
            self.fail(&format!(
                "Recording read failed: {}",
                event["error"]["code"].as_str().unwrap_or("unknown")
            ));
            return;
        }
        if event["result"]["method"] != method {
            self.fail("Recording result method mismatch");
            return;
        }
        let data = &event["result"]["data"];
        match method.as_str() {
            "list" => {
                let Some(entries) = data["entries"].as_array().filter(|x| x.len() <= 64) else {
                    self.fail("Invalid recording list");
                    return;
                };
                let Some(id) = data["directoryId"].as_str() else {
                    self.fail("Missing recording scope identity");
                    return;
                };
                self.entries = entries.clone();
                self.directory_id = id.into();
                self.selected = 0;
                self.page = Page::Entries;
                self.status = format!(
                    "{} recording(s); Enter loads selected file",
                    self.entries.len()
                );
            }
            "load" => {
                let count = data["eventCount"].as_u64().unwrap_or(0) as usize;
                let bytes = data["eventBytes"].as_u64().unwrap_or(u64::MAX);
                let valid_identity = data["identity"]
                    .as_str()
                    .is_some_and(|s| s.len() == 64 && s.bytes().all(|b| b.is_ascii_hexdigit()));
                if count == 0
                    || count > MAX_EVENTS
                    || bytes > MAX_BYTES as u64
                    || !valid_identity
                    || data["mode"] != "replay"
                    || data["controllable"] != false
                    || data["connection"] != "offline"
                {
                    self.fail("Invalid passive recording summary");
                    return;
                }
                self.summary = Some(data.clone());
                self.loaded.clear();
                self.loaded_bytes = 0;
                self.request(
                    "page",
                    json!({"recordingId":data["recordingId"],"offset":0,"count":128}),
                );
            }
            "page" => {
                let Some(summary) = self.summary.clone() else {
                    self.fail("Missing recording summary");
                    return;
                };
                let Some(events) = data["events"]
                    .as_array()
                    .filter(|x| x.len() <= 128 && !x.is_empty())
                else {
                    self.fail("Invalid event page");
                    return;
                };
                let total = summary["eventCount"].as_u64().unwrap_or(0) as usize;
                if data["recordingId"] != summary["recordingId"]
                    || data["identity"] != summary["identity"]
                    || data["runId"] != summary["runId"]
                    || data["total"].as_u64() != Some(total as u64)
                    || data["offset"].as_u64() != Some(self.loaded.len() as u64)
                    || self.loaded.len() + events.len() > total
                {
                    self.fail("Recording page identity or offset mismatch");
                    return;
                }
                for event in events {
                    if event["runId"] != summary["runId"] {
                        self.fail("Recorded event run identity mismatch");
                        return;
                    }
                    self.loaded_bytes += serde_json::to_vec(event)
                        .map(|b| b.len())
                        .unwrap_or(MAX_BYTES + 1);
                    if self.loaded_bytes > MAX_BYTES {
                        self.fail("Recording exceeds the cached event byte bound");
                        return;
                    }
                }
                self.loaded.extend(events.iter().cloned());
                if self.loaded.len() == total && data["nextOffset"].is_null() {
                    if let Some(previous) = self.active.take() {
                        self.discard_cached(previous.summary["recordingId"].clone());
                    }
                    self.active = Some(Recording {
                        summary,
                        events: std::mem::take(&mut self.loaded),
                        position: 0,
                        playing: false,
                        seek_target: None,
                        last_tick: Instant::now(),
                    });
                    self.checkpoints.clear();
                    self.checkpoint_bytes = 0;
                    self.attach_requested = true;
                    self.seek_requested = None;
                    self.page = Page::Path;
                    self.status = "Loaded passive recording".into();
                } else if data["nextOffset"].as_u64() == Some(self.loaded.len() as u64) {
                    self.request("page", json!({"recordingId":summary["recordingId"],"offset":self.loaded.len(),"count":128}));
                } else {
                    self.fail("Recording page ended before the declared event count");
                    return;
                }
            }
            _ => self.fail("Unknown recording response"),
        }
        self.revision += 1;
    }

    pub fn playback_key(&mut self, key: KeyEvent) -> bool {
        let Some(recording) = &mut self.active else {
            return false;
        };
        let requested = self
            .seek_requested
            .or(recording.seek_target)
            .unwrap_or(recording.position);
        let seek = match key.code {
            KeyCode::Left => Some(requested.saturating_sub(1)),
            KeyCode::Right => Some((requested + 1).min(recording.events.len())),
            KeyCode::PageUp => Some(requested.saturating_sub(64)),
            KeyCode::PageDown => Some((requested + 64).min(recording.events.len())),
            KeyCode::Home => Some(0),
            KeyCode::End => Some(recording.events.len()),
            KeyCode::Char(' ') => {
                recording.playing = !recording.playing;
                recording.last_tick = Instant::now();
                self.revision += 1;
                return true;
            }
            KeyCode::Esc => {
                self.detach_requested = true;
                self.revision += 1;
                return true;
            }
            _ => None,
        };
        if let Some(position) = seek {
            recording.playing = false;
            self.seek_requested = Some(position);
            self.revision += 1;
            return true;
        }
        false
    }

    pub fn tick(&mut self) {
        let Some(recording) = &mut self.active else {
            return;
        };
        if recording.playing
            && recording.seek_target.is_none()
            && self.seek_requested.is_none()
            && recording.last_tick.elapsed() >= Duration::from_millis(50)
        {
            recording.last_tick = Instant::now();
            if recording.position < recording.events.len() {
                self.seek_requested = Some(recording.position + 1);
            } else {
                recording.playing = false;
            }
            self.revision += 1;
        }
    }

    pub fn reconstruction_pending(&self) -> bool {
        self.seek_requested.is_some()
            || self
                .active
                .as_ref()
                .is_some_and(|recording| recording.seek_target.is_some())
    }

    pub fn detach(&mut self) {
        if let Some(recording) = self.active.take() {
            self.discard_cached(recording.summary["recordingId"].clone());
        }
        self.detach_requested = false;
        self.seek_requested = None;
        self.attach_requested = false;
        self.checkpoints.clear();
        self.checkpoint_bytes = 0;
        self.revision += 1;
    }

    #[cfg(test)]
    pub(crate) fn replay_limits() -> (usize, usize, usize, usize) {
        (
            MAX_EVENTS,
            SEEK_EVENTS_PER_TICK,
            MAX_CHECKPOINTS,
            MAX_CHECKPOINT_BYTES,
        )
    }

    #[cfg(test)]
    pub(crate) fn replay_work(&self) -> (usize, usize, usize, Option<usize>) {
        (
            self.last_seek_reductions,
            self.checkpoints.len(),
            self.checkpoint_bytes,
            self.active
                .as_ref()
                .and_then(|recording| recording.seek_target),
        )
    }

    pub fn update_view(&mut self, model: &mut AppModel) {
        self.last_seek_reductions = 0;
        if self.detach_requested {
            if let Some(live) = self.live_model.take() {
                *model = *live;
                model.input_queue.clear();
                model.last_render_signature.clear();
                model.dirty = true;
            }
            self.detach();
            return;
        }
        if self.attach_requested {
            let Some(recording) = &self.active else {
                return;
            };
            let mut passive = AppModel::new(
                recording.summary["runId"]
                    .as_str()
                    .unwrap_or("saved-session")
                    .into(),
                model.terminal_caps.clone(),
                None,
            );
            passive.session.scope = "recorded scope not reached".into();
            Self::force_passive(&mut passive, recording);
            let mut prior = std::mem::replace(model, passive);
            prior.input_queue.clear();
            if self.live_model.is_none() {
                self.live_model = Some(Box::new(prior));
            }
            self.attach_requested = false;
        }
        let Some(recording) = &mut self.active else {
            return;
        };
        if let Some(position) = self.seek_requested.take() {
            let position = position.min(recording.events.len());
            if position != recording.seek_target.unwrap_or(recording.position) {
                recording.seek_target = (position != recording.position).then_some(position);
                if position < recording.position {
                    if let Some(checkpoint) = self
                        .checkpoints
                        .iter()
                        .filter(|checkpoint| checkpoint.position <= position)
                        .max_by_key(|checkpoint| checkpoint.position)
                    {
                        checkpoint.state.restore(model);
                        recording.position = checkpoint.position;
                    } else {
                        let mut empty = AppModel::new(
                            recording.summary["runId"]
                                .as_str()
                                .unwrap_or("saved-session")
                                .into(),
                            model.terminal_caps.clone(),
                            None,
                        );
                        empty.session.scope = "recorded scope not reached".into();
                        ReplayState::capture(&empty).restore(model);
                        recording.position = 0;
                    }
                }
            }
        }
        let selected = model.selected_job.clone();
        let pinned = model.selected_job_pinned;
        let view_scroll = (model.job_scroll, model.task_scroll, model.log_scroll);
        if selected.is_some() {
            model.selected_job_pinned = true;
        }
        let started = Instant::now();
        while recording
            .seek_target
            .is_some_and(|target| recording.position < target)
            && self.last_seek_reductions < SEEK_EVENTS_PER_TICK
            && (self.last_seek_reductions == 0 || started.elapsed() < SEEK_TICK_BUDGET)
        {
            apply_protocol_event(model, recording.events[recording.position].clone(), 0);
            recording.position += 1;
            self.last_seek_reductions += 1;
            Self::force_passive(model, recording);
            if recording.position % CHECKPOINT_INTERVAL == 0
                && !self
                    .checkpoints
                    .iter()
                    .any(|checkpoint| checkpoint.position == recording.position)
            {
                let charge = ReplayState::retained_bytes(model);
                if charge <= MAX_CHECKPOINT_BYTES {
                    while self.checkpoints.len() >= MAX_CHECKPOINTS
                        || self.checkpoint_bytes + charge > MAX_CHECKPOINT_BYTES
                    {
                        if let Some(old) = self.checkpoints.pop_front() {
                            self.checkpoint_bytes -= old.bytes;
                        } else {
                            break;
                        }
                    }
                    self.checkpoints.push_back(ReplayCheckpoint {
                        position: recording.position,
                        state: ReplayState::capture(model),
                        bytes: charge,
                    });
                    self.checkpoint_bytes += charge;
                }
            }
        }
        if let Some(id) = selected {
            model.selected_job_expired = !model.job_status.contains_key(&id);
            model.selected_job = Some(id);
            model.selected_job_pinned = pinned;
        }
        // Historical reducer work is not a live arrival at a paused viewport.
        // Keep user scroll offsets across every bounded seek batch/checkpoint.
        (model.job_scroll, model.task_scroll, model.log_scroll) = view_scroll;
        if recording.seek_target == Some(recording.position) {
            recording.seek_target = None;
        }
        if self.last_seek_reductions > 0 {
            self.revision += 1;
            model.dirty = true;
        }
        Self::force_passive(model, recording);
    }

    fn force_passive(model: &mut AppModel, recording: &Recording) {
        model.owns_control_channel = false;
        model.session.mode = "replay".into();
        model.session.source = recording.summary["source"]
            .as_str()
            .unwrap_or("saved recording")
            .into();
        model.session.connection = "offline".into();
        model.session.controllable = false;
        let progress = recording
            .seek_target
            .map(|target| format!("seeking {} -> {}", recording.position, target));
        let note = format!(
            "Saved {} {}/{} | Space play/pause; arrows step; Home/End seek; Esc detach",
            progress.as_deref().unwrap_or(if recording.playing {
                "playing"
            } else {
                "paused"
            }),
            recording.position,
            recording.events.len()
        );
        if model.session.note != note {
            model.session.note = note;
            model.dirty = true;
        }
        model.index_workflows.available = false;
        model.settings.available = false;
        model.repository_search.available = false;
        model.job_inspection.available = false;
        model.index_workflows.outbox.clear();
        model.settings.outbox.clear();
        model.repository_search.outbox.clear();
        model.job_inspection.outbox.clear();
    }

    pub fn lines(&self, height: usize, width: usize) -> Vec<String> {
        let mut clicks = self.rendered_clicks.borrow_mut();
        clicks.clear();
        self.rendered_revision.set(Some(self.revision));
        let headers = vec![
            format!(
                "Saved sessions {}/{} | Esc back/cancel | Ctrl+C quit",
                if self.entries.is_empty() {
                    0
                } else {
                    self.selected + 1
                },
                self.entries.len()
            ),
            if self.available {
                "Enter absolute JSONL/directory | cursor/Home/End | Ctrl+U clear | paste is data"
                    .into()
            } else {
                "The owned supervisor has not advertised recording support".into()
            },
            format!(
                "Path: {}",
                self.cursor.visible(&self.draft, width.saturating_sub(6))
            ),
            self.status.clone(),
        ];
        if self.page == Page::Entries {
            let (header_count, start, count) =
                selected_window(headers.len(), self.entries.len(), self.selected, height);
            for (offset, entry) in self.entries.iter().skip(start).take(count).enumerate() {
                if let Some(id) = entry["id"].as_str() {
                    clicks.push((header_count + offset, id.to_owned()));
                }
            }
            let rows = self
                .entries
                .iter()
                .enumerate()
                .map(|(i, entry)| {
                    format!(
                        "{} {}{}",
                        if i == self.selected { ">" } else { " " },
                        entry["filename"].as_str().unwrap_or("?"),
                        if entry["valid"] == true {
                            ""
                        } else {
                            " [invalid]"
                        }
                    )
                })
                .collect();
            selected_rows(headers, rows, self.selected, height, width)
        } else {
            headers
                .into_iter()
                .take(height)
                .map(|line| crate::fit_text(&line, width))
                .collect()
        }
    }
}

#[cfg(test)]
mod picker_tests {
    use super::*;
    use crossterm::event::KeyModifiers;

    #[test]
    fn recording_path_reuses_grapheme_cursor_and_inert_bounded_paste() {
        let mut ui = RecordingUi {
            available: true,
            draft: "界e\u{301}😀".into(),
            ..RecordingUi::default()
        };
        ui.key(KeyEvent::new(KeyCode::Left, KeyModifiers::NONE));
        ui.key(KeyEvent::new(KeyCode::Backspace, KeyModifiers::NONE));
        assert_eq!(ui.draft, "界😀");
        ui.paste("\r\n\u{1b}q\u{3}");
        assert_eq!(ui.draft, "界  q😀");
        assert!(
            ui.outbox.is_empty(),
            "paste cannot request a file load, detach or shutdown"
        );
        assert!(ui.lines(8, 20).join("\n").contains('|'));
        let before = ui.draft.clone();
        ui.paste(&"x".repeat(4097));
        assert_eq!(ui.draft, before);
        ui.available = false;
        ui.paste("read-only");
        assert_eq!(ui.draft, before);
    }

    #[test]
    fn rendered_recording_click_only_selects_the_original_entry_without_loading() {
        let mut ui = RecordingUi {
            available: true,
            page: Page::Entries,
            entries: vec![
                json!({"id":"first","filename":"first.jsonl","valid":true}),
                json!({"id":"second","filename":"second.jsonl","valid":true}),
            ],
            ..RecordingUi::default()
        };
        let rows = ui.lines(12, 60);
        let row = rows
            .iter()
            .position(|line| line.contains("second.jsonl"))
            .unwrap();
        ui.click(row);
        assert_eq!(ui.selected, 1);
        assert!(ui.outbox.is_empty());
        ui.entries.reverse();
        ui.revision += 1;
        ui.click(row);
        assert_eq!(
            ui.selected, 1,
            "changed inventory cannot retarget a captured row"
        );
        assert!(
            ui.outbox.is_empty(),
            "only explicit Enter may load or attach a saved session"
        );
    }

    #[test]
    fn every_bounded_picker_entry_is_visible_at_its_exact_selected_row() {
        let mut ui = RecordingUi { available: true, page: Page::Entries,
            entries: (0..64).map(|index| json!({"id":index,"filename":format!("saved-{index:02}.jsonl"),"valid":true})).collect(),
            ..RecordingUi::default() };
        for (height, width) in [(12, 50), (6, 28), (3, 20)] {
            for selected in 0..64 {
                ui.selected = selected;
                let rows = ui.lines(height, width);
                assert!(rows.len() <= height);
                assert!(rows
                    .iter()
                    .any(|row| row.contains(&format!("> saved-{selected:02}.jsonl"))));
            }
        }
    }

    #[test]
    fn cancelling_page_load_discards_only_its_exact_retained_replay() {
        let id = "cda931bc-9b07-48a2-a2b8-80e53e828541";
        let mut ui = RecordingUi {
            available: true,
            page: Page::Loading,
            pending: Some(("owned-read".into(), "page".into())),
            summary: Some(json!({"recordingId":id})),
            ..RecordingUi::default()
        };
        ui.key(KeyEvent::new(KeyCode::Esc, KeyModifiers::NONE));
        let cancel = ui.outbox.pop_front().unwrap();
        assert_eq!(cancel["op"], "job:cancel");
        assert_eq!(cancel["jobId"], "owned-read");
        let discard = ui.outbox.pop_front().unwrap();
        assert_eq!(discard["method"], "discard");
        assert_eq!(discard["params"]["recordingId"], id);
        assert!(ui.outbox.is_empty());
        assert!(ui.pending.is_none() && ui.summary.is_none());
    }
}
