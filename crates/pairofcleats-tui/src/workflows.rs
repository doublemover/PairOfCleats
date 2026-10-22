use std::cell::RefCell;
use crate::review_presentation::ReviewPresentation;
use std::collections::VecDeque;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Map, Value};
use crate::overlay_viewport::{ReviewViewport, selected_rows};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Scope,
    Commands,
    Fields,
    Edit,
    Preview,
    Result,
    Services,
    ServiceReview,
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
    cursor: crate::text_editor::TextCursor,
    advanced: bool,
    array_item: bool,
    preview: Option<Value>,
    result: Option<Value>,
    owned_job: Option<String>,
    pending: Option<(String, String)>,
    status: String,
    scroll: ReviewViewport,
    presentation: RefCell<ReviewPresentation>,
    next_id: u64,
    early_completion: Option<Value>,
    experimental: bool,
    services: Vec<Value>,
    service_selection: Option<String>,
    service_armed: Option<String>,
    services_return: Page,
    service_outcome: Option<Value>,
    service_resources: Vec<Value>,
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
            cursor: crate::text_editor::TextCursor::default(),
            advanced: false,
            array_item: false,
            preview: None,
            result: None,
            owned_job: None,
            pending: None,
            status: String::new(),
            scroll: ReviewViewport::default(),
            presentation: RefCell::new(ReviewPresentation::default()),
            next_id: 1,
            early_completion: None,
            experimental: false,
            services: vec![],
            service_selection: None,
            service_armed: None,
            services_return: Page::Commands,
            service_outcome: None,
            service_resources: vec![],
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
        self.presentation.get_mut().clear();
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

    fn selected_service(&self) -> Option<&Value> {
        self.services.iter().find(|service| service["serviceId"].as_str() == self.service_selection.as_deref())
    }

    fn open_services(&mut self) {
        if self.scope.is_none() { return; }
        if !matches!(self.page, Page::Services | Page::ServiceReview) { self.services_return = self.page; }
        self.page = Page::Services; self.service_armed = None;
        if let Some(scope) = &self.scope { self.request("services", json!({"scopeId":scope["id"]})); }
    }

    pub fn key(&mut self, key: KeyEvent) -> bool {
        self.revision += 1;
        if !self.available {
            self.status = "Index workflows require a controllable live supervisor".into();
            return key.code == KeyCode::Esc;
        }
        if let Some((id, _)) = &self.pending {
            if key.code == KeyCode::Esc {
                self.presentation.get_mut().clear();
                self.outbox
                    .push_back(json!({"proto":"poc.tui@1", "op":"job:cancel",
                    "jobId":id, "reason":"user_cancel"}));
                self.status = "Cancellation requested; waiting for the actual outcome".into();
            }
            return false;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
            self.cursor.reset();
            self.scroll.reset();
            if self.page == Page::Scope {
                self.target.clear();
            }
            if self.page == Page::Edit {
                self.draft.clear();
            }
            return false;
        }
        if matches!(self.page, Page::Edit | Page::Scope) && matches!(key.code, KeyCode::Char(_) | KeyCode::Backspace) {
            self.scroll.tail();
        }
        let editing = match self.page { Page::Scope => Some(&mut self.target),
            Page::Edit => Some(&mut self.draft), _ => None };
        if editing.is_some_and(|text| self.cursor.key(text, key, 4096)) { return false; }
        match self.page {
            Page::Scope => match key.code {
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Tab => self.workspace = !self.workspace,
                KeyCode::Esc => return true,
                KeyCode::Backspace => { self.target.pop(); }
                KeyCode::Char(ch) if !ch.is_control() && self.target.len() < 4096 => self.target.push(ch),
                KeyCode::Enter => self.request("select", json!({"kind":if self.workspace {"workspace"} else {"repo"}, "target":self.target})),
                _ => {}
            },
            Page::Commands => match key.code {
                KeyCode::Char('v') => self.open_services(),
                KeyCode::Char('X') => { self.experimental = !self.experimental; self.selected = 0;
                    self.request("describe", json!({"includeExperimental":self.experimental})); }
                KeyCode::Esc => return true,
                KeyCode::Char('s') => self.page = Page::Scope,
                KeyCode::Char('t') => if self.continuation_params().is_some() {
                    self.status = "Dispose the semantic continuation with Esc before replacing its result".into();
                } else if let Some(scope) = &self.scope { self.request("status", json!({"scopeId":scope["id"]})); },
                KeyCode::Down | KeyCode::Char('j') => self.selected = (self.selected + 1).min(self.commands().len().saturating_sub(1)),
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Enter => if let Some(command) = self.commands().get(self.selected) {
                    if let Some(reason) = command["unsupportedReason"].as_str() { self.status = reason.into(); return false; }
                    self.command = Some((*command).clone()); self.values.clear(); self.selected = 0;
                    self.page = Page::Fields; self.status = "Unset fields use canonical CLI defaults; review scope before launch".into();
                },
                _ => {}
            },
            Page::Fields => match key.code {
                KeyCode::Char(' ') => if let Some(field) = self.fields().get(self.selected) {
                    let name = field["name"].as_str().unwrap_or_default().to_owned();
                    if let Some(value) = crate::text_editor::next_choice(&field["schema"], self.values.get(&name).or_else(|| field.get("default"))) {
                        self.values.insert(name, value);
                    }
                },
                KeyCode::Esc => { self.page = Page::Commands; self.selected = 0; }
                KeyCode::Down | KeyCode::Char('j') => self.selected = (self.selected + 1).min(self.fields().len().saturating_sub(1)),
                KeyCode::Up | KeyCode::Char('k') => self.selected = self.selected.saturating_sub(1),
                KeyCode::Delete => if let Some(name) = self.fields().get(self.selected).and_then(|field| field["name"].as_str()).map(str::to_owned) { self.values.remove(&name); },
                KeyCode::Enter | KeyCode::Char('e') | KeyCode::Char('a') => if let Some(field) = self.fields().get(self.selected) {
                    let advanced = key.code == KeyCode::Char('e');
                    let array_item = key.code == KeyCode::Char('a');
                    if array_item && (field["schema"]["type"] != "array" || field["schema"]["items"]["type"] != "string") {
                        self.status = "Item editor requires a string array; use advanced JSON for structured arrays".into(); return false;
                    }
                    let fallback = match field["schema"]["type"].as_str() {
                        Some("boolean") => json!(false), Some("number") | Some("integer") => json!(0),
                        Some("array") => json!([]), _ => json!(""),
                    };
                    let value = self.values.get(field["name"].as_str().unwrap_or_default()).or_else(|| field.get("default")).unwrap_or(&fallback);
                    self.draft = if array_item { String::new() } else { crate::text_editor::input_text(value, &field["schema"], advanced) };
                    self.advanced = advanced; self.array_item = array_item; self.cursor.reset(); self.page = Page::Edit;
                },
                KeyCode::Char('p') => if let (Some(scope), Some(command)) = (&self.scope, &self.command) {
                    self.request("preview", json!({"scopeId":scope["id"], "commandId":command["id"], "values":self.values}));
                },
                _ => {}
            },
            Page::Edit => match key.code {
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Esc => { self.draft.clear(); self.page = Page::Fields; }
                KeyCode::Backspace => { self.draft.pop(); }
                KeyCode::Char(ch) if !ch.is_control() && self.draft.len() < 4096 => self.draft.push(ch),
                KeyCode::Enter => match self.edited_value() {
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
                    if preview["launchable"] == true && preview["plannedJobId"].is_string() {
                        self.early_completion = None;
                        self.request("launch", json!({"scopeId":scope["id"], "previewId":preview["previewId"], "confirmed":true}));
                    }
                },
                KeyCode::Esc => {
                    if let (Some(scope), Some(preview)) = (&self.scope, &self.preview) {
                        if preview["previewId"].is_string() { self.request("discard", json!({"scopeId":scope["id"], "previewId":preview["previewId"]})); }
                    }
                    self.page = Page::Fields; self.presentation.get_mut().clear(); self.preview = None;
                }
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                _ => {}
            },
            Page::Result => match key.code {
                KeyCode::Char('v') => self.open_services(),
                KeyCode::Esc => {
                    if let Some(params) = self.continuation_params() { self.request("close-continuation", params); }
                    else { self.page = Page::Commands; self.selected = 0; }
                }
                KeyCode::Char('n') => if let Some(params) = self.continuation_params() { self.request("next", params); },
                KeyCode::Char('c') => if let Some(id) = &self.owned_job {
                    self.outbox.push_back(json!({"proto":"poc.tui@1", "op":"job:cancel", "jobId":id, "reason":"user_cancel"}));
                    self.status = format!("Cancellation requested for owned job {id}");
                },
                KeyCode::Char('t') => if self.continuation_params().is_some() {
                    self.status = "Dispose the semantic continuation with Esc before replacing its result".into();
                } else if let Some(scope) = &self.scope { self.request("status", json!({"scopeId":scope["id"]})); },
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                _ => {}
            },
            Page::Services => match key.code {
                KeyCode::Esc => { self.page = self.services_return; self.service_armed = None; }
                KeyCode::Char('t') => self.open_services(),
                KeyCode::Down | KeyCode::Char('j') | KeyCode::Up | KeyCode::Char('k') => {
                    let current = self.services.iter().position(|service| service["serviceId"].as_str() == self.service_selection.as_deref());
                    let index = match (current, key.code) {
                        (Some(index), KeyCode::Up | KeyCode::Char('k')) => index.saturating_sub(1),
                        (Some(index), _) => (index + 1).min(self.services.len().saturating_sub(1)),
                        (None, _) => 0,
                    };
                    self.service_selection = self.services.get(index).and_then(|service| service["serviceId"].as_str()).map(str::to_owned);
                    self.service_armed = None;
                }
                KeyCode::Enter | KeyCode::Char('c') => {
                    if let Some(service) = self.selected_service().cloned() {
                        if service["canStop"] == true {
                            self.service_armed = service["serviceId"].as_str().map(str::to_owned);
                            self.page = Page::ServiceReview;
                            self.status = "Review the exact owned service; Enter confirms stop, Esc returns".into();
                        } else { self.status = "This service already ended or is stopping; refresh its actual state".into(); }
                    }
                }
                _ => {}
            },
            Page::ServiceReview => match key.code {
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Esc => { self.service_armed = None; self.page = Page::Services; }
                KeyCode::Enter => {
                    if let (Some(scope), Some(service)) = (&self.scope, self.selected_service()) {
                        if service["serviceId"].as_str() == self.service_armed.as_deref() && service["canStop"] == true {
                            let params = json!({"scopeId":scope["id"],"serviceId":service["serviceId"],"confirmed":true});
                            self.request("stop-service", params);
                        }
                    }
                }
                _ => {}
            },
        }
        false
    }

    fn edited_value(&self) -> Result<Value, serde_json::Error> {
        let field = self.fields().get(self.selected).unwrap_or(&Value::Null);
        if self.array_item {
            let mut values = field["name"].as_str().and_then(|name| self.values.get(name)).or_else(|| field.get("default"))
                .and_then(Value::as_array).cloned().unwrap_or_default();
            if values.len() >= 32 { return serde_json::from_str("array editor limit exceeded"); }
            values.push(json!(self.draft)); Ok(json!(values))
        } else { crate::text_editor::input_value(&self.draft, &field["schema"], self.advanced) }
    }

    fn continuation_params(&self) -> Option<Value> {
        let result = self.result.as_ref()?;
        let continuation = if result["nativeContinuation"].is_object() { &result["nativeContinuation"] }
            else { &result["result"]["nativeContinuation"] };
        let scope = self.scope.as_ref()?;
        if continuation["scopeId"] != scope["id"] || !continuation["id"].is_string() { return None; }
        Some(json!({"scopeId":scope["id"], "continuationId":continuation["id"]}))
    }

    pub fn paste(&mut self, text: &str) {
        if !self.available || self.pending.is_some() { return; }
        let field = match self.page { Page::Scope => Some(&mut self.target),
            Page::Edit => Some(&mut self.draft), _ => None };
        if let Some(field) = field { self.cursor.paste(field, text, 4096); self.revision += 1; }
    }

    fn completed(&mut self, event: &Value) {
        self.presentation.get_mut().clear(); self.result = Some(
            json!({"jobId":event["jobId"], "processStatus":event["status"],
                "resultState":event["resultState"], "error":event["error"], "publicationEvidence":event["workflow"], "result":event["result"]}),
        );
        self.status = if event["workflow"]["maintenance"]["pending"] == true {
            "Backend ownership unresolved; cache admission remains fenced. Status reads do not inspect cache artifacts.".into()
        } else {
            "Process ended; inspect publication evidence separately. Artifacts remain in Job inspection.".into()
        };
        self.scroll.reset();
        self.revision += 1;
    }

    pub fn event(&mut self, event: &Value) -> bool {
        if event["event"] == "job:end" {
            for service in &mut self.services {
                if service["jobId"].as_str().is_some() && service["jobId"] == event["jobId"] {
                    service["canStop"] = json!(false); service["phase"] = event["status"].clone();
                    if service["serviceId"].as_str() == self.service_armed.as_deref() {
                        self.service_armed = None; self.page = Page::Services;
                    }
                }
            }
        }
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
                && self
                    .preview
                    .as_ref()
                    .and_then(|value| value["plannedJobId"].as_str())
                    == event["jobId"].as_str()
            {
                // A fast child can finish before admission's response. Only
                // the reserved identity is retained; unrelated completions can
                // neither evict this result nor grant control authority.
                self.early_completion = Some(event.clone());
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
            if matches!(method.as_str(), "services" | "stop-service") {
                self.page = Page::Services; self.service_armed = None; return true;
            }
            self.presentation.get_mut().clear(); self.preview = None;
            self.early_completion = None;
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
                self.services.clear(); self.service_selection = None; self.service_armed = None;
                self.service_outcome = None; self.service_resources.clear();
                self.presentation.get_mut().clear(); self.scope = Some(data.clone());
                self.owned_job = None;
                self.early_completion = None;
                self.command = None;
                self.values.clear();
                self.presentation.get_mut().clear(); self.preview = None;
                self.selected = 0;
                self.request("describe", json!({}));
            }
            "describe" => {
                self.commands = data["commands"].as_array().cloned().unwrap_or_default();
                self.page = Page::Commands;
                self.status = "Canonical command catalog loaded; no work started. Unsupported rows explain the missing adapter.".into();
            }
            "preview" => {
                self.presentation.get_mut().clear(); self.preview = Some(data.clone());
                self.page = Page::Preview;
                self.scroll.reset();
                self.status = if data["launchable"] == true {
                    "Launch preview ready; Enter confirms, Esc discards".into()
                } else {
                    "Launch blocked; inspect readiness or validation errors".into()
                };
            }
            "launch" => {
                let planned = self
                    .preview
                    .as_ref()
                    .and_then(|value| value["plannedJobId"].as_str());
                if planned.is_none() || data["jobId"].as_str() != planned {
                    self.status =
                        "Launch identity mismatch; no control granted. Inspect actual jobs.".into();
                    self.owned_job = None;
                    self.presentation.get_mut().clear(); self.preview = None;
                    self.early_completion = None;
                    self.page = Page::Commands;
                    return true;
                }
                self.owned_job = data["jobId"].as_str().map(str::to_owned);
                self.presentation.get_mut().clear(); self.result = Some(data.clone());
                self.presentation.get_mut().clear(); self.preview = None;
                self.page = Page::Result;
                self.scroll.reset();
                self.status = "Owned job admitted; c cancels. Process completion alone does not establish readiness.".into();
                if let Some(end) = self.early_completion.take() {
                    if end["jobId"] == data["jobId"] {
                        self.completed(&end);
                    }
                }
            }
            "status" => {
                self.presentation.get_mut().clear(); self.result = Some(data.clone());
                self.page = Page::Result;
                self.scroll.reset();
                self.status = if data["maintenance"]["blocked"] == true {
                    "Backend maintenance fences cache admission; no publication artifacts were read".into()
                } else {
                    "Published generation observation; independent of process success".into()
                };
            }
            "services" => {
                let initial = self.services.is_empty() && self.service_selection.is_none();
                self.services = data["ownedServices"].as_array().map(|services| services.iter()
                    .filter(|service| service["serviceId"].is_string() && service["jobId"].is_string())
                    .take(6).cloned().collect()).unwrap_or_default();
                if !self.services.iter().any(|service| service["serviceId"].as_str() == self.service_selection.as_deref()) {
                    self.service_selection = if initial { self.services.first().and_then(|service| service["serviceId"].as_str()).map(str::to_owned) } else { None };
                }
                self.service_armed = None; self.page = Page::Services;
                self.service_resources = data["resources"].as_array().map(|resources| resources.iter().take(6).cloned().collect()).unwrap_or_default();
                self.status = "Current-session services only; health and index readiness are separate observations".into();
            }
            "stop-service" => {
                self.service_outcome = Some(data.clone());
                self.service_armed = None; self.page = Page::Services;
                self.status = if data["settled"] == true {
                    "Exact owned service execution and resource closure settled; t refreshes services".into()
                } else { "Stop requested; resource closure remains pending. No closure or readiness is claimed".into() };
                self.open_services();
            }
            "next" => {
                self.result = Some(data.clone()); self.page = Page::Result; self.scroll.reset();
                self.status = "Canonical semantic page received; n continues in the same owned process, Esc disposes".into();
            }
            "close-continuation" => {
                self.result = None; self.page = Page::Commands; self.selected = 0;
                self.status = "Semantic continuation disposed; no cursor persisted".into();
            }
            "discard" => {
                self.presentation.get_mut().clear(); self.preview = None;
                self.page = Page::Fields;
                self.status = "Launch preview discarded; no job started".into();
            }
            _ => {}
        }
        true
    }

    pub fn lines(&self, height: usize, width: usize) -> Vec<String> {
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
            return lines.into_iter().take(height).map(|line| crate::fit_text(&line, width)).collect();
        }
        match self.page {
            Page::Scope => {
                lines.push(format!("Workflow scope: {} | Tab kind | Enter selects | Esc closes | arrows review", if self.workspace {"workspace file"} else {"repository directory"}));
                return self.scroll.lines(lines, &self.cursor.visible(&self.target, width), height, width);
            }
            Page::Commands => {
                lines.push(format!("Arrows select | Enter form/reason | X experimental {} | t status | v owned services | s scope | Esc closes", self.experimental));
                let rows = self.commands().iter().enumerate().map(|(i, command)| format!("{} {} [{}] {}", if i == self.selected {">"} else {" "}, command["id"].as_str().unwrap_or_default(), command["supportTier"].as_str().unwrap_or_default(), command["description"].as_str().unwrap_or_default())).collect();
                return selected_rows(lines, rows, self.selected, height, width);
            }
            Page::Fields => {
                lines.push(format!("Typed form: {} | Enter literal | Space choice | e JSON | a item | Delete unset | p preview | Esc catalog", self.command.as_ref().and_then(|command| command["id"].as_str()).unwrap_or_default()));
                let count = height.saturating_sub(lines.len() + 3).max(1); let start = self.selected.saturating_sub(count / 2).min(self.fields().len().saturating_sub(count));
                lines.extend(self.fields().iter().enumerate().skip(start).take(count).map(|(i, field)| {
                    let name = field["name"].as_str().unwrap_or_default();
                    format!("{} {} ({}) = {}", if i == self.selected {">"} else {" "}, name, field["schema"]["type"].as_str().unwrap_or_default(), self.values.get(name).map(Value::to_string).unwrap_or_else(|| format!("unset; default {}", field["default"])))
                }));
                if let Some(field) = self.fields().get(self.selected) { lines.push(format!("{} | required: {}", field["description"].as_str().unwrap_or_default(), field["required"])); }
                if let Some(field) = self.fields().get(self.selected) { lines.push(crate::text_editor::schema_hint(&field["schema"])); }
                lines.push("Provider/mode and model assets use Settings and canonical build contracts; no separate embeddings command.".into());
            }
            Page::Edit => {
                lines.push(format!("Edit {} | Ctrl+U clear | Enter applies | Esc discards | cursor/Home/End", if self.array_item { "array item" } else if self.advanced { "advanced JSON" } else { "schema literal" }));
                if let Some(field) = self.fields().get(self.selected) { lines.push(crate::text_editor::schema_hint(&field["schema"])); }
                let name = self.fields().get(self.selected).and_then(|field| field["name"].as_str()).unwrap_or_default();
                return self.scroll.lines(lines, &format!("Field: {name}\n{}", self.cursor.visible(&self.draft, width)), height, width);
            }
            Page::Preview | Page::Result => {
                lines.push(if self.page == Page::Preview {"Review exact scope/argv/readiness | Enter confirms | Esc discards | arrows scroll"} else {"Owned job result | n semantic next | c cancel | t status | v services | Esc disposes continuation/catalog | arrows scroll"}.into());
                if let Some(job) = &self.owned_job { lines.push(format!("Owned job: {job}")); }
                if self.page == Page::Preview {
                    let empty = Value::Null;
                    let preview = self.preview.as_ref().unwrap_or(&empty);
                    let projection: std::collections::BTreeMap<_, _> = ["canonicalArgv", "executionOwner", "backendReview", "serviceReview", "storageReview", "launchable", "errors", "effect", "observations"]
                        .into_iter().map(|key| (key, &preview[key])).collect();
                    return self.presentation.borrow_mut().lines(1, self.scope.as_ref(), &projection,
                        &self.scroll, lines, height, width);
                }
                return self.presentation.borrow_mut().lines(2, self.scope.as_ref(), self.result.as_ref().unwrap_or(&Value::Null),
                    &self.scroll, lines, height, width);
            }
            Page::Services => {
                lines.push("Owned services | arrows select | Enter/c review stop | t refresh | Esc back".into());
                if let Some(outcome) = &self.service_outcome {
                    lines.push(format!("Last stop: {} | {}", outcome["jobId"].as_str().unwrap_or("unknown"),
                        if outcome["settled"] == true { "resource closure settled" } else { "closure pending; no success receipt" }));
                }
                for resource in &self.service_resources {
                    if resource["phase"] == "closure-failed" || resource["closurePending"] == true {
                        lines.push(format!("Retained owner {} {}: {}", resource["service"].as_str().unwrap_or("service"),
                            resource["jobId"].as_str().unwrap_or("unknown"), resource["closeErrorCode"].as_str().unwrap_or("closure pending")));
                    }
                }
                if self.services.is_empty() { lines.push("No active service control is retained for this selected scope".into()); }
                if self.service_selection.is_none() && !self.services.is_empty() { lines.push("Previous service disappeared; arrows choose a new exact service".into()); }
                let selected = self.services.iter().position(|service| service["serviceId"].as_str() == self.service_selection.as_deref()).unwrap_or(0);
                let rows = self.services.iter().map(|service| format!("{} {} | {} | {} | stop {}",
                    if service["serviceId"].as_str() == self.service_selection.as_deref() { ">" } else { " " },
                    service["service"].as_str().unwrap_or("service"), service["jobId"].as_str().unwrap_or("unknown"),
                    service["phase"].as_str().unwrap_or("unverified"), if service["canStop"] == true { "available" } else { "unavailable" })).collect();
                return selected_rows(lines, rows, selected, height, width);
            }
            Page::ServiceReview => {
                lines.push("Enter stops this exact session-owned service | Esc returns | arrows review".into());
                if let Some(service) = self.selected_service() {
                    let review = format!("Service: {}\nJob: {}\nControl identity: {}\nState: {}\nStop only this owned job; await actual execution and resource closure. No published-index readiness is inferred.",
                        service["service"].as_str().unwrap_or("unknown"), service["jobId"].as_str().unwrap_or("unknown"),
                        service["serviceId"].as_str().unwrap_or("unknown"), service["phase"].as_str().unwrap_or("unverified"));
                    return self.scroll.lines(lines, &review, height, width);
                }
            }
        }
        lines.into_iter().take(height).map(|line| crate::fit_text(&line, width)).collect()
    }
}

