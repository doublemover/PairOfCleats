use std::cell::RefCell;
use crate::review_presentation::ReviewPresentation;
use std::collections::VecDeque;

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use serde_json::{json, Value};
use crate::overlay_viewport::ReviewViewport;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Page {
    Scope,
    Fields,
    Filter,
    Edit,
    Preview,
    Provenance,
}

/// Volatile operator state. Neither editor drafts nor settings responses belong
/// in the layout snapshot, telemetry, command history or foreground job list.
pub(crate) struct SettingsUi {
    pub available: bool,
    pub scope: Option<Value>,
    pub revision: u64,
    pub outbox: VecDeque<Value>,
    page: Page,
    workspace: bool,
    target: String,
    query: String,
    draft: String,
    cursor: crate::text_editor::TextCursor,
    advanced: bool,
    array_item: bool,
    draft_binding: Option<Value>,
    draft_needs_reload: bool,
    inspection: Option<Value>,
    preview: Option<Value>,
    reset: bool,
    selected: usize,
    scroll: ReviewViewport,
    presentation: RefCell<ReviewPresentation>,
    status: String,
    pending: Option<(String, String)>,
    next_id: u64,
}

impl Default for SettingsUi {
    fn default() -> Self {
        Self {
            available: false,
            scope: None,
            revision: 0,
            outbox: VecDeque::new(),
            page: Page::Scope,
            workspace: false,
            target: String::new(),
            query: String::new(),
            draft: String::new(),
            cursor: crate::text_editor::TextCursor::default(),
            advanced: false,
            array_item: false,
            draft_binding: None,
            draft_needs_reload: false,
            inspection: None,
            preview: None,
            reset: false,
            selected: 0,
            scroll: ReviewViewport::default(),
            presentation: RefCell::new(ReviewPresentation::default()),
            status: String::new(),
            pending: None,
            next_id: 1,
        }
    }
}

fn compact(value: &Value) -> String {
    value.to_string().chars().take(240).collect()
}

fn field_name(field: &Value) -> String {
    field["path"]
        .as_array()
        .map(|path| {
            path.iter()
                .filter_map(Value::as_str)
                .collect::<Vec<_>>()
                .join(".")
        })
        .unwrap_or_default()
}

impl SettingsUi {
    pub fn open(&mut self, initial_scope: &str) {
        if self.target.is_empty() {
            self.target = initial_scope.to_string();
        }
        self.revision += 1;
    }

    fn request(&mut self, method: &str, params: Value) {
        if self.pending.is_some() || !self.available {
            return;
        }
        self.presentation.get_mut().clear();
        let id = format!("native-settings-{}", self.next_id);
        self.next_id += 1;
        self.outbox
            .push_back(json!({"proto":"poc.tui@1", "op":"settings:run",
            "jobId":id, "method":method, "params":params}));
        self.pending = Some((id, method.to_string()));
        self.status = format!("Waiting for {method}; Esc requests cancellation");
        self.revision += 1;
    }

    fn inspect(&mut self) {
        if let Some(scope) = &self.scope {
            self.request("inspect", json!({"scopeId":scope["id"]}));
        }
    }

    fn fields(&self) -> Vec<&Value> {
        self.inspection
            .as_ref()
            .and_then(|info| info["fields"].as_array())
            .map(|fields| {
                fields
                    .iter()
                    .filter(|field| {
                        field_name(field)
                            .to_lowercase()
                            .contains(&self.query.to_lowercase())
                    })
                    .collect()
            })
            .unwrap_or_default()
    }

    fn selected_field(&self) -> Option<&Value> {
        let fields = self.fields();
        fields
            .get(self.selected.min(fields.len().saturating_sub(1)))
            .copied()
    }

    fn preview(&mut self, reset: bool) {
        let Some(info) = &self.inspection else {
            return;
        };
        let mut params = json!({"scopeId":info["scope"]["id"], "revision":info["revision"],
            "schemaRevision":info["schemaRevision"], "operation":if reset {"reset"} else {"edit"}});
        if !reset {
            if self.draft_needs_reload {
                self.status = "Unsaved draft retained; Ctrl-r reloads before revalidation".into();
                return;
            }
            let Some(field) = self.selected_field() else {
                return;
            };
            let valid_binding = self.draft_binding.as_ref().map(|binding| {
                binding["scopeId"] == info["scope"]["id"] && binding["path"] == field["path"]
                    && binding["revision"] == info["revision"] && binding["schemaRevision"] == info["schemaRevision"]
            }).unwrap_or(false);
            if !valid_binding {
                self.draft_needs_reload = true;
                self.status = "Unsaved draft has stale field authority; Ctrl-r reloads before revalidation".into();
                return;
            }
            let parsed = if self.array_item {
                let mut values = if field["requestedPresent"] == true { field["requested"].as_array() }
                    else if field["effectiveRecorded"] == true { field["effective"].as_array() }
                    else { field["schema"]["default"].as_array() }.cloned().unwrap_or_default();
                if values.len() >= 32 { self.status = "Array item editor is bounded to 32 items; use advanced JSON or a private editor".into(); return; }
                values.push(json!(self.draft)); Ok(json!(values))
            } else { crate::text_editor::input_value(&self.draft, &field["schema"], self.advanced) };
            let Ok(value) = parsed else {
                self.status = "Invalid JSON value; nothing saved".into();
                return;
            };
            params["path"] = field["path"].clone();
            params["value"] = value;
        }
        self.reset = reset;
        if reset {
            self.draft.clear();
            self.draft_binding = None;
        }
        self.presentation.get_mut().clear(); self.preview = None;
        self.request("preview", params);
    }

