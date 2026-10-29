# Windows import and TUI validation follow-up

The complete checkpoint-265 baseline remains 5,819 passing and 279 failing
required cases, including 14 timeouts. This follow-up repairs observed failures;
it does not replace that baseline with a full-tree passing claim.
The [machine-readable receipt](windows-import-and-tui-validation-2026-10-28.json)
retains every selected ID, outcome, report hash and source revision.

## Import production and replay

All **109 import/registry checks pass**, including the five original failures:
CSS registry replay, extraction handoff, manifest-bound snapshots, shared source
buffer/hash reuse and import-extraction receipts. The original failing receipts
remain in the baseline and earlier focused qualification archives.

The bundle writer retained the producer receipt correctly. The missing owner
was qualification at JS/CSS collection. JS now binds the actual Babel/Acorn/
Esprima version and private AST/source ownership to its declared literal subset.
Injected, stale, recovered, failed and cancelled syntax cannot qualify replay.
Empty files are actually parsed, and escaped `require` identifiers survive.
CSS binds its privately owned token facts, actual admitted limits and source to
the receipt. Duplicate occurrences have exact local accounting. Malformed,
limited, unsupported and cancelled scans remain nonreusable.

The module fast path preserves decoded literal punctuation and records only the
ESM lexer that actually ran. Require-like and escaped source uses the AST route.
The old regex could recognize call text inside comments/strings and then label
it parser-qualified. Its removal initially exposed a meaningful broken-file
control. That control and ordered-lane ID are retained: bounded Acorn tokens now
recover real literal candidates while keeping `parse-failed` and refusing warm
reuse. Source/token/match/line caps stay covered. No failure was hidden by
deleting the fixture or changing its positive dependency assertion.

Installed parser versions participate in the import fingerprint. Import semantic
producer versions 22 and 23 invalidate the changed observations. Existing reader,
artifact, source, generation and strict receipt contracts are retained.

## Windows native TUI

The original three build/capture failures lacked Cargo on PATH. A task-local
PATH selected the installed Cargo and the existing exact Rust **1.88.0** pin;
the locked offline Windows x64 release build completed in **24.12 seconds**,
without compiler warnings. Build preparation is recorded separately from test
duration and is not a cold-build performance claim.

Manifest verification and headless smoke then passed. Frame capture exposed
obsolete layout expectations: `interaction::compact` selects one pane below
100 columns or 32 rows, as documented in the TUI guide and covered by Rust
breakpoint tests. The harness had required every panel at 80×24 and 100×28.
Seven existing fixture inputs now also capture 120×40 desktop frames. The old
full-panel, workload, filter, search, pause and palette assertions remain on the
desktop layout; the original compact variants remain and check session scope,
work rows, active/log filtering, hints, color and wrapped-row scrolling. Help
checks follow the canonical scrolling help owner and its exact pane shortcuts.
No native rendering behavior or fixture deadline was weakened.

All **three original TUI cases** pass. Four R argument/replay acceptance checks
also pass, including the exact `require(dplyr, character.only = FALSE)` report,
dynamic-variable rejection, named arguments, comments/newlines, escapes,
registered relations and source/time/match limits.

## Publication and remaining work

[Checkpoint 285 publication and nine verified issue closures](windows-validation-publication-checkpoint-285-2026-10-28.json)
retain the exact published head, all eight gate results and GitHub readbacks.
The complete baseline and focused reports preserve exact source identities;
raw `.tmp/` receipts are historical author-workspace evidence, unavailable in a
clean checkout.

Vector-only service validation remains a genuine readiness/publication defect.
Queued vector work does not establish dense artifacts or search readiness.
Sparse validation also needs profile-aware admission. These contracts have not
been relaxed. Other baseline failures, native workflow lifetimes/timeouts,
provider availability, remaining SQLite/Stage3 crash attribution and measured
performance qualification remain open. Linux/macOS, optional backends, physical
links, real-model and release acceptance stay separate.
