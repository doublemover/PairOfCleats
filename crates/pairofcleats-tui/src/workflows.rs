use std::collections::VecDeque;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Map, Value};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Scope,
    Commands,
    Fields,
    Edit,
    Preview,
    Result,
}

/// Volatile typed forms. Drafts, previews and scopes are never layout snapshots.
pub(crate) struct WorkflowUi {
    pub available: bool,
    pub revision: u64,
    pub outbox: VecDeque<Value>,
    pub scope: Option<Value>,
    page: Page,
    target: String,
    workspace: bool,
    commands: Vec<Value>,
    command: Option<Value>,
    values: Map<String, Value>,
    selected: usize,
    draft: String,
    preview: Option<Value>,
    result: Option<Value>,
    owned_job: Option<String>,
    pending: Option<(String, String)>,
    status: String,
    scroll: usize,
    next_id: u64,
    early_completions: VecDeque<Value>,
}

impl Default for WorkflowUi {
    fn default() -> Self {
        Self {
            available: false,
            revision: 0,
            outbox: VecDeque::new(),
            scope: None,
            page: Page::Scope,
            target: String::new(),
            workspace: false,
            commands: vec![],
            command: None,
            values: Map::new(),
            selected: 0,
            draft: String::new(),
            preview: None,
            result: None,
            owned_job: None,
            pending: None,
            status: String::new(),
            scroll: 0,
            next_id: 1,
            early_completions: VecDeque::new(),
        }
    }
}

impl WorkflowUi {
    pub fn open(&mut self, initial_scope: &str) {
        if self.target.is_empty() {
            self.target = initial_scope.into();
        }
        self.revision += 1;
    }

    fn request(&mut self, method: &str, params: Value) {
        if !self.available || self.pending.is_some() {
            return;
        }
        let id = format!("native-workflow-{}", self.next_id);
        self.next_id += 1;
        self.outbox
            .push_back(json!({"proto":"poc.tui@1", "op":"workflow:run",
            "jobId":id, "method":method, "params":params}));
        self.pending = Some((id, method.into()));
        self.status = format!("Waiting for {method}; Esc requests cancellation");
    }

    fn commands(&self) -> Vec<&Value> {
        self.commands
            .iter()
            .filter(|command| {
                self.scope.as_ref().map(|scope| &scope["kind"]) == Some(&command["scopeKind"])
            })
            .collect()
    }

    fn fields(&self) -> &[Value] {
        self.command
            .as_ref()
            .and_then(|command| command["fields"].as_array())
            .map(Vec::as_slice)
            .unwrap_or_default()
    }

