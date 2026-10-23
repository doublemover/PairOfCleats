//! One native binding inventory for dispatch, palette, help and footer labels.
use super::{InputCommand, PaletteAction};
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};

#[derive(Clone, Copy)]
enum Target {
    Action(PaletteAction), PreviousJob, NextJob, LatestJob, Maximize, FocusNext,
    LogsUp, LogsDown, JobsUp, JobsDown, TasksUp, TasksDown, Palette, PanelSearch,
}
struct Binding { key: KeyCode, shortcut: &'static str, label: &'static str, target: Target }
const BINDINGS: &[Binding] = &[
    Binding { key: KeyCode::Char('p'), shortcut: "p", label: "Toggle follow / pause", target: Target::Action(PaletteAction::ToggleFollow) },
    Binding { key: KeyCode::Char('1'), shortcut: "1", label: "Focus jobs panel", target: Target::Action(PaletteAction::FocusJobs) },
    Binding { key: KeyCode::Char('2'), shortcut: "2", label: "Focus tasks panel", target: Target::Action(PaletteAction::FocusTasks) },
    Binding { key: KeyCode::Char('3'), shortcut: "3", label: "Focus logs panel", target: Target::Action(PaletteAction::FocusLogs) },
    Binding { key: KeyCode::Char('f'), shortcut: "f", label: "Cycle active panel filter", target: Target::Action(PaletteAction::CycleFilter) },
    Binding { key: KeyCode::Char('x'), shortcut: "x", label: "Clear current panel text filter", target: Target::Action(PaletteAction::ClearSearch) },
    Binding { key: KeyCode::Char('r'), shortcut: "r", label: "Show search command help", target: Target::Action(PaletteAction::RunJob) },
    Binding { key: KeyCode::Char('b'), shortcut: "b", label: "Command catalog: indexes, setup, service, maintenance and analysis", target: Target::Action(PaletteAction::IndexWorkflows) },
    Binding { key: KeyCode::Char('s'), shortcut: "s", label: "Repository / workspace and settings", target: Target::Action(PaletteAction::Settings) },
    Binding { key: KeyCode::Char('R'), shortcut: "R", label: "Search a repository and inspect results", target: Target::Action(PaletteAction::RepositorySearch) },
    Binding { key: KeyCode::Char('c'), shortcut: "c", label: "Cancel selected job", target: Target::Action(PaletteAction::CancelSelected) },
    Binding { key: KeyCode::Char('?'), shortcut: "?", label: "Open help overlay", target: Target::Action(PaletteAction::ShowHelp) },
    Binding { key: KeyCode::Char('v'), shortcut: "v", label: "Inspect selected job result and artifacts", target: Target::Action(PaletteAction::InspectJob) },
    Binding { key: KeyCode::Char('O'), shortcut: "O", label: "Open a saved session / passive replay", target: Target::Action(PaletteAction::Recordings) },
    Binding { key: KeyCode::Char('q'), shortcut: "q / Ctrl+C", label: "Quit TUI", target: Target::Action(PaletteAction::Quit) },
    Binding { key: KeyCode::Char('['), shortcut: "[", label: "Select previous visible job", target: Target::PreviousJob },
    Binding { key: KeyCode::Char(']'), shortcut: "]", label: "Select next visible job", target: Target::NextJob },
    Binding { key: KeyCode::Char('g'), shortcut: "g", label: "Follow latest visible job", target: Target::LatestJob },
    Binding { key: KeyCode::Char('z'), shortcut: "z", label: "Maximize focused pane / restore layout", target: Target::Maximize },
    Binding { key: KeyCode::Tab, shortcut: "Tab", label: "Focus next pane: Jobs / Tasks / Logs", target: Target::FocusNext },
    Binding { key: KeyCode::Char('j'), shortcut: "j", label: "Scroll to older logs", target: Target::LogsUp },
    Binding { key: KeyCode::Char('k'), shortcut: "k", label: "Scroll to newer logs", target: Target::LogsDown },
    Binding { key: KeyCode::Char('n'), shortcut: "n", label: "Scroll jobs up", target: Target::JobsUp },
    Binding { key: KeyCode::Char('m'), shortcut: "m", label: "Scroll jobs down", target: Target::JobsDown },
    Binding { key: KeyCode::Char('u'), shortcut: "u", label: "Scroll tasks up", target: Target::TasksUp },
    Binding { key: KeyCode::Char('i'), shortcut: "i", label: "Scroll tasks down", target: Target::TasksDown },
    Binding { key: KeyCode::Char(':'), shortcut: ":", label: "Open searchable action palette", target: Target::Palette },
    Binding { key: KeyCode::Char('a'), shortcut: "a", label: "Open searchable action palette", target: Target::Palette },
    Binding { key: KeyCode::Char('/'), shortcut: "/", label: "Filter text in focused panel", target: Target::PanelSearch },
];

