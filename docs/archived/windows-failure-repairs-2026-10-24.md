# Windows failure repairs — October 24, 2026

This follow-up to the [459-case historical re-check](windows-historical-rechecks-2026-10-24.md)
repairs shared causes without repeating that campaign. Work was solo on
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1 / ABI 147.
No Linux/WSL, elevation, security-setting change, worktree or symlink creation
was used. Publication continues through PR #572; no merge is authorized.

## Source and observations

The focused candidate is `adfdcc85b790dab767915b47c775f6a4efeb539d`, tree
`594e8338c88ae385a2a32484c85bfcbb2336742f`. All **37 selected IDs pass** at that
candidate: one job, one indexing thread, 30-second per-case deadline, zero
retries and native-status redo disabled. The runner reports 143.0 seconds total,
22.7 seconds for the slowest case, and zero failures, timeouts, skips or access
violations. No warning diagnostic was found in the focused transcripts.
The per-ID outcomes are appended as a distinct repair wave to the
[durable inventory](windows-historical-rechecks-2026-10-24.json).

Of these checks, **28 were failing in the frozen 459-case inventory**. Together
with the preceding 16 repairs, latest scoped observations are **76 passing,
382 failing and one POSIX exclusion**. Those counts combine explicitly named
checkpoints; they are not a new full-suite or final-head 459-case pass. Original
failure summaries, the frozen baseline and earlier observations remain intact.

Local receipts under `.tmp/tasks/windows-failure-repairs-20261024/` are historical
author-workspace evidence, unavailable in a clean checkout. Intermediate failures
remain in their own reports/logs. The inventory records selected IDs, candidate,
durations and policy without promising those ignored files to other checkouts.

## Production repairs

| Commit | Demonstrated cause and repair |
| --- | --- |
| `dd53c476f` | Hosted CI reached bootstrap and failed its unchanged audit gate on six high and one moderate affected entries. Happy DOM and permitted transitives are updated; a scoped Azure Identity override selects fixed MSAL 7.1.0. The real Identity adapter performs offline discovery, token acquisition and cache reuse. |
| `0e1c3820b` | The regex autofix collapsed an optional literal backslash into a literal question mark. Both expressions compile, so syntax-only checking missed the semantic corruption. The rule now preserves regex operators; seven operator controls supplement the existing escape fixes. The old rule fails the new regression, and formatting with the repaired rule preserves the PHP parser correction. Proven missing runtime prerequisites degrade; trust, ineligible-path and pending-owner denials still block. Semantic producer identity advances to `lspBindings47`, retaining `rq11`. |
| `6e55e9f03` | Node rejects Windows drive paths in `--import`. Delegated cache workers now receive the actual preload file URL. A real SQLite child opens, uses, closes and transmits settlement. Wrong-child and stale grants must fail inside the real admission gate; no-settlement, forged receipt, failed IPC, stale-parent and retained-reader controls remain. |
| `918f61cc8` | `graph_evidence` had object-only alternatives but no root `type: object`, invalidating SDK tool discovery. MCP 1.10.1 adds that declaration while retaining the exact `oneOf` branches and strict validators. The registered generator refreshes its snapshot. Every tool is parsed by the real SDK schema; stdio search/context, cancellation, timeout, progress-token-zero, disconnect and child/capacity ownership pass. |
| `dbe962953` | The official pinned VSIX packager emits dotted content-type extensions; our validator accepted only undotted names. Both spellings now validate the same actual payload. Missing XML/assets/runtime modules, identity/engine mismatch, escaping/dynamic requires and invalid content types remain negative controls. An explicit package file list eliminates the inclusion warning; the archive check uses the official normalized `readme.md` name. The editor settings reference again covers the canonical names. |
| `257115a08` | Directory EXDEV fallback created an exclusive staging root and then asked `fs.cp` to reject that root's existence. It now streams root entries through the existing directory owner and copies each child into an absent destination with unchanged overwrite refusal. Nested payloads and empty directories survive. Root identity, retry bounds, foreign replacement, unknown native work, backup preservation and original parent-close recovery remain covered. Pending copy work also retains the actual directory recovery capability. |