    pub fn key(&mut self, key: KeyEvent) -> bool {
        self.revision += 1;
        if !self.available {
            self.status = "Index workflows require a controllable live supervisor".into();
            return key.code == KeyCode::Esc;
        }
        if let Some((id, _)) = &self.pending {
            if key.code == KeyCode::Esc {
                self.outbox
                    .push_back(json!({"proto":"poc.tui@1", "op":"job:cancel",
                    "jobId":id, "reason":"user_cancel"}));
                self.status = "Cancellation requested; waiting for the actual outcome".into();
            }
            return false;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
            if self.page == Page::Scope {
                self.target.clear();
            }
            if self.page == Page::Edit {
                self.draft.clear();
            }
            return false;
        }
        match self.page {
            Page::Scope => match key.code {
                KeyCode::Tab => self.workspace = !self.workspace,
                KeyCode::Esc => return true,
                KeyCode::Backspace => { self.target.pop(); }
                KeyCode::Char(ch) if !ch.is_control() && self.target.len() < 4096 => self.target.push(ch),
                KeyCode::Enter => self.request("select", json!({"kind":if self.workspace {"workspace"} else {"repo"}, "target":self.target})),
                _ => {}
            },
            Page::Commands => match key.code {
                KeyCode::Esc => return true,
                KeyCode::Char('s') => self.page = Page::Scope,
                KeyCode::Char('t') => if let Some(scope) = &self.scope { self.request("status", json!({"scopeId":scope["id"]})); },
                KeyCode::Down | KeyCode::Char('j') => self.selected = (self.selected + 1).min(self.commands().len().saturating_sub(1)),
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Enter => if let Some(command) = self.commands().get(self.selected) {
                    self.command = Some((*command).clone()); self.values.clear(); self.selected = 0;
                    self.page = Page::Fields; self.status = "Unset fields use canonical CLI defaults; review scope before launch".into();
                },
                _ => {}
            },
            Page::Fields => match key.code {
                KeyCode::Esc => { self.page = Page::Commands; self.selected = 0; }
                KeyCode::Down | KeyCode::Char('j') => self.selected = (self.selected + 1).min(self.fields().len().saturating_sub(1)),
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Delete => if let Some(name) = self.fields().get(self.selected).and_then(|field| field["name"].as_str()).map(str::to_owned) { self.values.remove(&name); },
                KeyCode::Enter | KeyCode::Char('e') => if let Some(field) = self.fields().get(self.selected) {
                    let fallback = match field["schema"]["type"].as_str() {
                        Some("boolean") => json!(false), Some("number") => json!(0),
                        Some("array") => json!([]), _ => json!(""),
                    };
                    self.draft = self.values.get(field["name"].as_str().unwrap_or_default())
                        .or_else(|| field.get("default")).unwrap_or(&fallback).to_string(); self.page = Page::Edit;
                },
                KeyCode::Char('p') => if let (Some(scope), Some(command)) = (&self.scope, &self.command) {
                    self.request("preview", json!({"scopeId":scope["id"], "commandId":command["id"], "values":self.values}));
                },
                _ => {}
            },
            Page::Edit => match key.code {
                KeyCode::Esc => { self.draft.clear(); self.page = Page::Fields; }
                KeyCode::Backspace => { self.draft.pop(); }
                KeyCode::Char(ch) if !ch.is_control() && self.draft.len() < 4096 => self.draft.push(ch),
                KeyCode::Enter => match serde_json::from_str::<Value>(&self.draft) {
                    Ok(value) => {
                        if let Some(name) = self.fields().get(self.selected).and_then(|field| field["name"].as_str()).map(str::to_owned) { self.values.insert(name, value); }
                        self.draft.clear(); self.page = Page::Fields; self.status = "Draft updated; p validates and previews without launching".into();
                    }
                    Err(_) => self.status = "Invalid JSON value; draft not applied".into(),
                },
                _ => {}
            },
            Page::Preview => match key.code {
                KeyCode::Enter => if let (Some(scope), Some(preview)) = (&self.scope, &self.preview) {
                    if preview["launchable"] == true {
                        self.request("launch", json!({"scopeId":scope["id"], "previewId":preview["previewId"], "confirmed":true}));
                    }
                },
                KeyCode::Esc => {
                    if let (Some(scope), Some(preview)) = (&self.scope, &self.preview) {
                        if preview["previewId"].is_string() { self.request("discard", json!({"scopeId":scope["id"], "previewId":preview["previewId"]})); }
                    }
                    self.page = Page::Fields; self.preview = None;
                }
                KeyCode::Down => self.scroll = self.scroll.saturating_add(1),
                KeyCode::Up => self.scroll = self.scroll.saturating_sub(1),
                _ => {}
            },
            Page::Result => match key.code {
                KeyCode::Esc => { self.page = Page::Commands; self.selected = 0; }
                KeyCode::Char('c') => if let Some(id) = &self.owned_job {
                    self.outbox.push_back(json!({"proto":"poc.tui@1", "op":"job:cancel", "jobId":id, "reason":"user_cancel"}));
                    self.status = format!("Cancellation requested for owned job {id}");
                },
                KeyCode::Char('t') => if let Some(scope) = &self.scope { self.request("status", json!({"scopeId":scope["id"]})); },
                KeyCode::Down => self.scroll = self.scroll.saturating_add(1),
                KeyCode::Up => self.scroll = self.scroll.saturating_sub(1),
                _ => {}
            },
        }
        false
    }

    fn completed(&mut self, event: &Value) {
        self.result = Some(
            json!({"jobId":event["jobId"], "processStatus":event["status"],
                "resultState":event["resultState"], "error":event["error"], "publicationEvidence":event["workflow"], "result":event["result"]}),
        );
        self.status = "Process ended; inspect publication evidence separately. Artifacts remain in Job inspection.".into();
        self.scroll = 0;
        self.revision += 1;
    }

