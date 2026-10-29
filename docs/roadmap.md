# PairOfCleats Roadmap

Status: Windows baseline retained; focused failure repairs and qualification
Last audited: 2026-10-28
Last reconciled: 2026-10-28
Canonical for: initiative status, execution order, and remaining work

## Current GitHub repair program

The [closeout review](archived/github-issue-closeout-2026-10-26.md) assessed
**770 issues/238 comments**, closing 27; later batches closed 25 more.
[Checkpoint 285](archived/windows-validation-publication-checkpoint-285-2026-10-28.json)
closed nine qualified reports after publication and all eight front-gate checks
(40/40 gate cases). The R follow-up closes #1497; the
[later review](archived/windows-partial-validation-checkpoint-305-2026-10-28.md)
records 20 qualified closures, leaving **688 open**: 452 qualification-pending,
147 partial and 89 unresolved entries.

The [complete assessment](archived/github-issue-closeout-2026-10-26.json) retains
source/test mappings and closure witnesses; [earlier receipts](archived/solo-issue-repairs-2026-10-25.md)
retain historical evidence. Work is solo and Windows-only. Hosted gate/policy/Rust
TUI passed at `f8532f1d2`; seven broader jobs failed (see the review).

Completed source-bound checks are indexed in the
[qualification archive](archived/native-runtime-qualification-index-2026-10-27.md)
and [qualification matrix](testing/qualification-matrix.md).

The [full Windows baseline](archived/windows-full-validation-checkpoint-265-2026-10-28.md)
executed all 6,098 required fixtures: 5,819 passed and 279 failed, including 14
timeouts. Import/registry follow-ups now pass 109/109 cases, including all five
original failures. Three Cargo/TUI cases and four R acceptance controls pass;
queued vector-only readiness and other catalogued failures remain.

The [security/validation follow-up](archived/windows-security-and-validation-followup-2026-10-28.md)
patches both October 28 dependency advisories; fresh locked setup has no warnings
or errors and audit reports zero vulnerabilities. Affected checks pass 76/77;
queued vector-only readiness remains failing. Debugger error retention and
profile-aware optional inputs are repaired. The frozen checkpoint-305 campaign
stopped at user request: **2,606 passed, 46 failed (five timeouts), 3,450 unrun**.
Use focused failure rechecks and direct regressions; no full rerun is scheduled.
The [contract repairs](archived/windows-contract-repair-checkpoint-305-2026-10-28.md)
pass 46 controls. [Focused repairs](archived/windows-focused-failure-repairs-2026-10-28.md)
pass 26/26, resolving nine failures: Astro bounds/UTF-16, nullable chunk contexts,
canonical fixture inputs and Windows spool identity. Both publication gates pass.

[Five dependency retirements](archived/dependency-ownership-implementation-2026-10-27.md)
removed 110 lock records. Setup identities and retained inputs are archived;
runtime qualification remains separate.