These fixes make previously broken paths usable. No latency improvement or new
native-crash attribution is inferred from them.

## Fixture corrections and retained coverage

No test or production function was removed. Obsolete expectations were identified
against their actual owners before changing assertions:

- Descriptor wrappers now forward the original `fd` and read method required by
  contained-file admission. The transfer test recognizes the documented handle
  handoff: two initial source close-method captures, with **no new capture during
  recovery**, no repeated successful close and the original receiver intact.
- Configuration and migration reconcile their original directory/transfer/root
  owners before retrying the separate operation-coordinator lock. Early metadata
  release still rejects. Both frozen causes and independent failures remain in
  the error graph; composition need not make a leaf the immediate `cause`.
- Closing a managed file does not close its enclosing inventory directory. The
  fixture explicitly proves pending ownership between those two closures.
- Doctor positives explicitly trust their fixture root. A custom preflight test
  selects Node so real command admission reaches its intended custom block. The
  Dart missing-command case now asserts zero initialization/requests after proven
  discovery failure, retaining sparse/degraded diagnostics and contribution bounds.
- `adfdcc85b` preserves existing final and backup bytes when a missing source cannot
  prove a prior commit. Synchronous close ambiguity must remain pending instead
  of retrying a potentially reused numeric fd. The fixture alone disposes its
  known injected handle, without presenting that disposal as an owner receipt.
  Compression exit controls wait for actual worker/queue admission before
  asserting rejection of active, queued and idle waiters.

## Dependency preparation and qualification boundary

Locked `npm run bootstrap:ci` completed native rebuild, parser activation, all
eight required patches (26 targets / 61 hunks) and readiness publication. Its
transcript contains no warning/error diagnostic. Optional Sharp was absent and
explicitly reported by setup. The subsequent full-graph `npm audit --json`
reports zero vulnerabilities, including development and optional entries.
See the [dependency guide](../guides/dependency-security.md) for the exact revised
versions and temporary MSAL bridge. No advisory or live audit check was suppressed.

The publication front gate passes: formatting, configuration budget, environment
usage, generated freshness, command surface, workflow contract, all 40 gate
cases, whitespace and the additional Markdown link check. Freshness first caught
the old MCP version in the tooling/API contract spec; correcting that reference
and rerunning freshness resolves it. The inventory retains both attempts. No
unexpected warning diagnostic was found. Formatting leaves executable source
unchanged; publication adds documentation/receipts only. Setup activation,
focused tests and that gate do not qualify all runtime lifecycles or the hosted matrix.

All ten original timeout IDs remain unresolved, as do the remaining semantic,
retrieval/cache, language, report, provider and import-budget groups. Existing
transitive budgets remain unchanged; correctness/resource bounds are not latency
measurements. Windows terminal lifecycle, platform-specific native authority,
optional sqlite-vec, real models, Linux/macOS and release acceptance retain their
separate owners. No comprehensive backlog or issue-closure claim is made.

## Cache and setup follow-up

`136fb56fd` repairs two production defects. A zero query-cache freshness window
was interpreted as unlimited hot reuse, allowing an invalid canonical execution
proof to be bypassed. Both session lookup sites now validate disk authority when
the window is zero; nonzero bounded hot reuse and low-level in-memory consumers
retain their policies. All six malformed/degraded/missing/wrong-mode proof
negatives remain misses without rewriting data or publishing touches. Pre-cancelled
core search now returns the same `CANCELLED` / `cancelled:true` contract as later
cancellation, with no successful-search history publication. Both regressions
failed before the repair and pass afterward.

