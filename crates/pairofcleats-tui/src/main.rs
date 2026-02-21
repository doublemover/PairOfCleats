use std::collections::{BTreeMap, VecDeque};
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::mpsc::{self, Receiver};
use std::time::{Duration, Instant};

use crossterm::event::{self, Event as CEvent, KeyCode};
use crossterm::execute;
use crossterm::terminal::{disable_raw_mode, enable_raw_mode, EnterAlternateScreen, LeaveAlternateScreen};
use ratatui::backend::CrosstermBackend;
use ratatui::layout::{Constraint, Direction, Layout};
use ratatui::style::{Color, Style};
use ratatui::widgets::{Block, Borders, List, ListItem, Paragraph};
use ratatui::Terminal;
use serde_json::{json, Value};

struct UiGuard;

impl Drop for UiGuard {
    fn drop(&mut self) {
        let _ = disable_raw_mode();
        let mut stdout = std::io::stdout();
        let _ = execute!(stdout, LeaveAlternateScreen);
    }
}

#[derive(Default)]
struct AppModel {
    run_id: String,
    job_status: BTreeMap<String, String>,
    logs: VecDeque<String>,
    selected_job: Option<String>,
}

impl AppModel {
    fn push_log(&mut self, message: String) {
        if self.logs.len() >= 200 {
            self.logs.pop_front();
        }
        self.logs.push_back(message);
    }
}

fn spawn_supervisor() -> anyhow::Result<(std::process::Child, Receiver<Value>)> {
    let mut child = Command::new(std::env::current_exe()?.with_file_name("node"))
        .arg("tools/tui/supervisor.js")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .or_else(|_| {
            Command::new("node")
                .arg("tools/tui/supervisor.js")
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::null())
                .spawn()
        })?;

    let stdout = child.stdout.take().ok_or_else(|| anyhow::anyhow!("missing supervisor stdout"))?;
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
    let input = child.stdin.as_mut().ok_or_else(|| anyhow::anyhow!("missing supervisor stdin"))?;
    input.write_all(payload.to_string().as_bytes())?;
    input.write_all(b"\n")?;
    input.flush()?;
    Ok(())
}

fn draw_ui(terminal: &mut Terminal<CrosstermBackend<std::io::Stdout>>, model: &AppModel) -> anyhow::Result<()> {
    terminal.draw(|frame| {
        let areas = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(3),
                Constraint::Percentage(40),
                Constraint::Percentage(57),
            ])
            .split(frame.area());

        let title = Paragraph::new("PairOfCleats TUI MVP - [r]un [c]ancel [q]uit")
            .block(Block::default().borders(Borders::ALL).title("Controls"));
        frame.render_widget(title, areas[0]);

        let job_items: Vec<ListItem> = if model.job_status.is_empty() {
            vec![ListItem::new("(no jobs)")]
        } else {
            model
                .job_status
                .iter()
                .map(|(id, status)| {
                    let color = match status.as_str() {
                        "done" => Color::Green,
                        "failed" => Color::Red,
                        "cancelled" => Color::Yellow,
                        "running" => Color::Blue,
                        _ => Color::Gray,
                    };
                    ListItem::new(format!("{}  {}", id, status)).style(Style::default().fg(color))
                })
                .collect()
        };
        let jobs = List::new(job_items).block(Block::default().borders(Borders::ALL).title("Jobs"));
        frame.render_widget(jobs, areas[1]);

        let log_items: Vec<ListItem> = model
            .logs
            .iter()
            .rev()
            .take(30)
            .map(|line| ListItem::new(line.clone()))
            .collect();
        let logs = List::new(log_items).block(Block::default().borders(Borders::ALL).title("Logs"));
        frame.render_widget(logs, areas[2]);
    })?;
    Ok(())
}

fn main() -> anyhow::Result<()> {
    enable_raw_mode()?;
    let _guard = UiGuard;
    let mut stdout = std::io::stdout();
    execute!(stdout, EnterAlternateScreen)?;

    let backend = CrosstermBackend::new(stdout);
    let mut terminal = Terminal::new(backend)?;
    terminal.clear()?;

    let mut model = AppModel::default();
    let (mut supervisor, events_rx) = spawn_supervisor()?;

    send_request(
        &mut supervisor,
        json!({
            "proto": "poc.tui@1",
            "op": "hello",
            "client": {"name": "pairofcleats-tui", "version": env!("CARGO_PKG_VERSION")}
        }),
    )?;

    let mut next_job_idx: u64 = 1;
    let mut last_tick = Instant::now();

    loop {
        while let Ok(event) = events_rx.try_recv() {
            if let Some(run_id) = event.get("runId").and_then(|v| v.as_str()) {
                model.run_id = run_id.to_string();
            }
            let event_name = event.get("event").and_then(|v| v.as_str()).unwrap_or("unknown");
            if let Some(job_id) = event.get("jobId").and_then(|v| v.as_str()) {
                if event_name == "job:start" || event_name == "job:spawn" {
                    model.job_status.insert(job_id.to_string(), "running".to_string());
                    model.selected_job = Some(job_id.to_string());
                } else if event_name == "job:end" {
                    let status = event
                        .get("status")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    model.job_status.insert(job_id.to_string(), status);
                    model.selected_job = Some(job_id.to_string());
                }
            }
            let log_line = if event_name == "log" {
                let msg = event
                    .get("message")
                    .and_then(|v| v.as_str())
                    .unwrap_or("(empty log)");
                format!("{}", msg)
            } else {
                format!("event={} {}", event_name, event)
            };
            model.push_log(log_line);
        }

        if last_tick.elapsed() >= Duration::from_millis(50) {
            draw_ui(&mut terminal, &model)?;
            last_tick = Instant::now();
        }

        if event::poll(Duration::from_millis(20))? {
            if let CEvent::Key(key) = event::read()? {
                match key.code {
                    KeyCode::Char('q') => {
                        let _ = send_request(
                            &mut supervisor,
                            json!({"proto": "poc.tui@1", "op": "shutdown", "reason": "user_exit"}),
                        );
                        break;
                    }
                    KeyCode::Char('r') => {
                        let job_id = format!("job-{}", next_job_idx);
                        next_job_idx += 1;
                        let _ = send_request(
                            &mut supervisor,
                            json!({
                                "proto": "poc.tui@1",
                                "op": "job:run",
                                "jobId": job_id,
                                "title": "Search Help",
                                "argv": ["search", "--help"]
                            }),
                        );
                    }
                    KeyCode::Char('c') => {
                        if let Some(job_id) = model.selected_job.clone() {
                            let _ = send_request(
                                &mut supervisor,
                                json!({
                                    "proto": "poc.tui@1",
                                    "op": "job:cancel",
                                    "jobId": job_id,
                                    "reason": "user_cancel"
                                }),
                            );
                        }
                    }
                    _ => {}
                }
            }
        }
    }

    let _ = supervisor.kill();
    Ok(())
}
