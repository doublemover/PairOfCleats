# SQLite writer physical ownership — 2026-10-27

Source: `acd8a79d9372dcec14b99ae6a46f082ac7f3d744`, tree
`f127c0a8b7e0976430bde8ccc2787374dbccae4a`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Dependencies, patches and native binaries are unchanged; bootstrap was not rerun.

Artifact/bundle writer construction now captures the existing synchronous native
close owner before initialization. Finalization coalesces once, retains its exact
failed result and ignores late close-method replacement. Initialization preserves
native cleanup errors instead of discarding them. Artifact and bundle failures
retain both original work and cleanup causes, including frozen errors. Restoration
and failed close remain separate causes. Incremental updates also capture original
close before format admission and cannot report success after failed closure.

Fatal and independently pending constructor errors stop further native attempts.
Controlled Windows before cases made three fatal or eight pending attempts; the
repaired owner makes one. Confirmed ordinary CANTOPEN fallback retains its existing
paths/bounds and successful WAL publication behavior. This is dispatch correctness,
not a measured latency claim or crash-status retry policy change.

**17/17 final affected cases and the full front gate, including 40/40 gate cases,
pass.** One job/thread, 30-second fixture bounds, zero retries/native redo; no
failures, skips, timeouts, native crashes or unexpected warnings. Real SQLite
checks retain initialization, artifact/bundle/incremental failures, output readback,
existing-output staging, fallback WAL publication, cancellation, multi-row parity,
transaction rollback, format rejection, diagnostics and the current import budget.

Eight child-only historical-owner controls fail against `e44b279d6`. Checkout
source was never reverted. Existing startup/incremental cases now demand the
exact original primary and exact native cleanup error plus pending ownership;
healthy cleanup still demands original failure identity. No assertions were
removed. New cases cover late replacement, coalesced/failed finalization, frozen
artifact/bundle errors and constructor dispatch. The
[structured receipt](sqlite-writer-owners-2026-10-27.json) lists exact cases and
controlled failures. Unknown-close controls manually close their actual handles
in finalization without claiming protocol settlement.

**#1574 remains partial.** Complete writer storage-session/private temporary
namespace adoption, custom/external registration, sidecar and remaining adapters,
category-specific eligible deletion and all/multi-repo CLI/MCP acceptance remain.
Physical writer ownership alone grants no external deletion authority or complete
builder-session qualification. No access-violation stack is attributed by this
batch. No user cache cleanup, GUI, WSL, elevation, physical links, public knobs or
security settings changed. Historical author-only
`.tmp/tasks/sqlite-writer-owners-20261027/` and `.testLogs/` are absent from clean
checkouts. Broader deep, optional/model/performance, release and other-platform
acceptance remain separate; the recorded queue remains 718 open.
