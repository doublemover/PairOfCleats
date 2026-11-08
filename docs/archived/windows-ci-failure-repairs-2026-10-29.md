# Windows CI failure repairs

This batch starts at `e9704cc61730ec71b4f5ef13819134d5ec67b273` on
`codex/pr557-audit-repairs-20261012`. It retains the original 49 failed fixtures
from the preceding macOS campaign, their actual logs, source comparisons and
focused Windows rechecks in the [machine receipt](windows-ci-failure-repairs-2026-10-29.json).
Implementation was attempted across the complete catalog before this repair
wave's execution. Rechecks then selected failures and affected owners.

## Production repairs

- Registry mutation capabilities retire when release starts or on observed owner
  mismatch. Restoring old lock bytes cannot revive authority after a failed
  release; the original cleanup owner and changed evidence remain retained.
- Unexpected process-worker IPC disconnection retains the task and reservation
  through bounded teardown. The actual close event classifies exit and releases
  resources. Controlled crash, disconnected-but-live child, cancellation,
  initialization, timeout, restart and aggregate-memory assertions remain.
- Standalone retrieval reports the captured selected directory's actual build
  generation through the existing generation-key owner. It never rereads a
  mutable pointer to manufacture provenance. Coordinator observations remain
  authoritative when supplied; absent build identity remains unqualified.
- Code generations publish canonical empty `call_sites` when artifact emission
  is enabled and no calls were observed. Strict API reports now handle a
  declarations-only project. Missing manifest declarations still fail. The
  shared piece-assembly producer advances **4 → 5** for derived replay admission.
- Reladraw 0.21.0 projections declare container layout and use current placement
  syntax. Bindings, source orientation, containment, selection, pagination,
  hostile-label rejection and worker disposal remain covered. UI/docs display
  the actual dependency version.
- Quiet human display suppresses task-progress lines. Structured progress and
  diagnostic/error contracts retain their existing owners.
- Concurrent benchmark writers join the existing metadata lock for bounded
  settlement, retaining exact original reservations until release is confirmed.
  A controlled original zero-wait implementation fails the new regression;
  the repaired owner passes with pending-record and preserved-evidence witnesses.
- HDR histogram construction admits legitimate zero/sub-microsecond operations
  without violating the library's minimum range. Tinybench reuses that owner;
  quantization, samples, denominators and latency thresholds are unchanged.
- The VFS benchmark forwards the canonical `--docBytes` option to its actual
  child. Two eight-byte documents remain sixteen bytes in every measured phase.
- Subprocess self-signal dispatch shares the hook owner, removing one transitive
  import while preserving signal forwarding and the existing import budget.

## Fixture repairs retain their contracts

SCM fixtures distinguish native separators from literal POSIX backslashes.
Dense/vector-extension cases retain short/long/invalid inputs as rejection
controls and add exact-width positives that verify dispatch and encoded bytes.
Required patch-queue errors remain observable after successful flush. Snapshot
fixtures now bind matching state/manifest/mode generations. Semantic pull-writer
fixtures supply canonical policy identities for both ordinary and budgeted work.

Managed doctor probes select explicit platform fixtures and exact trust roots.
Dart reuse supplies the same content identity for unchanged bytes and adds an
actual changed-content/new-process control; its hidden scenario retry is removed.
Provider caching supplies an execution-bound invocation, proves identical reuse,
and invalidates changed captured configuration. Warning-bearing contributing
providers remain degraded. Sublime expected paths use the product's absolute
path policy on each platform.

GC positives use canonical registered generated files. Unknown inventory remains
protected, blocks incomplete size accounting, and cannot authorize eviction.
Independent complete-size and stale-age positives retain real planned removals;
the live-lock negative protects the previously eligible candidate. Probe-cache
fixtures use the actual current producer/key identity, retain capacity/age
controls, and assert that unknown files block writes without changing bytes.

Current map caches stay external; legacy fixtures explicitly use their historical
format. Warm-cache comparisons retain all content/build measurements and omit
only invocation-owned `exportedAt`, whose exporter assignment is explicit.
Context preparation comparisons similarly omit only measured elapsed time while
asserting a finite nonnegative observation. Triage tests separately reject a
corrupt publication receipt and a valid conflicting derived identity.

Streaming fault fixtures declare valid ordered shards so malformed late rows
reach the reader rather than an ambiguous manifest. Seed metadata uses canonical
virtual identity. VFS recovery observes and reconciles the original descriptor
and publication-lock sessions. Export rollback removes an unchanged owned file
after reader failure, while mutation invalidates deletion authority and preserves
changed evidence. Finalized supervisor jobs retain pending artifact inventories
before admitting ID reuse. PQueue 10's actual queued-abort withdrawal is asserted
without releasing the unrelated active request. The API parity harness uses
independent HTTP connections across synchronous CLI controls instead of reusing
an expired idle socket.

## Bounded export coverage and native workflow setup

The former four export wrappers repeatedly built the same four-file project and
exceeded their ten-second setup bound. Named JavaScript/TypeScript report and
fail cases retain the original declarations, five mismatched calls, internal
export negatives, artifact validation and warning-policy assertions. Six new
independent cases retain the exact anonymous-function, arrow-default and
class-default source forms and their original zero-call/export-name assertions.
All ten cases retain the same discovered path and original ordered `ci-lite`
membership; the separate forty-case cheap gate stays bounded.
The source project uses intrinsic numbers and explicit empty ambient/standard
library inventories. No deadline, retry policy or assertion is relaxed.

The hosted Windows native cohort now passes 33/34, including every partitioned
artifact action. Snapshot-create exhausted its runner budget while preparing a
full seed under a long fixture path. An exclusive compact directory inside the
existing test-cache category preserves the same source, real build/backends,
binary, supervisor, terminal operations and publication witnesses. Its focused
Windows run passes in **22.7 seconds**, within the original thirty-second runner
bound. General unrestricted LanceDB long-root support remains a separate
qualification; no backend was disabled for this repair.

## Qualification and remaining acceptance

All 48 locally applicable original failures have passing focused observations;
the physical file-symlink fixture remains owned by the capable hosted Windows
authority cohort. It is repaired to select an actually published generation,
with the source/editor redirection negatives unchanged. No privilege change,
elevation, junction substitution or local skip is passing evidence.

The receipt distinguishes each repair iteration, final affected controls and
the publication gate. Earlier green observations are source-bound, not a claim
that an unfiltered suite passed at the final tree. Required hosted integration,
physical authority and final native candidate acceptance remain open.

At the preceding published head, Windows integration records 1,318 passes,
38 failures, two timeouts and three exclusions. Its two additional lifetime
hangs are `retrieval/pipeline/ann-lazy-import` and
`tooling/sublime/api-authentication`; they remain for the next focused batch.
Their historical 600-second hosted deadlines are not passing evidence or a
reason to increase local bounds. The current batch's original 48 local failures,
six transferred defaults and affected ownership/producer controls have passing
focused observations; all eight publication checks pass, including 40 gate cases.

The same hosted run independently completes the [crash-log POSIX closeout](crash-log-posix-qualification-2026-10-29.md)
and closes #1315. All local log/download paths in receipts are historical author
workspace evidence; durable copied outcomes and hashes are retained here.

Only one proven unreachable implementation branch is removed: vector query
clipping/padding warning code. Its normalization owner unconditionally returns
`adjusted: false` and rejects invalid dimensions; strict rejection and exact-width
positive coverage remain. No test or other production implementation is deleted.
