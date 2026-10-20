# TUI Contract Tests

This directory contains protocol, supervisor, cancellation, install/wrapper, observability, frame-capture, and runtime throughput/backpressure tests for the TUI pipeline.

Rust tests run with the pinned 1.88.0 toolchain. Global interrupt cases inject real
key events into the production input owner for every overlay and job state; plain
`c` remains selected-job cancellation. These checks supplement native lifecycle
qualification.

Build the native binary with `cargo +1.88.0 build --locked --manifest-path crates/pairofcleats-tui/Cargo.toml`
before running `tui/native-interrupt-lifetime` or the existing quit, supervisor-error
and terminal-error lifetime cases. Run them serially with one job/thread,
30-second fixture limits, zero retries and native-status redo disabled. Windows
uses the existing node-pty/ConPTY path; Linux uses a real PTY and `/proc` descendant
witnesses. These helpers do not qualify macOS. The interrupt case opens a real
search overlay with a running job before sending Ctrl+C, then checks clean exit,
one graceful EOF, no selected-job cancel request, terminal restoration, final job
states and reaping of every owned process. Native compilation is a prerequisite,
not a reason to skip the assertions or claim a pass.

`tui/native-settings-conpty/{edit,stale,reset,workspace}` are four separately
bounded Windows qualification cases. Build the same pinned native binary first,
then run this explicit cohort serially through `tests/run.js` with the limits
above. They drive real keys into the binary and inspect the real supervisor's
canonical config results, source files, byte-preserving backups, redacted event/
telemetry/snapshot records, terminal restoration and supervisor exit. No proxy
replaces settings operations. These cases are outside ci-lite because they need
the native binary and Windows ConPTY; Linux/macOS require native PTY owners and
must not count a platform skip or Rust model snapshot as this execution.

The supervisor transaction and scope/job cases remain portable ci-lite owners.
`supervisor-session-resource-cleanup` checks actual active timers after graceful
exit and retains a real forced-shutdown negative; a completed child cannot leave
the helper's losing timeout keeping the fixture alive.
