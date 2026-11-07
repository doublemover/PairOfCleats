# PairOfCleats Roadmap

Status: all open issues in scope except Tantivy/editor work
Last audited: 2026-11-06
Last reconciled: 2026-11-06
Canonical for: initiative status, execution order, and remaining work

## Current GitHub repair program

Current reconciliation, 2026-11-06: the [complete intake](archived/open-issue-batches-2026-11-05.json) captures367 reports and14 verified closures. **353 remain open**. Thirteen editor/Tantivy-only reports are excluded; four mixed issues retain non-editor scope. The intake identifies every closure and coverage owner.

P2/P3: **337 qualified closures**, two editor remainders, one native deferral and six editor exclusions from346 reports. Work continues solo on Windows: implement related repairs, then verify affected controls.

[Native parity](archived/windows-onnx-runtime-parity-2026-10-30.md) records CDB attribution and ORT1.30.0. [Models](archived/windows-model-closeout-2026-11-04.md) close #1542/#1544; drain/projection close #1484. [Windows terminals](archived/windows-terminal-budget-repair-2026-11-04.md) pass70 cases. [SQLite](archived/windows-sqlite-final-qualification-2026-11-04.md) passes324 children and closes #1733.

[Tantivy build settlement](archived/windows-tantivy-build-settlement-2026-11-04.md) repairs original dispatch/result observations before activation and failure unwind; build identity2 rejects earlier meaning. [Native Tantivy qualification is deferred by user decision](archived/windows-tantivy-native-deferral-2026-11-04.json); #1627 remains open and experimental.

Completed source-bound checks are indexed in the
[qualification archive](archived/native-runtime-qualification-index-2026-10-27.md)
and [qualification matrix](testing/qualification-matrix.md).

[Windows campaign receipts](archived/windows-full-validation-checkpoint-265-2026-10-28.md)
and [focused repairs](archived/windows-comment-and-handoff-failure-repairs-2026-10-28.md)
retain original failures and source identities. No new full-suite run is scheduled.

