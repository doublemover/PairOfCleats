# Native TUI log rows — 2026-10-27

Sources `b4cee1582557f4000f7cc4af9b838b6f1709b525` and
`bf475fe1a9669062f155e38bd1c0252b22f68adf`; final tree
`880741ddccb457351a0c932b1cc5e46ae910f6d9`, branch
`codex/pr557-audit-repairs-20261012`. Windows x64, Node 26.12.1,
Cargo 1.93.1 / rustfmt 1.8.0. Unpublished; functional qualification is deferred.

The previous viewport skipped complete log entries and selected only each entry's
tail. Scrolling could therefore never expose older wrapped rows within one long
retained entry. The cache now selects arbitrary row windows from source-byte
spans; the viewport counts display rows across filtered entries. The existing
2 MiB/64-entry cache remains, including anchor-string accounting. Uncacheable
messages count spans before a second bounded selection pass, materializing only
the requested row strings. Huge scroll values never become allocation sizes.

Paused views retain an immutable entry identity and source-byte bottom anchor.
Matching multiline arrivals contribute their actual rows, unmatched arrivals
contribute none, and resize reflows the anchor. An evicted anchor clamps to the
oldest retained matching viewport. A still-valid anchor stays fixed when history
is shorter than the pane, leaving space instead of exposing incoming rows.
Follow resumes at row zero. Changed filters and invalid restored offsets clamp
the actual stored row offset; snapshots retain the same numeric field shape.

Mouse scrolling uses the same row owner and real pane width rather than an
entry-count clamp. The final hit-map signature reflects the offset normalized
during rendering. Replay captures/restores numeric offsets; replay state already
clears volatile layout caches. Only obsolete entry-tail and entry-count callers
were removed; existing Unicode, cached-tail, filtering, selection, rendering and
recording coverage remains.

Four native viewport cases and one oversized-cache/reflow case are authored,
**unexecuted**, including every row of a long entry, stored snapshot clamping,
multiline pause/arrival/filter/resize, retained-history eviction and short-pane
pause. The actual native frame-capture fixture adds tail/one-row-up captures with
distinct `VIEW19`/`VIEW18` assertions. Earlier metadata assertions remain.

The first Rust formatting/type pass found an authored-test declaration syntax
error and missing Debug formatting on the two filter enums. Those were corrected
directly; filter identity uses their existing unique labels. Final rustfmt check,
offline locked `cargo check --tests`, format/ESLint, changed-JavaScript syntax,
script inventory and whitespace checks passed without compiler warnings. Cargo
compiled test sources but executed no tests. No TUI binary, ConPTY, project
functional fixture or benchmark ran. #619 remains open for rendered/native
follow-up acceptance, including resize/filter/pause/arrival/eviction and terminal
lifetime checks. The [TUI guide](../guides/tui.md) describes the resulting behavior.
