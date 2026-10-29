mod actions;
#[cfg(test)]
mod activity_tests;
mod event_ingress;
#[cfg(test)]
mod input_ingress_tests;
mod inspection;
mod interaction;
mod log_layout;
#[cfg(test)]
mod recording_tests;
mod recordings;
#[cfg(test)]
mod redraw_tests;
mod review_presentation;
mod search;
mod search_failure;
#[rustfmt::skip]
mod search_failure_catalog;
mod settings;
mod supervisor_lifetime;
mod supervisor_transport;
mod text_editor;
#[cfg(test)]
mod viewport_tests;
#[cfg(test)]
mod workflow_tests;
mod workflows;
use supervisor_lifetime::SupervisorLifetime;

use std::collections::{BTreeMap, HashMap, VecDeque};
mod overlay_viewport;
mod task_state;
use std::fs;
use std::io::{BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use task_state::{Lifecycle, TaskState};

use crossterm::event::{
    self, DisableBracketedPaste, DisableMouseCapture, EnableBracketedPaste, EnableMouseCapture,
    Event as CEvent, KeyCode, KeyEvent, KeyEventKind, KeyModifiers,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::{CrosstermBackend, TestBackend};
use ratatui::layout::{Constraint, Direction, Layout, Rect};
use ratatui::style::{Color, Modifier, Style};
use ratatui::text::Span;
use ratatui::widgets::{Block, Borders, Clear, List, ListItem, Paragraph, Wrap};
use ratatui::Terminal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const LOG_RING_LIMIT: usize = 2048;
const JOB_RING_LIMIT: usize = 512;
const TASK_RING_LIMIT: usize = 2048;
const ALERT_RING_LIMIT: usize = 64;
const CHUNK_ASSEMBLY_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const FRAME_INTERVAL: Duration = Duration::from_millis(50);
const INPUT_POLL_INTERVAL: Duration = Duration::from_millis(20);
const FRAME_BUDGET_MS: u128 = 16;
const INPUT_DEBOUNCE_MS: u128 = 40;
const INPUT_DISPATCH_INTERVAL_MS: u128 = 25;
const FLOW_CREDIT_BATCH: u64 = 64;
const FLOW_CREDIT_FLUSH_INTERVAL: Duration = Duration::from_millis(80);
const METRICS_EMIT_INTERVAL: Duration = Duration::from_millis(1000);
const TUI_CAPTURE_FIXTURE_SCHEMA_VERSION: u32 = 1;

#[derive(Clone)]
struct TerminalCapabilities {
    color: bool,
    unicode: bool,
    mouse: bool,
    alt_screen: bool,
}

impl TerminalCapabilities {
    fn detect() -> Self {
        let no_color = std::env::var("NO_COLOR")
            .ok()
            .map(|v| !v.trim().is_empty())
            .unwrap_or(false);
        let color = !no_color;
        let unicode = std::env::var("PAIROFCLEATS_TUI_UNICODE")
            .ok()
            .map(|v| v != "0")
            .unwrap_or(true);
        let mouse = std::env::var("PAIROFCLEATS_TUI_MOUSE")
            .ok()
            .map(|v| v == "1" || v.eq_ignore_ascii_case("true"))
            .unwrap_or(false);
        let alt_screen = std::env::var("PAIROFCLEATS_TUI_ALT_SCREEN")
            .ok()
            .map(|v| v != "0")
            .unwrap_or(true);
        Self {
            color,
            unicode,
            mouse,
            alt_screen,
        }
    }
}

struct UiGuard {
    caps: TerminalCapabilities,
}

impl Drop for UiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let mut stdout = std::io::stdout();
        let _ = execute!(stdout, DisableBracketedPaste);
        if self.caps.mouse {
            let _ = execute!(stdout, DisableMouseCapture);
        }
        if self.caps.alt_screen {
            let _ = execute!(stdout, LeaveAlternateScreen);
        }
    }
}

#[derive(Default, Serialize, Deserialize)]
struct SessionSnapshot {
    #[serde(default)]
    focus_panel: Option<FocusPanel>,
    #[serde(default)]
    job_filter: Option<JobFilter>,
    #[serde(default)]
    task_filter: Option<TaskFilter>,
    #[serde(default)]
    log_level_filter: Option<LogLevelFilter>,
    #[serde(default)]
    log_source_filter: Option<LogSourceFilter>,
    #[serde(default)]
    follow_updates: Option<bool>,
    #[serde(default)]
    search_jobs: String,
    #[serde(default)]
    search_tasks: String,
    #[serde(default)]
    search_logs: String,
    selected_job: Option<String>,
    #[serde(default)]
    selected_job_pinned: bool,
    #[serde(default)]
    selected_job_expired: bool,
    job_scroll: usize,
    task_scroll: usize,
    log_scroll: usize,
    #[serde(default)]
    final_job_statuses: BTreeMap<String, String>,
}

#[derive(Clone, Default)]
struct RuntimeTelemetry {
    event_lag_ms_ewma: Option<f64>,
    render_ms_ewma: f64,
    queue_depth_ewma: Option<f64>,
    native_inbound_pending: Option<usize>,
    dropped_chunks: u64,
    chunk_reassembled: u64,
    processed_events: u64,
    lifecycle_dropped: u64,
}

impl RuntimeTelemetry {
    fn update_known_ewma(current: Option<f64>, next: f64) -> Option<f64> {
        Some(current.map_or(next, |value| value * 0.85 + next * 0.15))
    }

    fn update_ewma(current: f64, next: f64) -> f64 {
        if current <= 0.0 {
            return next;
        }
        (current * 0.85) + (next * 0.15)
    }
}

#[derive(Clone, Default, Serialize)]
struct SessionState {
    mode: String,
    source: String,
    scope: String,
    connection: String,
    note: String,
    controllable: bool,
}

#[derive(Clone)]
struct AlertEntry {
    level: String,
    message: String,
}

#[derive(Clone)]
struct LogEntry {
    id: u64,
    text: String,
    level: String,
    source: String,
    job_id: Option<String>,
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum FocusPanel {
    Jobs,
    Tasks,
    Logs,
}

impl FocusPanel {
    fn label(&self) -> &'static str {
        match self {
            Self::Jobs => "jobs",
            Self::Tasks => "tasks",
            Self::Logs => "logs",
        }
    }

