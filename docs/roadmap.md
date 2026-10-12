# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-12
Last reconciled: 2026-10-12
Canonical for: initiative status, execution order, and remaining work

## Audit backlog implementation

The current task implements all 45 items from the October 12 audit, starting at
`bb9901ac808a24629c8004ddd2479006716498be` on
`codex/audit-backlog-implementation-20261012`. The uploaded evidence archive's
41 SHA-256 entries match. Attachments define evidence and scope; the user's
implementation and validation workflow controls execution.

Four durable GPT-6.1 Sol agents at xhigh own embeddings, semantics, interfaces,
and storage/runtime. The coordinator owns quality, TUI, and shared integration.
Source, fixtures, contracts, documentation, and measurement instrumentation are
frontloaded. During implementation, only owned formatting/lint, applicable type
checks, syntax checks, and diff checks run. The integrated lightweight boundary
passed; strict timeout acceptance passed first. All focused owner selections,
native Linux TUI cleanup, and native C authority passed. Real-model and
runtime-cost qualification passed within recorded limits. Actual browser layout and service qualification
passed. The prescribed final front gate passed: 39 cases, zero skips/timeouts,
retries or native redos. Initial failures remain in the detailed receipts.

Official Node 26.8.1 bootstrap and supported native repair completed. Setup assets
include task-owned Rust 1.88, LLVM/clangd 19.1.7, Chromium 141, and verified q8/fp32
MiniLM files. Asset availability does not establish provider/project acceptance.
Supported native verification now passes the registered grammar activation probes
and refreshed the real readiness receipt. Actual provider/project qualification
is independently recorded.

Completed order: all implementation and lightweight checks first; previewed
focused fixtures with jobs=1, timeout=30s, retries=0; bounded measurements and
real browser/native qualification; the prescribed integrated front gate. Failure
corrections reran their affected cases only. There are 148 unique accepted focused
cases plus the 39-case gate; final documentation link/USR checks also pass.

`done` means implemented; `pass` means the applicable check passed. Focused
tests and qualification are independently recorded. Bounded qualification does
not imply every native platform, provider, corpus or precision variant passed. [Detailed receipts and limits](archived/audit-backlog-implementation-2026-10-12.md)
retain the implementation contracts and later acceptance results.

| Item | Implemented | Lightweight | Focused-tested | Qualified |
| --- | --- | --- | --- | --- |
| EMB-001 | done | pass | pass | fp32/native-ref pass |
| EMB-002 | done | pass | pass | fp32/native-ref pass |
| EMB-003 | done | pass | pass | bounded pass |
| EMB-004 | done | pass | pass | bounded pass |
| EMB-005 | done | pass | pass | bounded pass |
| EMB-006 | done | pass | pass | bounded pass |
| EMB-007 | done | pass | pass | bounded pass |
| EMB-008 | done | pass | pass | bounded pass |
| EMB-009 | done | pass | pass | CPU pass; q8 limit |
| EMB-010 | done | pass | pass | bounded pass |
| EMB-011 | done | pass | pass | bounded pass |
| QUAL-001 | done | pass | pass | bounded pass |
| QUAL-002 | done | pass | pass | bounded pass |
| QUAL-003 | done | pass | pass | bounded pass |
| QUAL-004 | done | pass | pass | bounded pass |
| QUAL-005 | done | pass | pass | bounded pass |
| SEM-001 | done | pass | pass | bounded pass |
| SEM-002 | done | pass | pass | bounded pass |
| SEM-003 | done | pass | pass | bounded pass |
| SEM-004 | done | pass | pass | bounded pass |
| SEM-005 | done | pass | pass | bounded pass |
| SEM-006 | done | pass | pass | bounded pass |
| SEM-007 | done | pass | pass | bounded pass |
| SEM-008 | done | pass | pass | bounded pass |
| SRC-001 | done | pass | pass | bounded pass |
| SRC-002 | done | pass | pass | bounded pass |
| SRC-003 | done | pass | pass | bounded pass |
| SRC-004 | done | pass | pass | bounded pass |
| SRC-005 | done | pass | pass | bounded pass |
| SRC-006 | done | pass | pass | bounded pass |
| SRC-007 | done | pass | pass | bounded pass |
| SRC-008 | done | pass | pass | Linux pass; platforms open |
| SRC-009 | done | pass | pass | bounded pass |
| SRC-010 | done | pass | pass | bounded pass |
| SRC-011 | done | pass | pass | bounded pass |
| SRC-012 | done | pass | pass | browser/software pass |
| SRC-013 | done | pass | pass | bounded pass |
| SRC-014 | done | pass | pass | bounded pass |
| STO-001 | done | pass | pass | bounded pass |
| STO-002 | done | pass | pass | bounded pass |
| STO-003 | done | pass | pass | bounded pass |
| STO-004 | done | pass | pass | bounded pass |
| STO-005 | done | pass | pass | bounded pass |
| STO-006 | done | pass | pass | bounded pass |
| STO-007 | done | pass | pass | bounded pass |


