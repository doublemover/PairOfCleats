use super::*;
use crossterm::event::{MouseButton, MouseEvent, MouseEventKind};
use ratatui::layout::Rect;

#[derive(Default)]
pub(super) struct HitMap {
    panes: Vec<(FocusPanel, Rect)>,
    jobs: Vec<(Rect, String)>,
    revision: u64,
    area: Rect,
    signature: String,
    overlay: Option<Rect>,
    palette: Vec<(Rect, PaletteAction)>,
}

#[derive(Clone)]
pub(super) struct MouseInput {
    panel: FocusPanel,
    job: Option<String>,
    revision: u64,
    wheel: i8,
    rows: usize,
    signature: String,
    area: Rect,
    overlay: OverlayMode,
    row: Option<usize>,
    action: Option<PaletteAction>,
}

pub(super) enum RecordingMouse {
    Key(KeyEvent),
    Row(usize),
}

pub(super) fn overlay_rect(mode: OverlayMode, area: Rect) -> Rect {
    let (width, height) = match mode {
        OverlayMode::Palette => (68, 60),
        OverlayMode::Search => (90, 44),
        OverlayMode::Settings => (94, 92),
        _ => (96, 94),
    };
    let rect = centered_rect(width, height, area);
    if (mode == OverlayMode::Help && (rect.width < 24 || rect.height < 5))
        || (mode == OverlayMode::Palette && (rect.width < 24 || rect.height < 6))
    {
        area
    } else {
        rect
    }
}

pub(super) fn record_geometry(model: &AppModel, area: Rect) {
    let panes = if area.height < 7 || area.width < 20 {
        Vec::new()
    } else if compact(model, area) {
        vec![(model.focus_panel, compact_body(area))]
    } else {
        let body = Rect::new(
            area.x,
            area.y + 16,
            area.width,
            area.height.saturating_sub(16),
        );
        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(28),
                Constraint::Percentage(28),
                Constraint::Percentage(44),
            ])
            .split(body);
        vec![
            (FocusPanel::Jobs, cols[0]),
            (FocusPanel::Tasks, cols[1]),
            (FocusPanel::Logs, cols[2]),
        ]
    };
    *model.hit_map.borrow_mut() = HitMap {
        panes,
        jobs: vec![],
        revision: model.content_revision,
        area,
        signature: frame_signature(model),
        overlay: if model.overlay == OverlayMode::None {
            None
        } else {
            Some(overlay_rect(model.overlay, area))
        },
        palette: vec![],
    };
}

pub(super) fn record_palette(model: &AppModel, rows: Vec<(Rect, PaletteAction)>) {
    model.hit_map.borrow_mut().palette = rows;
}

pub(super) fn finish_geometry(model: &AppModel) {
    let signature = frame_signature(model);
    model.hit_map.borrow_mut().signature = signature;
}

pub(super) fn record_jobs(model: &AppModel, area: Rect) {
    let height = area.height.saturating_sub(2) as usize;
    if height == 0 || area.width <= 2 {
        return;
    }
    let ids = visible_job_ids(model);
    let start = model.job_scroll.min(ids.len().saturating_sub(height));
    model.hit_map.borrow_mut().jobs = ids
        .into_iter()
        .skip(start)
        .take(height)
        .enumerate()
        .map(|(row, id)| {
            (
                Rect::new(area.x + 1, area.y + 1 + row as u16, area.width - 2, 1),
                id.to_owned(),
            )
        })
        .collect();
}

