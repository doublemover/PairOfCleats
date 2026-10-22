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

Latest source continuation: `f676316c5` retains failed SQLite cache handles,
finalizes eval resources before reports, pins original Sublime requests, separates
erased compiler syntax and bounds LSP selections/common source-linked reports.
Dispositions: 141 historical, 555 source, 163 partial, 98 pending.
All authored checks remain unvalidated.

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

Current source through `f676316c5` repairs watch/pointer and queue authority,
immutable publication and piece assembly, bounded artifact/SCM/source identities,
verified model installation/leases, request-pinned retrieval and canonical editor
workflows. Native TUI state, Unicode framing, selection/review, setup/service and
replay/catalog slices retain explicit operational gaps. The durable issue receipt
owns detailed source chronology and per-report mappings, including the 47 storage/
index P3 and 36 retrieval P3 groups; these are implementation, not acceptance counts.

Shared scheduler/transform sessions, ordinal vector spools, bounded codec/token/
semantic row preparation, sealed filter/graph pages and conservative source/replay
contracts retain content and quota authority. Research #1504-#1523 has internal
partial slices; later research remains dependency-ordered. Source operation
reductions are separate from measured latency, memory and quality improvements.

Original native/model, PDF, FileHandle/Dir, response and managed owners retain
methods, receivers and independent observations through cleanup and recovery.
Pending work survives false advisory flags, replaced callbacks and completed
bounded waits. Queue/shard retries cannot start around retained PDF/native work.
Canonical database commands drain admitted use before original closes; unknown
handles remain retained. Registry closes share one flight. Scheduler evidence is
admitted before presentation. Runtime unwind and receipt persistence preserve
falsey failure presence, frozen causes and exact category ownership. Replay cleanup
failures cannot skip later logger closure; async progress rejection stays observed.

Generic lock publication now retains its original descriptor through explicit
sealed rollback. Post-open failure cannot restart acquisition. The guard is
process-local and lexical; durable cross-process/physical-alias and atomic unlink
qualification remain open. Actual Zip/Tar/Tar.gz descriptors and admitted entry work now retain original
close prerequisites and private nested recovery through their installer consumers.
Actual renderer generations fence module/environment/scene awaits; captured
returned resources survive partial construction, shadow detachment and listener
registration failure. Source fallback cannot adopt a newer scene. Inaccessible
constructor allocations, post-install work and native/GPU retry safety remain open.

Actual JS/TS comment boundaries, quoted parameter/generic values, Go tags,
Unicode type roots and own parameter/argument names reach parser/cache/public
consumers. Complete source-checked semantic tokens and iterative symbols preserve
source authority. Accessor calls distinguish reads/writes/deletion; computed keys
retain evaluation/conversion order and creation-context captures. Current versions:
sourceChunking11/importResolution7/typeNormalization6/compilerBindings21/
lspBindings40/rq10/cfgFlow25/callFlow25/valueSlice9. VSCode and Sublime retain
original opened-file/URI/request identity through deferred native selection.

The rollout gate now requires explicit coherent benchmark counts and diagnostic
parity, rejects empty/unsupported evidence and keeps unknown timing deltas null
(#683). Original delta/parity assertions remain; impossible smoke counts were
corrected with new authored negative/roundtrip controls, all unrun.

Remaining qualification includes full language/provider/research integration,
generic migration/fine-grained resume, actual native/editor/browser/model/IPC
hosts, source-specific fail-before/after controls, locked setup, generated
inventory/freshness, format/front gate and final Windows cohorts. Three Sol6.1/
xhigh agents continue independent real-file spans while the lead owns Git and
publication. Unreleased edits are excluded; no new issue closure, deep pass or
measured speedup is claimed.

Current development also preserves actual Lua/archive/lock and receipt cleanup
owners, source-bound Python preparation, bounded raw-directory reuse and original
map/editor continuation evidence. Direct vector fill removes one row allocation;
IPC/native copies and whole-process memory/performance proof remain open (#1216).
Complete literal envelopes and retained LSP handoffs have new semantic versions.
Existing evidence/report bounds now charge before encoded expansion; selection,
aggregate, transport and downstream memory remain partial. Bounded final symbol
rows reuse fitting bytes through sizing/output (#1363 partial). All detailed
chronology and limits live in the archived receipt. Authored controls remain unrun.


SQLite cache failure no longer becomes confirmed close or a lost eviction scope;
original work/leases gate exact cleanup, and evaluation finalizes resources before
publishing metrics. Compiler type-only syntax stays out of runtime consumers.
Original editor views and map callbacks retain authority across delayed/reentrant
work. These authored controls remain unrun; real host/native qualification stays open.

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