`2548ff65a2c26e654d1a541cbb977cf1e62ecdd9`, tree
`69874b8de3e3ac428500beb2ed3945982195b123`, has **12 passing focused cases**
(20.1 seconds total; maximum 13.4 seconds). Positive mocked embedding caches now
explicitly select deterministic stub authority or real, inert selected graph and
tokenizer bytes. Unknown model provenance still executes twice rather than
borrowing stub reuse. Dimensions, normalization, generation/provider isolation,
LRU bounds, retired-flight replacement and failed-flight recovery remain covered.
The query-plan test isolates its two orderings' cache namespaces instead of
mistaking the preceding ordering's valid entry for cross-policy reuse. Cancellation
is observed before an awaited lock release, retaining the original aborted write
and no-publication assertions. A full session fixture supplies its required ONNX
and context-expansion options. The retrieval-knob CLI fixture selects balanced
quality and sparse retrieval explicitly, verifies the expected source on every
cold/warm call, and retains distinct configuration keys and miss/hit assertions.
Transient ANN/FTS failure/recovery and effective-model identity remain separate
passing controls; no unknown-provenance admission was relaxed.

Hosted CI at `8e4677894` passes dependency security and the offline Identity/MSAL
contract, then stops on an obsolete patch diagnostic assertion. The ensuing
portable Windows repair at `abf38e24706ef5e22209bbbf7ac952725e57037a`, tree
`e5449099e8ee7ee24dbb6ec6a68dbcff8a59f9a0`, fixes a genuine setup diagnostic defect:
wrapping an aborted Git child converted cancellation into an ordinary patch
failure. Input-order selection could then hide the incompatible patch that
stopped the wave. The original AbortError now reaches the scheduler unchanged;
the real incompatible package remains the primary failure and neither package
is modified. Patch repeat checks assert the actual zero-change counters. The
linked-directory predicate runs against the real admission owner with controlled
native metadata and proves rejection before target open, creating no symlink or
junction. This is portable predicate coverage, not physical-link qualification.
Existing real hardlink refusal remains. SQLite's fixture now checks that the
selected upstream `build-release` owns `--force_build=1`, without reintroducing
the obsolete npm source-build flag.

All **three postinstall cases pass** (6.36 seconds total). Fresh native/patch
verification exits zero and refreshes readiness without warnings. The 15 focused
checks repair **10 additional historical failures**, giving latest scoped counts
of **86 passing, 372 failing, one platform exclusion**, with all ten original
timeouts still unresolved. Their separate candidates and reports are preserved
in the second repair wave of the JSON inventory. Hosted CI and broader resulting-
tree runtime acceptance remain outstanding; no local Linux or WSL check was run.

The complete follow-up front gate passes, including all 40 cases and Markdown
links. It first caught the obsolete privileged-cohort entry for the now-portable
patch predicate. `9f94a3595` removes only that file-symlink cohort membership and
asserts that ordinary CI still owns the full fixture. The resumed gate passes
without creating links or weakening its completeness/timeout/retry guards. Both
gate attempts are retained; no unexpected warning appears in focused transcripts.

## Import-budget follow-up

`54dad84737f77a8b818cfda2f4cb185f5379f243`, tree
`0d65bf8fb851b22deb92e61a8afe5f4c411e6834`, meets every unchanged direct and
transitive module budget. Command-registry queries use **2 / 2**, artifact I/O
**71 / 73**, and the retrieval CLI **7 / 60** transitive modules. Other measured
module budgets also pass. The serial original `tooling/shared-module-performance`
fixture passes, including successful execution of all four help commands.
Raw import/command timing samples and all module metrics remain in the JSON
inventory; single-run samples do not qualify a latency speedup.

Storage action identity now belongs to the canonical command registry, with the
storage option module re-exporting that same frozen list. Registry queries no
longer depend on CLI option declarations. Retrieval preflight imports the actual
dense metadata predicate rather than its writer/binary facade. Artifact cache
keys, repository access admission and binary JSON row parsing load their existing
owners on first use through synchronous Node loading. This retains synchronous
admission, the same key builder, original reader/lease instances, strict authority
and public return contracts; it adds no asynchronous configuration snapshot gap.
No public function, format, CLI option or threshold is removed or relaxed.