pub(super) fn mouse(model: &mut AppModel, event: MouseEvent) {
    if !model.terminal_caps.mouse {
        return;
    }
    let wheel = match event.kind {
        MouseEventKind::ScrollUp => 1,
        MouseEventKind::ScrollDown => -1,
        MouseEventKind::Down(MouseButton::Left) => 0,
        _ => return,
    };
    let hit = {
        let map = model.hit_map.borrow();
        if map.signature != frame_signature(model) {
            return;
        }
        let position = ratatui::layout::Position::new(event.column, event.row);
        if let Some(overlay) = map.overlay {
            if event.column <= overlay.x
                || event.column.saturating_add(1) >= overlay.right()
                || event.row <= overlay.y
                || event.row.saturating_add(1) >= overlay.bottom()
            {
                return;
            }
            Some(MouseInput {
                panel: model.focus_panel,
                job: None,
                revision: map.revision,
                wheel,
                rows: overlay.height.saturating_sub(2) as usize,
                signature: map.signature.clone(),
                overlay: model.overlay,
                area: map.area,
                row: Some((event.row - overlay.y - 1) as usize),
                action: map
                    .palette
                    .iter()
                    .find(|(rect, _)| rect.contains(position))
                    .map(|(_, action)| *action),
            })
        } else {
            map.panes
                .iter()
                .find(|(_, rect)| rect.contains(position))
                .map(|(panel, rect)| MouseInput {
                    panel: *panel,
                    revision: map.revision,
                    wheel,
                    rows: rect.height.saturating_sub(2) as usize,
                    job: if wheel == 0 {
                        map.jobs
                            .iter()
                            .find(|(rect, _)| rect.contains(position))
                            .map(|(_, id)| id.clone())
                    } else {
                        None
                    },
                    signature: map.signature.clone(),
                    area: map.area,
                    overlay: OverlayMode::None,
                    row: None,
                    action: None,
                })
        }
    };
    if let Some(hit) = hit {
        enqueue_input(model, InputCommand::Mouse(hit), "mouse");
    }
}

pub(super) fn apply_mouse(model: &mut AppModel, input: MouseInput) -> Option<RecordingMouse> {
    if !model.terminal_caps.mouse {
        return None;
    }
    if model.overlay != input.overlay || frame_signature(model) != input.signature {
        return None;
    }
    let stale_hit_map = {
        let map = model.hit_map.borrow();
        map.area != input.area || map.signature != input.signature
    };
    if stale_hit_map {
        return None;
    }
    if model.overlay != OverlayMode::None {
        if input.wheel == 0 {
            if let Some(row) = input.row {
                match model.overlay {
                    OverlayMode::RepositorySearch => model.repository_search.click(row),
                    OverlayMode::Settings => model.settings.click(row),
                    OverlayMode::IndexWorkflows => model.index_workflows.click(row),
                    OverlayMode::JobInspection => model.job_inspection.click(row),
                    OverlayMode::Recordings => return Some(RecordingMouse::Row(row)),
                    OverlayMode::Palette => {
                        if let Some(action) = input.action {
                            if let Some(index) = actions(model)
                                .iter()
                                .position(|candidate| *candidate == action)
                            {
                                model.palette_index = index;
                            }
                        }
                    }
                    _ => {}
                }
            }
        } else {
            let key = KeyEvent::from(if input.wheel > 0 {
                KeyCode::Up
            } else {
                KeyCode::Down
            });
            match model.overlay {
                OverlayMode::RepositorySearch => {
                    model.repository_search.key(key);
                }
                OverlayMode::Settings => {
                    model.settings.key(key);
                }
                OverlayMode::IndexWorkflows => {
                    model.index_workflows.key(key);
                }
                OverlayMode::JobInspection => {
                    model.job_inspection.key(key);
                }
                OverlayMode::Help => help_key(model, key),
                OverlayMode::Palette => move_palette(model, if input.wheel > 0 { -1 } else { 1 }),
                OverlayMode::Recordings => return Some(RecordingMouse::Key(key)),
                _ => {}
            }
        }
        model.dirty = true;
        return None;
    }
    if input.wheel == 0 {
        model.focus_panel = input.panel;
        if let Some(id) = input.job {
            if input.revision == model.content_revision
                && visible_job_ids(model).contains(&id.as_str())
            {
                pin_visible_job(model, &id);
            }
        }
    } else {
        let action = match (input.panel, input.wheel > 0) {
            (FocusPanel::Jobs, true) => "jobs_up",
            (FocusPanel::Jobs, false) => "jobs_down",
            (FocusPanel::Tasks, true) => "tasks_up",
            (FocusPanel::Tasks, false) => "tasks_down",
            (FocusPanel::Logs, true) => "logs_up",
            (FocusPanel::Logs, false) => "logs_down",
        };
        apply_local_input(model, action);
        match input.panel {
            FocusPanel::Jobs => {
                model.job_scroll = model
                    .job_scroll
                    .min(visible_job_ids(model).len().saturating_sub(input.rows))
            }
            FocusPanel::Tasks => {
                model.task_scroll = model
                    .task_scroll
                    .min(visible_task_keys(model).len().saturating_sub(input.rows))
            }
            FocusPanel::Logs => {
                let width = model
                    .hit_map
                    .borrow()
                    .panes
                    .iter()
                    .find(|(panel, _)| *panel == FocusPanel::Logs)
                    .map(|(_, rect)| rect.width.saturating_sub(2) as usize)
                    .unwrap_or(0);
                let _ = build_log_lines(model, width, input.rows);
            }
        }
    }
    model.dirty = true;
    None
}

