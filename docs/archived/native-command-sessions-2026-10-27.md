# Native build and compaction sessions — 2026-10-27

Source: `753c7f9a013346fdc3b6f0d3472bd31236b5c282`, tree
`c7ec579613b2c5af91da1d78c73cd607c3ca74f4`, on
`codex/pr557-audit-repairs-20261012`; Windows x64, Node 26.12.1.
Dependencies, patches and native binaries are unchanged; bootstrap was not rerun.

Canonical LMDB builds and SQLite compaction now admit launch-selected repository,
resource and cache-category sessions before native access. The existing command
registry waits for accepted work, original native closes and independent pending
observations before releasing metadata or acknowledging delegation. The SQLite
build runner supplies its internal compaction launch context. This qualifies
compaction, not every phase of that builder or context-free legacy callers.

Metadata failure retains the original opaque command owner. Explicit concurrent
recovery joins one operation and cannot repeat native close, acknowledge unknown
resources or change a failed command result. Invalid, repeated and empty scopes
cannot reopen admission. Compaction also preserves frozen work failures and exact
cleanup causes instead of masking them with a property-assignment TypeError.

**24/24 affected Windows cases and the full front gate, including 40/40 gate
cases, pass.** One job/thread, 30-second bounds, zero retries/native redo; no
final failures, skips, timeouts, native crashes or unexpected warnings. Actual
SQLite compaction checks every original handle close, output readback and held
category exclusion. Actual LMDB build/readback retains JSON/JSONL/columnar parity;
real native prefetch retains leases while its callback handoff is held. Existing
delegation, metadata, minhash, optional-FTS and resource-error assertions remain.

Seven child-only historical-owner/snippet controls fail before repair. Two use
only the prior failing hunk with current admission retained: frozen-error cleanup
reproduces the masking TypeError, and empty scope reopens admission. The other
five use complete prior owners from `691f7db7b`. Checkout source was never reverted.
The [structured receipt](native-command-sessions-2026-10-27.json) enumerates checks,
source identity, controls and original failed observations.

The initial fixture cleanup confused LMDB's `open` method with SQLite's boolean
property; the corrected instance guard passes in the final cohort. Generated
freshness caught the roadmap exceeding its CRLF byte limit. Condensing completed
receipt rows retained every link and passed the unchanged limit/freshness check.
Unknown-close controls manually close their actual test handles in finalization
but deliberately retain unconfirmed protocol metadata; that is no settlement claim.

**#1574 remains partial.** Custom/external registration, validator/probe and complete
SQLite builder/sidecar/legacy-adapter lifetimes, category-specific eligible deletion
and all/multi-repo CLI/MCP acceptance remain. External targets receive no deletion
authority. The queue remains 718 open: 459 qualification, 146 partial, 113 unresolved.
Full deep, optional backend/model/performance, release and other-platform acceptance
remain separate. No user cache cleanup, GUI, WSL, elevation, security-setting change
or physical link was used. Raw `.tmp/tasks/native-command-sessions-20261027/` and
`.testLogs/` are historical author-workspace evidence, absent from clean checkouts.