#[cfg(test)]
mod presentation_tests {
    use super::*;
    fn end(ui: &mut WorkflowUi, data: Value) {
        let (id, method) = ui.pending.clone().unwrap();
        assert!(ui.event(&json!({"event":"job:end","jobId":id,"status":"done",
            "resultState":"complete","result":{"method":method,"data":data}})));
    }
    #[test]
    fn accepted_workflow_projection_and_results_serialize_once_per_identity() {
        let mut ui = WorkflowUi { available: true, scope: Some(json!({"id":"scope","target":"repo"})),
            ..WorkflowUi::default() };
        ui.request("preview", json!({}));
        end(&mut ui, json!({"plannedJobId":"workflow-owned", "launchable":true,
            "canonicalArgv":["node","FIRST-PREVIEW"],"errors":[],"observations":{"version":1}}));
        let preview = ui.lines(24, 80).join("\n"); assert!(preview.contains("FIRST-PREVIEW"));
        for _ in 0..20 { ui.scroll.down(); ui.revision += 1; ui.lines(24, 80); }
        ui.lines(24, 90); assert_eq!(ui.presentation.borrow().builds, 1);
        ui.request("launch", json!({})); end(&mut ui, json!({"jobId":"workflow-owned"}));
        ui.lines(24, 80);
        ui.completed(&json!({"jobId":"workflow-owned","status":"done","resultState":"complete",
            "result":{"marker":"OWNED-RESULT"}}));
        let result = ui.lines(24, 80).join("\n"); assert!(result.contains("OWNED-RESULT"));
        assert!(!result.contains("FIRST-PREVIEW"));
        let builds = ui.presentation.borrow().builds;
        for _ in 0..20 { ui.scroll.down(); ui.lines(24, 80); }
        assert_eq!(ui.presentation.borrow().builds, builds);
        ui.request("status", json!({})); end(&mut ui, json!({"marker":"REFRESHED-STATUS"}));
        assert!(ui.lines(24, 80).join("\n").contains("REFRESHED-STATUS"));
        assert_eq!(ui.presentation.borrow().builds, builds + 1);
        assert!(ui.preview.is_none());
    }
    #[test]
    fn pending_backend_owner_is_presented_without_a_publication_read_claim() {
        let mut ui = WorkflowUi { available: true, scope: Some(json!({"id":"scope","target":"repo"})),
            ..WorkflowUi::default() };
        ui.request("status", json!({}));
        end(&mut ui, json!({"maintenance":{"blocked":true,"pending":true},"publications":[]}));
        assert!(ui.status.contains("no publication artifacts were read"));
        ui.completed(&json!({"jobId":"workflow-backend","status":"cancelled",
            "error":{"code":"ERR_TUI_BACKEND_OWNERSHIP_PENDING"},
            "workflow":{"maintenance":{"blocked":true,"pending":true},"publications":[]}}));
        assert!(ui.status.contains("ownership unresolved"));
        assert_eq!(ui.result.as_ref().unwrap()["publicationEvidence"]["maintenance"]["pending"], true);
    }
    #[test]
    fn service_stop_reviews_exact_identity_and_preserves_pending_resource_outcome() {
        let mut ui = WorkflowUi { available: true, scope: Some(json!({"id":"scope"})),
            page: Page::Commands, ..WorkflowUi::default() };
        ui.key(KeyEvent::new(KeyCode::Char('v'), KeyModifiers::NONE));
        end(&mut ui, json!({"ownedServices":[{"serviceId":"opaque-api","service":"api",
            "jobId":"owned-api","phase":"running","canStop":true}],"resources":[]}));
        ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert!(matches!(ui.page, Page::ServiceReview));
        assert_eq!(ui.service_armed.as_deref(), Some("opaque-api"));
        ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        let request = ui.outbox.back().unwrap();
        assert_eq!(request["method"], "stop-service");
        assert_eq!(request["params"], json!({"scopeId":"scope","serviceId":"opaque-api","confirmed":true}));
        end(&mut ui, json!({"jobId":"owned-api","stopRequested":true,"executionSettled":true,
            "settled":false,"pending":true,"errorCode":"ERR_TUI_SERVICE_CLOSURE_PENDING"}));
        assert!(matches!(ui.page, Page::Services));
        assert!(ui.lines(20, 120).join("\n").contains("closure pending"));
        assert_eq!(ui.outbox.back().unwrap()["method"], "services");
    }
    #[test]
    fn service_refresh_and_job_end_never_retarget_an_armed_stop() {
        let mut ui = WorkflowUi { available: true, scope: Some(json!({"id":"scope"})),
            page: Page::Commands, ..WorkflowUi::default() };
        ui.open_services();
        end(&mut ui, json!({"ownedServices":[{"serviceId":"old","jobId":"old-job","canStop":true}]}));
        ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        ui.event(&json!({"event":"job:end","jobId":"old-job","status":"failed"}));
        assert!(ui.service_armed.is_none());
        assert!(matches!(ui.page, Page::Services));
        ui.open_services();
        end(&mut ui, json!({"ownedServices":[{"serviceId":"replacement","jobId":"new-job","canStop":true}]}));
        assert!(ui.service_selection.is_none());
        let count = ui.outbox.len();
        ui.key(KeyEvent::new(KeyCode::Enter, KeyModifiers::NONE));
        assert_eq!(ui.outbox.len(), count, "replacement requires its own selection and review");
        assert!(ui.pending.is_none());
    }
}
