# Implemented-fix validation — 2026-10-24

Status: Historical Windows observations; execution deferred by the October 25 implementation-first request.
Branch: `codex/pr557-audit-repairs-20261012`; Node 26.12.1, Windows x64.

## Scope and candidate

The user requested closing the validation deferred during implementation. The
PR coverage snapshot contains 626 reports with implemented changes awaiting
qualification, separately from 141 existing closing references, 170 partial
repairs and 240 pending reports. Those groups account for all 1,177 open reports
through #1748; implementation references do not establish accepted issue closure.

This pass selects every currently discovered fixture whose source changed since
the last qualified production/test source,
`d4dcba4134f6103e3a59703d90fdbde5ca54d09e`. Discovery contains 4,435 cases;
1,777 changed test files resolve to 1,762 discovered fixture cases. Helpers,
sidecars and deleted files are not independently executable fixtures. This is an
explicit changed-fixture selection, rather than an unfiltered all-lane run.

Frozen execution source: `450160788ef2ccd28756f26d748e1b43cdbcd1a1`.
Production/test source is unchanged from `01ac575545ee7ba1e05bf6ade1a6ecd32335405a`.
Fresh `node tools/setup/rebuild-native.js --verify` exited zero without warnings
or errors: eight patches, 26 target files and 61 hunks verified; no package files
changed. Readiness was refreshed without reinstalling dependencies.

All cases have a 30-second outer limit, zero retries, native-status redo disabled
and one indexing thread. Correctness cohorts use four runner jobs; native
lifecycle and performance cohorts run serially. The absent inherited trusted
configuration path is omitted from validation children, without granting
replacement trust or changing the launching environment.

## Selection reconciliation

The initial 74-cohort plan selects 1,758 cases and inherits four physical-link
exclusions. Source review corrects two stale exclusions:

| Fixture | Current Windows applicability |
| --- | --- |
| `shared/contained-file-verified-read` | Portable Windows assertions run without creating a symlink; POSIX physical-link assertions retain their platform owner. Re-admit. |
| `tooling/install/postinstall-patch-enforcement` | Injected linked-parent admission and ordinary hardlink rejection need no symlink privilege. Re-admit. The real POSIX signal assertion remains separately owned by hosted CI. |
| `tooling/install/bootstrap-preflight` | Retains actual disposable directory-alias creation; physical-link qualification remains outside this user's scope. No pass claimed. |
| `indexing/watch/promotion/safety` | Retains actual physical directory-link promotion authority; separate qualification. No pass claimed. |

The corrected selection therefore has 1,760 runnable cases and two physical-link
qualifications. Re-admitted checks require explicit execution; source review
alone is not a pass. No WSL/Linux execution, elevation or security-setting
changes are included.

## Failures under investigation

The initial correctness cohorts exposed the following owners. Original failures
remain in the source-bound receipt; later repairs require targeted execution.

| Owner | Observed failure and required repair |
| --- | --- |
| Completed-stage schema | AJV strict compilation rejects conditional required properties not defined in their branch. Retain strict mode, closed payloads and conditional requirements. |
| Embedding cache cleanup | Repeated aggregation changes the immediate primary cause. Preserve the original cancellation and every independent retained owner together. |
| Cache-only provider fixture | One wrapper runs initial indexing plus six successive embedding executions and exceeds 30 seconds. Partition only after mapping every existing assertion and cumulative setup state. |
| Quantization parity fixture | Its warning assertion has no out-of-range input. Add actual clamp inputs while retaining byte parity and independent-buffer controls. |
| Captured CLI output | Piece assembly, active-root trimming and extension verification inspect uncaptured output. Select captured pipes explicitly; preserve status/content and no-mutation assertions. |
| Request-local provider authority | Case-sensitive comparisons reject equivalent Windows canonical paths. Repair exact path comparison without accepting sibling roots or changed hashes. |
| Signature version witness | The comment-boundary fixture still pins producer 7; five later semantic changes intentionally advance the producer to 12. Preserve the original content/range assertions and require the applicable producer floor. |
| Inventory fixture isolation | Governance and scoped-inventory fixtures retain their own later-mutation files between invocations. Give each invocation a fresh owned root. |
| Semantic descriptor fault fixtures | Five fixtures compare normalized Windows paths with case-preserving physical paths, bypassing intended hooks. Restore actual fault/mutation injection and retain every ownership assertion. |
| Published semantic metadata | The size fault still intercepts async handle stat, while verified reads now use the captured native descriptor stat. Exercise the actual operation and preserve real mutation, close, cancellation and size-bound negatives. |

