//! Volatile bounded input. Terminal paste is data, never a sequence of keys.
use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{style::Style, text::Span};
use serde_json::{json, Value};

pub(crate) fn input_text(value: &Value, schema: &Value, advanced: bool) -> String {
    if !advanced && schema["type"] == "string" { value.as_str().unwrap_or_default().into() }
    else { value.to_string() }
}

pub(crate) fn input_value(text: &str, schema: &Value, advanced: bool) -> Result<Value, serde_json::Error> {
    if !advanced && schema["type"] == "string" { Ok(json!(text)) }
    else { serde_json::from_str(text) }
}

/// Presentation only; canonical validation still decides what values are valid.
pub(crate) fn schema_hint(schema: &Value) -> String {
    let mut hints = Vec::new();
    for (key, label) in [("minimum", ">="), ("maximum", "<="), ("exclusiveMinimum", ">"), ("exclusiveMaximum", "<")] {
        if let Some(value) = schema.get(key).filter(|value| value.is_number()) { hints.push(format!("{label} {value}")); }
    }
    for (key, label) in [("minLength", "min chars"), ("maxLength", "max chars"), ("minItems", "min items"), ("maxItems", "max items")] {
        if let Some(value) = schema.get(key).filter(|value| value.is_number()) { hints.push(format!("{label} {value}")); }
    }
    if let Some(choices) = schema["enum"].as_array() {
        let visible = choices.iter().take(8).map(|value| value.to_string().chars().take(40).collect::<String>()).collect::<Vec<_>>().join(", ");
        hints.push(format!("choices: {visible}{}", if choices.len() > 8 { " ..." } else { "" }));
    }
    if hints.is_empty() { "Canonical schema validates this value".into() } else { hints.join(" | ") }
}

pub(crate) fn next_choice(schema: &Value, current: Option<&Value>) -> Option<Value> {
    if let Some(choices) = schema["enum"].as_array().filter(|choices| !choices.is_empty()) {
        let index = current.and_then(|current| choices.iter().position(|value| value == current))
            .map(|index| (index + 1) % choices.len()).unwrap_or(0);
        return Some(choices[index].clone());
    }
    if schema["type"] == "boolean" { return Some(json!(!current.and_then(Value::as_bool).unwrap_or(false))); }
    None
}

#[derive(Default)]
pub(crate) struct TextCursor { position: Option<usize> }

fn boundaries(text: &str) -> Vec<usize> {
    let span = Span::raw(text);
    let mut result = vec![0];
    let mut offset = 0;
    for cluster in span.styled_graphemes(Style::default()) {
        offset += cluster.symbol.len(); result.push(offset);
    }
    result
}

