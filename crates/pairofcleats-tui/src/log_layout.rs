use std::collections::VecDeque;
use std::mem::size_of;
use ratatui::{style::Style, text::Span};

const CACHE_BYTES: usize = 2 * 1024 * 1024;
const CACHE_ENTRIES: usize = 64;

#[derive(Clone, Copy)]
struct Row {
    start: usize,
    end: usize,
    ellipsis: bool,
}

impl Row {
    fn owned(self, text: &str) -> String {
        if self.ellipsis { "…".into() } else { text[self.start..self.end].to_owned() }
    }
}

// Preserve the forward wrapper's word/grapheme boundaries while emitting byte
// ranges. The first scan remains linear in the message; it creates no row text
// and does not collect the complete message's grapheme references.
fn rows(text: &str, width: usize, mut emit: impl FnMut(Row)) {
    if width == 0 { return; }
    let mut raw_offset = 0;
    for raw in text.split('\n') {
        let trimmed = raw.trim();
        let base = raw_offset + raw.len() - raw.trim_start().len();
        if trimmed.is_empty() {
            emit(Row { start: base, end: base, ellipsis: false });
        }
        let mut start = 0;
        while start < trimmed.len() {
            let span = Span::raw(&trimmed[start..]);
            let mut end = start;
            let mut columns = 0;
            let mut boundary = None;
            let mut overflow = false;
            let mut first_end = start;
            for grapheme in span.styled_graphemes(Style::default()) {
                if first_end == start { first_end = start + grapheme.symbol.len(); }
                let size = Span::raw(grapheme.symbol).width();
                if columns + size > width { overflow = true; break; }
                if end > start && grapheme.symbol.trim().is_empty() { boundary = Some(end); }
                columns += size;
                end += grapheme.symbol.len();
            }
            if end == start {
                if first_end == start {
                    emit(Row { start: base + start, end: base + start, ellipsis: false });
                    break;
                }
                emit(Row { start: base + start, end: base + first_end, ellipsis: true });
                start = first_end;
                continue;
            }
            if overflow { if let Some(space) = boundary { end = space; } }
            let visible = trimmed[start..end].trim_end();
            emit(Row { start: base + start, end: base + start + visible.len(), ellipsis: false });
            start = end;
            let span = Span::raw(&trimmed[start..]);
            for grapheme in span.styled_graphemes(Style::default()) {
                if !grapheme.symbol.trim().is_empty() { break; }
                start += grapheme.symbol.len();
            }
        }
        raw_offset += raw.len() + 1;
    }
}

struct Layout {
    id: u64,
    width: usize,
    text: String,
    rows: Vec<Row>,
}

impl Layout {
    fn bytes(&self) -> usize { self.text.capacity() + self.rows.capacity() * size_of::<Row>() }
    fn tail(&self, count: usize) -> Vec<String> {
        self.rows.iter().skip(self.rows.len().saturating_sub(count)).map(|row| row.owned(&self.text)).collect()
    }
}

/// Volatile presentation only. IDs belong to immutable retained entries; caches
/// never enter recordings, replay checkpoints, input authority or saved layouts.
pub(crate) struct LogLayoutCache {
    entries: VecDeque<Layout>,
    retained: usize,
    limit: usize,
    #[cfg(test)]
    pub scans: usize,
    #[cfg(test)]
    pub owned_rows: usize,
    #[cfg(test)]
    pub hits: usize,
}

impl Default for LogLayoutCache {
    fn default() -> Self {
        Self { entries: VecDeque::with_capacity(CACHE_ENTRIES), retained: 0, limit: CACHE_BYTES,
            #[cfg(test)] scans: 0, #[cfg(test)] owned_rows: 0, #[cfg(test)] hits: 0 }
    }
}

impl LogLayoutCache {
    pub fn clear(&mut self) { self.entries.clear(); self.retained = 0; }
    pub fn remove(&mut self, id: u64) {
        if let Some(position) = self.entries.iter().position(|entry| entry.id == id) {
            if let Some(entry) = self.entries.remove(position) { self.retained -= entry.bytes(); }
        }
    }
    pub fn bytes(&self) -> usize { self.retained + self.entries.capacity() * size_of::<Layout>() }