Qualified limits: official q8 batch/single cosine remains below the prepared 0.999
threshold; direct native output reproduces it, while strict fp32 mechanism checks
pass. Native Windows/macOS, hardware GPU, full-corpus quality/performance and other
providers remain unqualified. Automatic native cost admission still lacks child
RSS evidence. The 1024-node runtime sample refuses its 16 MiB cap; smaller/family
cohorts qualify. Saved synthetic observations are labelled; Perfetto was optional.

## Other current work and validation limits

The audit task does not close release-wide acceptance, unrelated Windows cold-index
EBUSY investigation, the parked Windows native crash, full-index throughput,
optional provider/platform campaigns, or the calibrated estimator. Native C work
is bounded to the qualified clangd authority route; other native provider and
local/cross-file precision limits remain explicit. Perfetto remains optional.

The prior roadmap's dated lineage, completed receipts, historical claims, and
release discipline are preserved in the [pre-audit snapshot](archived/roadmap-pre-audit-2026-10-12.md).
Contracts and executable tests own behavior; this page owns current status.
Historical tests are not refreshed proof for this task's branch.

Remaining semantic scope outside this task: JS/TS class/heap/call/completion
frontiers beyond the supported precise subset; Worker/WASM/provider integration;
remaining host/module precision; broader native-language analysis. Hardware
power-loss and unrelated build-writer/global disk quotas remain separate.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
| Stage1 ordered throughput cutover | `implemented` | Ordered windows, commit cursors and no-gap recovery have targeted tests. | Refresh perf and memory budget tests in the release gate before release. |
| Phase 10 interprocedural risk flows | `implemented` | Risk flows, validators and consumers retain capped/deduplicated results. | Run the affected risk and release acceptance lanes on the final release candidate. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | Snapshot and IndexRef contracts include historical/cache-boundary corrections. | Refresh cross-platform and end-to-end snapshot acceptance before release. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/chargram controls, ANN filtering and semantic constraints are implemented. | Measure representative search quality and optional native backends before release. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas and conformance surfaces are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `checkpoint clean` | Six ownership batches retain their authoritative backlog and boundary checks. | No known shared-module implementation batch remains open. Reopen only for a concrete ownership, correctness or measured performance signal. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment. |


## Current Validation Boundary

Current reconciliation, 2026-10-12: all 45 audit items have implementation,
lightweight checks, focused acceptance and bounded qualification receipts.
The prescribed final front gate passed; qualification limits remain explicit.
Hosted CI is bounded validation, not release-wide readiness. Release-wide acceptance,
optional-backend and measured-performance campaigns remain deferred.

