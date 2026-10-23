# TUI Supervisor Tooling

This directory contains Node-side TUI supervisor/runtime helpers.

Native activity retains canonical `current`, `total`, `unit`, `stage`, and explicit
producer `state`/`phase` facts for the selected job instance. It displays the latest
active task in compact and wide layouts. Counts reset when their unit or stage
changes without a replacement measurement. A received heartbeat updates the last
event observation; it does not advance the separate last-progress observation.
One visible update per second ages local elapsed/observation times. This uses plain
text and needs no animated glyph, color, or Unicode. Inactive, hidden-overlay,
expired-selection and passive views do not animate. Replay advances only with
recorded event time, and terminal tasks freeze their timing. A sent cancellation
request is shown separately until the supervisor supplies a terminal outcome.

`activity_tests` exercises the actual Rust reducer and both frame layouts with
deterministic observation times; `tui/native-job-selection-conpty` requires the
pinned native build and real Windows ConPTY to qualify producer-count routing and
rendering alongside existing process/cancellation witnesses. Authored tests are
not a native execution receipt.
