# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-07
Canonical for: initiative status, execution order, and remaining work

PairOfCleats' indexing, retrieval, tooling and integration surfaces are implemented.
The completion integration, dependency updates, CI repairs and scoped security fixes
have landed on main through [PR542](https://github.com/doublemover/PairOfCleats/pull/542),
commit `2529d718db780da22c49f188202b6f1550a1833d`. Its exact source tree passed the
hosted platform and gate checks before merge. Release-wide acceptance remains open.
Use this page for current status, the [October 7 evidence](guides/closeout-evidence-2026-10-07.md)
for revision-specific receipts and limits, the linked contracts for behavior, and
the archived worklogs for historical evidence. Hosted CI is bounded validation,
not release-wide readiness.

## Source-of-Truth Rules

1. `src/contracts/**`, validators and schemas define the supported data contracts.
2. Current source and executable tests establish implementation behavior.
3. Focused specs describe design and acceptance criteria when consistent with those contracts.
4. This roadmap owns current status. Supporting reviews do not create competing task queues.
5. Archived checklists describe their original checkpoint; unchecked historical boxes do not reopen work.

`implemented` describes code coverage, `checkpoint clean` describes a bounded recorded
review, and `deferred validation` means acceptance has not been established for the current
head. None is a blanket release-readiness claim.

## Semantic indexing implementation (2026-10-10)

Status: **in progress; compiler/value evidence, offline runtime import and durable
binding lifecycle integration** on `codex/semantic-indexing-20261010`, descended
from PR547 head `5d33a0a2c3d9e336bc64d85926a4afd0fef57118`. Astra MEDIUM leads
shared integration with the same two approved GPT-6.1 Sol MEDIUM helpers. No new
helpers, pushes, merges, captures, corpus restart or benchmark campaign.

Implemented with focused evidence:

- Source-owned JS/TS structure, exact UTF-16 coordinates, retained immutable source,
  ordered operands and separate chunk ownership. Inference views do not delete
  canonical facts. Portable per-file syntax cache sidecars and all three SQLite
  ingestion routes preserve canonical records.
- The existing grouped TypeScript Program/checker now emits immutable context-bound
  bindings, alias chains, external declarations, constructors and per-occurrence
  argument-to-parameter edges before heuristic resolution. Source hashes must match;
  one document node index replaces repeated target scans. Legacy type inference
  can remain disabled. Unresolved compiler bindings are not upgraded by name matching.
- A conservative value slice records immutable definitions, reads, lexical captures
  and structured packing. Checker-matched default-library models distinguish
  typed-array view/copy relationships and message dispatch/transfer requests.
  Local CFG and mutable reaching definitions are now retained; field-sensitive
  effects, dynamic realms and observed delivery remain explicitly incomplete.
- Sorted JSONL/offset query indexes and generation-pinned detail provide bounded
  record, argument, name and ownership hydration with artifact/SQLite parity.
  Artifact/SQLite trace parity and public CLI/MCP/HTTP integration pass focused checks.
  Query coverage retains partition provenance and separates extraction, analysis
  and response limits. See the [operating guide](guides/semantic-index.md).
- Explicit saved Inspector CPU-profile and versioned code-log interchange adapters
  publish immutable standalone runtime families with content-addressed raw inputs.
  Capture/runtime/build/workload identities, missing mappings and code lifetimes
  stay separate. Import never executes or attaches; arbitrary V8 text logs and
  independent runtime-to-source overlays are not yet supported.
- Source-pinned binding task descriptors use a dedicated transactional control DB,
  exact task leases and the existing relations scheduler. Manual/absent-control
  paths stay deferred; completion receipts are acknowledged after whole-generation
  promotion. Production fresh/warm builds and crash-recovery integration pass focused checks.
  Cached old-generation task descriptors cannot be silently relocated.

Current follow-on slice adds local CFG/reaching definitions and merge values, guarded
optional/nullish/switch paths, exceptional/finally routes and per-call return channels.
The virtual compiler host resolves retained repository imports to existing Program
SourceFiles, so renamed imports reach actual library declarations. Unsupported
heap/context/async effects remain partial. Targeted LSP locations and exact embedded
source/cache/ownership transport now persist evidence sidecars. Runtime family lookup
and bounded observation queries are exposed through CLI/MCP/HTTP (MCP schema 1.4.4).
Local/cross-file deferred descriptors survive control-store reopen.

Focused Node26 receipts: CFG 2.50s (`run-1791627361546-6m1mp9`), virtual imports
0.315s (`run-1791628134948-kuy2zh`), deferred lifecycle 1.87s
(`run-1791627719531-dh7z7i`), LSP 1.80s (`run-1791628089207-hgbpj2`), runtime
query/public/storage checks passed (`run-1791627901223-zhoakn`,
`run-1791628031363-6703ap`, `run-1791627695885-q29r54`). Production compiler
fresh/warm passes 12.823s and embedded fresh/warm passes 9.600s with fixture worker
pools explicitly disabled. These checks do not establish default-worker stability.

Native exit 3221225477 / 0xC0000005 recurred on both attempts in
`run-1791627691446-9vx75b` and embedded run `run-1791627866233-p1fldx`.
Parent-owned durable failure receipts now preserve exact runtime/executable, redacted
arguments, PID/times, raw status, output and last observed phase; focused receipt
fixture passes (`run-1791627501203-cee281`). The last observed marker was worker-pool
teardown; the cause remains unknown. A passing retry is not resolution.

The next integrated slice adds conservative allocation/field candidates with shared
const-alias identities, explicit getter/dynamic/depth frontiers, and finally return
suppression. Published local/cross-file task descriptors now reconstruct after control
DB loss; zero attempts perform no execution (three focused checks pass in
`run-1791628873221-bzv3md`). Saved-capture comparison and immutable derived-claim lookup pass 3/3 focused checks
(`run-1791629091229-6tjn5e`), with old lookup/MCP/recovery regressions 4/4 passing
(`run-1791628890722-cxk5te`). MCP is now 1.4.5. Comparisons require matching saved
identities and only describe source-location sample counts; no causal/rate or timing
equivalence claim is made. Literal source-resolved Worker entry/message-consumer links pass the actual Program
fixture (2.234s, `run-1791628938583-zqui9n`) and worker-disabled production publication
plus paginated artifact/SQLite trace parity (10.032s, temporary receipt
`temp/semantic-indexing/compiler-worker-production-validation-2/receipt.json`). Fake
platform names, dynamic entry URLs and direct shared/transferred payload counterexamples
remain explicit. The first production assertion failed by inspecting only one bounded
page; the corrected fixture drains opaque continuations and compares canonical evidence.
No default-worker retry was used. Final flow check passes 0.907s
(`run-1791628974873-ggpejl`). Final review corrected receiver boundary realm
direction; its explicit assertion passes 2.56s (`run-1791629291540-wfnu34`).
The revised CFG pass uses analysis version 2, preserving schema1 and invalidating
only its derived partition identity.

Artifact surface **0.1.0**, SQLite **15**, semantic schemas **1** remain the exact
cutover. The reader audit covers artifact/state/pointer/cache/bundle/SQLite paths,
metadata-only probes, worker propagation and public format diagnostics. SQLite
compaction preserves semantic tables in bounded batches; shared semantic-mode
compaction rejects explicitly pending safe multi-mode remapping. Full rebuilds use
a fresh current-format namespace without migration or deleting originals.

Node 26 focused receipts this span: compiler/alias/shadowing/parameter/capture/value
witness passes 8.29s (`.testLogs/run-1791625377755-qpzgph`); stale frontier cache
rejection passes 1.11s (`.testLogs/run-1791625486576-jaeghz`); cutover gate passes
1.55s (`.testLogs/run-1791625373735-wpze63`); semantic compaction parity passes
2.05s (`.testLogs/run-1791625477486-0dwxnt`); public format/detail errors pass 23.9s
(`.testLogs/run-1791624572615-fzhb4w`). The stricter production completion assertion
caught Windows path-case acknowledgment failure (`run-1791625737698-qt3i26`);
the corrected fresh/warm fixture passes 13.0s (`run-1791625932165-z9oiju`). A native access
violation (3221225477) recurred once in `run-1791624392362-it00uc`, then the runner
retry passed; the native fault remains undiagnosed. Final trace public surfaces pass 12.0s (`run-1791626223683-8ojsre`), and
indexed artifact/SQLite trace parity passes 5.48s (`run-1791626204277-az8do3`); runtime import
passes 4/4 (`run-1791624970201-cy7yks`), canonical import CLI passes
(`run-1791625972821-or578j`), and binding lifecycle/recovery passes 3/3
(`run-1791625965364-lckhod`). Prior MCP snapshots were intentionally updated to schema
1.4.3; both checks pass (`run-1791626136790-3xvdov`). Repository formatting and the
command surface audit pass. Broad suites remain unrun.

Code-first continuation after `7812f84a` (2026-10-10, **implemented but unqualified**):

- Cross-file return dependencies now use bounded monotone SCC summaries over existing
  local-flow records. Each call retains its own result value; trace state balances
  invocation and compiler-context crossings. Spread positions, iteration/work limits,
  unknown effects, exceptional contracts and incomplete local flow remain frontiers.
- Derived operation lookup has uncompressed sorted artifact/offset indexes and SQLite
  expression indexes, with exact syntax selectors and indexed target-candidate lookup.
  Bounded ordered structural comparisons and evidence explanations keep candidate
  similarity separate from binding identity or behavioral equivalence.
- Ordered language/path policy overrides, source-pinned target selectors, separated
  policy identities and shared semantic writer-byte admission are wired through extraction,
  compiler/LSP and deferred-work planning. Scheduling does not trim syntax facts.
- Plan/enqueue/manual-drain coordinator code uses the dedicated control store and the
  normal whole-generation build publisher. **Drain is blocked for existing source-only
  tasks:** their immutable descriptors do not seal complete compiler/config/module
  resolution dependencies. Do not execute or supersede those tasks as exact completion.
  The future verified drain route may rediscover/reparse source; targeted parse reuse
  is not implemented.
- Find, explain and enrichment schemas, services and standalone surface wrappers exist.
  Public catalog/router/command registration is deliberately pending parity qualification.
  Existing advertised semantic detail/trace surfaces are unchanged.

This span is code-first: `npm run format` passed; Node26 syntax checks passed for all
60 changed/new JavaScript files; schema and integration imports passed; `git diff
--check` passed. All four unrelated workflow file hashes were preserved. New
`indexing/semantic/call-summary-context` assertions and extended
`storage/semantic/trace-parity` discovery assertions are written but **not run**.
No production rebuild, native-crash investigation, broad fixture campaign, benchmark,
MCP/API qualification or full frozen-spec acceptance is claimed. Prior crash receipts
above remain unresolved. Qualification must precede advertising the new operations.

Remaining: complete field/context-sensitive CFG/SSA and SCC cross-file summaries,
broader Worker/process/async boundary and LSP/provider coverage; syntax/relation
walk fusion and pre-production resident admission; qualification of config overrides and targeted
policies; sealed compiler-dependency inventories and executable deferred analysis drains;
public discovery/explanation qualification, richer operation constraints/projections;
additional runtime inference/native log adapters and cross-generation runtime joins. Huge-file intra-file
partitioning/fairness is a later improvement, not a new gate. Independent overlays
remain outside v1. No claim of full frozen-spec completion; the temporary package
tracker records exact ownership, dependencies and focused receipts.

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch authority, native artifacts and bounded storage/download paths have regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate.. |
| Stage1 ordered throughput cutover | `implemented` | Ordered windows, commit cursors and no-gap recovery have targeted tests. | Refresh perf and memory budget tests in the release gate before release.. |
| Phase 10 interprocedural risk flows | `implemented` | Risk flows, validators and consumers retain capped/deduplicated results. | Run the affected risk and release acceptance lanes on the final release candidate.. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | Snapshot and IndexRef contracts include historical/cache-boundary corrections. | Refresh cross-platform and end-to-end snapshot acceptance before release.. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/chargram controls, ANN filtering and semantic constraints are implemented. | Measure representative search quality and optional native backends before release.. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas and conformance surfaces are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `checkpoint clean` | Six ownership batches retain their authoritative backlog and boundary checks. | No known shared-module implementation batch remains open. Reopen only for a concrete ownership, correctness or measured performance signal. |
| Duplicate-code reduction | `checkpoint clean` | The May refresh found no current fragments among 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling and bounded platform/security receipts remain revision-specific. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change.. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs remain preserved. | Keep new execution status here; label measurements with their exact revision and environment.. |

## Private-history usability follow-up

Progressive help, pinned evidence, privacy controls and local persistent semantics are implemented.
See [agent usability](guides/agent-tool-usability.md) and the archive gates below.
Exposed deployment isolation and approved archive evaluation remain separate.

## Canonical Next Queue

PR519 is merged and bugs #513-517 are closed with regression evidence. The
dependency/CI proposals through PR540 are merged or specifically superseded.
PR541 adds linear generated-import scanning, protected Windows structural-tool
invocation, confined tooling-cache persistence/pruning and Rust CodeQL compatibility.
PR542 restores a filesystem import lost during that migration and proves real
watched-file invalidation. The [exact-head run](https://github.com/doublemover/PairOfCleats/actions/runs/37642969134)
passes gate, Rust TUI, Ubuntu, macOS and Windows. The ordered lane has 887 entries;
the declared POSIX-signal skip remains explicit on Windows.

The parity report regression now seeds canonical artifacts and exercises real
SQLite construction, child report execution and memory/SQLite search. It does not
exercise the former cold full-index setup or diagnose its original EBUSY cleanup
failure. Preserve that distinct platform investigation below rather than calling
a fixture repair a production cleanup fix.

The [dependency migration](guides/dependency-security.md) and explicit worker
precedence are integrated. Better-sqlite3 13.0.3 has native runtime and source-recovery
compatibility coverage; Node24 policy remains. The isolated SQLite/Node26 comparison
`5faa768b` remains excluded. Mac arm64 interactive receipts retain their recorded
scope; broad final-native and real-project acceptance remains separate.

Historical `82528215` platform and lifecycle results remain in the
[integration checkpoint archive](archived/ordinary-integration-roadmap-2026-10-06.md).
They do not establish current integrated acceptance. Keep demonstrated failures
ahead of broader validation and retain historical measurements as dated evidence.

### Concrete Platform and Product Queue

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

### CLI, Setup and Generated-Artifact Acceptance

The [October 6 acceptance](guides/cli-acceptance-2026-10-06.md) and
[October 9 checkpoint](archived/archive-retrieval-checkpoint-2026-10-09.md) preserve
completed CLI/setup and generated-artifact receipts. Required trust, chunk identity,
output provenance, input failure preservation and explicit install authority remain.
Node24 and better-sqlite3 13.0.3 are current; the historical 887-entry lane is not a
current optional-backend or SDK acceptance claim. Keep no-ANN forwarding mandatory.
Remaining exact-member linkage, runtime state, reports/editor and native/package/TUI
families require current schema, checksum and searchable-report evidence. Final
snapshot recovery, dependency bootstrap, retrieval quality, watch readiness and
representative performance remain open; isolated measurements do not promote runtime.
### Ongoing Review and Release Discipline

1. **Preserve the verified integration lineage.** [PR519](https://github.com/doublemover/PairOfCleats/pull/519)
   and the subsequent closeout are merged. Older proposals retain specific
   supersession explanations and original ancestry. Start follow-on validation
   from the recorded integrated revision, determine each intended destination
   from the current task and lineage, and do not equate merge with release acceptance.
   See the [branch and capability review](branch-capability-review-2026-10-02.md)
   and [October 7 evidence](guides/closeout-evidence-2026-10-07.md).
2. **Maintain concrete lifecycle fixes.** Full-build diagnostic callback failures
   were reproduced against the frozen branch with a real one-chunk SQLite bundle:
   a failed checkpoint plus a throwing warning callback left the database open.
   Checkpoint/pragma warnings and the artifact clamping summary now cannot bypass
   finalization; genuine promotion/build failures retain their original errors.
   The finalization and prior startup-ownership fixtures pass locally. See the
   [bounded recovery and resource guide](guides/recovery-low-load-2026-10-03.md).
3. **Run release acceptance when scheduled.** Release-wide acceptance,
   optional-backend and measured-performance campaigns remain deferred. Follow the
   [release validation plan](roadmap-release-validation-plan.md); do not substitute
   historical logs or focused tests for its acceptance criteria.
4. **Maintain documentation from evidence.** Update the affected owner/spec and this
   queue when behavior changes. Keep completed command transcripts in historical
   records rather than appending them to active task lists.
5. **Keep the completed language/tooling audit distinct from acceptance.**
   The dated source/version audit covers all 39 registered routes, their parser/
   relation owners and upstream choices. Individual component fixtures and later
   bounded live-client/parser corrections are recorded. Framework overlays and
   tooling-only languages remain separate; metadata, installed components and
   tiny client fixtures do not establish complete SDK/project/platform acceptance.
6. **Continue optional toolchain acceptance after the current handoff.** Remaining
   SDK/server choices and richer project cases stay at the bottom of the queue.
   Install/test one compatible toolchain at a time on small repositories, using
   the low-load profile with embeddings and model downloads disabled. Record exact
   versions, provenance, observed capabilities and unrun limits.
   The [individual acceptance record](guides/language-toolchain-acceptance.md)
   distinguishes syntax/registry fixtures from full SDK/server/project acceptance.
   Preserve exact launch-owned authority before build-capable Rust/Java/Zig
   probes or workspace execution. Native Rust/Java AST remains available without
   that grant; Zig is tooling-only. Archived parser details are historical proof.

## Current Validation Boundary

Current reconciliation, 2026-10-07: the completion pass and follow-on corrections
cover graph, semantic retrieval, configuration, embeddings, metadata/risk,
LSP/JSON-RPC, IndexRef, cache, SQLite, HTTP and runner contracts. The integrated
887-entry `ci-lite` lane has exact-head platform receipts. The
[capability review](branch-capability-review-2026-10-02.md) names the affected
earlier regressions; the [October 7 evidence](guides/closeout-evidence-2026-10-07.md)
records subsequent fixes, hosted analyses and explicit residual limits.

Dependency evidence includes the recorded JavaScript remediation, native grammar
activation, q8/ONNX inference and RustSec/toolchain checks. See
[dependency security](guides/dependency-security.md). An audit snapshot is dated
proof, and does not certify future advisories or close hosted alerts by itself.

The earlier interrupted `ci-lite` run remains an incomplete historical run in
the [integration checkpoint archive](archived/ordinary-integration-roadmap-2026-10-06.md).
New exact-head lane receipts do not rewrite that history. Interactive TUI behavior,
optional native platforms, a fresh full duplicate audit and representative
end-to-end performance measurements remain separate checks.

May 20â€“22 validation and USR Gate A/B/C statements are historical checkpoint
records. The Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls remain the acceptance surface;
their old green results have not been relabeled as fresh proof on this head.
Missing historical logs remain unavailable rather than reconstructed.
USR rollout phases Aâ€“H and lifecycle acceptance remain in the
[rollout and release migration policy](specs/usr-core-rollout-release-migration.md).

## Ownership and Historical Records

- [Shared-module ownership and closed batches](tooling/shared-module-reductions/432-prioritized-implementation-backlog.md)
- [Duplicate audit status and refresh policy](tooling/duplication-reduction-status.md)
- [Checklist rules](guides/roadmap-checklists.md)
- [Branch/capability review and focused evidence](branch-capability-review-2026-10-02.md)
- [Historical roadmap and full worklog](archived/roadmap.md)
- [Historical release-evidence record](roadmap-release-validation-evidence-20260521.md)
- [Earlier task-list reconciliation](archived/task-list-reconciliation-2026-10-02.md)

The archived roadmap preserves the previous authored text byte-for-byte, including
its completed lanes, abandoned/no-adopt migrations, command outcomes and evidence
citations. The active page carries their current disposition rather than another
copy of the transcript.

## Validation Commands

For documentation/status changes, use focused contracts and local link checks:

```powershell
node tests/run.js tooling/docs/contract-matrix tooling/docs/usr-contract-checklists ci/markdown-link-check --lane=all --jobs 1 --timeout-ms 30000
node tools/docs/generated-surfaces.js --check-freshness
git diff --check
```

Choose only affected checks and respect the execution environment's resource
budget. Do not run a full index build, release campaign or duplicate scan merely
to update a status page. Reproduce behavioral failures with small fixtures before
expanding validation.

## Archive retrieval and CPU qualification - 2026-10-09

Completed work and original receipts: [October 9 checkpoint](archived/archive-retrieval-checkpoint-2026-10-09.md),
[CPU trial](guides/eg2-representative-cpu-trial-20261009.md) and [current archive policy/gates](guides/archive-pipeline-integration-20261009.md).
The old corpus job stays stopped; authorized cleanup removed legacy derived vectors,
preserving original DATs/source units. Old throughput/ETA applies to the old policy.
Frozen diagnostic v3 plan: 422,794 inputs / 135,924,462 tokens; 24 large-source checks pass.

Remaining ordered gates:

1. Bounded source-plan reuse and seven no-model checks passed. SCIP definition/reference
   classification is corrected with independent role flags and focused mask/count tests.
2. One current Kingfisher CPU benchmark passed in 8m23s with real dictionaries and valid
   persisted 384-dimensional vectors. Declared natural-sentence sparse-only queries had
   zero target recall under documented implicit AND; semantic retrieval remains unmeasured.
   [Exact verification and limits](guides/kingfisher-cpu-verification-20261009.md).
3. Fresh archive import/reopen/original guards passed: 87,973 records, zero gaps and
   1,675,434 effective words. Exact current plan: 422,836 inputs / 135,932,568 tokens.
   Current-policy native qualification passed admission, finite normalized vectors and durable replay; semantic source recall@10=1, anchor recall@10=0.875 under the unit-citation contract.
   Measured 270.8 useful tokens/s; approximate full-token extrapolation 139.4h is uncertain.
   First bounded slice persisted 100 units / 555 vectors; read-only reopen passed after a reporting-heartbeat failure. Ranking/citation selection limits product quality; CPU only.
4. [Acceleration and selective-embedding experiment](guides/archive-selective-embedding-20261009.md): native inference is 95.4% of wall; source/input/anchor ranking misses are diagnosed. Statement/copy fixes pass. A bounded 297-input /49,997-token held-out slice completed; expanded lexical + selected fusion anchor recall@10 is 0.667 versus lexical 0.583, cheap graph adds no gain. Existing guarded context recovers the secondary wrong-span anchor; primary candidate-ranking miss remains. Full corpus remains stopped at 100 units /555 vectors; selector is not activated.
5. Qualify numerical/relevance/kernel dispatch before graph promotion. W8 is not promoted.
   Search scaling, output-copy/statement reuse and parent-death lifetime retain the detailed
   acceptance gates in the linked checkpoint; alternative engines remain research.

No GPU, arbitrary installs or unrelated measurements are implied. PR547 publication is
approved; merge remains unapproved. Hosted results apply to exact heads.

## Viewer replacement after embedding qualification - 2026-10-09

The owner requests new visuals, interactions and renderer implementation. Keep this
behind the current Swift/archive embedding setup. Compare fresh Three.js with custom
WebGL2 on representative measured cases before backend selection. Address actual
semantic shapes/stacking, selective directed edges, semantic zoom, scalable graph tiles,
and the supplied truncation/aggregate/shape and geometry/fog/disposal findings.
[Deferred viewer queue](guides/viewer-replacement-queue-20261009.md) preserves the source
plan and acceptance boundary. Defuddle remains optional future offline HTML cleanup;
no dependency or network fallback is added now.
