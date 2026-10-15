# Runtime and structured-search repair checkpoint

This follow-on branch starts at approved consolidated main `11f1556c8`.
[Consolidation and earlier backlog](runtime-search-consolidation-2026-10-12.md)
records the nine merged PRs and existing implementation coverage. This ledger
separates implemented behavior, bounded fixtures, and remaining qualification.
It does not establish full-index throughput or release-wide acceptance.

## Important performance limitation

A parent `--max-old-space-size=16384` startup can override smaller Node Worker
heap limits. The safe existing inline fallback now applies to tokenization and
quantization when those bounds cannot be enforced. This can materially reduce
parallelism. Clearing Worker environment/arguments is not isolation. Unshaped
startup retains Workers, and embedding-provider global dispatch is unchanged.
A bounded child-process executor integrated with existing admission, cancellation,
worker lifecycle and IPC accounting is follow-on work. This patch does not claim
to solve that throughput consequence. See [runtime receipts](../guides/runtime-receipts.md).

## Defect groups and ownership

| Audit defect | Repair |
| --- | --- |
| D1: destructive cache getters/repeated rebuild | Getters are read-only; the build owner consumes destructive intent once under the existing selected-repository index lock. Child arguments/environment cannot repeat it. Shared model caches and other repositories remain outside that operation. |
| D2: deferred override loss | Bounded versioned execution-plan handoff through existing stage/queue transport; original semantic/resource selection and digest travel to the child. |
| D3: embedding-off disagreement | Shared enablement intent across outer, inner and deferred owners; explicit off results in no provider work. Model/provider selection stays with existing resolvers. |
| D4: normalized versus raw environment | Stage3 scheduler uses normalized settings only in their intended parameter. |
| D5: false effective startup labels | Requested, launch-planned and input-observed values are distinct; current V8 total heap is measured. libuv initialized pool size remains unknown. |
| D6: Worker cap overridden by parent | Launch contract plus real Worker acknowledgement; explicit safe fallback where the requested smaller cap cannot be enforced. |
| D7: one-CPU preview | Read-only preview uses actual host/runtime observations instead of a synthetic single CPU. |
| D8: heap parsing mismatch | Common flag parser handles supported spellings, quotes, duplicates and source precedence; malformed/unsupported inputs stay explicit. |
| D9: continuous service config staleness | Revalidation clock is distinct from activity; source hashes/trust changes and final environment precedence are checked. |
| D10: lost early diagnostics | Logger configuration precedes path decisions; early evidence appears once. |

## Search and presentation

Query text is optional when a real structured filter is supplied. Filter-only
search scans all eligible indexed metadata rather than ranked candidates. Each
page carries per-mode offsets and a cursor bound to generation, exact filters and
relative-time anchor. Output budgets advance only past emitted results. Repository
search is supported; federated workspace enumeration fails explicitly rather than
claiming complete coverage.

Return-type filters match complete case-sensitive recorded type expressions,
ignoring only token-separating whitespace. Compiler facts outrank stale declared
fallback; arrays, promises, unions and lookalike names do not match `boolean`.
Missing compiler facts are excluded. This is not assignability, alias expansion,
whole-program relation completeness or enumeration of arbitrary runtime values.
Callee and parent filters avoid false matches, and warm query-plan identities
include all structured predicates. Existing symbolic-type graph operations retain
their separate bounded contract.

Readable output adds bounded, root-confined working-tree excerpts, line numbers
and lightweight lexical colors. It strips repository-controlled terminal escapes
and bidi controls. `--plain`, `NO_COLOR`, non-TTY and dumb terminals omit color and
hyperlinks; JSON stays machine-readable. The working-tree label matters: these
previews are not a claim that mutable source equals the pinned indexed snapshot.

[Embedding packing](embedding-tail-packing-2026-10-12.md) records the bounded
no-worse padding/call-count planner, exact scatter, cumulative versus active
metrics, writer admission semantics and compute-only weighted ETA limits.

## Acceptance matrix and validation

The final matrix below maps the audit's 45 cases to exact bounded evidence and
explicit remaining conditions. Platform/model/crash qualification is not implied
by helper tests or by a successful pre-publication gate.

