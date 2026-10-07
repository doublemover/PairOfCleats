# PairOfCleats Roadmap

Status: Active
Last audited: 2026-10-06
Canonical for: initiative status, execution order, and remaining work

PairOfCleats' indexing, retrieval, tooling and integration surfaces are implemented.
The current completion branch adds targeted correctness, dependency and resource-lifecycle
fixes, and reconciles older branches by behavior. Release-wide acceptance remains open.
The ordinary integration combines published `29398b4a`, earlier cache/ingestion
follow-on `09309e75`, Sublime worktree fix `154c3982`, and native-hardware repairs
`212ad438`, with the packaged Windows cmd mirror synchronized to its shared owner.
The final integrated commit still requires its own bounded validation. Historical
component passes do not establish an integrated pass or release-wide readiness. Use this
page for current status, the linked contracts for behavior, and the archived
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

PR519's published head is `29398b4a`. Its [hosted run](https://github.com/doublemover/PairOfCleats/actions/runs/37428326764)
passes gate, Rust TUI, Ubuntu 827/827 and macOS 827/827. Windows records 824 passes,
two failures, one declared POSIX-signal skip and no runner timeouts. The canonical
path fixture passes; remaining failures are the cmd conditional syntax case and
parity cleanup EBUSY. Clean dependency/native installation and the full-graph audit
passed on the published dependency graph. The [dependency migration](guides/dependency-security.md#october-6-current-advisory-follow-through)
and explicit worker precedence remain in the ordinary integration.

Unpublished hardware repairs preserve literal cmd forwarding and conditional exit
behavior, real parser-to-child `--no-ann` intent, visible-state TUI redraws and
separate cancelled-job counts. Nine focused normal-token Windows checks pass; a
separate bounded parity fixture times out without EBUSY and leaves no observed
owned children. This does not diagnose or repair the original EBUSY cleanup case.
Mac arm64 tiny CLI and native-terminal checks establish their limited recorded
scope. All final integrated checks remain pending. The isolated SQLite/Node26
comparison `5faa768b` is excluded. The separately authorized dependency update
in PR539 upgrades better-sqlite3 to 13.0.3 with native runtime verification and
source-recovery compatibility; retain Node24 policy. This upgrade does not
establish acceptance of the excluded SQLite/Node26 experiment.

Historical `82528215` platform and lifecycle results remain in the
[integration checkpoint archive](archived/ordinary-integration-roadmap-2026-10-06.md).
They do not establish current integrated acceptance. Keep demonstrated failures
ahead of broader validation and retain historical measurements as dated evidence.

### Concrete Platform and Product Queue

1. **Validate integrated Windows transport and diagnose parity cleanup.** Preserve
   the original cmd exit255 failure and its stderr. The isolated repair passes
   literal argument rotation, conventional percent-tilde batch version expansion,
   authored exit7, injection controls and meaningful timeouts on normal-token
   Windows. Keep shared and packaged VS Code cmd owners byte-identical, with the
   existing equality regression intact. Rerun on the integrated source. Capture
   the parity primary failure separately from finally cleanup, then establish
   actual owned-child cleanup before closing EBUSY. The later bounded timeout
   without EBUSY is not a repair receipt.
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
with redacted provider details in the application-owned default cache. The draft
retains 48 underlying checks and a healthy contribution; integrated execution is
pending. Trust, chunk identity and required output contracts remain strict. No
tool install/upgrade or generic automatic binary fallback is enabled.

Published `29398b4a` has 827 ordered CI-lite entries. The companion extends the
836-entry foundation union to 837 entries, preserving the published prefix and
earlier additions. Historical component passes are archived; the combined lane
requires its own exact-revision receipt. The no-ANN forwarding regression is
mandatory outside the ordered lane. Node24 and SQLite 12.6.2 remain unchanged.

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