    fn next(&self) -> Self {
        match self {
            Self::Jobs => Self::Tasks,
            Self::Tasks => Self::Logs,
            Self::Logs => Self::Jobs,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum JobFilter {
    All,
    Active,
    Failed,
    Done,
}

impl JobFilter {
    fn label(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Active => "active",
            Self::Failed => "failed",
            Self::Done => "done",
        }
    }

    fn next(&self) -> Self {
        match self {
            Self::All => Self::Active,
            Self::Active => Self::Failed,
            Self::Failed => Self::Done,
            Self::Done => Self::All,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum TaskFilter {
    All,
    Active,
    Failed,
    Done,
}

impl TaskFilter {
    fn label(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Active => "active",
            Self::Failed => "failed",
            Self::Done => "done",
        }
    }

    fn next(&self) -> Self {
        match self {
            Self::All => Self::Active,
            Self::Active => Self::Failed,
            Self::Failed => Self::Done,
            Self::Done => Self::All,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum LogLevelFilter {
    All,
    WarnError,
    Error,
}

impl LogLevelFilter {
    fn label(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::WarnError => "warn+",
            Self::Error => "error",
        }
    }

    fn next(&self) -> Self {
        match self {
            Self::All => Self::WarnError,
            Self::WarnError => Self::Error,
            Self::Error => Self::All,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
enum LogSourceFilter {
    All,
    Supervisor,
    Events,
}

impl LogSourceFilter {
    fn label(&self) -> &'static str {
        match self {
            Self::All => "all",
            Self::Supervisor => "supervisor",
            Self::Events => "events",
        }
    }

    fn next(&self) -> Self {
        match self {
            Self::All => Self::Supervisor,
            Self::Supervisor => Self::Events,
            Self::Events => Self::All,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum OverlayMode {
    None,
    Help,
    Palette,
    Search,
    Settings,
    RepositorySearch,
    IndexWorkflows,
    JobInspection,
    Recordings,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum WorkloadKind {
    Generic,
    Bench,
    Indexing,
    Service,
}

impl WorkloadKind {
    fn label(&self) -> &'static str {
        match self {
            Self::Generic => "Workload",
            Self::Bench => "Bench",
            Self::Indexing => "Indexing",
            Self::Service => "Service",
        }
    }
}

#[derive(Clone, Default, Serialize)]
struct BenchSummary {
    lane: String,
    tier: String,
    active_repo: String,
    degraded_providers: Vec<String>,
    retained_crash_count: u64,
    unresolved_import_count: u64,
    quality_signals: Vec<String>,
    artifact_stall: String,
    timeout_state: String,
}

#[derive(Clone, Default, Serialize)]
struct IndexingSummary {
    repo: String,
    stage: String,
    mode: String,
    heartbeat_age_ms: Option<u64>,
    heartbeat_observed_ms: Option<u64>,
    artifact_write_progress: String,
    sqlite_state: String,
    validation_state: String,
    promotion_state: String,
}

#[derive(Clone, Default, Serialize)]
struct ServiceSummary {
    service: String,
    active_workers: Option<u64>,
    active_jobs: Option<u64>,
    retry_count: u64,
    quarantine_state: String,
    shutdown_state: String,
    queue_depth: Option<u64>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum PaletteAction {
    ToggleFollow,
    FocusJobs,
    FocusTasks,
    FocusLogs,
    CycleFilter,
    ClearSearch,
    RunJob,
    Settings,
    RepositorySearch,
    IndexWorkflows,
    InspectJob,
    CancelSelected,
    ShowHelp,
    Recordings,
    Quit,
}

impl PaletteAction {
    fn label(&self) -> &'static str {
        actions::label(*self)
    }
}

#[derive(Clone)]
struct ChunkAssembly {
    chunk_count: usize,
    parts: Vec<Option<String>>,
    bytes: usize,
}

#[derive(Deserialize)]
struct CaptureFixture {
    schema_version: u32,
    name: String,
    #[serde(default)]
    source_mode: String,
    #[serde(default)]
    run_id: String,
    variants: Vec<CaptureVariant>,
    #[serde(default)]
    steps: Vec<CaptureStep>,
}

#[derive(Deserialize)]
struct CaptureVariant {
    id: String,
    width: u16,
    height: u16,
    #[serde(default)]
    color: Option<bool>,
    #[serde(default)]
    unicode: Option<bool>,
}

#[derive(Default, Deserialize)]
struct CaptureStep {
    #[serde(default)]
    capture_id: String,
    #[serde(default)]
    event: Option<Value>,
    #[serde(default)]
    input: String,
    #[serde(default)]
    selected_job: String,
    #[serde(default)]
    job_scroll: Option<usize>,
    #[serde(default)]
    task_scroll: Option<usize>,
    #[serde(default)]
    log_scroll: Option<usize>,
}

#[derive(Serialize)]
struct FrameStyleRun {
    row: u16,
    start_col: u16,
    end_col: u16,
    fg: String,
    bg: String,
    modifiers: Vec<String>,
}

#[derive(Serialize)]
struct CapturedFrameMetadata {
    fixture_name: String,
    source_mode: String,
    capture_id: String,
    variant_id: String,
    width: u16,
    height: u16,
    color: bool,
    unicode: bool,
    run_id: String,
    session_mode: String,
    session_source: String,
    session_scope: String,
    session_connection: String,
    session_note: String,
    selected_job: Option<String>,
    job_scroll: usize,
    task_scroll: usize,
    log_scroll: usize,
    job_count: usize,
    task_count: usize,
    log_count: usize,
    alert_count: usize,
    non_default_style_cells: usize,
    style_runs: Vec<FrameStyleRun>,
}

#[derive(Serialize)]
struct CaptureManifestEntry {
    capture_id: String,
    variant_id: String,
    frame_path: String,
    metadata_path: String,
}

#[derive(Serialize)]
struct CaptureManifest {
    schema_version: u32,
    fixture_name: String,
    source_mode: String,
    run_id: String,
    outputs: Vec<CaptureManifestEntry>,
}

#[derive(Clone)]
enum InputCommand {
    TerminalKey(KeyEvent),
    Paste(String),
    Mouse(interaction::MouseInput),
    ContextHelp,
    Quit,
    RunJob,
    Settings,
    RepositorySearch,
    IndexWorkflows,
    Recordings,
    InspectJob,
    CancelSelected,
    SelectPreviousJob,
    SelectNextJob,
    FollowLatestJob,
    FocusNext,
    ToggleMaximized,
    FocusJobs,
    FocusTasks,
    FocusLogs,
    CycleFilter,
    ToggleFollow,
    ToggleHelp,
    TogglePalette,
    PaletteUp,
    PaletteDown,
    PaletteSelect,
    SearchOpen,
    SearchAccept,
    SearchCancel,
    SearchBackspace,
    SearchChar(char),
    ClearSearch,
    LogsUp,
    LogsDown,
    JobsUp,
    JobsDown,
    TasksUp,
    TasksDown,
}

struct AppModel {
    job_inspection: inspection::InspectionUi,
    index_workflows: workflows::WorkflowUi,
    settings: settings::SettingsUi,
    repository_search: search::SearchUi,
    run_id: String,
    job_status: BTreeMap<String, String>,
    job_titles: BTreeMap<String, String>,
    job_order: VecDeque<String>,
    task_status: BTreeMap<String, TaskState>,
    task_identity: BTreeMap<String, (String, String)>,
    task_order: VecDeque<String>,
    logs: VecDeque<LogEntry>,
    next_log_id: u64,
    log_layout_cache: std::cell::RefCell<log_layout::LogLayoutCache>,
    alerts: VecDeque<AlertEntry>,
    session: SessionState,
    // Set only by the owner of the real local child transport, never by data.
    owns_control_channel: bool,
    recordings_requested: bool,
    recording_overlay_text: String,
    recording_revision: u64,
    selected_job: Option<String>,
    selected_job_pinned: bool,
    selected_job_expired: bool,
    focus_panel: FocusPanel,
    follow_updates: bool,
    job_filter: JobFilter,
    task_filter: TaskFilter,
    log_level_filter: LogLevelFilter,
    log_source_filter: LogSourceFilter,
    search_jobs: String,
    search_tasks: String,
    search_logs: String,
    overlay: OverlayMode,
    search_target: FocusPanel,
    search_draft: String,
    palette_index: usize,
    palette_query: String,
    help_viewport: overlay_viewport::ReviewViewport,
    help_revision: u64,
    help_query: String,
    help_editing: bool,
    help_origin: Option<OverlayMode>,
    maximized: bool,
    panel_cursor: text_editor::TextCursor,
    hit_map: std::cell::RefCell<interaction::HitMap>,
    activity_origin: Instant,
    activity_second: u64,
    recorded_ms: Option<u64>,
    workload_kind: WorkloadKind,
    bench_summary: BenchSummary,
    indexing_summary: IndexingSummary,
    service_summary: ServiceSummary,
    job_scroll: usize,
    task_scroll: usize,
    log_scroll: std::cell::Cell<usize>,
    dirty: bool,
    last_render_signature: String,
    content_revision: u64,
    chunk_assemblies: HashMap<String, ChunkAssembly>,
    chunk_assembly_bytes: usize,
    terminal_caps: TerminalCapabilities,
    telemetry: RuntimeTelemetry,
    telemetry_file: Option<fs::File>,
    last_metrics_emit: Instant,
    flow_credit_pending: u64,
    last_credit_flush: Instant,
    input_queue: VecDeque<(u64, InputCommand)>,
    next_input_seq: u64,
    last_input_at: Instant,
    last_key_at: Instant,
    last_input_token: String,
}

impl AppModel {
    fn content_changed(&mut self) {
        self.content_revision = self.content_revision.wrapping_add(1);
        self.dirty = true;
    }

    fn new(
        run_id: String,
        terminal_caps: TerminalCapabilities,
        telemetry_file: Option<fs::File>,
    ) -> Self {
        Self {
            job_inspection: inspection::InspectionUi::default(),
            index_workflows: workflows::WorkflowUi::default(),
            settings: settings::SettingsUi::default(),
            repository_search: search::SearchUi::default(),
            run_id,
            job_status: BTreeMap::new(),
            job_titles: BTreeMap::new(),
            job_order: VecDeque::new(),
            task_status: BTreeMap::new(),
            task_identity: BTreeMap::new(),
            task_order: VecDeque::new(),
            logs: VecDeque::new(),
            next_log_id: 1,
            log_layout_cache: std::cell::RefCell::new(log_layout::LogLayoutCache::default()),
            alerts: VecDeque::new(),
            session: SessionState {
                mode: "supervised".to_string(),
                source: "local-supervisor".to_string(),
                scope: std::env::current_dir()
                    .ok()
                    .map(|value| value.display().to_string())
                    .unwrap_or_else(|| ".".to_string()),
                connection: "starting".to_string(),
                note: "awaiting supervisor handshake".to_string(),
                controllable: false,
            },
            owns_control_channel: false,
            recordings_requested: false,
            recording_overlay_text: String::new(),
            recording_revision: 0,
            selected_job: None,
            selected_job_pinned: false,
            selected_job_expired: false,
            focus_panel: FocusPanel::Jobs,
            follow_updates: true,
            job_filter: JobFilter::All,
            task_filter: TaskFilter::All,
            log_level_filter: LogLevelFilter::All,
            log_source_filter: LogSourceFilter::All,
            search_jobs: String::new(),
            search_tasks: String::new(),
            search_logs: String::new(),
            overlay: OverlayMode::None,
            search_target: FocusPanel::Jobs,
            search_draft: String::new(),
            palette_index: 0,
            palette_query: String::new(),
            help_viewport: overlay_viewport::ReviewViewport::default(),
            help_revision: 0,
            help_query: String::new(),
            help_editing: false,
            help_origin: None,
            maximized: false,
            panel_cursor: text_editor::TextCursor::default(),
            hit_map: std::cell::RefCell::new(interaction::HitMap::default()),
            activity_origin: Instant::now(),
            activity_second: 0,
            recorded_ms: None,
            workload_kind: WorkloadKind::Generic,
            bench_summary: BenchSummary::default(),
            indexing_summary: IndexingSummary::default(),
            service_summary: ServiceSummary::default(),
            job_scroll: 0,
            task_scroll: 0,
            log_scroll: std::cell::Cell::new(0),
            dirty: true,
            last_render_signature: String::new(),
            content_revision: 0,
            chunk_assemblies: HashMap::new(),
            chunk_assembly_bytes: 0,
            terminal_caps,
            telemetry: RuntimeTelemetry::default(),
            telemetry_file,
            last_metrics_emit: Instant::now(),
            flow_credit_pending: 0,
            last_credit_flush: Instant::now(),
            input_queue: VecDeque::new(),
            next_input_seq: 1,
            last_input_at: Instant::now() - Duration::from_millis(INPUT_DEBOUNCE_MS as u64),
            last_key_at: Instant::now() - Duration::from_millis(INPUT_DEBOUNCE_MS as u64),
            last_input_token: String::new(),
        }
    }

    fn push_log_entry(&mut self, text: String, level: &str, source: &str) {
        self.push_scoped_log_entry(text, level, source, None);
    }

    fn push_scoped_log_entry(
        &mut self,
        text: String,
        level: &str,
        source: &str,
        job_id: Option<&str>,
    ) {
        if self.next_log_id == u64::MAX {
            self.log_layout_cache.borrow_mut().clear();
            for (index, retained) in self.logs.iter_mut().enumerate() {
                retained.id = index as u64 + 1;
            }
            self.next_log_id = self.logs.len() as u64 + 1;
        }
        let id = self.next_log_id;
        self.next_log_id += 1;
        let entry = LogEntry {
            id,
            text,
            level: level.to_string(),
            source: source.to_string(),
            job_id: job_id.map(str::to_owned),
        };
        if self.logs.len() >= LOG_RING_LIMIT {
            if let Some(old) = self.logs.pop_front() {
                self.log_layout_cache.borrow_mut().remove(old.id);
            }
        }
        self.logs.push_back(entry);
        self.content_changed();
    }

    fn push_log(&mut self, message: String) {
        self.push_log_entry(message, "info", "supervisor");
        self.dirty = true;
    }

    fn push_alert(&mut self, level: &str, message: &str) {
        if message.trim().is_empty() {
            return;
        }
        if self.alerts.len() >= ALERT_RING_LIMIT {
            self.alerts.pop_front();
        }
        self.alerts.push_back(AlertEntry {
            level: level.to_string(),
            message: message.to_string(),
        });
        self.content_changed();
    }

    fn update_session_state(
        &mut self,
        mode: Option<&str>,
        source: Option<&str>,
        scope: Option<&str>,
        connection: Option<&str>,
        note: Option<&str>,
    ) {
        if let Some(value) = mode {
            if !value.trim().is_empty() {
                self.session.mode = value.trim().to_string();
            }
        }
        if let Some(value) = source {
            if !value.trim().is_empty() {
                self.session.source = value.trim().to_string();
            }
        }
        if let Some(value) = scope {
            if !value.trim().is_empty() {
                self.session.scope = value.trim().to_string();
            }
        }
        if let Some(value) = connection {
            if !value.trim().is_empty() {
                self.session.connection = value.trim().to_string();
            }
        }
        if let Some(value) = note {
            if !value.trim().is_empty() {
                self.session.note = value.trim().to_string();
            }
        }
        self.dirty = true;
    }

    fn update_job_status(&mut self, job_id: &str, status: &str, title: Option<&str>) {
        if !self.job_status.contains_key(job_id) {
            self.job_order.push_back(job_id.to_string());
            while self.job_order.len() > JOB_RING_LIMIT {
                if let Some(old) = self.job_order.pop_front() {
                    if self.selected_job_pinned
                        && self.selected_job.as_deref() == Some(old.as_str())
                    {
                        self.selected_job_expired = true;
                    }
                    self.job_status.remove(&old);
                    self.job_titles.remove(&old);
                }
            }
        }
        self.job_status
            .insert(job_id.to_string(), status.to_string());
        if let Some(next_title) = title {
            if !next_title.trim().is_empty() {
                self.job_titles
                    .insert(job_id.to_string(), next_title.trim().to_string());
            }
        }
        if !self.selected_job_pinned {
            self.selected_job = Some(job_id.to_string());
            self.selected_job_expired = false;
        }
        self.content_changed();
    }

    fn begin_job_instance(&mut self, job_id: &str) {
        if self.selected_job_pinned && self.selected_job.as_deref() == Some(job_id) {
            self.selected_job_expired = true;
        }
        let old_tasks: Vec<_> = self
            .task_identity
            .iter()
            .filter(|(_, (owner, _))| owner == job_id)
            .map(|(key, _)| key.clone())
            .collect();
        for key in old_tasks {
            self.task_status.remove(&key);
            self.task_identity.remove(&key);
        }
        self.task_order
            .retain(|key| self.task_status.contains_key(key));
        self.logs
            .retain(|entry| entry.job_id.as_deref() != Some(job_id));
        if self.job_status.contains_key(job_id) {
            self.job_order.retain(|id| id != job_id);
            self.job_order.push_back(job_id.to_owned());
        }
        self.content_changed();
    }

    fn update_task_status(
        &mut self,
        job_id: &str,
        task_id: &str,
        status: &str,
        message: Option<&str>,
    ) {
        if Lifecycle::from_status(status) == Lifecycle::Active
            && self
                .job_status
                .get(job_id)
                .is_some_and(|owner| Lifecycle::from_status(owner) != Lifecycle::Active)
        {
            return;
        }
        let key = json!([job_id, task_id]).to_string();
        if !self.task_status.contains_key(&key) {
            self.task_identity
                .insert(key.clone(), (job_id.to_owned(), task_id.to_owned()));
            self.task_order.push_back(key.clone());
            while self.task_order.len() > TASK_RING_LIMIT {
                if let Some(old) = self.task_order.pop_front() {
                    self.task_status.remove(&old);
                    self.task_identity.remove(&old);
                }
            }
        }
        if let Some(task) = self.task_status.get_mut(&key) {
            task.status = status.into();
            task.message = message
                .filter(|text| !text.trim().is_empty())
                .map(str::to_owned);
        } else {
            self.task_status
                .insert(key, TaskState::new(status, message));
        }
        self.content_changed();
    }

    fn reconcile_terminal_tasks(&mut self, job_id: &str, owner_status: &str) {
        for (key, task) in &mut self.task_status {
            if self
                .task_identity
                .get(key)
                .is_some_and(|(owner, _)| owner == job_id)
                && task.lifecycle() == Lifecycle::Active
            {
                let status = if Lifecycle::from_status(owner_status) == Lifecycle::Cancelled {
                    "cancelled"
                } else {
                    "unfinished"
                };
                task.status = status.into();
                task.message = Some(format!("owner ended {owner_status} before task:end"));
                if self.owns_control_channel && self.session.mode != "replay" {
                    task.ended_ms = Some(
                        self.activity_origin
                            .elapsed()
                            .as_millis()
                            .min(u64::MAX as u128) as u64,
                    );
                } else {
                    task.ended_ms = self.recorded_ms;
                }
            }
        }
        self.content_changed();
    }

    fn promote_workload_kind(&mut self, next_kind: WorkloadKind) {
        if self.workload_kind == next_kind {
            return;
        }
        if self.workload_kind == WorkloadKind::Generic {
            self.workload_kind = next_kind;
            self.dirty = true;
            return;
        }
        if next_kind != WorkloadKind::Generic {
            self.workload_kind = next_kind;
            self.dirty = true;
        }
    }
}

fn resolve_capture_fixture_path() -> Option<PathBuf> {
    let value = std::env::var("PAIROFCLEATS_TUI_CAPTURE_FIXTURE").ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn resolve_capture_out_dir() -> Option<PathBuf> {
    let value = std::env::var("PAIROFCLEATS_TUI_CAPTURE_OUT_DIR").ok()?;
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    Some(PathBuf::from(trimmed))
}

fn color_name(color: Option<Color>) -> String {
    match color.unwrap_or(Color::Reset) {
        Color::Reset => "reset".to_string(),
        Color::Black => "black".to_string(),
        Color::Red => "red".to_string(),
        Color::Green => "green".to_string(),
        Color::Yellow => "yellow".to_string(),
        Color::Blue => "blue".to_string(),
        Color::Magenta => "magenta".to_string(),
        Color::Cyan => "cyan".to_string(),
        Color::Gray => "gray".to_string(),
        Color::DarkGray => "dark_gray".to_string(),
        Color::LightRed => "light_red".to_string(),
        Color::LightGreen => "light_green".to_string(),
        Color::LightYellow => "light_yellow".to_string(),
        Color::LightBlue => "light_blue".to_string(),
        Color::LightMagenta => "light_magenta".to_string(),
        Color::LightCyan => "light_cyan".to_string(),
        Color::White => "white".to_string(),
        Color::Rgb(r, g, b) => format!("rgb({r},{g},{b})"),
        Color::Indexed(index) => format!("indexed({index})"),
    }
}

fn modifier_names(modifier: Modifier) -> Vec<String> {
    let mut names = Vec::new();
    if modifier.contains(Modifier::BOLD) {
        names.push("bold".to_string());
    }
    if modifier.contains(Modifier::DIM) {
        names.push("dim".to_string());
    }
    if modifier.contains(Modifier::ITALIC) {
        names.push("italic".to_string());
    }
    if modifier.contains(Modifier::UNDERLINED) {
        names.push("underlined".to_string());
    }
    if modifier.contains(Modifier::SLOW_BLINK) {
        names.push("slow_blink".to_string());
    }
    if modifier.contains(Modifier::RAPID_BLINK) {
        names.push("rapid_blink".to_string());
    }
    if modifier.contains(Modifier::REVERSED) {
        names.push("reversed".to_string());
    }
    if modifier.contains(Modifier::HIDDEN) {
        names.push("hidden".to_string());
    }
    if modifier.contains(Modifier::CROSSED_OUT) {
        names.push("crossed_out".to_string());
    }
    names
}

fn resolve_run_id() -> String {
    if let Ok(value) = std::env::var("PAIROFCLEATS_TUI_RUN_ID") {
        if !value.trim().is_empty() {
            return value.trim().to_string();
        }
    }
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_millis())
        .unwrap_or(0);
    format!("run-{now}-{}", std::process::id())
}

fn env_path(key: &str) -> Option<PathBuf> {
    std::env::var(key)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn resolve_default_cache_root_base() -> Option<PathBuf> {
    if let Some(value) = env_path("PAIROFCLEATS_CACHE_ROOT") {
        return Some(value);
    }
    if let Some(value) = env_path("PAIROFCLEATS_HOME") {
        return Some(value);
    }
    if let Some(value) = env_path("LOCALAPPDATA") {
        return Some(value.join("PairOfCleats"));
    }
    if let Some(value) = env_path("XDG_CACHE_HOME") {
        return Some(value.join("pairofcleats"));
    }
    env_path("HOME").map(|value| value.join(".cache").join("pairofcleats"))
}

fn resolve_default_cache_root() -> PathBuf {
    let base = resolve_default_cache_root_base().unwrap_or_else(|| {
        std::env::current_dir()
            .unwrap_or_else(|_| PathBuf::from("."))
            .join(".pairofcleats-runtime")
    });
    if base
        .file_name()
        .map(|value| value.to_string_lossy().eq_ignore_ascii_case("cache"))
        .unwrap_or(false)
    {
        return base;
    }
    base.join("cache")
}

fn resolve_install_root() -> PathBuf {
    if let Some(value) = env_path("PAIROFCLEATS_TUI_INSTALL_ROOT") {
        return value;
    }
    resolve_default_cache_root().join("tui").join("install-v1")
}

fn resolve_runtime_root() -> PathBuf {
    if let Some(value) = env_path("PAIROFCLEATS_TUI_INSTALL_ROOT") {
        if let Some(parent) = value.parent() {
            return parent.to_path_buf();
        }
        return value;
    }
    resolve_default_cache_root().join("tui")
}

fn resolve_observability_dir() -> PathBuf {
    if let Some(value) = env_path("PAIROFCLEATS_TUI_EVENT_LOG_DIR") {
        return value;
    }
    resolve_install_root().join("session-logs")
}

fn resolve_snapshot_path() -> PathBuf {
    if let Some(value) = env_path("PAIROFCLEATS_TUI_SNAPSHOT_PATH") {
        return value;
    }
    resolve_runtime_root().join("last-state.json")
}

fn load_snapshot(snapshot_path: &Path) -> Option<SessionSnapshot> {
    let body = fs::read_to_string(snapshot_path).ok()?;
    serde_json::from_str::<SessionSnapshot>(&body).ok()
}

fn snapshot_from_model(model: &AppModel) -> SessionSnapshot {
    SessionSnapshot {
        selected_job: model.selected_job.clone(),
        selected_job_pinned: model.selected_job_pinned,
        selected_job_expired: model.selected_job_expired,
        job_scroll: model.job_scroll,
        task_scroll: model.task_scroll,
        log_scroll: model.log_scroll.get(),
        final_job_statuses: model.job_status.clone(),
        focus_panel: Some(model.focus_panel),
        job_filter: Some(model.job_filter),
        task_filter: Some(model.task_filter),
        log_level_filter: Some(model.log_level_filter),
        log_source_filter: Some(model.log_source_filter),
        follow_updates: Some(model.follow_updates),
        search_jobs: model.search_jobs.clone(),
        search_tasks: model.search_tasks.clone(),
        search_logs: model.search_logs.clone(),
    }
}

fn restore_snapshot(model: &mut AppModel, snapshot: SessionSnapshot) {
    model.selected_job = snapshot
        .selected_job
        .filter(|id| model.job_status.contains_key(id));
    model.selected_job_pinned = snapshot.selected_job_pinned && model.selected_job.is_some();
    model.selected_job_expired = snapshot.selected_job_expired && model.selected_job.is_some();
    model.job_scroll = snapshot.job_scroll;
    model.task_scroll = snapshot.task_scroll;
    model.log_scroll.set(snapshot.log_scroll);
    model.search_jobs = snapshot.search_jobs;
    model.search_tasks = snapshot.search_tasks;
    model.search_logs = snapshot.search_logs;
    if let Some(value) = snapshot.focus_panel {
        model.focus_panel = value;
    }
    if let Some(value) = snapshot.job_filter {
        model.job_filter = value;
    }
    if let Some(value) = snapshot.task_filter {
        model.task_filter = value;
    }
    if let Some(value) = snapshot.log_level_filter {
        model.log_level_filter = value;
    }
    if let Some(value) = snapshot.log_source_filter {
        model.log_source_filter = value;
    }
    if let Some(value) = snapshot.follow_updates {
        model.follow_updates = value;
    }
}

fn save_snapshot(snapshot_path: &Path, model: &AppModel) {
    let payload = snapshot_from_model(model);
    if let Some(parent) = snapshot_path.parent() {
        let _ = fs::create_dir_all(parent);
    }
    if let Ok(body) = serde_json::to_string_pretty(&payload) {
        let _ = fs::write(snapshot_path, body);
    }
}

fn spawn_supervisor(
    run_id: &str,
    event_log_dir: &Path,
) -> anyhow::Result<(std::process::Child, event_ingress::Receiver)> {
    let node = std::env::var_os("PAIROFCLEATS_TUI_NODE")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("launch the TUI through its verified wrapper"))?;
    let supervisor = std::env::var_os("PAIROFCLEATS_TUI_SUPERVISOR")
        .map(std::path::PathBuf::from)
        .ok_or_else(|| anyhow::anyhow!("missing verified supervisor path"))?;
    if !node.is_absolute() || !supervisor.is_absolute() || !supervisor.is_file() {
        anyhow::bail!("TUI implementation paths must be absolute verified files");
    }
    supervisor_lifetime::prepare_containment()?;
    let mut command = Command::new(&node);
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child = command
        .arg(&supervisor)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("PAIROFCLEATS_TUI_RUN_ID", run_id)
        .env("PAIROFCLEATS_TUI_EVENT_LOG_DIR", event_log_dir)
        .spawn()?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("missing supervisor stdout"))?;
    let (tx, rx) = event_ingress::channel();
    std::thread::spawn(move || {
        if let Err(error) = supervisor_transport::read_events(BufReader::new(stdout), &tx) {
            let _ = tx.send(json!({"event":"log", "level":"error", "source":"tui-transport",
                "message":format!("Supervisor output transport failed ({:?}); owned shutdown is required", error.kind())}));
        }
    });

    Ok((child, rx))
}

fn send_request(child: &mut std::process::Child, payload: Value) -> anyhow::Result<()> {
    let input = child
        .stdin
        .as_mut()
        .ok_or_else(|| anyhow::anyhow!("missing supervisor stdin"))?;
    input.write_all(payload.to_string().as_bytes())?;
    input.write_all(b"\n")?;
    input.flush()?;
    Ok(())
}

#[cfg(test)]
fn tail_window_slice<T: Clone>(items: &[T], scroll: usize, height: usize) -> Vec<T> {
    if items.is_empty() {
        return Vec::new();
    }
    let total = items.len();
    let end = total.saturating_sub(scroll.min(total));
    let safe_height = height.max(1);
    let start = end.saturating_sub(safe_height);
    items[start..end].to_vec()
}

fn frame_signature(model: &AppModel) -> String {
    // Collection owners advance one revision on replacement, append and eviction.
    // View-only checks never traverse or serialize retained logs/jobs/tasks.
    let workload = match model.workload_kind {
        WorkloadKind::Generic => Value::Null,
        WorkloadKind::Bench => json!(&model.bench_summary),
        WorkloadKind::Indexing => json!(&model.indexing_summary),
        WorkloadKind::Service => json!(&model.service_summary),
    };
    json!({
        "contentRevision": model.content_revision,
        "runId": model.run_id,
        "session": &model.session,
        "workloadKind": model.workload_kind.label(),
        "workload": workload,
        // Transport clocks/credits/input queues stay excluded. The visible
        // activity clock contributes only its bounded one-second revision below.
        "runtime": [json!(metric_label(model.telemetry.queue_depth_ewma)),
            json!(metric_label(model.telemetry.event_lag_ms_ewma)),
            json!(model.telemetry.native_inbound_pending)],
        "selectedJob": model.selected_job,
        "selectedJobPinned": model.selected_job_pinned,
        "selectedJobExpired": model.selected_job_expired,
        "ownsControl": model.owns_control_channel,
        "focus": model.focus_panel.label(),
        "follow": model.follow_updates,
        "filters": [model.job_filter.label(), model.task_filter.label(),
            model.log_level_filter.label(), model.log_source_filter.label()],
        "scroll": [model.job_scroll, model.task_scroll, model.log_scroll.get()],
        "search": [&model.search_jobs, &model.search_tasks, &model.search_logs],
        "searchTarget": model.search_target.label(),
        "searchDraft": model.search_draft,
        "paletteIndex": model.palette_index,
        "paletteQuery": model.palette_query,
        "helpRevision": model.help_revision,
        "activitySecond": model.activity_second,
        "maximized": model.maximized,
        "overlay": footer_hint_text(model, usize::MAX),
        "indexWorkflowRevision": if model.overlay == OverlayMode::IndexWorkflows {model.index_workflows.revision} else {0},
        "recordingRevision": if model.overlay == OverlayMode::Recordings {model.recording_revision} else {0},
        "settingsRevision": if model.overlay == OverlayMode::Settings {model.settings.revision} else {0},
        "repositorySearchRevision": if model.overlay == OverlayMode::RepositorySearch {model.repository_search.revision} else {0},
        "jobInspectionRevision": if model.overlay == OverlayMode::JobInspection {model.job_inspection.revision} else {0},
        "terminal": [model.terminal_caps.color, model.terminal_caps.unicode]
    }).to_string()
}

fn invalidate_frame(model: &mut AppModel) {
    model.last_render_signature.clear();
    model.dirty = true;
}

fn current_search(model: &AppModel, panel: FocusPanel) -> &str {
    match panel {
        FocusPanel::Jobs => &model.search_jobs,
        FocusPanel::Tasks => &model.search_tasks,
        FocusPanel::Logs => &model.search_logs,
    }
}

fn current_search_mut(model: &mut AppModel, panel: FocusPanel) -> &mut String {
    match panel {
        FocusPanel::Jobs => &mut model.search_jobs,
        FocusPanel::Tasks => &mut model.search_tasks,
        FocusPanel::Logs => &mut model.search_logs,
    }
}

fn clear_search(model: &mut AppModel, panel: FocusPanel) {
    current_search_mut(model, panel).clear();
    model.dirty = true;
}

fn matches_job_filter(status: &str, filter: JobFilter) -> bool {
    match filter {
        JobFilter::All => true,
        JobFilter::Active => Lifecycle::from_status(status) == Lifecycle::Active,
        JobFilter::Failed => Lifecycle::from_status(status).is_problem(),
        JobFilter::Done => Lifecycle::from_status(status) == Lifecycle::Done,
    }
}

fn matches_task_filter(status: &str, filter: TaskFilter) -> bool {
    match filter {
        TaskFilter::All => true,
        TaskFilter::Active => Lifecycle::from_status(status) == Lifecycle::Active,
        TaskFilter::Failed => Lifecycle::from_status(status).is_problem(),
        TaskFilter::Done => Lifecycle::from_status(status) == Lifecycle::Done,
    }
}

fn matches_log_level_filter(level: &str, filter: LogLevelFilter) -> bool {
    match filter {
        LogLevelFilter::All => true,
        LogLevelFilter::WarnError => level == "warn" || level == "error",
        LogLevelFilter::Error => level == "error",
    }
}

fn matches_log_source_filter(source: &str, filter: LogSourceFilter) -> bool {
    match filter {
        LogSourceFilter::All => true,
        LogSourceFilter::Supervisor => source == "supervisor" || source == "log",
        LogSourceFilter::Events => source != "supervisor" && source != "log",
    }
}

fn job_status_counts(model: &AppModel) -> (usize, usize, usize, usize) {
    let mut running = 0usize;
    let mut failed = 0usize;
    let mut done = 0usize;
    let mut cancelled = 0usize;
    for status in model.job_status.values() {
        if Lifecycle::from_status(status) == Lifecycle::Failed {
            failed += 1;
        } else if Lifecycle::from_status(status) == Lifecycle::Done {
            done += 1;
        } else if Lifecycle::from_status(status) == Lifecycle::Cancelled {
            cancelled += 1;
        } else if Lifecycle::from_status(status) == Lifecycle::Active {
            running += 1;
        }
    }
    (running, failed, done, cancelled)
}

fn task_status_counts(model: &AppModel) -> (usize, usize) {
    let mut active = 0usize;
    let mut failed = 0usize;
    for status in model.task_status.values() {
        if status.lifecycle().is_problem() {
            failed += 1;
        } else if status.lifecycle() == Lifecycle::Active {
            active += 1;
        }
    }
    (active, failed)
}

fn jobs_empty_reason(model: &AppModel) -> String {
    if !model.job_status.is_empty() {
        if model.job_filter != JobFilter::All || !model.search_jobs.trim().is_empty() {
            return "(no jobs match filter/search)".to_string();
        }
        return "(jobs available)".to_string();
    }
    match model.session.mode.as_str() {
        "replay" => "(replay session without derived jobs)".to_string(),
        "external-observability" => "(external stream without derived jobs)".to_string(),
        _ => {
            if model.telemetry.processed_events == 0 && model.logs.is_empty() {
                "(waiting for supervised jobs)".to_string()
            } else {
                "(no supervised jobs yet)".to_string()
            }
        }
    }
}

fn tasks_empty_reason(model: &AppModel) -> String {
    if model.task_filter != TaskFilter::All || !model.search_tasks.trim().is_empty() {
        return "(no tasks match filter/search)".to_string();
    }
    if let Some(job_id) = model.selected_job.as_ref() {
        return format!("(no tasks recorded for {job_id})");
    }
    if !model.job_status.is_empty() {
        return "(no job selected yet)".to_string();
    }
    match model.session.mode.as_str() {
        "replay" => "(replay session without derived tasks)".to_string(),
        "external-observability" => "(external stream without derived tasks)".to_string(),
        _ => "(waiting for supervised tasks)".to_string(),
    }
}

fn last_alert_summary(model: &AppModel) -> String {
    match model.alerts.back() {
        Some(alert) => format!("{} {}", alert.level, alert.message),
        None => "none".to_string(),
    }
}

fn fit_text(text: &str, width: usize) -> String {
    if width == 0 {
        return String::new();
    }
    let span = Span::raw(text);
    if span.width() <= width {
        return text.to_string();
    }
    let mut output = String::new();
    let mut columns = 0;
    for grapheme in span.styled_graphemes(Style::default()) {
        let next_width = Span::raw(grapheme.symbol).width();
        if columns + next_width > width.saturating_sub(1) {
            break;
        }
        output.push_str(grapheme.symbol);
        columns += next_width;
    }
    output.push('…');
    output
}

fn block_title(base: &str, focused: bool, extra: &[String]) -> String {
    let mut parts = vec![if focused {
        format!("{base} *")
    } else {
        base.to_string()
    }];
    for item in extra {
        if !item.trim().is_empty() {
            parts.push(item.trim().to_string());
        }
    }
    parts.join(" | ")
}

#[cfg(test)]
fn wrap_text_lines(text: &str, width: usize, max_lines: usize) -> Vec<String> {
    if width == 0 || max_lines == 0 {
        return Vec::new();
    }
    let mut output = Vec::new();
    for raw_line in text.split('\n') {
        let span = Span::raw(raw_line.trim());
        let graphemes: Vec<_> = span
            .styled_graphemes(Style::default())
            .map(|g| g.symbol)
            .collect();
        if graphemes.is_empty() {
            output.push(String::new());
            if output.len() >= max_lines {
                break;
            }
            continue;
        }
        let mut start = 0;
        while start < graphemes.len() && output.len() < max_lines {
            let mut end = start;
            let mut columns = 0;
            while end < graphemes.len() {
                let next_width = Span::raw(graphemes[end]).width();
                if columns + next_width > width {
                    break;
                }
                columns += next_width;
                end += 1;
            }
            if end == start {
                // A single grapheme wider than the pane still makes progress.
                output.push("…".into());
                start += 1;
                continue;
            }
            if end < graphemes.len() {
                if let Some(boundary) = (start + 1..end)
                    .rev()
                    .find(|i| graphemes[*i].trim().is_empty())
                {
                    end = boundary;
                }
            }
            output.push(graphemes[start..end].concat().trim_end().to_string());
            start = end;
            while start < graphemes.len() && graphemes[start].trim().is_empty() {
                start += 1;
            }
        }
        if output.len() >= max_lines {
            break;
        }
    }
    if output.len() == max_lines {
        if let Some(last) = output.last_mut() {
            *last = fit_text(last, width);
        }
    }
    output
}

fn session_summary_text(model: &AppModel, width: usize) -> String {
    let mut parts = vec![
        format!("mode {}", model.session.mode),
        format!("src {}", model.session.source),
        format!("conn {}", model.session.connection),
        format!("run {}", model.run_id),
    ];
    if width >= 96 && !model.session.scope.trim().is_empty() {
        parts.push(format!("scope {}", model.session.scope));
    }
    if !model.alerts.is_empty() {
        parts.push(format!("alert {}", last_alert_summary(model)));
    }
    fit_text(&parts.join(" | "), width)
}

fn push_unique_summary(values: &mut Vec<String>, value: &str) {
    let trimmed = value.trim();
    if trimmed.is_empty() || values.iter().any(|entry| entry == trimmed) {
        return;
    }
    values.push(trimmed.to_string());
}

fn update_workload_from_scope(model: &mut AppModel) {
    let scope = model.session.scope.trim().to_string();
    if let Some((lane, tier)) = scope.split_once(':') {
        if lane == "bench-language" {
            model.promote_workload_kind(WorkloadKind::Bench);
            if model.bench_summary.lane.is_empty() {
                model.bench_summary.lane = lane.to_string();
            }
            if model.bench_summary.tier.is_empty() {
                model.bench_summary.tier = tier.to_string();
            }
            return;
        }
        if lane == "service" {
            model.promote_workload_kind(WorkloadKind::Service);
            if model.service_summary.service.is_empty() {
                model.service_summary.service = tier.to_string();
            }
            return;
        }
        if lane == "repo" {
            model.promote_workload_kind(WorkloadKind::Indexing);
            if model.indexing_summary.repo.is_empty() {
                model.indexing_summary.repo = tier.to_string();
            }
        }
    }
}

fn apply_workload_descriptor(model: &mut AppModel, event: &Value) {
    let Some(workload) = event.get("workload").and_then(|value| value.as_object()) else {
        return;
    };
    match workload
        .get("kind")
        .and_then(|value| value.as_str())
        .unwrap_or("")
    {
        "bench" => {
            model.promote_workload_kind(WorkloadKind::Bench);
            if let Some(value) = workload.get("lane").and_then(|value| value.as_str()) {
                model.bench_summary.lane = value.trim().to_string();
            }
            if let Some(value) = workload.get("tier").and_then(|value| value.as_str()) {
                model.bench_summary.tier = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("activeRepo")
                .or_else(|| workload.get("repo"))
                .and_then(|value| value.as_str())
            {
                model.bench_summary.active_repo = value.trim().to_string();
            }
            if let Some(values) = workload
                .get("degradedProviders")
                .and_then(|value| value.as_array())
            {
                for value in values.iter().filter_map(|entry| entry.as_str()) {
                    push_unique_summary(&mut model.bench_summary.degraded_providers, value);
                }
            }
            if let Some(value) = workload
                .get("retainedCrashCount")
                .and_then(|value| value.as_u64())
            {
                model.bench_summary.retained_crash_count = value;
            }
            if let Some(value) = workload
                .get("unresolvedImportCount")
                .and_then(|value| value.as_u64())
            {
                model.bench_summary.unresolved_import_count = value;
            }
            if let Some(values) = workload
                .get("qualitySignals")
                .and_then(|value| value.as_array())
            {
                for value in values.iter().filter_map(|entry| entry.as_str()) {
                    push_unique_summary(&mut model.bench_summary.quality_signals, value);
                }
            }
            if let Some(value) = workload
                .get("artifactStall")
                .or_else(|| workload.get("currentArtifactStall"))
                .and_then(|value| value.as_str())
            {
                model.bench_summary.artifact_stall = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("timeoutState")
                .or_else(|| workload.get("timeout"))
                .and_then(|value| value.as_str())
            {
                model.bench_summary.timeout_state = value.trim().to_string();
            }
        }
        "indexing" => {
            model.promote_workload_kind(WorkloadKind::Indexing);
            if let Some(value) = workload.get("repo").and_then(|value| value.as_str()) {
                model.indexing_summary.repo = value.trim().to_string();
            }
            if let Some(value) = workload.get("stage").and_then(|value| value.as_str()) {
                model.indexing_summary.stage = value.trim().to_string();
            }
            if let Some(value) = workload.get("mode").and_then(|value| value.as_str()) {
                model.indexing_summary.mode = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("heartbeatAgeMs")
                .and_then(|value| value.as_u64())
            {
                model.indexing_summary.heartbeat_age_ms = Some(value);
                model.indexing_summary.heartbeat_observed_ms =
                    Some(if model.session.mode == "replay" {
                        model.recorded_ms.unwrap_or(0)
                    } else {
                        model
                            .activity_origin
                            .elapsed()
                            .as_millis()
                            .min(u64::MAX as u128) as u64
                    });
            }
            if let Some(value) = workload
                .get("artifactWriteProgress")
                .and_then(|value| value.as_str())
            {
                model.indexing_summary.artifact_write_progress = value.trim().to_string();
            }
            if let Some(value) = workload.get("sqliteState").and_then(|value| value.as_str()) {
                model.indexing_summary.sqlite_state = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("validationState")
                .and_then(|value| value.as_str())
            {
                model.indexing_summary.validation_state = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("promotionState")
                .and_then(|value| value.as_str())
            {
                model.indexing_summary.promotion_state = value.trim().to_string();
            }
        }
        "service" => {
            model.promote_workload_kind(WorkloadKind::Service);
            if let Some(value) = workload
                .get("service")
                .or_else(|| workload.get("name"))
                .and_then(|value| value.as_str())
            {
                model.service_summary.service = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("activeWorkers")
                .and_then(|value| value.as_u64())
            {
                model.service_summary.active_workers = Some(value);
            }
            if let Some(value) = workload.get("activeJobs").and_then(|value| value.as_u64()) {
                model.service_summary.active_jobs = Some(value);
            }
            if let Some(value) = workload.get("retryCount").and_then(|value| value.as_u64()) {
                model.service_summary.retry_count = value;
            }
            if let Some(value) = workload
                .get("quarantineState")
                .and_then(|value| value.as_str())
            {
                model.service_summary.quarantine_state = value.trim().to_string();
            }
            if let Some(value) = workload
                .get("shutdownState")
                .and_then(|value| value.as_str())
            {
                model.service_summary.shutdown_state = value.trim().to_string();
            }
            if let Some(value) = workload.get("queueDepth").and_then(|value| value.as_u64()) {
                model.service_summary.queue_depth = Some(value);
            }
        }
        _ => {}
    }
    model.dirty = true;
}

fn workload_summary_text(model: &AppModel, width: usize) -> String {
    let mut parts = Vec::new();
    match model.workload_kind {
        WorkloadKind::Bench => {
            if !model.bench_summary.active_repo.is_empty() {
                parts.push(format!("repo {}", model.bench_summary.active_repo));
            }
            if !model.bench_summary.tier.is_empty() {
                parts.push(format!("tier {}", model.bench_summary.tier));
            }
            if !model.bench_summary.lane.is_empty() {
                parts.push(format!("lane {}", model.bench_summary.lane));
            }
            if !model.bench_summary.degraded_providers.is_empty() {
                parts.push(format!(
                    "degraded {}",
                    model.bench_summary.degraded_providers.join(",")
                ));
            }
            if !model.bench_summary.artifact_stall.is_empty() {
                parts.push(format!("stall {}", model.bench_summary.artifact_stall));
            }
            if !model.bench_summary.timeout_state.is_empty() {
                parts.push(format!("timeout {}", model.bench_summary.timeout_state));
            }
            if model.bench_summary.retained_crash_count > 0 {
                parts.push(format!(
                    "crashes {}",
                    model.bench_summary.retained_crash_count
                ));
            }
            if model.bench_summary.unresolved_import_count > 0 {
                parts.push(format!(
                    "imports {}",
                    model.bench_summary.unresolved_import_count
                ));
            }
            if !model.bench_summary.quality_signals.is_empty() {
                parts.push(format!(
                    "quality {}",
                    model.bench_summary.quality_signals.join(",")
                ));
            }
        }
        WorkloadKind::Indexing => {
            if !model.indexing_summary.repo.is_empty() {
                parts.push(format!("repo {}", model.indexing_summary.repo));
            }
            if !model.indexing_summary.stage.is_empty() {
                parts.push(format!("stage {}", model.indexing_summary.stage));
            }
            if !model.indexing_summary.mode.is_empty() {
                parts.push(format!("mode {}", model.indexing_summary.mode));
            }
            if !model.indexing_summary.sqlite_state.is_empty() {
                parts.push(format!("sqlite {}", model.indexing_summary.sqlite_state));
            }
            if !model.indexing_summary.validation_state.is_empty() {
                parts.push(format!(
                    "validate {}",
                    model.indexing_summary.validation_state
                ));
            }
            if !model.indexing_summary.promotion_state.is_empty() {
                parts.push(format!(
                    "promote {}",
                    model.indexing_summary.promotion_state
                ));
            }
            if let Some(value) = model.indexing_summary.heartbeat_age_ms {
                let now = if model.session.mode == "replay" {
                    model.recorded_ms.unwrap_or(0)
                } else {
                    model.activity_second * 1000
                };
                let age = value.saturating_add(
                    now.saturating_sub(model.indexing_summary.heartbeat_observed_ms.unwrap_or(now)),
                );
                parts.push(format!(
                    "heartbeat {age}ms since observed{}",
                    if model.session.mode == "replay" {
                        " (recorded time)"
                    } else {
                        ""
                    }
                ));
            }
            if !model.indexing_summary.artifact_write_progress.is_empty() {
                parts.push(format!(
                    "artifacts {}",
                    model.indexing_summary.artifact_write_progress
                ));
            }
        }
        WorkloadKind::Service => {
            if !model.service_summary.service.is_empty() {
                parts.push(format!("service {}", model.service_summary.service));
            }
            if let Some(value) = model.service_summary.active_workers {
                parts.push(format!("workers {value}"));
            }
            if let Some(value) = model.service_summary.active_jobs {
                parts.push(format!("jobs {value}"));
            }
            if let Some(value) = model.service_summary.queue_depth {
                parts.push(format!("queue {value}"));
            }
            if model.service_summary.retry_count > 0 {
                parts.push(format!("retries {}", model.service_summary.retry_count));
            }
            if !model.service_summary.quarantine_state.is_empty() {
                parts.push(format!(
                    "quarantine {}",
                    model.service_summary.quarantine_state
                ));
            }
            if !model.service_summary.shutdown_state.is_empty() {
                parts.push(format!("shutdown {}", model.service_summary.shutdown_state));
            }
        }
        WorkloadKind::Generic => {}
    }
    if parts.is_empty() {
        parts.push("no workload-specific summary yet".to_string());
    }
    fit_text(&parts.join(" | "), width)
}

fn operator_summary_text(model: &AppModel, width: usize) -> String {
    let mut parts = vec![
        format!("focus {}", model.focus_panel.label()),
        format!(
            "follow {}",
            if model.follow_updates {
                "live"
            } else {
                "paused"
            }
        ),
        format!(
            "selected {} ({}){}",
            model.selected_job.as_deref().unwrap_or("none"),
            if model.selected_job_pinned {
                "pinned"
            } else {
                "following"
            },
            if model.selected_job_expired
                || model
                    .selected_job
                    .as_deref()
                    .is_some_and(|id| !visible_job_ids(model).contains(&id))
            {
                " hidden/unavailable; cancel disabled"
            } else {
                ""
            }
        ),
    ];
    let active_search = current_search(model, model.focus_panel);
    if !active_search.trim().is_empty() {
        parts.push(format!("search {}", active_search.trim()));
    }
    // Each panel already displays its filters. Preserve selected identity and
    // the active text predicate before repeating those controls in wider views.
    if width >= 120 {
        parts.extend([
            format!("jobs {}", model.job_filter.label()),
            format!("tasks {}", model.task_filter.label()),
            format!(
                "logs {}/{}",
                model.log_level_filter.label(),
                model.log_source_filter.label()
            ),
        ]);
    }
    fit_text(&parts.join(" | "), width)
}

fn metric_label(value: Option<f64>) -> String {
    value
        .map(|number| format!("{number:.0}"))
        .unwrap_or_else(|| "?".to_string())
}

fn runtime_summary_text(model: &AppModel, width: usize) -> String {
    let (running_jobs, failed_jobs, done_jobs, cancelled_jobs) = job_status_counts(model);
    let interrupted = model
        .job_status
        .values()
        .filter(|status| Lifecycle::from_status(status) == Lifecycle::Interrupted)
        .count();
    let (active_tasks, failed_tasks) = task_status_counts(model);
    let parts = [
        format!(
            "jobs {running_jobs}run/{failed_jobs}fail/{done_jobs}done/{cancelled_jobs}cancel{}",
            if interrupted > 0 {
                format!("/{interrupted}interrupted")
            } else {
                String::new()
            }
        ),
        format!("tasks {active_tasks}a/{failed_tasks}f"),
        format!(
            "flow queue {}",
            metric_label(model.telemetry.queue_depth_ewma)
        ),
        format!(
            "ingress lag {}ms",
            metric_label(model.telemetry.event_lag_ms_ewma)
        ),
        format!(
            "native pending {}",
            model
                .telemetry
                .native_inbound_pending
                .map(|value| value.to_string())
                .unwrap_or_else(|| "?".to_string())
        ),
        format!("render {:.0}ms", model.telemetry.render_ms_ewma),
        format!("note {}", model.session.note),
    ];
    fit_text(&parts.join(" | "), width)
}

fn footer_hint_text(model: &AppModel, width: usize) -> String {
    if model.overlay == OverlayMode::None {
        return fit_text(&actions::footer(), width);
    }
    let text = match model.overlay {
        OverlayMode::Help => "help | arrows/Page/Home/End scroll | Esc or ? close",
        OverlayMode::Palette => "action palette | type filter | arrows move | Enter select | Esc close",
        OverlayMode::Search => "search | type to filter current panel | Enter apply | Backspace delete | Esc cancel",
        OverlayMode::IndexWorkflows => "Command workflows | typed forms | preview then confirm | Esc back/cancel | Ctrl+C quit",
        OverlayMode::Settings => "settings | Ctrl+U clears input | Esc cancels or closes | Ctrl+C quits",
        OverlayMode::RepositorySearch => "Repository search | Tab field | Enter submit/source | Esc back/cancel | Ctrl+C quit",
        OverlayMode::JobInspection => "Job inspection | 1 summary | 2 result | 3 artifacts | Tab page | Esc close | Ctrl+C quit",
        OverlayMode::Recordings => "Saved sessions | Enter choose/load | Ctrl+U clears | Esc cancels/closes | Ctrl+C quits",
        OverlayMode::None => "R search | b commands | O sessions | s settings | Tab pane | z maximize | / panel text | : actions | ? help | q quit",
    };
    fit_text(text, width)
}

#[cfg(test)]
fn list_viewport<T>(rows: Vec<T>, scroll: usize, height: usize) -> Vec<T> {
    let start = scroll.min(rows.len().saturating_sub(height));
    rows.into_iter().skip(start).take(height).collect()
}

fn job_row_text(model: &AppModel, id: &str, status: &str) -> String {
    let title = model.job_titles.get(id).map(String::as_str).unwrap_or("");
    if title.is_empty() {
        format!("{id} | {status}")
    } else {
        format!("{id} | {status} | {title}")
    }
}

fn visible_job_ids(model: &AppModel) -> Vec<&str> {
    let query = model.search_jobs.trim().to_lowercase();
    model
        .job_order
        .iter()
        .filter_map(|id| {
            let status = model.job_status.get(id)?;
            (matches_job_filter(status, model.job_filter)
                && (query.is_empty()
                    || job_row_text(model, id, status)
                        .to_lowercase()
                        .contains(&query)))
            .then_some(id.as_str())
        })
        .collect()
}

fn select_job(model: &mut AppModel, direction: isize) {
    let rows = visible_job_ids(model);
    if rows.is_empty() {
        model.push_alert(
            "info",
            "No visible job to select; the current selection is unchanged",
        );
        return;
    }
    let current = rows
        .iter()
        .position(|id| Some(*id) == model.selected_job.as_deref());
    let index = match current {
        Some(index) if direction < 0 => index.saturating_sub(1),
        Some(index) => (index + 1).min(rows.len() - 1),
        None if direction < 0 => rows.len() - 1,
        None => 0,
    };
    let selected = rows[index].to_owned();
    pin_visible_job(model, &selected);
    model.job_scroll = index;
}

fn pin_visible_job(model: &mut AppModel, id: &str) {
    if !visible_job_ids(model).contains(&id) {
        return;
    }
    model.selected_job = Some(id.into());
    model.selected_job_pinned = true;
    model.selected_job_expired = false;
    model.task_scroll = 0;
    model.log_scroll.set(0);
    model.dirty = true;
}

fn follow_latest_job(model: &mut AppModel) {
    let rows = visible_job_ids(model);
    let index = rows.len().saturating_sub(1);
    let selected = rows.last().map(|id| (*id).to_owned());
    model.selected_job = selected;
    model.job_scroll = index;
    model.selected_job_pinned = false;
    model.selected_job_expired = false;
    model.task_scroll = 0;
    model.log_scroll.set(0);
    model.dirty = true;
}

fn selected_job_cancelable(model: &AppModel) -> bool {
    !model.selected_job_expired
        && has_live_control(model)
        && model.selected_job.as_ref().is_some_and(|id| {
            visible_job_ids(model).contains(&id.as_str())
                && model
                    .job_status
                    .get(id)
                    .is_some_and(|status| matches!(status.as_str(), "accepted" | "running"))
        })
}

fn selected_job_cancel_request(model: &mut AppModel) -> Option<Value> {
    let id = model.selected_job.clone()?;
    if !has_live_control(model) {
        model.push_alert(
            "info",
            "Cancellation requires the session's verified supervisor control channel",
        );
        return None;
    }
    if model.selected_job_expired {
        model.push_alert(
            "info",
            "The selected job instance expired; explicitly reselect before cancelling",
        );
        return None;
    }
    if !selected_job_cancelable(model) {
        model.push_alert("info", "Select a visible running job before cancelling; hidden, expired and completed jobs are unchanged");
        return None;
    }
    Some(json!({"proto":"poc.tui@1", "op":"job:cancel", "jobId":id, "reason":"user_cancel"}))
}

fn send_selected_job_cancel(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
) -> anyhow::Result<()> {
    if let Some(request) = selected_job_cancel_request(model) {
        let id = request["jobId"].as_str().unwrap().to_owned();
        send_request(supervisor, request)?;
        // This records the local request only. The producer's terminal event
        // still decides the outcome after its owned execution actually settles.
        model.update_job_status(&id, "cancelling", None);
    }
    Ok(())
}

#[cfg(test)]
thread_local! { static ROW_PRESENTATIONS: std::cell::Cell<(usize, usize)> = const { std::cell::Cell::new((0, 0)) }; }

fn build_job_rows(
    model: &AppModel,
    width: usize,
    height: usize,
) -> (Vec<ListItem<'static>>, Option<usize>) {
    if height == 0 {
        return (Vec::new(), None);
    }
    let ids = visible_job_ids(model);
    if ids.is_empty() {
        return (
            vec![ListItem::new(fit_text(&jobs_empty_reason(model), width))],
            None,
        );
    }
    let start = model.job_scroll.min(ids.len().saturating_sub(height));
    let selected_row = if model.selected_job_expired {
        None
    } else {
        ids.iter()
            .position(|id| Some(*id) == model.selected_job.as_deref())
            .filter(|index| *index >= start && *index < start + height)
            .map(|index| index - start)
    };
    let mut rows = Vec::with_capacity(height.min(ids.len()));
    for job_id in ids.into_iter().skip(start).take(height) {
        let status = &model.job_status[job_id];
        let rendered = job_row_text(model, job_id, status);
        #[cfg(test)]
        ROW_PRESENTATIONS.with(|count| {
            let (jobs, tasks) = count.get();
            count.set((jobs + 1, tasks));
        });
        let style = if !model.terminal_caps.color {
            Style::default()
        } else if !model.selected_job_expired && model.selected_job.as_deref() == Some(job_id) {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
        } else if Lifecycle::from_status(status) == Lifecycle::Done {
            Style::default().fg(Color::Green)
        } else if Lifecycle::from_status(status).is_problem()
            && Lifecycle::from_status(status) != Lifecycle::Cancelled
        {
            Style::default().fg(Color::Red)
        } else if Lifecycle::from_status(status) == Lifecycle::Cancelled {
            Style::default().fg(Color::Yellow)
        } else if Lifecycle::from_status(status) == Lifecycle::Active {
            Style::default().fg(Color::Blue)
        } else {
            Style::default().fg(Color::Gray)
        };
        rows.push(ListItem::new(fit_text(&rendered, width)).style(style));
    }
    (rows, selected_row)
}

fn render_job_panel(frame: &mut ratatui::Frame<'_>, model: &AppModel, area: ratatui::layout::Rect) {
    interaction::record_jobs(model, area);
    let height = area.height.saturating_sub(2) as usize;
    let query = model.search_jobs.trim();
    let (rows, selected_row) = build_job_rows(model, area.width.saturating_sub(2) as usize, height);
    let list = List::new(rows).block(panel_block(
        block_title(
            "Jobs",
            model.focus_panel == FocusPanel::Jobs,
            &[
                format!("filter {}", model.job_filter.label()),
                if query.is_empty() {
                    String::new()
                } else {
                    format!("search {query}")
                },
            ],
        ),
        model.focus_panel == FocusPanel::Jobs,
        model.terminal_caps.color,
    ));
    frame.render_widget(list, area);
    if model.selected_job_expired || area.width < 2 || height == 0 {
        return;
    }
    if let Some(row) = selected_row {
        // Marker and visible rows share the exact same filtered sequence.
        frame.buffer_mut()[(area.x, area.y + 1 + row as u16)].set_symbol(">");
    }
}

fn visible_task_keys(model: &AppModel) -> Vec<&String> {
    let selected = model.selected_job.as_deref().unwrap_or("");
    let query = model.search_tasks.trim().to_lowercase();
    model
        .task_order
        .iter()
        .filter(|key| {
            let identity = model.task_identity.get(*key);
            if !selected.is_empty() && identity.map(|(owner, _)| owner.as_str()) != Some(selected) {
                return false;
            }
            let Some(task) = model.task_status.get(*key) else {
                return false;
            };
            if !matches_task_filter(&task.status, model.task_filter) {
                return false;
            }
            if query.is_empty() {
                return true;
            }
            let name = identity.map(|(_, id)| id.as_str()).unwrap_or(key);
            format!("{name} | {task}").to_lowercase().contains(&query)
        })
        .collect()
}

fn build_task_rows(model: &AppModel, width: usize, height: usize) -> Vec<ListItem<'static>> {
    if height == 0 {
        return Vec::new();
    }
    if model.selected_job_expired {
        return vec![ListItem::new(fit_text(
            "Selected job instance expired; reselect a visible job",
            width,
        ))];
    }
    let keys = visible_task_keys(model);
    if keys.is_empty() {
        return vec![ListItem::new(fit_text(&tasks_empty_reason(model), width))];
    }
    let start = model.task_scroll.min(keys.len().saturating_sub(height));
    keys.into_iter()
        .skip(start)
        .take(height)
        .map(|key| {
            let task = &model.task_status[key];
            let name = model
                .task_identity
                .get(key)
                .map(|(_, id)| id.as_str())
                .unwrap_or(key);
            let rendered = format!("{name} | {task}");
            #[cfg(test)]
            ROW_PRESENTATIONS.with(|count| {
                let (jobs, tasks) = count.get();
                count.set((jobs, tasks + 1));
            });
            let style = if !model.terminal_caps.color {
                Style::default()
            } else if task.lifecycle().is_problem() {
                Style::default().fg(Color::Red)
            } else if task.lifecycle() == Lifecycle::Done {
                Style::default().fg(Color::Green)
            } else {
                Style::default().fg(Color::Yellow)
            };
            ListItem::new(fit_text(&rendered, width)).style(style)
        })
        .collect()
}

#[cfg(test)]
thread_local! { static LOG_FORMATS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) }; }

fn render_log_entry(entry: &LogEntry) -> String {
    #[cfg(test)]
    LOG_FORMATS.with(|count| count.set(count.get() + 1));
    let text = entry.text.trim();
    match entry.level.as_str() {
        "warn" | "error" => format!("{} | {} | {}", entry.level, entry.source, text),
        _ => format!("{} | {}", entry.source, text),
    }
}

fn logs_empty_reason(model: &AppModel) -> String {
    if model.log_level_filter != LogLevelFilter::All
        || model.log_source_filter != LogSourceFilter::All
        || !model.search_logs.trim().is_empty()
    {
        return "(no logs match filter/search)".to_string();
    }
    "(no logs yet)".to_string()
}

fn build_log_lines(model: &AppModel, width: usize, height: usize) -> String {
    if width == 0 || height == 0 {
        return String::new();
    }
    let query = model.search_logs.trim().to_lowercase();
    let filter = format!(
        "{}|{}|{:?}|{}|{query}",
        model.log_level_filter.label(),
        model.log_source_filter.label(),
        model.selected_job,
        model.selected_job_expired
    );
    let requested = model.log_scroll.get();
    let mut anchor = model
        .log_layout_cache
        .borrow()
        .viewport
        .clone()
        .filter(|anchor| {
            !model.follow_updates && anchor.scroll == requested && anchor.filter == filter
        });
    let expired_anchor = anchor
        .as_ref()
        .is_some_and(|anchor| !model.logs.iter().any(|entry| entry.id == anchor.id));
    let mut remaining = if expired_anchor {
        usize::MAX
    } else {
        requested
    };
    if expired_anchor {
        anchor = None;
    }
    let preserve_bottom = anchor.is_some();
    let mut skipped: usize = 0;
    let mut bottom = None;
    let mut lines = Vec::new();
    for entry in model
        .logs
        .iter()
        .rev()
        .filter(|entry| matches_log_entry_with_query(model, entry, &query))
    {
        if anchor.as_ref().is_some_and(|anchor| entry.id != anchor.id) {
            let window =
                model
                    .log_layout_cache
                    .borrow_mut()
                    .window(entry.id, width, 0, 0, None, || render_log_entry(entry));
            skipped = skipped.saturating_add(window.total_rows);
            continue;
        }
        let anchor_end = anchor.take().map(|anchor| anchor.end);
        if anchor_end.is_some() {
            remaining = 0;
        }
        let window = model.log_layout_cache.borrow_mut().window(
            entry.id,
            width,
            height - lines.len(),
            remaining,
            anchor_end,
            || render_log_entry(entry),
        );
        skipped = skipped.saturating_add(window.skipped_rows);
        remaining = remaining.saturating_sub(window.total_rows);
        if bottom.is_none() {
            if let Some(end) = window.bottom_end {
                bottom = Some((entry.id, end));
            }
        }
        lines.extend(window.lines.into_iter().rev());
        if lines.len() >= height {
            break;
        }
    }
    // Clamp the stored row offset, including restored huge values and anchors
    // whose retained source entry was evicted. A second bounded selection fills
    // the oldest viewport; no hidden row strings are materialized.
    if lines.len() < height && skipped > 0 && !preserve_bottom {
        model
            .log_scroll
            .set(skipped.saturating_add(lines.len()).saturating_sub(height));
        model.log_layout_cache.borrow_mut().set_viewport(None);
        return build_log_lines(model, width, height);
    }
    model.log_scroll.set(skipped);
    model
        .log_layout_cache
        .borrow_mut()
        .set_viewport(bottom.map(|(id, end)| log_layout::ViewportAnchor {
            id,
            end,
            scroll: skipped,
            filter,
        }));
    if lines.is_empty() {
        lines.push(logs_empty_reason(model));
    }
    lines.reverse();
    lines.join("\n")
}

fn matches_log_entry_with_query(model: &AppModel, entry: &LogEntry, query: &str) -> bool {
    (entry.job_id.is_none()
        || (!model.selected_job_expired
            && (model.selected_job.is_none() || entry.job_id == model.selected_job)))
        && matches_log_level_filter(&entry.level, model.log_level_filter)
        && matches_log_source_filter(&entry.source, model.log_source_filter)
        && (query.is_empty() || render_log_entry(entry).to_lowercase().contains(query))
}

fn toggle_follow(model: &mut AppModel) {
    model.follow_updates = !model.follow_updates;
    if model.follow_updates {
        model.log_scroll.set(0);
    }
    model.dirty = true;
}

fn panel_block(title: String, focused: bool, color: bool) -> Block<'static> {
    let mut block = Block::default().borders(Borders::ALL).title(title);
    if color && focused {
        block = block.border_style(
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        );
    }
    block
}

fn render_help_overlay(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let area = interaction::overlay_rect(OverlayMode::Help, frame.area());
    if area.width < 24 || area.height < 5 {
        frame.render_widget(Clear, frame.area());
        frame.render_widget(
            Paragraph::new("Help: Esc/F1 back\nCtrl+C quit\nResize for reference"),
            frame.area(),
        );
        return;
    }
    let rows = model.help_viewport.lines(
        vec![format!(
            "Help | arrows/Page/Home/End | / filter: {}{} | Esc close",
            model.help_query,
            if model.help_editing {
                " (typing; Enter ends)"
            } else {
                ""
            }
        )],
        &interaction::help_text(model),
        area.height.saturating_sub(2) as usize,
        area.width.saturating_sub(2) as usize,
    );
    frame.render_widget(Clear, area);
    frame.render_widget(
        Paragraph::new(rows.join("\n")).block(panel_block(
            format!("Help | Esc close | {}", model.help_viewport.range_label()),
            true,
            model.terminal_caps.color,
        )),
        area,
    );
}

fn palette_actions() -> Vec<PaletteAction> {
    actions::registered()
}

fn render_palette_overlay(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let actions = interaction::actions(model);
    let area = interaction::overlay_rect(OverlayMode::Palette, frame.area());
    if area.width < 24 || area.height < 6 {
        frame.render_widget(Clear, frame.area());
        frame.render_widget(
            Paragraph::new("Actions: Esc close\nCtrl+C quit\nResize for actions"),
            frame.area(),
        );
        return;
    }
    let height = area.height.saturating_sub(5) as usize;
    let start = (if model.palette_index < actions.len() {
        model.palette_index
    } else {
        0
    })
    .saturating_sub(height.saturating_sub(1))
    .min(actions.len().saturating_sub(height));
    let inner = Rect::new(
        area.x + 1,
        area.y + 1,
        area.width.saturating_sub(2),
        area.height.saturating_sub(2),
    );
    let selected = actions.get(model.palette_index).copied();
    let selection = selected
        .map(|action| {
            interaction::disabled(model, action)
                .map(|reason| format!("Disabled: {reason}"))
                .unwrap_or_else(|| format!("Selected: {}", action.label()))
        })
        .unwrap_or_else(|| "Arrows choose a visible action; Enter requires selection".into());
    frame.render_widget(Clear, area);
    frame.render_widget(
        panel_block(
            "Actions | Esc close".into(),
            true,
            model.terminal_caps.color,
        ),
        area,
    );
    frame.render_widget(
        Paragraph::new(format!(
            "{}\n{}",
            fit_text(
                &format!(
                    "{}-{} / {} | filter {}",
                    if actions.is_empty() { 0 } else { start + 1 },
                    (start + height).min(actions.len()),
                    actions.len(),
                    model.panel_cursor.visible(
                        &model.palette_query,
                        inner.width.saturating_sub(20) as usize
                    )
                ),
                inner.width as usize
            ),
            selection
        ))
        .wrap(Wrap { trim: false }),
        Rect::new(inner.x, inner.y, inner.width, 3),
    );
    let list_area = Rect::new(inner.x, inner.y + 3, inner.width, height as u16);
    interaction::record_palette(
        model,
        actions
            .iter()
            .copied()
            .enumerate()
            .skip(start)
            .take(height)
            .map(|(index, action)| {
                (
                    Rect::new(
                        list_area.x,
                        list_area.y + (index - start) as u16,
                        list_area.width,
                        1,
                    ),
                    action,
                )
            })
            .collect(),
    );
    let rows: Vec<ListItem<'static>> = actions
        .iter()
        .enumerate()
        .skip(start)
        .take(height)
        .map(|(index, action)| {
            let prefix = if index == model.palette_index {
                ">"
            } else {
                " "
            };
            let style = if model.terminal_caps.color && index == model.palette_index {
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD)
            } else {
                Style::default()
            };
            ListItem::new(fit_text(
                &format!(
                    "{prefix} [{}] {}{}",
                    interaction::action_shortcut(*action),
                    action.label(),
                    interaction::disabled(model, *action)
                        .map(|reason| format!(" [disabled: {reason}]"))
                        .unwrap_or_default()
                ),
                area.width.saturating_sub(2) as usize,
            ))
            .style(style)
        })
        .collect();
    frame.render_widget(List::new(rows), list_area);
}

fn render_search_overlay(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let area = interaction::overlay_rect(OverlayMode::Search, frame.area());
    let text = format!(
        "Search {}\n\n{}\n\nEnter apply | Esc cancel | Backspace delete",
        model.search_target.label(),
        if model.search_draft.is_empty() {
            "Type to filter".to_string()
        } else {
            model
                .panel_cursor
                .visible(&model.search_draft, area.width.saturating_sub(2) as usize)
        }
    );
    let overlay = Paragraph::new(text)
        .wrap(Wrap { trim: true })
        .block(panel_block(
            "Panel text filter | Esc close".to_string(),
            true,
            model.terminal_caps.color,
        ));
    frame.render_widget(Clear, area);
    frame.render_widget(overlay, area);
}

fn centered_rect(
    percent_x: u16,
    percent_y: u16,
    area: ratatui::layout::Rect,
) -> ratatui::layout::Rect {
    let popup_layout = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage((100 - percent_y) / 2),
            Constraint::Percentage(percent_y),
            Constraint::Percentage((100 - percent_y) / 2),
        ])
        .split(area);
    Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage((100 - percent_x) / 2),
            Constraint::Percentage(percent_x),
            Constraint::Percentage((100 - percent_x) / 2),
        ])
        .split(popup_layout[1])[1]
}

fn render_ui(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    interaction::record_geometry(model, frame.area());
    if interaction::compact(model, frame.area()) {
        interaction::render_compact(frame, model);
    } else {
        let session_width = frame.area().width.saturating_sub(2) as usize;
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Length(1),
                Constraint::Min(1),
            ])
            .split(frame.area());

        let session_block = Paragraph::new(session_summary_text(model, session_width))
            .wrap(Wrap { trim: true })
            .block(Block::default().borders(Borders::ALL).title("Session"));
        frame.render_widget(session_block, rows[0]);

        let control_block = Paragraph::new(operator_summary_text(model, session_width))
            .wrap(Wrap { trim: true })
            .block(Block::default().borders(Borders::ALL).title("Operator"));
        frame.render_widget(control_block, rows[1]);

        let metrics_block = Paragraph::new(runtime_summary_text(model, session_width))
            .wrap(Wrap { trim: true })
            .block(Block::default().borders(Borders::ALL).title("Runtime"));
        frame.render_widget(metrics_block, rows[2]);

        let workload_block = Paragraph::new(workload_summary_text(model, session_width))
            .wrap(Wrap { trim: true })
            .block(
                Block::default()
                    .borders(Borders::ALL)
                    .title(model.workload_kind.label()),
            );
        frame.render_widget(workload_block, rows[3]);

        let footer_block = Paragraph::new(footer_hint_text(model, session_width))
            .wrap(Wrap { trim: true })
            .block(Block::default().borders(Borders::ALL).title("Hints"));
        frame.render_widget(footer_block, rows[4]);
        frame.render_widget(Paragraph::new(interaction::activity_text(model)), rows[5]);

        if rows[6].width < 100 {
            let stacked = Layout::default()
                .direction(Direction::Vertical)
                .constraints([
                    Constraint::Percentage(30),
                    Constraint::Percentage(30),
                    Constraint::Percentage(40),
                ])
                .split(rows[6]);
            let tasks_width = stacked[1].width.saturating_sub(2) as usize;
            let logs_width = stacked[2].width.saturating_sub(2) as usize;
            render_job_panel(frame, model, stacked[0]);
            let tasks = List::new(build_task_rows(
                model,
                tasks_width,
                stacked[1].height.saturating_sub(2) as usize,
            ))
            .block(panel_block(
                block_title(
                    "Tasks",
                    model.focus_panel == FocusPanel::Tasks,
                    &[format!("filter {}", model.task_filter.label()), {
                        let query = model.search_tasks.trim();
                        if query.is_empty() {
                            String::new()
                        } else {
                            format!("search {query}")
                        }
                    }],
                ),
                model.focus_panel == FocusPanel::Tasks,
                model.terminal_caps.color,
            ));
            frame.render_widget(tasks, stacked[1]);
            let logs = Paragraph::new(build_log_lines(
                model,
                logs_width,
                stacked[2].height.saturating_sub(2) as usize,
            ))
            .wrap(Wrap { trim: true })
            .block(panel_block(
                block_title(
                    "Logs",
                    model.focus_panel == FocusPanel::Logs,
                    &[
                        format!(
                            "filter {}/{}",
                            model.log_level_filter.label(),
                            model.log_source_filter.label()
                        ),
                        if model.follow_updates {
                            "follow live".to_string()
                        } else {
                            "follow paused".to_string()
                        },
                        {
                            let query = model.search_logs.trim();
                            if query.is_empty() {
                                String::new()
                            } else {
                                format!("search {query}")
                            }
                        },
                    ],
                ),
                model.focus_panel == FocusPanel::Logs,
                model.terminal_caps.color,
            ));
            frame.render_widget(logs, stacked[2]);
        } else {
            let cols = Layout::default()
                .direction(Direction::Horizontal)
                .constraints([
                    Constraint::Percentage(28),
                    Constraint::Percentage(28),
                    Constraint::Percentage(44),
                ])
                .split(rows[6]);

            let tasks_width = cols[1].width.saturating_sub(2) as usize;
            let logs_width = cols[2].width.saturating_sub(2) as usize;

            render_job_panel(frame, model, cols[0]);

            let tasks = List::new(build_task_rows(
                model,
                tasks_width,
                cols[1].height.saturating_sub(2) as usize,
            ))
            .block(panel_block(
                block_title(
                    "Tasks",
                    model.focus_panel == FocusPanel::Tasks,
                    &[format!("filter {}", model.task_filter.label()), {
                        let query = model.search_tasks.trim();
                        if query.is_empty() {
                            String::new()
                        } else {
                            format!("search {query}")
                        }
                    }],
                ),
                model.focus_panel == FocusPanel::Tasks,
                model.terminal_caps.color,
            ));
            frame.render_widget(tasks, cols[1]);

            let logs = Paragraph::new(build_log_lines(
                model,
                logs_width,
                cols[2].height.saturating_sub(2) as usize,
            ))
            .wrap(Wrap { trim: true })
            .block(panel_block(
                block_title(
                    "Logs",
                    model.focus_panel == FocusPanel::Logs,
                    &[
                        format!(
                            "filter {}/{}",
                            model.log_level_filter.label(),
                            model.log_source_filter.label()
                        ),
                        if model.follow_updates {
                            "follow live".to_string()
                        } else {
                            "follow paused".to_string()
                        },
                        {
                            let query = model.search_logs.trim();
                            if query.is_empty() {
                                String::new()
                            } else {
                                format!("search {query}")
                            }
                        },
                    ],
                ),
                model.focus_panel == FocusPanel::Logs,
                model.terminal_caps.color,
            ));
            frame.render_widget(logs, cols[2]);
        }
    }
    match model.overlay {
        OverlayMode::Recordings => {
            let area = interaction::overlay_rect(OverlayMode::Recordings, frame.area());
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(model.recording_overlay_text.as_str())
                    .wrap(Wrap { trim: true })
                    .block(panel_block(
                        "Saved sessions".into(),
                        true,
                        model.terminal_caps.color,
                    )),
                area,
            );
        }
        OverlayMode::Help => render_help_overlay(frame, model),
        OverlayMode::Palette => render_palette_overlay(frame, model),
        OverlayMode::Search => render_search_overlay(frame, model),
        OverlayMode::IndexWorkflows => {
            let area = interaction::overlay_rect(OverlayMode::IndexWorkflows, frame.area());
            let text = model
                .index_workflows
                .lines(
                    area.height.saturating_sub(2) as usize,
                    area.width.saturating_sub(2) as usize,
                )
                .join("\n");
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(text).block(panel_block(
                    "Command workflows".into(),
                    true,
                    model.terminal_caps.color,
                )),
                area,
            );
        }
        OverlayMode::Settings => {
            let area = interaction::overlay_rect(OverlayMode::Settings, frame.area());
            let text = model
                .settings
                .lines(
                    area.height.saturating_sub(2) as usize,
                    area.width.saturating_sub(2) as usize,
                )
                .join("\n");
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(text).block(panel_block(
                    "Settings".into(),
                    true,
                    model.terminal_caps.color,
                )),
                area,
            );
        }
        OverlayMode::RepositorySearch => {
            let area = interaction::overlay_rect(OverlayMode::RepositorySearch, frame.area());
            let text = model
                .repository_search
                .lines(
                    area.height.saturating_sub(2) as usize,
                    area.width.saturating_sub(2) as usize,
                )
                .join("\n");
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(text)
                    .wrap(Wrap { trim: false })
                    .block(panel_block(
                        "Repository search".into(),
                        true,
                        model.terminal_caps.color,
                    )),
                area,
            );
        }
        OverlayMode::JobInspection => {
            let area = interaction::overlay_rect(OverlayMode::JobInspection, frame.area());
            let text = model
                .job_inspection
                .lines(
                    area.width.saturating_sub(2) as usize,
                    area.height.saturating_sub(2) as usize,
                )
                .join("\n");
            frame.render_widget(Clear, area);
            frame.render_widget(
                Paragraph::new(text).block(panel_block(
                    "Job inspection".into(),
                    true,
                    model.terminal_caps.color,
                )),
                area,
            );
        }
        OverlayMode::None => {}
    }
    interaction::finish_geometry(model);
}

fn draw_ui(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    model: &AppModel,
) -> anyhow::Result<u128> {
    let frame_started = Instant::now();
    terminal.draw(|frame| render_ui(frame, model))?;
    Ok(frame_started.elapsed().as_millis())
}

fn apply_local_input(model: &mut AppModel, input: &str) {
    match input.trim() {
        "inspect_job" => open_job_inspection(model),
        "select_previous_job" => select_job(model, -1),
        "select_next_job" => select_job(model, 1),
        "follow_latest_job" => follow_latest_job(model),
        "focus_next" => {
            model.focus_panel = model.focus_panel.next();
            model.dirty = true;
        }
        "focus_jobs" => {
            model.focus_panel = FocusPanel::Jobs;
            model.dirty = true;
        }
        "focus_tasks" => {
            model.focus_panel = FocusPanel::Tasks;
            model.dirty = true;
        }
        "focus_logs" => {
            model.focus_panel = FocusPanel::Logs;
            model.dirty = true;
        }
        "cycle_filter" => cycle_active_filter(model),
        "toggle_follow" => {
            toggle_follow(model);
        }
        "toggle_help" => {
            model.overlay = if model.overlay == OverlayMode::Help {
                OverlayMode::None
            } else {
                OverlayMode::Help
            };
            model.dirty = true;
        }
        "toggle_palette" => {
            model.overlay = if model.overlay == OverlayMode::Palette {
                OverlayMode::None
            } else {
                OverlayMode::Palette
            };
            model.dirty = true;
        }
        "palette_up" => {
            interaction::move_palette(model, -1);
        }
        "palette_down" => {
            interaction::move_palette(model, 1);
        }
        "palette_select" => {
            if let Some(action) = interaction::actions(model)
                .get(model.palette_index)
                .copied()
            {
                if let Some(reason) = interaction::disabled(model, action) {
                    model.push_alert("info", reason);
                    return;
                }
                match action {
                    PaletteAction::ToggleFollow => toggle_follow(model),
                    PaletteAction::FocusJobs => model.focus_panel = FocusPanel::Jobs,
                    PaletteAction::FocusTasks => model.focus_panel = FocusPanel::Tasks,
                    PaletteAction::FocusLogs => model.focus_panel = FocusPanel::Logs,
                    PaletteAction::CycleFilter => cycle_active_filter(model),
                    PaletteAction::ClearSearch => clear_search(model, model.focus_panel),
                    PaletteAction::ShowHelp => interaction::context_help(model),
                    PaletteAction::IndexWorkflows => {
                        model.index_workflows.open(&model.session.scope);
                        model.overlay = OverlayMode::IndexWorkflows;
                    }
                    PaletteAction::Settings => {
                        model.settings.open(&model.session.scope);
                        model.overlay = OverlayMode::Settings;
                    }
                    PaletteAction::RepositorySearch => {
                        model.repository_search.open(&model.session.scope);
                        model.overlay = OverlayMode::RepositorySearch;
                    }
                    PaletteAction::InspectJob => open_job_inspection(model),
                    PaletteAction::Recordings => open_recordings(model),
                    PaletteAction::RunJob | PaletteAction::CancelSelected | PaletteAction::Quit => {
                    }
                }
            }
            if model.overlay == OverlayMode::Palette
                && interaction::actions(model)
                    .get(model.palette_index)
                    .is_some()
            {
                model.overlay = OverlayMode::None;
            }
            model.dirty = true;
        }
        "search_open" => open_search(model),
        "search_apply" => {
            *current_search_mut(model, model.search_target) = model.search_draft.clone();
            model.overlay = OverlayMode::None;
            model.dirty = true;
        }
        "search_cancel" => {
            model.overlay = OverlayMode::None;
            model.search_draft.clear();
            model.dirty = true;
        }
        "search_backspace" => {
            model.search_draft.pop();
            model.dirty = true;
        }
        "clear_search" => clear_search(model, model.focus_panel),
        "logs_up" => {
            model
                .log_scroll
                .set(model.log_scroll.get().saturating_add(1));
            model.dirty = true;
        }
        "logs_down" => {
            model
                .log_scroll
                .set(model.log_scroll.get().saturating_sub(1));
            model.dirty = true;
        }
        "jobs_up" => {
            model.job_scroll = model.job_scroll.saturating_add(1);
            model.dirty = true;
        }
        "jobs_down" => {
            model.job_scroll = model.job_scroll.saturating_sub(1);
            model.dirty = true;
        }
        "tasks_up" => {
            model.task_scroll = model.task_scroll.saturating_add(1);
            model.dirty = true;
        }
        "tasks_down" => {
            model.task_scroll = model.task_scroll.saturating_sub(1);
            model.dirty = true;
        }
        other if other.starts_with("search_type:") => {
            model
                .search_draft
                .push_str(other.trim_start_matches("search_type:"));
            model.dirty = true;
        }
        _ => {}
    }
}

fn capture_frame(
    model: &AppModel,
    fixture_name: &str,
    source_mode: &str,
    capture_id: &str,
    variant: &CaptureVariant,
    output_dir: &Path,
) -> anyhow::Result<CaptureManifestEntry> {
    let mut backend = TestBackend::new(variant.width, variant.height);
    let mut terminal = Terminal::new(backend)?;
    terminal.draw(|frame| render_ui(frame, model))?;
    backend = terminal.backend().clone();
    let buffer = backend.buffer().clone();
    let width = buffer.area.width as usize;
    let height = buffer.area.height as usize;
    let mut lines = Vec::new();
    let mut style_runs = Vec::new();
    let mut non_default_style_cells = 0usize;

    for row in 0..height {
        let mut line = String::new();
        let mut active_run: Option<FrameStyleRun> = None;
        for col in 0..width {
            let cell = &buffer.content[(row * width) + col];
            let symbol = cell.symbol();
            let style = cell.style();
            let fg = color_name(style.fg);
            let bg = color_name(style.bg);
            let modifiers = modifier_names(style.add_modifier);
            let is_default_style = fg == "reset"
                && bg == "reset"
                && modifiers.is_empty()
                && style.sub_modifier.is_empty();
            if !is_default_style {
                non_default_style_cells += 1;
            }
            match active_run.as_mut() {
                Some(run)
                    if run.fg == fg
                        && run.bg == bg
                        && run.modifiers == modifiers
                        && run.end_col == col as u16 =>
                {
                    run.end_col += 1;
                }
                Some(_) => {
                    style_runs.push(active_run.take().unwrap());
                    if !is_default_style {
                        active_run = Some(FrameStyleRun {
                            row: row as u16,
                            start_col: col as u16,
                            end_col: col as u16 + 1,
                            fg,
                            bg,
                            modifiers,
                        });
                    }
                }
                None => {
                    if !is_default_style {
                        active_run = Some(FrameStyleRun {
                            row: row as u16,
                            start_col: col as u16,
                            end_col: col as u16 + 1,
                            fg,
                            bg,
                            modifiers,
                        });
                    }
                }
            }
            line.push_str(symbol);
        }
        if let Some(run) = active_run.take() {
            style_runs.push(run);
        }
        lines.push(line);
    }

    fs::create_dir_all(output_dir)?;
    let frame_path = output_dir.join(format!("{}.frame.txt", variant.id));
    let metadata_path = output_dir.join(format!("{}.frame.json", variant.id));
    fs::write(&frame_path, format!("{}\n", lines.join("\n")))?;
    let metadata = CapturedFrameMetadata {
        fixture_name: fixture_name.to_string(),
        source_mode: source_mode.to_string(),
        capture_id: capture_id.to_string(),
        variant_id: variant.id.clone(),
        width: variant.width,
        height: variant.height,
        color: model.terminal_caps.color,
        unicode: model.terminal_caps.unicode,
        run_id: model.run_id.clone(),
        session_mode: model.session.mode.clone(),
        session_source: model.session.source.clone(),
        session_scope: model.session.scope.clone(),
        session_connection: model.session.connection.clone(),
        session_note: model.session.note.clone(),
        selected_job: model.selected_job.clone(),
        job_scroll: model.job_scroll,
        task_scroll: model.task_scroll,
        log_scroll: model.log_scroll.get(),
        job_count: model.job_status.len(),
        task_count: model.task_status.len(),
        log_count: model.logs.len(),
        alert_count: model.alerts.len(),
        non_default_style_cells,
        style_runs,
    };
    fs::write(
        &metadata_path,
        format!("{}\n", serde_json::to_string_pretty(&metadata)?),
    )?;
    Ok(CaptureManifestEntry {
        capture_id: capture_id.to_string(),
        variant_id: variant.id.clone(),
        frame_path: frame_path.to_string_lossy().replace('\\', "/"),
        metadata_path: metadata_path.to_string_lossy().replace('\\', "/"),
    })
}

fn run_capture_fixture_mode(fixture_path: &Path, output_root: &Path) -> anyhow::Result<()> {
    let body = fs::read_to_string(fixture_path)?;
    let fixture: CaptureFixture = serde_json::from_str(&body)?;
    if fixture.schema_version != TUI_CAPTURE_FIXTURE_SCHEMA_VERSION {
        anyhow::bail!(
            "unsupported capture fixture schema version in {}: {} (expected {})",
            fixture_path.display(),
            fixture.schema_version,
            TUI_CAPTURE_FIXTURE_SCHEMA_VERSION
        );
    }
    if fixture.name.trim().is_empty() {
        anyhow::bail!("capture fixture missing name: {}", fixture_path.display());
    }
    if fixture.variants.is_empty() {
        anyhow::bail!(
            "capture fixture missing variants: {}",
            fixture_path.display()
        );
    }
    let source_mode = if fixture.source_mode.trim().is_empty() {
        "unspecified".to_string()
    } else {
        fixture.source_mode.trim().to_string()
    };
    let run_id = if fixture.run_id.trim().is_empty() {
        fixture.name.trim().to_string()
    } else {
        fixture.run_id.trim().to_string()
    };
    let terminal_caps = TerminalCapabilities {
        color: true,
        unicode: true,
        mouse: false,
        alt_screen: false,
    };
    let mut model = AppModel::new(run_id.clone(), terminal_caps, None);
    let fixture_out_dir = output_root.join(fixture.name.trim());
    fs::create_dir_all(&fixture_out_dir)?;
    let mut outputs = Vec::new();

    for (index, step) in fixture.steps.iter().enumerate() {
        if let Some(event) = step.event.clone() {
            apply_protocol_event(&mut model, event, 0);
        }
        if !step.input.trim().is_empty() {
            apply_local_input(&mut model, &step.input);
        }
        if !step.selected_job.trim().is_empty() {
            model.selected_job = Some(step.selected_job.trim().to_string());
            model.dirty = true;
        }
        if let Some(job_scroll) = step.job_scroll {
            model.job_scroll = job_scroll;
            model.dirty = true;
        }
        if let Some(task_scroll) = step.task_scroll {
            model.task_scroll = task_scroll;
            model.dirty = true;
        }
        if let Some(log_scroll) = step.log_scroll {
            model.log_scroll.set(log_scroll);
            model.dirty = true;
        }
        if step.capture_id.trim().is_empty() {
            continue;
        }
        let capture_dir =
            fixture_out_dir.join(format!("{:02}-{}", index + 1, step.capture_id.trim()));
        for variant in &fixture.variants {
            let original_color = model.terminal_caps.color;
            let original_unicode = model.terminal_caps.unicode;
            model.terminal_caps.color = variant.color.unwrap_or(original_color);
            model.terminal_caps.unicode = variant.unicode.unwrap_or(original_unicode);
            outputs.push(capture_frame(
                &model,
                fixture.name.trim(),
                &source_mode,
                step.capture_id.trim(),
                variant,
                &capture_dir,
            )?);
            model.terminal_caps.color = original_color;
            model.terminal_caps.unicode = original_unicode;
        }
    }

    let manifest = CaptureManifest {
        schema_version: TUI_CAPTURE_FIXTURE_SCHEMA_VERSION,
        fixture_name: fixture.name.trim().to_string(),
        source_mode,
        run_id,
        outputs,
    };
    fs::write(
        fixture_out_dir.join("capture-manifest.json"),
        format!("{}\n", serde_json::to_string_pretty(&manifest)?),
    )?;
    Ok(())
}

fn cycle_active_filter(model: &mut AppModel) {
    match model.focus_panel {
        FocusPanel::Jobs => model.job_filter = model.job_filter.next(),
        FocusPanel::Tasks => model.task_filter = model.task_filter.next(),
        FocusPanel::Logs => {
            if model.log_level_filter == LogLevelFilter::Error {
                model.log_level_filter = LogLevelFilter::All;
                model.log_source_filter = model.log_source_filter.next();
            } else {
                model.log_level_filter = model.log_level_filter.next();
            }
        }
    }
    model.dirty = true;
}

fn open_search(model: &mut AppModel) {
    model.search_target = model.focus_panel;
    model.search_draft = current_search(model, model.focus_panel).to_string();
    model.panel_cursor.reset();
    model.overlay = OverlayMode::Search;
    model.dirty = true;
}

fn open_job_inspection(model: &mut AppModel) {
    let Some(id) = model
        .selected_job
        .clone()
        .filter(|id| !model.selected_job_expired && visible_job_ids(model).contains(&id.as_str()))
    else {
        model.push_alert(
            "info",
            "Select a visible current job to inspect its retained result and artifacts",
        );
        return;
    };
    model.selected_job_pinned = true;
    model.job_inspection.open(&id);
    model.overlay = OverlayMode::JobInspection;
    model.dirty = true;
}

fn sample_job_request(model: &AppModel, job_id: &str) -> Value {
    let mut request = json!({"proto":"poc.tui@1", "op":"job:run", "jobId":job_id,
        "title":"Search Help", "argv":["search", "--help"],
        "resultPolicy":{"captureStdout":"text", "maxBytes":65536}});
    if let Some(scope) = &model.settings.scope {
        request["cwd"] = scope["configRoot"].clone();
    }
    request
}

fn open_recordings(model: &mut AppModel) {
    model.recordings_requested = true;
    model.overlay = OverlayMode::Recordings;
    model.dirty = true;
}

fn has_live_control(model: &AppModel) -> bool {
    model.owns_control_channel && model.session.controllable && model.session.mode == "supervised"
}

fn start_sample_job(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
) -> anyhow::Result<()> {
    if !has_live_control(model) {
        model.push_alert(
            "info",
            "Launching work requires the owned live supervisor channel",
        );
        return Ok(());
    }
    let job_id = format!("job-{}", *next_job_idx);
    *next_job_idx += 1;
    send_request(supervisor, sample_job_request(model, &job_id))
}

fn apply_palette_action(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
    action: PaletteAction,
) -> anyhow::Result<bool> {
    if let Some(reason) = interaction::disabled(model, action) {
        model.push_alert("info", &format!("{}: {reason}", action.label()));
        return Ok(false);
    }
    match action {
        PaletteAction::ToggleFollow => {
            toggle_follow(model);
        }
        PaletteAction::FocusJobs => {
            model.focus_panel = FocusPanel::Jobs;
            model.dirty = true;
        }
        PaletteAction::FocusTasks => {
            model.focus_panel = FocusPanel::Tasks;
            model.dirty = true;
        }
        PaletteAction::FocusLogs => {
            model.focus_panel = FocusPanel::Logs;
            model.dirty = true;
        }
        PaletteAction::CycleFilter => cycle_active_filter(model),
        PaletteAction::ClearSearch => clear_search(model, model.focus_panel),
        PaletteAction::RunJob => {
            start_sample_job(model, supervisor, next_job_idx)?;
        }
        PaletteAction::CancelSelected => {
            send_selected_job_cancel(model, supervisor)?;
        }
        PaletteAction::ShowHelp => {
            interaction::context_help(model);
        }
        PaletteAction::IndexWorkflows => {
            model.index_workflows.open(&model.session.scope);
            model.overlay = OverlayMode::IndexWorkflows;
            model.dirty = true;
        }
        PaletteAction::Settings => {
            model.settings.open(&model.session.scope);
            model.overlay = OverlayMode::Settings;
            model.dirty = true;
        }
        PaletteAction::RepositorySearch => {
            model.repository_search.open(&model.session.scope);
            model.overlay = OverlayMode::RepositorySearch;
            model.dirty = true;
        }
        PaletteAction::InspectJob => open_job_inspection(model),
        PaletteAction::Recordings => open_recordings(model),
        PaletteAction::Quit => {
            return Ok(true);
        }
    }
    Ok(false)
}

fn enqueue_input(model: &mut AppModel, command: InputCommand, _token: &str) {
    let seq = model.next_input_seq;
    model.next_input_seq += 1;
    model.input_queue.push_back((seq, command));
}

fn flush_flow_credits(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
) -> anyhow::Result<()> {
    if model.flow_credit_pending == 0 {
        return Ok(());
    }
    if model.flow_credit_pending < FLOW_CREDIT_BATCH
        && model.last_credit_flush.elapsed() < FLOW_CREDIT_FLUSH_INTERVAL
    {
        return Ok(());
    }
    let credits = model.flow_credit_pending;
    send_request(
        supervisor,
        json!({
            "proto": "poc.tui@1",
            "op": "flow:credit",
            "credits": credits
        }),
    )?;
    model.flow_credit_pending = 0;
    model.last_credit_flush = Instant::now();
    Ok(())
}

fn append_runtime_metrics(model: &mut AppModel) {
    if model.last_metrics_emit.elapsed() < METRICS_EMIT_INTERVAL {
        return;
    }
    model.last_metrics_emit = Instant::now();
    if let Some(file) = model.telemetry_file.as_mut() {
        let line = json!({
            "schemaVersion": 1,
            "runId": model.run_id,
            "ts": SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis())
                .unwrap_or(0),
            "eventLagMsEwma": model.telemetry.event_lag_ms_ewma,
            "renderMsEwma": model.telemetry.render_ms_ewma,
            "queueDepthEwma": model.telemetry.queue_depth_ewma,
            "nativeInboundPending": model.telemetry.native_inbound_pending,
            "lifecycleDropped": model.telemetry.lifecycle_dropped,
            "processedEvents": model.telemetry.processed_events,
            "chunkReassembled": model.telemetry.chunk_reassembled,
            "droppedChunks": model.telemetry.dropped_chunks
        });
        let _ = writeln!(file, "{line}");
        let _ = file.flush();
    }
}

