use std::fmt;

/// Canonical producer timestamps use Date.toISOString (UTC, millisecond precision).
/// Unsupported timestamp spellings stay unmeasured rather than using wall time.
pub(crate) fn recorded_timestamp(value: &str) -> Option<u64> {
    if !value.is_ascii() || value.len() != 24 || &value[4..5] != "-" || &value[7..8] != "-" || &value[10..11] != "T"
        || &value[13..14] != ":" || &value[16..17] != ":" || &value[19..20] != "." || !value.ends_with('Z')
        { return None; }
    let number = |start, end| value.get(start..end)?.parse::<i64>().ok();
    let (mut year, month, day) = (number(0,4)?, number(5,7)?, number(8,10)?);
    let (hour, minute, second, milliseconds) = (number(11,13)?, number(14,16)?, number(17,19)?, number(20,23)?);
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap {29} else {28},31,30,31,30,31,31,30,31,30,31];
    if !(1..=12).contains(&month) || day < 1 || day > days[(month - 1) as usize]
        || !(0..24).contains(&hour) || !(0..60).contains(&minute) || !(0..60).contains(&second)
        || !(0..1000).contains(&milliseconds) { return None; }
    year -= i64::from(month <= 2);
    let era = year.div_euclid(400); let yoe = year - era * 400;
    let doy = (153 * (month + if month > 2 {-3} else {9}) + 2) / 5 + day - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146097 + doe - 719468;
    u64::try_from((((days * 24 + hour) * 60 + minute) * 60 + second) * 1000 + milliseconds).ok()
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Lifecycle {
    Active,
    Done,
    Failed,
    Cancelled,
    Interrupted,
    Unknown,
}

impl Lifecycle {
    pub fn from_status(status: &str) -> Self {
        match status {
            "queued" | "pending" | "starting" | "running" | "active" | "accepted" | "cancelling" => Self::Active,
            "done" | "completed" | "succeeded" => Self::Done,
            "failed" | "error" => Self::Failed,
            "cancelled" | "canceled" => Self::Cancelled,
            "interrupted" | "unfinished" => Self::Interrupted,
            _ => Self::Unknown,
        }
    }

    pub fn is_problem(self) -> bool {
        matches!(self, Self::Failed | Self::Cancelled | Self::Interrupted)
    }
}

#[derive(Clone, Debug)]
pub struct TaskState {
    pub status: String,
    pub message: Option<String>,
    pub current: Option<f64>,
    pub total: Option<f64>,
    pub unit: Option<String>,
    pub stage: Option<String>,
    pub started_ms: Option<u64>,
    pub last_event_ms: Option<u64>,
    pub ended_ms: Option<u64>,
    pub producer_ms: Option<u64>,
}

impl TaskState {
    pub fn new(status: &str, message: Option<&str>) -> Self {
        Self { status: status.to_owned(), message: message.filter(|text| !text.trim().is_empty()).map(str::to_owned),
            current: None, total: None, unit: None, stage: None, started_ms: None, last_event_ms: None, ended_ms: None, producer_ms: None }
    }

    pub fn lifecycle(&self) -> Lifecycle {
        Lifecycle::from_status(&self.status)
    }

    pub fn observe(&mut self, event: &serde_json::Value, now: Option<u64>) {
        self.producer_ms = event["ts"].as_str().and_then(recorded_timestamp).or(self.producer_ms);
        let count = |name: &str| event[name].as_f64().filter(|value| value.is_finite() && *value >= 0.0);
        if event.get("current").is_some() { self.current = count("current"); }
        if event.get("total").is_some() { self.total = count("total"); }
        // Invalid/revised totals never turn into a fabricated ratio.
        if self.current.zip(self.total).is_some_and(|(current, total)| current > total) { self.total = None; }
        for (name, target) in [("unit", &mut self.unit), ("stage", &mut self.stage)] {
            if let Some(value) = event[name].as_str() { *target = Some(value.chars().take(80).collect()); }
        }
        if let Some(now) = now {
            self.started_ms.get_or_insert(now); self.last_event_ms = Some(now);
            if self.lifecycle() != Lifecycle::Active { self.ended_ms.get_or_insert(now); }
        }
    }

    pub fn activity(&self, now: u64, recorded: bool) -> String {
        let measured = match (self.current, self.total) {
            (Some(current), Some(total)) => format!("{current}/{total}"),
            (Some(current), None) => format!("{current} (total unknown)"),
            _ => "indeterminate".into(),
        };
        let timing = if let Some(start) = self.started_ms {
            let end = self.ended_ms.unwrap_or(now);
            format!("{}elapsed {}s | last {}s ago", if recorded { "recorded " } else { "" }, end.saturating_sub(start) / 1000,
                end.saturating_sub(self.last_event_ms.unwrap_or(start)) / 1000)
        } else { "timing not recorded".into() };
        format!("{} | {} {} | {} | {}", self.stage.as_deref().unwrap_or("task").chars().take(16).collect::<String>(), measured,
            self.unit.as_deref().unwrap_or("units?").chars().take(12).collect::<String>(), self.status, timing)
    }
}

impl fmt::Display for TaskState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.message {
            Some(message) => write!(formatter, "{} {}", self.status, message)?,
            None => formatter.write_str(&self.status)?,
        }
        if let Some(current) = self.current {
            if let Some(total) = self.total { write!(formatter, " {current}/{total}")?; }
            else { write!(formatter, " {current} (total unknown)")?; }
            if let Some(unit) = &self.unit { write!(formatter, " {unit}")?; }
        }
        Ok(())
    }
}
