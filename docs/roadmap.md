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

## Current Initiatives

| Initiative | Status | Done now | Remaining / next |
| --- | --- | --- | --- |
| Execution, storage and download authority | `implemented; focused validation` | Launch-owned configuration, editor execution/credential gates, pinned TUI companion paths, bounded worker pools, native-artifact provenance, download transactions and descriptor-backed reads are covered by synthetic regressions. | Preserve the explicit authority boundaries in the [guide](guides/execution-authority.md); native TUI and non-Linux platform acceptance remain separate. |
| Stage1 ordered throughput cutover | `implemented` | Contiguous window planning, commit cursor ordering, no-gap-recovery assertions and targeted Stage1 tests are present. | Refresh perf and memory budget tests in the release gate before release. |
| Phase 10 interprocedural risk flows | `implemented` | Risk summaries/flows/call-sites, validators and consumers are implemented; the completion pass fixes capped results, source deduplication and zero-confidence handling. | Run the affected risk and release acceptance lanes on the final release candidate. |
| Phase 14 IndexRefs, snapshots, diffs, and as-of retrieval | `implemented` | IndexRefs, snapshot/diff tools and API routes are present; cache-boundary checks and historical LMDB/HNSW resolution are corrected. | Refresh cross-platform and end-to-end snapshot acceptance before release. |
| Lexicon, relation boosts, chargram enrichment, and ANN candidate safety | `implemented` | Lexicon/relation/chargram surfaces and ANN filtering exist; semantic-query constraints and Tantivy filtered overfetch have focused regression coverage. | Measure representative search quality and optional native backends before release. |
| USR consolidated contract and rollout program | `implemented` | Language/framework matrices, canonical schemas, validators and the full-language conformance surface are present. | Refresh technical acceptance; the former approval-lock process is archived and is not a release blocker. |
| Shared-module reduction | `checkpoint clean` | Six recorded ownership batches are complete or checkpoint clean; their machine-readable backlog and boundary tests remain authoritative. | No known shared-module implementation batch remains open. Reopen only for a concrete ownership, correctness or measured performance signal. |
| Duplicate-code reduction | `checkpoint clean` | The May saved-report exact-current refresh found no still-current fragments among its 212 saved candidates. | A future intentional full audit refresh, not ad hoc rework of stale saved-report entries, establishes a new repository-wide baseline. |
| Production readiness | `deferred validation` | Release tooling, schemas and workflow contracts exist; bounded platform CI and the dependency/security closeout are recorded. | Run production verification and release-readiness evidence against the final candidate; later security changes require their own merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, fixture expectations, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs are retained. | Keep new execution status here; label measurements with their exact revision and environment. |

## Private-history usability follow-up

Implemented with synthetic checks: progressive help, generation-pinned evidence/context, lexical relaxation, incremental local semantic fusion/reranking, acknowledged audit and escaped human owner privacy controls. See [agent tool usability](guides/agent-tool-usability.md).

Pending: actual semantic index and human console integration, process-level audit protection and approved archive evaluation. No private embedding run or new deployment is claimed.

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

The [October 6 record](guides/cli-acceptance-2026-10-06.md) preserves the 58-route
CLI/setup/service acceptance, strict option controls, subprocess cleanup and
staged ingest output preservation. Input/dependency/producer failures retain old
output and summary; successful publication is not a crash-atomic two-file transaction.
Closed setup input reports an actionable error; explicit strict search remains opt-in.

Optional-tool degradation produces one bounded, deduplicated summary per pass,
with redacted provider details in the application-owned default cache. The integrated
source retains 48 underlying checks and a healthy contribution; current hosted
lane receipts are linked above. Trust, chunk identity and required output contracts remain strict. No
tool install/upgrade or generic automatic binary fallback is enabled.