fn handle_chunk_event(model: &mut AppModel, event: &Value) -> Option<Value> {
    let chunk_id = event.get("chunkId")?.as_str()?.to_string();
    let chunk_index = event.get("chunkIndex")?.as_u64()? as usize;
    let chunk_count = event.get("chunkCount")?.as_u64()? as usize;
    let chunk = event.get("chunk")?.as_str()?.to_string();
    if chunk_count == 0 || chunk_count > 4096 || chunk_index >= chunk_count {
        model.telemetry.dropped_chunks += 1;
        return None;
    }

    let chunk_bytes = chunk.len();
    let mut count_mismatch = false;
    let mut complete = false;
    {
        let assembly = model
            .chunk_assemblies
            .entry(chunk_id.clone())
            .or_insert_with(|| ChunkAssembly {
                chunk_count,
                parts: vec![None; chunk_count],
                bytes: 0,
            });
        if assembly.chunk_count != chunk_count {
            count_mismatch = true;
        } else {
            if assembly.parts[chunk_index].is_none() {
                assembly.bytes += chunk_bytes;
                model.chunk_assembly_bytes += chunk_bytes;
                assembly.parts[chunk_index] = Some(chunk);
            }
            complete = assembly.parts.iter().all(|entry| entry.is_some());
        }
    }

    if count_mismatch {
        if let Some(removed) = model.chunk_assemblies.remove(&chunk_id) {
            model.chunk_assembly_bytes = model.chunk_assembly_bytes.saturating_sub(removed.bytes);
        }
        model.telemetry.dropped_chunks += 1;
        return None;
    }

    if model.chunk_assembly_bytes > CHUNK_ASSEMBLY_LIMIT_BYTES {
        model.chunk_assemblies.clear();
        model.chunk_assembly_bytes = 0;
        model.telemetry.dropped_chunks += 1;
        model.push_log("chunk overflow: cleared pending oversized payload reassembly".to_string());
        return None;
    }

    if !complete {
        return None;
    }
    let mut serialized = String::new();
    let mut bytes = 0usize;
    if let Some(complete_assembly) = model.chunk_assemblies.remove(&chunk_id) {
        for part in complete_assembly.parts.into_iter().flatten() {
            bytes += part.len();
            serialized.push_str(&part);
        }
    }
    model.chunk_assembly_bytes = model.chunk_assembly_bytes.saturating_sub(bytes);
    match serde_json::from_str::<Value>(&serialized) {
        Ok(rebuilt) => {
            model.telemetry.chunk_reassembled += 1;
            Some(rebuilt)
        }
        Err(_) => {
            model.telemetry.dropped_chunks += 1;
            if model.telemetry.dropped_chunks <= 8 {
                model.push_alert(
                    "warn",
                    "Reassembled supervisor event is invalid JSON; event was not applied",
                );
            }
            None
        }
    }
}

