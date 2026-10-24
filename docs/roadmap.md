# PairOfCleats Roadmap

Status: Windows validation in progress; solo issue repairs
Last audited: 2026-10-23
Last reconciled: 2026-10-23
Canonical for: initiative status, execution order, and remaining work

## Current GitHub repair program

Current reconciliation, 2026-10-23: after source commit `d256540ac`, the user
requested a full Windows validation pass and failure repairs before more backlog
implementation. Workers remain parked. The [current validation receipt](archived/windows-solo-validation-2026-10-23.md)
separates current observations from older qualified sources. Both 60-case CLI
cohorts passed at `a11b64278`; API failures exposed module-call ownership, report
qualification and publication-seal defects. The repair tree remains unqualified;
the frozen pass reproduced a parser-worker access violation. CDB identified a
Node-API finalizer callback reading its freed environment. A supported async
cleanup handle now preserves that lifetime; the preserved old binding fails
cancellation, while ten fresh-process cases and the exposing fixture pass.
Complete locked setup, remaining failure repairs and portable coverage in mixed
link wrappers precede a new candidate freeze.

Continue on `codex/pr557-audit-repairs-20261012` through
[PR #572](https://github.com/doublemover/PairOfCleats/pull/572), retaining its
existing `main` base. Node is **26.12.1**. Publication is authorized; no merge is
authorized. The user resumed work **solo**, with all workers parked, and requested
source implementation first, then explicitly switched to validation after the
next commit. Formatting and static checks continue before granular commits. Commit and push completed batches;
refresh the PR overview at least every 20 commits.

The refreshed snapshot contains **1,151 open reports (#147–#1722)**: P0 0,
P1 58, P2 574, P3 105, P4 0, Perf 125, and other/unprioritized 289.
Compared with the previous 970-report snapshot this adds 181 reports, including
12 older/reopened reports. Titles supply priority; labels do not supply those
priorities. The [solo repair receipt](archived/solo-issue-repairs-2026-10-23.md)
records this delta, reviewed scopes, source checkpoints and unfinished owners.
The [prior comprehensive receipt](archived/github-issue-repairs-2026-10-21.md)
and [pause handoff](archived/implementation-pause-2026-10-23.md) retain the
previous wave's detailed mappings and provenance. Open status, source changes
and accepted issue closure are separate facts.

Recent solo source batches repair exact embedding/cache identities, sparse Boolean
completion and execution-qualified result reuse, offsets/bitmap/signed ranking,
transactional TUI installation, document/wire/lease/method LSP lifetimes, and
original SQLite/profile/native-read failure propagation. The refreshed GitHub
snapshot still has 1,151 open reports. These implementations and their authored
regressions remain unqualified; category cleanup/parent drain and the broader
intake remain unfinished. LSP identity is 46/rq11; offline runtime parser is 4.

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
   front gate, then freeze the candidate for explicit Windows cohorts. Preserve
   original assertions, 30-second limits, zero retries and native redo disabled.

The current solo batches have only scoped `npm run format` and Git whitespace
checks. Authored regressions are **unrun**. No current-head deep-suite pass, issue
closure or measured speedup is claimed. The latest qualified production/test source
remains `d4dcba4134f6103e3a59703d90fdbde5ca54d09e`. Historical locked setup passed
37 required packages/33 routes without warnings/errors; it is not new final-head
runtime evidence. At frozen `245be5fc2`, 70 broad cases produced 60 passes,
9 failures and 1 timeout; a subsequent focused selection produced 11 passes and
3 wrapper timeouts. Source repairs followed and await execution. The
[Windows receipt](archived/windows-post-wave-validation-2026-10-22.md) preserves
exact-source results. No Linux/WSL, elevation, security changes, worktrees or
arbitrary physical-link creation are included.

### Earlier source chronology and unresolved qualification

Current wave after `ae324aeeb` repairs watch/pointer and queue authority,
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
moduleExports3/recordsProducer6/sourceChunking21/importResolution15/pieceAssembly3/typeNormalization11/compilerBindings23/
lspBindings46/rq11/cfgFlow28/callFlow47/valueSlice10/boundaryFlow12/workerFlow11. VSCode and Sublime retain
original opened-file/URI/request identity through deferred native selection.
Proto/SemanticDB/ShellCheck report adapters are3 and SCIP importer is5; the other
five report adapters remain2.

The rollout gate now requires explicit coherent benchmark counts and diagnostic
parity, rejects empty/unsupported evidence and keeps unknown timing deltas null
(#683). Original delta/parity assertions remain; impossible smoke counts were
corrected with new authored negative/roundtrip controls, all unrun.

Remaining qualification includes full language/provider/research integration,
generic migration/fine-grained resume, actual native/editor/browser/model/IPC
hosts, source-specific fail-before/after controls, locked setup, generated
inventory/freshness, format/front gate and final Windows cohorts. The lead now works alone; all earlier workers remain parked. Unreleased edits are excluded; no new issue closure, deep pass or
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

