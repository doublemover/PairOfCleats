use std::cell::Cell;
use ratatui::style::Style;
use ratatui::text::Span;

#[derive(Default)]
pub struct ReviewViewport {
    offset: Cell<usize>,
    maximum: Cell<usize>,
    follow_tail: Cell<bool>,
}

pub fn rendered_rows(text: &str, width: usize) -> Vec<String> {
    if width == 0 { return Vec::new(); }
    let mut rows = Vec::new();
    for line in text.split('\n') {
        let span = Span::raw(line);
        let mut row = String::new();
        let mut columns = 0;
        for grapheme in span.styled_graphemes(Style::default()) {
            let size = Span::raw(grapheme.symbol).width();
            if columns + size > width && !row.is_empty() {
                rows.push(std::mem::take(&mut row)); columns = 0;
            }
            if size > width { rows.push("…".into()); continue; }
            row.push_str(grapheme.symbol); columns += size;
        }
        rows.push(row);
    }
    rows
}

impl ReviewViewport {
    pub fn reset(&self) { self.offset.set(0); self.follow_tail.set(false); }
    pub fn tail(&self) { self.follow_tail.set(true); }
    pub fn down(&self) { self.offset.set(self.offset.get().saturating_add(1).min(self.maximum.get())); self.follow_tail.set(false); }
    pub fn up(&self) { self.offset.set(self.offset.get().saturating_sub(1)); self.follow_tail.set(false); }
    pub(crate) fn indexed_lines(&self, headers: Vec<String>, text: &str, rows: &[[u32; 2]], height: usize, width: usize) -> Vec<String> {
        if height == 0 || width == 0 { return Vec::new(); }
        let mut output: Vec<_> = headers.into_iter().take(height.saturating_sub(1)).map(|line| crate::fit_text(&line, width)).collect();
        let count = height - output.len();
        let maximum = rows.len().saturating_sub(count);
        self.maximum.set(maximum);
        let offset = if self.follow_tail.get() { maximum } else { self.offset.get().min(maximum) };
        self.offset.set(offset);
        output.extend(rows.iter().skip(offset).take(count).map(|[start, end]| {
            if *start == u32::MAX { "…".into() } else { text[*start as usize..*end as usize].to_owned() }
        }));
        output
    }
    pub fn lines(&self, headers: Vec<String>, text: &str, height: usize, width: usize) -> Vec<String> {
        if height == 0 || width == 0 { return Vec::new(); }
        let mut output: Vec<_> = headers.into_iter().take(height.saturating_sub(1)).map(|line| crate::fit_text(&line, width)).collect();
        let rows = rendered_rows(text, width);
        let count = height - output.len();
        let maximum = rows.len().saturating_sub(count);
        self.maximum.set(maximum);
        let offset = if self.follow_tail.get() { maximum } else { self.offset.get().min(maximum) };
        self.offset.set(offset);
        output.extend(rows.into_iter().skip(offset).take(count));
        output
    }
}

pub fn selected_rows(mut headers: Vec<String>, rows: Vec<String>, selected: usize, height: usize, width: usize) -> Vec<String> {
    headers.truncate(height.saturating_sub(1));
    let count = height.saturating_sub(headers.len());
    let start = selected.saturating_sub(count / 2).min(rows.len().saturating_sub(count));
    headers.extend(rows.into_iter().skip(start).take(count));
    headers.into_iter().map(|line| crate::fit_text(&line, width)).collect()
}

#[cfg(test)]
pub fn render_test_rows(rows: Vec<String>, width: u16, height: u16) -> String {
    use ratatui::{Terminal, backend::TestBackend, widgets::{Block, Borders, Paragraph}};
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal.draw(|frame| frame.render_widget(Paragraph::new(rows.join("\n"))
        .block(Block::default().borders(Borders::ALL)), frame.area())).unwrap();
    let mut text = String::new();
    for y in 0..height {
        for x in 0..width { text.push_str(terminal.backend().buffer()[(x, y)].symbol()); }
        text.push('\n');
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rendered_unicode_rows_preserve_content_and_reach_both_review_ends() {
        let text = format!("START\n{}\nEND", "界e\u{301} 😀 ".repeat(400));
        let exact = rendered_rows(&text, 76).join("");
        assert_eq!(exact, text.replace('\n', ""));
        for (width, height) in [(80u16, 24u16), (90, 18)] {
            let viewport = ReviewViewport::default();
            let headers = vec![format!("Scope: {}", "long-directory/".repeat(100)), "Review exact values | arrows scroll".into()];
            let rows = viewport.lines(headers.clone(), &text, (height - 2) as usize, (width - 2) as usize);
            assert!(render_test_rows(rows, width, height).contains("START"));
            for _ in 0..10000 { viewport.down(); }
            let rows = viewport.lines(headers.clone(), &text, (height - 2) as usize, (width - 2) as usize);
            assert!(render_test_rows(rows, width, height).contains("END"));
            for _ in 0..10000 { viewport.up(); }
            let rows = viewport.lines(headers, &text, (height - 2) as usize, (width - 2) as usize);
            assert!(render_test_rows(rows, width, height).contains("START"));
        }
    }
}
