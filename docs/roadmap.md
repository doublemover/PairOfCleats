# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-21
Last reconciled: 2026-10-22
Canonical for: initiative status, execution order, and remaining work

Current reconciliation, 2026-10-22: 957 open issues are being reconciled by
priority and shared owner; historical implementation and acceptance remain distinct.

## Current GitHub repair program

Continue on `codex/pr557-audit-repairs-20261012` through
[PR #572](https://github.com/doublemover/PairOfCleats/pull/572), targeting its
existing `main` base. The latest qualified production/test source checkpoint is
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`; publication is authorized and working.
No merge is authorized. Preserve granular commits and verify remote/PR identities.

The live inventory now contains **957 open issues (#584–#1540)**: P0 0, P1 52,
P2 448, P3 102, P4 0, Perf 102, and unprioritized 253. This includes 873 new
reports. The [current repair receipt](archived/github-issue-repairs-2026-10-21.md)
contains every issue and its disposition. The
[previous receipt](archived/github-issue-repairs-2026-10-20.md) records 77 earlier
implemented repairs and seven unfinished owners (#630–#632, #636–#637, #639–#640).
Those implementation claims are not blanket acceptance for the new inventory.

User order: **P0–P4 first, then Perf, then everything else**. Within a priority,
fix destructive authority/data-loss defects before downstream consumers; batch
shared transaction, lifecycle and schema owners. Priority-marked performance
issues keep their stated priority. Read each issue's actual scope and dependencies;
do not assume issue-number order or turn feature requests into duplicate engines.

### Execution order

1. Snapshot/diff registry authority, retention, GC dry runs and frozen-byte
   integrity (#686, #688, #778, #806, #811, #819, #832, #835). **Implemented;
   affected Windows checks and the complete front gate pass.**
2. Other P1 publication/rollback and state recovery, queue ownership, vector
   identity, worker shutdown and installable editor packages. Combine related
   P2 cases only where they share the repaired owner and regression setup.
   **In progress:** 23 additional repairs have focused proof and the complete
   front gate passes at f05fb0d4e. A further 33 storage/publication/cache/contract
   repairs have focused proof and the complete front gate passes at d4dcba413. Remaining
   watch/pointer/queue authority and editor-package owners continue next. Three
   Sol 6.1/xhigh agents now own independent storage/setup, semantic/indexing and
   retrieval/editor/map spans in real files. The lead owns shared integration,
   native/core work, validation, Git and publication. Research #1504 and above
   remains with the semantic owner. No worktree or elevation is required.
3. Remaining P2 correctness/contract issues, then P3, grouped by owner.
4. Perf reports: retain correctness parity and measure the changed operation;
   distinguish operation-count reductions from real latency/heap measurements.
5. Unprioritized work, including the structured-semantics dependency program;
   build foundations before dependent language/consumer integrations.
6. Final candidate-wide Windows discovery/cohort reconciliation and relevant
   qualification. Keep release/real-model/optional-backend claims separate.

The user's latest direction defers validation until the broad backlog development
pass is complete. The three agents and the lead edit real repository files and author
regressions without executing tests, syntax campaigns or formatting. Publish
completed owner groups as explicitly **unvalidated development checkpoints**;
these commits do not replace the last qualified source identified above. Recent source batches cover final response/risk
accounting, MCP domain errors, TUI bounded flow and event timing, architecture
detection, canonical map member/file inventory and editor generation-bound
risk requests. Recent source also shares bounded codec admission, repairs immutable syntax
occurrence handoff and bounds compiler construction with replay-safe identities.
The fidelity/occurrence checkpoint adds explicit admission, durable omission
receipts and bounded call-site spill; full semantic resume/capability sealing
remain open. Native log/review presentation, profile/reference caches and timestamp retention
now have source checkpoints; whole-app cache migration/quota and shared transform
mixed provider/semantic CPU wait boundaries remain open. Shared Stage1 transform sessions, parse descriptors, embedding token batches,
risk prefixes and editor HTTP/history/diagnostic projections now have further
source checkpoints; their regressions and runtime/measurement proof remain open. After
the development pass, prepare the changed dependency installation, establish
fail-before controls where required, run affected checks and the complete front
gate, then reconcile Windows cohorts. Do not run repeated broad suites,
raise deadlines, add retries or remove meaningful assertions to obtain green.
Update the durable receipt and PR summary with exact source/results after each
batch. An issue is not complete merely because code was changed or pushed.

Unvalidated development now includes watch/pointer and queue authority, complete
piece assembly, bounded artifact reads, chunk/source/SCM identities, import and
resource policy repairs, verified model installation/leases, request-pinned
retrieval/API lifetimes, canonical editor packages and semantic workflow replay.
TUI task state, Unicode framing, selection identity and width-aware review panes
also have source repairs and authored regressions. Scheduler hard admission,
observed tokenization evidence, bounded extraction, SCM/metadata authority, CLI
terminal outcomes, setup selection and generated USR contracts have development
checkpoints. A further 47 storage/index P3 reports have implementation mappings.
Editor request ownership, source/policy freshness, latest-search publication,
provider cancellation and TUI rejected-draft recovery now have source checkpoints.
Map paging/selection, relationship vocabularies, lazy detail admission, shared
endpoint matching, retained pipe geometry and frame-owned hover are implemented.
The final missed P2 service-progress owner now binds one claimed execution to its
persisted runtime evidence. Retrieval P3 handoffs add 36 mappings. Performance
implementation is active across serialization, workers, semantic row preparation,
inventories, retrieval, embeddings and dependency-safe bootstrap; measurements remain deferred.
A fresh inventory adds 163 reports. New P1 CI restore publication and pending-child
cache-lock ownership, plus 110 new P2 defects, precede remaining Perf work.
Language declaration/source spans, retrieval contracts, extraction and evaluation
continue across the three implementation owners; the lead integrates shared contracts.
There is no current-source deep-suite, native-host or performance claim.
The refreshed inventory adds ten Other research/features (#1531–#1540) and
expands modern viewer/semantic acceptance; prior source repairs retain credit
without implying those new requirements are satisfied. Storage/category, native,
editor, provisioning, bounded discovery and durable viewer preference releases
now have durable partial mappings. Shared sourceChunking6/compilerBindings18/lspBindings22, callFlow20, graphRelations1
and discoverySelection2/signature14 identify that producer meaning. The later
current source uses sourceChunking9/importResolution6/typeNormalization3,
compilerBindings19/lspBindings28/cfgFlow19/callFlow21.

Earlier source checkpoints through 0500f370a cover bounded SQLite/LMDB and vector
ingestion/finalizers, complete lexical reuse, selective BM25 hydration, immutable
coverage/artifact receipts, delegated opens and build-owned filter pages. Exact
retained graph pages reach CLI/API/MCP, provider evidence and source lenses;
graph spill/merge accounting and ordinal vector spooling have source owners.
Reviewed category/first-search plans, strict managed metadata and setup/download
lifetimes share explicit authority. Native jobs, subprocess input/error paths,
watch evidence, editor opens and map snapshot workers retain their actual owners.
Map exports/previews, cooperative search, terminal widths and reproducible fusion/
rerankers have authored controls. Research #1504–#1520 has internal slices.
The durable receipt preserves exact commits, mappings and limitations. All remain
unvalidated; public research integration, full provider onboarding, fine-grained
resume, generic migration, native service/editor/model hosts, generated freshness,
locked setup and representative resource/performance qualification remain open.

Source continuation through 77507752b retains original ONNX and outer embedding
cache entries after failed retirement. Explicit reconciliation targets the same
objects and captured cleanup methods; accepted work/startup and every live
reference drain first. Background pruning and finalizers do not retry recorded
native failures. Query/warmup preserve frozen primary and cleanup evidence.
Real rejected-native-release retry safety remains unqualified.

Shared storage sessions now capture original closure observers before settlement,
even without a true pending flag. Callback replacement and contradictory receipts
cannot erase them; unreadable evidence stays pending. Failed lease-record sealing
and descriptor close retain both exact causes without granting deletion authority.
Managed reuse, new publication, removal and outer admission retain every actual
metadata/reconciliation owner through later failures, preserving frozen causes and
unknown staging identities. Own producer-branded metadata failures may retry;
independent native observers stay required. No installation or user cleanup ran.

SQL consumers share effective lexical options and physical line ownership; R
argument extraction and registered relations preserve literal dependency bytes.
Python headers/local classes and parenthesized C/C++ prototypes retain their
actual lexical/declarator roles. sourceChunking9/importResolution6 retire changed
meaning. Immutable LSP request capture and atomic hierarchy-token admission use
lspBindings25; typeNormalization3/compilerBindings18/cfgFlow18/callFlow20 identify
that checkpoint. Prior map byte admission, sparse Python columns, Sublime source geometry
and retained lens/motif evidence keep their durable mappings and limitations.

Generic migration, fine-grained resume, independent source truth and actual
native/editor/browser/model/resource qualification remain open. All new source
and fixtures are unvalidated; no issue closure, current suite pass or measured
speedup is claimed. The durable receipt preserves exact commits and acceptance.

Further source through 7ebf32cb3 retains actual prepared-model components/tensors,
PDF destruction promises and accepted late work, migration descriptor/exclusion
owners, and exact Go SDK transaction identity. Frozen/falsey primary and secondary
failures remain reachable through the latest reconciliation error. Original
cache-writer closure observers gate lease invalidation independently of flags.
Legacy/latest crash state/events sinks fail independently of attempt-owned copies;
registry release errors preserve the operation failure. Map scene resources stay
owned after detachment, with both original scene/cache observations required.
LSP scalar/location/container admission and shared hierarchy budgets retire old
request entries with rq4/lspBindings28. Prototype-named argument maps use own
keys (callFlow21); class-property aliases remain conservative under checker
identity (compilerBindings19/cfgFlow19). These are unvalidated source contracts,
not native/GPU retry safety, full source-language completeness or performance
evidence. Real-model/host acceptance, generated freshness and setup remain open.

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
| Shared-module reduction | `coupling audit open` | Six ownership batches retain their backlog; current inventory omissions are reconciled explicitly. | Retain fixes for the October 18 direct/transitive import-budget failures without raising baselines; measure remaining startup/coupling work separately. |
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
