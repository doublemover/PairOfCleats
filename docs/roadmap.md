# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-03
Canonical for: initiative status, execution order, and remaining work

PairOfCleats' indexing, retrieval, tooling and integration surfaces are implemented.
The current completion branch adds targeted correctness, dependency and resource-lifecycle
fixes, and reconciles older branches by behavior. Release-wide acceptance remains open.
Use this page for the next action, the linked contracts for behavior, and the archived
worklogs for historical evidence.

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
| Production readiness | `deferred validation` | Release tooling, schemas and workflow contracts exist; focused fixes and dependency checks are recorded. | Run production verification and release-readiness evidence against the final candidate. Hosted security closure requires merge and rescan. |
| Phase 0.5 language/framework execution contract | `implemented` | Capability matrices, fixture expectations, language adapters and executable conformance lanes are present. | Preserve the contract and rerun affected language/tooling acceptance when those owners change. |
| Worklogs and benchmark JSON under `docs/worklogs/**` | `historical evidence` | Historical measurements and authored worklogs are retained. | Keep new execution status here; label measurements with their exact revision and environment. |

## Canonical Next Queue

1. **Maintain the consolidated draft review.** The completion branch is published in
   [draft PR519](https://github.com/doublemover/PairOfCleats/pull/519). The seven older
   reviewed proposals were closed with specific approved supersession explanations;
   original branches remain preserved. Keep the draft summary current without
   treating publication or focused checks as merge/release acceptance. See the
   [branch and capability review](branch-capability-review-2026-10-02.md).
2. **Maintain concrete lifecycle fixes.** Full-build diagnostic callback failures
   were reproduced against the frozen branch with a real one-chunk SQLite bundle:
   a failed checkpoint plus a throwing warning callback left the database open.
   Checkpoint/pragma warnings and the artifact clamping summary now cannot bypass
   finalization; genuine promotion/build failures retain their original errors.
   The finalization and prior startup-ownership fixtures pass locally. See the
   [bounded recovery and resource guide](guides/recovery-low-load-2026-10-03.md).
3. **Run release acceptance when scheduled.** Broad gate/CI, platform, hosted security,
   optional-backend and measured-performance campaigns are deferred. Follow the
   [release validation plan](roadmap-release-validation-plan.md); do not substitute
   historical logs or focused tests for its acceptance criteria.
4. **Maintain documentation from evidence.** Update the affected owner/spec and this
   queue when behavior changes. Keep completed command transcripts in historical
   records rather than appending them to active task lists.
5. **Audit every supported language's tooling.** Compare all 39 registered routes,
   their actual parser/relation owners, dependency declarations and lock versions
   with current stable upstream tools. Keep framework/format and tooling-only
   coverage explicit. Evaluate replacements against required compiler APIs,
   grammar ABI, LSP capabilities, maintenance and resource cost before adoption.
6. **Last: trial individual toolchains on small repositories.** Only after the
   preceding implementation/review and version audit, install and test one
   compatible toolchain at a time. Use the low-load profile, omit embeddings and
   model downloads, and record the exact version, fixture and accepted capabilities.
   The [individual acceptance record](guides/language-toolchain-acceptance.md)
   includes bounded syntax-owner corrections for Dockerfile, GraphQL, Handlebars,
   Protobuf and Mustache, distinct heuristic Jinja/Django boundaries, plus
   explicit JSONC syntax/strict-JSON compatibility and exact-component registry
   setup evidence. Their focused fixtures do not replace compiler/runtime,
   full-index or platform acceptance.
   It also covers the C# synchronous-loader update and Groovy's explicit partial
   coverage; these parser checks do not establish language-server acceptance.
   Verified installed Rust, ZLS/Zig or Java/JDT tooling does not grant workspace
   execution: use the exact launch-owned repository authority boundary before
   their LSP/probe/preflight acceptance. Native Rust/Java AST analysis remains
   available without that grant; Zig currently has no native parser route.
   ZLS/Zig workspace tooling has the same boundary because package/include
   resolution can execute its build runner. Zig is currently tooling-only.

## Current Validation Boundary

Current reconciliation, 2026-10-02: the completion pass verified focused graph,
semantic retrieval, configuration, embeddings, metadata/risk, LSP/JSON-RPC,
IndexRef, cache, SQLite, HTTP and runner contracts. New lifecycle cases are
registered in the ordered `ci-lite` manifest. The
[capability review](branch-capability-review-2026-10-02.md) names the affected
regressions and distinguishes source findings from executed checks.

Dependency evidence includes the recorded JavaScript remediation, native grammar
activation, q8/ONNX inference and RustSec/toolchain checks. See
[dependency security](guides/dependency-security.md). An audit snapshot is dated
proof, and does not certify future advisories or close hosted alerts by itself.

The earlier interrupted `ci-lite` run is incomplete: 477 tests passed before
resource pressure; two deterministic fixture failures received targeted fixes,
and seven timeouts remain unverified. Later focused passes do not convert that
run into a full-lane pass. Other-platform and interactive TUI behavior, a fresh
full duplicate audit, and representative end-to-end performance measurements
remain separate checks.

May 20–22 validation and USR Gate A/B/C statements are historical checkpoint
records. The Gate B1-B7 technical, compatibility, matrix, conformance,
observability, quality, and security-risk controls remain the acceptance surface;
their old green results have not been relabeled as fresh proof on this head.
Missing historical logs remain unavailable rather than reconstructed.
USR rollout phases A–H and lifecycle acceptance remain in the
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