pub(super) fn compact(model: &AppModel, area: Rect) -> bool {
    model.maximized || area.width < 100 || area.height < 32
}

pub(super) fn compact_body(area: Rect) -> Rect {
    Rect::new(
        area.x,
        area.y.saturating_add(2),
        area.width,
        area.height.saturating_sub(4),
    )
}

pub(super) fn activity_text(model: &AppModel) -> String {
    if model.selected_job_expired {
        return "Selected job instance expired; reselect a visible job".into();
    }
    let task = model
        .task_order
        .iter()
        .filter_map(|key| {
            if model
                .task_identity
                .get(key)
                .map(|(job, _)| Some(job) == model.selected_job.as_ref())
                .unwrap_or(false)
            {
                model.task_status.get(key)
            } else {
                None
            }
        })
        .max_by_key(|task| {
            (
                task.lifecycle() == Lifecycle::Active,
                task.ended_ms.or(task.last_event_ms),
            )
        });
    let activity = task
        .map(|task| {
            task.activity(
                if model.session.mode == "replay" {
                    model.recorded_ms.unwrap_or(0)
                } else {
                    model.activity_second * 1000
                },
                model.session.mode == "replay",
            )
        })
        .unwrap_or_else(|| runtime_summary_text(model, 160));
    if model
        .selected_job
        .as_ref()
        .and_then(|id| model.job_status.get(id))
        .is_some_and(|status| status == "cancelling")
    {
        format!("cancel requested | {activity}")
    } else {
        activity
    }
}

pub(super) fn activity_tick(model: &mut AppModel) {
    let elapsed = model
        .activity_origin
        .elapsed()
        .as_millis()
        .min(u64::MAX as u128) as u64;
    activity_tick_at(model, elapsed);
}

pub(super) fn activity_tick_at(model: &mut AppModel, elapsed_ms: u64) {
    if model.overlay != OverlayMode::None
        || model.session.mode == "replay"
        || !model.owns_control_channel
    {
        return;
    }
    if model.selected_job_expired {
        return;
    }
    if !model
        .selected_job
        .as_ref()
        .and_then(|id| model.job_status.get(id))
        .is_some_and(|status| Lifecycle::from_status(status) == Lifecycle::Active)
    {
        return;
    }
    let second = elapsed_ms / 1000;
    if second != model.activity_second {
        model.activity_second = second;
        model.dirty = true;
    }
}

pub(super) fn render_compact(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let area = frame.area();
    if area.height < 7 || area.width < 20 {
        frame.render_widget(
            Paragraph::new("Resize terminal (minimum 20x7).\nCtrl+C quits; ? help"),
            area,
        );
        return;
    }
    let header = format!(
        "{} | {} | scope {}\n{} | {} | job {} | Tab panes",
        model.session.mode,
        model.session.connection,
        model.session.scope,
        model.focus_panel.label(),
        if model.selected_job_expired {
            "EXPIRED selection"
        } else {
            model
                .selected_job
                .as_ref()
                .and_then(|id| model.job_status.get(id))
                .map(String::as_str)
                .unwrap_or("no selection")
        },
        model.selected_job.as_deref().unwrap_or("none")
    );
    frame.render_widget(
        Paragraph::new(header),
        Rect::new(area.x, area.y, area.width, 2),
    );
    let body = compact_body(area);
    let width = body.width.saturating_sub(2) as usize;
    let height = body.height.saturating_sub(2) as usize;
    match model.focus_panel {
        FocusPanel::Jobs => render_job_panel(frame, model, body),
        FocusPanel::Tasks => frame.render_widget(
            List::new(build_task_rows(model, width, height)).block(panel_block(
                "> Tasks | Tab changes pane".into(),
                true,
                model.terminal_caps.color,
            )),
            body,
        ),
        FocusPanel::Logs => frame.render_widget(
            Paragraph::new(build_log_lines(model, width, height)).block(panel_block(
                "> Logs | p follow/pause".into(),
                true,
                model.terminal_caps.color,
            )),
            body,
        ),
    }
    frame.render_widget(
        Paragraph::new(format!(
            "{}\n{}",
            footer_hint_text(model, area.width as usize),
            activity_text(model)
        )),
        Rect::new(area.x, area.bottom().saturating_sub(2), area.width, 2),
    );
}

