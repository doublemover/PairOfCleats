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

Semantic implementation through `9438271dc` restores heap-state source anchors
and parameter-field summary inputs, bumping CFG producer 28 to 29. Deferred
enrichment now verifies actual SHA-256 and byte length against the producer's
sealed target piece and manifest; the previous consumer compared that SHA-256
piece to a new xxHash value, rejecting correctly published tasks. Segment, warm
cache and public detail fixtures now use actual canonical segment IDs, source
hashes, repository paths and reference keys. Modeled boundary coverage is checked
on actual output partitions without treating deferred syntax frontiers as
completed work. Coincident Astro map anchors remain rejected and now report
exact conflicting coordinates for the later batch; that repair remains open.

Follow-up `a5ded2052` removes duplicate best-effort startup disposal in Stage3,
uses the single existing cleanup owner and preserves independent cleanup errors
through canonical error context instead of mutating the original provider error.
`695616ebd` replaces fake termination assumptions in reader/writer transport
restart cases with actual owned benign Node children. Replacement is rejected
before closure and admitted only after real child/tree settlement. Cleanup
requires confirmed final settlement; the reap assertion is mandatory and no
startup retry or guessed delay substitutes for evidence.

The queue now records 103/360 attempts: seven previously tested repairs, 75
implemented but unvalidated cases, 14 reviewed existing owner repairs and seven
cases still needing implementation. Remaining difficult cases include simulated
stale-generation/shutdown races, Pyright health context, conflicting Astro map
anchors, ordinary call-target producer integration, and both multi-generation
SSR wrappers. The wrappers retain distinct forward-content and backend-parity
assertions; no duplicate removal or extended deadline is claimed. There are 257
items still unattempted. Formatting passes; no runtime re-test, front gate or
final-tree qualification has occurred during implementation-first work.

Language implementation `38a3cc476` attempts all 16 language-contract failures.
C-like fallback comments match native styles, wrapped declarators retain grammar
identifier roles, and SQL scanner identities survive native source envelopes.
Chunk cache 8/source producer 23 invalidate old meaning. Fixtures prove complete
source coverage separately from actual section ranges and require prepared native
owners for executable calls. Extensionless BUILD now requires its actual resolved
link. Groovy parenthesis-free call publication remains open with added parser
diagnostics; no failing assertion is removed. The ledger records 119 attempts
(90 unvalidated implementations, 14 existing repairs, eight still open, seven
previously tested), with 241 not yet attempted. Formatting passes; runtime checks
remain deferred until every selected failure has an implementation attempt.

Editor implementation `5645aa365` addresses Windows service-drive admission and
compares reopened source identities through consistent descriptor observations
while retaining the original handle. Fake selections/cache APIs and operation
scopes now match the real editor interfaces. Fixtures use canonical executable
paths, an actual repository choice, valid positive depth and offered presentation
actions. Presentation errors retain failed session/original-error evidence. The
removed palette duplicate had identical command/args to retained approximate
Related Search; command membership and duplicate checks stay covered. Existing
VSIX repair `dbe962953` is queued for the original two-package determinism check.
Selected-repository enumeration remains open with new pre-dispatch diagnostics.
All 19 selected editor failures are attempted: 138/360 total, 222 unattempted.
Only formatting has run; no runtime acceptance is claimed.

Storage/artifact implementation `5b6e6e448` and `74c8c215e` attempts 24 cases.
Cleanup preserves explicit thrown undefined and drains independent resources.
Minhash uses its existing packed representation when a JSON companion exceeds
the unchanged admission cap. Bundle-fallback mutations publish new canonical
snapshots before retaining intentionally stale content counts. Semantic fixtures
use valid coverage scopes and source-only ownership without enabling unsupported
extractors. Boundary reads admit the exact positive size and assert default-cap
rejection. SQLite fixtures explicitly select non-Git disposable discovery, real
generation/main-DB paths and actual insert-context schema methods. Existing
canonical-root/source-hash repairs cover three additional semantic consumers.
The determinism-report wrapper uses the smaller sample input while preserving
all report assertions; polyglot parsing stays covered by language owners. Cleanup
now proves mixed evidence preservation and independent producer-qualified cache
removal; neither arbitrary legacy database deletion nor removal of the repos
control parent is an admitted product behavior. Manifest health first proves
no publication, then inspects the explicitly published broken manifest. Skip-write
still requires actual drift evidence, with its original assertions retained.
The ledger now records 162/360 attempts and 198 unattempted; runtime re-tests,
front gate and final-head acceptance remain deferred. Formatting passes.

Retrieval/risk implementation `a39173caf` attempts another 22 failures (184 total,
176 unattempted). CLI fixtures publish actual per-mode generations; direct-loader
fixtures pass their exact authored index directories. Shape/MinHash identities
are current while absent/stale negatives remain. Risk fixtures distinguish local
completion and completed execution from unqualified cross-file coverage; original
flow/cap/path assertions remain. The filter wrapper retains its original three
JavaScript risk inputs in a small fixture and removes success-shaped empty-hit
early returns. Historical fusion numbers now declare their original cosine
calibration explicitly; numerical snapshots and pool bounds remain unchanged.
Candidate-pool qualification selects the actual lexical-rerank path; independent
search no longer needs unused candidate sets. Backend EPERM publication and extra
framework partial frontiers remain unresolved with original-error-preserving
diagnostics. No runtime re-test or final-head qualification occurred.

Report/federation/API implementation `d14c0bbc1` attempts 24 more cases
(208/360; 152 unattempted). Current map cache model 1.1.0 was rejected
by renamed-content recognition restricted to 1.0.0. Shared producer identity and
discovery policy 5/ignore-rules 3 now invalidate affected replay. Compact output
projects SQLite's metaV2 chunk identity before discarding metadata, preserving
cross-backend comparisons with different local ordinals. Model fixtures carry
actual file hashes; summary fixtures declare stable identities and retain the
unscoped-ordinal negative. Windows graph/render mocks use canonical paths.
Federation fixtures establish independent Git members, canonical generations,
valid public error classifications and actual descriptor-read instrumentation.
Selected bench logs include a real material parity discrepancy; throughput
positives publish contained pointers and independently reject external roots.
API fixtures request eager compiler bindings instead of expecting qualified
joins after explicit manual deferral. Existing f5334185b queue-close repair owns
original abort propagation. Cold-build cleanup retains its 15-second deadline
and all reaping/deletion assertions; closed ambient inputs and better diagnostics
are implemented, but timing closure remains unresolved. Formatting/diff checks
pass; runtime acceptance and the front gate remain deferred by instruction.

