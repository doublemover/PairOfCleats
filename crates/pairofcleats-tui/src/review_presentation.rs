use std::io::{self, Write};
use ratatui::{style::Style, text::Span};
use serde::{Serialize, Serializer, ser::SerializeMap};
use serde_json::Value;
use crate::overlay_viewport::ReviewViewport;

const MAX_TEXT_BYTES: usize = 256 * 1024;

struct BoundedText {
    bytes: Vec<u8>,
    limited: bool,
}

impl Write for BoundedText {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let remaining = MAX_TEXT_BYTES.saturating_sub(self.bytes.len());
        if bytes.len() > remaining {
            self.bytes.extend_from_slice(&bytes[..remaining]); self.limited = true;
            return if remaining == 0 { Err(io::Error::other("presentation byte limit")) } else { Ok(remaining) };
        }
        self.bytes.extend_from_slice(bytes);
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

/// Borrow the canonical configuration while omitting the same sensitive field
/// as the former cloned provenance projection.
pub(crate) struct WithoutUserConfig<'a>(pub &'a Value);
impl Serialize for WithoutUserConfig<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        if let Some(object) = self.0.as_object() {
            let excluded = if object.contains_key("userConfig") { 1 } else { 0 };
            let mut map = serializer.serialize_map(Some(object.len() - excluded))?;
            for (key, value) in object { if key != "userConfig" { map.serialize_entry(key, value)?; } }
            map.end()
        } else { self.0.serialize(serializer) }
    }
}

// One active accepted payload and one width layout per view. Source mutations
// clear the owner; scrolling and unrelated UI revisions do not change its key.
#[derive(Default)]
pub(crate) struct ReviewPresentation {
    kind: u8,
    text: Option<String>,
    width: usize,
    rows: Vec<[u32; 2]>,
    #[cfg(test)]
    pub builds: usize,
    #[cfg(test)]
    pub layouts: usize,
}

fn indexed_rows(text: &str, width: usize) -> Vec<[u32; 2]> {
    let mut rows = Vec::new();
    let max_rows = text.len() + 1;
    let mut append = |row| {
        if rows.len() == rows.capacity() {
            let capacity = rows.capacity().saturating_mul(2).max(32).min(max_rows);
            rows.reserve_exact(capacity.saturating_sub(rows.len()));
        }
        rows.push(row);
    };
    let mut raw_offset = 0;
    for raw in text.split('\n') {
        let mut start = 0;
        let mut end = 0;
        let mut columns = 0;
        let span = Span::raw(raw);
        for grapheme in span.styled_graphemes(Style::default()) {
            let size = Span::raw(grapheme.symbol).width();
            if columns + size > width && end > start {
                append([(raw_offset + start) as u32, (raw_offset + end) as u32]); start = end; columns = 0;
            }
            if size > width {
                append([u32::MAX, 0]); end += grapheme.symbol.len(); start = end; continue;
            }
            end += grapheme.symbol.len(); columns += size;
        }
        append([(raw_offset + start) as u32, (raw_offset + end) as u32]);
        raw_offset += raw.len() + 1;
    }
    rows
}

impl ReviewPresentation {
    pub fn clear(&mut self) { self.text = None; self.rows = Vec::new(); }

    pub fn lines<T: Serialize>(&mut self, kind: u8, scope: Option<&Value>, payload: &T,
        viewport: &ReviewViewport, headers: Vec<String>, height: usize, width: usize) -> Vec<String> {
        if height == 0 || width == 0 { return Vec::new(); }
        if self.text.is_none() || self.kind != kind {
            let mut writer = BoundedText { bytes: Vec::with_capacity(MAX_TEXT_BYTES), limited: false };
            let prefix = if let Some(scope) = scope { writeln!(&mut writer, "Scope: {scope}") }
                else { writer.write_all(b"Scope: \n") };
            let failed = prefix.is_err() || serde_json::to_writer_pretty(&mut writer, payload).is_err();
            if let Err(error) = std::str::from_utf8(&writer.bytes) { writer.bytes.truncate(error.valid_up_to()); }
            let mut text = String::from_utf8(writer.bytes).unwrap_or_default();
            if failed {
                // Reserve a bounded notice without altering the canonical Value
                // or its Save/Launch/Open/Export authority.
                let notice = if writer.limited { "\nNative presentation byte limit reached; canonical payload is unchanged" }
                    else { "\nNative presentation unavailable; canonical payload is unchanged" };
                while text.len() + notice.len() > MAX_TEXT_BYTES { text.pop(); }
                text.push_str(notice);
            }
            self.text = Some(text); self.kind = kind; self.width = 0; self.rows = Vec::new();
            #[cfg(test)] { self.builds += 1; }
        }
        let text = self.text.as_deref().unwrap_or_default();
        if self.width != width {
            self.rows = indexed_rows(text, width); self.width = width;
            #[cfg(test)] { self.layouts += 1; }
        }
        viewport.indexed_lines(headers, text, &self.rows, height, width)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::overlay_viewport::rendered_rows;
    use serde_json::json;

    #[test]
    fn immutable_review_reuses_serialization_and_preserves_width_layout() {
        let payload = json!({"message":"界e\u{301} 😀 ".repeat(200), "rows":[1,2,3]});
        let scope = json!({"id":"scope", "target":"repo"});
        let viewport = ReviewViewport::default();
        let mut cache = ReviewPresentation::default();
        let text = format!("Scope: {scope}\n{}", serde_json::to_string_pretty(&payload).unwrap());
        for width in [1, 2, 13, 80] {
            let actual = cache.lines(1, Some(&scope), &payload, &viewport, vec![], 10, width);
            assert_eq!(actual, rendered_rows(&text, width).into_iter().take(10).collect::<Vec<_>>());
            let builds = cache.builds; let layouts = cache.layouts;
            for _ in 0..20 { viewport.down(); cache.lines(1, Some(&scope), &payload, &viewport, vec![], 10, width); }
            assert_eq!(cache.builds, builds); assert_eq!(cache.layouts, layouts);
            viewport.reset();
        }
        assert_eq!(cache.builds, 1);
        cache.clear();
        assert!(cache.lines(2, None, &json!({"new":"identity"}), &viewport, vec![], 20, 80).join("\n").contains("identity"));
        assert_eq!(cache.builds, 2);
    }

    #[test]
    fn provenance_omission_and_presentation_bytes_never_mutate_authority() {
        let payload = json!({"visible":"value", "userConfig":{"secret":"private"}});
        let before = payload.clone();
        let mut cache = ReviewPresentation::default(); let viewport = ReviewViewport::default();
        let output = cache.lines(1, None, &WithoutUserConfig(&payload), &viewport, vec![], 20, 80).join("\n");
        assert!(output.contains("visible")); assert!(!output.contains("private")); assert_eq!(payload, before);
        cache.clear();
        cache.lines(2, None, &json!({"large":"界".repeat(MAX_TEXT_BYTES)}), &viewport, vec![], 10, 80);
        assert!(cache.text.as_ref().unwrap().len() <= MAX_TEXT_BYTES);
        assert!(cache.text.as_ref().unwrap().contains("presentation byte limit"));
        assert!(cache.rows.capacity() <= MAX_TEXT_BYTES + 1);
    }
}
