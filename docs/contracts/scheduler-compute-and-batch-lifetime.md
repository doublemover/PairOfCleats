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

These are tokenizer execution and retention contracts. They do not move Babel,
TypeScript, semantic compiler sessions, whole-file lint or complexity analysis
onto workers. A coarse file-analysis implementation still needs a separately
qualified source/config/parser contract, real coordinator integration, bounded
native/cache ownership and differential output evidence. Aggregate scheduler
telemetry also cannot reconstruct exact ready sets for decision-level cost
replay; offline shadow comparison requires additional admissibility and commit
frontier evidence before it can make evaluable recommendations. No speedup or
cross-platform acceptance follows from these contracts.

## Focused consumer controls

- `tests/indexing/workers/hard-pressure-no-progress.test.js`
- `tests/indexing/workers/pressure-admission-compute-suspension.test.js`
- `tests/indexing/workers/pressure-reconfigure-admission-authority.test.js`
- `tests/indexing/workers/tokenize-batch-real-worker-receipt.test.js`
- `tests/indexing/file-processor/scm-command-compute-suspension.test.js`
- `tests/indexing/file-processor/tokenize-batch-bounds-order.test.js`
- `tests/indexing/file-processor/tokenize-batch-receipt-lifetime.test.js`
- `tests/shared/concurrency/scheduler-compute-suspension.test.js`
- `tests/shared/concurrency/scheduler-detached-wait-ownership.test.js`
- `tests/shared/concurrency/scheduler-invalid-resource-request.test.js`
- `tests/shared/concurrency/scheduler-shared-adapter-cap-authority.test.js`

Execution acceptance remains tied to the exact tested source and environment.
Author-workspace `.testLogs` receipts are historical observations and are not
promised in a clean checkout.
