use std::collections::{BTreeMap, HashMap, VecDeque};
use std::fs;
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use crossterm::event::{
    self, DisableMouseCapture, EnableMouseCapture, Event as CEvent, KeyCode, KeyEventKind,
};
use crossterm::execute;
use crossterm::terminal::{
    disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen,
};
use ratatui::backend::{CrosstermBackend, TestBackend};
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Modifier, Style};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph, Wrap};
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
    selected_job: Option<String>,
    job_scroll: usize,
    task_scroll: usize,
    log_scroll: usize,
}

#[derive(Default)]
struct RuntimeTelemetry {
    event_lag_ms_ewma: f64,
    render_ms_ewma: f64,
    queue_depth_ewma: f64,
    dropped_chunks: u64,
    chunk_reassembled: u64,
    processed_events: u64,
}

impl RuntimeTelemetry {
    fn update_ewma(current: f64, next: f64) -> f64 {
        if current <= 0.0 {
            return next;
        }
        (current * 0.85) + (next * 0.15)
    }
}

#[derive(Default)]
struct SessionState {
    mode: String,
    source: String,
    scope: String,
    connection: String,
    note: String,
}

#[derive(Clone)]
struct AlertEntry {
    level: String,
    message: String,
}

#[derive(Clone)]
struct LogEntry {
    text: String,
    level: String,
    source: String,
}

#[derive(Clone, Copy, PartialEq, Eq)]
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

#[derive(Clone, Copy, PartialEq, Eq)]
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

#[derive(Clone, Copy, PartialEq, Eq)]
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

#[derive(Clone, Copy, PartialEq, Eq)]
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

#[derive(Clone, Copy, PartialEq, Eq)]
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
}

#[derive(Clone, Copy)]
enum PaletteAction {
    ToggleFollow,
    FocusJobs,
    FocusTasks,
    FocusLogs,
    CycleFilter,
    ClearSearch,
    RunJob,
    CancelSelected,
    ShowHelp,
    Quit,
}

impl PaletteAction {
    fn label(&self) -> &'static str {
        match self {
            Self::ToggleFollow => "Toggle follow / pause",
            Self::FocusJobs => "Focus jobs panel",
            Self::FocusTasks => "Focus tasks panel",
            Self::FocusLogs => "Focus logs panel",
            Self::CycleFilter => "Cycle active panel filter",
            Self::ClearSearch => "Clear current panel search",
            Self::RunJob => "Run sample job",
            Self::CancelSelected => "Cancel selected job",
            Self::ShowHelp => "Open help overlay",
            Self::Quit => "Quit TUI",
        }
    }
}

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
    Quit,
    RunJob,
    CancelSelected,
    FocusNext,
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
    run_id: String,
    job_status: BTreeMap<String, String>,
    job_titles: BTreeMap<String, String>,
    job_order: VecDeque<String>,
    task_status: BTreeMap<String, String>,
    task_order: VecDeque<String>,
    logs: VecDeque<LogEntry>,
    alerts: VecDeque<AlertEntry>,
    session: SessionState,
    selected_job: Option<String>,
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
    job_scroll: usize,
    task_scroll: usize,
    log_scroll: usize,
    dirty: bool,
    last_render_signature: String,
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
    last_input_token: String,
}