pub(super) fn paste(model: &mut AppModel, text: &str) {
    match model.overlay {
        OverlayMode::RepositorySearch => model.repository_search.paste(text),
        OverlayMode::Settings => model.settings.paste(text),
        OverlayMode::IndexWorkflows => model.index_workflows.paste(text),
        OverlayMode::Search => {
            model
                .panel_cursor
                .paste(&mut model.search_draft, text, 4096);
        }
        OverlayMode::Palette => {
            edit_palette(model, |cursor, query| cursor.paste(query, text, 256));
        }
        OverlayMode::Help if model.help_editing => {
            model.panel_cursor.paste(&mut model.help_query, text, 256);
            model.help_viewport.reset();
            model.help_revision += 1;
        }
        _ => return,
    }
    model.dirty = true;
}

pub(super) fn action_shortcut(action: PaletteAction) -> &'static str {
    actions::shortcut(action)
}

pub(super) fn bound_input(key: KeyEvent) -> Option<InputCommand> {
    actions::bound_input(key)
}

pub(super) fn input_disabled(model: &AppModel, input: &InputCommand) -> Option<&'static str> {
    let action = match input {
        InputCommand::Settings => PaletteAction::Settings,
        InputCommand::RepositorySearch => PaletteAction::RepositorySearch,
        InputCommand::IndexWorkflows => PaletteAction::IndexWorkflows,
        InputCommand::InspectJob => PaletteAction::InspectJob,
        InputCommand::CancelSelected => PaletteAction::CancelSelected,
        InputCommand::RunJob => PaletteAction::RunJob,
        _ => return None,
    };
    disabled(model, action)
}

pub(super) fn edit_palette(
    model: &mut AppModel,
    edit: impl FnOnce(&mut text_editor::TextCursor, &mut String) -> bool,
) {
    let selected = actions(model).get(model.palette_index).copied();
    if !edit(&mut model.panel_cursor, &mut model.palette_query) {
        return;
    }
    model.palette_index = selected
        .and_then(|selected| actions(model).iter().position(|action| *action == selected))
        .unwrap_or(usize::MAX);
    model.dirty = true;
}

pub(super) fn move_palette(model: &mut AppModel, direction: i8) {
    let count = actions(model).len();
    model.palette_index = if count == 0 {
        usize::MAX
    } else if model.palette_index >= count {
        if direction > 0 {
            0
        } else {
            count - 1
        }
    } else if direction > 0 {
        (model.palette_index + 1) % count
    } else {
        (model.palette_index + count - 1) % count
    };
    model.dirty = true;
}

pub(super) fn disabled(model: &AppModel, action: PaletteAction) -> Option<&'static str> {
    match action {
        PaletteAction::RunJob
        | PaletteAction::Settings
        | PaletteAction::RepositorySearch
        | PaletteAction::IndexWorkflows
            if !model.owns_control_channel || !model.session.controllable =>
        {
            Some("requires live owned control")
        }
        PaletteAction::CancelSelected if !selected_job_cancelable(model) => {
            Some("requires a visible running owned job")
        }
        PaletteAction::InspectJob if model.selected_job.is_none() || model.selected_job_expired => {
            Some("requires a retained selected job")
        }
        _ => None,
    }
}