| Case | Bounded evidence / remaining qualification |
| --- | --- |
| 1 | Loader source metadata distinguishes absent, empty, filtered and test-origin inputs; `tooling/config/source-metadata`. |
| 2 | Trusted override and discarded-authority reasons use the same loader records; sensitive values and sensitive-source hashes are omitted. |
| 3 | Embedding intent, heap source parsing and execution-plan allowlists cover their explicit values. This is not an exhaustive precedence matrix for every configuration field. |
| 4 | Shared intent respects policy disable versus explicit mode without selecting a different model. Quality/platform-wide combinations remain broader qualification. |
| 5 | Receipt retains existing platform/learned/autotune inputs and marks request versus execution admission. The full revision/source/shadow-versus-applied ledger remains open. |
| 6 | Recomputed-digest nested handoff extras and malformed inputs are rejected; loader test overlays retain their gate/origin. |
| 7 | Existing cache contract matrix retains config-root versus environment-base suffix semantics; no second path authority was added. Full HOME/LOCALAPPDATA/XDG/relative-path platform qualification remains open. |
| 8 | Receipt path observations distinguish errors, absent roots, existing paths and canonicalization results; no existence claim follows ancestor-only resolution. |
| 9 | Symlink/ancestor and foreign-Windows unknown cases are bounded fixtures. Real Windows junction/MSIX redirection remains platform qualification. |
| 10 | Explicit report root bypasses current invalid config; stage3 plan pins root/generation. Missing modes fail rather than silently changing builds. |
| 11 | Reports distinguish published roots, bounded unpublished candidates and legacy/unknown evidence. Candidate age is never a live-process claim. The bounded candidate/mixed-root reader is tested; the full invalid/stale current-pointer selector matrix remains open. |
| 12 | Config dump, index dump, status and report preserve sentinels and absent roots under inherited rebuild intent; `tooling/config/runtime-diagnostics-readonly`. |
| 13 | Selected-repository lock, once-only consumption, other-repo/model preservation and fresh child lookups; `integrations/core/cache-rebuild-owner`. |
| 14 | Outer/inner/deferred intent plus actual stage launcher/service executor are tested. A complete independent wrapper/MCP/daemon/TUI launch matrix remains open. |
| 15 | Tiny actual child captures model/dims/thread/scheduler options; missing/changed plan, explicit-option and root mismatch fail before provider work. |
| 16 | Actual service executor retains submitted plan after model/provider/off/normalization config edits; legacy jobs remain explicitly execution-time selected. |
| 17 | Continuous service revalidation and trusted-source replacement; `tooling/service/runtime-config-revalidation`. |
| 18 | Final base/overlay Node and UV precedence; `tooling/service/indexer-runtime-env-helper`. |
| 19 | Startup-source observation and real child/Worker probes distinguish command-line from environment heap input; no unsupported Worker heap argument is injected. |
| 20 | Current process reports startup plans as not-applied where appropriate; `shared/runtime/startup-observation`. libuv initialized pool size is unknown. |
| 21 | Real Node 26 Worker probes cover unshaped, environment/CLI-shaped, controlled smaller parent and 16384 MB parent cases; `indexing/workers/worker-startup-heap-contract`. |
| 22 | Shared parser exercises duplicate/spaced/equal/underscore/quoted forms and source precedence; unsupported percentage/invalid conflicts cannot claim an enforced Worker cap. |
| 23 | Actual logical CPU and available parallelism appear in read-only previews; `tooling/config/dump-readonly-host`. |
| 24 | Worker resource snapshots separate configured/effective/active counts and per-worker acknowledgements; live replacement observations are cleared. Sustained pressure/downscale plus replacement-observation combinations remain partial. |
| 25 | Existing scheduler/FD/writer owners are retained; previously merged global-admission and writer-critical-path fixtures passed again. No blind parallelism increase. |
| 26 | Provider active/peak, cumulative inflight claims/joins, live coalescer and writer pending have distinct labels; grouped progress fixtures and packing receipt document them. |
| 27 | Model selection retains existing resolver/default ownership; direct/queued CLI selection and post-submission edits are tested. |
| 28 | Off/stub/configured modes share one intent outcome; off returns without provider initialization, model mkdir or enqueue in the boundary fixture. |
| 29 | Provider-owner mocks distinguish delayed acknowledgement/loading from ready; controller durability is tested independently, not a real delayed model process. |
| 30 | Known dimensions do not claim a loaded Xenova model; readiness follows successful inference/acknowledgement. |
| 31 | Deferred identity is bound before reuse. Inline provider change after signature/cache selection fails closed and records actual/requested mismatch; transparent inline replay is not implemented. |
| 32 | Failed load, dimension disagreement and required evidence-write failure cannot pass successful inference/publication; durable attempt failure is used where persistence is available. |
| 33 | Stage3 distinguishes provider probe, inference work, cache-only completion and no-work completion; no fabricated fresh inference. |
| 34 | Provider observations retain acknowledged artifact/revision/dtype/session facts and leave unacknowledged device/native threads unknown. Real ONNX/EG2 hardware qualification remains open. |
| 35 | Existing embedding identity and compatibility authorities remain in force; consolidation cache-identity/dependency-signature fixtures passed. No new compatibility shortcut. |
| 36 | Before-root initialization failure emits bounded diagnostic; after-root initialization has a required durable attempt and failure transition. Every initialization failure seam is not independently injected. |
| 37 | Writer-error injection covers EACCES/ENOSPC/patch timeout, plus actual atomic-rename ENOSPC injection; `indexing/build-state/runtime-receipt`. This is not physical disk exhaustion or held-lock expiry at every lifecycle phase. |
| 38 | Required receipt ordering guards model/work/publication boundaries. Real process-crash and power-loss windows across all producers remain separate qualification. |
| 39 | Generation and random attempt IDs are distinct; parent/child/mode references travel through existing observability context. Streaming parent/child and controller mixed-mode/resume are tested; forced PID reuse and daemon restart remain unqualified. No PID alone is treated as proof of liveness. |
| 40 | Early path lines are captured once in the requested log; `indexing/runtime/early-path-log`. |
| 41 | Capability inventory is opt-in; legacy/missing receipts remain unknown producer evidence. |
| 42 | Nested secret fields, raw argv/environment, preload options, URLs and errors are sanitized before persistence/export; runtime receipt and diagnostic fixtures. |
| 43 | Attempts are bounded to 48 KiB each, history to 16 entries, and lifecycle journal uses existing rotation. Successful per-chunk calls do not cause full-state receipt writes. |
| 44 | Reader uses a bounded opened-file read; legacy, future, malformed/truncated and stale records stay read-only and explicitly classified. |
| 45 | New implementation uses isolated cloud worktrees, bounded tests and the repository publication gate. The user's earlier source/index artifacts were not modified. |