    fn remove_override(&mut self) {
        let (Some(info), Some(field)) = (&self.inspection, self.selected_field()) else { return; };
        if field["editable"] != true {
            self.status = field["readOnlyReason"].as_str().unwrap_or("Read only").into();
            return;
        }
        let params = json!({"scopeId":info["scope"]["id"], "revision":info["revision"],
            "schemaRevision":info["schemaRevision"], "operation":"remove", "path":field["path"]});
        self.draft.clear(); self.draft_binding = None; self.reset = false;
        self.preview = None;
        self.request("preview", params);
    }

    /// Returns true only when Esc closes the overlay. Input is never logged.
    pub fn key(&mut self, key: KeyEvent) -> bool {
        self.revision += 1;
        if !self.available {
            self.status =
                "Settings require a controllable supervisor with settings capability".into();
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
        if self.page == Page::Edit && key.modifiers.contains(KeyModifiers::CONTROL)
            && key.code == KeyCode::Char('r') {
            self.inspect();
            return false;
        }
        if key.modifiers.contains(KeyModifiers::CONTROL) && key.code == KeyCode::Char('u') {
            self.cursor.reset();
            self.scroll.reset();
            match self.page {
                Page::Scope => self.target.clear(),
                Page::Edit | Page::Preview => self.draft.clear(),
                Page::Filter => {
                    self.query.clear();
                    self.selected = 0;
                }
                _ => {}
            }
            return false;
        }
        if matches!(self.page, Page::Edit | Page::Scope) && matches!(key.code, KeyCode::Char(_) | KeyCode::Backspace) {
            self.scroll.tail();
        }
        let editing = match self.page {
            Page::Scope => Some(&mut self.target), Page::Edit => Some(&mut self.draft),
            Page::Filter => Some(&mut self.query), _ => None,
        };
        if editing.is_some_and(|text| self.cursor.key(text, key, 4096)) { return false; }
        match self.page {
            Page::Scope => match key.code {
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Tab => self.workspace = !self.workspace,
                KeyCode::Backspace => {
                    self.target.pop();
                }
                KeyCode::Char(ch) if !ch.is_control() && self.target.len() < 4096 => {
                    self.target.push(ch)
                }
                KeyCode::Enter => self.request(
                    "select",
                    json!({"kind":if self.workspace {"workspace"} else {"repo"},
                    "target":self.target}),
                ),
                KeyCode::Esc => {
                    if self.scope.is_some() {
                        self.page = Page::Fields;
                    } else {
                        return true;
                    }
                }
                _ => {}
            },
            Page::Fields => match key.code {
                KeyCode::Delete => self.remove_override(),
                KeyCode::Char(' ') => {
                    let choice = self.selected_field().and_then(|field| crate::text_editor::next_choice(&field["schema"],
                        if field["requestedPresent"] == true { field.get("requested") } else { field.get("effective") }));
                    if let Some(choice) = choice {
                        self.key(KeyCode::Enter.into());
                        if self.page == Page::Edit {
                            self.draft = crate::text_editor::input_text(&choice, &self.selected_field().unwrap()["schema"], false);
                            self.preview(false);
                        }
                    } else { self.status = "Space cycles enums and booleans; Enter edits a literal; e opens advanced JSON".into(); }
                }
                KeyCode::Esc => {
                    self.draft.clear(); self.draft_binding = None;
                    return true;
                },
                KeyCode::Char('s') => {
                    self.draft.clear(); self.draft_binding = None;
                    self.page = Page::Scope;
                },
                KeyCode::Char('r') => self.inspect(),
                KeyCode::Char('R') => self.preview(true),
                KeyCode::Char('p') => {
                    self.page = Page::Provenance;
                    self.scroll.reset();
                }
                KeyCode::Char('/') => self.page = Page::Filter,
                KeyCode::Down => {
                    self.selected = (self.selected + 1).min(self.fields().len().saturating_sub(1))
                }
                KeyCode::Up => self.selected = self.selected.saturating_sub(1),
                KeyCode::Enter | KeyCode::Char('e') | KeyCode::Char('a') => {
                    if let Some(field) = self.selected_field() {
                        if field["editable"].as_bool() != Some(true) {
                            self.status = field["readOnlyReason"]
                                .as_str()
                                .unwrap_or("Read only")
                                .into();
                        } else {
                            let advanced = key.code == KeyCode::Char('e');
                            let array_item = key.code == KeyCode::Char('a');
                            if array_item && (field["schema"]["type"] != "array" || field["schema"]["items"]["type"] != "string") {
                                self.status = "Item editor requires a string array; use advanced JSON for structured arrays".into(); return false;
                            }
                            let value = if field["requestedPresent"].as_bool() == Some(true) {
                                field["requested"].clone()
                            } else if field["editScope"] == "repository-object" {
                                json!({})
                            } else if field["effectiveRecorded"].as_bool() == Some(true) {
                                field["effective"].clone()
                            } else if let Some(default) = field["schema"].get("default") {
                                default.clone()
                            } else {
                                Value::Null
                            };
                            let draft = if array_item { String::new() } else { crate::text_editor::input_text(&value, &field["schema"], advanced) };
                            if draft.len() > 4096 {
                                self.status = "Value exceeds the bounded editor; use a private editor".into();
                                return false;
                            }
                            let binding = json!({"scopeId":self.inspection.as_ref().unwrap()["scope"]["id"],
                                "path":field["path"], "revision":self.inspection.as_ref().unwrap()["revision"],
                                "schemaRevision":self.inspection.as_ref().unwrap()["schemaRevision"]});
                            self.draft = draft;
                            self.advanced = advanced; self.array_item = array_item;
                            self.cursor.reset();
                            self.draft_binding = Some(binding);
                            self.draft_needs_reload = false;
                            self.page = Page::Edit;
                            self.status =
                                "Edit literal value; e on field list opens advanced JSON; Enter previews; Esc discards"
                                    .into();
                        }
                    }
                }
                _ => {}
            },
            Page::Filter => match key.code {
                KeyCode::Esc => {
                    self.query.clear();
                    self.selected = 0;
                    self.page = Page::Fields;
                }
                KeyCode::Enter => {
                    self.selected = 0;
                    self.page = Page::Fields;
                }
                KeyCode::Backspace => {
                    self.query.pop();
                    self.selected = 0;
                }
                KeyCode::Char(ch) if !ch.is_control() && self.query.len() < 256 => {
                    self.query.push(ch);
                    self.selected = 0;
                }
                _ => {}
            },
            Page::Edit => match key.code {
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Esc => {
                    self.draft.clear();
                    self.draft_binding = None;
                    self.page = Page::Fields;
                    self.status = "Edit discarded; nothing saved".into();
                }
                KeyCode::Enter => self.preview(false),
                KeyCode::Backspace => {
                    self.draft.pop();
                }
                KeyCode::Char(ch) if !ch.is_control() && self.draft.len() < 4096 => {
                    self.draft.push(ch)
                }
                _ => {}
            },
            Page::Preview => match key.code {
                KeyCode::Esc => {
                    if let Some(preview) = &self.preview {
                        self.request("cancel", json!({"scopeId":preview["scope"]["id"], "previewId":preview["previewId"]}));
                    }
                }
                KeyCode::Char(ch) if self.reset && !ch.is_control() && self.draft.len() < 64 => {
                    self.draft.push(ch)
                }
                KeyCode::Backspace => {
                    self.draft.pop();
                }
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                KeyCode::Enter => {
                    if self.reset && self.draft != "RESET" {
                        self.status = "Reset requires typing RESET exactly; nothing saved".into();
                    } else if let Some(preview) = &self.preview {
                        let mut params = json!({"scopeId":preview["scope"]["id"], "previewId":preview["previewId"], "confirmed":true});
                        if self.reset {
                            params["resetConfirmation"] = json!(self.draft);
                        }
                        self.request("commit", params);
                    }
                }
                _ => {}
            },
            Page::Provenance => match key.code {
                KeyCode::Esc => self.page = Page::Fields,
                KeyCode::Down => self.scroll.down(),
                KeyCode::Up => self.scroll.up(),
                _ => {}
            },
        }
        false
    }

    pub fn paste(&mut self, text: &str) {
        if !self.available || self.pending.is_some() { return; }
        let field = match self.page { Page::Scope => Some(&mut self.target),
            Page::Edit => Some(&mut self.draft), Page::Filter => Some(&mut self.query), _ => None };
        if let Some(field) = field { self.cursor.paste(field, text, 4096); self.revision += 1; }
    }

    /// Consume only this view's request IDs, before foreground job routing.
    pub fn event(&mut self, event: &Value) -> bool {
        let Some((id, method)) = self.pending.as_ref() else {
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
        if event["status"] != "done" || event["resultState"] != "complete" {
            self.presentation.get_mut().clear(); self.preview = None;
            let code = event["error"]["code"].as_str().unwrap_or("ERR_TUI_OPERATION_FAILED");
            let keep_draft = self.draft_binding.is_some() && (method == "preview" || method == "commit" || method == "inspect");
            self.draft_needs_reload = keep_draft && (method == "commit" || method == "inspect"
                || code.contains("STALE") || code.contains("REVISION") || code.contains("CONFLICT"));
            self.page = if keep_draft {
                Page::Edit
            } else if self.scope.is_some() {
                Page::Fields
            } else {
                Page::Scope
            };
            self.status = format!(
                "{}: {}. Reload to inspect the actual state.",
                event["status"].as_str().unwrap_or("failed"),
                event["error"]["code"]
                    .as_str()
                    .unwrap_or("ERR_TUI_OPERATION_FAILED")
            );
            return true;
        }
        let data = &event["result"]["data"];
        if event["result"]["method"] != method {
            self.presentation.get_mut().clear(); self.preview = None;
            if self.draft_binding.is_some() {
                self.draft_needs_reload = true;
                self.page = Page::Edit;
            }
            self.status = "Mismatched settings response; reload required".into();
            return true;
        }
        match method.as_str() {
            "select" => {
                self.presentation.get_mut().clear(); self.scope = Some(data.clone());
                self.target = data["target"].as_str().unwrap_or_default().into();
                self.presentation.get_mut().clear(); self.inspection = None;
                self.presentation.get_mut().clear(); self.preview = None;
                self.draft.clear();
                self.draft_binding = None;
                self.draft_needs_reload = false;
                self.query.clear();
                self.selected = 0;
                self.page = Page::Fields;
                self.inspect();
            }
            "inspect" => {
                if self.scope.as_ref().map(|scope| &scope["id"]) == Some(&data["scope"]["id"]) {
                    self.presentation.get_mut().clear(); self.inspection = Some(data.clone());
                    self.selected = self.selected.min(self.fields().len().saturating_sub(1));
                    self.page = Page::Fields;
                    self.status = if data["validation"]["ok"] == true {
                        "Loaded canonical configuration preview; p shows provenance".into()
                    } else {
                        format!("Invalid configuration: {}", compact(&data["validation"]))
                    };
                    if let Some(binding) = self.draft_binding.as_ref() {
                        let matching = self.fields().iter().position(|field| field["path"] == binding["path"]
                            && field["editable"] == true);
                        if binding["scopeId"] == data["scope"]["id"] {
                            if let Some(index) = matching {
                                self.selected = index;
                                self.draft_binding = Some(json!({"scopeId":data["scope"]["id"],
                                    "path":binding["path"], "revision":data["revision"], "schemaRevision":data["schemaRevision"]}));
                                self.draft_needs_reload = false;
                                self.page = Page::Edit;
                                self.status = "Unsaved draft retained against reloaded scope; Enter revalidates".into();
                            } else {
                                self.draft_needs_reload = true;
                                self.page = Page::Edit;
                                self.status = "Unsaved draft retained; original field is no longer editable; Esc discards".into();
                            }
                        }
                    }
                }
            }
            "preview" => {
                if data["ok"] == true {
                    self.presentation.get_mut().clear(); self.preview = Some(data.clone());
                    self.page = Page::Preview;
                    self.scroll.reset();
                    self.status = "Validated preview; no file has been changed".into();
                } else {
                    self.presentation.get_mut().clear(); self.preview = None;
                    self.page = if self.draft_binding.is_some() { Page::Edit } else { Page::Fields };
                    self.status = format!(
                        "Invalid value; nothing saved: {}",
                        compact(&data["validation"])
                    );
                }
            }
            "commit" => {
                self.presentation.get_mut().clear(); self.preview = None;
                self.draft.clear();
                self.draft_binding = None;
                self.draft_needs_reload = false;
                self.page = Page::Fields;
                self.status = "Saved; loading the next canonical configuration invocation".into();
                self.inspect();
            }
            "cancel" => {
                self.presentation.get_mut().clear(); self.preview = None;
                self.draft.clear();
                self.draft_binding = None;
                self.draft_needs_reload = false;
                self.page = Page::Fields;
                self.status = "Preview cancelled; nothing saved".into();
            }
            _ => {}
        }
        true
    }

    pub fn lines(&self, height: usize, width: usize) -> Vec<String> {
        let scope = self
            .scope
            .as_ref()
            .map(|scope| {
                format!(
                    "{} {}",
                    scope["kind"].as_str().unwrap_or("scope"),
                    scope["target"].as_str().unwrap_or("unknown")
                )
            })
            .unwrap_or_else(|| "not selected".into());
        let mut lines = vec![
            format!("Scope: {scope}"),
            "Configuration preview; observed provider/runtime readiness requires its own operation"
                .into(),
            self.status.clone(),
        ];
        if !self.available {
            lines.push("Read only: settings are unavailable in this session. Esc closes".into());
            return lines.into_iter().take(height).map(|line| crate::fit_text(&line, width)).collect();
        }
        match self.page {
            Page::Scope => {
                lines.push(
                format!(
                    "Select {} | Tab changes kind | Enter selects | Esc cancels",
                    if self.workspace {
                        "workspace file"
                    } else {
                        "repository directory"
                    }
                ));
                return self.scroll.lines(lines, &self.cursor.visible(&self.target, width), height, width);
            }
            Page::Fields | Page::Filter => {
                lines.push(format!("Filter: {} | arrows | Enter literal | Space choice | e JSON | a item | Delete unset | r reload | R reset | Esc close", self.query));
                let fields = self.fields();
                let count = height.saturating_sub(lines.len() + 4).max(1);
                let start = self
                    .selected
                    .saturating_sub(count / 2)
                    .min(fields.len().saturating_sub(count));
                lines.extend(fields.iter().enumerate().skip(start).take(count).map(
                    |(index, field)| {
                        format!(
                            "{} {}{}",
                            if index == self.selected { ">" } else { " " },
                            field_name(field),
                            if field["editable"] == true {
                                ""
                            } else {
                                " [read only]"
                            }
                        )
                    },
                ));
                if let Some(field) = self.selected_field() {
                    lines.extend([
                        format!(
                            "Selected: {} | schema {}",
                            field_name(field),
                            compact(&field["schema"])
                        ),
                        format!(
                            "Repository override: {}",
                            if field["requestedPresent"] == true {
                                compact(&field["requested"])
                            } else {
                                "absent".into()
                            }
                        ),
                        format!(
                            "Effective: {}",
                            if field["effectiveRecorded"] == true {
                                compact(&field["effective"])
                            } else {
                                "not recorded by the canonical bounded dump".into()
                            }
                        ),
                        format!(
                            "Schema default: {}",
                            field["schema"]
                                .get("default")
                                .map(compact)
                                .unwrap_or_else(|| "not specified".into())
                        ),
                    ]);
                }
            }
            Page::Edit => {
                lines.push(format!("Edit {} | Enter previews | Esc discards | cursor/Home/End", if self.array_item { "array string item" } else if self.advanced { "advanced JSON" } else { "schema literal" }));
                let name = self.selected_field().map(field_name).unwrap_or_default();
                if let Some(field) = self.selected_field() {
                    lines.push(crate::text_editor::schema_hint(&field["schema"]));
                    if let Some(description) = field["description"].as_str() { lines.push(description.into()); }
                }
                return self.scroll.lines(lines, &format!("Field: {name}\n{}", self.cursor.visible(&self.draft, width)), height, width);
            }
            Page::Preview => {
                let preview = self.preview.as_ref().unwrap_or(&Value::Null);
                lines.push(if self.reset {
                    format!(
                        "RESET preview | type RESET then Enter | Esc cancels | confirmation: {}",
                        self.draft
                    )
                } else {
                    "CHANGE preview | Enter confirms save | Esc cancels | arrows scroll".into()
                });
                if self.reset {
                    lines.push(format!(
                        "Byte-preserving backup: {} | replaces existing backup: {}",
                        preview["backupPath"], preview["overwritesBackup"]
                    ));
                }
                return self.presentation.borrow_mut().lines(1, self.scope.as_ref(), &preview["diff"],
                    &self.scroll, lines, height, width);
            }
            Page::Provenance => {
                lines.push(
                    "Canonical config sources and resolved policy | arrows scroll | Esc returns"
                        .into(),
                );
                let empty = Value::Null;
                let effective = self.inspection.as_ref().map(|info| &info["effective"]).unwrap_or(&empty);
                return self.presentation.borrow_mut().lines(2, self.scope.as_ref(),
                    &crate::review_presentation::WithoutUserConfig(effective), &self.scroll, lines, height, width);
            }
        }
        lines.into_iter().take(height).map(|line| crate::fit_text(&line, width)).collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn selected_override_removal_previews_absence_and_requires_a_second_commit() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Delete);
        let request = ui.outbox.back().unwrap();
        assert_eq!(request["params"]["operation"], "remove");
        assert_eq!(request["params"]["path"], json!(["threads"]));
        assert!(request["params"].get("value").is_none());
        end(&mut ui, json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"remove-plan",
            "diff":[{"before":2,"beforePresent":true,"afterPresent":false}]}));
        assert!(ui.page == Page::Preview);
        assert!(!ui.outbox.iter().any(|request| request["method"] == "commit"));
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.back().unwrap()["method"], "commit");
        assert_eq!(ui.outbox.back().unwrap()["params"]["previewId"], "remove-plan");
    }

    #[test]
    fn literal_string_paste_stays_inert_until_explicit_preview() {
        let mut ui = selected();
        let field = &mut ui.inspection.as_mut().unwrap()["fields"][0];
        field["schema"] = json!({"type":"string"}); field["requested"] = json!("before");
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.draft, "before");
        ui.key(KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL));
        ui.paste("false\n\u{1b}\u{3}");
        assert_eq!(ui.draft, "false "); assert!(ui.outbox.is_empty());
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.back().unwrap()["params"]["value"], json!("false "));
        assert_eq!(ui.outbox.back().unwrap()["method"], "preview");
    }

    #[test]
    fn rendered_settings_keep_confirmation_visible_and_scroll_wrapped_json() {
        use crate::overlay_viewport::render_test_rows;
        for (width, height) in [(80u16, 24u16), (90, 18)] {
            let mut ui = selected();
            ui.scope = Some(json!({"id":"scope-1","kind":"repo","target":format!("FIRST/{}", "directory/".repeat(200))}));
            ui.page = Page::Preview; ui.reset = true; ui.draft = "RESET".into();
            ui.preview = Some(json!({"diff":{"first":"START","long":"界😀 ".repeat(500),"zz_end":"LAST"}}));
            let screen = render_test_rows(ui.lines((height - 2) as usize, (width - 2) as usize), width, height);
            assert!(screen.contains("confirmation: RESET"));
            assert!(screen.contains("FIRST"));
            for _ in 0..10000 { key(&mut ui, KeyCode::Down); }
            assert!(render_test_rows(ui.lines((height - 2) as usize, (width - 2) as usize), width, height).contains("LAST"));
            for _ in 0..10000 { key(&mut ui, KeyCode::Up); }
            assert!(render_test_rows(ui.lines((height - 2) as usize, (width - 2) as usize), width, height).contains("FIRST"));
        }
    }

    fn key(ui: &mut SettingsUi, code: KeyCode) -> bool {
        ui.key(KeyEvent::new(code, KeyModifiers::NONE))
    }
    fn end(ui: &mut SettingsUi, data: Value) {
        let (id, method) = ui.pending.clone().unwrap();
        assert!(
            ui.event(&json!({"event":"job:end", "jobId":id, "status":"done",
            "resultState":"complete", "result":{"method":method,"data":data}}))
        );
    }
    fn selected() -> SettingsUi {
        let mut ui = SettingsUi {
            available: true,
            ..SettingsUi::default()
        };
        ui.open("fixture");
        key(&mut ui, KeyCode::Enter);
        end(
            &mut ui,
            json!({"id":"scope-1","kind":"repo","target":"fixture"}),
        );
        end(
            &mut ui,
            json!({"scope":{"id":"scope-1"}, "revision":"revision-1", "schemaRevision":"schema-1",
            "validation":{"ok":true}, "fields":[{"path":["threads"],"schema":{"type":"integer"},
            "editable":true,"requestedPresent":true,"requested":2,"effectiveRecorded":true,"effective":2},
            {"path":["tooling","lsp","servers"],"editable":false,"requested":{"redacted":true},
            "readOnlyReason":"Use a private editor"}]}),
        );
        ui.outbox.clear();
        ui
    }

    #[test]
    fn selection_binds_requests_and_ignores_unrelated_and_old_responses() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Char('r'));
        assert_eq!(ui.outbox.back().unwrap()["params"]["scopeId"], "scope-1");
        assert!(!ui.event(&json!({"event":"job:end","jobId":"other-job"})));
        assert!(!ui.event(&json!({"event":"job:end","jobId":"native-settings-1"})));
        assert!(ui.pending.is_some());
        assert_eq!(ui.scope.as_ref().unwrap()["id"], "scope-1");
    }

    #[test]
    fn private_fields_cannot_open_an_editor() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Down);
        key(&mut ui, KeyCode::Enter);
        assert!(ui.page == Page::Fields);
        assert_eq!(ui.status, "Use a private editor");
        assert!(ui.draft.is_empty());
        assert!(ui.outbox.is_empty());
    }

    #[test]
    fn invalid_json_and_discard_never_send_a_write() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Enter);
        ui.draft = "invalid".into();
        key(&mut ui, KeyCode::Enter);
        assert!(ui.outbox.is_empty());
        assert!(ui.status.contains("Invalid JSON"));
        key(&mut ui, KeyCode::Esc);
        assert!(ui.draft.is_empty());
        assert!(ui.page == Page::Fields);
    }

    #[test]
    fn schema_rejection_and_transient_failure_retain_correctable_private_draft() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Enter);
        ui.draft = "\"wrong-enum\"".into();
        key(&mut ui, KeyCode::Enter);
        end(&mut ui, json!({"ok":false,"validation":{"ok":false,"errors":["expected integer"]}}));
        assert!(ui.page == Page::Edit);
        assert_eq!(ui.draft, "\"wrong-enum\"");
        assert!(ui.preview.is_none());
        ui.draft = "3".into();
        key(&mut ui, KeyCode::Enter);
        let id = ui.pending.as_ref().unwrap().0.clone();
        ui.event(&json!({"event":"job:end","jobId":id,"status":"failed","error":{"code":"ERR_TEMPORARY"}}));
        assert!(ui.page == Page::Edit);
        assert_eq!(ui.draft, "3");
        key(&mut ui, KeyCode::Enter);
        end(&mut ui, json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"corrected","diff":[]}));
        key(&mut ui, KeyCode::Enter);
        end(&mut ui, json!({"saved":true}));
        assert!(ui.draft.is_empty());
        assert!(ui.draft_binding.is_none());
    }

    #[test]
    fn atomic_retrieval_editor_preserves_correctable_object_draft_and_never_copies_effective_defaults() {
        let mut ui = selected();
        ui.inspection.as_mut().unwrap()["fields"][0] = json!({"path":["retrieval"],"editable":true,
            "schema":{"type":"object","properties":{"annCandidateCap":{"type":"number"}}},
            "editScope":"repository-object","requestedPresent":false,"effectiveRecorded":true,
            "effective":{"unrequestedEffectiveValue":"MUST-NOT-BECOME-AN-OVERRIDE"},
            "description":"Edit repository retrieval overrides together"});
        key(&mut ui, KeyCode::Char('e'));
        assert_eq!(ui.draft, "{}");
        ui.draft = "{\"annCandidateCap\":\"wrong\",\"annCandidateMinDocCount\":100}".into();
        key(&mut ui, KeyCode::Enter);
        let submitted = ui.outbox.back().unwrap();
        assert_eq!(submitted["params"]["path"], json!(["retrieval"]));
        assert_eq!(submitted["params"]["value"]["annCandidateMinDocCount"], 100);
        end(&mut ui, json!({"ok":false,"validation":{"ok":false,"errors":["annCandidateCap must be a number"]}}));
        assert!(ui.page == Page::Edit && ui.preview.is_none());
        assert!(ui.draft.contains("annCandidateMinDocCount"));
        assert!(!ui.outbox.iter().any(|request| request["method"] == "commit"));
        ui.draft = ui.draft.replace("\"wrong\"", "1000");
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.back().unwrap()["params"]["value"]["annCandidateCap"], 1000);
        end(&mut ui, json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"valid-object", "diff":[]}));
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.back().unwrap()["params"]["previewId"], "valid-object");
        end(&mut ui, json!({"saved":true}));
        assert!(ui.draft.is_empty() && ui.draft_binding.is_none());
    }

    #[test]
    fn stale_edit_requires_reload_and_new_preview_without_losing_input() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Enter);
        ui.draft = "4".into();
        key(&mut ui, KeyCode::Enter);
        let id = ui.pending.as_ref().unwrap().0.clone();
        ui.event(&json!({"event":"job:end","jobId":id,"status":"failed","error":{"code":"ERR_SETTINGS_STALE_REVISION"}}));
        assert_eq!(ui.draft, "4");
        assert!(ui.draft_needs_reload && ui.preview.is_none());
        let count = ui.outbox.len();
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.len(), count, "stale drafts cannot acquire write authority");
        ui.key(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL));
        end(&mut ui, json!({"scope":{"id":"scope-1"},"revision":"revision-2","schemaRevision":"schema-2",
            "validation":{"ok":true},"fields":[{"path":["threads"],"editable":true,"requestedPresent":true,"requested":2}]}));
        assert!(ui.page == Page::Edit && !ui.draft_needs_reload);
        assert_eq!(ui.draft, "4");
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.back().unwrap()["params"]["revision"], "revision-2");
        assert_eq!(ui.outbox.back().unwrap()["params"]["schemaRevision"], "schema-2");
        end(&mut ui, json!({"ok":false,"validation":{"ok":false}}));
        key(&mut ui, KeyCode::Esc);
        assert!(ui.draft.is_empty() && ui.draft_binding.is_none());
    }

    #[test]
    fn edit_preview_and_explicit_save_keep_source_and_schema_revisions() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Enter);
        ui.draft = "1".into();
        key(&mut ui, KeyCode::Enter);
        let request = ui.outbox.back().unwrap();
        assert_eq!(request["method"], "preview");
        assert_eq!(request["params"]["revision"], "revision-1");
        assert_eq!(request["params"]["schemaRevision"], "schema-1");
        assert_eq!(request["params"]["path"], json!(["threads"]));
        assert_eq!(request["params"]["value"], 1);
        end(
            &mut ui,
            json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"preview-1","diff":[]}),
        );
        assert!(ui.page == Page::Preview);
        key(&mut ui, KeyCode::Enter);
        let request = ui.outbox.back().unwrap();
        assert_eq!(request["method"], "commit");
        assert_eq!(request["params"]["confirmed"], true);
        assert_eq!(request["params"]["previewId"], "preview-1");
        end(&mut ui, json!({"saved":true}));
        assert_eq!(ui.outbox.back().unwrap()["method"], "inspect");
    }

    #[test]
    fn reset_requires_literal_confirmation_and_preview_cancel_uses_its_nonce() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Char('R'));
        end(
            &mut ui,
            json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"reset-1","diff":[]}),
        );
        let count = ui.outbox.len();
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.len(), count);
        ui.draft = "reset".into();
        key(&mut ui, KeyCode::Enter);
        assert_eq!(ui.outbox.len(), count);
        ui.draft = "RESET".into();
        key(&mut ui, KeyCode::Enter);
        assert_eq!(
            ui.outbox.back().unwrap()["params"]["resetConfirmation"],
            "RESET"
        );
        end(&mut ui, json!({"saved":true}));
        end(
            &mut ui,
            json!({"scope":{"id":"scope-1"},"validation":{"ok":true},"fields":[]}),
        );
        key(&mut ui, KeyCode::Char('R'));
        end(
            &mut ui,
            json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"cancel-1","diff":[]}),
        );
        key(&mut ui, KeyCode::Esc);
        assert_eq!(ui.outbox.back().unwrap()["method"], "cancel");
        assert_eq!(ui.outbox.back().unwrap()["params"]["previewId"], "cancel-1");
    }

    #[test]
    fn cancellation_waits_for_real_outcome_and_read_only_sessions_never_execute() {
        let mut ui = selected();
        key(&mut ui, KeyCode::Char('r'));
        let id = ui.pending.as_ref().unwrap().0.clone();
        assert!(!key(&mut ui, KeyCode::Esc));
        assert_eq!(ui.outbox.back().unwrap()["op"], "job:cancel");
        assert_eq!(ui.outbox.back().unwrap()["jobId"], id);
        assert!(ui.pending.is_some());
        assert!(ui.event(
            &json!({"event":"job:end","jobId":id,"status":"cancelled","error":{"code":"ABORT_ERR"}})
        ));
        assert!(ui.pending.is_none());
        assert!(ui.status.contains("cancelled"));
        ui.available = false;
        ui.outbox.clear();
        key(&mut ui, KeyCode::Enter);
        assert!(ui.outbox.is_empty());
        assert!(key(&mut ui, KeyCode::Esc));
    }
    #[test]
    fn accepted_preview_and_provenance_reuse_text_until_their_owner_changes() {
        let mut ui = selected();
        ui.request("preview", json!({}));
        end(&mut ui, json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"first",
            "diff":[{"value":"FIRST-DIFF"}]}));
        assert!(ui.lines(24, 80).join("\n").contains("FIRST-DIFF"));
        let builds = ui.presentation.borrow().builds;
        for _ in 0..20 { key(&mut ui, KeyCode::Down); ui.lines(24, 80); }
        ui.status = "unrelated live redraw".into(); ui.lines(24, 80); ui.lines(24, 90);
        assert_eq!(ui.presentation.borrow().builds, builds);
        assert!(!ui.event(&json!({"event":"job:end","jobId":"unrelated","status":"done"})));
        key(&mut ui, KeyCode::Esc); end(&mut ui, json!({}));
        assert!(ui.preview.is_none());
        ui.request("preview", json!({}));
        end(&mut ui, json!({"ok":true,"scope":{"id":"scope-1"},"previewId":"second",
            "diff":[{"value":"SECOND-DIFF"}]}));
        let second = ui.lines(24, 80).join("\n");
        assert!(second.contains("SECOND-DIFF")); assert!(!second.contains("FIRST-DIFF"));
        assert_eq!(ui.presentation.borrow().builds, builds + 1);
        key(&mut ui, KeyCode::Esc); end(&mut ui, json!({}));
        ui.inspect();
        end(&mut ui, json!({"scope":{"id":"scope-1"},"revision":"fresh","schemaRevision":"schema-1",
            "fields":[],"effective":{"sources":["PUBLIC-SOURCE"],"userConfig":{"secret":"PRIVATE-CONFIG"}}}));
        key(&mut ui, KeyCode::Char('p'));
        let provenance = ui.lines(24, 80).join("\n");
        assert!(provenance.contains("PUBLIC-SOURCE")); assert!(!provenance.contains("PRIVATE-CONFIG"));
        assert_eq!(ui.inspection.as_ref().unwrap()["effective"]["userConfig"]["secret"], "PRIVATE-CONFIG");
        let builds = ui.presentation.borrow().builds;
        for _ in 0..20 { key(&mut ui, KeyCode::Down); ui.lines(24, 80); }
        assert_eq!(ui.presentation.borrow().builds, builds);
    }

}