The current ordered CI-lite manifest has 887 entries, preserving the earlier
prefix and additions. Platform receipts identify pass and declared-skip counts
for their exact revision; they do not establish every optional backend or SDK.
The no-ANN forwarding regression remains mandatory. Node24 is retained and
better-sqlite3 is 13.0.3; older 827/837-entry and SQLite 12.6.2 statements describe
historical checkpoints only.

Map/core/cache classification follows the [ownership contract](guides/generated-artifact-ownership.md),
[core contract](guides/generated-core-artifact-metadata.md) and
[object-cache contract](guides/generated-object-cache-metadata.md). Fifteen audited
object/runtime families carry first-field provenance. Explicit record roots/globs
win; malformed/unrecognized input remains indexable. Ordinary paths add no marker
I/O; renamed admission uses the existing content read. Bounded prefix validation,
legacy cache reads, keys/TTL/health, complete payloads and streaming byte caps are
preserved. Native descendants are not excluded by manifest claims.

Remaining artifact batches cover exact-member linkage, remaining runtime state,
reports/editor output and native/package/TUI surfaces. Preserve schemas, JSONL/array
shapes, checksums and useful searchable reports. The [Mac checklist](guides/mac-acceptance-2026-10-06.md)
and [archived checkpoints](archived/ordinary-integration-roadmap-2026-10-06.md) are
historical plans/results. Final native, snapshot recovery, dependency bootstrap,
retrieval quality, watch readiness and representative performance require current
evidence; isolated SQLite/Node26 measurements do not authorize runtime promotion.

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

## Retrieval improvement queue (October 9, 2026)

Extend the existing retrieval and archive paths in this order. Keep completed local archive persistence, citations, chunk context, declared relationships, original bytes and CLI behavior.

- [x] Preserve SQLite BM25 postings through weighted fallback and report actual field capability.
- [x] Retain ordered literal phrase evidence and apply sparse Boolean eligibility before top-N.
- [x] Reserve embedding writer count and encoded-byte capacity before yielding; release after settlement.
- [x] Reuse checksums from committed packed artifact bytes.
- [x] Rank/filter archive candidates before caps; add generation-bound continuation and generation-cached coverage.
- [x] Build/maintain/route optional Porter and trigram FTS tables, retain omitted-limit defaults, push large selective allowlists into SQLite, and report executed tokenizer identity.
- [ ] Complete stage-level reuse for lexical/enrichment/embedding changes. Separate dependency identities are implemented; batch/scheduling and blame-disabled HEAD changes retain bundles, and output-only changes rebuild artifacts without reparsing.
- [x] Feed cross-file embedding microbatches concurrently with count/byte admission bounds; build HNSW afterward from canonical chunk-ID slots without an additional reorder buffer.
- [x] Batch live per-file/global vector-cache I/O; budget actual encoded/shard/index bytes; compact registered shards within an I/O budget and prevent stale worker pointer resurrection.
- [x] Discover independent sparse/vector hybrid candidates by default; apply structured, phrase, exclusion and explicit Boolean eligibility before ANN top-N. Expose explicit lexical reranking through --ann-candidates lexical-rerank.
- [x] Route before resolving lazy query embeddings; reuse bounded normalized query/model/provider/generation embedding entries across sessions and provider health/preflight state for each cached index generation.
- [x] Use shared Unicode/ICU-versioned scoring boundaries for index and query; preserve complete Unicode identifiers and ASCII identifier splits. Canonically normalize literal phrase evidence; analyzer changes require rebuilding affected indexes.
- [ ] Add modest evidence diversity, an optional real reranker and honest federated rank labels.
- [ ] Map fast/hybrid/investigate controls to execution; preserve identity/span/followup fields in compact output.
- [ ] Add archive-native title/path/facet discovery, original grouping and role-aware context presets. Scalable persistent semantics and selective media enrichment remain conditional on supplied adapters and explicit use.

Use focused behavioral checks for each slice. No hosted CI wait, historical comparison campaign, model download or new local access/audit layer is required. The original conversation transfer remains a separate input blocker for real conversation/artifact examples; it does not block generic changes or DAT retrieval.