The [October 7 closeout](guides/closeout-evidence-2026-10-07.md) and
[ordinary integration archive](archived/ordinary-integration-roadmap-2026-10-06.md)
retain their revision-specific results, including the incomplete historical run.
Historical diagnostic callback failures were reproduced; warning callbacks
cannot bypass finalization. The [bounded recovery guide](guides/recovery-low-load-2026-10-03.md)
retains that earlier correction and its resource configuration.

Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls remain the USR acceptance surface;
old green results have not been relabeled as fresh proof. Phases and lifecycle
acceptance stay in the [rollout policy](specs/usr-core-rollout-release-migration.md).

## Platform and product queue outside this task


1. **Diagnose original Windows cold-index parity cleanup.** Current hosted Windows
   CI and the structural-wrapper regression pass. Keep shared and packaged VS Code
   cmd owners byte-identical, with the existing equality regression intact. Preserve
   the archived cmd exit255 and parity EBUSY evidence. Reproduce the cold setup in
   a bounded owned fixture, capturing its primary failure separately from finally
   cleanup, then establish actual owned-child cleanup before closing EBUSY. A
   seeded report pass or a bounded timeout without EBUSY is not a repair receipt.
2. **Retain cold Pyright isolation without changing production deadlines.** The
   published installed-tool integration case passes with its bounded explicit
   allowance and cannot pass through persistent cache reuse. Preserve deterministic
   short-timeout, cleanup and production timeout contracts. Recheck both published
   portability controls and marker-bearing cache reads on the integrated source.
3. **Preserve synchronous timeout child-tree cleanup.** POSIX tree-owned commands
   use private process groups; detach/tree opt-outs and unbounded interactive
   dispatch retain their requested behavior. Historical Linux/macOS regressions
   are archived; native Windows signal acceptance remains separate.
4. **Refresh representative retrieval quality.** Exercise free-text versus explicit
   Boolean/phrase intent, filters, ANN allowed IDs and deterministic ranking through
   supported memory/SQLite backends. Use the current golden/IQ fixtures and record
   exact revisions; optional native-backend acceptance is a separate result.
5. **Refresh snapshot and resource lifecycle acceptance.** Exercise snapshot freeze,
   historical lookup, as-of cache isolation and cleanup across repeated searches
   and index generation changes. Cover supported storage backends with tiny
   repositories before larger projects or optional native components.
6. **Measure ordered Stage1 and IO budgets.** Run current throughput/memory,
   cancellation/backpressure and compression-order controls under the 30-second
   per-test policy. Record timeouts as blockers and retain bounded queues/caps;
   source-level reductions alone are not end-to-end performance measurements.
   Parser/search fixture prewarming is split into bounded cold cases with unrelated
   SCM history disabled; dedicated Git metadata cases own their one-commit history.
7. **Extend real project and interactive acceptance.** Serial, small project cases
   should cover toolchain imports/workspace roots beyond tiny single-file servers,
   followed by supported TUI cancellation, repeated commands and shutdown flows.
   Mac native hardware proof covers Help/Palette/Search, movement, resize, real
   run/cancel, terminal exit and idle redraw suppression on its isolated branch.
   Final integrated native artifacts and other platforms require distinct proof.
   Exact-root authority remains required for build-capable tooling; broader SDK,
   project and optional-native-backend acceptance remain separate.


## Release discipline

Preserve revision-specific lineage and explicit launch authority. Follow
[release validation](roadmap-release-validation-plan.md) when scheduled; bounded
fixtures and setup receipts do not replace its acceptance. Update the affected
contract and this queue when behavior changes. Completed command transcripts
belong in historical receipts. [Language/toolchain acceptance](guides/language-toolchain-acceptance.md)
separates parser activation from provider initialization and real project proof.


## Validation Commands

Documentation/status checks remain bounded and preserve existing contract/link checks:

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane all --jobs 1 --timeout-ms 30000 --retries 0 --native-status-redo=false
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

Status edits do not authorize full indexes, release campaigns or duplicate scans.