fn apply_session_descriptor(model: &mut AppModel, event: &Value) {
    let mode = event
        .get("mode")
        .or_else(|| event.get("sessionMode"))
        .and_then(|value| value.as_str());
    let source = event
        .get("source")
        .or_else(|| event.get("attachmentSource"))
        .and_then(|value| value.as_str());
    let scope = event.get("scope").and_then(|value| value.as_str());
    let connection = event
        .get("connection")
        .or_else(|| event.get("connectionState"))
        .and_then(|value| value.as_str());
    let note = event.get("note").and_then(|value| value.as_str());
    model.update_session_state(mode, source, scope, connection, note);
    model.session.controllable = model.owns_control_channel
        && event["controllable"] == true
        && model.session.mode == "supervised";
    update_workload_from_scope(model);
}

fn apply_workload_fallbacks(
    model: &mut AppModel,
    event_name: &str,
    event: &Value,
    log_message: Option<&str>,
) {
    match model.workload_kind {
        WorkloadKind::Bench => {
            if event_name == "job:start" {
                if let Some(title) = event.get("title").and_then(|value| value.as_str()) {
                    if !title.trim().is_empty() {
                        model.bench_summary.active_repo = title.trim().to_string();
                    }
                }
            }
            if let Some(message) = log_message {
                if let Some((_, provider)) = message.split_once("provider degraded:") {
                    let normalized = provider
                        .split_whitespace()
                        .next()
                        .unwrap_or("")
                        .trim_matches(|ch: char| ch == ',' || ch == ':');
                    if !normalized.is_empty() {
                        push_unique_summary(
                            &mut model.bench_summary.degraded_providers,
                            normalized,
                        );
                    }
                }
            }
        }
        WorkloadKind::Indexing => {
            if model.indexing_summary.repo.is_empty() && event_name == "job:start" {
                if let Some(title) = event.get("title").and_then(|value| value.as_str()) {
                    if !title.trim().is_empty() {
                        model.indexing_summary.repo = title.trim().to_string();
                    }
                }
            }
            if event_name == "task:start"
                || event_name == "task:progress"
                || event_name == "task:end"
            {
                if let Some(value) = event.get("stage").and_then(|value| value.as_str()) {
                    model.indexing_summary.stage = value.trim().to_string();
                } else if let Some(value) = event.get("taskId").and_then(|value| value.as_str()) {
                    model.indexing_summary.stage = value.trim().to_string();
                }
                if let Some(value) = event.get("mode").and_then(|value| value.as_str()) {
                    model.indexing_summary.mode = value.trim().to_string();
                }
            }
            if event_name == "job:artifacts" {
                let count = event
                    .get("artifacts")
                    .and_then(|value| value.as_array())
                    .map(|value| value.len())
                    .unwrap_or(0);
                if count > 0 {
                    model.indexing_summary.artifact_write_progress =
                        format!("{count} indexed roots");
                }
            }
        }
        WorkloadKind::Service => {
            if let Some(queue_depth) = event
                .get("flow")
                .and_then(|value| value.get("queueDepth"))
                .and_then(|value| value.as_u64())
            {
                if model.service_summary.queue_depth.is_none() {
                    model.service_summary.queue_depth = Some(queue_depth);
                }
            }
            if event_name == "job:start" || event_name == "job:end" {
                let active_jobs = model
                    .job_status
                    .values()
                    .filter(|status| Lifecycle::from_status(status) == Lifecycle::Active)
                    .count() as u64;
                if model.service_summary.active_jobs.is_none() {
                    model.service_summary.active_jobs = Some(active_jobs);
                }
            }
        }
        WorkloadKind::Generic => {}
    }
}

