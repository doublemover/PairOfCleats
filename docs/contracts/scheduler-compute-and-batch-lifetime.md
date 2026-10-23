# Scheduler compute and tokenizer batch lifetime

The scheduler owns active CPU admission separately from retained file, byte and
memory reservations. Known admission or buffered subprocess waits can suspend
only CPU. The continuation reacquires compute before it examines results or
dispatches a tokenizer worker. No pressure threshold or resource cap changes as
part of suspension.

## Retained ownership

`withSchedulerCpuSuspended` tracks the operation under its original scheduler
task. A timeout or promise race does not settle the losing operation. If a task
returns with a registered wait still active, it retains its original byte,
memory and file-window reservation until that wait actually settles. A successful
early return becomes `ERR_SCHEDULER_UNAWAITED_WAIT`; an existing failure remains
primary with the detached-wait evidence attached. Shutdown can refuse CPU
reacquisition without releasing retained ownership before actual settlement.

Task completion becomes observable after reservation release. This permits an
immediate `scheduleIfAvailable` call to inspect the completed task's released
capacity. Invalid nonfinite or unsafe CPU/I/O/memory/byte requests reject with
`ERR_SCHEDULER_RESOURCE_REQUEST` before admission. Adapter overrides are checked
before joining their producer window.

Buffered default SCM commands launch while admitted, suspend CPU while awaiting
the command, and reacquire before provider parsing. Streaming callbacks and
alternate runners keep their existing compute admission because their execution
is not a pure wait. Subprocess termination remains with the existing subprocess
and cleanup owners.

## Independent concurrency limits

The effective queue concurrency is the minimum of the configured scheduler cap
and each adapter's current cap. An adapter's explicit queue configuration also
bounds its own requested cap. Creating or resizing another adapter cannot replace
those ceilings. A lower cap permits already running work to settle and blocks
additional starts; an increase reconsiders admission through the scheduler.

Queue statistics expose `configuredConcurrency`, `adapterConcurrency` and the
effective `concurrency`. Producer pending windows, byte limits, resource tokens,
adaptive ceilings and suspended-file retention remain separate constraints.

## Hard-pressure tokenizer admission

Blocked language admission suspends compute while preserving the task's retained
resources. Issued throttle slots are immutable, owner-specific and released once;
foreign or duplicate releases cannot manufacture progress. A different language
or quantization task settling can advance the no-drain recheck without waking
every contender on each completion.

The existing internal no-progress and absolute wait limits remain 5 and 15
seconds. Terminal errors are retryable/resumable resource-pressure failures, not
permission to execute a blocked heavy task inline. A backend disabled for
pressure reconfiguration continues routing eligible files through admission.
Once pressure recovers, the ordinary unavailable-backend route may apply.

Committed-heap occupancy and aggregate owned RSS remain distinct observations.
Their pressure classification does not prove exhaustion of V8's hard heap limit.
Cache/spill, durable checkpoint publication and file-window producers keep their
existing owners; tokenizer metadata eviction is not evidence of actual source or
AST memory reclamation.

## Versioned bounded token batches

The existing tokenizer batch worker emits
`TOKENIZE_BATCH_RESULT_VERSION`, ordered source/dictionary-policy identity,
input bytes and measured output bytes. The coordinator verifies that receipt and
independently serializes the returned member rows before retaining lookahead.
The identity covers submitted text, mode, extension, language and per-task
dictionary settings. Pool generation and shared dictionary/postings ownership
remain with the existing worker lifecycle.

Each window admits one outstanding call. Batch submissions contain at most eight
chunks and 128 KiB of UTF-8 source; larger individual inputs keep the existing
single-task route. Serialized member results remain bounded by 8 MiB. Input snapshots
retain the submitted policy/text; later caller mutation cannot authorize an old
result. Skipped or pretokenized chunk indices discard obsolete lookahead, and
cancellation clears retained rows. A rejected receipt cannot populate future
rows before the existing file-local inline fallback.

## Opt-in coarse file-local analysis

The real file processor can submit a complete JS/JSX/TS/TSX file phase through
the existing single-task worker/process transport when worker configuration is
explicitly `enabled: true`. Automatic/default worker routing retains its existing
tokenizer path. This is an internal qualification boundary, not default adoption.

The versioned binary input binds source, supported settings, Node/V8 and existing
semantic producer versions. Source is limited to 2 MiB, serialized input to 4 MiB,
and serialized results to 8 MiB. The scheduler reserves the bounded transport and
result allowance before dispatch. The original file task retains CPU admission
while actual worker compute runs, plus its byte/memory/file-window reservations;
language pressure waits still use their existing suspension/reacquisition owner.
The process transport independently reserves its full bounded result capacity.