## Repair checkpoints and retained results

| Source | Executed selection | Result |
| --- | --- | --- |
| `450160788` | Completed original changed-fixture cohorts | 1,603 passed, 19 failed, one of those failures timed out; no skips/access violations. The current tooling cohort was interrupted and excluded from these counts. |
| `d68b1ef25` | Repaired failures, re-admitted portable cases, direct consumers and unfinished cohorts | 111 passed, 21 failed, one timeout; no skips/access violations. Execution stopped at a clean cohort boundary before a changed source could be mistaken for the frozen candidate. |
| `b3f295c57` | Seven-case owner canary | Three passed, four failed, no outer timeouts/skips/access violations. Configuration observation, terminal backspace decoding and actual native settings edit passed. |
| `8e03d95b3` | Pinned Rust 1.88.0 debug source | 134 tests passed; no ignored cases. Cargo check, rustfmt, clippy with warnings denied and debug build passed. |

The Rust repair fixes actual build errors, replay seek/scroll preservation and
caret visibility. Repository searches and prior caller replacements established
that its removed private query helper had no remaining callers. Native fixture
acceptance now requires the freshly built debug binary, SHA-256
`87d63f99878580b0906de685724a85d01c86c3fc376702d5f2c3efef88e69243`,
rather than the older workspace binary.

The original cache-only wrapper is replaced by five independently bounded
cases: cache-only, missing-coverage, unknown-width, tokenizer-change and
provider-fallback. Each retains the two-file real stage-2 setup and relevant
positive/negative assertions. The fallback case includes the tokenizer-change
setup needed by its previous cumulative execution. All five passed at the
follow-up source. No ordered lane referred to the former wrapper.

Production repairs through `d68b1ef25` retain strict completed-stage schemas,
exact Windows path authority and the original embedding cleanup cause. Fixtures
now use actual out-of-range inputs, fresh isolated inventories, captured pipes,
canonical producer witnesses and real descriptor-bound size/mutation controls.
Later checkpoints repair canonical TUI footer/handshake readiness, ConPTY
backspace decoding and fixture cache publication. New October 25 changes remain
unvalidated; see the [implementation receipt](solo-issue-repairs-2026-10-25.md).

The follow-up selection had 56 unexecuted cases when its source guard stopped;
older unchanged native TUI owners must also run against the fresh binary. Native
lifecycle/performance owners remain serial. The original corrected selection
gains four cases from the one-to-five wrapper split; new regressions are additional
coverage, not substitutions for unfinished cases.

Remaining observed failures include four export fixtures exceeding their
unchanged ten-second build deadline and native search/selection/lifetime cases.
The seven-case canary's completed-stage negative, selection witness and search
cache mismatch have subsequent source repairs awaiting execution. The live
event-transport fixture has not demonstrated actual pipe EOF while its child
remains alive on Windows, so that qualification is still open. No timeout,
failed capture or JavaScript log line establishes native crash attribution.

## Evidence ownership

Author-workspace orchestration and raw logs live under
`.tmp/tasks/windows-failure-repairs-20261024/implemented-validation-450160788ef2ccd28756f26d748e1b43cdbcd1a1/`.
These paths are historical local evidence, not artifacts promised by a clean
checkout. The [portable receipt](windows-implemented-validation-2026-10-24.json)
enumerates explicit selections, source-bound observations, exclusions and
follow-ups. No combined final-tree deep-suite pass is claimed.

Earlier 360-case, 459-case, native crash and front-gate receipts retain their
original candidates. They are not silently promoted to acceptance of this tree.
The four known export CLI deadline failures and the hosted POSIX postinstall
signal failure remain open pending the current observations and repairs.
