use crossterm::event::{KeyCode, KeyEvent};
use serde_json::{json, Value};
use std::collections::{HashMap, VecDeque};

const MAX_RECORDS: usize = 8;
const MAX_RESULT_BYTES: usize = 256 * 1024;
const MAX_ARTIFACT_BYTES: usize = 64 * 1024;
const MAX_ARTIFACTS: usize = 64;
const MAX_VIEW_LINES: usize = 8192;

fn text(value: &Value, max_bytes: usize) -> String {
    let mut output = String::new();
    for character in value.as_str().unwrap_or("").chars() {
        let character = if character.is_control() {
            '\u{fffd}'
        } else {
            character
        };
        if output.len() + character.len_utf8() > max_bytes {
            while output.len() + 3 > max_bytes && !output.is_empty() {
                output.pop();
            }
            if max_bytes >= 3 {
                output.push('…');
            }
            break;
        }
        output.push(character);
    }
    output
}

fn number(value: Option<u64>) -> String {
    value
        .map(|value| value.to_string())
        .unwrap_or_else(|| "unreported".into())
}

fn reported(value: &str) -> &str {
    if value.is_empty() {
        "unreported"
    } else {
        value
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Page {
    Summary,
    Result,
    Artifacts,
}

struct Artifact {
    id: String,
    actions: Vec<String>,
    label: String,
    kind: String,
    path: String,
    exists: Option<bool>,
    bytes: Option<u64>,
    modified: String,
}

impl Artifact {
    fn payload_bytes(&self) -> usize {
        self.label.len()
            + self.kind.len()
            + self.path.len()
            + self.modified.len()
            + self.id.len()
            + 96
    }
}

struct Record {
    generation: u64,
    title: String,
    status: String,
    cwd: String,
    started: String,
    pid: Option<u64>,
    attempts: Option<u64>,
    max_attempts: Option<u64>,
    retries: Option<u64>,
    exit_code: Option<i64>,
    signal: String,
    termination: String,
    cancel_reason: String,
    timed_out: Option<bool>,
    duration_ms: Option<u64>,
    total_duration_ms: Option<u64>,
    error_code: String,
    error_message: String,
    capture_kind: String,
    result_state: String,
    result_capture: String,
    result_body: Option<String>,
    result_notice: String,
    artifacts: Vec<Artifact>,
    artifact_notice: String,
    artifact_source: String,
    artifact_observed: String,
    inventory_id: String,
}

impl Record {
    fn new(generation: u64) -> Self {
        Self {
            generation,
            title: String::new(),
            status: "unreported".into(),
            cwd: String::new(),
            started: String::new(),
            pid: None,
            attempts: None,
            max_attempts: None,
            retries: None,
            exit_code: None,
            signal: String::new(),
            termination: String::new(),
            cancel_reason: String::new(),
            timed_out: None,
            duration_ms: None,
            total_duration_ms: None,
            error_code: String::new(),
            error_message: String::new(),
            capture_kind: String::new(),
            result_state: "pending".into(),
            result_capture: String::new(),
            result_body: None,
            result_notice: "Awaiting terminal capture state".into(),
            artifacts: Vec::new(),
            artifact_notice: "Awaiting artifact inventory".into(),
            artifact_source: String::new(),
            artifact_observed: String::new(),
            inventory_id: String::new(),
        }
    }

    fn end(&mut self, event: &Value) {
        self.status = text(&event["status"], 80);
        self.exit_code = event["exitCode"].as_i64();
        self.signal = text(&event["signal"], 80);
        self.termination = text(&event["terminationReason"], 128);
        self.cancel_reason = text(&event["cancelReason"], 256);
        self.timed_out = event["timedOut"].as_bool();
        self.duration_ms = event["durationMs"].as_u64();
        self.total_duration_ms = event["totalDurationMs"].as_u64();
        self.attempts = event["attempts"].as_u64();
        self.max_attempts = event["maxAttempts"].as_u64().or(self.max_attempts);
        self.retries = event["retries"].as_u64();
        self.error_code = text(&event["error"]["code"], 128);
        self.error_message = text(&event["error"]["message"], 4096);
        self.result_state = text(&event["resultState"], 80);
        if self.result_state.is_empty() {
            self.result_state = "unreported".into();
        }
        self.result_body = None;
        self.result_capture = serde_json::to_string(&event["resultCapture"]).unwrap_or_default();
        if self.result_capture.len() > 4096 {
            self.result_capture = "Capture metadata exceeds the native retention limit".into();
        }
        let conflicting = event["resultCapture"]["truncated"] == true
            || (self.capture_kind == "json" && event["resultCapture"]["encodingLoss"] == true);
        let complete = self.result_state == "complete";
        let partial_text = self.result_state == "truncated" && self.capture_kind == "text";
        if complete && conflicting {
            self.result_notice = "Conflicting capture metadata; payload was not admitted".into();
            return;
        }
        if !complete && !partial_text {
            self.result_notice = format!(
                "No complete payload admitted (capture {})",
                self.result_state
            );
            return;
        }
        let body = if self.capture_kind == "text" {
            event["result"].as_str().map(|value| {
                value
                    .chars()
                    .map(|character| {
                        if character.is_control() && character != '\n' {
                            '\u{fffd}'
                        } else {
                            character
                        }
                    })
                    .collect::<String>()
            })
        } else {
            serde_json::to_string_pretty(&event["result"]).ok()
        };
        match body {
            Some(body) if body.len() <= MAX_RESULT_BYTES => {
                self.result_body = Some(body);
                self.result_notice = if partial_text { "Captured text prefix only; source capture is truncated" }
                    else { "Complete captured payload retained" }.into();
            }
            Some(_) => self.result_notice = format!("Payload omitted: native retention limit is {MAX_RESULT_BYTES} bytes; reported capture state is unchanged"),
            None => self.result_notice = "Payload unavailable for the reported capture format".into(),
        }
    }

    fn inventory(&mut self, event: &Value) {
        self.artifacts.clear();
        self.inventory_id = text(&event["inventoryId"], 36);
        self.artifact_source = text(&event["source"], 128);
        self.artifact_observed = text(&event["ts"], 128);
        let Some(rows) = event["artifacts"].as_array() else {
            self.artifact_notice = "Artifact inventory unavailable: invalid or absent rows".into();
            return;
        };
        if event["artifactsIndexed"] == false {
            self.artifact_notice =
                "Artifact inventory unavailable: producer reported indexing failure".into();
            return;
        }
        let mut bytes = 0;
        for row in rows {
            if self.artifacts.len() == MAX_ARTIFACTS {
                break;
            }
            if row["path"].as_str().is_none() {
                continue;
            }
            let artifact = Artifact {
                id: text(&row["artifactId"], 36),
                actions: if row["snapshotVerified"] == true {
                    ["open", "copy", "export"]
                        .iter()
                        .filter(|action| {
                            row["actions"]
                                .as_array()
                                .map(|values| values.iter().any(|value| value == **action))
                                .unwrap_or(false)
                        })
                        .map(|action| action.to_string())
                        .collect()
                } else {
                    Vec::new()
                },
                label: text(&row["label"], 256),
                kind: text(&row["kind"], 128),
                path: text(&row["path"], 4096),
                exists: row["exists"].as_bool(),
                bytes: row["bytes"].as_u64(),
                modified: text(&row["mtime"], 128),
            };
            if bytes + artifact.payload_bytes() > MAX_ARTIFACT_BYTES {
                break;
            }
            bytes += artifact.payload_bytes();
            self.artifacts.push(artifact);
        }
        self.artifact_notice = format!(
            "{} of {} recorded artifacts; current disk availability is unverified{}",
            self.artifacts.len(),
            rows.len(),
            if event["artifactsIndexed"] == true {
                ""
            } else {
                " (legacy inventory)"
            }
        );
    }

    fn summary(&self) -> Vec<String> {
        vec![
            format!(
                "Process status: {} | exit {} | signal {}",
                reported(&self.status),
                self.exit_code
                    .map(|code| code.to_string())
                    .unwrap_or_else(|| "unreported".into()),
                reported(&self.signal)
            ),
            format!(
                "Termination: {} | timed out {} | cancel reason {}",
                reported(&self.termination),
                self.timed_out
                    .map(|value| value.to_string())
                    .unwrap_or_else(|| "unreported".into()),
                reported(&self.cancel_reason)
            ),
            format!(
                "Attempts: {} / configured {} | retries {}",
                number(self.attempts),
                number(self.max_attempts),
                number(self.retries)
            ),
            format!(
                "Last recorded PID: {} | reported duration ms {} | total ms {} | started {}",
                number(self.pid),
                number(self.duration_ms),
                number(self.total_duration_ms),
                reported(&self.started)
            ),
            format!("Working directory: {}", reported(&self.cwd)),
            format!(
                "Capture: {} ({})",
                self.result_state,
                reported(&self.capture_kind)
            ),
            self.result_notice.clone(),
            format!("Capture metadata: {}", self.result_capture),
            format!(
                "Error: {} | {}",
                reported(&self.error_code),
                reported(&self.error_message)
            ),
            self.artifact_notice.clone(),
            format!(
                "Inventory provenance: {} | observed {}",
                reported(&self.artifact_source),
                reported(&self.artifact_observed)
            ),
        ]
    }
}

pub struct InspectionUi {
    pub revision: u64,
    pub available: bool,
    pub outbox: VecDeque<Value>,
    records: HashMap<String, Record>,
    order: VecDeque<String>,
    next_generation: u64,
    current: Option<(String, u64)>,
    page: Page,
    scroll: usize,
    column: usize,
    selected_artifact: usize,
    prompt: Option<(String, Value, String)>,
    pending: Option<(String, String)>,
    cancel_requested: bool,
    next_id: u64,
    action_status: String,
}

impl Default for InspectionUi {
    fn default() -> Self {
        Self {
            revision: 0,
            available: false,
            outbox: VecDeque::new(),
            records: HashMap::new(),
            order: VecDeque::new(),
            next_generation: 0,
            current: None,
            page: Page::Summary,
            scroll: 0,
            column: 0,
            selected_artifact: 0,
            prompt: None,
            pending: None,
            cancel_requested: false,
            next_id: 0,
            action_status: "Actions reverify the recorded object before use".into(),
        }
    }
}

impl InspectionUi {
    pub fn record(&mut self, event: &Value) {
        if event["internal"] == true {
            return;
        }
        let Some(id) = event["jobId"]
            .as_str()
            .filter(|id| !id.is_empty() && id.len() <= 128)
        else {
            return;
        };
        let name = event["event"].as_str().unwrap_or("");
        if !["job:start", "job:spawn", "job:end", "job:artifacts"].contains(&name) {
            return;
        }
        if name == "job:start" || !self.records.contains_key(id) {
            self.order.retain(|key| key != id);
            while self.records.len() >= MAX_RECORDS && !self.records.contains_key(id) {
                let index = self
                    .order
                    .iter()
                    .position(|key| {
                        self.current
                            .as_ref()
                            .map(|(id, _)| id != key)
                            .unwrap_or(true)
                    })
                    .unwrap_or(0);
                if let Some(old) = self.order.remove(index) {
                    self.records.remove(&old);
                } else {
                    break;
                }
            }
            self.next_generation += 1;
            self.records
                .insert(id.to_owned(), Record::new(self.next_generation));
            self.order.push_back(id.to_owned());
        }
        let record = self.records.get_mut(id).unwrap();
        match name {
            "job:start" => {
                record.title = text(&event["title"], 256);
                record.status = "accepted".into();
                record.cwd = text(&event["cwd"], 4096);
                record.started = text(&event["ts"], 128);
                record.capture_kind =
                    text(&event["requested"]["resultPolicy"]["captureStdout"], 32);
                record.max_attempts = event["requested"]["retry"]["maxAttempts"].as_u64();
            }
            "job:spawn" => {
                record.pid = event["pid"].as_u64();
                record.status = "running".into();
            }
            "job:end" => record.end(event),
            "job:artifacts" => record.inventory(event),
            _ => {}
        }
        self.revision += 1;
    }

    pub fn open(&mut self, id: &str) {
        self.prompt = None;
        let generation = self
            .records
            .get(id)
            .map(|record| record.generation)
            .unwrap_or(0);
        self.current = Some((id.to_owned(), generation));
        self.page = Page::Summary;
        self.scroll = 0;
        self.column = 0;
        self.selected_artifact = 0;
        self.revision += 1;
    }

    fn current_record(&self) -> Option<&Record> {
        let (id, generation) = self.current.as_ref()?;
        self.records
            .get(id)
            .filter(|record| record.generation == *generation)
    }

    fn selection(&self, method: &str) -> Option<Value> {
        if !self.available {
            return None;
        }
        let record = self.current_record()?;
        let artifact = record.artifacts.get(self.selected_artifact)?;
        if record.inventory_id.len() != 36
            || artifact.id.len() != 36
            || !artifact.actions.iter().any(|action| action == method)
        {
            return None;
        }
        Some(json!({"sourceJobId":self.current.as_ref()?.0,
            "inventoryId":record.inventory_id,"artifactId":artifact.id}))
    }

    fn request(&mut self, method: String, params: Value) {
        self.next_id += 1;
        let id = format!("native-artifact-{}", self.next_id);
        self.outbox
            .push_back(json!({"proto":"poc.tui@1","op":"artifact:run",
            "jobId":id,"method":method,"params":params}));
        self.action_status = format!("Artifact {method} running; Esc cancels this action");
        self.pending = Some((id, method));
        self.cancel_requested = false;
    }

    pub fn event(&mut self, event: &Value) -> bool {
        let Some((id, method)) = self.pending.as_ref() else {
            return false;
        };
        if event["jobId"].as_str() != Some(id) {
            return false;
        }
        if event["event"] == "job:end" {
            self.action_status =
                if event["status"] == "done" && event["result"]["method"] == *method {
                    format!("Artifact {method} complete")
                } else {
                    format!(
                        "Artifact {method} {}: {}",
                        text(&event["status"], 24),
                        text(&event["error"]["code"], 80)
                    )
                };
            self.pending = None;
            self.revision += 1;
        }
        true
    }

    pub fn key(&mut self, key: KeyEvent) -> bool {
        self.revision += 1;
        if let Some((id, _)) = self.pending.as_ref() {
            if key.code == KeyCode::Esc && !self.cancel_requested {
                self.outbox
                    .push_back(json!({"proto":"poc.tui@1","op":"job:cancel",
                    "jobId":id,"reason":"user_cancel"}));
                self.cancel_requested = true;
            }
            return false;
        }
        if let Some((method, mut selection, mut destination)) = self.prompt.take() {
            if key.code == KeyCode::Esc {
                self.action_status = "Artifact action cancelled before execution".into();
                return false;
            }
            if key.code == KeyCode::Enter {
                if self.selection(&method).as_ref() != Some(&selection) {
                    self.action_status = "Artifact selection changed; select it again".into();
                } else if method == "export" && destination.is_empty() {
                    self.prompt = Some((method, selection, destination));
                } else {
                    selection["confirmed"] = json!(true);
                    if method == "export" {
                        selection["destination"] = json!(destination);
                    }
                    self.request(method, selection);
                }
            } else {
                if method == "export" {
                    match key.code {
                        KeyCode::Backspace => {
                            destination.pop();
                        }
                        KeyCode::Char(character)
                            if !character.is_control()
                                && destination.len() + character.len_utf8() <= 4096 =>
                        {
                            destination.push(character)
                        }
                        _ => {}
                    }
                }
                self.prompt = Some((method, selection, destination));
            }
            return false;
        }
        if key.code == KeyCode::Esc {
            return true;
        }
        let previous = self.page;
        match key.code {
            KeyCode::Char(character @ ('o' | 'y' | 'e')) if self.page == Page::Artifacts => {
                let method = match character {
                    'o' => "open",
                    'y' => "copy",
                    _ => "export",
                };
                if let Some(selection) = self.selection(method) {
                    if method == "copy" {
                        self.request(method.into(), selection);
                    } else {
                        self.prompt = Some((method.into(), selection, String::new()));
                    }
                } else {
                    self.action_status = "Action unavailable: no live verified selection or unsupported artifact type".into();
                }
            }
            KeyCode::Tab => {
                self.page = match self.page {
                    Page::Summary => Page::Result,
                    Page::Result => Page::Artifacts,
                    Page::Artifacts => Page::Summary,
                }
            }
            KeyCode::BackTab => {
                self.page = match self.page {
                    Page::Summary => Page::Artifacts,
                    Page::Result => Page::Summary,
                    Page::Artifacts => Page::Result,
                }
            }
            KeyCode::Char('1') => self.page = Page::Summary,
            KeyCode::Char('2') => self.page = Page::Result,
            KeyCode::Char('3') => self.page = Page::Artifacts,
            KeyCode::Up | KeyCode::Char('k') => {
                if self.page == Page::Artifacts {
                    self.selected_artifact = self.selected_artifact.saturating_sub(1);
                } else {
                    self.scroll = self.scroll.saturating_sub(1);
                }
            }
            KeyCode::Down | KeyCode::Char('j') => {
                if self.page == Page::Artifacts {
                    let count = self
                        .current_record()
                        .map(|record| record.artifacts.len())
                        .unwrap_or(0);
                    self.selected_artifact = self
                        .selected_artifact
                        .saturating_add(1)
                        .min(count.saturating_sub(1));
                } else {
                    self.scroll = self.scroll.saturating_add(1).min(MAX_VIEW_LINES);
                }
            }
            KeyCode::PageUp => {
                if self.page == Page::Artifacts {
                    self.selected_artifact = self.selected_artifact.saturating_sub(10);
                } else {
                    self.scroll = self.scroll.saturating_sub(20);
                }
            }
            KeyCode::PageDown => {
                if self.page == Page::Artifacts {
                    let count = self
                        .current_record()
                        .map(|record| record.artifacts.len())
                        .unwrap_or(0);
                    self.selected_artifact = self
                        .selected_artifact
                        .saturating_add(10)
                        .min(count.saturating_sub(1));
                } else {
                    self.scroll = self.scroll.saturating_add(20).min(MAX_VIEW_LINES);
                }
            }
            KeyCode::Left => self.column = self.column.saturating_sub(8),
            KeyCode::Right => self.column = self.column.saturating_add(8).min(MAX_RESULT_BYTES),
            KeyCode::Home => {
                self.scroll = 0;
                self.column = 0;
                self.selected_artifact = 0;
            }
            _ => {}
        }
        if self.page != previous {
            self.scroll = 0;
            self.column = 0;
        }
        false
    }

    pub fn lines(&self, width: usize, height: usize) -> Vec<String> {
        let fit = |output: Vec<String>| {
            output
                .into_iter()
                .take(height)
                .map(|line| super::fit_text(&line, width))
                .collect::<Vec<_>>()
        };
        let id = self
            .current
            .as_ref()
            .map(|(id, _)| id.as_str())
            .unwrap_or("none");
        let mut output = vec![
            format!("Job {id}"),
            "1 Summary | 2 Result | 3 Artifacts | Tab switches | Esc closes".into(),
        ];
        output.push(if let Some((method, _, destination)) = &self.prompt {
            if method == "export" { format!("Export new file within the selected repository: {destination} | Enter exports; Esc cancels") }
            else { "Open the verified artifact in VS Code? Enter confirms; Esc cancels".into() }
        } else { self.action_status.clone() });
        let Some(record) = self.current_record() else {
            output.push(
                "Record unavailable or superseded in bounded history; reselect the current job"
                    .into(),
            );
            return fit(output);
        };
        output[0] = format!("Job {id} | {}", record.title);
        let available = height.saturating_sub(4);
        if available == 0 {
            return fit(output);
        }
        let body = match self.page {
            Page::Summary => record.summary(),
            Page::Result => {
                let mut lines = vec![format!(
                    "Capture: {} | {}",
                    record.result_state, record.result_notice
                )];
                if let Some(body) = &record.result_body {
                    lines.extend(body.lines().take(MAX_VIEW_LINES + 1).map(str::to_owned));
                }
                if lines.len() > MAX_VIEW_LINES {
                    lines.truncate(MAX_VIEW_LINES);
                    lines.push(
                        "Native line limit reached; payload capture state is unchanged".into(),
                    );
                }
                lines
            }
            Page::Artifacts => {
                output.push(record.artifact_notice.clone());
                let count = available.saturating_sub(1).div_euclid(3).max(1);
                let start = self.selected_artifact.saturating_sub(count - 1);
                let mut lines = Vec::new();
                for (index, artifact) in record.artifacts.iter().enumerate().skip(start).take(count)
                {
                    lines.push(format!(
                        "{} {} [{}]",
                        if index == self.selected_artifact {
                            ">"
                        } else {
                            " "
                        },
                        artifact.label,
                        artifact.kind
                    ));
                    lines.push(artifact.path.clone());
                    lines.push(format!(
                        "Recorded exists={} | bytes {} | modified {}",
                        artifact
                            .exists
                            .map(|value| value.to_string())
                            .unwrap_or_else(|| "unreported".into()),
                        number(artifact.bytes),
                        reported(&artifact.modified)
                    ));
                }
                if lines.is_empty() {
                    lines.push("No recorded artifact rows; existence is not inferred".into());
                }
                lines
            }
        };
        let pan = |line: &str| {
            ratatui::text::Span::raw(line)
                .styled_graphemes(ratatui::style::Style::default())
                .skip(self.column)
                .map(|grapheme| grapheme.symbol)
                .collect::<String>()
        };
        if self.page == Page::Artifacts {
            output.extend(
                body.iter()
                    .take(available.saturating_sub(1))
                    .map(|line| pan(line)),
            );
        } else {
            let start = self.scroll.min(body.len().saturating_sub(available));
            output.extend(
                body.iter()
                    .skip(start)
                    .take(available)
                    .map(|line| pan(line)),
            );
        }
        output.push("Arrows/j/k select | Left/Right pan | o Open | y Copy path | e Export file | actions reverify current disk identity".into());
        fit(output)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn actionable(ui: &mut InspectionUi) {
        start(ui, "selected", "text");
        ui.record(
            &json!({"event":"job:artifacts","jobId":"selected","artifactsIndexed":true,
            "inventoryId":"11111111-1111-1111-1111-111111111111","artifacts":[{
                "path":"/selected/report","artifactId":"22222222-2222-2222-2222-222222222222",
                "snapshotVerified":true,"actions":["open","copy","export"]}]}),
        );
        ui.open("selected");
        ui.page = Page::Artifacts;
    }

    #[test]
    fn artifact_actions_require_live_authority_and_confirm_the_exact_selection() {
        let mut ui = InspectionUi::default();
        actionable(&mut ui);
        ui.key(KeyCode::Char('y').into());
        assert!(
            ui.outbox.is_empty(),
            "passive inspection cannot dispatch disk actions"
        );
        ui.available = true;
        ui.key(KeyCode::Char('o').into());
        assert!(ui.outbox.is_empty(), "editor launch waits for confirmation");
        start(&mut ui, "unrelated", "text");
        ui.key(KeyCode::Enter.into());
        let request = ui.outbox.pop_front().unwrap();
        assert_eq!(request["params"]["sourceJobId"], "selected");
        assert_eq!(request["params"]["confirmed"], true);
        let id = request["jobId"].clone();
        ui.key(KeyCode::Esc.into());
        ui.key(KeyCode::Esc.into());
        assert_eq!(
            ui.outbox.len(),
            1,
            "cancellation is bounded and targets only this operation"
        );
        assert_eq!(ui.outbox[0]["jobId"], id);
        assert!(ui.event(
            &json!({"event":"job:end","jobId":id,"status":"cancelled","error":{"code":"ABORT_ERR"}})
        ));
        assert_eq!(ui.current.as_ref().unwrap().0, "selected");
        assert!(ui.action_status.contains("cancelled"));
    }

    #[test]
    fn changed_inventory_or_reused_job_cannot_retarget_a_confirmation() {
        let mut ui = InspectionUi::default();
        actionable(&mut ui);
        ui.available = true;
        ui.key(KeyCode::Char('e').into());
        ui.key(KeyCode::Char('x').into());
        ui.record(
            &json!({"event":"job:artifacts","jobId":"selected","artifactsIndexed":true,
            "inventoryId":"33333333-3333-3333-3333-333333333333","artifacts":[]}),
        );
        ui.key(KeyCode::Enter.into());
        assert!(ui.outbox.is_empty());
        assert!(ui.action_status.contains("selection changed"));
        actionable(&mut ui);
        ui.key(KeyCode::Char('o').into());
        start(&mut ui, "selected", "text");
        ui.key(KeyCode::Enter.into());
        assert!(ui.outbox.is_empty());
        assert!(
            ui.current_record().is_none(),
            "same spelling does not replace the pinned job instance"
        );
    }

    fn start(ui: &mut InspectionUi, id: &str, kind: &str) {
        ui.record(
            &json!({"event":"job:start", "jobId":id, "title":"Real command result",
            "cwd":"/selected/repository", "ts":"2026-10-21T00:00:00Z",
            "requested":{"resultPolicy":{"captureStdout":kind},"retry":{"maxAttempts":2}}}),
        );
    }

    fn end(ui: &mut InspectionUi, id: &str, state: &str, result: Value) {
        ui.record(&json!({"event":"job:end", "jobId":id, "status":"done", "exitCode":0,
            "attempts":2,"maxAttempts":2,"retries":1,"terminationReason":"exit","timedOut":false,
            "resultState":state,"result":result,"resultCapture":{"truncated":false,"observedBytes":32}}));
    }

    #[test]
    fn complete_result_and_process_outcome_remain_distinct() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        ui.record(&json!({"event":"job:spawn","jobId":"one","pid":1234}));
        end(
            &mut ui,
            "one",
            "complete",
            json!({"answer":42,"coverage":{"complete":false}}),
        );
        ui.open("one");
        let summary = ui.lines(220, 30).join("\n");
        assert!(summary.contains("Process status: done | exit 0"));
        assert!(summary.contains("Attempts: 2 / configured 2 | retries 1"));
        assert!(summary.contains("Last recorded PID: 1234"));
        ui.key(KeyEvent::from(KeyCode::Char('2')));
        let body = ui.lines(220, 30).join("\n");
        assert!(body.contains("\"answer\": 42"));
        assert!(
            body.contains("\"complete\": false"),
            "coverage uncertainty is content, not process success"
        );
    }

    #[test]
    fn noncomplete_json_is_never_admitted_as_a_result() {
        for state in ["disabled", "truncated", "invalid-json", "incomplete", ""] {
            let mut ui = InspectionUi::default();
            start(&mut ui, "one", "json");
            end(&mut ui, "one", state, json!({"forged":"MUST_NOT_DISPLAY"}));
            ui.open("one");
            ui.page = Page::Result;
            let body = ui.lines(220, 30).join("\n");
            assert!(!body.contains("MUST_NOT_DISPLAY"));
            assert!(body.contains(if state.is_empty() {
                "unreported"
            } else {
                state
            }));
            assert!(ui.current_record().unwrap().result_body.is_none());
            assert_eq!(
                ui.current_record().unwrap().status,
                "done",
                "retain the reported process result"
            );
        }
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        ui.record(
            &json!({"event":"job:end","jobId":"one","status":"done","resultState":"complete",
            "result":{"forged":"MUST_NOT_DISPLAY"}, "resultCapture":{"truncated":true}}),
        );
        assert!(ui.records["one"].result_body.is_none());
        assert!(ui.records["one"].result_notice.contains("Conflicting"));
    }

    #[test]
    fn partial_text_is_labelled_and_terminal_controls_are_escaped() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "text");
        end(
            &mut ui,
            "one",
            "truncated",
            json!("retained prefix\n\u{1b}[31mred\u{7}"),
        );
        ui.open("one");
        ui.page = Page::Result;
        let body = ui.lines(220, 30).join("\n");
        assert!(body.contains("text prefix only"));
        assert!(body.contains("retained prefix"));
        assert!(!body.contains('\u{1b}') && !body.contains('\u{7}'));
        assert!(body.contains('\u{fffd}'));
    }

    #[test]
    fn oversized_payload_is_omitted_without_relabelling_capture() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        end(
            &mut ui,
            "one",
            "complete",
            json!({"value":"x".repeat(300 * 1024)}),
        );
        let record = &ui.records["one"];
        assert_eq!(record.result_state, "complete");
        assert!(record.result_body.is_none());
        assert!(record.result_notice.contains("262144 bytes"));
    }

    #[test]
    fn artifact_rows_preserve_provenance_missing_state_and_bounds() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        let rows: Vec<_> = (0..70)
            .map(|index| {
                json!({"label":format!("artifact-{index:03}"),
            "kind":"report", "path":format!("/observed/界🙂/{index:03}.json"),
            "exists":index % 2 == 0, "bytes":64,"mtime":"2026-10-21T00:00:00Z"})
            })
            .collect();
        ui.record(&json!({"event":"job:artifacts", "jobId":"one", "source":"supervisor", "artifactsIndexed":true,
            "ts":"2026-10-21T00:00:01Z", "artifacts":rows}));
        assert_eq!(ui.records["one"].artifacts.len(), 64);
        assert!(ui.records["one"].artifact_notice.contains("64 of 70"));
        assert!(ui.records["one"].artifact_notice.contains("unverified"));
        assert_eq!(ui.records["one"].artifacts[1].exists, Some(false));
        ui.open("one");
        ui.page = Page::Artifacts;
        for _ in 0..100 {
            ui.key(KeyEvent::from(KeyCode::Down));
        }
        assert_eq!(ui.selected_artifact, 63);
        let frame = ui.lines(220, 18).join("\n");
        assert!(frame.contains("> artifact-063"));
        assert!(frame.contains("exists=false"));
        assert!(!frame.contains("artifact-064"));
        ui.record(
            &json!({"event":"job:artifacts", "jobId":"one", "source":"supervisor",
            "artifactsIndexed":false,"artifacts":[]}),
        );
        assert!(ui.records["one"].artifacts.is_empty());
        assert!(ui.records["one"].artifact_notice.contains("unavailable"));
    }

    #[test]
    fn bounded_history_keeps_the_open_record_without_accumulating_payloads() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "foreground", "json");
        end(
            &mut ui,
            "foreground",
            "complete",
            json!({"marker":"FOREGROUND_KEEP"}),
        );
        ui.open("foreground");
        for index in 0..100 {
            let id = format!("background-{index}");
            start(&mut ui, &id, "json");
            end(
                &mut ui,
                &id,
                "complete",
                json!({"value":"x".repeat(128 * 1024)}),
            );
        }
        assert_eq!(ui.records.len(), 8);
        assert_eq!(ui.order.len(), 8);
        assert!(ui
            .current_record()
            .unwrap()
            .result_body
            .as_ref()
            .unwrap()
            .contains("FOREGROUND_KEEP"));
        let bytes: usize = ui
            .records
            .values()
            .map(|record| record.result_body.as_ref().map(String::len).unwrap_or(0))
            .sum();
        assert!(bytes <= 2 * 1024 * 1024);
        ui.open("background-0");
        assert!(ui.lines(220, 30).join("\n").contains("unavailable"));
    }

    #[test]
    fn replacement_requires_explicit_reopening_and_internal_data_is_ignored() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        end(&mut ui, "one", "complete", json!({"old":"OLD_RESULT"}));
        ui.open("one");
        start(&mut ui, "one", "json");
        end(&mut ui, "one", "complete", json!({"new":"NEW_RESULT"}));
        assert!(ui.current_record().is_none());
        let unavailable = ui.lines(220, 30).join("\n");
        assert!(unavailable.contains("superseded"));
        assert!(!unavailable.contains("OLD_RESULT") && !unavailable.contains("NEW_RESULT"));
        ui.open("one");
        ui.page = Page::Result;
        assert!(ui.lines(220, 30).join("\n").contains("NEW_RESULT"));
        let count = ui.records.len();
        ui.record(
            &json!({"event":"job:end","jobId":"settings-private","internal":true,
            "resultState":"complete","result":{"private":"DO_NOT_RETAIN"}}),
        );
        assert_eq!(ui.records.len(), count);
        assert!(!ui.records.contains_key("settings-private"));
    }

    #[test]
    fn dimensions_unicode_and_overscroll_stay_bounded() {
        let mut ui = InspectionUi::default();
        start(&mut ui, "one", "json");
        end(
            &mut ui,
            "one",
            "complete",
            json!({"界🙂":"e\u{301}界🙂".repeat(200)}),
        );
        ui.open("one");
        for page in [Page::Summary, Page::Result, Page::Artifacts] {
            ui.page = page;
            ui.scroll = usize::MAX;
            ui.column = usize::MAX;
            for width in [0, 1, 10, 60, 100] {
                for height in 0..8 {
                    let lines = ui.lines(width, height);
                    assert!(lines.len() <= height);
                    assert!(lines
                        .iter()
                        .all(|line| ratatui::text::Span::raw(line).width() <= width));
                }
            }
            ui.key(KeyEvent::from(KeyCode::Home));
            assert_eq!(ui.scroll, 0);
            assert_eq!(ui.column, 0);
        }
        assert!(ui.key(KeyEvent::from(KeyCode::Esc)));
    }
}