fn summarize_protocol_event(event_name: &str, event: &Value) -> String {
    match event_name {
        "hello" => {
            let version = event
                .get("supervisorVersion")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            format!("supervisor connected | version {version}")
        }
        "session:attach" => {
            let mode = event
                .get("mode")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let source = event
                .get("source")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            format!("session attached | mode {mode} | source {source}")
        }
        "job:start" => {
            let job_id = event
                .get("jobId")
                .and_then(|value| value.as_str())
                .unwrap_or("job");
            let title = event
                .get("title")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if title.is_empty() {
                format!("job started | {job_id}")
            } else {
                format!("job started | {job_id} | {title}")
            }
        }
        "job:spawn" => {
            let job_id = event
                .get("jobId")
                .and_then(|value| value.as_str())
                .unwrap_or("job");
            let pid = event
                .get("pid")
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            format!("job spawned | {job_id} | pid {pid}")
        }
        "job:end" => {
            let job_id = event
                .get("jobId")
                .and_then(|value| value.as_str())
                .unwrap_or("job");
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            let result_state = event
                .get("resultState")
                .and_then(Value::as_str)
                .unwrap_or("");
            if result_state.is_empty() {
                format!("job finished | {job_id} | {status}")
            } else {
                format!("job finished | {job_id} | {status} | result {result_state}")
            }
        }
        "task:start" | "task:progress" | "task:end" => {
            let job_id = event
                .get("jobId")
                .and_then(|value| value.as_str())
                .unwrap_or("job");
            let task_id = event
                .get("taskId")
                .and_then(|value| value.as_str())
                .unwrap_or("task");
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("running");
            let message = event
                .get("message")
                .and_then(|value| value.as_str())
                .unwrap_or("");
            if message.is_empty() {
                format!("task {status} | {job_id}/{task_id}")
            } else {
                format!("task {status} | {job_id}/{task_id} | {message}")
            }
        }
        "runtime:metrics" => {
            let queue_depth = event
                .get("flow")
                .and_then(|value| value.get("queueDepth"))
                .and_then(|value| value.as_u64())
                .unwrap_or(0);
            format!("runtime metrics | queue depth {queue_depth}")
        }
        _ => format!("event {event_name}"),
    }
}