The real compiler acceptance fixture runs the TypeScript provider, production
metadata projection and persisted-index search. It proves precise recorded return
facts and provenance rather than relying solely on hand-authored metadata. Syntax
class/parent/callee facts are tested separately from compiler dispatch semantics.

## Final bounded validation

Node 26.8.1 with verified native/patch readiness, one test job, 30-second per-test
limits, zero retries and native-status redo disabled:

- 36 changed/new fixture IDs passed: 68.0 seconds total, slowest 9.33 seconds.
- 27 existing backlog fixtures passed again after integration: 24.7 seconds total,
  slowest 10.2 seconds.
- The opt-in capability consumer and default read-only diagnostic fixtures passed
  after command-audit migration: 2/2, slowest 7.45 seconds.
- Required format, config budget, environment usage, generated freshness, command
  surface and workflow checks passed. The 39-case gate passed in 25.2 seconds;
  slowest 1.84 seconds. No test timeout or skip was accepted.
- Whitespace check passed. Generated inventories were refreshed, not hand edited.

The gate caught two documentation/consumer mismatches: the global roadmap audit
date must remain aligned with its older repository-wide reconciliation, and the
capability auditor must explicitly request the newly opt-in manifest. Both were
fixed without relaxing their assertions. The October 12 scoped repair ledger does
not claim to replace that broader reconciliation.

Workspace logs are historical author-workspace receipts, not promised artifacts
in a clean checkout. Hosted CI for the published PR is a separate exact-head
record; the bounded local checks do not certify every platform or release lane.