pub(super) fn registered() -> Vec<PaletteAction> {
    BINDINGS.iter().filter_map(|binding| if let Target::Action(action) = binding.target { Some(action) } else { None }).collect()
}
fn action_binding(action: PaletteAction) -> &'static Binding {
    BINDINGS.iter().find(|binding| matches!(binding.target, Target::Action(candidate) if candidate == action))
        .expect("native action must have its registered binding")
}
pub(super) fn label(action: PaletteAction) -> &'static str { action_binding(action).label }
pub(super) fn shortcut(action: PaletteAction) -> &'static str { action_binding(action).shortcut }
pub(super) fn footer() -> String {
    let local = |key| BINDINGS.iter().find(|binding| binding.key == key).unwrap().shortcut;
    format!("{} search | {} commands | {} sessions | {} settings | {} pane | {} maximize | {} panel text | {} actions | {} help | {} quit",
        shortcut(PaletteAction::RepositorySearch), shortcut(PaletteAction::IndexWorkflows), shortcut(PaletteAction::Recordings),
        shortcut(PaletteAction::Settings), local(KeyCode::Tab), local(KeyCode::Char('z')), local(KeyCode::Char('/')),
        local(KeyCode::Char(':')), shortcut(PaletteAction::ShowHelp), shortcut(PaletteAction::Quit))
}
pub(super) fn help_rows() -> Vec<String> {
    BINDINGS.iter().filter(|binding| !matches!(binding.target, Target::Action(_)))
        .map(|binding| format!("{}: {}", binding.shortcut, binding.label)).collect()
}
pub(super) fn bound_input(key: KeyEvent) -> Option<InputCommand> {
    if key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) { return None; }
    let binding = BINDINGS.iter().find(|binding| binding.key == key.code)?;
    Some(match binding.target {
        Target::Action(action) => match action {
            PaletteAction::ToggleFollow => InputCommand::ToggleFollow,
            PaletteAction::FocusJobs => InputCommand::FocusJobs, PaletteAction::FocusTasks => InputCommand::FocusTasks,
            PaletteAction::FocusLogs => InputCommand::FocusLogs, PaletteAction::CycleFilter => InputCommand::CycleFilter,
            PaletteAction::ClearSearch => InputCommand::ClearSearch, PaletteAction::RunJob => InputCommand::RunJob,
            PaletteAction::Settings => InputCommand::Settings, PaletteAction::RepositorySearch => InputCommand::RepositorySearch,
            PaletteAction::IndexWorkflows => InputCommand::IndexWorkflows, PaletteAction::InspectJob => InputCommand::InspectJob,
            PaletteAction::CancelSelected => InputCommand::CancelSelected, PaletteAction::ShowHelp => InputCommand::ToggleHelp,
            PaletteAction::Recordings => InputCommand::Recordings, PaletteAction::Quit => InputCommand::Quit,
        },
        Target::PreviousJob => InputCommand::SelectPreviousJob, Target::NextJob => InputCommand::SelectNextJob,
        Target::LatestJob => InputCommand::FollowLatestJob, Target::Maximize => InputCommand::ToggleMaximized,
        Target::FocusNext => InputCommand::FocusNext, Target::LogsUp => InputCommand::LogsUp,
        Target::LogsDown => InputCommand::LogsDown, Target::JobsUp => InputCommand::JobsUp,
        Target::JobsDown => InputCommand::JobsDown, Target::TasksUp => InputCommand::TasksUp,
        Target::TasksDown => InputCommand::TasksDown, Target::Palette => InputCommand::TogglePalette,
        Target::PanelSearch => InputCommand::SearchOpen,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_registered_binding_dispatches_and_keys_are_unique() {
        let mut keys = std::collections::HashSet::new();
        for binding in BINDINGS {
            assert!(keys.insert(format!("{:?}", binding.key)));
            assert!(bound_input(KeyEvent::from(binding.key)).is_some());
            assert!(bound_input(KeyEvent::new(binding.key, KeyModifiers::ALT)).is_none());
        }
    }
}
