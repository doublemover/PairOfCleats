use ratatui::{style::Style, text::Span};
use std::collections::VecDeque;
use std::mem::size_of;

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
        if self.ellipsis {
            "…".into()
        } else {
            text[self.start..self.end].to_owned()
        }
    }
}

// Preserve the forward wrapper's word/grapheme boundaries while emitting byte
// ranges. The first scan remains linear in the message; it creates no row text
// and does not collect the complete message's grapheme references.
fn rows(text: &str, width: usize, mut emit: impl FnMut(Row)) {
    if width == 0 {
        return;
    }
    let mut raw_offset = 0;
    for raw in text.split('\n') {
        let trimmed = raw.trim();
        let base = raw_offset + raw.len() - raw.trim_start().len();
        if trimmed.is_empty() {
            emit(Row {
                start: base,
                end: base,
                ellipsis: false,
            });
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
                if first_end == start {
                    first_end = start + grapheme.symbol.len();
                }
                let size = Span::raw(grapheme.symbol).width();
                if columns + size > width {
                    overflow = true;
                    break;
                }
                if end > start && grapheme.symbol.trim().is_empty() {
                    boundary = Some(end);
                }
                columns += size;
                end += grapheme.symbol.len();
            }
            if end == start {
                if first_end == start {
                    emit(Row {
                        start: base + start,
                        end: base + start,
                        ellipsis: false,
                    });
                    break;
                }
                emit(Row {
                    start: base + start,
                    end: base + first_end,
                    ellipsis: true,
                });
                start = first_end;
                continue;
            }
            if overflow {
                if let Some(space) = boundary {
                    end = space;
                }
            }
            let visible = trimmed[start..end].trim_end();
            emit(Row {
                start: base + start,
                end: base + start + visible.len(),
                ellipsis: false,
            });
            start = end;
            let span = Span::raw(&trimmed[start..]);
            for grapheme in span.styled_graphemes(Style::default()) {
                if !grapheme.symbol.trim().is_empty() {
                    break;
                }
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

#[derive(Default)]
pub(crate) struct RowWindow {
    pub lines: Vec<String>,
    pub total_rows: usize,
    pub skipped_rows: usize,
    pub bottom_end: Option<usize>,
}

#[derive(Clone)]
pub(crate) struct ViewportAnchor {
    pub id: u64,
    pub end: usize,
    pub scroll: usize,
    pub filter: String,
}

impl Layout {
    fn bytes(&self) -> usize {
        self.text.capacity() + self.rows.capacity() * size_of::<Row>()
    }
    fn window(&self, count: usize, skip: usize, anchor_end: Option<usize>) -> RowWindow {
        let end = anchor_end
            .map(|offset| {
                (self.rows.partition_point(|row| row.end < offset) + 1).min(self.rows.len())
            })
            .unwrap_or_else(|| self.rows.len().saturating_sub(skip));
        let start = end.saturating_sub(count);
        let lines = self
            .rows
            .iter()
            .take(end)
            .skip(start)
            .map(|row| row.owned(&self.text))
            .collect();
        RowWindow {
            lines,
            total_rows: self.rows.len(),
            skipped_rows: self.rows.len() - end,
            bottom_end: if count > 0 && start < end {
                self.rows.get(end - 1).map(|row| row.end)
            } else {
                None
            },
        }
    }
}

/// Volatile presentation only. IDs belong to immutable retained entries; caches
/// never enter recordings, replay checkpoints, input authority or saved layouts.
pub(crate) struct LogLayoutCache {
    entries: VecDeque<Layout>,
    retained: usize,
    limit: usize,
    pub viewport: Option<ViewportAnchor>,
    #[cfg(test)]
    pub scans: usize,
    #[cfg(test)]
    pub owned_rows: usize,
    #[cfg(test)]
    pub hits: usize,
}

impl Default for LogLayoutCache {
    fn default() -> Self {
        Self {
            entries: VecDeque::with_capacity(CACHE_ENTRIES),
            retained: 0,
            limit: CACHE_BYTES,
            viewport: None,
            #[cfg(test)]
            scans: 0,
            #[cfg(test)]
            owned_rows: 0,
            #[cfg(test)]
            hits: 0,
        }
    }
}

impl LogLayoutCache {
    pub fn clear(&mut self) {
        self.entries.clear();
        self.retained = 0;
        self.viewport = None;
    }
    pub fn remove(&mut self, id: u64) {
        if let Some(position) = self.entries.iter().position(|entry| entry.id == id) {
            if let Some(entry) = self.entries.remove(position) {
                self.retained -= entry.bytes();
            }
        }
    }
    pub fn bytes(&self) -> usize {
        self.retained
            + self.entries.capacity() * size_of::<Layout>()
            + self
                .viewport
                .as_ref()
                .map(|anchor| anchor.filter.capacity())
                .unwrap_or(0)
    }

    pub fn set_viewport(&mut self, anchor: Option<ViewportAnchor>) {
        self.viewport = anchor;
        while self.bytes() > self.limit {
            if let Some(old) = self.entries.pop_front() {
                self.retained -= old.bytes();
            } else {
                self.viewport = None;
                break;
            }
        }
    }

    #[cfg(test)]
    pub fn tail(
        &mut self,
        id: u64,
        width: usize,
        height: usize,
        render: impl FnOnce() -> String,
    ) -> Vec<String> {
        if height == 0 {
            return Vec::new();
        }
        self.window(id, width, height, 0, None, render).lines
    }

    pub fn window(
        &mut self,
        id: u64,
        width: usize,
        height: usize,
        skip: usize,
        anchor_end: Option<usize>,
        render: impl FnOnce() -> String,
    ) -> RowWindow {
        if width == 0 {
            return RowWindow::default();
        }
        if let Some(position) = self
            .entries
            .iter()
            .position(|entry| entry.id == id && entry.width == width)
        {
            let entry = self.entries.remove(position).expect("observed layout");
            let output = entry.window(height, skip, anchor_end);
            self.entries.push_back(entry);
            #[cfg(test)]
            {
                self.hits += 1;
                self.owned_rows += output.lines.len();
            }
            return output;
        }
        self.remove(id); // one width per retained entry
        let text = render();
        #[cfg(test)]
        {
            self.scans += 1;
        }
        let available = self
            .limit
            .saturating_sub(self.entries.capacity() * size_of::<Layout>())
            .saturating_sub(
                self.viewport
                    .as_ref()
                    .map(|anchor| anchor.filter.capacity())
                    .unwrap_or(0),
            );
        let mut retain = text.capacity() <= available;
        let mut layout_rows = Vec::new();
        let mut total_rows: usize = 0;
        let mut anchored_end = None;
        rows(&text, width, |row| {
            total_rows += 1;
            if anchored_end.is_none() && anchor_end.is_some_and(|offset| row.end >= offset) {
                anchored_end = Some(total_rows);
            }
            if retain {
                let next = layout_rows.len() + 1;
                if text
                    .capacity()
                    .saturating_add(next.saturating_mul(size_of::<Row>()))
                    > available
                {
                    retain = false;
                    layout_rows = Vec::new();
                } else {
                    // Grow geometrically within the remaining byte owner, rather
                    // than reallocating for every wrapped row.
                    if layout_rows.len() == layout_rows.capacity() {
                        let max_rows = available.saturating_sub(text.capacity()) / size_of::<Row>();
                        let capacity = layout_rows
                            .capacity()
                            .saturating_mul(2)
                            .max(64)
                            .min(max_rows);
                        layout_rows.reserve_exact(capacity.saturating_sub(layout_rows.len()));
                    }
                    if text.capacity() + layout_rows.capacity() * size_of::<Row>() > available {
                        retain = false;
                        layout_rows = Vec::new();
                    } else {
                        layout_rows.push(row);
                    }
                }
            }
        });
        let output = if retain {
            let entry = Layout {
                id,
                width,
                text,
                rows: layout_rows,
            };
            let output = entry.window(height, skip, anchor_end);
            while self.entries.len() >= CACHE_ENTRIES || self.bytes() + entry.bytes() > self.limit {
                if let Some(old) = self.entries.pop_front() {
                    self.retained -= old.bytes();
                } else {
                    break;
                }
            }
            if self.bytes() + entry.bytes() <= self.limit {
                self.retained += entry.bytes();
                self.entries.push_back(entry);
            }
            output
        } else {
            // An oversized message still exposes every row. Count first, then
            // materialize only this viewport; skip is never a buffer size.
            let end = if anchor_end.is_some() {
                anchored_end.unwrap_or(total_rows)
            } else {
                total_rows.saturating_sub(skip)
            };
            let start = end.saturating_sub(height);
            let mut output = RowWindow {
                lines: Vec::new(),
                total_rows,
                skipped_rows: total_rows - end,
                bottom_end: None,
            };
            let mut index = 0;
            if start < end {
                #[cfg(test)]
                {
                    self.scans += 1;
                }
                rows(&text, width, |row| {
                    if index >= start && index < end {
                        output.lines.push(row.owned(&text));
                        output.bottom_end = Some(row.end);
                    }
                    index += 1;
                });
            }
            output
        };
        #[cfg(test)]
        {
            self.owned_rows += output.lines.len();
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
        let messages = [
            "a".repeat(65536),
            "  one two    three\nfour\n\nlast  ".repeat(20),
            "界e\u{301} 😀  word word\n".repeat(200),
            "\n\n".into(),
            String::new(),
        ];
        for text in &messages {
            for width in [1, 2, 7, 80] {
                for height in [1, 3, 10] {
                    let mut cache = LogLayoutCache::default();
                    let output = cache.tail(1, width, height, || text.clone());
                    assert_eq!(output, reference(text, width, height));
                    assert!(cache.owned_rows <= height);
                    assert!(cache.bytes() <= CACHE_BYTES);
                    if cache.entries.len() == 1 {
                        let scans = cache.scans;
                        assert_eq!(
                            cache.tail(1, width, height, || panic!(
                                "cache hit must not format the message"
                            )),
                            output
                        );
                        assert_eq!(cache.scans, scans);
                    }
                }
            }
        }
    }

    #[test]
    fn width_eviction_and_oversized_entries_keep_the_cache_bounded() {
        let mut cache = LogLayoutCache::default();
        cache.limit = cache.entries.capacity() * size_of::<Layout>() + 4096;
        for id in 0..100 {
            let text = format!("{id} {}", "body ".repeat(100));
            assert_eq!(
                cache.tail(id, 80, 10, || text.clone()),
                reference(&text, 80, 10)
            );
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
        assert_eq!(
            cache.tail(1001, 0, 10, || panic!("zero pane")),
            Vec::<String>::new()
        );
    }

    #[test]
    fn row_windows_cover_oversized_uncached_messages_and_anchor_reflow() {
        let text = "界e\u{301} words next\n".repeat(500);
        for width in [2, 7, 30] {
            let all = crate::wrap_text_lines(&text, width, usize::MAX);
            let mut cache = LogLayoutCache::default();
            cache.limit = cache.entries.capacity() * size_of::<Layout>() + 128;
            for skip in [0, 1, 10, all.len() / 2, all.len(), usize::MAX] {
                let end = all.len().saturating_sub(skip);
                let window = cache.window(1, width, 4, skip, None, || text.clone());
                assert_eq!(window.lines, all[end.saturating_sub(4)..end]);
                assert_eq!(window.total_rows, all.len());
                assert_eq!(window.skipped_rows, all.len() - end);
                assert!(cache.entries.is_empty());
                assert!(cache.bytes() <= cache.limit);
            }
        }
        let mut cache = LogLayoutCache::default();
        let before = cache.window(1, 30, 2, 3, None, || text.clone());
        let anchored = cache.window(1, 7, 2, 0, before.bottom_end, || text.clone());
        assert!(anchored.bottom_end >= before.bottom_end);
        let counts = cache.window(1, 7, 0, 0, None, || panic!("metadata hit must not format"));
        assert!(counts.lines.is_empty());
        assert_eq!(counts.total_rows, anchored.total_rows);
    }
}