Suite/platform/model/release acceptance remains separate. [Storage repairs](archived/storage-space-implementation-2026-10-27.md)
await execution; lifecycle policy (#1267) and custom cleanup (#1574) remain.

The [owner queue](archived/remaining-issue-batches-2026-10-26.json) orders
implementation by severity and shared dependencies:

1. P1 cleanup (#1574): [native lifetimes](archived/native-command-result-implementation-2026-10-28.md) await qualification; custom publication/deletion and #1627 remain.
2. Worker/service ownership and provider installation (#631); [compilation context and report refresh](archived/throughput-materialization-implementation-2026-10-28.md) await qualification.
3. Language/semantic/replay and retrieval/API evidence contracts; [comment source/demand ownership](archived/comment-pipeline-implementation-2026-10-27.md)
   has 38 authored JS/TS/Rust/import cases. [Frontmatter interiors](archived/frontmatter-content-implementation-2026-10-27.md)
   have 8 more. [Metadata routing](archived/language-routing-implementation-2026-10-27.md)
   removes eleven direct adapter edges; [operation loading](archived/language-operation-loading-implementation-2026-10-27.md)
   separates family/prose initialization. [Embedded content views](archived/embedded-content-implementation-2026-10-27.md)
   carry exact piecewise maps through Markdown/comment parsing, tokens, scheduler, VFS and semantic readers; 21 cases remain.
   JSX/TSX, function units and [exact tokens](archived/context-token-budget-implementation-2026-10-28.md) await execution; other adapters remain.
   [Early embedding selection](archived/embedding-selection-implementation-2026-10-27.md)
   pins the full-build request before Stage2; [graph preflight/attempt linkage](archived/embedding-preflight-implementation-2026-10-27.md)
   and rejected-attempt recording are implemented. Other routes and readiness/cache-only qualification remain.
   [Strict JSON admission](archived/json-import-admission-implementation-2026-10-27.md)
   adds common caps, aggregate traversal and qualified omissions; 20 cases await execution.
   [Render source admission](archived/render-source-implementation-2026-10-27.md) bounds preview/summary work; 13 cases await execution.
   [Demanded line tokens](archived/demanded-line-tokens-implementation-2026-10-27.md) replace whole-file preparation; 12 cases and dense/sparse qualification remain.
   [Persistent trace state](archived/trace-state-implementation-2026-10-27.md) shares frontiers/visits and bounds cross-service retention; 11 cases remain (#1581).
   [Hydrated risk admission](archived/hydrated-risk-budget-implementation-2026-10-27.md) repairs final flow caps/accounting; 7 cases remain (#131).
4. [Native workflow witnesses](archived/native-workflow-preflight-implementation-2026-10-27.md),
   [reports and opt-in shortcuts](archived/operator-report-and-shortcut-implementation-2026-10-28.md) await execution (#635, #173, #216).
   [Wrapped log rows](archived/tui-log-rows-implementation-2026-10-27.md) and paused anchors are implemented/typechecked; native qualification remains (#619).
   [Scene render witnesses](archived/scene-render-observation-implementation-2026-10-27.md) now observe captured operations; browser qualification remains (#1372).
5. Performance/evaluation: [numeric observations](archived/throughput-observations-implementation-2026-10-28.md) (#277), [retained comparisons](contracts/benchmark-evidence-retention.md) (#1663),
   [serial SQLite trial profiles](archived/sqlite-trial-profiles-implementation-2026-10-27.md) (#1733)
   and [Windows descendant RSS qualification](archived/query-process-tree-implementation-2026-10-27.md) (#1675); actual measurements remain.
   Shared [workspace/method health](contracts/lsp-workspace-method-health.md) is implemented (#292); qualification remains.
6. Research capabilities after their prerequisite source/retrieval/evidence owners.

The [scoped CDB collector](archived/windows-cdb-collector-implementation-2026-10-28.md)
and forensic drain are wired; native qualification remains.
Checkpoint 265 completed the full Windows baseline; repair its shared failures.
Real-tool/model, non-Windows and release checks remain explicit.

Current reconciliation, 2026-10-28: the full baseline is complete; shared-failure
repairs and current qualification continue.
Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls need
reconciled acceptance under the [rollout policy](specs/usr-core-rollout-release-migration.md).
Historical [459-case observations](archived/windows-historical-rechecks-2026-10-24.md)
and [subsequent repair receipts](archived/windows-failure-repairs-2026-10-24.md)
retain their source identities; checkpoint 265 supersedes their active counts.
The earlier CDB-attributed
Node-API finalizer lifetime repair retains its fail-before, ten-process and
exposing-fixture evidence; no crash workaround or Node downgrade is used.
Older campaign details remain in the linked source-bound receipts.
The published document security repair excludes DOCX deleted/moved-from text,
versions extraction and bundle reuse, and corrects UNC service-root authority.
Its focused checks/front gate passed. Existing indexes need a normal rebuild.

Continue on `codex/pr557-audit-repairs-20261012` through
[PR #572](https://github.com/doublemover/PairOfCleats/pull/572), retaining its
existing `main` base. Node is **26.12.1**. Publication is authorized; no merge is
authorized. The user resumed work **solo**, with all workers parked, and requested
source implementation first on October 25, with functional execution deferred
until the implementation batches are ready. Formatting and static checks continue. Commit and push completed batches;
refresh the PR overview at least every 20 commits.

The [October 23 intake](archived/solo-issue-repairs-2026-10-23.md),
[prior repair wave](archived/github-issue-repairs-2026-10-21.md) and
[pause handoff](archived/implementation-pause-2026-10-23.md) retain historical
counts and mappings. Current intake and qualification status appear above.

Earlier solo source batches repaired exact embedding/cache identities, sparse Boolean
completion and execution-qualified result reuse, offsets/bitmap/signed ranking,
transactional TUI installation, document/wire/lease/method LSP lifetimes, and
original SQLite/profile/native-read failure propagation. Those historical
counts are superseded by the current intake above. These implementations and their authored
regressions remain unqualified; category cleanup/parent drain and the broader
intake remain unfinished. LSP identity is 47/rq11; offline runtime parser is 4.

### Execution order

1. **P0–P4 first**, prioritizing destructive authority/data-loss and lifecycle
   failures within a priority. Batch shared owners rather than issue numbers.
   New P1 #1679 credential projection and #1582 embedding channel identity have
   source repairs; #1574/#1693 now use cleanup admission/exclusion and truthful
   retained outcomes. Full index/backend category cleanup and real parent drain
   remain partial. #1554 now stages complete verified generations before atomic
   selection; fault/concurrency and native Windows qualification remain unrun.
2. Remaining P2/P3 issues, including prior partial owners, ordered by dependency:
   publication/resource ownership; source/cache identities; semantic and retrieval
   correctness; transports/providers; operator and evaluation workflows. Read full
   issue scopes before implementing or declaring equivalence.
3. Perf reports after priority issues. Preserve correctness, separate bounded
   operations from measured latency/heap claims, and measure serially later.
4. Other work, including setup/runtime distribution and research foundations,
   before dependent consumers. Do not create duplicate infrastructure.
5. After source integration, refresh generated contracts, fixture inventories,
   ordered lanes and MCP schemas/snapshots through their registered generators.
   Prepare/verify locked dependencies, run affected regressions and the complete
   front gate for each ready publication batch. Continue targeted failure groups;
   do not repeat the full campaign without a new user request. Preserve
   original assertions, 30-second limits, zero retries and native redo disabled.

Many earlier authored regressions remain unrun; current targeted acceptance is
limited to the exact cases in the receipt. No current-head deep-suite pass, issue
closure or measured speedup is claimed. Fresh native/patch verification passed
on Node 26.12.1 (eight patches, 26 targets, 61 hunks); setup activation is not
runtime qualification. At historical frozen `245be5fc2`, 70 broad cases produced 60 passes,
9 failures and 1 timeout; a subsequent focused selection produced 11 passes and
3 wrapper timeouts. Source repairs followed and await execution. The
[Windows receipt](archived/windows-post-wave-validation-2026-10-22.md) preserves
exact-source results. No Linux/WSL, elevation, security changes, worktrees or
arbitrary physical-link creation are included.

### Historical source chronology

The [archived source chronology](archived/roadmap-source-chronology-2026-10-25.md)
retains earlier owner repairs, versions and qualification gaps. Its implementation
claims remain distinct from current-source validation and accepted issue closure.

## Environment and qualification boundaries

Work is **Windows-only**; Linux/macOS execution is deferred. Do not launch WSL,
change machine security settings or register a machine-wide debugger. Current
Node is **26.12.1**, ABI 147, Windows x64. The
[workspace/runtime receipt](archived/workspace-layout-node-2026-10-21.md) records
a clean locked bootstrap (37 required packages/33 routes; zero warning/error
lines), 16 focused passes and all 40 front-gate passes at checkpoint 8685a0dec.
New behavior needs its own affected checks. Product activation is not full runtime
or release qualification. Current contributor scratch lives under ignored
`.tmp/dev/` and `.tmp/tasks/`; the old root scratch directory is retired.

The Windows deep suite is **green** at `ffde426be` as a historical, immutable
Windows baseline. Linux/macOS full deep execution, optional backends, real models
and release qualification remain separate.

The [qualification matrix](testing/qualification-matrix.md) and
[Windows repair receipt](archived/windows-deep-repairs-2026-10-18.md) retain the
historical 2982-case full Windows baseline at `ffde426be`, including 65 original
failures and 27 timeouts. That baseline does not qualify the current source.
The original Node 26.8.1 RealmCppGC access violation and separate Tree-sitter
0xC0000409 repair retain their own debugger/patch evidence. Bulky author-workspace
dumps and symbols were removed at the user's request; compact analyses, hashes
and reproduction inputs remain historical evidence, not clean-checkout assets.

The user removed physical file-symlink creation from this repair program's
acceptance prerequisites. Preserve existing link-specific assertions as optional
capability qualification; new guards use real ordinary-filesystem controls and
injected link attributes. No elevation, arbitrary symlink creation or OS security
setting change is required for ordinary repair validation. Native TUI setup/service/replay/catalog workflows, Solargraph
startup, SQLite worker/cold-helper stalls, representative retrieval/edit freshness/
heap evidence, real models and supported release targets remain explicit open
work. Do not relabel unsupported, skipped or unrun cases as passed.

## Existing product and semantic scope

The [prior roadmap snapshot](archived/roadmap-pre-issue-reconciliation-2026-10-21.md)
preserves all preceding initiative details, execution history and validation
limits. JS/TS class/heap/call/completion frontiers, host/module precision,
Worker/WASM/provider integration and broader native-language analysis remain
within the new issue reconciliation rather than being silently declared finished.
[Language/toolchain acceptance](guides/language-toolchain-acceptance.md) separates
parser activation, provider initialization and real consumer-visible project facts.
The existing USR schemas, scheduler, journal, lease and publication-recovery owners
remain authoritative. Meaning changes must advance their shared producer versions.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
| Stage1 ordered throughput cutover | `implemented` | Ordered windows, commit cursors and no-gap recovery have targeted tests. | Refresh perf and memory budget tests in the release gate before release. |
| Phase 10 interprocedural risk flows | `implemented` | Risk flows, validators and consumers retain capped/deduplicated results. | Run the affected risk and release acceptance lanes on the final release candidate. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | Snapshot and IndexRef contracts include historical/cache-boundary corrections. | Refresh cross-platform and end-to-end snapshot acceptance before release. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/chargram controls, ANN filtering and semantic constraints are implemented. | Measure representative search quality and optional native backends before release. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas and conformance surfaces are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `coupling audit open` | Query registry 2/2, artifact I/O 71/73 and retrieval CLI 7/60 pass; broader ownership inventory remains separate. | Retain fixes for the October 18 direct/transitive import-budget failures without raising baselines; measure remaining startup/coupling work separately. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment. |



## Release discipline

Preserve revision-specific lineage and explicit launch authority. Follow the
[release validation plan](roadmap-release-validation-plan.md) and
[USR rollout policy](specs/usr-core-rollout-release-migration.md) for their
respective acceptance. Dependency PRs and live source-security/release scans
retain separate evidence. Historical green results are not final-head acceptance.

Hosted CI is bounded validation, not release-wide readiness. Release-wide acceptance,
optional-backend and measured-performance campaigns remain deferred until the
corresponding planned candidate. The [October 7 closeout](guides/closeout-evidence-2026-10-07.md)
and [ordinary integration archive](archived/ordinary-integration-roadmap-2026-10-06.md)
retain revision-specific results; old green results have not been relabeled as fresh proof.
Historical diagnostic callback failures were reproduced; diagnostic callbacks cannot bypass
finalization. The [bounded recovery guide](guides/recovery-low-load-2026-10-03.md)
retains the correction and original resource settings.

## Validation Commands

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane all --jobs 1 --timeout-ms 30000 --retries 0 --native-status-redo=false
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