pub(super) fn actions(model: &AppModel) -> Vec<PaletteAction> {
    let query = model.palette_query.to_lowercase();
    palette_actions()
        .into_iter()
        .filter(|action| {
            format!("{} {}", action.label(), action_shortcut(*action))
                .to_lowercase()
                .contains(&query)
        })
        .collect()
}

pub(super) fn help_text(model: &AppModel) -> String {
    let context = match model.help_origin.unwrap_or(OverlayMode::None) {
        OverlayMode::Settings => "Settings: Enter literal; Space choice; e advanced JSON; a string-array item; Delete unset; Esc cancel/back.",
        OverlayMode::IndexWorkflows => "Command workflows: arrows select; Enter form; p preview; Enter confirm; X experimental; t owned health/publication status; c owned job cancel; n semantic next; Esc disposes continuation/back.",
        OverlayMode::RepositorySearch => "Repository search: Tab fields; mode/backend arrows; Enter search/source; d diagnostics; o open preview; Esc back.",
        OverlayMode::JobInspection => "Inspection: 1/2/3 pages; arrows/page keys scroll; o open; y copy; e export; Esc back.",
        OverlayMode::Recordings => "Saved sessions: select directory/log; Enter load; Space replay; arrows step; Home/End seek; Esc detach.",
        OverlayMode::Palette => "Action palette: type filter; arrows select; Enter chooses only the visible action; Esc close.",
        OverlayMode::Search => "Panel text filter: edit literal text; Enter applies; Esc discards; repository search is R.",
        _ => "Main panes: Tab/1/2/3 focus; z maximize; / panel text; b command catalog; R repository search.",
    };
    let mut rows = vec![format!("Context: {context}"),
        "F1 opens contextual help from every overlay and returns to the retained form. Esc closes help.".into(),
        "Global Ctrl+C: graceful shutdown from every overlay. Plain c: selected-job cancel.".into(),
        "Tab: switch Jobs / Tasks / Logs. z: maximize focused pane / restore automatic layout.".into(),
        "[: previous visible job; ]: next visible job. Selection pins exact identity; g follows latest.".into(),
        "Up/Down: selected job. n/m: Jobs viewport; u/i: Tasks; j/k: older/newer Logs.".into(),
        "/: panel text filter. R: repository search (different operation).".into(),
        "Repository search: Tab fields; Enter search/source; d diagnostics; o preview open; Esc back.".into(),
        "Forms: Left/Right/Home/End cursor; Backspace/Delete grapheme; Ctrl+U clear. Paste is inert data.".into(),
        "Settings: Delete unsets one override; R previews full reset. Enter confirms only after review.".into(),
        "Workflows: Delete unsets draft field; p previews; Enter explicitly launches; c cancels owned job; X enables experimental catalog.".into(),
        "Saved sessions: O picker; replay is passive. Space play/pause; arrows step; Esc detach.".into(),
        "Job inspection: 1 summary, 2 result, 3 artifacts; arrows/page keys scroll; o/y/e actions.".into(),
        "Palette: type to filter; arrows select; Enter runs selected visible action; Esc close.".into()];
    rows.extend(actions::help_rows());
    rows.extend(palette_actions().into_iter().map(|action| {
        format!(
            "{}: {}{}",
            action_shortcut(action),
            action.label(),
            disabled(model, action)
                .map(|reason| format!(" [disabled: {reason}]"))
                .unwrap_or_default()
        )
    }));
    let query = model.help_query.to_lowercase();
    rows.into_iter()
        .filter(|row| row.to_lowercase().contains(&query))
        .collect::<Vec<_>>()
        .join("\n")
}

pub(super) fn context_help(model: &mut AppModel) {
    if model.overlay == OverlayMode::Help {
        model.overlay = model.help_origin.take().unwrap_or(OverlayMode::None);
    } else {
        model.help_origin = Some(model.overlay);
        model.overlay = OverlayMode::Help;
        model.help_viewport.reset();
        model.help_query.clear();
        model.help_editing = false;
    }
    model.help_revision += 1;
    model.dirty = true;
}