Nine focused functional cases pass: dispatch/registry parity, sparse mode and
filtered fallback policy, binary streaming without full materialization, JSON
facade compatibility, loader fallback, manifest planning and strict containment.
Two additional original repository/delegation lease controls pass, retaining live
reader exclusion, dead/foreign/unknown-owner behavior and failed IPC authority.
Together with the serial performance fixture this repairs one additional
historical failure, giving latest scoped counts of **87 passing, 371 failing
and one platform exclusion**. Broader coupling inventory/review work and the ten
original timeout cases remain open.

The complete import-batch front gate passes, including all 40 cases and Markdown
links. Its first freshness failure caught a changed status literal: the broader
coupling audit remains open even though its count budgets now pass. Restoring
that explicit status retains the new budget evidence and the existing guard.
The inventory preserves both observations. No unexpected warning appears in
the Windows focused transcripts. Hosted CI at the preceding `dfba4c65d` checkpoint
passes the dependency audit but fails the POSIX-only Git SIGTERM propagation
control; downstream jobs remain unqualified. This Linux signal-lifetime path is
outside the requested local Windows execution scope and has no speculative fix
or disabled assertion.

## Worker and artifact runtime follow-up

Source `f5334185b35a512d8d6e34e2dcd8361d67a16522`, tree
`93a183f5386793b68a03a6ad4f2f530055ca52b6`, passes **19 targeted Windows cases**
in 13.6 seconds; the slowest is 4.12 seconds. Every case uses one job, one indexing
thread, a 30-second deadline, zero retries and native-status redo disabled. No
case fails, times out or skips; no access violation or unexpected warning is
observed. This repairs **11 additional historical failures**, giving latest
scoped totals of **98 passing, 360 failing and one platform exclusion**. The ten
original timeouts remain unresolved. The JSON inventory preserves every ID,
candidate and intermediate failure; these observations do not qualify the full
suite or close the issue backlog.

Four production defects are repaired:

- **Worker heap acknowledgement:** Node 26/V8 rounds the young generation's
  semi-space size up to a power of two. The old raw old-plus-young sum rejected a
  real 256/32 MiB worker whose correctly bounded total is 304 MiB. The existing
  owner now derives the total ceiling using the
  [pinned V8 calculation](https://github.com/nodejs/node/blob/v26.12.1/deps/v8/src/heap/heap.cc#L4592-L4634).
  Fresh-process controls cover 24/32/48 MiB young settings, CLI and NODE_OPTIONS
  oversized old/young overrides, and stricter startup caps. The new 32 MiB control
  fails before repair. This is measured V8 total-heap acknowledgement, not an
  old-space measurement or native/addon memory qualification.
- **Closed worker admission:** Closing the pool's own queue now gives waiting,
  undispatched callers the same unavailable result as the checks before and
  after acquisition. Caller cancellation still rejects, and dispatched failures
  retain their original settlement owner. The original shutdown/permanent-disable
  fixture and its new caller-abort/accounting control pass with physical threads
  reaped and counters drained.
- **Token batch byte receipts:** V8 can encode equal values differently after
  structured cloning, as its [serialization contract](https://github.com/nodejs/node/blob/v26.12.1/doc/api/v8.md#serialization-api)
  documents. Internal protocol version 2 carries actual serialized member bytes;
  the coordinator verifies membership, source/policy identity and exact aggregate
  bytes before decoding. The 8 MiB limit is unchanged. Old versions, malformed
  encodings, shared mutable buffers, wrong counts and poisoned lookahead still
  fail. Real Worker and process transports preserve every original token-content
  comparison; the actual production chunk loop retains bounded inline recovery.
- **Quantization warnings:** Valid inclusive endpoints and in-range values that
  round to an endpoint no longer produce out-of-range diagnostics. Quantized
  bytes are unchanged. The new endpoint assertion fails before repair; actual
  out-of-range warning-once, no-wrap and normalization-parity controls still pass.

Fixture repairs retain their original coverage owners. The direct checksum
worker now uses the current bounded request/reply protocol and awaits actual
termination. Process heap qualification awaits both real readiness observations
instead of reading receipts while the second child still initializes; two unique
PIDs, independent startup caps and the aggregate child budget remain asserted.
Dense-vector invalid-shape checks first establish a canonical manifest and valid
strict read, retaining a separate missing-authority negative. Binary byte-budget
refusal asserts its actual contained-file error code rather than stale message
text, and the existing explicit bypass decodes every expected posting. Packed
short-read injection clears the descriptor on actual close, proving EOF hits the
payload rather than a reused metadata descriptor. Bundle close injection accepts
the owner's numeric read flags. Binary-frame recovery separately closes the row
source before releasing the descriptor, with premature release still rejected.
No test, production function, budget or public artifact contract is removed.

The original failure receipts and the two new fail-before controls remain in the
author workspace under `.tmp/tasks/windows-failure-repairs-20261024`; they are
historical local evidence unavailable in clean checkouts. Dependency/patch setup
is unchanged from the preceding verified installation. The last hosted checkpoint
`7f2aa42bf` passes policy but still fails the POSIX-only Git SIGTERM propagation
control, leaving downstream jobs unqualified. No local Linux/WSL run, signal
assertion workaround or platform-acceptance claim is made.

The publication front gate passes: full formatting, config budget, environment,
generated freshness, command surface, workflow contract, all 40 gate cases,
whitespace and Markdown links. Formatting leaves the committed runtime candidate
unchanged. Publication adds only the durable observations and status documents;
earlier waves retain their own candidates and verification scope.

## Coverage and probe follow-up; implementation-first instruction

Source `f6c7812a4b531cfa315a346c7b594c09eb421c4f`, tree
`9599ee6abaca4b76f801066d09fdb57ebcb079f6`, passes eight targeted cases in
13.0 seconds, repairing seven historical failures. Latest scoped counts are
**105 passing, 353 failing and one exclusion**, with **nine original timeouts**
remaining. These checks finished before the user instructed an implementation
attempt for every remaining failure before further batch tests. The
[360-item queue](windows-360-failure-repair-attempts-2026-10-24.json) freezes the
preceding publication's failure IDs, including these seven completed repairs.
Further tests and the next front gate are explicitly deferred under that
instruction; formatting passes. No final-head gate or full-suite claim is made.

The coverage policy schema now declares its seven required status counts, so
strict compilation succeeds without changing the accepted value contract.
Missing, negative, fractional and nonnumeric counts fail; existing additional
integer counts remain compatible. Observed zero and unobserved/null inventory
still differ. The real report generator and temporary Git-inventory cases pass.

Probe invalidation now takes the same explicit environment identity as cache
read/write. Previously it selected another key, missing both invalidation and
the intended close/policy-recheck fault. Actual descriptor and policy failures
now propagate; a two-environment positive proves precise deletion and preservation
of the other entry. The canonical key owner is shared by production creation,
ownership validation and fixture preparation. Cache reads omit a redundant third
ancestor walk while retaining both contained-file admission checks, original
descriptor identity, no-link and single-link predicates. Controlled linked metadata
is rejected before open without creating physical links. No measured production
latency speedup is claimed.

The count-admission timeout was an oversized fixture preparation loop: 257
complete inventory transactions repeated the same below-limit branch and scanned
all previous prefixes. Replacement preparation uses one real producer entry,
the same canonical producer key and identical payload inputs. It validates every
seeded record's ownership and reads every entry through the actual public cache
reader, then executes the real 256-to-257 write boundary. The unchanged default
limit, exact oldest-entry removal, new-entry hit, oversized-payload refusal and
protected pinned/unknown bytes remain asserted. The smaller reviewed-policy
lifecycle retains repeated real mutations across count and byte bounds. The
original 30-second timeout is preserved; the resulting case passes in 5.26 seconds.
This qualifies a bounded correctness fixture, not 257 production writes in that
time. Production writes still perform the complete category inventory.

The sharded disk-account fixture checks the canonical aggregate's quota cause
and exact original cleanup error instead of an obsolete mutable `cleanupError`
field. Its physical-byte accounting, input closure, zero residual quota, refusal
of unreserved copies and unchanged destination controls remain intact.

## Implementation-first queue, validation deferred

The user froze the 360 failures outstanding at `a96699ab0` and requested
implementation attempts for every item before further runtime validation. Seven
of those repairs were already tested immediately before this instruction. The
[per-case implementation queue](windows-360-failure-repair-attempts-2026-10-24.json)
records remaining repairs, existing owner changes and unresolved implementation
work separately. It never promotes an untested change into a passing observation.
The 105/353/1 historical counts remain unchanged until the final batches.

LSP changes through `abe07dcd6` distinguish unavailable commands from denied
execution; reject mutated retained semantic text before routing (producer 48);
retain valid encoded diagnostic positions and document-local memoization; and
update exact fixture command/trust, disposal observation and owned callback
contracts. An invocation without a closed dependency context still runs live
admission, while the Go workspace probe itself retains its cache hit. Known
missing runtime dependencies already have a degraded-admission repair; its
downstream Rust, Elixir, Haskell, PHP and Dart exposing cases await re-test.
The simulated restart races and Pyright health consumer still require work.

The install batch addresses two production faults: tar entry errors can arrive
while an admitted mkdir task waits, before the entry write pipeline subscribes;
and the managed detector's default argument replaced an explicitly thrown
undefined secondary failure with null. The tar parser now observes entry errors
before admitting that task, retains the source failure, and still drains tasks
before cleanup. The detector preserves the exact secondary value. Stock
unsupported-platform installation is rejected before prerequisite provisioning;
an already verified custom executable retains its separate runtime path.

Install fixtures now inspect preserved cause/error graphs rather than expecting
cleanup wording to replace the primary message. Asynchronous reconciliation is
awaited, including exact-resource, missing/unknown-receipt and independent-owner
negatives. Setup download controls intercept the actual async command adapter,
while unrelated commands retain their real owner. The bootstrap target assertions
use canonical repository identity on Windows; auto-install simulation explicitly
trusts its disposable root. Dry-run assertions retain no execution, no writes and
unqualified readiness. Actual incompatible SDK and deliberately failing manager
checks retain their nonzero exit assertions. No install admission budget or
production identity check is weakened to accommodate a fixture.

Formatting is allowed during this phase. Feature tests, setup/runtime probes and
the pre-push front gate are explicitly deferred until every item has had an
implementation attempt; this batch is not acceptance evidence.

Embedding implementation through `888989696` uses the existing promise
keepalive for accepted inline batches, preserves cancellation name/code and
independent observers across consumer teardown, and distinguishes an unmet
pre-close prerequisite from a failed native closer. The latter allows the first
actual close after its prerequisite settles, while captured failed native closers
still require explicit retry. Existing mixed-provenance and unknown-resource
negative cases remain. Deferred adapters expose requested configuration and an
empty observed session list without triggering acquisition; disabled embedding
runtimes retain no qualified artifact claim.

Cache reads now continue to a legacy fallback after a decoded-null primary and
only retarget verified entries. Corrupt bytes remain available to the separate
maintenance owner. Cached dimension mismatches retain their original classifier;
strict quantized byte validation remains. SQLite text storage uses an extended
Windows namespace within the same profile/lease, with a new real deep-path
set/get/close regression awaiting execution. Legacy-schema preparation first
uses the actual producer to establish its profile authority.

Fixture repairs preserve canonical stable chunk identities, complete coverage
and publication negatives; LRU variants keep valid vector dimensions across
consumer workspaces; and observability reads full JSONL events instead of
truncated human projections. Determinism prepares its needed code Stage2 inputs
before both original cold Stage3 content comparisons. The inferred-dimension
case's cancellation frontier is repaired, but its later startup cleanup still
needs work. All 22 embedding failures have now had source-level implementation
attempts. Formatting passes; runtime tests and the front gate remain deferred.