Runtime/shared/map implementation `24b2f50aa` attempts 25 additional cases
(233/360; 127 unattempted). File-stat cancellation now joins active reads through
native close without retaining the whole input history. Dictionary readline
interfaces keep an error observer through actual close; Windows dictionary
owners compare canonical roots. Scene recovery preserves earlier native errors
when a later prerequisite fails, and registers synchronous parents after child
failures. These lifecycle repairs remain unvalidated, including normal-map,
partial/shutdown and preview closure cases. Pino's empty level fragment produced
invalid JSON in redacted ring metadata; a valid synthetic fragment is removed
without removing caller-owned level fields. The generated metadata registry now
includes graph_relation_edges, with policy 6/ignore-rules 4 replay invalidation.
Fixtures distinguish initialization from observed execution, explicitly suspend
parent compute, retain exact PDF/subprocess failures through wrappers, declare
cache/autotune identities and protect unknown GC inputs. Map fixtures publish
registered shard metadata, use actual Three attribute storage, accept distinct
typed IDs and still reject exact typed duplicates. History a44f06fb28 proves
typed saved-input identity was intentional. Graph fixtures retain provenance
negatives, compare actual selected source and count four candidate witnesses
from two capped two-target symbols (80 total, 12 when call/import are filtered);
all CSR/legacy, direction and cap comparisons remain. Formatting and diff checks
pass. Runtime checks remain deferred until every queue item is attempted.

Dense/service implementation `7c5deebc1` attempts 12 cases (245/360; 115
unattempted). LMDB no longer interprets sharded dense-row declarations as a
requirement for disabled binary metadata; malformed declared binary families
still fail. Lance Int64 ordinals remain bigint and native writer fault coverage
asserts all three independently reported variants. CLI/HTTP/MCP enumeration
publishes its authored index; direct cache signatures select their exact index
root and permissive-policy fixtures still supply canonical format authority.
EXDEV injection follows only the original source through normal replacement
policy; the distinct same-volume staged rename succeeds. The HTTP edit-source
fixture now proves synchronous ambiguous-close retry is refused, then physically
closes its harness-owned descriptor without forging a production receipt.
Semantic HTTP coverage first retains integrity failure (500), then reseals the
unsupported-format artifact to exercise the original 409 contract. Scoped MCP
GC owns generated inputs while the other repository's unknown bytes survive;
its core-build mock now owns integrated SQLite work instead of requiring a
duplicate adapter stage. Status overloads compare canonical Windows identity.
Formatting/diff checks pass; all runtime acceptance remains deferred.

Parser/import implementation `8a6aebbe9` attempts 22 cases (267/360; 93
unattempted). CSS reports elapsed-time exhaustion from token/match/line admission
as scan_time; import semantic producer is 16. Default phrase hashing is admitted
when configuration omits the default-true switch. Bounded report discovery keeps
current roots ahead of historical caches. Bazel resolution records attempts as
well as hits/misses; its fixture adds an ordinary missing-file input for real
filesystem-probe coverage. Missing source imports on test surfaces remain
actionable; a separate asset retains positive fixture classification. Native
fixtures use prepared Perl/Ruby/Kotlin chunks, grammar-valid Kotlin separators,
qualified XML/YAML names and actual Python scope identity. JS/TS export arity
uses parser-owned callable and operand facts. Quantization rejects mismatched
dimensions rather than truncating and preserves empty/null channels. Git mocks
produce NUL-delimited paths. Crash evidence uses the attempt logger directory;
the reader-close wedge retains its real FileHandle and explicitly releases it
after bounded timeout assertions. CDC expects its current byte-bounded producer,
and VFS cleanup protects sibling collectors. Formatting/diff checks pass; runtime
tests remain deferred until all 360 cases have implementation attempts.

Retrieval/provider implementation `3976af8e7` attempts 18 more cases
(285/360; 75 unattempted). Direct call-name candidates now honor their name cap,
and BM25 reports fielded ranking only when actual field postings exist. Local
and federated query-cache versions advance to 9. Literal propagation fixtures
use parsed declarations/arguments and canonical symbols; import-only valid TS
syntax is independent from declaration presence. Provider fixtures select actual
fixture commands/trust and admit the existing structured-preflight log path.
MinHash declares its current hash identity; partial-rank reports use stable UIDs.
SARIF validates its unchanged official schema with ECMA regex syntax; cancellation
asserts the owning API's typed contract. A hostile source proxy permits only the
Promise thenability lookup before passive descriptor admission. VFS cleanup owns
its collector child, and close-timeout coverage uses exact bytes plus retained,
explicitly released real handles. Structural pending failures remain asserted
through preserved error graphs. Markdown code fences now explicitly consume line
terminators. Module-export replay still needs root-cause closure: new assertions
identify the exact language/function and distinguish missing parsed calls from
missing summaries while retaining all export/type-only barriers. Formatting and
diff checks pass; runtime acceptance remains deferred.

