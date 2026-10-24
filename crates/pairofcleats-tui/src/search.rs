use std::collections::{HashSet, VecDeque};

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{style::Style, text::Span};
use serde_json::{json, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Composer,
    Results,
    Diagnostics,
    Source,
    OpenConfirm,
}

#[derive(Clone)]
enum ClickTarget {
    Field(usize),
    Result(String),
}

/// Volatile query/source data stays outside layout snapshots and telemetry.
pub(crate) struct SearchUi {
    pub available: bool,
    pub revision: u64,
    pub outbox: VecDeque<Value>,
    page: Page,
    fields: Vec<String>,
    field: usize,
    cursor: crate::text_editor::TextCursor,
    rendered_clicks: std::cell::RefCell<Vec<(usize, ClickTarget)>>,
    rendered_revision: std::cell::Cell<Option<u64>>,
    schema: Option<Value>,
    modes: Vec<String>,
    rows: Vec<Value>,
    selected: usize,
    result: Option<Value>,
    source: Option<Value>,
    source_hit: Option<String>,
    source_scroll: usize,
    source_column: usize,
    diagnostics_scroll: usize,
    diagnostics_column: usize,
    pending: Option<(String, String)>,
    next_id: u64,
    status: String,
}

impl Default for SearchUi {
    fn default() -> Self {
        Self {
            available: false,
            revision: 0,
            outbox: VecDeque::new(),
            page: Page::Composer,
            fields: vec![
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                String::new(),
                "{}".into(),
            ],
            field: 1,
            cursor: crate::text_editor::TextCursor::default(),
            rendered_clicks: std::cell::RefCell::new(vec![]),
            rendered_revision: std::cell::Cell::new(None),
            schema: None,
            modes: Vec::new(),
            rows: Vec::new(),
            selected: 0,
            result: None,
            source: None,
            source_hit: None,
            source_scroll: 0,
            source_column: 0,
            diagnostics_scroll: 0,
            diagnostics_column: 0,
            pending: None,
            next_id: 1,
            status: String::new(),
        }
    }
}

const LABELS: [&str; 8] = [
    "Repository",
    "Query",
    "Mode",
    "Backend",
    "Top per mode",
    "Snapshot",
    "As of",
    "Shared filters (JSON)",
];

impl SearchUi {
    pub fn open(&mut self, initial_scope: &str) {
        if self.fields[0].is_empty() {
            self.fields[0] = initial_scope.into();
        }
        if self.schema.is_none() && self.available && self.pending.is_none() {
            self.request("describe", json!({}));
        }
        self.revision += 1;
    }

    pub fn scope_changed(&mut self, scope: &str) {
        self.cancel_pending();
        self.fields[0] = scope.into();
        self.rows.clear();
        self.result = None;
        self.source = None;
        self.source_hit = None;
        self.page = Page::Composer;
        self.status = "Scope changed; submit a new query".into();
        self.revision += 1;
    }

    fn cancel_pending(&mut self) {
        if let Some((id, _)) = self.pending.take() {
            self.outbox
                .push_back(json!({"proto":"poc.tui@1", "op":"job:cancel",
                "jobId":id, "reason":"native_search_cancelled"}));
            self.status = "Cancellation requested".into();
        }
    }

    fn results_status(&self) -> String {
        let mut status = format!(
            "{} indexed hits; query generation {}",
            self.rows.len(),
            self.result
                .as_ref()
                .map(|result| &result["queryGeneration"])
                .unwrap_or(&Value::Null)
        );
        if self
            .result
            .as_ref()
            .and_then(|result| result["outputBudget"]["omittedHits"].as_u64())
            .unwrap_or(0)
            > 0
        {
            status.push_str("; output budget omitted hits");
        }
        if self
            .result
            .as_ref()
            .and_then(|result| result["searchDiagnostics"]["backend"]["fidelity"].as_str())
            == Some("fallback-derived")
        {
            status.push_str("; fallback results (d for diagnostics)");
        }
        status
    }

