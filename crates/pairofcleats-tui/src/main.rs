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
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};
use ratatui::Terminal;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const LOG_RING_LIMIT: usize = 2048;
const JOB_RING_LIMIT: usize = 512;
const TASK_RING_LIMIT: usize = 2048;
const CHUNK_ASSEMBLY_LIMIT_BYTES: usize = 2 * 1024 * 1024;
const FRAME_INTERVAL: Duration = Duration::from_millis(50);
const INPUT_POLL_INTERVAL: Duration = Duration::from_millis(20);
const FRAME_BUDGET_MS: u128 = 16;
const INPUT_DEBOUNCE_MS: u128 = 40;
const INPUT_DISPATCH_INTERVAL_MS: u128 = 25;
const FLOW_CREDIT_BATCH: u64 = 64;
const FLOW_CREDIT_FLUSH_INTERVAL: Duration = Duration::from_millis(80);
const METRICS_EMIT_INTERVAL: Duration = Duration::from_millis(1000);

#[derive(Clone)]
struct TerminalCapabilities {
    color: bool,
    unicode: bool,
    mouse: bool,
    alt_screen: bool,
}

impl TerminalCapabilities {
    fn detect() -> Self {
        let no_color = std::env::var("NO_COLOR").ok().map(|v| !v.trim().is_empty()).unwrap_or(false);
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

struct ChunkAssembly {
    chunk_count: usize,
    parts: Vec<Option<String>>,
    bytes: usize,
}

#[derive(Clone)]
enum InputCommand {
    Quit,
    RunJob,
    CancelSelected,
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
    job_order: VecDeque<String>,
    task_status: BTreeMap<String, String>,
    task_order: VecDeque<String>,
    logs: VecDeque<String>,
    selected_job: Option<String>,
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
    fn new(run_id: String, terminal_caps: TerminalCapabilities, telemetry_file: Option<fs::File>) -> Self {
        Self {
            run_id,
            job_status: BTreeMap::new(),
            job_order: VecDeque::new(),
            task_status: BTreeMap::new(),
            task_order: VecDeque::new(),
            logs: VecDeque::new(),
            selected_job: None,
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

    fn push_log(&mut self, message: String) {
        if self.logs.len() >= LOG_RING_LIMIT {
            self.logs.pop_front();
        }
        self.logs.push_back(message);
        self.dirty = true;
    }

    fn update_job_status(&mut self, job_id: &str, status: &str) {
        if !self.job_status.contains_key(job_id) {
            self.job_order.push_back(job_id.to_string());
            while self.job_order.len() > JOB_RING_LIMIT {
                if let Some(old) = self.job_order.pop_front() {
                    self.job_status.remove(&old);
                }
            }
        }
        self.job_status.insert(job_id.to_string(), status.to_string());
        self.selected_job = Some(job_id.to_string());
        self.dirty = true;
    }

    fn update_task_status(&mut self, job_id: &str, task_id: &str, status: &str, message: Option<&str>) {
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

fn resolve_observability_dir() -> PathBuf {
    if let Ok(value) = std::env::var("PAIROFCLEATS_TUI_EVENT_LOG_DIR") {
        if !value.trim().is_empty() {
            return PathBuf::from(value.trim());
        }
    }
    Path::new(".cache").join("tui").join("install-v1").join("session-logs")
}

fn resolve_snapshot_path() -> PathBuf {
    if let Ok(value) = std::env::var("PAIROFCLEATS_TUI_SNAPSHOT_PATH") {
        if !value.trim().is_empty() {
            return PathBuf::from(value.trim());
        }
    }
    Path::new(".cache").join("tui").join("last-state.json")
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

fn spawn_supervisor(run_id: &str, event_log_dir: &Path) -> anyhow::Result<(std::process::Child, Receiver<Value>)> {
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
        for line in reader.lines().flatten() {
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

fn list_window(items: &[String], scroll: usize, height: usize) -> Vec<String> {
    if items.is_empty() {
        return vec!["(empty)".to_string()];
    }
    let safe_height = height.max(1);
    let max_start = items.len().saturating_sub(safe_height);
    let start = scroll.min(max_start);
    items.iter().skip(start).take(safe_height).cloned().collect()
}

fn tail_window(items: &VecDeque<String>, scroll: usize, height: usize) -> Vec<String> {
    if items.is_empty() {
        return vec!["(empty)".to_string()];
    }
    let total = items.len();
    let end = total.saturating_sub(scroll.min(total));
    let safe_height = height.max(1);
    let start = end.saturating_sub(safe_height);
    items.iter().skip(start).take(end.saturating_sub(start)).cloned().collect()
}

fn frame_signature(model: &AppModel) -> String {
    let last_log = model.logs.back().cloned().unwrap_or_default();
    let selected = model.selected_job.clone().unwrap_or_default();
    format!(
        "{}|{}|{}|{}|{}|{}|{}",
        model.run_id,
        model.job_status.len(),
        model.task_status.len(),
        model.logs.len(),
        selected,
        model.job_scroll,
        last_log
    )
}

fn draw_ui(
    terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>,
    model: &AppModel,
) -> anyhow::Result<u128> {
    let frame_started = Instant::now();
    terminal.draw(|frame| {
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Length(3),
                Constraint::Min(1),
            ])
            .split(frame.area());

        let controls = if model.terminal_caps.unicode {
            "PairOfCleats TUI - [r] run  [c] cancel  [q] quit  [j/k] logs  [n/m] jobs  [u/i] tasks"
        } else {
            "PairOfCleats TUI - [r] run [c] cancel [q] quit [j/k] logs [n/m] jobs [u/i] tasks"
        };
        let control_block = Paragraph::new(controls)
            .block(Block::default().borders(Borders::ALL).title("Controls"));
        frame.render_widget(control_block, rows[0]);

        let metrics = format!(
            "run={} events={} lag~{:.1}ms render~{:.1}ms q~{:.1} chunked={} droppedChunks={}",
            model.run_id,
            model.telemetry.processed_events,
            model.telemetry.event_lag_ms_ewma,
            model.telemetry.render_ms_ewma,
            model.telemetry.queue_depth_ewma,
            model.telemetry.chunk_reassembled,
            model.telemetry.dropped_chunks
        );
        let metrics_block = Paragraph::new(metrics)
            .block(Block::default().borders(Borders::ALL).title("Runtime"));
        frame.render_widget(metrics_block, rows[1]);

        let cols = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([
                Constraint::Percentage(28),
                Constraint::Percentage(28),
                Constraint::Percentage(44),
            ])
            .split(rows[2]);

        let mut job_rows: Vec<String> = model
            .job_status
            .iter()
            .map(|(job_id, status)| format!("{job_id}  {status}"))
            .collect();
        if job_rows.is_empty() {
            job_rows.push("(no jobs)".to_string());
        }
        let visible_jobs = list_window(
            &job_rows,
            model.job_scroll,
            cols[0].height.saturating_sub(2) as usize,
        );
        let job_items: Vec<ListItem> = visible_jobs
            .into_iter()
            .map(|row| {
                let style = if !model.terminal_caps.color {
                    Style::default()
                } else if row.contains("done") {
                    Style::default().fg(Color::Green)
                } else if row.contains("failed") {
                    Style::default().fg(Color::Red)
                } else if row.contains("cancelled") {
                    Style::default().fg(Color::Yellow)
                } else if row.contains("running") {
                    Style::default().fg(Color::Blue)
                } else {
                    Style::default().fg(Color::Gray)
                };
                ListItem::new(row).style(style)
            })
            .collect();
        let jobs = List::new(job_items).block(Block::default().borders(Borders::ALL).title("Jobs"));
        frame.render_widget(jobs, cols[0]);

        let selected_job = model.selected_job.clone().unwrap_or_default();
        let mut task_rows: Vec<String> = model
            .task_status
            .iter()
            .filter_map(|(key, status)| {
                if selected_job.is_empty() || key.starts_with(&format!("{selected_job}:")) {
                    Some(format!("{key}  {status}"))
                } else {
                    None
                }
            })
            .collect();
        if task_rows.is_empty() {
            task_rows.push("(no tasks)".to_string());
        }
        let visible_tasks = list_window(
            &task_rows,
            model.task_scroll,
            cols[1].height.saturating_sub(2) as usize,
        );
        let task_items: Vec<ListItem> = visible_tasks.into_iter().map(ListItem::new).collect();
        let tasks = List::new(task_items).block(Block::default().borders(Borders::ALL).title("Tasks"));
        frame.render_widget(tasks, cols[1]);

        let visible_logs = tail_window(
            &model.logs,
            model.log_scroll,
            cols[2].height.saturating_sub(2) as usize,
        );
        let log_items: Vec<ListItem> = visible_logs.into_iter().map(ListItem::new).collect();
        let logs = List::new(log_items).block(Block::default().borders(Borders::ALL).title("Logs"));
        frame.render_widget(logs, cols[2]);
    })?;
    Ok(frame_started.elapsed().as_millis())
}

fn enqueue_input(model: &mut AppModel, command: InputCommand, token: &str) {
    let now = Instant::now();
    if token == model.last_input_token && now.duration_since(model.last_input_at).as_millis() < INPUT_DEBOUNCE_MS {
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
    if model.flow_credit_pending < FLOW_CREDIT_BATCH && model.last_credit_flush.elapsed() < FLOW_CREDIT_FLUSH_INTERVAL {
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
    if let Some(job_id) = event.get("jobId").and_then(|value| value.as_str()) {
        if event_name == "job:start" || event_name == "job:spawn" {
            model.update_job_status(job_id, "running");
        } else if event_name == "job:end" {
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or("unknown");
            model.update_job_status(job_id, status);
        } else if event_name == "task:start" || event_name == "task:progress" || event_name == "task:end" {
            let task_id = event
                .get("taskId")
                .and_then(|value| value.as_str())
                .unwrap_or("task");
            let status = event
                .get("status")
                .and_then(|value| value.as_str())
                .unwrap_or(if event_name == "task:end" { "done" } else { "running" });
            let msg = event.get("message").and_then(|value| value.as_str());
            model.update_task_status(job_id, task_id, status, msg);
        }
    }

    if event_name == "runtime:metrics" {
        if let Some(flow) = event.get("flow").and_then(|value| value.as_object()) {
            let queue_depth = flow.get("queueDepth").and_then(|value| value.as_u64()).unwrap_or(0) as f64;
            model.telemetry.queue_depth_ewma =
                RuntimeTelemetry::update_ewma(model.telemetry.queue_depth_ewma, queue_depth);
        }
    }

    let log_line = if event_name == "log" {
        let msg = event
            .get("message")
            .and_then(|value| value.as_str())
            .unwrap_or("(empty log)");
        msg.to_string()
    } else {
        format!("event={event_name} {event}")
    };
    model.push_log(log_line);
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

    send_request(
        &mut supervisor,
        json!({
            "proto": "poc.tui@1",
            "op": "hello",
            "client": {"name": "pairofcleats-tui", "version": env!("CARGO_PKG_VERSION")}
        }),
    )?;
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
                match key.code {
                    KeyCode::Char('q') => enqueue_input(&mut model, InputCommand::Quit, "q"),
                    KeyCode::Char('r') => enqueue_input(&mut model, InputCommand::RunJob, "r"),
                    KeyCode::Char('c') => enqueue_input(&mut model, InputCommand::CancelSelected, "c"),
                    KeyCode::Char('j') => enqueue_input(&mut model, InputCommand::LogsUp, "j"),
                    KeyCode::Char('k') => enqueue_input(&mut model, InputCommand::LogsDown, "k"),
                    KeyCode::Char('n') => enqueue_input(&mut model, InputCommand::JobsUp, "n"),
                    KeyCode::Char('m') => enqueue_input(&mut model, InputCommand::JobsDown, "m"),
                    KeyCode::Char('u') => enqueue_input(&mut model, InputCommand::TasksUp, "u"),
                    KeyCode::Char('i') => enqueue_input(&mut model, InputCommand::TasksDown, "i"),
                    _ => {}
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