fn apply_ingress_event_at(
    model: &mut AppModel,
    received: event_ingress::InboundEvent,
    now: Instant,
) {
    if let Some(age) = now.checked_duration_since(received.received_at) {
        let milliseconds = age.as_secs_f64() * 1000.0;
        model.telemetry.event_lag_ms_ewma =
            RuntimeTelemetry::update_known_ewma(model.telemetry.event_lag_ms_ewma, milliseconds);
    }
    model.telemetry.native_inbound_pending = Some(received.pending_at_dispatch);
    apply_protocol_event(model, received.value, 0);
}

fn apply_protocol_event(model: &mut AppModel, event: Value, _queue_depth: usize) {
    if !model.owns_control_channel {
        if let Some(timestamp) = event["ts"]
            .as_str()
            .and_then(task_state::recorded_timestamp)
        {
            model.recorded_ms = Some(model.recorded_ms.unwrap_or(timestamp).max(timestamp));
        }
    }
    let event_name = event
        .get("event")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();

    if event_name == "event:chunk" {
        if let Some(rebuilt) = handle_chunk_event(model, &event) {
            apply_protocol_event(model, rebuilt, 0);
        }
        return;
    }

    model.telemetry.processed_events += 1;

    if let Some(run_id) = event.get("runId").and_then(|value| value.as_str()) {
        model.run_id = run_id.to_string();
    }
    apply_workload_descriptor(model, &event);
    if event_name == "hello" {
        let search_was_available = model.repository_search.available;
        model.job_inspection.available = model.owns_control_channel
            && event["capabilities"]["supportsArtifactActions"] == true
            && event["session"]["mode"] == "supervised"
            && event["session"]["controllable"] == true;
        model.repository_search.available = model.owns_control_channel
            && event["capabilities"]["supportsSearch"] == true
            && event["session"]["mode"] == "supervised"
            && event["session"]["controllable"] == true;
        model.index_workflows.available = model.owns_control_channel
            && event["capabilities"]["supportsIndexWorkflows"] == true
            && event["session"]["mode"] == "supervised"
            && event["session"]["controllable"] == true;
        model.settings.available = model.owns_control_channel
            && event["capabilities"]["supportsSettings"] == true
            && event["session"]["mode"] == "supervised"
            && event["session"]["controllable"] == true;
        if let Some(session) = event.get("session") {
            apply_session_descriptor(model, session);
        } else {
            model.update_session_state(
                Some("supervised"),
                Some("local-supervisor"),
                None,
                Some("connected"),
                Some("supervisor handshake complete"),
            );
        }
        if !search_was_available
            && model.repository_search.available
            && model.overlay == OverlayMode::RepositorySearch
        {
            model.repository_search.open(&model.session.scope);
        }
    }
    if event_name == "session:attach" {
        model.job_inspection.available = false;
        model.repository_search.available = false;
        model.settings.available = false;
        model.index_workflows.available = false;
        apply_session_descriptor(model, &event);
    }
    if model.job_inspection.event(&event) {
        model.dirty = true;
        return;
    }
    if model.repository_search.event(&event) {
        model.dirty = true;
        return;
    }
    if model.index_workflows.event(&event) {
        if let Some(scope) = &model.index_workflows.scope {
            if let Some(target) = scope["target"].as_str() {
                if model.session.scope != target {
                    model.repository_search.scope_changed(target);
                }
                model.session.scope = target.to_string();
            }
        }
        model.dirty = true;
        return;
    }
    if model.settings.event(&event) {
        if let Some(scope) = &model.settings.scope {
            if let Some(target) = scope["target"].as_str() {
                if model.session.scope != target {
                    model.repository_search.scope_changed(target);
                }
                model.session.scope = target.to_string();
            }
        }
        model.dirty = true;
        return;
    }
    if let Some(job_id) = event.get("jobId").and_then(|value| value.as_str()) {
        model.job_inspection.record(&event);
        if event_name == "job:start" || event_name == "job:spawn" {
            if event_name == "job:start" {
                model.begin_job_instance(job_id);
            }
            let title = event.get("title").and_then(|value| value.as_str());
            model.update_job_status(job_id, "running", title);
        } else if event_name == "job:end" {
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            model.update_job_status(job_id, status, None);
            model.reconcile_terminal_tasks(job_id, status);
            if let Some(result_state) = event.get("resultState").and_then(Value::as_str) {
                if matches!(result_state, "truncated" | "invalid-json" | "incomplete") {
                    model.push_alert("warn", &format!("job {job_id} result {result_state}"));
                }
            }
            if status == "failed" || status == "cancelled" {
                model.push_alert(status, &format!("job {job_id} {status}"));
            }
        } else if event_name == "task:start"
            || event_name == "task:progress"
            || event_name == "task:end"
        {
            let task_id = event
                .get("taskId")
                .and_then(|value| value.as_str())
                .unwrap_or("task");
            let task_key = json!([job_id, task_id]).to_string();
            if event_name == "task:progress"
                && model
                    .task_status
                    .get(&task_key)
                    .is_some_and(|task| task.lifecycle() != Lifecycle::Active)
            {
                return;
            }
            if event["ts"]
                .as_str()
                .and_then(task_state::recorded_timestamp)
                .zip(
                    model
                        .task_status
                        .get(&task_key)
                        .and_then(|task| task.producer_ms),
                )
                .is_some_and(|(incoming, retained)| incoming < retained)
            {
                return;
            }
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or(if event_name == "task:end" {
                    "done"
                } else {
                    "running"
                });
            // A delayed start must not reset the already reconciled task merely
            // because update_task_status declined its terminal owner below.
            if Lifecycle::from_status(status) == Lifecycle::Active
                && model
                    .job_status
                    .get(job_id)
                    .is_some_and(|owner| Lifecycle::from_status(owner) != Lifecycle::Active)
            {
                return;
            }
            let msg = event.get("message").and_then(|value| value.as_str());
            model.update_task_status(job_id, task_id, status, msg);
            let now = if model.owns_control_channel && model.session.mode != "replay" {
                Some(
                    model
                        .activity_origin
                        .elapsed()
                        .as_millis()
                        .min(u64::MAX as u128) as u64,
                )
            } else {
                model.recorded_ms
            };
            if let Some(task) = model.task_status.get_mut(&task_key) {
                if event_name == "task:start" {
                    *task = TaskState::new(status, msg);
                }
                task.observe(&event, now);
            }
        }
    }

    if event_name == "runtime:metrics" {
        if let Some(flow) = event.get("flow").and_then(|value| value.as_object()) {
            if let Some(lost) = flow.get("lifecycleDropped").and_then(Value::as_u64) {
                if lost > model.telemetry.lifecycle_dropped {
                    for task in model.task_status.values_mut() {
                        if task.lifecycle() == Lifecycle::Active {
                            *task = TaskState::new(
                                "unknown",
                                Some("task lifecycle transport incomplete"),
                            );
                        }
                    }
                    model.push_alert("warn", "Task lifecycle transport incomplete; running states are unknown until a new lifecycle event.");
                }
                model.telemetry.lifecycle_dropped = lost;
            }
            if let Some(queue_depth) = flow.get("queueDepth").and_then(Value::as_u64) {
                model.telemetry.queue_depth_ewma = RuntimeTelemetry::update_known_ewma(
                    model.telemetry.queue_depth_ewma,
                    queue_depth as f64,
                );
                if model.workload_kind == WorkloadKind::Service {
                    model.service_summary.queue_depth = Some(queue_depth);
                }
            }
        }
        model.update_session_state(
            None,
            None,
            None,
            Some("streaming"),
            Some("receiving runtime metrics"),
        );
        apply_workload_fallbacks(model, &event_name, &event, None);
        return;
    }

    let (log_line, log_level, log_source) = if event_name == "log" {
        let msg = event
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("(empty log)");
        let level = event
            .get("level")
            .and_then(|value| value.as_str())
            .unwrap_or("info");
        if level == "warn" || level == "error" {
            model.push_alert(level, msg);
        }
        (msg.to_string(), level.to_string(), "supervisor".to_string())
    } else {
        (
            summarize_protocol_event(&event_name, &event),
            "info".to_string(),
            event_name.clone(),
        )
    };
    let fallback_log_message = if event_name == "log" {
        Some(log_line.as_str())
    } else {
        None
    };
    apply_workload_fallbacks(model, &event_name, &event, fallback_log_message);
    model.push_scoped_log_entry(
        log_line,
        &log_level,
        &log_source,
        event.get("jobId").and_then(Value::as_str),
    );
}