pub(super) fn help_key(model: &mut AppModel, key: KeyEvent) {
    if model.help_editing {
        match key.code {
            KeyCode::Enter => model.help_editing = false,
            KeyCode::Esc => {
                model.help_editing = false;
                model.help_query.clear();
            }
            _ => {
                model.panel_cursor.key(&mut model.help_query, key, 256);
            }
        }
        model.help_viewport.reset();
        model.help_revision += 1;
        model.dirty = true;
        return;
    }
    match key.code {
        KeyCode::Char('/') => {
            model.help_editing = true;
            model.panel_cursor.reset();
        }
        KeyCode::Esc | KeyCode::Char('?') => {
            model.overlay = model.help_origin.take().unwrap_or(OverlayMode::None)
        }
        KeyCode::Down | KeyCode::Char('j') => model.help_viewport.down(),
        KeyCode::Up | KeyCode::Char('k') => model.help_viewport.up(),
        KeyCode::PageDown => {
            for _ in 0..10 {
                model.help_viewport.down();
            }
        }
        KeyCode::PageUp => {
            for _ in 0..10 {
                model.help_viewport.up();
            }
        }
        KeyCode::Home => model.help_viewport.reset(),
        KeyCode::End => model.help_viewport.tail(),
        _ => return,
    }
    model.help_revision += 1;
    model.dirty = true;
}