The worker invokes canonical `processFileCpu`: AST preparation, file-local
relations, lint, complexity, risk/type enrichment, local tokenization and existing
parse/lexical checkpoint projections remain together. ASTs, callbacks, shared
caches and publication handles are never cloned. Normalized risk-rule descriptors
preserve policy/provenance and reconstruct their exact regex engine in the worker.
Observer events are bounded and replay only after accepting the completed result.

Compiler sessions, live SCM, embeddings, document extraction, native parser or
native classification ownership and unsupported language settings decline before
dispatch. The existing inline implementation remains fallback authority. A
received completed projection refusal or invalid receipt may fall back; abort,
pressure and uncertain backend lifetime errors propagate. Accepted observer
failures cannot trigger duplicate analysis. Embedded/native/compiler routes and
parser-cache budgets still need separate ownership qualification.

The authored differential and real Worker/process/facade transport controls remain
unexecuted pending a frozen shared candidate. No parity, measured break-even,
throughput improvement or cross-platform acceptance is established by source.
## Exact-ready-set shadow evidence

The existing learned-auto-profile opt-in can configure bounded dispatch replay.
The scheduler records anonymous task ordinals, enqueue/start/settlement/outcome,
byte/resource reservations, and the exact pending/admissible set immediately
before its existing dispatch reserves resources. It uses the same admission
function as live scheduling, including writer pressure, active/suspended queue
limits, tokens, bytes and adaptive surface caps. It records current capacity and
an identity for configured limits. Paths and runtime/parser handles are omitted.

The producer forwards evidence only after existing ordered/dependency gates.
Duration predictions use a bounded snapshot of prior empirical file-cost buckets.
Profiles must carry matching producer/config/parser/runtime/repository-feature
and resource identities; current-build observations cannot train that run's
decision. Old, stale or missing profiles retain baseline behavior and produce
explicit unevaluable decisions. No public tuning knob or live policy is added.

The offline comparator reads recorded sets. It applies the explicit contiguous
commit window/frontier and existing starvation threshold, then shortest predicted
duration with enqueue-ordinal ties. It reports baseline/proposed IDs, predictions,
admission/age/commit constraints, observed baseline outcomes, divergence, absolute
prediction error, queue wait, commit delay and incomplete exclusions. Commit time
comes only from the actual ordered owner; commit during a task's result callback
can precede full scheduler settlement and has zero post-settlement delay.

At most 512 tasks, 128 dispatches, 64 pending candidates per exact set and 2 MiB
of conservatively charged trace data are retained. Overflow, missing task rows,
malformed ordering, absent dependencies/frontier and changed resource limits are
excluded. Shutdown/cancellation retains incomplete/rejected outcomes. Comparison
never invents future resource releases, counterfactual concurrency, throughput or
unobserved timings. Held-out calibration, runtime overhead, quality/performance
acceptance and actual environment qualification remain deferred.

Outer queue retries and ordered error/skip callbacks cannot replace unconfirmed
worker/cache cleanup ownership. Known unresolved cleanup codes and original
pending-resource observers stop retry and recovery callbacks, including
best-effort producer continuation; independently retryable settled failures keep
their existing retry policy. Pressure lifecycle idle accounting uses dispatched
backend work through recovery, separately from request/throttle-wait counters.

## Focused consumer controls

- `tests/indexing/workers/hard-pressure-no-progress.test.js`
- `tests/indexing/workers/pressure-admission-compute-suspension.test.js`
- `tests/indexing/workers/pressure-reconfigure-admission-authority.test.js`
- `tests/indexing/workers/tokenize-batch-real-worker-receipt.test.js`
- `tests/indexing/file-processor/scm-command-compute-suspension.test.js`
- `tests/indexing/file-processor/tokenize-batch-bounds-order.test.js`
- `tests/indexing/file-processor/tokenize-batch-receipt-lifetime.test.js`
- `tests/indexing/file-processor/coarse-worker-file-analysis.test.js`
- `tests/indexing/file-processor/coarse-worker-production-route.test.js`
- `tests/indexing/workers/coarse-file-analysis-transport.test.js`
- `tests/indexing/workers/coarse-file-analysis-facade.test.js`
- `tests/indexing/workers/pressure-reconfigure-backend-ownership.test.js`
- `tests/indexing/runtime/scheduler-shadow-producer.test.js`
- `tests/shared/concurrency/scheduler-compute-suspension.test.js`
- `tests/shared/concurrency/scheduler-detached-wait-ownership.test.js`
- `tests/shared/concurrency/scheduler-invalid-resource-request.test.js`
- `tests/shared/concurrency/scheduler-shared-adapter-cap-authority.test.js`
- `tests/shared/concurrency/scheduler-exact-ready-replay.test.js`
- `tests/shared/concurrency/run-with-queue-resource-recovery-authority.test.js`

Execution acceptance remains tied to the exact tested source and environment.
Author-workspace `.testLogs` receipts are historical observations and are not
promised in a clean checkout.
