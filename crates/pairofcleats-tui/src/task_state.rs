use std::fmt;

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
}

impl TaskState {
    pub fn new(status: &str, message: Option<&str>) -> Self {
        Self { status: status.to_owned(), message: message.filter(|text| !text.trim().is_empty()).map(str::to_owned) }
    }

    pub fn lifecycle(&self) -> Lifecycle {
        Lifecycle::from_status(&self.status)
    }
}

impl fmt::Display for TaskState {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match &self.message {
            Some(message) => write!(formatter, "{} {}", self.status, message),
            None => formatter.write_str(&self.status),
        }
    }
}