const INGRESS_EVENTS_PER_TURN: u64 = 128;
const INGRESS_TURN_BUDGET: Duration = Duration::from_millis(4);

fn drain_ingress_turn(
    mut poll: impl FnMut() -> Option<event_ingress::InboundEvent>,
    mut apply: impl FnMut(event_ingress::InboundEvent),
    mut elapsed: impl FnMut() -> Duration,
) -> u64 {
    let mut consumed = 0;
    while consumed < INGRESS_EVENTS_PER_TURN && (consumed == 0 || elapsed() < INGRESS_TURN_BUDGET) {
        let Some(event) = poll() else {
            break;
        };
        apply(event);
        consumed += 1;
    }
    consumed
}

fn input_poll_wait(inbound_pending: usize, replay_pending: bool) -> Duration {
    if inbound_pending > 0 || replay_pending {
        Duration::ZERO
    } else {
        INPUT_POLL_INTERVAL
    }
}

fn enqueue_terminal_key(model: &mut AppModel, key: KeyEvent) {
    if key.kind == KeyEventKind::Release {
        return;
    }
    if key.code == KeyCode::F(1) {
        enqueue_input(model, InputCommand::ContextHelp, "context-help");
        return;
    }
    if key.modifiers.contains(KeyModifiers::CONTROL) && matches!(key.code, KeyCode::Char('c' | 'C'))
    {
        // Interrupt is global and must not start queued interactions before
        // entering the existing supervisor shutdown-and-drain owner.
        if matches!(model.input_queue.front(), Some((_, InputCommand::Quit))) {
            return;
        }
        model.input_queue.clear();
        enqueue_input(model, InputCommand::Quit, "ctrl-c");
        return;
    }
    // Debounce hardware repeat only. Distinct Press events (including pasted
    // repeated letters) retain FIFO order and cannot reset the dispatch clock.
    let token = format!("{:?}:{:?}", key.code, key.modifiers);
    let now = Instant::now();
    if key.kind == KeyEventKind::Repeat
        && token == model.last_input_token
        && now.duration_since(model.last_key_at).as_millis() < INPUT_DEBOUNCE_MS
    {
        return;
    }
    model.last_key_at = now;
    model.last_input_token = token;
    enqueue_input(model, InputCommand::TerminalKey(key), "terminal-key");
}

