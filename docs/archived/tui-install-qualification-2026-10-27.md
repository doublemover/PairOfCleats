# Windows TUI installation qualification — 2026-10-27

Qualified source: `957230b1239a322489a63e8d77fe53057bab77ab`, tree
`a6576181d0ed4a0eb3120de6a090007855af495f`, branch
`codex/pr557-audit-repairs-20261012`, PR #572. Windows x64, Node 26.12.1.

#1554 is completed. This batch qualifies the existing installation transaction
with a real Windows release build and wrapper/native/supervisor execution.
The installer still stages immutable generations, verifies exact bytes,
executable target, manifest and runtime/supervisor identity, then selects one
complete generation through the existing lock and durable publication owners.
Shared logs and older generations remain outside replacement payloads.

## Actual Windows availability

The installed Rust 1.88.0 toolchain was selected only in the task child PATH
and environment. `node tools/tui/build.js --target x86_64-pc-windows-msvc`
performed a locked release build in a task-owned Cargo target/staging directory,
finishing in 18.79 seconds without compiler warnings or errors. Cargo reports
`1.88.0 (873a06493 2025-05-10)`. The tracked TUI source tree is
`02271ba7718e6a8becf2d5f0903dbd00799fae1d`.

The exact staged executable SHA-256 is
`ab130146767505643fd8503a103f911d7fbb9f214585d8aac155dd3c859b5375`.
The build-manifest/target checksum, executable metadata and installed-byte
checks remain strict.

The new independently bounded `tui/native-install-generation-conpty` case:

1. Installs A and launches the real wrapper, native executable and production
   supervisor through the existing ConPTY capture/terminal-restoration owner.
2. Holds the actual installation metadata with Windows `FileShare.Read`, which
   denies replacement. The failed installation reports retained-generation and
   close-and-retry guidance; A's selected metadata/bytes and live processes remain.
3. Closes that exact handle, publishes B, and checks selection of B's generation.
4. Launches B through the real wrapper while A is still running. Native process
   ancestry and executable paths identify the correct A/B payloads.
5. Quits both sessions normally, verifies zero exit status and empty stderr,
   terminal restoration, terminal job-state snapshots and complete process reaping.

The live test installs two fresh generations of this same exact staged build.
The deterministic transaction fixture separately proves successful publication
of changed valid payload bytes/checksums while preserving the original payload.
No unrelated TUI process is killed or old executable removed to force an update.
No machine-wide settings, elevation, symlink creation or Linux/WSL execution is used.

## Checks and evidence

**7 discovered installer/wrapper fixtures pass**, including the real native
upgrade, plus **3 serial release-binary lifecycle controls** through the existing
native owner: quit, supervisor failure and terminal transport failure. Expected
nonzero native exits/diagnostics in the latter controls are asserted; all owned
processes are reaped and terminal modes restored. The unchanged default launch
branch and the new wrapper branch of the PowerShell capture owner are both used.

The transaction fixture retains copy, metadata write, stale staged hash,
promotion/sharing refusal, interruption recovery, same-target serialization,
distinct-target isolation and prior-generation availability assertions. These
controls supplement the actual Windows sharing test. Portable target metadata
fixtures do not execute another platform's binary.

The complete cheap pre-push gate passes, including **40/40 gate cases**,
formatting/ESLint, configuration/environment, generated freshness,
command/workflow and whitespace checks. Fixtures use one job/thread,
30-second deadlines, zero retries and native-status redo disabled. The live
case completes in about 11 seconds. Final observations contain no failures,
timeouts, skips, native crashes or unexpected warnings. The last added
changed-payload assertion was rechecked against the final fixture; unchanged
gate and other feature checks retain their recorded source scope.

Initial harness failures are preserved: an ambient distribution override was
correctly sanitized, an unsupported `--version` probe started an interactive
session, and the harness initially read the capture API at the wrong wrapper
depth. Qualification now takes an explicit runner pass-through `--dist-dir`
and launches/quits both real sessions. Production contracts were not weakened.

The [structured receipt](tui-install-qualification-2026-10-27.json) records exact
source, artifact, commands, fixture observations, native receipts and issue
readback. Raw `.tmp/tasks/tui-install-qualification-20261027/`, `.tmp/dev/tests/`
and `.testLogs/` data are historical author-workspace evidence, absent in clean
checkouts. Dependencies/patches and Node remain unchanged; current readiness
passes against the earlier clean native/patch verification. Task children omit
only the inherited missing trusted-config selector; global/user settings stay intact.

The live census has **722 open issues**: 461 qualification pending, 147 partial
or follow-up and 114 with unresolved implementation status. Other TUI targets,
historical release combinations, full Windows/platform/model/performance and
release qualification remain separate. #1574 custom backend adoption and #1267
broader lifecycle policy remain open.
