# DEPRECATED — pre-maintenance roadmap snapshot

Replacement: [canonical roadmap](../roadmap.md).
Reason: reconcile current branch, runtime instructions and validation status.
Archived: 2026-10-18 from `ab00d918d` (PR #572).
This snapshot preserves completed product tables and their original claims.

# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-14
Last reconciled: 2026-10-15
Canonical for: initiative status, execution order, and remaining work

## Current product follow-up

User priority order: JS/TS precision, real edit-to-search latency, search relevance,
then actionable freshness. The implementation adds immutable computed keys and
function aliases, real filesystem-watch publication/search coverage, exact symbol
and filename ranking, and bounded hash comparisons of indexed source files.
The watch experiment reproduced a Parcel subscription cleanup defect; it is
repaired. Optional MCP build imports now load on demand. Complete context-pack
responses have a 128 KiB ceiling with explicit optional-section omissions.
Whole-repository cleanup now uses local process admission/lifetime leases.
Freshness discovers new candidate files using indexing ignore/routing rules.
Ten real-index search-quality cases pass across code and extracted prose.

Validation and limitations are recorded in the
[follow-up receipt](../archived/product-follow-up-2026-10-14.md).
The preceding 45-item audit table and completed product batches are preserved in
[the prior roadmap snapshot](../archived/roadmap-product-wins-2026-10-14.md).
The audit classification remains 39 bounded-verified and six qualification-limited.

The [October 15 follow-up receipt](../archived/product-follow-up-2026-10-15.md)
records online-GC concurrency, bounded new-file discovery, search quality and
remaining qualification limits.

Remaining work, when separately scoped:

1. Live watcher identity verification; saved watcher state still does not prove
   liveness. Bounded file discovery and hash comparisons are not an atomic snapshot.
2. Production-corpus relevance and retained-heap analysis if MCP memory remains
   a practical issue. The new eight-file, ten-query fixture is bounded acceptance.
3. Remaining semantic precision and release qualification listed below.

The old native crash was not reproduced in its bounded investigation. Per user
instruction it is closed as non-reproduced and reopens only on new evidence.
Embeddings and broad cross-platform CI remain outside this batch.

## Other current work and validation limits

The audit task does not close release-wide acceptance, unrelated Windows cold-index
EBUSY investigation, full-index throughput,
optional provider/platform campaigns, or the calibrated estimator. Native C work
is bounded to the qualified clangd authority route; other native provider and
local/cross-file precision limits remain explicit. Perfetto remains optional.

The prior roadmap's dated lineage, completed receipts, historical claims, and
release discipline are preserved in the [pre-audit snapshot](../archived/roadmap-pre-audit-2026-10-12.md).
Contracts and executable tests own behavior; this page owns current status.
Historical tests are not refreshed proof for this task's branch.

Remaining semantic scope outside this task: JS/TS class/heap/call/completion
frontiers beyond the supported precise subset; Worker/WASM/provider integration;
remaining host/module precision; broader native-language analysis. Hardware
power-loss and unrelated build-writer/global disk quotas remain separate.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](../guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
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

The [October 7 closeout](../guides/closeout-evidence-2026-10-07.md) and
[ordinary integration archive](../archived/ordinary-integration-roadmap-2026-10-06.md)
retain their revision-specific results, including the incomplete historical run.
Historical diagnostic callback failures were reproduced; warning callbacks
cannot bypass finalization. The [bounded recovery guide](../guides/recovery-low-load-2026-10-03.md)
retains that earlier correction and its resource configuration.

Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls remain the USR acceptance surface;
old green results have not been relabeled as fresh proof. Phases and lifecycle
acceptance stay in the [rollout policy](../specs/usr-core-rollout-release-migration.md).

## Product closeout, October 14

The ten agreed priorities are handled within the bounded local scope below.
[Detailed results, initial failures, commands and release scope](../archived/product-closeout-2026-10-14.md)
are the current receipt. Earlier platform queues remain historical in the
[October 12 roadmap archive](../archived/roadmap-pre-audit-2026-10-12.md).

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

### Active product improvements

User-selected follow-up: items 3, 4 and 6-20 from the product-win proposal.
Items 1, 2 and 5 are not in this batch. Embeddings and broad cross-platform CI
remain deferred. Implementation and bounded checks are recorded in the
[product receipt](../archived/product-wins-2026-10-14.md). Local install/upgrade qualification and the publication gate pass. This is
not cross-platform release acceptance. The prior native crash was not reproduced; reopen only on new evidence.

| Item | Required outcome | Status |
| --- | --- | --- |
| 3 | Bounded watcher latency under continuous edits | implemented; bounded check passed |
| 4 | Evidence-based empty-result guidance | implemented; bounded check passed |
| 6 | Bounded real-source indexing profile and measured improvement | implemented; bounded check passed |
| 7 | Index freshness and coverage visibility | implemented; bounded check passed |
| 8 | Useful, deduplicated agent context within token budgets | implemented; bounded check passed |
| 9 | Actual MCP discovery/search/inspect/context workflow | implemented; bounded check passed |
| 10 | Generation-safe federated structured enumeration | implemented; bounded check passed |
| 11 | Change-impact usefulness and uncertainty | implemented; bounded check passed |
| 12 | Focused, evidence-backed test suggestions | implemented; bounded check passed |
| 13 | Actionable doctor/status recovery guidance | implemented; bounded check passed |
| 14 | Bounded investigation of Windows native teardown crash | investigated; crash not reproduced/root-caused |
| 15 | Bounded long-lived session resource checks | bounded resource check passed |
| 16 | Lease-safe disk usage and cleanup preview | implemented; bounded check passed |
| 17 | Installed Pyright proof on a representative Python package | implemented; bounded check passed |
| 18 | One real JS/TS semantic precision improvement | implemented; bounded check passed |
| 19 | TUI inspect/refine/return state preservation | implemented; bounded check passed |
| 20 | Locally installable candidate and upgrade verification | local source candidate install/upgrade passed |

Preserve revision-specific lineage and explicit launch authority. Follow
[release validation](../roadmap-release-validation-plan.md) when scheduled; bounded
fixtures and setup receipts do not replace its acceptance. Update the affected
contract and this queue when behavior changes. Completed command transcripts
belong in historical receipts. [Language/toolchain acceptance](../guides/language-toolchain-acceptance.md)
separates parser activation from provider initialization and real project proof.


## Validation Commands

Documentation/status checks remain bounded and preserve existing contract/link checks:

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane all --jobs 1 --timeout-ms 30000 --retries 0 --native-status-redo=false
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

Status edits do not authorize full indexes, release campaigns or duplicate scans.