impl AppModel {
    fn new(
        run_id: String,
        terminal_caps: TerminalCapabilities,
        telemetry_file: Option<fs::File>,
    ) -> Self {
        Self {
            run_id,
            job_status: BTreeMap::new(),
            job_titles: BTreeMap::new(),
            job_order: VecDeque::new(),
            task_status: BTreeMap::new(),
            task_order: VecDeque::new(),
            logs: VecDeque::new(),
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
            },
            selected_job: None,
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
            job_scroll: 0,
            task_scroll: 0,
            log_scroll: 0,
            dirty: true,
            last_render_signature: String::new(),
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
            last_input_token: String::new(),
        }
    }

    fn push_log_entry(&mut self, text: String, level: &str, source: &str) {
        if !self.follow_updates && !self.logs.is_empty() {
            self.log_scroll = self.log_scroll.saturating_add(1);
        }
        if self.logs.len() >= LOG_RING_LIMIT {
            self.logs.pop_front();
        }
        self.logs.push_back(LogEntry {
            text,
            level: level.to_string(),
            source: source.to_string(),
        });
        self.dirty = true;
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
        self.dirty = true;
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
        if self.follow_updates || self.selected_job.is_none() {
            self.selected_job = Some(job_id.to_string());
        }
        self.dirty = true;
    }

    fn update_task_status(
        &mut self,
        job_id: &str,
        task_id: &str,
        status: &str,
        message: Option<&str>,
    ) {
        let key = format!("{job_id}:{task_id}");
        if !self.task_status.contains_key(&key) {
            self.task_order.push_back(key.clone());
            while self.task_order.len() > TASK_RING_LIMIT {
                if let Some(old) = self.task_order.pop_front() {
                    self.task_status.remove(&old);
                }
            }
        }
        let mut text = status.to_string();
        if let Some(msg) = message {
            if !msg.trim().is_empty() {
                text = format!("{status} {msg}");
            }
        }
        self.task_status.insert(key, text);
        self.dirty = true;
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

fn save_snapshot(snapshot_path: &Path, model: &AppModel) {
    let payload = SessionSnapshot {
        selected_job: model.selected_job.clone(),
        job_scroll: model.job_scroll,
        task_scroll: model.task_scroll,
        log_scroll: model.log_scroll,
    };
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
) -> anyhow::Result<(std::process::Child, Receiver<Value>)> {
    let node_from_exe = std::env::current_exe()?.with_file_name("node");
    let mut child = Command::new(&node_from_exe)
        .arg("tools/tui/supervisor.js")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .env("PAIROFCLEATS_TUI_RUN_ID", run_id)
        .env("PAIROFCLEATS_TUI_EVENT_LOG_DIR", event_log_dir)
        .spawn()
        .or_else(|_| {
            Command::new("node")
                .arg("tools/tui/supervisor.js")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .env("PAIROFCLEATS_TUI_RUN_ID", run_id)
                .env("PAIROFCLEATS_TUI_EVENT_LOG_DIR", event_log_dir)
                .spawn()
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| anyhow::anyhow!("missing supervisor stdout"))?;
    let (tx, rx) = mpsc::channel();
    std::thread::spawn(move || {
        let reader = BufReader::new(stdout);
        for line in reader.lines().map_while(Result::ok) {
            if line.trim().is_empty() {
                continue;
            }
            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                let _ = tx.send(value);
            }
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
    let last_log = model
        .logs
        .back()
        .map(|entry| entry.text.clone())
        .unwrap_or_default();
    let selected = model.selected_job.clone().unwrap_or_default();
    let last_alert = model
        .alerts
        .back()
        .map(|alert| format!("{}:{}", alert.level, alert.message))
        .unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}|{}",
        model.run_id,
        model.job_status.len(),
        model.task_status.len(),
        model.logs.len(),
        selected,
        model.focus_panel.label(),
        model.follow_updates,
        model.job_filter.label(),
        model.task_filter.label(),
        model.log_level_filter.label(),
        model.job_scroll,
        last_log,
        model.session.mode,
        last_alert
    )
}

fn current_search<'a>(model: &'a AppModel, panel: FocusPanel) -> &'a str {
    match panel {
        FocusPanel::Jobs => &model.search_jobs,
        FocusPanel::Tasks => &model.search_tasks,
        FocusPanel::Logs => &model.search_logs,
    }
}

fn current_search_mut<'a>(model: &'a mut AppModel, panel: FocusPanel) -> &'a mut String {
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

fn contains_query(text: &str, query: &str) -> bool {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return true;
    }
    text.to_lowercase().contains(&needle)
}

fn matches_job_filter(status: &str, filter: JobFilter) -> bool {
    match filter {
        JobFilter::All => true,
        JobFilter::Active => !status.contains("failed") && !status.contains("done"),
        JobFilter::Failed => status.contains("failed") || status.contains("cancelled"),
        JobFilter::Done => status.contains("done"),
    }
}