    fn request(&mut self, method: &str, params: Value) {
        if !self.available {
            return;
        }
        self.cancel_pending();
        let id = format!("native-search-{}", self.next_id);
        self.next_id += 1;
        self.outbox
            .push_back(json!({"proto":"poc.tui@1", "op":"search:run",
            "jobId":id, "method":method, "params":params}));
        self.pending = Some((id, method.into()));
        self.status = format!("Waiting for {method}; Esc cancels");
        self.revision += 1;
    }

    fn submit(&mut self) {
        if self.schema.is_none() {
            self.status = "Wait for the canonical search description; reopen to retry".into();
            return;
        }
        let Ok(Value::Object(mut search)) = serde_json::from_str::<Value>(&self.fields[7]) else {
            self.status = "Shared filters must be a JSON object".into();
            return;
        };
        for (i, name) in [
            (1, "query"),
            (2, "mode"),
            (3, "backend"),
            (4, "top"),
            (5, "snapshot"),
            (6, "asOf"),
        ] {
            let text = self.fields[i].trim();
            if text.is_empty() {
                continue;
            }
            if search.contains_key(name) {
                self.status = format!("{name} is set in both its field and Shared filters");
                return;
            }
            let value = if i == 4 {
                let Ok(top) = text.parse::<u32>() else {
                    self.status = "Top per mode must be a nonnegative integer".into();
                    return;
                };
                json!(top)
            } else {
                json!(text)
            };
            search.insert(name.into(), value);
        }
        if !self.fields[5].trim().is_empty() && !self.fields[6].trim().is_empty() {
            self.status = "Choose Snapshot or As of".into();
            return;
        }
        if self.fields[0].trim().is_empty() {
            self.status = "Choose a repository".into();
            return;
        }
        let params = json!({"repoPath":self.fields[0].trim(), "search":search});
        self.rows.clear();
        self.result = None;
        self.source = None;
        self.source_hit = None;
        self.selected = 0;
        self.page = Page::Results;
        self.request("query", params);
    }