Fixture/qualification implementation `5082b2248` attempts 29 more cases
(314/360; 46 unattempted). Embedding packing keeps the strict source-order
improvement and same-call-count controls now that ungrouped inputs also use
the optimizer. Mapping rejects unrelated vectors after invalid stable identity;
chargram assertions compare the full selected set and independent negatives.
Lance variant coverage follows current direct/isolated owners without retrying
failed variants; real crash/protocol continuation remains covered by
indexing/embeddings/backend-isolate-job-ownership. Provider fixtures cover
strongest capped facts, pre-probe missing-command discovery, trusted fixture
roots, explicit external C# selection and exact nested pending failures. Nine
Node wrappers now use the existing timeout/reaping helper with unchanged spawn
options. The download redirect mock owns actual response close events. Snapshot
fixtures bind manifest/index-state/build-state IDs, and stage3 uses its selected
repository namespace. Invalid pointer/mode roots stay negative; repair requires
explicit valid mode authority, never directory-mtime fallback. Path/triage checks
compare canonical Windows identities. Eval datasets qualify code/prose labels
and report mocks retain their original cache/display cleanup methods. Nightly
main discovery uses all discovered non-delegated cases with a 30-second bound;
serial/API/script/soak cases keep separate owners. The roadmap preserves Gate B
controls without reviving historical green claims. Search-option drift, command
profile distinctions and provider-cache inventory timing remain unresolved
after these initial repairs. Formatting/diff checks pass; runtime tests deferred.

Storage/retention implementation `03b620261` plus analysis-option ownership
`11d9f2c64` attempts 22 more cases (336/360; 24 unattempted). Configuration
preview was invalidated by its own home/config lock preparation. Apply now
validates before preparation, records only directories it created, and checks
those original ancestor identities after lock admission. External source or
destination ancestor creation still fails; new CLI negatives preserve both.
Watch retention counts unpinned attempts independently from published modes,
while rereading pointer authority before deletion. Recovery uses canonical
repository identity so direct/core plans compare exactly; full immediate error
evidence and bounded durable-result coverage remain. Promotion cancellation
starts with a valid pointer, read faults use the actual descriptor boundary,
and incremental freshness uses actual source hashes. Zero-state coverage has a
canonical source proof/checksum plus a corrupt-marker negative. Discovery's
missing candidate precedes the good file under deterministic sorting, and IPC
assertions compare the message payload separately from Node's handle argument.
Impact fixtures publish their mode root; navigation compares exact opens/closes,
SCM cancellation stays typed, and EXDEV injection follows only its original
source through replacement retries. Structural fixtures copy owned commands
into their disposable trusted repo, include Windows launchers and identify
valid fixture versions. Records distinguish unsupported format errors from
current-format corrupt products. Analysis option declarations move to their
library owner without public surface changes. Graph-capability closure, delta
checkpoint behavior and remaining keyword-language routes remain unresolved
after strengthened attribution. Formatting/diff checks pass. PR #572 summary
was refreshed/read back at `11d9f2c64` after 20 commits, preserving all 141
closing references. Runtime tests remain deferred until every item is attempted.

All 360 initial implementation attempts are recorded at source `c14273391`.
This is not 360 fixes or passing tests: 308 authored repairs await re-check,
25 causes still require implementation, 20 cases have existing owner repairs,
and seven were tested before the deferral instruction. No new runtime checks
have run during implementation-first work.

Final implementation commits `1df6f55ab`, `4a226f59c`, `fb2102bb7` and
`c14273391` close emitted completion contracts, restore selected progress
handlers, give append-writer close independent scheduler ownership, emit LMDB
report root identity, and qualify disposable SCM/compiler/cache inputs. Risk
fixtures declare complete input coverage; changed filter inputs cannot advertise
a stale filter piece. Hybrid pagination retains its default-budget rejection
and explicitly selects the existing larger output budget for its 100-hit
positive. CI restore retains actual pack/restore execution against bounded
code/prose inputs. Existing VSIX extension and enrichment digest repairs match
the original failures.

Five final analyses remain unresolved: three readonly diagnostics allocate
reader cache/lease directories before publication; shared-module review files
need substantive reconciliation with current inventory; and superseded map
navigation inspects original error getters while retaining prerequisites.
Original negative/authority/content assertions are preserved. Formatting and
diff checks pass; native verification and explicit batch validation follow.

The complete initial-attempt re-check froze source `1aa6e757e743dcb113b360783d004649bf019ff9`
and executed all 360 exact discovered IDs in explicit cohorts: 260 passed,
100 failed including seven timeouts, zero skips, zero access violations.
No fixture was omitted. Native lifecycle/performance cohorts ran serially;
other correctness cohorts used at most two jobs. Every fixture had a 30-second
deadline, zero retries, native-status redo disabled and one indexing-thread
environment hint. Fixture configuration can override that hint; no claim of
a globally capped native worker pool is made. Raw logs under author-workspace
`.tmp/tasks/windows-failure-repairs-20261024/candidate-1aa6e757e743dcb113b360783d004649bf019ff9`
are historical and unavailable in clean checkouts. The committed JSON receipt
retains exact selection, source, outcomes, durations and local evidence paths.

Native/patch verification exited 0 without warnings/errors before execution.
The complete front gate passed, including 40/40 gate fixtures. Its initial
command-surface attempt exposed a missing launch-selected trusted-config file;
validation children omitted that stale setting without granting replacement
trust or changing machine configuration. The corrected command-surface check
and workflow contract passed. Remote branch and PR head were verified at
`1aa6e757e`; GitHub returned an empty check rollup, not a hosted CI pass.

The next source wave addresses demonstrated owners before focused re-checks:
Windows mkdir return casing must compare paths with Windows semantics; missing
cache diagnostics must select paths without allocating reader leases, while
existing data retains cleanup exclusion. Empty symbol occurrence/edge families
now publish explicit zero rows through their normal writers (pieceAssembly 4).
Watcher generations enter an independent scheduler owner. Logical dense JSONL
rows use the same manifest's index-state identity/codec and strict count/width
checks before LMDB opens; null dense rows retain their validity-mask meaning.
Grouped batching is bounded by the actual optimized ungrouped alternative.
A timed-out command probe cannot retry alternate help/version forms; ordinary
nonzero exits retain their alternatives. Parent structured logging preserves
complete child diagnostics. Existing map preview flags reach the tool through
strict dispatch; nightly canonical replacements have one execution owner.

Fixture repairs retain exact source/query assertions: canonical GC repository
IDs retain the unowned-data negative; map HTML checks decode its actual SVG;
report precedence uses the producer's actual outFile; request runners close
their borrowed store; VS Code invokes the user-selected installation while
keeping the nested repository target. Error negatives assert typed outcomes
and exact missing paths. Symbol determinism builds its code mode twice, and
the cross-mode UID fixture stops after stage2; all original content comparisons
remain. These checks do not require extra unrelated prose/records, ANN or
SQLite work to establish their respective assertions. New repairs remain
unvalidated until the next focused cohort.