fn interpret_terminal_key(model: &mut AppModel, key: KeyEvent) {
    match model.overlay {
        OverlayMode::Recordings => {} // Keys are consumed by the owned loader UI.
        OverlayMode::JobInspection => {
            if model.job_inspection.key(key) {
                model.overlay = OverlayMode::None;
            }
            model.dirty = true;
        }
        OverlayMode::RepositorySearch => {
            if model.repository_search.key(key) {
                model.overlay = OverlayMode::None;
            }
            if let Some((repo, command)) = model.repository_search.take_recovery() {
                if model.index_workflows.open_recovery(&repo, command) {
                    model.overlay = OverlayMode::IndexWorkflows;
                } else {
                    model.repository_search.recovery_busy();
                }
            }
            model.dirty = true;
        }
        OverlayMode::IndexWorkflows => {
            if model.index_workflows.key(key) {
                model.overlay = OverlayMode::None;
            }
            model.dirty = true;
        }
        OverlayMode::Settings => {
            if model.settings.key(key) {
                model.overlay = OverlayMode::None;
            }
            model.dirty = true;
        }
        OverlayMode::Help => interaction::help_key(model, key),
        OverlayMode::Palette => match key.code {
            KeyCode::Esc => enqueue_input(model, InputCommand::TogglePalette, "palette-close"),
            KeyCode::Down => enqueue_input(model, InputCommand::PaletteDown, "palette-down"),
            KeyCode::Up => enqueue_input(model, InputCommand::PaletteUp, "palette-up"),
            KeyCode::Enter => enqueue_input(model, InputCommand::PaletteSelect, "palette-select"),
            _ => {
                interaction::edit_palette(model, |cursor, query| cursor.key(query, key, 256));
            }
        },
        OverlayMode::Search => match key.code {
            KeyCode::Esc => enqueue_input(model, InputCommand::SearchCancel, "search-cancel"),
            KeyCode::Enter => enqueue_input(model, InputCommand::SearchAccept, "search-accept"),
            KeyCode::Backspace => {
                enqueue_input(model, InputCommand::SearchBackspace, "search-backspace")
            }
            KeyCode::Char(ch)
                if !ch.is_control()
                    && !key
                        .modifiers
                        .intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) =>
            {
                enqueue_input(model, InputCommand::SearchChar(ch), "search-char")
            }
            _ => {
                if model.panel_cursor.key(&mut model.search_draft, key, 4096) {
                    model.dirty = true;
                }
            }
        },
        OverlayMode::None => {
            if let Some(input) = interaction::bound_input(key) {
                enqueue_input(model, input, "bound-action");
                return;
            }
            match key.code {
                KeyCode::Up if model.focus_panel == FocusPanel::Jobs => {
                    enqueue_input(model, InputCommand::SelectPreviousJob, "previous-job")
                }
                KeyCode::Down if model.focus_panel == FocusPanel::Jobs => {
                    enqueue_input(model, InputCommand::SelectNextJob, "next-job")
                }
                _ => {}
            }
        }
    }
}

#[cfg(test)]
fn dispatch_input(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
) -> anyhow::Result<bool> {
    dispatch_input_with_recordings_at(model, supervisor, next_job_idx, None, Instant::now())
}

fn dispatch_input_with_recordings_at(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
    mut recordings: Option<&mut recordings::RecordingUi>,
    now: Instant,
) -> anyhow::Result<bool> {
    if model.input_queue.is_empty() {
        return Ok(false);
    }
    if !matches!(model.input_queue.front(), Some((_, InputCommand::Quit)))
        && now
            .saturating_duration_since(model.last_input_at)
            .as_millis()
            < INPUT_DISPATCH_INTERVAL_MS
    {
        return Ok(false);
    }
    if matches!(
        model.input_queue.front(),
        Some((_, InputCommand::TerminalKey(_)))
    ) {
        let (_, InputCommand::TerminalKey(key)) = model.input_queue.pop_front().unwrap() else {
            unreachable!()
        };
        let mut consumed = false;
        if let Some(recordings) = recordings.as_mut() {
            if model.overlay == OverlayMode::Recordings {
                if recordings.key(key) {
                    model.overlay = OverlayMode::None;
                }
                model.dirty = true;
                consumed = true;
            } else if model.overlay == OverlayMode::None && recordings.playback_key(key) {
                model.dirty = true;
                consumed = true;
            }
        }
        // Interpret only now, against the state produced by the preceding key.
        // Commands produced by this key precede every later raw key.
        let mut later_keys = std::mem::take(&mut model.input_queue);
        if !consumed {
            interpret_terminal_key(model, key);
        }
        let interpreted = !model.input_queue.is_empty();
        model.input_queue.append(&mut later_keys);
        if !interpreted {
            model.last_input_at = now;
            return Ok(false);
        }
    }
    let (_, cmd) = model.input_queue.pop_front().unwrap();
    model.last_input_at = now;
    if let Some(reason) = interaction::input_disabled(model, &cmd) {
        model.push_alert("info", reason);
        return Ok(false);
    }
    match cmd {
        InputCommand::ContextHelp => interaction::context_help(model),
        InputCommand::Paste(text) => {
            if model.overlay == OverlayMode::Recordings {
                if let Some(recordings) = recordings.as_mut() {
                    recordings.paste(&text);
                    model.dirty = true;
                }
            } else {
                interaction::paste(model, &text);
            }
        }
        InputCommand::Mouse(input) => {
            if let Some(input) = interaction::apply_mouse(model, input) {
                if let Some(recordings) = recordings.as_mut() {
                    if recordings.revision == model.recording_revision {
                        match input {
                            interaction::RecordingMouse::Key(key) => {
                                recordings.key(key);
                            }
                            interaction::RecordingMouse::Row(row) => recordings.click(row),
                        }
                        model.dirty = true;
                    }
                }
            }
        }
        InputCommand::TerminalKey(_) => {
            unreachable!("raw key must be interpreted before command dispatch")
        }
        InputCommand::InspectJob => open_job_inspection(model),
        InputCommand::Recordings => open_recordings(model),
        InputCommand::SelectPreviousJob => select_job(model, -1),
        InputCommand::SelectNextJob => select_job(model, 1),
        InputCommand::FollowLatestJob => follow_latest_job(model),
        InputCommand::RepositorySearch => {
            model.repository_search.open(&model.session.scope);
            model.overlay = OverlayMode::RepositorySearch;
            model.dirty = true;
        }
        InputCommand::IndexWorkflows => {
            model.index_workflows.open(&model.session.scope);
            model.overlay = OverlayMode::IndexWorkflows;
            model.dirty = true;
        }
        InputCommand::Settings => {
            model.settings.open(&model.session.scope);
            model.overlay = OverlayMode::Settings;
            model.dirty = true;
        }
        InputCommand::Quit => {
            return Ok(true);
        }
        InputCommand::FocusNext => {
            model.focus_panel = model.focus_panel.next();
            model.dirty = true;
        }
        InputCommand::ToggleMaximized => {
            model.maximized = !model.maximized;
            model.dirty = true;
        }
        InputCommand::FocusJobs => {
            model.focus_panel = FocusPanel::Jobs;
            model.dirty = true;
        }
        InputCommand::FocusTasks => {
            model.focus_panel = FocusPanel::Tasks;
            model.dirty = true;
        }
        InputCommand::FocusLogs => {
            model.focus_panel = FocusPanel::Logs;
            model.dirty = true;
        }
        InputCommand::CycleFilter => cycle_active_filter(model),
        InputCommand::ToggleFollow => {
            toggle_follow(model);
        }
        InputCommand::ToggleHelp => {
            interaction::context_help(model);
        }
        InputCommand::TogglePalette => {
            model.overlay = if model.overlay == OverlayMode::Palette {
                OverlayMode::None
            } else {
                OverlayMode::Palette
            };
            model.dirty = true;
        }
        InputCommand::PaletteUp => {
            interaction::move_palette(model, -1);
        }
        InputCommand::PaletteDown => {
            interaction::move_palette(model, 1);
        }
        InputCommand::PaletteSelect => {
            let actions = interaction::actions(model);
            if let Some(action) = actions.get(model.palette_index).copied() {
                if let Some(reason) = interaction::disabled(model, action) {
                    model.push_alert("info", &format!("{}: {reason}", action.label()));
                    return Ok(false);
                }
                if apply_palette_action(model, supervisor, next_job_idx, action)? {
                    return Ok(true);
                }
            }
            if model.overlay == OverlayMode::Palette && actions.get(model.palette_index).is_some() {
                model.overlay = OverlayMode::None;
            }
            model.dirty = true;
        }
        InputCommand::SearchOpen => open_search(model),
        InputCommand::SearchAccept => {
            *current_search_mut(model, model.search_target) = model.search_draft.clone();
            model.overlay = OverlayMode::None;
            model.dirty = true;
        }
        InputCommand::SearchCancel => {
            model.overlay = OverlayMode::None;
            model.search_draft.clear();
            model.dirty = true;
        }
        InputCommand::SearchBackspace => {
            model
                .panel_cursor
                .key(&mut model.search_draft, KeyCode::Backspace.into(), 4096);
            model.dirty = true;
        }
        InputCommand::SearchChar(ch) => {
            model
                .panel_cursor
                .key(&mut model.search_draft, KeyCode::Char(ch).into(), 4096);
            model.dirty = true;
        }
        InputCommand::ClearSearch => clear_search(model, model.focus_panel),
        InputCommand::RunJob => {
            start_sample_job(model, supervisor, next_job_idx)?;
        }
        InputCommand::CancelSelected => {
            send_selected_job_cancel(model, supervisor)?;
        }
        InputCommand::LogsUp => {
            model
                .log_scroll
                .set(model.log_scroll.get().saturating_add(1));
            model.dirty = true;
        }
        InputCommand::LogsDown => {
            model
                .log_scroll
                .set(model.log_scroll.get().saturating_sub(1));
            model.dirty = true;
        }
        InputCommand::JobsUp => {
            model.job_scroll = model.job_scroll.saturating_add(1);
            model.dirty = true;
        }
        InputCommand::JobsDown => {
            model.job_scroll = model.job_scroll.saturating_sub(1);
            model.dirty = true;
        }
        InputCommand::TasksUp => {
            model.task_scroll = model.task_scroll.saturating_add(1);
            model.dirty = true;
        }
        InputCommand::TasksDown => {
            model.task_scroll = model.task_scroll.saturating_sub(1);
            model.dirty = true;
        }
    }
    Ok(false)
}

fn flush_model_requests(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
) -> anyhow::Result<()> {
    if !has_live_control(model) {
        model.index_workflows.outbox.clear();
        model.settings.outbox.clear();
        model.repository_search.outbox.clear();
        model.job_inspection.outbox.clear();
        return Ok(());
    }
    for outbox in [
        &mut model.index_workflows.outbox,
        &mut model.settings.outbox,
        &mut model.repository_search.outbox,
        &mut model.job_inspection.outbox,
    ] {
        while let Some(request) = outbox.pop_front() {
            send_request(supervisor, request)?;
        }
    }
    Ok(())
}

fn main() -> anyhow::Result<()> {
    if let Some(fixture_path) = resolve_capture_fixture_path() {
        let output_root = resolve_capture_out_dir()
            .unwrap_or_else(|| Path::new(".testLogs").join("tui").join("frame-capture"));
        return run_capture_fixture_mode(&fixture_path, &output_root);
    }

    let terminal_caps = TerminalCapabilities::detect();
    let run_id = resolve_run_id();
    let observability_dir = resolve_observability_dir();
    fs::create_dir_all(&observability_dir)?;
    let snapshot_path = resolve_snapshot_path();
    let telemetry_path = observability_dir.join(format!("{run_id}.runtime.jsonl"));
    let telemetry_file = fs::OpenOptions::new()
        .create(true)
        .append(true)
        .open(&telemetry_path)
        .ok();

    enable_raw_mode()?;
    let _guard = UiGuard {
        caps: terminal_caps.clone(),
    };
    let mut stdout = std::io::stdout();
    if terminal_caps.alt_screen {
        execute!(stdout, EnterAlternateScreen)?;
    }
    if terminal_caps.mouse {
        execute!(stdout, EnableMouseCapture)?;
    }
    execute!(stdout, EnableBracketedPaste)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let mut model = AppModel::new(run_id.clone(), terminal_caps, telemetry_file);
    if let Some(snapshot) = load_snapshot(&snapshot_path) {
        restore_snapshot(&mut model, snapshot);
    }

    let (supervisor, events_rx) = spawn_supervisor(&run_id, &observability_dir)?;
    let mut supervisor = SupervisorLifetime::new(supervisor, events_rx)?;
    model.owns_control_channel = true;
    let mut recordings = recordings::RecordingUi::default();

    let mut next_job_idx: u64 = 1;
    let mut last_frame = Instant::now();

    let execution = (|| -> anyhow::Result<()> {
        send_request(
            &mut supervisor,
            json!({"proto":"poc.tui@1", "op":"flow:credit",
            "credits":FLOW_CREDIT_BATCH * 4}),
        )?;
        loop {
            let ingress_started = Instant::now();
            let mut transport_closed = false;
            let processed = drain_ingress_turn(
                || match supervisor.poll() {
                    Ok(event) => Some(event),
                    Err(std::sync::mpsc::TryRecvError::Disconnected) => {
                        transport_closed = true;
                        None
                    }
                    Err(std::sync::mpsc::TryRecvError::Empty) => None,
                },
                |received| {
                    let owned_channel = recordings
                        .live_model
                        .as_ref()
                        .map(|live| live.owns_control_channel)
                        .unwrap_or(model.owns_control_channel);
                    recordings.supervisor_event(&received.value, owned_channel);
                    let live = recordings.live_model.as_deref_mut().unwrap_or(&mut model);
                    apply_ingress_event_at(live, received, Instant::now());
                },
                || ingress_started.elapsed(),
            );
            if processed > 0 {
                let live = recordings.live_model.as_deref_mut().unwrap_or(&mut model);
                live.flow_credit_pending = live.flow_credit_pending.saturating_add(processed);
                flush_flow_credits(live, &mut supervisor)?;
            }

            append_runtime_metrics(recordings.live_model.as_deref_mut().unwrap_or(&mut model));
            if let Some(status) = supervisor.try_wait()? {
                model.push_log("supervisor exited; draining owned process family".to_string());
                return Err(anyhow::anyhow!(
                    "supervisor exited before TUI shutdown: {status}"
                ));
            }
            if transport_closed {
                return Err(anyhow::anyhow!(
                    "supervisor event transport closed while the owned child remained active"
                ));
            }

            recordings.tick();
            recordings.update_view(&mut model);
            interaction::activity_tick(&mut model);
            if model.recordings_requested {
                model.recordings_requested = false;
                recordings.open(&observability_dir);
            }
            if model.recording_revision != recordings.revision {
                model.recording_revision = recordings.revision;
                let size = terminal.size()?;
                let area = interaction::overlay_rect(
                    OverlayMode::Recordings,
                    ratatui::layout::Rect::new(0, 0, size.width, size.height),
                );
                model.recording_overlay_text = recordings
                    .lines(
                        area.height.saturating_sub(2) as usize,
                        area.width.saturating_sub(2) as usize,
                    )
                    .join("\n");
                model.dirty = true;
            }

            if model.dirty && last_frame.elapsed() >= FRAME_INTERVAL {
                let signature = frame_signature(&model);
                if signature != model.last_render_signature {
                    let render_ms = draw_ui(&mut terminal, &model)?;
                    model.telemetry.render_ms_ewma = RuntimeTelemetry::update_ewma(
                        model.telemetry.render_ms_ewma,
                        render_ms as f64,
                    );
                    if render_ms > FRAME_BUDGET_MS {
                        model.push_log(format!(
                            "frame budget warning: render={render_ms}ms budget={FRAME_BUDGET_MS}ms"
                        ));
                    }
                    model.last_render_signature = signature;
                }
                model.dirty = false;
                last_frame = Instant::now();
            }

            if event::poll(input_poll_wait(
                supervisor.pending_events(),
                recordings.reconstruction_pending(),
            ))? {
                let terminal_event = event::read()?;
                if matches!(terminal_event, CEvent::Resize(_, _)) {
                    // Terminal::draw performs autoresize through the normal backend.
                    // An unchanged model still needs a new layout after SIGWINCH.
                    invalidate_frame(&mut model);
                    *model.hit_map.borrow_mut() = interaction::HitMap::default();
                    recordings.revision += 1;
                } else if let CEvent::Key(key) = terminal_event {
                    enqueue_terminal_key(&mut model, key);
                } else if let CEvent::Paste(text) = terminal_event {
                    if text.len() <= 8192 {
                        enqueue_input(&mut model, InputCommand::Paste(text), "paste-data");
                    }
                } else if let CEvent::Mouse(mouse) = terminal_event {
                    interaction::mouse(&mut model, mouse);
                }
            }

            if dispatch_input_with_recordings_at(
                &mut model,
                &mut supervisor,
                &mut next_job_idx,
                Some(&mut recordings),
                Instant::now(),
            )? {
                break;
            }
            flush_model_requests(
                recordings.live_model.as_deref_mut().unwrap_or(&mut model),
                &mut supervisor,
            )?;
            // Only this loader's UI receives real transport responses. Saved
            // events never enter this outbox or grant access to live commands.
            while let Some(request) = recordings.outbox.pop_front() {
                send_request(&mut supervisor, request)?;
            }
        }
        Ok(())
    })();

    let live = recordings.live_model.as_deref_mut().unwrap_or(&mut model);
    let shutdown = supervisor.shutdown(|event| apply_ingress_event_at(live, event, Instant::now()));
    interrupt_unobserved_jobs(live);
    save_snapshot(&snapshot_path, live);
    supervisor_lifetime::combine_session_outcomes(execution, shutdown)
}

fn interrupt_unobserved_jobs(model: &mut AppModel) {
    let unfinished: Vec<_> = model
        .job_status
        .iter()
        .filter(|(_, status)| Lifecycle::from_status(status) == Lifecycle::Active)
        .map(|(id, _)| id.clone())
        .collect();
    for id in unfinished {
        // Process-family containment does not supply the lost producer outcome.
        model.update_job_status(&id, "interrupted", None);
        model.reconcile_terminal_tasks(&id, "interrupted");
    }
}
