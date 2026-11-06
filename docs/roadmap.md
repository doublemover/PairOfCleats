# PairOfCleats Roadmap

Status: all open issues in scope except Tantivy/editor work
Last audited: 2026-11-05
Last reconciled: 2026-11-05
Canonical for: initiative status, execution order, and remaining work

## Current GitHub repair program

The [complete open-issue intake](archived/open-issue-batches-2026-11-05.json) captures367 reports, with14 verified closures (#1767/#672/#681/#668/#1574/#821/#1240/#1234/#1634/#1255/#1204/#1252/#1242/#1212). **353 remain open**. Thirteen editor/Tantivy-only reports are excluded; four mixed issues retain their non-editor scope. Detailed closure receipts and prior dated counts remain archived.

P2/P3 has **337 qualified closures /two editor-remainder targets /one deferred native target /six editor exclusions** from346 reports. The broader remaining backlog is now in scope. Work continues solo on Windows: implement related owner repairs, then run affected controls.

[Native parity](archived/windows-onnx-runtime-parity-2026-10-30.md) records CDB attribution and ORT1.30.0. [Models](archived/windows-model-closeout-2026-11-04.md) close #1542/#1544; drain/projection close #1484. [Windows terminals](archived/windows-terminal-budget-repair-2026-11-04.md) pass70 cases. [SQLite](archived/windows-sqlite-final-qualification-2026-11-04.md) passes324 children and closes #1733.

[Tantivy build settlement](archived/windows-tantivy-build-settlement-2026-11-04.md) repairs original dispatch/result observations before activation and failure unwind; build identity2 rejects earlier meaning. [Native Tantivy qualification is deferred by user decision](archived/windows-tantivy-native-deferral-2026-11-04.json); #1627 remains open and experimental.

Completed source-bound checks are indexed in the
[qualification archive](archived/native-runtime-qualification-index-2026-10-27.md)
and [qualification matrix](testing/qualification-matrix.md).

[Windows campaign receipts](archived/windows-full-validation-checkpoint-265-2026-10-28.md)
and [focused repairs](archived/windows-comment-and-handoff-failure-repairs-2026-10-28.md)
retain original failures and source identities. No new full-suite run is scheduled.

[Recent source-bound qualifications](archived/repair-qualification-summary-2026-11-05.md) and the qualification matrix retain completed native, dependency, compiler, validation, health, risk and runtime-reuse receipts. Native workspace/status pass CI2176; [published search](archived/native-published-search-investigation-2026-11-05.json) retains an unresolved full-seed budget failure. [Managed allocation](archived/managed-install-destination-repairs-2026-11-05.md) repairs alias/default-budget identity; #1559 still needs qualified package closures and build allowances. [Capped reads](archived/capped-reader-lifecycle-repairs-2026-11-05.md) repair original open/close ownership; #1330 remains partial. CI2181 adds a discard-frame race and an unexplained settings-child timeout. [Semantic encoding](archived/semantic-encoding-closeout-2026-11-05.md) qualifies #1212 across partitions and query/operation indexes:68 affected cases,48 serial samples; published/closed at5f0e2cca7.

[Semantic lifetimes](contracts/semantic-scheduler-wait-ownership.md) retain original close/work and cleanup observations; #1214/#1330 remain open. Runtime checks stay deferred until implementation is complete. [Saved-runtime discovery](contracts/runtime-family-catalog.md) now uses a bounded snapshot catalog; #1618 awaits runtime and serial cost qualification. Lint/static maintenance continue.

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

Current reconciliation, 2026-11-05: the full baseline is complete; shared-failure
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
existing `main` base. Node is **26.13.0**. Publication is authorized; no merge is
authorized. Work continues solo. Frontload
implementation and defer functional execution until each related batch is ready. Formatting and static checks continue. Commit and push completed batches;
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