Historical context moved from the active roadmap to preserve its size bound:

After the 2026-10-23 remote history cleanup, commit `59fde1d2d` fixed provider
record projection, same-line repo-map source identities, Windows embedding stage
paths, SQLite dense encoding admission and stale fixtures. The attempted warm
compiler replay case omitted its original 2 GiB admission allowance and does
not establish a replay defect. A frozen Windows campaign at that commit covered
most explicit cohorts but exposed many failures and stopped during repeatedly
failing native TUI cases; it is historical evidence, not final-tree acceptance.

### First focused follow-up and Windows path repair

The source-bound [43-case follow-up](windows-targeted-rechecks-2026-10-24.json)
at `60dbba13fc856253c69b560867c71184f907e65e` passed 34 and failed nine,
with no timeouts, skips or native crashes. It moved 22 of the initial 100
failures to passing; 78 original cases still lack passing closure. The complete
front gate at that source passed, including all 40 gate fixtures. These earlier
observations do not qualify later source changes.

The next implementation wave corrects the earlier mkdir diagnosis: Node returns
an extended `\\?\` path from recursive mkdir on this Windows installation.
Comparisons now use the same namespace and Windows path semantics while file
identity and containment checks retain their original owners. SQLite zero-state
admission proves equivalent selected absolute paths, then hashes current source
bytes with the producer's exact sealed spelling. Checksums, source generation,
mode and different-directory rejection remain enforced. A Windows regression
exercises namespace/case equivalence and re-signed wrong/relative paths.

The physical dense binary writer retains null-row padding and validity masks,
while validating every nonnull row. Parent-owned CLI framing receives complete
child diagnostics. Fixture cache selection now reaches both in-process and CLI
workspace authors; ANN doc coverage supplies documentation inside the indexed
span, and provider overrides explicitly trust their actual disposable root.
Nightly retirement coverage resolves every discovered canonical case, preserving
the no-duplicate guard. LSP stale-child tests adopt the current structured spawn
contract and retain actual child reaping and settlement assertions. These new
repairs await the next focused batch.

The 14-case follow-up at `fc7b3ea5a5be9dfebd3e0dd05f89aeb91e2b57a3`
passed nine and failed five, without timeouts, skips or crashes. Six more
original failures acquired passing closure (28 cumulatively; 72 still open).
Configuration, SQLite zero-state, both actual ANN variants, command override
and nightly dispatch checks passed. The source-bound JSON preserves every
result, including both stale-child fixtures' newly exposed restart backoff.

The next source wave leases each declared managed child directory as well as
its profile/category owners; diagnostic inspection and exact-target cleanup
therefore see the active routed cache. Workspace enumeration now reaches its
existing federated coordinator instead of an obsolete CLI prohibition. Child
embedding diagnostics use the existing JSONL protocol and decoder, preserving
full log messages before parent formatting while forwarding task progress.
Verbose human mode is still width bounded and was insufficient for transport.

TypeScript keyword filtering now distinguishes a bare keyword from a valid
qualified member such as `ns.default`. Native Kotlin calls use their grammar's
unnamed first child; Perl calls use function_name/package_name fields and keep
the canonical qualified target. SourceChunking 24 invalidates those changed
facts. Compiler completion work accepts the normalized zero-iteration policy
as partial coverage without processing a state (cfgFlow 30), retaining invalid
negative and noninteger budget rejection.

Fixtures exercise actual candidate reuse by selecting lexical ANN reranking
and matching ngram inputs, retaining exact result/score comparisons. RRF
snapshots retain rank-only explanations; calibration additions apply only to
blended scores. Replay fixtures inspect current format-qualified provider
cache files and canonical argument slots, preserving all source-change and
unknown-literal negatives. Delta inventory explicitly selects deterministic
stub identity, since an unqualified artifact cannot authorize cache writes.
MCP scoped cleanup retains a positive deletion control and adds explicit zero
limit rejection. Stale-child fixtures observe configured backoff after actual
resource closure, without retries or a longer deadline. This wave is pending
focused validation.

The 19-case follow-up at `4b86182818b8755b0d8d6503a73e2e2a784930d5`
passed 15 and failed four, with zero timeouts/skips/crashes. Twelve more original
failures gained passing closure (40 cumulatively; 60 remain). Exact routed
storage protection, complete child diagnostics, both actual stale-child
lifetimes, qualified TypeScript calls, Kotlin/Perl roles, pooling, provider
source-byte replay and scoped MCP cleanup passed. The complete front gate also
passed at this source, including 40/40 gate fixtures. Remote and PR source/body
were verified after push. Hosted CI at preceding `60dbba13f` failed its POSIX
Git-child SIGTERM assertion; downstream jobs were skipped, while policy passed.
No Linux execution was performed locally.

The next implementation wave repairs cancellation telemetry: a drained writer's
abort used to bypass both its final statistics and the terminal runtime update.
Statistics now capture in finally; independent drain failures retain context
and terminal persistence remains separately attempted. Text-vector cache misses
caused by invalid physical rows or failed reads now discard the previous digest
memo, allowing successful inference to repair the rejected row. The corruption
fixture flushes queued writes before editing actual SQLite bytes and retains
all ten corruption controls, miss counts, hit counts and width/nonfinite tests.

Fixture repairs follow existing owners: workspace filter enumeration drains its
documented repository cursor; SDK MCP children receive the fixture environment
instead of the SDK's restricted default environment. Delta checkpoint/profile
authority is established before synthetic shard data, rather than trying to
adopt an already populated unmarked profile. The artifact semantic store already
closes readers per scoped operation; an incorrect new close() call was removed.
Lazy model observations assert absent pre-acquisition authority and then require
a distinct actual unknown-model load. Sibling pipeline sharing is tested after
both leases acquire their resource, and TTL observation spans asynchronous
acquisition. EG2 positive mocks supply required typed input IDs/masks while
retaining strict malformed-input coverage. Mapping collisions retain refusal
and assert their actual boundaryMismatch reason. This wave awaits focused tests.

The 13-case cache/observation follow-up at
`8944d1e483f436c2428422f65619aeea21bc9bf6` passed ten and failed three,
without timeouts, skips or crashes. Eight additional original failures gained
passing closure (48 cumulative; 52 remain). The actual cancellation receipt,
corruption loop, profile/delta inventory, workspace cursor, CFG, warm model
lifetime and quantized sibling controls passed. The admitted token/tensor
resource negatives also passed. This evidence belongs to that exact source.

The next wave makes a deferred adapter's unsupported post-acquisition load
observation explicitly unknown; it cannot retain its pre-acquisition false/load
flag forever. An EG2 query-cache fixture now supplies its selected model cache
root so immutable profile authority can be resolved consistently. The public
enumeration fixture includes response error details for the remaining
cross-surface cursor rejection instead of hiding its HTTP 400.

LSP generation fixtures enforce actual previous-child settlement before restart.
The old-write race holds a real writer callback until after replacement, then
rejects it and checks replacement requests and transport remain live. Deferred
old server replies remain delayed until after replacement as well. Shutdown
tests emit exact original close events and retain the no-respawn/no-exit-to-new-
transport assertions. Managed-command recovery checks retained pending/cause
authority rather than matching the outer diagnostic wording. The subprocess
barrier fixture installs its module hook before test-env imports the tracking
owner and asserts the controlled owner was actually invoked. These controls
retain all release, unrelated-owner and original-identity negatives.

The seven-case follow-up at `7705d94030edbfbc0ea462bedf2721b1fb7d2073`
passed three and failed four, without timeout/skip/crash. Unknown model execution
observations, closed-transport shutdown and frozen managed-command recovery
passed. Original failures without source-bound passing closure now number 49
(51 moved to passing). Remaining errors exposed a stale EG2 runtime diagnostic
expectation, missing explicit fake-child close events, termination-hook admission
and a real cross-surface cursor generation mismatch.

Cursor identity now keeps the selected canonical index directories and current
artifact signatures while excluding invocation-only generation context. API and
direct CLI calls over the same physical generation can agree without lending a
cursor to a different root. Ranked-query cache metadata retains its existing
generation context. The original public continuation, invalid-filter and
changed-generation assertions remain intact.

C tag declarations directly owned by a grammar declaration container and
followed by its semicolon are retained as forward declarations; parameter and
object references remain excluded. Single-document inline YAML maps retain the
existing root chunk name instead of an artificial document-zero label. Native
chunk version 9 and SourceChunking 25 invalidate the changed extraction. The
Objective-C native suite asserts the actual signed selector `Widget.-greet:`.
Fake protocol-child tests now explicitly emit the close events their zero-PID
inert processes cannot obtain from an OS kill; separate actual Windows child
fixtures retain OS termination qualification. This source wave awaits tests.

The 15-case cohort at `c470cea9bfaec4ece13c10a20c1d27cbb8af045c`
passed eight and failed seven, with no timeouts/skips/crashes. C declaration
roles, YAML boundaries and EG2 contracts passed. The native suites reached a
later stale HTML name expectation. Cursor regressions exposed two enumeration
constructors using different payload projections; `filter-only-cli` regressed
and the adjacent real federation control also failed. Both remain recorded as
failures, not inherited greens. The original 100 now have 53 source-bound
passing closures and 47 outstanding; the adjacent federation failure is tracked
separately. The full front gate at this source passed (40/40); its pass did not
qualify these broader behaviors. The source and PR body were verified after push.

The repair centralizes cursor projection in createFilterEnumeration, shared by
the loader and search-session constructors. Only producer payloads with proven
canonical roots normalize invocation context; other generation representations
retain their original exact identity. The LSP writer-failure classifier now
passes an explicit boolean: missing write evidence is a transport failure, not
an undefined argument that accidentally selects the request-local default.
The existing current-writer negative retains its typed transport expectation.

The subprocess fixture now uses a bounded isolated child after removing only
the canonical runner's test-env preload. That preload had already cached the
real termination module before fixture hooks; moving a normal import could
not repair it. Other Node options, test environment and setup remain intact.
The fixture still asserts actual controlled termination invocation, pending
writer protection and exact close negatives. Native HTML expectations retain
all elements using their canonical qualified names. These latest repairs await
the next focused cohort.

The 15-case closure follow-up at `4ae5ed7ec605556138a3fe7aadfe32ea4cdf899a`
passed 13 and failed two, without timeouts/skips/crashes. All cursor, cache,
real federation, C/YAML declaration, native language/smoke and subprocess barrier
controls passed. The adjacent federation regression is closed at that source.
Original passing closures total 57; 43 original failures remain. Public cursor
continuations now reach a later Python fixture import problem. The LSP current-
writer control exposed that request rejection still always selected the local
error code even after transport classification was corrected.

The next source repair preserves ERR_LSP_REQUEST_WRITE for local serialization
failure and uses ERR_LSP_TRANSPORT_CLOSED for a retired/unknown transport, keeping
the original error graph. Python payload coverage imports the actual package
through the existing headless Sublime harness instead of runpy without package
context. Semantic FileHandle fault controls compare equivalent Windows paths
in the same namespace so the actual targeted read/close is intercepted.

Dart's grammar places function_body beside its declaration signature. Native
call traversal now aliases that exact sibling body to the existing declared
owner and recognizes bounded argument-part selectors. Calls keep source-owned
ranges, qualified/dynamic targets and existing unavailable argument-count
coverage; no file-wide lexical fallback is introduced. Native call-fact version
6, native chunk version 10 and SourceChunking 26 invalidate previous extraction.
The existing managed-adapter test requires an actual native caller and the
original source occurrence. These changes await focused validation.

The 12-case follow-up at `277508fb31961cc97a6a4f3c54534d50cd895dd8`
passed nine and failed three, without timeouts/skips/crashes. Public CLI/API/GET/
MCP/viewer/editor pagination and generation negatives passed; the delayed LSP
generation race, targeted explanation lifetime, Dart preparation and native
call controls passed. Sixty original failures have passing closure; 40 remain.
The adjacent partial-frame LSP control exposed an error-code regression and is
tracked separately rather than being counted green.

The next repair keeps a request's own partial-frame write error distinct from
siblings losing that transport. Canonical abort helpers retain ABORT_ERR and
AbortError while preserving the original reason (including falsey reasons or
reason-inspection failures) as a non-enumerable cause. A focused new helper test
covers immediate/in-flight abort, retained native ownership and live success.

Groovy control bodies are distinguished from anonymous callable closures using
their exact grammar parent/field role. The parenthesis-free positive keeps an
actual juxt_function_call node; a recovered one-line form remains explicitly
partial and cannot invent invocation facts. Native call/chunk versions 7/11
and SourceChunking 27 invalidate changed ownership. The VS Code enumeration
fixture disables unrelated inline background commands using its existing
settings while retaining selected-resource, continuation and trust assertions.
These changes await focused checks.

The 14-case follow-up at `2bd168e50d2032045478767e3a0188762a5816f5`
passed 12 and failed two, with no timeouts/skips/crashes. Abort provenance,
partial-frame/current-generation LSP controls, Groovy control bodies, selected
VS Code resources and actual abort/reaping regressions passed. The adjacent
request-local regression is closed. Sixty-two original failures have passing
closure; 38 remain, with no separately observed adjacent failures outstanding.
The complete front gate passed at this source, including 40/40 gate fixtures.
Remote and PR head/body were read back after push, preserving 141 closing
references; the new head initially had no hosted check results.

The remaining retained-source fixture's final positive now uses its established
explicit response allowance; its own preceding assertion proves the boundary-
crossing source exceeds the unchanged default. Groovy's actual juxt invocation
is exercised in a supported top-level closure body, while recovered class-method
syntax remains a negative that must not invent calls. The grammar's declared
partial capability is preserved; this does not qualify every Groovy syntax form.

Snapshot fixture manifests now include their canonical mode as well as build ID.
Import fixtures retain original queries: source-like build outputs remain
unproven, non-module generated assets retain the positive, and TypeScript emit
projection requires its actual indexed counterpart with a missing-counterpart
negative. Pipeline counters distinguish Bazel build resolution from the one
JavaScript language-resolution attempt rather than counting bypassed work.

A demonstrated risk producer defect returns ok when maxTotalFlows=0 leaves
source roots unsearched. It now reports partial and the cap reason, retaining
zero emitted rows and the existing timeout/depth controls. RiskPropagation 6
invalidates old derived status meaning. This wave awaits focused validation.

The 11-case follow-up at `6d08b130ff157bfb00692bb19e0855d34c522e48`
passed nine and failed two, with no timeouts/skips/crashes. Retained-source
bounds, native Groovy ownership, frozen mode provenance and the complete
five-case risk control group passed. Sixty-six original failures have passing
closure; 34 remain, with no separately observed adjacent failure outstanding.
This is source-bound closure evidence, not final-tree acceptance.

The next fixture repairs use the actual generation-local SQLite/LMDB paths and
an explicit Bazel BUILD declaration. API fixtures retain eager real compiler
bindings and all CLI assertions while excluding independent legacy cross-file
type propagation; the production owner runs semantic work before, and outside,
that legacy flag. LSP evidence assertions distinguish the actual structured
observation partition from the definition-binding partition. Framework risk
coverage compares both independently blocked paths rather than a stale count.
These changes await the next focused cohort.

The 15-case follow-up at `5cc02a6a66dfd40ffe0a76e7eb36137f050e7f0d`
passed four and failed 11, with no runner timeouts/skips/native crashes.
Snapshot freeze, frozen mode provenance, Bazel authority and LSP evidence passed.
Sixty-nine original failures have passing closure; 31 remain. All eight API CLI
cases still hit the unchanged 10-second build abort during stage snapshot
publication, so excluding unrelated legacy propagation did not close them.

Download reconciliation exposed a real secondary-error graph omission. The
producer now preserves the actual teardown error alongside the original byte-
limit failure; the fixture requires the exact thrown object, retained storage
and eventual real release. Pyright's fixture explicitly retires its healthy
pooled server before changing the launch-only simulated mode, retaining persisted
health identity and recovery assertions. Framework risk coverage retains the
terminal modeled flow frontier and both distinct argument-evidence gaps.
These latest changes await focused validation.

The eight-case follow-up at `62691aea51b8d26198a43555f51b7e85da3db1a3`
passed six and failed two, with no timeouts/skips/crashes. Installer storage
lifetime, Pyright source/config recovery, framework frontier content, LSP
evidence and risk cap controls passed. Seventy-two original failures have
passing closure; 28 remain. Two adjacent download controls exposed exact-error-
identity regressions from the attempted graph repair; those are recorded as
failures, not accepted. The refinement preserves the direct download producer's
original error object and adds the actual teardown edge only at the outer
installer context boundary. It awaits the next focused check.

The index-state writer previously hashed and queued state before filter-index
physical metrics settled, then mutated the shared stats object afterward. State
construction now runs through the existing write planner only after primary
artifact completion and metric collection. Both dispatch phases preserve the
shared scheduler, publication registry, telemetry and cumulative write count.
No-op cleanup is truthfully not-required before and after publication; actual
cleanup still remains staged until the publication owner commits it. The fixed-
point test retains marker migration, content/meta hashes, determinism and missing-
file recovery, and now checks the actual filter-index byte count and snapshot.
This source repair awaits its focused publication controls.

The 12-case follow-up at `eab4aabb9add7494131fe260a419c67e16a6c60e`
passed all 12, with no timeouts/skips/crashes. Both adjacent direct-download
identity regressions are closed; actual installer teardown/storage release,
Pyright recovery, modeled risk frontiers, index-state stable writes, cleanup
transactions, immutable-generation rejection, publication records, copy lifetime
and full JSONL stage3 observability passed. Seventy-four original failures now
have source-bound passing closure; 26 remain. No separately observed adjacent
failure is outstanding. This is not a final-tree or full-suite acceptance claim.

The complete local front gate passed at `3345becd36fc619c20a0ab7f7f09060fde900e8c`
(format/lint, config budget, environment, generated surfaces, commands, workflow,
40/40 gate cases and whitespace). That head was pushed and remote/PR head/body
were read back, preserving all 141 prior closing references. Hosted gate was
still running at readback. Its separate five-case source/bundle follow-up failed
all five without timeouts/skips/crashes; original closure remains 74/100.

Further diagnosed owners: C# native invocation_expression was absent from the
shared call-role set despite complete-supported coverage. The actual grammar
role and nested-lambda exclusion now have a native projection regression;
call/chunk versions 8/12 and SourceChunking 28 invalidate prior extraction.
Keyword expectations retain qualified native receiver names rather than leaf
aliases. SQLite fallback fixtures now decode/encode compact manifests through
the canonical codec, retaining dependency-table identity before immutable
replacement and deliberate content/count faults.

Implicit accessor updates now bind to the retained ++/-- operation when lowering
provides no independent property-expression row (CompilerBindings 24). The
transparent-alias fixture checks actual per-target parameter/return channels;
explicit direct-call target edges belong to compiler bindings, whose source
owner establishes them before cross-file flow. No target/call-site comparisons
were replaced by aggregate counts.

The pinned Astro compiler demonstrably emits conflicting zero-width anchors at
stripped frontmatter and generated wrapper boundaries. Only the live pinned
adapter may retain these as coarse intervals with no usable original spans;
external/serialized maps still reject conflicts. Exact declaration/use spans,
source identities and unsupported authority negatives stay required. Adapter 2
invalidates changed qualification and every parsed segment consumes point budget.
These latest source/fixture changes await the next focused cohort.

The 12-case follow-up at `2a6c443770a26dc0f480774a6a2c49e1ded577ae`
passed 11 and failed one, with no timeouts/skips/crashes. Both SQLite content/
count fallbacks, snapshot binding negatives, accessor update references, source
alias parameter/return channels, destructuring/iteration controls, qualified
keyword calls and Astro exact/ambiguous map checks passed. The added C# scope
control used the wrong context key: its registered adapter owns csChunks, not
csharpChunks. That helper defect is corrected without changing extraction.
Seventy-nine original failures have passing closure; 21 remain.

Official VSCE 4.0.0 rewrites README.md to extension/readme.md (installed
ReadmeProcessor); release verification still required the old uppercase ZIP
entry. Its exact required path and malformed-archive fixtures now use the actual
container spelling; no case-insensitive archive admission is introduced. The
Sublime navigation fixture now supplies real disposable source/target bytes,
actual hashes, UTF-16 ranges, stable source version and operation scope to the
existing qualified navigation path, preserving definition, reference, completion
and empty-result behavior assertions. These changes await focused validation.

The nine-case follow-up at `bb44d9d04c1c832a258977cee1f23fc39e55e158`
passed seven and failed two without timeouts/skips/crashes. C# native scope,
actual official VSIX/Sublime archive qualification, output paths, package
contracts and existing navigation/editor lifetime controls passed. Eighty-one
original failures now have passing closure; 19 remain. An adjacent malformed-
archive fixture retained an uppercase regex after its ZIP path changed; that
is corrected. Navigation helper checks now preserve actual line-only encoded
opening and distinguish approximate completion's existing search command from
source-qualified definition/reference navigation. Those refinements await checks.

The five-case refinement at `5459d486ee55b6558af99e270396c2c67058cbbd`
passed four and failed the navigation helper's two mixed-separator expected
paths, without timeouts/skips/crashes. Both archive fixtures, existing navigation
lifetime and C# scope passed. The adjacent archive regex regression is closed.
Original closure remains 81/100. Navigation expectations now construct paths
from separate native components while preserving exact line selection. The
Sublime matrix retains every helper/assertion and aggregates failures only after
executing all helpers, so an early failure cannot hide later repair work.

Swift enrichment diagnostics proved its fixture launch had lost its explicit
repository trust grant when applyTestEnv sanitized inherited test settings. The
positive now explicitly forwards only the helper-granted disposable root and
restores the parent grant in finally. No global trust preservation, security
setting, arbitrary command authorization or untrusted-provider relaxation is
introduced. The existing tooling-source assertions and trust negatives remain.

The four-case follow-up at `ef0ecda4677c097dfa4be85c0a7297fdf894f4dc`
passed three and failed the full Sublime matrix, with no timeouts/skips/crashes.
Swift tooling enrichment, SourceKit passive/trust controls and qualified
navigation lifetime passed. Eighty-two original failures have passing closure;
18 remain. Aggregating the editor matrix exposed five older helper groups,
including missing current-source hashes, no selected settings repository, stale
search/cursor mocks, missing headless host modules and PID-less termination
expectations. Those helpers now retain actual host/source contracts. Inert
runner-state positives explicitly select their controlled tree owner, and an
unconfirmed-tree negative preserves cleanup_unconfirmed after parent exit.
These are unit controls, not native Windows descendant-reaping qualification.

One intrusive filesystem profiling attempt changed descriptor observations and
is discarded as runtime evidence. Passive Node FS trace and CPU profiles retained
the original API build timeout. They show substantial synchronous path checks
and stage snapshot publication work. API report/join fixtures do not consume
completed-stage recovery snapshots: the normal stage1 pipeline runs their same
explicit eager compiler binding pass and ordinary generation publication. They
now select that production stage while explicitly preserving native parser
selection, original source fixtures, positive/negative joins, and unchanged
10-second build/5-second CLI bounds. SSR witnesses likewise select ordinary
stage1 publication for typed-array snapshot/MessageChannel semantics; their
rich eager analysis and existing backend selection are unchanged, and the
general published-witness helper retains its stage2 default. Existing real
stage2 SQLite, recovery and copy-owner controls remain separate. No production
path/ownership validation, stage2 implementation or deadline was weakened.
These scope refinements await full affected-case validation; no speedup or
passing observation is inferred from diagnostic profiles.

The 16-case follow-up at `8a1d21e1e45088ddd48e911cf87515bdff6903f5`
passed six and failed ten, with no timeouts/skips/crashes. The complete Sublime
behavior matrix and all three source-lifetime controls passed, as did copy
lifetime and completed-stage recovery. Eighty-three original failures have
passing closure; 17 remain. The stage1 experiment is rejected: it omits required
call_sites artifacts and semantic witness channels despite eager configuration.
All eight CLI cases and both SSR assertions remained strict and failed. Their
original stage2 selection is restored; the unused helper option is removed.

The next scope refinement excludes tsconfig/package metadata only from indexed
witness rows, keeping the actual files present as compiler configuration/module
dependencies. SSR inputs select ES2022 libraries because their real sources use
Node MessageChannel/typed arrays and no browser globals; Node type dependencies
and rich analysis remain. All original stage2 content assertions/deadlines stay.

Remote map navigation now retains scene/cache prerequisites for stale failures
without touching their message/name/code getters. Default active error capture
still inspects diagnostics once, preserving independently owned inspection
failures; passive captures can upgrade if later selected for diagnostics. A new
regression requires both original scene and cache channels to close independently
while stale diagnostic getters remain unread through retirement. These changes
await focused validation; no stage2 performance improvement is yet established.

The 12-case follow-up at `cd69811d0ba88b0fe1d3b11d061ba7630670a213`
passed seven and failed five (two runner timeouts), with no skips/native crashes.
Remote map navigation and independent stale scene/cache closure passed. A
neighboring default diagnostic test caught ordering drift; eager capture now
retains its original diagnostic-before-metadata order. A passive-to-active
upgrade regression retains a newly observed diagnostic resource until its own
cache channel closes. Original closure totals 84; 16 remain, with the adjacent
map diagnostic control awaiting its corrected-source re-check. Both SSR cases
still exceeded 30 seconds; metadata/library scoping did not close their bounds.

A real API producer defect is now demonstrated by the required join assertions:
compiler-session stores an established compilerBinding, but only the optional
legacy propagation pass synchronized it into calleeRef/targetChunkUid consumed
by call_sites. The existing exact projection is extracted into one small leaf
and used immediately by the compiler owner as well as legacy propagation.
Resolved, ambiguous and unresolved candidates keep the same projection rules;
no heuristic target is invented. CompilerBindings 25 invalidates changed output
meaning. Required API source queries and positive/negative joins remain strict.
This producer repair and the diagnostic-order correction await focused checks.

The 13-case compiler/map follow-up at
`ab9050796191a5ef2f85bd9c2d41bf92552cbfff` passed every selected case,
with zero retries, skips, timeouts or native crashes. The original TypeScript
qualified-target violation fixture now observes the exact compiler target with
legacy propagation disabled. Symbol-reference ambiguity, shadowed imports,
stale-target clearing and full compiler-binding controls passed. All eight map
controls passed, including passive upgrade and the adjacent ordering regression.
Cumulative original failure closure is 85; 15 still lack passing closure.

All 15 remaining original cases were rechecked serially at
`d9b285ae2fb858b95f5ff77c9d6a75ebcb666a17`: four passed, eleven failed,
including three timeouts, with no skips/native crashes. Sample/mixed evaluation
and both JavaScript qualified-target cases passed. Cumulative closure is 89;
eleven original failures still lack passing closure. This is not final-head
acceptance and earlier green observations are not merged into a whole-tree pass.

The showcase phrase is proven stale: the current source document starts with
`HTTP API server contract` and contains no `Minimal API Server`. Its dataset now
uses the actual heading for both the quoted phrase and positive chunk-name
assertion, retaining the same source file, mode and required hit.

Shared-module review ownership was reconciled for 119 added files, with explicit
per-file boundary recommendations and real static production consumers. Existing
review recommendations remain; the reconciliation is a structural inventory,
not a claim of runtime/security qualification. The dynamically selected Node
preload is retained despite zero static import edges. No source/test was removed.

A separately labeled SQL instrumentation diagnostic (not acceptance evidence)
observed 43,655 privacy lookups, 28,437 location queries and 14,218 each of
occurrence/snapshot lookups before the unchanged 30-second history deadline.
Each tiny persistent read separately acquired/released SQLite filesystem locks.
Search now retains one synchronous read transaction, borrowing existing caller
transactions without committing them. Generation/privacy/evidence reads share
that snapshot; the original 1,001-record pagination, budgets and negatives remain.
The added exact read-snapshot assertion failed before the repair in 1.45 seconds
(author-workspace history-read-transaction-before-direct receipt). Closure still
requires the repaired-source run; no performance claim is made from instrumentation.

At `067fa088a68971388d4684959db80c161430098d`, four of five focused
checks passed with no timeouts/skips/native crashes: showcase, shared-module
reviews, history privacy and source diversity. The history pagination case
reached its budget assertion in 16.1 seconds. Its claimed full-detail budget
negative accidentally selected the documented default summary projection, which
now fits 100 compact records. Both the default-budget rejection and explicit
2-MiB positive now request `detail: full`, retaining all 100 evidence records,
continuation, generation and invalid cursor assertions. Nine originals remain.

Two implementation follow-ups await validation. Semantic reconciliation now
uses four bounded partition readers through the existing settled queue owner,
retaining every row/hash/reference/count/source assertion. Source verification
is coalesced only for the actual in-flight promise in that invocation; failure
cannot become a successful cache entry. A new iterator lifetime regression
requires all admitted reads to drain and later admission to stop after failure.

The cold parity lifecycle fixture was selecting default stage2 enrichment,
whereas its real owner `tests/retrieval/parity/equivalence.test.js` explicitly
builds stage1 for lexical parity (then stage3 only when ANN is selected). It now
selects that actual stage1 cold setup through the same public binary/supervisor.
The original 15-second bound, code/prose inputs, traced descendant assertions
and immediate removal remain. This fixture does not qualify stage2 semantics;
the existing API and SSR stage2 cases retain their strict independent checks.
