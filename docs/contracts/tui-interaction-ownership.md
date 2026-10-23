# Native interaction ownership

Native global action keys, palette identities, labels and help/footer shortcuts
come from `crates/pairofcleats-tui/src/actions.rs`. The same live availability
checks govern palette selection and direct dispatch. A disabled selection keeps
the palette open and shows its reason. Filtering retains the selected exact
action if it remains visible; hiding it requires a new visible selection before
Enter can act. Palette rows show the visible range, and help has a width-aware
scrolling range with pinned close controls and a minimal tiny-terminal fallback.

Captured mouse gestures use the actual rendered geometry and view identity.
Every accepted modal gesture enters the same FIFO input queue as keys and paste.
Stale content, focus, overlay or resized geometry invalidates the captured hit.
Clicks select exact job, result, command, settings path or owned-service identities;
they do not enter a form, launch work, confirm a settings preview or arm a service
stop. Wheel input affects the captured visible modal or pane only. Mouse capture
remains opt-in, and native terminal selection remains available with capture off.

The existing bounded grapheme editor owns cursor movement, insertion, deletion,
horizontal caret display and literal/schema controls. Bracketed paste is data
only for the focused editor. Its newline/control and size rules cannot generate
Enter, Escape, Ctrl+C or another action. Settings and workflow request validation
and exact preview/confirmation authority remain in their canonical owners. Help
filter paste follows the same inert editor path.

Authored regressions exercise actual Rust FIFO/form dispatch, Crossterm mouse
events, Ratatui buffers, stale/filter/resize/disabled negatives, exact field and
service selection, and canonical settings ConPTY witnesses. The existing
Windows settings qualification now sends real bracketed path/value paste and
checks that no request precedes explicit Enter. These tests are unrun in the
active source wave. ConPTY/mouse, Linux/macOS paste, terminal restoration and
manual selection behavior require separate real-host qualification.
