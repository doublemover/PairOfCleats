use crate::search_failure_catalog::{self as catalog, FailureDefinition};
use serde_json::Value;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SearchOutcome {
    Idle,
    Running,
    QueryFailed,
    Cancelled,
    TimedOut,
    ResourcePending,
    SuccessfulEmpty,
    SuccessfulResults,
}

#[derive(Clone, Debug)]
pub(crate) struct SearchFailure {
    pub definition: FailureDefinition,
    pub diagnostic_id: Option<String>,
    pub field: Option<String>,
}

fn diagnostic_id(value: &str) -> bool {
    value.len() == 40
        && value.starts_with("tui-")
        && value.bytes().skip(4).enumerate().all(|(i, byte)| {
            if [8, 13, 18, 23].contains(&i) {
                byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)
            }
        })
}

impl SearchFailure {
    pub fn outcome(&self) -> SearchOutcome {
        match self.definition.outcome {
            "cancelled" => SearchOutcome::Cancelled,
            "timed-out" => SearchOutcome::TimedOut,
            "resource-settlement-pending" => SearchOutcome::ResourcePending,
            _ => SearchOutcome::QueryFailed,
        }
    }
    pub fn reason(reason: &str) -> Self {
        Self {
            definition: catalog::definition(reason)
                .unwrap_or_else(|| catalog::definition("unknown").unwrap()),
            diagnostic_id: None,
            field: None,
        }
    }

    pub fn from_event(event: &Value) -> Self {
        let failure = &event["error"]["failure"];
        let definition = failure["reason"].as_str().and_then(catalog::definition);
        if let Some(definition) = definition {
            let actions = failure["actions"].as_array();
            if failure["version"].as_u64() == Some(catalog::VERSION)
                && failure["outcome"].as_str() == Some(definition.outcome)
                && actions
                    .map(|rows| {
                        rows.len() == definition.actions.len()
                            && rows
                                .iter()
                                .zip(definition.actions)
                                .all(|(row, expected)| row.as_str() == Some(*expected))
                    })
                    .unwrap_or(false)
            {
                return Self {
                    definition,
                    diagnostic_id: failure["diagnosticId"]
                        .as_str()
                        .filter(|id| diagnostic_id(id))
                        .map(str::to_owned),
                    field: failure["field"]
                        .as_str()
                        .filter(|field| catalog::FIELDS.contains(field))
                        .map(str::to_owned),
                };
            }
        }
        // Compatibility is limited to closed codes. Arbitrary status/code/message
        // text and response-provided remediation never become terminal content.
        Self::reason(catalog::reason_for_code(
            event["error"]["code"].as_str().unwrap_or(""),
        ))
    }

    pub fn allows(&self, action: &str) -> bool {
        self.definition.actions.contains(&action)
    }

    pub fn lines(&self) -> Vec<String> {
        let mut rows = vec![
            self.definition.outcome.into(),
            format!("Reason: {}", self.definition.reason),
            self.definition.message.into(),
            self.help(),
        ];
        if let Some(id) = &self.diagnostic_id {
            rows.push(format!("Diagnostic: {id}"));
        }
        if let Some(field) = &self.field {
            rows.push(format!("Review field: {field}"));
        }
        rows
    }

    pub fn help(&self) -> String {
        let mut actions = vec!["e edit", "d details", "Esc return"];
        if self.allows("retry") {
            actions.insert(0, "r retry original request");
        }
        if self.allows("refresh-status") {
            actions.insert(0, "t check cleanup");
        }
        if self.allows("inspect-index") {
            actions.push("i index health");
        }
        if self.allows("inspect-setup") {
            actions.push("s setup metadata");
        }
        if self.allows("inspect-tooling") {
            actions.push("p tooling doctor");
        }
        actions.join("; ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    #[test]
    fn closed_failures_ignore_private_text_and_forged_actions() {
        let failure = SearchFailure::from_event(
            &json!({"error":{"code":"PRIVATE_SECRET", "message":"C:/private\u{1b}[31m"}}),
        );
        assert_eq!(failure.definition.reason, "unknown");
        assert!(!failure.lines().join("\n").contains("PRIVATE_SECRET"));
        let failure = SearchFailure::from_event(
            &json!({"error":{"code":"ERR_TUI_RESOURCE_PENDING", "failure":{
            "version":1,"reason":"resource-pending","outcome":"resource-settlement-pending","actions":["retry"]}}}),
        );
        assert_eq!(failure.definition.reason, "resource-pending");
        assert!(!failure.allows("retry"));
    }
    #[test]
    fn diagnostic_identifier_is_closed_and_bounded() {
        assert!(diagnostic_id("tui-11111111-2222-3333-4444-555555555555"));
        assert!(!diagnostic_id("tui-11111111-2222-3333-4444-55555555555z"));
        assert!(!diagnostic_id("PRIVATE_SECRET"));
    }
}