#[cfg(test)]
mod tests {
    use super::*;
    fn model() -> AppModel {
        AppModel::new(
            "interaction-fixture".into(),
            TerminalCapabilities {
                color: false,
                unicode: false,
                mouse: true,
                alt_screen: false,
            },
            None,
        )
    }
    fn screen(model: &AppModel, width: u16, height: u16) -> String {
        let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
        terminal.draw(|frame| render_ui(frame, model)).unwrap();
        let mut result = String::new();
        for y in 0..height {
            for x in 0..width {
                result.push_str(terminal.backend().buffer()[(x, y)].symbol());
            }
            result.push('\n');
        }
        result
    }
    #[test]
    fn compact_layout_keeps_work_rows_and_selection_across_breakpoints() {
        let mut model = model();
        for i in 0..20 {
            model.update_job_status(&format!("owned-{i}"), "running", None);
        }
        let selected = model.selected_job.clone();
        for (width, height) in [(120, 40), (100, 24), (99, 24), (80, 24), (60, 18)] {
            let text = screen(&model, width, height);
            if width < 100 || height < 32 {
                assert!(text.matches("owned-").count() >= 8);
            }
            assert_eq!(model.selected_job, selected);
        }
        assert!(screen(&model, 18, 5).contains("Resize terminal"));
    }
    #[test]
    fn help_reaches_tail_and_palette_filters_without_stale_action() {
        let mut model = model();
        model.overlay = OverlayMode::Help;
        for (width, height) in [(80, 24), (60, 18)] {
            screen(&model, width, height);
            help_key(&mut model, KeyCode::End.into());
            let text = screen(&model, width, height);
            assert!(text.contains("Quit TUI"));
            assert!(text.contains("Esc"));
        }
        model.palette_query = "saved session".into();
        assert_eq!(actions(&model).len(), 1);
        assert!(matches!(actions(&model)[0], PaletteAction::Recordings));
        model.palette_query = "no such command".into();
        assert!(actions(&model).is_empty());
    }
    #[test]
    fn captured_click_pins_rendered_job_and_modal_click_never_confirms() {
        let mut model = model();
        model.update_job_status("exact-rendered-job", "running", None);
        screen(&model, 80, 24);
        mouse(
            &mut model,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 4,
                row: 3,
                modifiers: KeyModifiers::NONE,
            },
        );
        let (_, InputCommand::Mouse(input)) = model.input_queue.pop_front().unwrap() else {
            panic!("expected exact hit");
        };
        apply_mouse(&mut model, input);
        assert_eq!(model.selected_job.as_deref(), Some("exact-rendered-job"));
        assert!(model.selected_job_pinned);
        model.overlay = OverlayMode::Settings;
        mouse(
            &mut model,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: 4,
                row: 3,
                modifiers: KeyModifiers::NONE,
            },
        );
        assert!(model.input_queue.is_empty());
        assert!(model.settings.outbox.is_empty());
    }
    #[test]
    fn measured_activity_never_invents_a_total_or_ages_replay() {
        let mut task = TaskState::new("running", None);
        task.observe(
            &json!({"current":0,"total":10,"unit":"files","stage":"scan"}),
            Some(1000),
        );
        assert!(task.activity(4000, false).contains("0/10 files"));
        assert!(task.activity(4000, false).contains("3s ago"));
        task.observe(&json!({"current":11,"total":10}), Some(5000));
        assert!(task.activity(8000, false).contains("total unknown"));
        assert!(task.activity(8000, true).contains("recorded elapsed"));
        task.status = "done".into();
        task.observe(&json!({}), Some(9000));
        assert_eq!(task.activity(10000, false), task.activity(99000, false));
    }

    #[test]
    fn recorded_time_advances_only_with_saved_events_and_rejects_older_progress() {
        let mut model = model();
        model.session.mode = "replay".into();
        for event in [
            json!({"event":"job:start","jobId":"saved","ts":"2026-10-22T12:00:00.000Z"}),
            json!({"event":"task:start","jobId":"saved","taskId":"scan","current":0,"total":10,"ts":"2026-10-22T12:00:01.000Z"}),
            json!({"event":"task:progress","jobId":"saved","taskId":"scan","current":5,"ts":"2026-10-22T12:00:02.000Z"}),
            json!({"event":"task:progress","jobId":"saved","taskId":"scan","current":1,"ts":"2026-10-22T12:00:01.500Z"}),
            json!({"event":"log","message":"recorded heartbeat","ts":"2026-10-22T12:00:05.000Z"}),
        ] {
            apply_protocol_event(&mut model, event, 0);
        }
        let text = activity_text(&model);
        assert!(text.contains("5/10"));
        assert!(text.contains("recorded elapsed 4s"));
        assert!(text.contains("last 3s ago"));
        activity_tick(&mut model);
        assert_eq!(
            activity_text(&model),
            text,
            "paused replay cannot use wall time"
        );
        apply_protocol_event(
            &mut model,
            json!({"event":"job:end","jobId":"saved","status":"cancelled","ts":"2026-10-22T12:00:06.000Z"}),
            0,
        );
        let frozen = activity_text(&model);
        apply_protocol_event(
            &mut model,
            json!({"event":"log","message":"later saved event","ts":"2026-10-22T12:10:00.000Z"}),
            0,
        );
        assert_eq!(activity_text(&model), frozen);
        assert_eq!(
            task_state::recorded_timestamp("1970-01-01T00:00:00.000Z"),
            Some(0)
        );
        assert!(task_state::recorded_timestamp("2026-02-30T12:00:00.000Z").is_none());
    }

    #[test]
    fn bound_actions_help_filter_and_hovered_wheel_share_visible_identity() {
        let mut model = model();
        for action in palette_actions() {
            let key = KeyEvent::from(KeyCode::Char(
                action_shortcut(action).chars().next().unwrap(),
            ));
            assert!(
                bound_input(key).is_some(),
                "every advertised palette shortcut has a real global binding"
            );
            assert!(help_text(&model).contains(action.label()));
        }
        help_key(&mut model, KeyCode::Char('/').into());
        for ch in "saved".chars() {
            help_key(&mut model, KeyCode::Char(ch).into());
        }
        help_key(&mut model, KeyCode::Enter.into());
        assert!(help_text(&model).to_lowercase().contains("saved"));
        assert!(!help_text(&model).contains("Quit TUI"));
        model.overlay = OverlayMode::None;
        model.focus_panel = FocusPanel::Logs;
        model.push_log("only log".into());
        screen(&model, 80, 24);
        mouse(
            &mut model,
            MouseEvent {
                kind: MouseEventKind::ScrollUp,
                column: 4,
                row: 4,
                modifiers: KeyModifiers::NONE,
            },
        );
        let (_, InputCommand::Mouse(input)) = model.input_queue.pop_front().unwrap() else {
            panic!("hovered wheel");
        };
        apply_mouse(&mut model, input);
        assert_eq!(model.log_scroll.get(), 0);
        assert_eq!(model.job_scroll, 0);
        assert_eq!(model.task_scroll, 0);
    }

    #[test]
    fn contextual_help_preserves_modal_ownership_and_tiny_close_controls() {
        let mut model = model();
        model.overlay = OverlayMode::Settings;
        context_help(&mut model);
        assert!(model.overlay == OverlayMode::Help);
        assert!(help_text(&model).starts_with("Context: Settings"));
        assert!(model.settings.outbox.is_empty());
        assert!(screen(&model, 20, 5).contains("Esc/F1"));
        help_key(&mut model, KeyCode::Esc.into());
        assert!(model.overlay == OverlayMode::Settings);
        assert!(model.settings.outbox.is_empty());
    }

    #[test]
    fn palette_filter_retains_exact_visible_action_and_requires_reselection_when_hidden() {
        let mut model = model();
        model.overlay = OverlayMode::Palette;
        model.palette_index = palette_actions()
            .iter()
            .position(|action| *action == PaletteAction::Recordings)
            .unwrap();
        edit_palette(&mut model, |cursor, query| {
            cursor.paste(query, "saved", 256)
        });
        assert!(matches!(
            actions(&model).get(model.palette_index),
            Some(PaletteAction::Recordings)
        ));
        let text = screen(&model, 60, 18);
        assert!(text.contains("Esc close") && text.contains("1-1 / 1"));
        edit_palette(&mut model, |cursor, query| {
            cursor.key(
                query,
                KeyEvent::new(KeyCode::Char('u'), KeyModifiers::CONTROL),
                256,
            );
            cursor.paste(query, "settings", 256)
        });
        assert!(actions(&model).get(model.palette_index).is_none());
        apply_local_input(&mut model, "palette_select");
        assert!(model.overlay == OverlayMode::Palette && model.settings.outbox.is_empty());
        move_palette(&mut model, 1);
        assert!(matches!(
            actions(&model).get(model.palette_index),
            Some(PaletteAction::Settings)
        ));
        assert!(screen(&model, 80, 24).contains("Disabled:"));
        apply_local_input(&mut model, "palette_select");
        assert!(model.overlay == OverlayMode::Palette && model.settings.outbox.is_empty());
    }

    #[test]
    fn captured_modal_mouse_uses_rendered_geometry_and_rejects_stale_frames() {
        let mut model = model();
        model.overlay = OverlayMode::Palette;
        screen(&model, 80, 24);
        let (rect, action) = model.hit_map.borrow().palette.last().copied().unwrap();
        mouse(
            &mut model,
            MouseEvent {
                kind: MouseEventKind::Down(MouseButton::Left),
                column: rect.x,
                row: rect.y,
                modifiers: KeyModifiers::NONE,
            },
        );
        assert_eq!(
            model.palette_index, 0,
            "capture itself cannot bypass queued input order"
        );
        let (_, InputCommand::Mouse(input)) = model.input_queue.pop_front().unwrap() else {
            panic!("modal hit");
        };
        assert!(apply_mouse(&mut model, input).is_none());
        assert!(actions(&model)
            .get(model.palette_index)
            .is_some_and(|selected| *selected == action));
        assert!(model.overlay == OverlayMode::Palette && model.settings.outbox.is_empty());
        screen(&model, 80, 24);
        mouse(
            &mut model,
            MouseEvent {
                kind: MouseEventKind::ScrollDown,
                column: rect.x,
                row: rect.y,
                modifiers: KeyModifiers::NONE,
            },
        );
        let (_, InputCommand::Mouse(input)) = model.input_queue.pop_front().unwrap() else {
            panic!("wheel");
        };
        let selected = model.palette_index;
        screen(&model, 60, 18);
        apply_mouse(&mut model, input);
        assert_eq!(
            model.palette_index, selected,
            "a resized frame invalidates captured row geometry"
        );
        model.overlay = OverlayMode::Help;
        screen(&model, 80, 24);
        help_key(&mut model, KeyCode::End.into());
        assert!(screen(&model, 80, 24).contains("rows"));
        help_key(&mut model, KeyCode::Char('/').into());
        paste(&mut model, "saved\n\u{1b}\u{3}");
        assert!(model.help_query.contains("saved") && model.overlay == OverlayMode::Help);
    }
}