[Recent qualifications](archived/repair-qualification-summary-2026-11-05.md) retain source-bound native, compiler and runtime receipts. Open blockers: [published search](archived/native-published-search-investigation-2026-11-05.json)'s full-seed budget; [managed allocation](archived/managed-install-destination-repairs-2026-11-05.md)'s package closures/build allowances (#1559); [capped reads](archived/capped-reader-lifecycle-repairs-2026-11-05.md) (#1330); CI2181's discard-frame race/settings timeout. [Semantic encoding](archived/semantic-encoding-closeout-2026-11-05.md) closes #1212 with68 cases/48 serial samples at5f0e2cca7.

Implemented, awaiting runtime checks: [lifetimes](contracts/semantic-scheduler-wait-ownership.md)/[observations](contracts/storage-resource-observations.md) (#1214/#1330/#1765); [catalogs](contracts/runtime-family-catalog.md), [consumer proof](contracts/consumer-proof-index.md), [embedded preparation](contracts/embedded-cache-preparation.md) (#1618/#1768/#1710); [questions](contracts/repository-questions.md) (#1534); [answers](contracts/answer-evidence.md)/[retention](contracts/answer-retention.md) (#1532); [host delivery](contracts/context-evidence-delivery.md) (#1533); [positive rules](contracts/finite-positive-rules.md)/[repair](contracts/finite-positive-repair.md) (#1516/#1524); [causal models](contracts/finite-causal-models.md)/[paired replay](contracts/paired-finite-interventions.md) (#1524/#1526); [private-oracle tasks](contracts/finite-evidence-tasks.md) (#1525); [finite feasibility](contracts/finite-feasibility.md) (#1527); [query adapters](contracts/retrieval-adaptation.md) (#1529); [policy receipts](contracts/finite-policy-qualification.md) (#1530, shadow only). [Checkout bootstrap](guides/bootstrap-prerequisites.md) binds original mutation/journal owners to readiness v3, targeted recovery, exact prior receipts, complete command logs, shared budgets, closed-file retention and awaited output (#1555/#1557). [Benchmark evidence](contracts/benchmark-diagnostic-coverage.md) (#683) requires observed parity v2. Runtime checks pending.

[Scheduler workload observations](contracts/scheduler-workload-observations.md) replace drained-snapshot autotune learning with bounded run/mode/stage evidence and profile version 4. Obsolete profiles are rejected; current hard limits remain binding. Architecture reports require 1.1.0, and parser degradation requires typed current receipts. Runtime acceptance remains pending.

[Dependency retirements](archived/dependency-consumer-closeout-2026-11-05.md)
remove110 lock records and pass14 focused consumer controls, real Windows ripgrep/ast-grep, fresh native verification and43 gate fixtures. #672/#681 are closed after publication and GitHub readback.

[Sublime #1289](archived/sublime-native-closeout-2026-10-29.md) is closed;
remaining editor/platform acceptance stays excluded.

[Crash-log closeout](archived/crash-log-posix-qualification-2026-10-29.md) closes
#1315 with Windows and both POSIX cohorts. [GC resource fencing](archived/windows-cache-gc-resource-fence-2026-11-05.md)
repairs modern-session deletion. [Custom native cleanup](archived/windows-native-publication-closeout-2026-11-05.md)
passes164 focused controls and43 gate fixtures; #1574 is closed after publication/readback,
while broader lifecycle policy (#1267) remains.

The [November 5 queue](archived/open-issue-batches-2026-11-05.json) routes every captured issue; routing alone is not completion evidence. Work proceeds in this order:

1. Storage/publication lifetimes: #1574's actual SQLite/LMDB publication and eligible category cleanup are locally qualified, including cross-home readers, original native close and journal recovery. That batch is published and closed; finish lifecycle/quota policy (#1267) and related semantic publication work.
2. Dependency/parser cutovers: #672/#681's five-root retirement is qualified and closed. [JSDoc ownership](archived/javascript-documentation-closeout-2026-11-05.md) passes21 documentation cases, two declaration/replay controls and the import budget; #668 is closed after publication and GitHub readback. Remaining parser migrations require consumer parity rather than import-only checks.
3. Setup/tool providers and native operator services: managed acquisition, real executable identity, prerequisite readiness, cancellation and original resource retirement. Fixture commands remain explicitly trusted; real vendor qualification stays distinct.
4. Language/semantic consumers, retrieval and context evidence: review actual producers and semantic version owners, finish gaps together, then execute their bounded positive/negative fixtures. Historical implementation receipts are starting points, not current acceptance.
5. Performance/evaluation and shared product architecture: preserve correctness and authority controls before serial measurements. Distinguish budgets, work bounds and measured latency; keep raw samples and unchanged thresholds.

[Triage publication](archived/triage-publication-closeout-2026-11-05.md) closes #821 with21 coherence/source controls and restored ordered ownership. [Source retention](archived/source-retention-closeout-2026-11-05.md) and [sealed checksums](archived/sealed-checksum-closeout-2026-11-05.md) close #1240/#1234 with12/24 focused controls plus43 gate fixtures. Their receipts retain actual work reductions, independent integrity rejection and exact source identity.

[Physical filename closeout](archived/coverage-physical-filenames-closeout-2026-11-05.json) closes #1767 with original Ubuntu/macOS physical-consumer logs and matching source blobs; no WSL or replacement platform run was used. Tantivy/editor exclusions remain open under their existing owners. No broad local rerun is scheduled; repair and recheck affected failures.

[Historical re-checks](archived/windows-historical-rechecks-2026-10-24.md) and [failure repairs](archived/windows-failure-repairs-2026-10-24.md) retain their source identities; checkpoint 265 supersedes their counts. Gate B1-B7 acceptance follows the [rollout policy](specs/usr-core-rollout-release-migration.md). Linked native receipts retain fail-before and ten-process crash evidence; they do not qualify later implementation.

The published document security repair excludes DOCX deleted/moved-from text,
versions extraction and bundle reuse, and corrects UNC service-root authority.
Its focused checks/front gate passed. Existing indexes need a normal rebuild.

Continue on `codex/pr557-audit-repairs-20261012` through
[PR #572](https://github.com/doublemover/PairOfCleats/pull/572), retaining its
existing `main` base. Node is **26.13.0**. Publication is authorized; no merge is
authorized. Work continues solo. Frontload
implementation; defer functional execution until remaining in-scope code is complete. Formatting and static checks continue. Commit and push completed batches;
refresh the PR overview at least every 20 commits.

[Revision oracles](contracts/revision-oracle.md) (#1528) check finite revisions with typed v3 work receipts. [Finite views](contracts/selected-adjacency.md) (#1516) maintain selected supports, affected groups and role-ordered inner joins, with dense recomputation and retained alternatives. [Symbol expiry](contracts/symbol-cache-expiry.md) (#1187) uses a bounded heap. [Token estimates](contracts/embedding-token-estimation.md)/[preparation windows](contracts/embedding-preparation-windows.md) preserve original owners and admit tokenization. Broader adapters/runtime checks remain pending. [Native catalog](contracts/native-command-catalog.md) repairs CI2310 discovery.

Earlier embedding/cache, retrieval, TUI/LSP and resource-owner repairs await
current-source acceptance. The intake above owns remaining scope; current schemas
and producer constants own format identities.

### Execution order

1. **P0–P4 first**, prioritizing destructive authority/data-loss and lifecycle
   failures. Batch shared owners. Qualified security/native publication repairs
   retain their receipts above. [Lifecycle/quota planning](contracts/storage-quota-planning.md)
   (#1267) coordinates global/category/repo proposals, aliases and retention;
   category apply and Windows allocation/pressure remain pending.
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

Current-source runtime acceptance remains pending. The
[Windows receipt](archived/windows-post-wave-validation-2026-10-22.md) preserves
earlier failures, focused checks and source identities. Historical setup/native
verification does not qualify later implementation. After source integration,
verify current dependencies and affected controls. No Linux/WSL, elevation,
security changes, worktrees or arbitrary physical-link creation are included.

### Historical source chronology

The [archived source chronology](archived/roadmap-source-chronology-2026-10-25.md)
retains earlier owner repairs, versions and qualification gaps. Its implementation
claims remain distinct from current-source validation and accepted issue closure.

## Environment and qualification boundaries

Work is **Windows-only**; Linux/macOS execution is deferred. Do not launch WSL,
change machine security settings or register a machine-wide debugger. Current
Node is **26.13.0**, ABI 147, Windows x64. The
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