    pub fn event(&mut self, event: &Value) -> bool {
        if event["event"] == "job:end"
            && event["jobId"]
                .as_str()
                .is_some_and(|id| id.starts_with("workflow-"))
        {
            if self.owned_job.as_deref() == event["jobId"].as_str() {
                self.completed(event);
            } else if self
                .pending
                .as_ref()
                .is_some_and(|(_, method)| method == "launch")
            {
                // A fast child can finish before admission's response. Only
                // its matching launch response may grant control authority.
                if self.early_completions.len() >= 4 {
                    self.early_completions.pop_front();
                }
                self.early_completions.push_back(event.clone());
            }
        }
        let Some((id, method)) = &self.pending else {
            return false;
        };
        if event["jobId"].as_str() != Some(id) {
            return false;
        }
        if event["event"] != "job:end" {
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
                "Workflow {}: {}. Preview again before launch.",
                event["status"].as_str().unwrap_or("failed"),
                event["error"]["code"]
                    .as_str()
                    .unwrap_or("ERR_TUI_WORKFLOW_RESPONSE")
            );
            self.preview = None;
            self.page = if self.scope.is_some() {
                Page::Commands
            } else {
                Page::Scope
            };
            self.selected = 0;
            return true;
        }
        let data = &event["result"]["data"];
        match method.as_str() {
            "select" => {
                self.scope = Some(data.clone());
                self.command = None;
                self.values.clear();
                self.preview = None;
                self.selected = 0;
                self.request("describe", json!({}));
            }
            "describe" => {
                self.commands = data["commands"].as_array().cloned().unwrap_or_default();
                self.page = Page::Commands;
                self.status = "Canonical index/workspace catalog loaded; no work started".into();
            }
            "preview" => {
                self.preview = Some(data.clone());
                self.page = Page::Preview;
                self.scroll = 0;
                self.status = if data["launchable"] == true {
                    "Launch preview ready; Enter confirms, Esc discards".into()
                } else {
                    "Launch blocked; inspect readiness or validation errors".into()
                };
            }
            "launch" => {
                self.owned_job = data["jobId"].as_str().map(str::to_owned);
                self.result = Some(data.clone());
                self.preview = None;
                self.page = Page::Result;
                self.scroll = 0;
                self.status = "Owned job admitted; c cancels. Process completion alone does not establish readiness.".into();
                if let Some(index) = self
                    .early_completions
                    .iter()
                    .position(|end| end["jobId"] == data["jobId"])
                {
                    if let Some(end) = self.early_completions.remove(index) {
                        self.completed(&end);
                    }
                }
                self.early_completions.clear();
            }
            "status" => {
                self.result = Some(data.clone());
                self.page = Page::Result;
                self.scroll = 0;
                self.status =
                    "Published generation observation; independent of process success".into();
            }
            "discard" => {
                self.page = Page::Fields;
                self.status = "Launch preview discarded; no job started".into();
            }
            _ => {}
        }
        true
    }

    pub fn lines(&self, height: usize) -> Vec<String> {
        let mut lines = vec![
            format!(
                "Scope: {}",
                self.scope
                    .as_ref()
                    .and_then(|scope| scope["target"].as_str())
                    .unwrap_or("not selected")
            ),
            self.status.clone(),
        ];
        if !self.available {
            lines
                .push("Index workflows unavailable in replay/passive/disconnected sessions".into());
            return lines;
        }
        match self.page {
            Page::Scope => lines.extend([format!("Workflow scope: {} | Tab changes kind | Ctrl+U clears | Enter selects | Esc closes", if self.workspace {"workspace file"} else {"repository directory"}), self.target.clone()]),
            Page::Commands => {
                lines.push("Arrows select | Enter opens typed form | t published status | s scope | Esc closes".into());
                lines.extend(self.commands().iter().enumerate().map(|(i, command)| format!("{} {} [{}] {}", if i == self.selected {">"} else {" "}, command["id"].as_str().unwrap_or_default(), command["supportTier"].as_str().unwrap_or_default(), command["description"].as_str().unwrap_or_default())));
            }
            Page::Fields => {
                lines.push(format!("Typed form: {} | arrows select | Enter edit JSON | Delete unsets | p preview | Esc catalog", self.command.as_ref().and_then(|command| command["id"].as_str()).unwrap_or_default()));
                let count = height.saturating_sub(9).max(1); let start = self.selected.saturating_sub(count / 2).min(self.fields().len().saturating_sub(count));
                lines.extend(self.fields().iter().enumerate().skip(start).take(count).map(|(i, field)| {
                    let name = field["name"].as_str().unwrap_or_default();
                    format!("{} {} ({}) = {}", if i == self.selected {">"} else {" "}, name, field["schema"]["type"].as_str().unwrap_or_default(), self.values.get(name).map(Value::to_string).unwrap_or_else(|| format!("unset; default {}", field["default"])))
                }));
                if let Some(field) = self.fields().get(self.selected) { lines.push(format!("{} | required: {}", field["description"].as_str().unwrap_or_default(), field["required"])); }
                lines.push("Provider/mode and model assets use Settings and canonical build contracts; no separate embeddings command.".into());
            }
            Page::Edit => lines.extend([format!("Edit {} as JSON | Ctrl+U clears | Enter applies draft | Esc discards", self.fields().get(self.selected).and_then(|field| field["name"].as_str()).unwrap_or_default()), self.draft.clone()]),
            Page::Preview | Page::Result => {
                lines.push(if self.page == Page::Preview {"Review exact scope/argv/readiness | Enter confirms | Esc discards | arrows scroll"} else {"Owned job result | c cancels owned job | t refreshes published status | Esc catalog | arrows scroll"}.into());
                if let Some(job) = &self.owned_job { lines.push(format!("Owned job: {job}")); }
                let value = if self.page == Page::Preview { self.preview.as_ref().map(|p| json!({"canonicalArgv":p["canonicalArgv"], "launchable":p["launchable"], "errors":p["errors"], "effect":p["effect"], "observations":p["observations"]})) } else {self.result.clone()};
                let text = value.and_then(|v| serde_json::to_string_pretty(&v).ok()).unwrap_or_default();
                let rows: Vec<&str> = text.lines().collect(); let count = height.saturating_sub(lines.len() + 1).max(1);
                lines.extend(rows.iter().skip(self.scroll.min(rows.len().saturating_sub(count))).take(count).map(|line| line.to_string()));
            }
        }
        lines
    }
}
