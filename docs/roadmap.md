# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-14
Last reconciled: 2026-10-14
Canonical for: initiative status, execution order, and remaining work

## Dependency and CI reconciliation, October 14

The stack is landed on `main` at `5e0060003304138386f659acdd897d84c9cc4cf7`.
PR #556 merged first; #558 merged into #557, then the combined #557 merged
into main. The landed tree exactly matches tested candidate `ece2c60bd`.
Integration-head CI runs automatically; it is not yet final-head acceptance.
Live GitHub inspection found zero open Dependabot security alerts and twelve
version-update PRs, now closed as superseded by #558. Their updates are pushed in `dae8ecd62`, including
the JSON-RPC 9 Node entry point and coordinated artifact-action contract updates.

Hosted CI on the original repair head passed gate/Rust but failed eight fixtures
on Ubuntu/macOS and seven on Windows (one Windows skip). Those eight fixtures
now pass locally on Windows after lifecycle repairs and current-contract fixture
corrections. This is not a hosted rerun or cross-platform acceptance. Twenty
dependency-focused fixtures also pass. Initial failures and environment limits
remain in the [reconciliation receipt](archived/dependency-ci-reconciliation-2026-10-14.md).
The final local front gate passes, including all 39 gate cases with zero
skips, retries or timeouts. Hosted cross-platform acceptance remains pending.

Execution order: dependencies, CI repairs, this status reconciliation, then
SRC-010 cold artifact/LMDB pagination and EMB-009 representative provider
measurements. Both follow-ups are implemented: fresh artifact/SQLite/LMDB
processes hydrate 19,003 rows across eleven pages of a 10,000-row index;
real fp32/q8 CPU measurements cover 24 mixed-length repository excerpts.
The five-second full-wrapper failure was subsequently repaired in the product
closeout below. Embedding work, including the q8 precision limit, is deferred
by user direction. See the
[audit continuation receipt](archived/audit-continuation-2026-10-14.md).
Current classification is 39 bounded-verified, six qualification-limited,
zero partial, and zero missing; the older 45-item table
below records historical implementation rather than full current acceptance.

## PR 557 completion-audit follow-up

The follow-up at `6125e534ec8a2d588688c8c3b107bad268d6cd90` confirmed substantive
implementation across all 45 items and reproduced ten additional regressions plus
one existing repeated-build RE2 failure. Targeted local repairs and regression
tests now cover those findings, with independent edge-case review. See the
[repair record](archived/pr557-completion-audit-repairs-2026-10-12.md).
The original table below remains the prior implementation/qualification receipt;
it is not a replacement for the follow-up's fresh evidence. Cold artifact/LMDB
all-page loading (SRC-010) and representative provider measurements (EMB-009)
were subsequently addressed in the October 14 continuation above. Explicit
wrapper/platform/resource/model qualification limits remain open. No hosted CI
or merge was performed during this follow-up.

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

Current reconciliation, 2026-10-14: all 45 audit items have implementation;
39 are bounded-verified and six retain explicit qualification limits.
Embedding expansion and broad cross-platform CI are deferred by user direction.
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

## Product closeout, October 14

The ten agreed priorities are handled within the bounded local scope below.
[Detailed results, initial failures, commands and release scope](archived/product-closeout-2026-10-14.md)
are the current receipt. Earlier platform queues remain historical in the
[October 12 roadmap archive](archived/roadmap-pre-audit-2026-10-12.md).

| Priority | Current result |
| --- | --- |
| 1. Publish completed batch | Six commits pushed; PR #558 verified at `0efc59edc`. Follow-up publication is recorded in the closeout receipt. |
| 2. Cold CLI startup | Narrow search imports avoid indexing/language-analysis startup; all four fresh pages pass the unchanged five-second child limit. |
| 3. Retrieval and snapshots | Golden query intent, Boolean/phrase eligibility, memory/SQLite, ranking, federation, snapshot history/retention and generation leases pass. |
| 4. Windows cleanup | Real cold build passes its original 15-second child limit, followed by verified descendant exit and immediate directory removal. Initial setup timeouts retain separate cleanup evidence. |
| 5. Cancellation | Sync child-tree, tracked shutdown, Stage1 cancellation/drain and LSP cleanup checks pass. |
| 6. Indexing budgets | Real 51-file Stage1 build, memory pressure, ordered commits, byte limits, IO backpressure and compression transfer checks pass. |
| 7. Incremental correctness | Real edit/delete/rename rebuild equals clean artifacts; SQLite update/search and interrupted-worker recovery pass. |
| 8. Project tooling | Real TypeScript provider/import/package-resolution and Pyright workspace-planning checks pass within the recorded sample. |
| 9. Interactive workflows | Real supervised search/failure/recovery, cancellation, shutdown, snapshot recovery and native frame captures pass on this host. |
| 10. Release consolidation | PR #558 is the combined repair/release candidate atop #556/#557; superseded bot updates are reconciled there. Release metadata now matches Node 26. Scoped CLI release checks pass. |

The final local front gate and source-candidate identity are recorded in the
closeout receipt. No merge, package publication, broad native/platform campaign,
or renewed embedding qualification is authorized by this status record.


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