    pub fn key(&mut self, key: KeyEvent) -> bool {
        self.revision += 1;
        if !self.available {
            return key.code == KeyCode::Esc;
        }
        if key.code == KeyCode::Esc {
            let cancelling = self.pending.is_some();
            self.cancel_pending();
            if self.page == Page::OpenConfirm {
                self.page = Page::Source;
                self.status = "Editor launch cancelled".into();
                return false;
            }
            if self.page == Page::Source {
                self.page = Page::Results;
                self.status = self.results_status();
                if cancelling {
                    self.status.push_str("; source cancellation requested");
                }
                return false;
            }
            if self.page == Page::Diagnostics {
                self.page = Page::Results;
                self.status = self.results_status();
                return false;
            }
            return true;
        }
        if self.page == Page::Composer && self.cursor.key(&mut self.fields[self.field], key, 8192) {
            return false;
        }
        match self.page {
            Page::Composer => match key.code {
                KeyCode::Down | KeyCode::Up if matches!(self.field, 2 | 3) => {
                    let name = if self.field == 2 { "mode" } else { "backend" };
                    if let Some(choices) = self
                        .schema
                        .as_ref()
                        .and_then(|schema| schema["properties"][name]["enum"].as_array())
                    {
                        if !choices.is_empty() {
                            let current = choices
                                .iter()
                                .position(|value| {
                                    value.as_str() == Some(self.fields[self.field].as_str())
                                })
                                .unwrap_or(0);
                            let next = if key.code == KeyCode::Down {
                                (current + 1) % choices.len()
                            } else {
                                (current + choices.len() - 1) % choices.len()
                            };
                            if let Some(value) = choices[next].as_str() {
                                self.fields[self.field] = value.into();
                                self.cursor.reset();
                            }
                        }
                    }
                }
                KeyCode::Tab => {
                    self.field = (self.field + 1) % self.fields.len();
                    self.cursor.reset();
                }
                KeyCode::BackTab => {
                    self.field = (self.field + self.fields.len() - 1) % self.fields.len();
                    self.cursor.reset();
                }
                KeyCode::Enter => self.submit(),
                KeyCode::Backspace => {
                    self.fields[self.field].pop();
                }
                KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                    self.fields[self.field].clear()
                }
                KeyCode::Char(ch) if !ch.is_control() && self.fields[self.field].len() < 8192 => {
                    self.fields[self.field].push(ch)
                }
                _ => {}
            },
            Page::Results => match key.code {
                KeyCode::Char('d') => {
                    self.diagnostics_scroll = 0;
                    self.diagnostics_column = 0;
                    self.page = Page::Diagnostics;
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    self.selected = (self.selected + 1).min(self.rows.len().saturating_sub(1))
                }
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Char('e') => {
                    self.cancel_pending();
                    self.page = Page::Composer;
                }
                KeyCode::Char('n') if self.pending.is_none() => {
                    if let Some(result) = &self.result {
                        if result["pagination"]["nextCursor"].as_str().is_some() {
                            self.request("continue", json!({"resultId":result["resultId"]}));
                        }
                    }
                }
                KeyCode::Enter => {
                    if let (Some(result), Some(hit)) = (&self.result, self.rows.get(self.selected))
                    {
                        let params = json!({"resultId":result["resultId"], "hitId":hit["hitId"]});
                        self.source_hit = hit["hitId"].as_str().map(str::to_owned);
                        self.source = None;
                        self.source_scroll = 0;
                        self.source_column = 0;
                        self.page = Page::Source;
                        self.request("source", params);
                    }
                }
                _ => {}
            },
            Page::Diagnostics => match key.code {
                KeyCode::Down | KeyCode::Char('j') => {
                    self.diagnostics_scroll = self.diagnostics_scroll.saturating_add(1)
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    self.diagnostics_scroll = self.diagnostics_scroll.saturating_sub(1)
                }
                KeyCode::PageDown => {
                    self.diagnostics_scroll = self.diagnostics_scroll.saturating_add(10)
                }
                KeyCode::PageUp => {
                    self.diagnostics_scroll = self.diagnostics_scroll.saturating_sub(10)
                }
                KeyCode::Right => {
                    self.diagnostics_column = self.diagnostics_column.saturating_add(8).min(768)
                }
                KeyCode::Left => {
                    self.diagnostics_column = self.diagnostics_column.saturating_sub(8)
                }
                KeyCode::Home => {
                    self.diagnostics_scroll = 0;
                    self.diagnostics_column = 0;
                }
                _ => {}
            },
            Page::OpenConfirm => {
                if key.code == KeyCode::Enter {
                    if let Some(source) = &self.source {
                        let params = json!({"resultId":source["resultId"], "hitId":source["hitId"],
                            "sourceHash":source["sourceIdentity"]["currentHash"], "editor":"code", "confirmed":true});
                        self.page = Page::Source;
                        self.request("open", params);
                    }
                }
            }
            Page::Source => match key.code {
                KeyCode::Char('o') if self.pending.is_none() => {
                    if self
                        .source
                        .as_ref()
                        .map(|source| source["available"] == true)
                        .unwrap_or(false)
                    {
                        self.page = Page::OpenConfirm;
                    }
                }
                KeyCode::Char('r') if self.pending.is_none() => {
                    if let (Some(result), Some(hit_id)) = (&self.result, &self.source_hit) {
                        self.request(
                            "source",
                            json!({"resultId":result["resultId"], "hitId":hit_id}),
                        );
                    }
                }
                KeyCode::Down | KeyCode::Char('j') => {
                    self.source_scroll = self.source_scroll.saturating_add(1)
                }
                KeyCode::Up | KeyCode::Char('k') => {
                    self.source_scroll = self.source_scroll.saturating_sub(1)
                }
                KeyCode::PageDown => self.source_scroll = self.source_scroll.saturating_add(20),
                KeyCode::PageUp => self.source_scroll = self.source_scroll.saturating_sub(20),
                KeyCode::Right => {
                    self.source_column = self.source_column.saturating_add(8).min(49152)
                }
                KeyCode::Left => self.source_column = self.source_column.saturating_sub(8),
                KeyCode::Home => {
                    self.source_scroll = 0;
                    self.source_column = 0;
                }
                _ => {}
            },
        }
        false
    }

    pub fn paste(&mut self, text: &str) {
        if self.available && self.pending.is_none() && self.page == Page::Composer {
            self.cursor.paste(&mut self.fields[self.field], text, 8192);
            self.revision += 1;
        }
    }

    pub fn click(&mut self, row: usize) {
        if !self.available || self.rendered_revision.get() != Some(self.revision) {
            return;
        }
        let target = self
            .rendered_clicks
            .borrow()
            .iter()
            .find(|(line, _)| *line == row)
            .map(|(_, target)| target.clone());
        match target {
            Some(ClickTarget::Field(field)) if self.page == Page::Composer => {
                self.field = field;
                self.cursor.reset();
            }
            Some(ClickTarget::Result(id)) if self.page == Page::Results => {
                if let Some(index) = self
                    .rows
                    .iter()
                    .position(|hit| hit["hitId"].as_str() == Some(id.as_str()))
                {
                    self.selected = index;
                }
            }
            _ => return,
        }
        self.revision += 1;
    }

    pub fn event(&mut self, event: &Value) -> bool {
        let Some(id) = event["jobId"].as_str() else {
            return false;
        };
        if !id.starts_with("native-search-") {
            return false;
        }
        let Some((pending_id, method)) = &self.pending else {
            return true;
        };
        if id != pending_id || event["event"] != "job:end" {
            return true;
        }
        let method = method.clone();
        self.pending = None;
        self.revision += 1;
        if event["status"] != "done"
            || event["resultState"] != "complete"
            || event["result"]["method"] != method
        {
            self.status = format!(
                "{}: {}",
                event["status"].as_str().unwrap_or("failed"),
                event["error"]["code"]
                    .as_str()
                    .unwrap_or("ERR_TUI_SEARCH_RESPONSE")
            );
            return true;
        }
        let data = &event["result"]["data"];
        match method.as_str() {
            "describe" => {
                self.schema = Some(data["schema"].clone());
                self.modes = data["resultModes"]
                    .as_array()
                    .map(|modes| {
                        modes
                            .iter()
                            .filter_map(|mode| mode.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_default();
                for (i, name) in [(2, "mode"), (3, "backend"), (4, "top")] {
                    if self.fields[i].is_empty() {
                        self.fields[i] = data["defaults"][name]
                            .as_str()
                            .map(str::to_owned)
                            .unwrap_or_else(|| data["defaults"][name].to_string());
                    }
                }
                self.status = "Ready; Enter runs a canonical search".into();
            }
            "query" | "continue" => {
                if method == "continue"
                    && self
                        .result
                        .as_ref()
                        .map(|old| (&old["resultId"], &old["scopeId"], &old["queryGeneration"]))
                        != Some((
                            &data["resultId"],
                            &data["scopeId"],
                            &data["queryGeneration"],
                        ))
                {
                    self.status = "ERR_TUI_SEARCH_STALE: page identity changed".into();
                    return true;
                }
                let Some(hits) = data["hits"].as_array() else {
                    self.status = "ERR_TUI_SEARCH_RESPONSE: missing hits".into();
                    return true;
                };
                let mut combined = self.rows.clone();
                combined.extend(hits.iter().cloned());
                let mut identities = HashSet::new();
                if combined.len() > 500
                    || combined.iter().any(|hit| {
                        let Some(id) = hit["hitId"].as_str() else {
                            return true;
                        };
                        !identities.insert(id.to_string())
                            || !self.modes.iter().any(|mode| hit["mode"] == mode.as_str())
                            || hit["rank"].as_u64().unwrap_or(0) == 0
                    })
                {
                    self.status = "ERR_TUI_SEARCH_RESPONSE: invalid or repeated hit".into();
                    return true;
                }
                combined.sort_by_key(|hit| {
                    (
                        self.modes
                            .iter()
                            .position(|mode| hit["mode"] == mode.as_str()),
                        hit["rank"].as_u64(),
                    )
                });
                let selected_id = self
                    .rows
                    .get(self.selected)
                    .and_then(|hit| hit["hitId"].as_str())
                    .map(str::to_owned);
                self.rows = combined;
                self.selected = selected_id
                    .as_deref()
                    .and_then(|id| {
                        self.rows
                            .iter()
                            .position(|hit| hit["hitId"].as_str() == Some(id))
                    })
                    .unwrap_or_else(|| self.selected.min(self.rows.len().saturating_sub(1)));
                self.result = Some(data.clone());
                self.page = Page::Results;
                self.status = self.results_status();
            }
            "open" => {
                if data["opened"] == true
                    && self.result.as_ref().map(|result| &result["resultId"])
                        == Some(&data["resultId"])
                    && self.source_hit.as_deref() == data["hitId"].as_str()
                {
                    self.status = "Opened the selected source in VS Code".into();
                } else {
                    self.status = "ERR_TUI_SEARCH_STALE: editor response identity changed".into();
                }
            }
            "source" => {
                if self.result.as_ref().map(|result| &result["resultId"]) != Some(&data["resultId"])
                    || self.source_hit.as_deref() != data["hitId"].as_str()
                {
                    self.status = "ERR_TUI_SEARCH_STALE: source identity changed".into();
                    return true;
                }
                self.source = Some(data.clone());
                self.page = Page::Source;
                self.status = if data["available"] == true {
                    "Working-tree source preview".into()
                } else {
                    format!(
                        "Source unavailable: {}",
                        data["reason"].as_str().unwrap_or("unknown")
                    )
                };
            }
            _ => {}
        }
        true
    }

    pub fn lines(&self, height: usize, width: usize) -> Vec<String> {
        let mut click_targets = self.rendered_clicks.borrow_mut();
        click_targets.clear();
        self.rendered_revision.set(Some(self.revision));
        let mut lines = vec![self.status.clone()];
        if !self.available {
            lines.push("Read only: repository search requires a controllable local supervisor. Esc closes.".into());
            return lines;
        }
        match self.page {
            Page::Composer => {
                lines.push(
                    "Tab field; mode/backend Up/Down choices; Ctrl+U clear; Enter search; Esc close".into(),
                );
                for (i, label) in LABELS.iter().enumerate() {
                    if lines.len() < height {
                        click_targets.push((lines.len(), ClickTarget::Field(i)));
                    }
                    lines.push(format!(
                        "{} {label}: {}",
                        if self.field == i { ">" } else { " " },
                        if self.field == i {
                            self.cursor
                                .visible(&self.fields[i], width.saturating_sub(label.len() + 5))
                        } else {
                            self.fields[i].clone()
                        }
                    ));
                }
                if let Some(schema) = &self.schema {
                    for field in ["mode", "backend"] {
                        lines.push(format!(
                            "{field} choices: {}",
                            schema["properties"][field]["enum"]
                        ));
                    }
                }
                lines.push("Empty query + shared filters enumerates pages; Snapshot and As of are exclusive.".into());
            }
            Page::Results => {
                lines.push("Up/Down select; Enter source; n next page; d diagnostics; e edit; Esc close/cancel".into());
                if let Some(result) = &self.result {
                    lines.push(format!(
                        "Repository: {}",
                        result["repoPath"].as_str().unwrap_or("unknown")
                    ));
                    lines.push(
                        result["searchDiagnostics"]["summary"]
                            .as_str()
                            .unwrap_or("Search diagnostics were not recorded for this response.")
                            .into(),
                    );
                }
                if self.rows.is_empty() && self.pending.is_none() {
                    lines.push(self.result.as_ref().and_then(|result| result["searchDiagnostics"]["reasons"][0]["message"].as_str())
                        .unwrap_or("This response page contains no hits; diagnostics were not recorded.").into());
                }
                let budget = height.saturating_sub(lines.len()).max(1);
                let offset = self.selected.saturating_sub(budget - 1);
                for (i, hit) in self.rows.iter().enumerate().skip(offset).take(budget) {
                    if lines.len() < height {
                        if let Some(id) = hit["hitId"].as_str() {
                            click_targets.push((lines.len(), ClickTarget::Result(id.to_owned())));
                        }
                    }
                    let text = format!(
                        "{} {} #{} score={} {}:{}-{} {}",
                        if i == self.selected { ">" } else { " " },
                        hit["mode"].as_str().unwrap_or("?"),
                        hit["rank"],
                        hit["score"],
                        hit["file"].as_str().unwrap_or("?"),
                        hit["startLine"],
                        hit["endLine"],
                        hit["name"].as_str().unwrap_or("")
                    );
                    lines.push(text);
                }
            }
            Page::Diagnostics => {
                lines.push("Recorded search diagnostics; Up/Down scroll; Left/Right pan; Home reset; Esc results".into());
                lines.push("Use Index Health or Tooling Doctor deliberately; viewing diagnostics runs no command.".into());
                let details = self
                    .result
                    .as_ref()
                    .and_then(|result| result["searchDiagnostics"]["details"].as_array());
                if let Some(details) = details {
                    let count = details.len().min(24);
                    let offset = self.diagnostics_scroll.min(count.saturating_sub(1));
                    for value in details
                        .iter()
                        .take(24)
                        .skip(offset)
                        .take(height.saturating_sub(lines.len()))
                    {
                        if let Some(text) = value.as_str() {
                            lines.push(
                                Span::raw(text)
                                    .styled_graphemes(Style::default())
                                    .skip(self.diagnostics_column)
                                    .map(|grapheme| grapheme.symbol)
                                    .collect(),
                            );
                        }
                    }
                    if self
                        .result
                        .as_ref()
                        .map(|result| result["searchDiagnostics"]["truncated"] == true)
                        .unwrap_or(false)
                    {
                        lines.push(
                            "Diagnostic projection was truncated by its display bound.".into(),
                        );
                    }
                } else {
                    lines.push("Search diagnostics were not recorded for this response.".into());
                }
            }
            Page::OpenConfirm => {
                lines.push("Open current source in VS Code? Enter confirms; Esc returns".into());
                if let Some(source) = &self.source {
                    lines.push(format!(
                        "Source: {}:{}",
                        source["file"].as_str().unwrap_or("unavailable"),
                        source["startLine"]
                    ));
                    lines.push(format!(
                        "File: {}",
                        source["fileUri"].as_str().unwrap_or("unavailable")
                    ));
                    lines.push(
                        "The source must still match this preview when the launcher starts.".into(),
                    );
                }
            }
            Page::Source => {
                lines.push(
                    "Up/Down/PageUp/PageDown scroll; Left/Right pan; Home reset; r refresh; o open editor; Esc results"
                        .into(),
                );
                if let Some(source) = &self.source {
                    lines.push(format!(
                        "{}:{}-{}; drift={}; truncated={}",
                        source["file"].as_str().unwrap_or("unavailable"),
                        source["startLine"],
                        source["endLine"],
                        source["sourceIdentity"]["drift"],
                        source["truncated"]
                    ));
                    lines.push(format!(
                        "File: {}",
                        source["fileUri"].as_str().unwrap_or("unavailable")
                    ));
                    if let Some(text) = source["excerpt"].as_str() {
                        let count = text.lines().count();
                        let offset = self.source_scroll.min(count.saturating_sub(1));
                        for line in text
                            .lines()
                            .skip(offset)
                            .take(height.saturating_sub(lines.len()))
                        {
                            lines.push(
                                Span::raw(line)
                                    .styled_graphemes(Style::default())
                                    .skip(self.source_column)
                                    .map(|grapheme| grapheme.symbol)
                                    .collect(),
                            );
                        }
                    }
                }
            }
        }
        // Each logical row consumes one terminal row. Wrapped headers must not
        // push a selected result beyond the viewport calculated above.
        lines
            .into_iter()
            .map(|line| crate::fit_text(&line, width))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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
}