impl TextCursor {
    pub fn reset(&mut self) { self.position = None; }
    fn position(&self, text: &str) -> usize {
        let requested = self.position.unwrap_or(text.len()).min(text.len());
        boundaries(text).into_iter().take_while(|offset| *offset <= requested).last().unwrap_or(0)
    }
    pub fn key(&mut self, text: &mut String, key: KeyEvent, limit: usize) -> bool {
        let position = self.position(text);
        let points = boundaries(text);
        let previous = points.iter().copied().take_while(|offset| *offset < position).last().unwrap_or(0);
        let next = points.into_iter().find(|offset| *offset > position).unwrap_or(text.len());
        match key.code {
            KeyCode::Left => self.position = Some(previous),
            KeyCode::Right => self.position = Some(next),
            KeyCode::Home => self.position = Some(0),
            KeyCode::End => self.position = Some(text.len()),
            KeyCode::Backspace => { text.replace_range(previous..position, ""); self.position = Some(previous); }
            KeyCode::Delete => { text.replace_range(position..next, ""); self.position = Some(position); }
            KeyCode::Char('u') if key.modifiers.contains(KeyModifiers::CONTROL) => { text.clear(); self.reset(); }
            KeyCode::Char(ch) if !ch.is_control() && !key.modifiers.intersects(KeyModifiers::CONTROL | KeyModifiers::ALT) => {
                if text.len().saturating_add(ch.len_utf8()) <= limit { text.insert(position, ch); self.position = Some(position + ch.len_utf8()); }
            }
            _ => return false,
        }
        true
    }
    pub fn paste(&mut self, text: &mut String, input: &str, limit: usize) -> bool {
        // Single-line fields: newlines/tabs become spaces; other controls are
        // discarded. Refuse oversized paste atomically, without a partial token.
        if input.len() > limit { return false; }
        let safe: String = input.chars().filter_map(|ch| if matches!(ch, '\r' | '\n' | '\t') {
            Some(' ')
        } else if ch.is_control() { None } else { Some(ch) }).collect();
        if text.len().saturating_add(safe.len()) > limit { return false; }
        let position = self.position(text);
        text.insert_str(position, &safe); self.position = Some(position + safe.len()); true
    }
    pub fn visible(&self, text: &str, width: usize) -> String {
        if width == 0 { return String::new(); }
        let position = self.position(text);
        let before = &text[..position];
        let mut parts = Vec::new();
        let mut columns = 1;
        let span = Span::raw(before);
        for cluster in span.styled_graphemes(Style::default()).collect::<Vec<_>>().into_iter().rev() {
            let size = Span::raw(cluster.symbol).width();
            if columns + size > width { break; }
            parts.push(cluster.symbol); columns += size;
        }
        parts.reverse();
        let prefix = parts.join("");
        crate::fit_text(&format!("{prefix}|{}", &text[position..]), width)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schema_hints_show_supplied_ranges_and_bounded_choices_without_coercion() {
        let range = schema_hint(&json!({"type":"integer","minimum":1,"maximum":5000}));
        assert!(range.contains(">= 1")); assert!(range.contains("<= 5000"));
        let choices: Vec<_> = (0..100).map(|value| json!(format!("choice-{value}"))).collect();
        let hint = schema_hint(&json!({"enum":choices}));
        assert!(hint.contains("choice-0")); assert!(hint.contains("choice-7"));
        assert!(!hint.contains("choice-8")); assert!(hint.len() < 512);
        assert_eq!(input_value("0", &json!({"type":"integer","minimum":1}), false).unwrap(), json!(0),
            "the editor preserves the draft; canonical schema validation rejects its range later");
    }
    #[test]
    fn schema_controls_preserve_literal_false_zero_null_and_unset_identity() {
        assert_eq!(input_value("false", &json!({"type":"string"}), false).unwrap(), json!("false"));
        assert_eq!(input_value("false", &json!({"type":"boolean"}), false).unwrap(), json!(false));
        assert_eq!(input_value("0", &json!({"type":"number"}), false).unwrap(), json!(0));
        assert_eq!(input_value("null", &json!({"type":["string","null"]}), true).unwrap(), Value::Null);
        assert_eq!(next_choice(&json!({"enum":[false,0,null]}), Some(&json!(0))), Some(Value::Null));
        assert_eq!(next_choice(&json!({"type":"boolean"}), Some(&json!(false))), Some(json!(true)));
    }
    #[test]
    fn grapheme_cursor_and_paste_are_bounded_inert_data() {
        let mut cursor = TextCursor::default();
        let mut text = "path/界e\u{301}😀".to_string();
        cursor.key(&mut text, KeyCode::Left.into(), 64);
        cursor.key(&mut text, KeyCode::Backspace.into(), 64);
        assert_eq!(text, "path/界😀");
        assert!(cursor.paste(&mut text, "\n\u{1b}quit\u{3}", 64));
        assert_eq!(text, "path/界 quit😀");
        let before = text.clone();
        assert!(!cursor.paste(&mut text, &"x".repeat(65), 64));
        assert_eq!(text, before);
        assert!(cursor.visible(&text, 8).contains('|'));
    }
}