    pub fn tail(&mut self, id: u64, width: usize, height: usize, render: impl FnOnce() -> String) -> Vec<String> {
        if width == 0 || height == 0 { return Vec::new(); }
        if let Some(position) = self.entries.iter().position(|entry| entry.id == id && entry.width == width) {
            let entry = self.entries.remove(position).expect("observed layout");
            let output = entry.tail(height);
            self.entries.push_back(entry);
            #[cfg(test)] { self.hits += 1; self.owned_rows += output.len(); }
            return output;
        }
        self.remove(id); // one width per retained entry
        let text = render();
        #[cfg(test)] { self.scans += 1; }
        let available = self.limit.saturating_sub(self.entries.capacity() * size_of::<Layout>());
        let mut retain = text.capacity() <= available;
        let mut layout_rows = Vec::new();
        let mut tail = VecDeque::new();
        rows(&text, width, |row| {
            if tail.len() == height { tail.pop_front(); }
            tail.push_back(row);
            if retain {
                let next = layout_rows.len() + 1;
                if text.capacity().saturating_add(next.saturating_mul(size_of::<Row>())) > available {
                    retain = false;
                    layout_rows = Vec::new();
                } else {
                    // Grow geometrically within the remaining byte owner, rather
                    // than reallocating for every wrapped row.
                    if layout_rows.len() == layout_rows.capacity() {
                        let max_rows = available.saturating_sub(text.capacity()) / size_of::<Row>();
                        let capacity = layout_rows.capacity().saturating_mul(2).max(64).min(max_rows);
                        layout_rows.reserve_exact(capacity.saturating_sub(layout_rows.len()));
                    }
                    if text.capacity() + layout_rows.capacity() * size_of::<Row>() > available {
                        retain = false; layout_rows = Vec::new();
                    } else { layout_rows.push(row); }
                }
            }
        });
        let output = tail.into_iter().map(|row| row.owned(&text)).collect::<Vec<_>>();
        #[cfg(test)] { self.owned_rows += output.len(); }
        if retain {
            let entry = Layout { id, width, text, rows: layout_rows };
            while self.entries.len() >= CACHE_ENTRIES || self.bytes() + entry.bytes() > self.limit {
                if let Some(old) = self.entries.pop_front() { self.retained -= old.bytes(); }
                else { break; }
            }
            if self.bytes() + entry.bytes() <= self.limit {
                self.retained += entry.bytes(); self.entries.push_back(entry);
            }
        }
        output
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn reference(text: &str, width: usize, height: usize) -> Vec<String> {
        let all = crate::wrap_text_lines(text, width, usize::MAX);
        all[all.len().saturating_sub(height)..].to_vec()
    }

    #[test]
    fn visible_tail_matches_forward_reference_without_materializing_hidden_rows() {
        let messages = ["a".repeat(65536), "  one two    three\nfour\n\nlast  ".repeat(20),
            "界e\u{301} 😀  word word\n".repeat(200), "\n\n".into(), String::new()];
        for text in &messages {
            for width in [1, 2, 7, 80] { for height in [1, 3, 10] {
                let mut cache = LogLayoutCache::default();
                let output = cache.tail(1, width, height, || text.clone());
                assert_eq!(output, reference(text, width, height));
                assert!(cache.owned_rows <= height);
                assert!(cache.bytes() <= CACHE_BYTES);
                if cache.entries.len() == 1 {
                    let scans = cache.scans;
                    assert_eq!(cache.tail(1, width, height, || panic!("cache hit must not format the message")), output);
                    assert_eq!(cache.scans, scans);
                }
            } }
        }
    }

    #[test]
    fn width_eviction_and_oversized_entries_keep_the_cache_bounded() {
        let mut cache = LogLayoutCache::default();
        cache.limit = cache.entries.capacity() * size_of::<Layout>() + 4096;
        for id in 0..100 {
            let text = format!("{id} {}", "body ".repeat(100));
            assert_eq!(cache.tail(id, 80, 10, || text.clone()), reference(&text, 80, 10));
            assert!(cache.bytes() <= cache.limit);
        }
        cache.remove(99);
        let before = cache.scans;
        cache.tail(99, 80, 3, || "replacement".into());
        cache.tail(99, 40, 3, || "replacement".into());
        assert_eq!(cache.scans, before + 2);
        let huge = "z".repeat(65536);
        let expected = reference(&huge, 80, 10);
        assert_eq!(cache.tail(1000, 80, 10, || huge), expected);
        assert!(!cache.entries.iter().any(|entry| entry.id == 1000));
        cache.clear();
        assert!(cache.entries.is_empty());
        assert_eq!(cache.tail(1001, 0, 10, || panic!("zero pane")), Vec::<String>::new());
    }
}
