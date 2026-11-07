# SQLite build-probe sessions — 2026-10-27

Source: `9285c466433548a5055b621adf299b1e16a95e9d`, tree
`82cfdc4a7932b6dd25ca458fe2e6ce09c87749bf`, branch
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Dependencies, patches and native binaries are unchanged; bootstrap was not rerun.

Five SQLite count/table/vector probes and runtime probing now share the existing
synchronous physical close owner. Native construction follows canonical storage
admission; original close is captured before format/query access. Selection,
row-ledger and build dispatch forward effective repository configuration.

Ordinary query unavailability preserves existing empty/null/default contracts
after confirmed closure. Format rejection still propagates. Failed native close,
metadata and independent resource observations preserve exact original causes
and owners instead of disappearing into ordinary probe results. Replacing a close
method or settlement report cannot replace the captured native/independent owner.
Explicit metadata reconciliation never repeats confirmed physical closure.

The runner now preserves unpublished staged databases and sidecars after pending
resource errors. Known physical closure is insufficient when independent work
remains unconfirmed. Error classification adds diagnostics without mutating away
a frozen primary failure. Repeated probe lifetime code was consolidated while
retaining all five functions and their result contracts; no tests were removed.

**28/28 affected Windows cases and the full front gate, including 40/40 gate
cases, pass.** One job/thread, 30-second bounds, zero retries/native redo; no
failures, skips, timeouts, native crashes or unexpected warnings. Controls use
actual installed SQLite handles and a real artifact-to-SQLite build. They retain
ordinary unavailable-query behavior, exact format rejection, output/source
authority, row-ledger checks, incremental behavior, cancellation, staging,
finalization and the existing import budget.

Four child-only controls fail before repair: historical category admission,
missing canonical sessions, staged evidence deletion and the isolated old
swallow-close behavior. The previous runner attempts all three database/sidecar
removals while independent work remains pending; the repaired owner attempts
zero. The historical full-owner baseline is `cbcd04966`. The isolated cleanup
control retains current admission so it reaches the actual intended native error.
The [structured receipt](sqlite-probe-sessions-2026-10-27.json) enumerates every
case and control. Checkout source was never reverted.

**#1574 remains partial:** custom/external registration, validator and complete
SQLite builder/sidecar/legacy-adapter lifetimes, eligible category-specific
deletion and all/multi-repo CLI/MCP acceptance remain. Context-free/external
callers are not registered by this batch; leases grant no deletion permission.
No user cache cleanup, GUI, WSL, elevation, physical links, security settings or
public knobs changed. Unknown-close tests manually close their actual handles
in finalization but retain unconfirmed protocol metadata. Historical author-only
`.tmp/tasks/sqlite-probe-sessions-20261027/` and `.testLogs/` receipts are absent
from clean checkouts. Broader deep, optional/model/performance, release and other
platform qualification remain separate. The recorded queue remains 718 open.