fn matches_task_filter(status: &str, filter: TaskFilter) -> bool {
    match filter {
        TaskFilter::All => true,
        TaskFilter::Active => !status.contains("failed") && !status.contains("done"),
        TaskFilter::Failed => status.contains("failed"),
        TaskFilter::Done => status.contains("done"),
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

fn job_status_counts(model: &AppModel) -> (usize, usize, usize) {
    let mut running = 0usize;
    let mut failed = 0usize;
    let mut done = 0usize;
    for status in model.job_status.values() {
        if status.contains("failed") {
            failed += 1;
        } else if status.contains("done") {
            done += 1;
        } else {
            running += 1;
        }
    }
    (running, failed, done)
}

fn task_status_counts(model: &AppModel) -> (usize, usize) {
    let mut active = 0usize;
    let mut failed = 0usize;
    for status in model.task_status.values() {
        if status.contains("failed") {
            failed += 1;
        } else if !status.contains("done") {
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
    let chars: Vec<char> = text.chars().collect();
    if chars.len() <= width {
        return text.to_string();
    }
    if width <= 1 {
        return "…".to_string();
    }
    let mut output = chars
        .into_iter()
        .take(width.saturating_sub(1))
        .collect::<String>();
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

fn wrap_text_lines(text: &str, width: usize, max_lines: usize) -> Vec<String> {
    if width == 0 || max_lines == 0 {
        return Vec::new();
    }
    let mut output = Vec::new();
    for raw_line in text.split('\n') {
        let mut remaining = raw_line.trim();
        if remaining.is_empty() {
            output.push(String::new());
            if output.len() >= max_lines {
                break;
            }
            continue;
        }
        while !remaining.is_empty() && output.len() < max_lines {
            let chars: Vec<char> = remaining.chars().collect();
            if chars.len() <= width {
                output.push(remaining.to_string());
                break;
            }
            let slice = chars.iter().take(width).collect::<String>();
            let boundary = slice.rfind(' ').unwrap_or(width);
            let next_line = slice[..boundary].trim_end().to_string();
            output.push(if next_line.is_empty() {
                slice
            } else {
                next_line
            });
            let consumed = boundary.min(remaining.len());
            remaining = remaining[consumed..].trim_start();
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
        format!("jobs {}", model.job_filter.label()),
        format!("tasks {}", model.task_filter.label()),
        format!(
            "logs {}/{}",
            model.log_level_filter.label(),
            model.log_source_filter.label()
        ),
    ];
    let active_search = current_search(model, model.focus_panel);
    if !active_search.trim().is_empty() {
        parts.push(format!("search {}", active_search.trim()));
    }
    fit_text(&parts.join(" | "), width)
}

fn runtime_summary_text(model: &AppModel, width: usize) -> String {
    let (running_jobs, failed_jobs, done_jobs) = job_status_counts(model);
    let (active_tasks, failed_tasks) = task_status_counts(model);
    let parts = vec![
        format!("jobs {running_jobs}r/{failed_jobs}f/{done_jobs}d"),
        format!("tasks {active_tasks}a/{failed_tasks}f"),
        format!("queue {:.0}", model.telemetry.queue_depth_ewma),
        format!("lag {:.0}ms", model.telemetry.event_lag_ms_ewma),
        format!("render {:.0}ms", model.telemetry.render_ms_ewma),
        format!("note {}", model.session.note),
    ];
    fit_text(&parts.join(" | "), width)
}

fn footer_hint_text(model: &AppModel, width: usize) -> String {
    let text = match model.overlay {
        OverlayMode::Help => "help overlay | Esc or ? close",
        OverlayMode::Palette => "action palette | j/k move | Enter select | Esc close",
        OverlayMode::Search => "search | type to filter current panel | Enter apply | Backspace delete | Esc cancel",
        OverlayMode::None => "Tab focus | f cycle filter | / search | x clear search | p pause/follow | : actions | ? help | q quit",
    };
    fit_text(text, width)
}

fn build_job_rows(model: &AppModel, width: usize) -> Vec<ListItem<'static>> {
    let mut rows = Vec::new();
    if model.job_order.is_empty() {
        rows.push(ListItem::new(fit_text(&jobs_empty_reason(model), width)));
        return rows;
    }
    for job_id in &model.job_order {
        let Some(status) = model.job_status.get(job_id) else {
            continue;
        };
        if !matches_job_filter(status, model.job_filter) {
            continue;
        }
        let title = model.job_titles.get(job_id).cloned().unwrap_or_default();
        let rendered = if title.is_empty() {
            format!("{job_id} | {status}")
        } else {
            format!("{job_id} | {status} | {title}")
        };
        if !contains_query(&rendered, &model.search_jobs) {
            continue;
        }
        let style = if !model.terminal_caps.color {
            Style::default()
        } else if model.selected_job.as_deref() == Some(job_id.as_str()) {
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD)
        } else if status.contains("done") {
            Style::default().fg(Color::Green)
        } else if status.contains("failed") {
            Style::default().fg(Color::Red)
        } else if status.contains("cancelled") {
            Style::default().fg(Color::Yellow)
        } else if status.contains("running") {
            Style::default().fg(Color::Blue)
        } else {
            Style::default().fg(Color::Gray)
        };
        rows.push(ListItem::new(fit_text(&rendered, width)).style(style));
    }
    if rows.is_empty() {
        rows.push(ListItem::new(fit_text(&jobs_empty_reason(model), width)));
    }
    rows
}

fn build_task_rows(model: &AppModel, width: usize) -> Vec<ListItem<'static>> {
    let selected_job = model.selected_job.clone().unwrap_or_default();
    let mut rows = Vec::new();
    for key in &model.task_order {
        if !selected_job.is_empty() && !key.starts_with(&format!("{selected_job}:")) {
            continue;
        }
        let Some(status) = model.task_status.get(key) else {
            continue;
        };
        if !matches_task_filter(status, model.task_filter) {
            continue;
        }
        let task_name = key.rsplit(':').next().unwrap_or(key);
        let rendered = format!("{task_name} | {status}");
        if !contains_query(&rendered, &model.search_tasks) {
            continue;
        }
        let style = if !model.terminal_caps.color {
            Style::default()
        } else if status.contains("failed") {
            Style::default().fg(Color::Red)
        } else if status.contains("done") {
            Style::default().fg(Color::Green)
        } else {
            Style::default().fg(Color::Yellow)
        };
        rows.push(ListItem::new(fit_text(&rendered, width)).style(style));
    }
    if rows.is_empty() {
        rows.push(ListItem::new(fit_text(&tasks_empty_reason(model), width)));
    }
    rows
}

fn render_log_entry(entry: &LogEntry) -> String {
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
    let filtered: Vec<LogEntry> = model
        .logs
        .iter()
        .filter(|entry| matches_log_level_filter(&entry.level, model.log_level_filter))
        .filter(|entry| matches_log_source_filter(&entry.source, model.log_source_filter))
        .filter(|entry| contains_query(&render_log_entry(entry), &model.search_logs))
        .cloned()
        .collect();
    let visible_logs = tail_window_slice(&filtered, model.log_scroll, filtered.len().max(1));
    let mut lines = Vec::new();
    for entry in visible_logs {
        let wrapped = wrap_text_lines(&render_log_entry(&entry), width, 2);
        for line in wrapped {
            lines.push(line);
            if lines.len() >= height {
                break;
            }
        }
        if lines.len() >= height {
            break;
        }
    }
    if lines.is_empty() {
        lines.push(logs_empty_reason(model));
    }
    let start = lines.len().saturating_sub(height.max(1));
    lines[start..].join("\n")
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
    let area = centered_rect(76, 70, frame.area());
    let text = [
        "Operator Help",
        "",
        "Tab switch focus panels",
        "f cycle filter for focused panel",
        "/ search within focused panel",
        "x clear search for focused panel",
        "p toggle follow/pause",
        ": open action palette",
        "? close help",
        "r run sample job",
        "c cancel selected job",
        "q quit",
        "",
        &format!(
            "Current: focus {} | follow {}",
            model.focus_panel.label(),
            if model.follow_updates {
                "live"
            } else {
                "paused"
            }
        ),
    ]
    .join("\n");
    let overlay = Paragraph::new(text)
        .wrap(Wrap { trim: true })
        .block(panel_block(
            "Help".to_string(),
            true,
            model.terminal_caps.color,
        ));
    frame.render_widget(overlay, area);
}

fn palette_actions() -> Vec<PaletteAction> {
    vec![
        PaletteAction::ToggleFollow,
        PaletteAction::FocusJobs,
        PaletteAction::FocusTasks,
        PaletteAction::FocusLogs,
        PaletteAction::CycleFilter,
        PaletteAction::ClearSearch,
        PaletteAction::RunJob,
        PaletteAction::CancelSelected,
        PaletteAction::ShowHelp,
        PaletteAction::Quit,
    ]
}

fn render_palette_overlay(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let actions = palette_actions();
    let area = centered_rect(68, 60, frame.area());
    let rows: Vec<ListItem<'static>> = actions
        .iter()
        .enumerate()
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
            ListItem::new(format!("{prefix} {}", action.label())).style(style)
        })
        .collect();
    let overlay = List::new(rows).block(panel_block(
        "Actions".to_string(),
        true,
        model.terminal_caps.color,
    ));
    frame.render_widget(overlay, area);
}

fn render_search_overlay(frame: &mut ratatui::Frame<'_>, model: &AppModel) {
    let area = centered_rect(64, 22, frame.area());
    let text = format!(
        "Search {}\n\n{}\n\nEnter apply | Esc cancel | Backspace delete",
        model.search_target.label(),
        if model.search_draft.is_empty() {
            "Type to filter".to_string()
        } else {
            model.search_draft.clone()
        }
    );
    let overlay = Paragraph::new(text)
        .wrap(Wrap { trim: true })
        .block(panel_block(
            "Search".to_string(),
            true,
            model.terminal_caps.color,
        ));
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
    let session_width = frame.area().width.saturating_sub(2) as usize;
    let rows = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Length(3),
            Constraint::Length(3),
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

    let footer_block = Paragraph::new(footer_hint_text(model, session_width))
        .wrap(Wrap { trim: true })
        .block(Block::default().borders(Borders::ALL).title("Hints"));
    frame.render_widget(footer_block, rows[3]);

    if rows[4].width < 100 {
        let stacked = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Percentage(30),
                Constraint::Percentage(30),
                Constraint::Percentage(40),
            ])
            .split(rows[4]);
        let jobs_width = stacked[0].width.saturating_sub(2) as usize;
        let tasks_width = stacked[1].width.saturating_sub(2) as usize;
        let logs_width = stacked[2].width.saturating_sub(2) as usize;
        let jobs = List::new(build_job_rows(model, jobs_width)).block(panel_block(
            block_title(
                "Jobs",
                model.focus_panel == FocusPanel::Jobs,
                &[format!("filter {}", model.job_filter.label()), {
                    let query = model.search_jobs.trim();
                    if query.is_empty() {
                        String::new()
                    } else {
                        format!("search {}", query)
                    }
                }],
            ),
            model.focus_panel == FocusPanel::Jobs,
            model.terminal_caps.color,
        ));
        frame.render_widget(jobs, stacked[0]);
        let tasks = List::new(build_task_rows(model, tasks_width)).block(panel_block(
            block_title(
                "Tasks",
                model.focus_panel == FocusPanel::Tasks,
                &[format!("filter {}", model.task_filter.label()), {
                    let query = model.search_tasks.trim();
                    if query.is_empty() {
                        String::new()
                    } else {
                        format!("search {}", query)
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
                            format!("search {}", query)
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
            .split(rows[4]);

        let jobs_width = cols[0].width.saturating_sub(2) as usize;
        let tasks_width = cols[1].width.saturating_sub(2) as usize;
        let logs_width = cols[2].width.saturating_sub(2) as usize;

        let jobs = List::new(build_job_rows(model, jobs_width)).block(panel_block(
            block_title(
                "Jobs",
                model.focus_panel == FocusPanel::Jobs,
                &[format!("filter {}", model.job_filter.label()), {
                    let query = model.search_jobs.trim();
                    if query.is_empty() {
                        String::new()
                    } else {
                        format!("search {}", query)
                    }
                }],
            ),
            model.focus_panel == FocusPanel::Jobs,
            model.terminal_caps.color,
        ));
        frame.render_widget(jobs, cols[0]);

        let tasks = List::new(build_task_rows(model, tasks_width)).block(panel_block(
            block_title(
                "Tasks",
                model.focus_panel == FocusPanel::Tasks,
                &[format!("filter {}", model.task_filter.label()), {
                    let query = model.search_tasks.trim();
                    if query.is_empty() {
                        String::new()
                    } else {
                        format!("search {}", query)
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
                            format!("search {}", query)
                        }
                    },
                ],
            ),
            model.focus_panel == FocusPanel::Logs,
            model.terminal_caps.color,
        ));
        frame.render_widget(logs, cols[2]);
    }

    match model.overlay {
        OverlayMode::Help => render_help_overlay(frame, model),
        OverlayMode::Palette => render_palette_overlay(frame, model),
        OverlayMode::Search => render_search_overlay(frame, model),
        OverlayMode::None => {}
    }
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
            model.follow_updates = !model.follow_updates;
            model.dirty = true;
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
            let actions = palette_actions();
            if model.palette_index == 0 {
                model.palette_index = actions.len().saturating_sub(1);
            } else {
                model.palette_index = model.palette_index.saturating_sub(1);
            }
            model.dirty = true;
        }
        "palette_down" => {
            let actions = palette_actions();
            model.palette_index = (model.palette_index + 1) % actions.len().max(1);
            model.dirty = true;
        }
        "palette_select" => {
            if let Some(action) = palette_actions().get(model.palette_index).copied() {
                match action {
                    PaletteAction::ToggleFollow => model.follow_updates = !model.follow_updates,
                    PaletteAction::FocusJobs => model.focus_panel = FocusPanel::Jobs,
                    PaletteAction::FocusTasks => model.focus_panel = FocusPanel::Tasks,
                    PaletteAction::FocusLogs => model.focus_panel = FocusPanel::Logs,
                    PaletteAction::CycleFilter => cycle_active_filter(model),
                    PaletteAction::ClearSearch => clear_search(model, model.focus_panel),
                    PaletteAction::ShowHelp => model.overlay = OverlayMode::Help,
                    PaletteAction::RunJob | PaletteAction::CancelSelected | PaletteAction::Quit => {
                    }
                }
            }
            if model.overlay == OverlayMode::Palette {
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
            model.log_scroll = model.log_scroll.saturating_add(1);
            model.dirty = true;
        }
        "logs_down" => {
            model.log_scroll = model.log_scroll.saturating_sub(1);
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
        log_scroll: model.log_scroll,
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
            model.log_scroll = log_scroll;
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
    model.overlay = OverlayMode::Search;
    model.dirty = true;
}

fn apply_palette_action(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
    action: PaletteAction,
) -> anyhow::Result<bool> {
    match action {
        PaletteAction::ToggleFollow => {
            model.follow_updates = !model.follow_updates;
            model.dirty = true;
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
            let job_id = format!("job-{}", *next_job_idx);
            *next_job_idx += 1;
            let _ = send_request(
                supervisor,
                json!({
                    "proto": "poc.tui@1",
                    "op": "job:run",
                    "jobId": job_id,
                    "title": "Search Help",
                    "argv": ["search", "--help"]
                }),
            );
        }
        PaletteAction::CancelSelected => {
            if let Some(job_id) = model.selected_job.clone() {
                let _ = send_request(
                    supervisor,
                    json!({
                        "proto": "poc.tui@1",
                        "op": "job:cancel",
                        "jobId": job_id,
                        "reason": "user_cancel"
                    }),
                );
            }
        }
        PaletteAction::ShowHelp => {
            model.overlay = OverlayMode::Help;
            model.dirty = true;
        }
        PaletteAction::Quit => {
            let _ = send_request(
                supervisor,
                json!({"proto": "poc.tui@1", "op": "shutdown", "reason": "user_exit"}),
            );
            return Ok(true);
        }
    }
    Ok(false)
}

fn enqueue_input(model: &mut AppModel, command: InputCommand, token: &str) {
    let now = Instant::now();
    if token == model.last_input_token
        && now.duration_since(model.last_input_at).as_millis() < INPUT_DEBOUNCE_MS
    {
        return;
    }
    let seq = model.next_input_seq;
    model.next_input_seq += 1;
    model.last_input_at = now;
    model.last_input_token = token.to_string();
    model.input_queue.push_back((seq, command));
}

fn flush_flow_credits(model: &mut AppModel, supervisor: &mut std::process::Child) {
    if model.flow_credit_pending == 0 {
        return;
    }
    if model.flow_credit_pending < FLOW_CREDIT_BATCH
        && model.last_credit_flush.elapsed() < FLOW_CREDIT_FLUSH_INTERVAL
    {
        return;
    }
    let credits = model.flow_credit_pending;
    let _ = send_request(
        supervisor,
        json!({
            "proto": "poc.tui@1",
            "op": "flow:credit",
            "credits": credits
        }),
    );
    model.flow_credit_pending = 0;
    model.last_credit_flush = Instant::now();
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
        model.chunk_assemblies.remove(&chunk_id);
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
            format!("job finished | {job_id} | {status}")
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

fn apply_protocol_event(model: &mut AppModel, event: Value, queue_depth: usize) {
    let event_name = event
        .get("event")
        .and_then(|value| value.as_str())
        .unwrap_or("unknown")
        .to_string();

    if event_name == "event:chunk" {
        if let Some(rebuilt) = handle_chunk_event(model, &event) {
            apply_protocol_event(model, rebuilt, queue_depth);
        }
        return;
    }

    model.telemetry.processed_events += 1;
    model.telemetry.queue_depth_ewma =
        RuntimeTelemetry::update_ewma(model.telemetry.queue_depth_ewma, queue_depth as f64);
    model.telemetry.event_lag_ms_ewma = RuntimeTelemetry::update_ewma(
        model.telemetry.event_lag_ms_ewma,
        (queue_depth as f64) * INPUT_POLL_INTERVAL.as_millis() as f64,
    );

    if let Some(run_id) = event.get("runId").and_then(|value| value.as_str()) {
        model.run_id = run_id.to_string();
    }
    if event_name == "hello" {
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
    }
    if event_name == "session:attach" {
        apply_session_descriptor(model, &event);
    }
    if let Some(job_id) = event.get("jobId").and_then(|value| value.as_str()) {
        if event_name == "job:start" || event_name == "job:spawn" {
            let title = event.get("title").and_then(|value| value.as_str());
            model.update_job_status(job_id, "running", title);
        } else if event_name == "job:end" {
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            model.update_job_status(job_id, status, None);
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
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or(if event_name == "task:end" {
                    "done"
                } else {
                    "running"
                });
            let msg = event.get("message").and_then(|value| value.as_str());
            model.update_task_status(job_id, task_id, status, msg);
        }
    }

    if event_name == "runtime:metrics" {
        if let Some(flow) = event.get("flow").and_then(|value| value.as_object()) {
            let queue_depth = flow
                .get("queueDepth")
                .and_then(|value| value.as_u64())
                .unwrap_or(0) as f64;
            model.telemetry.queue_depth_ewma =
                RuntimeTelemetry::update_ewma(model.telemetry.queue_depth_ewma, queue_depth);
        }
        model.update_session_state(
            None,
            None,
            None,
            Some("streaming"),
            Some("receiving runtime metrics"),
        );
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
    model.push_log_entry(log_line, &log_level, &log_source);
}

fn dispatch_input(
    model: &mut AppModel,
    supervisor: &mut std::process::Child,
    next_job_idx: &mut u64,
) -> anyhow::Result<bool> {
    if model.input_queue.is_empty() {
        return Ok(false);
    }
    if model.last_input_at.elapsed().as_millis() < INPUT_DISPATCH_INTERVAL_MS {
        return Ok(false);
    }
    let (_, cmd) = model.input_queue.pop_front().unwrap();
    model.last_input_at = Instant::now();
    match cmd {
        InputCommand::Quit => {
            let _ = send_request(
                supervisor,
                json!({"proto": "poc.tui@1", "op": "shutdown", "reason": "user_exit"}),
            );
            return Ok(true);
        }
        InputCommand::FocusNext => {
            model.focus_panel = model.focus_panel.next();
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
            model.follow_updates = !model.follow_updates;
            model.dirty = true;
        }
        InputCommand::ToggleHelp => {
            model.overlay = if model.overlay == OverlayMode::Help {
                OverlayMode::None
            } else {
                OverlayMode::Help
            };
            model.dirty = true;
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
            let actions = palette_actions();
            if model.palette_index == 0 {
                model.palette_index = actions.len().saturating_sub(1);
            } else {
                model.palette_index = model.palette_index.saturating_sub(1);
            }
            model.dirty = true;
        }
        InputCommand::PaletteDown => {
            let actions = palette_actions();
            model.palette_index = (model.palette_index + 1) % actions.len().max(1);
            model.dirty = true;
        }
        InputCommand::PaletteSelect => {
            let actions = palette_actions();
            if let Some(action) = actions.get(model.palette_index).copied() {
                if apply_palette_action(model, supervisor, next_job_idx, action)? {
                    return Ok(true);
                }
            }
            if model.overlay == OverlayMode::Palette {
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
            model.search_draft.pop();
            model.dirty = true;
        }
        InputCommand::SearchChar(ch) => {
            model.search_draft.push(ch);
            model.dirty = true;
        }
        InputCommand::ClearSearch => clear_search(model, model.focus_panel),
        InputCommand::RunJob => {
            let job_id = format!("job-{}", *next_job_idx);
            *next_job_idx += 1;
            let _ = send_request(
                supervisor,
                json!({
                    "proto": "poc.tui@1",
                    "op": "job:run",
                    "jobId": job_id,
                    "title": "Search Help",
                    "argv": ["search", "--help"]
                }),
            );
        }
        InputCommand::CancelSelected => {
            if let Some(job_id) = model.selected_job.clone() {
                let _ = send_request(
                    supervisor,
                    json!({
                        "proto": "poc.tui@1",
                        "op": "job:cancel",
                        "jobId": job_id,
                        "reason": "user_cancel"
                    }),
                );
            }
        }
        InputCommand::LogsUp => {
            model.log_scroll = model.log_scroll.saturating_add(1);
            model.dirty = true;
        }
        InputCommand::LogsDown => {
            model.log_scroll = model.log_scroll.saturating_sub(1);
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

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let mut model = AppModel::new(run_id.clone(), terminal_caps, telemetry_file);
    if let Some(snapshot) = load_snapshot(&snapshot_path) {
        model.selected_job = snapshot.selected_job;
        model.job_scroll = snapshot.job_scroll;
        model.task_scroll = snapshot.task_scroll;
        model.log_scroll = snapshot.log_scroll;
    }

    let (mut supervisor, events_rx) = spawn_supervisor(&run_id, &observability_dir)?;

    let _ = send_request(
        &mut supervisor,
        json!({
            "proto": "poc.tui@1",
            "op": "flow:credit",
            "credits": FLOW_CREDIT_BATCH * 4
        }),
    );

    let mut next_job_idx: u64 = 1;
    let mut last_frame = Instant::now();

    loop {
        let mut processed = 0u64;
        while let Ok(event) = events_rx.try_recv() {
            apply_protocol_event(&mut model, event, 0);
            processed += 1;
        }
        if processed > 0 {
            model.flow_credit_pending = model.flow_credit_pending.saturating_add(processed);
            flush_flow_credits(&mut model, &mut supervisor);
        }

        append_runtime_metrics(&mut model);

        if model.dirty && last_frame.elapsed() >= FRAME_INTERVAL {
            let signature = frame_signature(&model);
            if signature != model.last_render_signature {
                let render_ms = draw_ui(&mut terminal, &model)?;
                model.telemetry.render_ms_ewma =
                    RuntimeTelemetry::update_ewma(model.telemetry.render_ms_ewma, render_ms as f64);
                if render_ms > FRAME_BUDGET_MS {
                    model.push_log(format!(
                        "frame budget warning: render={}ms budget={}ms",
                        render_ms, FRAME_BUDGET_MS
                    ));
                }
                model.last_render_signature = signature;
            }
            model.dirty = false;
            last_frame = Instant::now();
        }

        if event::poll(Duration::from_millis(20))? {
            if let CEvent::Key(key) = event::read()? {
                if key.kind == KeyEventKind::Release {
                    continue;
                }
                match model.overlay {
                    OverlayMode::Help => match key.code {
                        KeyCode::Esc | KeyCode::Char('?') => {
                            enqueue_input(&mut model, InputCommand::ToggleHelp, "help-close")
                        }
                        _ => {}
                    },
                    OverlayMode::Palette => match key.code {
                        KeyCode::Esc | KeyCode::Char(':') => {
                            enqueue_input(&mut model, InputCommand::TogglePalette, "palette-close")
                        }
                        KeyCode::Char('j') | KeyCode::Down => {
                            enqueue_input(&mut model, InputCommand::PaletteDown, "palette-down")
                        }
                        KeyCode::Char('k') | KeyCode::Up => {
                            enqueue_input(&mut model, InputCommand::PaletteUp, "palette-up")
                        }
                        KeyCode::Enter => {
                            enqueue_input(&mut model, InputCommand::PaletteSelect, "palette-select")
                        }
                        _ => {}
                    },
                    OverlayMode::Search => match key.code {
                        KeyCode::Esc => {
                            enqueue_input(&mut model, InputCommand::SearchCancel, "search-cancel")
                        }
                        KeyCode::Enter => {
                            enqueue_input(&mut model, InputCommand::SearchAccept, "search-accept")
                        }
                        KeyCode::Backspace => enqueue_input(
                            &mut model,
                            InputCommand::SearchBackspace,
                            "search-backspace",
                        ),
                        KeyCode::Char(ch) if !ch.is_control() => enqueue_input(
                            &mut model,
                            InputCommand::SearchChar(ch),
                            &format!("search-char-{ch}"),
                        ),
                        _ => {}
                    },
                    OverlayMode::None => match key.code {
                        KeyCode::Char('q') => enqueue_input(&mut model, InputCommand::Quit, "q"),
                        KeyCode::Char('r') => enqueue_input(&mut model, InputCommand::RunJob, "r"),
                        KeyCode::Char('c') => {
                            enqueue_input(&mut model, InputCommand::CancelSelected, "c")
                        }
                        KeyCode::Char('j') => enqueue_input(&mut model, InputCommand::LogsUp, "j"),
                        KeyCode::Char('k') => {
                            enqueue_input(&mut model, InputCommand::LogsDown, "k")
                        }
                        KeyCode::Char('n') => enqueue_input(&mut model, InputCommand::JobsUp, "n"),
                        KeyCode::Char('m') => {
                            enqueue_input(&mut model, InputCommand::JobsDown, "m")
                        }
                        KeyCode::Char('u') => enqueue_input(&mut model, InputCommand::TasksUp, "u"),
                        KeyCode::Char('i') => {
                            enqueue_input(&mut model, InputCommand::TasksDown, "i")
                        }
                        KeyCode::Tab => {
                            enqueue_input(&mut model, InputCommand::FocusNext, "focus-next")
                        }
                        KeyCode::Char('1') => {
                            enqueue_input(&mut model, InputCommand::FocusJobs, "focus-jobs")
                        }
                        KeyCode::Char('2') => {
                            enqueue_input(&mut model, InputCommand::FocusTasks, "focus-tasks")
                        }
                        KeyCode::Char('3') => {
                            enqueue_input(&mut model, InputCommand::FocusLogs, "focus-logs")
                        }
                        KeyCode::Char('f') => {
                            enqueue_input(&mut model, InputCommand::CycleFilter, "cycle-filter")
                        }
                        KeyCode::Char('p') => {
                            enqueue_input(&mut model, InputCommand::ToggleFollow, "toggle-follow")
                        }
                        KeyCode::Char('?') => {
                            enqueue_input(&mut model, InputCommand::ToggleHelp, "toggle-help")
                        }
                        KeyCode::Char(':') | KeyCode::Char('a') => {
                            enqueue_input(&mut model, InputCommand::TogglePalette, "toggle-palette")
                        }
                        KeyCode::Char('/') => {
                            enqueue_input(&mut model, InputCommand::SearchOpen, "search-open")
                        }
                        KeyCode::Char('x') => {
                            enqueue_input(&mut model, InputCommand::ClearSearch, "clear-search")
                        }
                        _ => {}
                    },
                }
            }
        }

        if dispatch_input(&mut model, &mut supervisor, &mut next_job_idx)? {
            break;
        }
    }

    save_snapshot(&snapshot_path, &model);
    let _ = supervisor.kill();
    Ok(())
}
