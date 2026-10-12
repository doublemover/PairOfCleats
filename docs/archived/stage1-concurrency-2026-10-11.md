# Stage1 file admission — 2026-10-11

Based on `191bef8e5da062feb1908b741faaa5193e445283` on local branch
`codex/semantic-recovery-perf-20261011`. The parent contains the measured
[recovery read improvement](semantic-recovery-performance-2026-10-11.md).
Its parent is watchdog fix `d39bdf01732ccc4e2f9e5b8d9daacfcd55692999`, based on
campaign `d468621da9b72f5212b83689ce2ca54355a108a4`. Sol's engine commit
`547f6226324b9ee55664e8bd1d3908da3cd5dc21` is the reported cherry-pick of that
watchdog fix. Apply the read-performance commit, then this configuration/diagnostics commit,
onto that clean engine lineage; no merge or branch switch is needed. No dependency,
source snapshot, semantic format, producer identity or cache change is required.

## Evidence and exact meanings

Read-only inspection of the owner's historical
`task-2/ssr64-recovery-index.log` showed `Queue concurrency: io=32, cpu=8` and
`Indexing Concurrency: Files: 16, Imports: 16, IO: 32, CPU: 8` (line 81).
It also confirmed 4912 durable completions restored before parser scheduling.
Trusted `settings.json` had threads/worker count eight and scheduler CPU/IO/memory
tokens 8/16/32, with no explicit Stage1 or adaptive-surface override. These are
local historical observations, not receipts promised in clean checkouts.

In `process-files.js`, `runEntryBatch` uses `runtimeRef.queues.cpu`.
`inFlightFiles.set` occurs when the file callback starts; result/error handling
clears it after enqueue/skip. The heartbeat reads its size. `trackedSubprocesses`
is the ownership-filtered registry of child processes, not worker threads or async
file I/O. `orderedPending` sums pending promises in active ordered-completion
trackers, not pending input files or the scheduler's queue depth.

The scheduler maps `stage1.cpu` to its adaptive `parse` surface and gates it by
current surface capacity, global tokens and byte/write backpressure. Worker pool
size is separate. The scheduler adapter's `concurrency` property is descriptive;
changing only the tokenizer queue setting is insufficient to enforce a scheduler
cap. The stopped log did not record the current adaptive cap, so occupancy one
cannot establish a cap of one or identify why slots were idle. No unrelated stall
cause was investigated.

## User-selected eight and verification

The supported setting is
`indexing.scheduler.adaptiveSurfaces.surfaces.parse =
{minConcurrency:8,maxConcurrency:8,initialConcurrency:8}`. Keep scheduler enabled,
adaptive enabled (default), existing tokens 8/16/32, outer workers eight, the
64 GiB budget, max/rich/eager quality, source snapshot/exclusions and cache.
Fixed minimum eight disables parse-surface downscaling, but existing byte, token,
ordered and write backpressure remain. The runtime already implements these bounds,
but its closed scheduler schema omitted `adaptive` and `adaptiveSurfaces`, so the
normal validator rejected the recommendation. This patch adds the boolean and
three positive-integer parse bounds to the schema and inventory, without opening
unknown keys or bypassing validation. Omitted values retain runtime defaults.
A task-owned copy of the complete SSR settings with this override passed
`tools/config/validate.js --json`; the original settings were not changed.
There is no supported live reload: Sol owns the stop/configure/incremental restart.

This commit adds the effective surface to startup and regular progress telemetry:
`[stage1] admission parse=r0/p0/cap8/min8/max8 ...`. Subsequent heartbeats show
actual `rN/pN/cap8/min8/max8`; `N` need not remain eight. Structured heartbeats now
carry bounded scheduler counters. No worker probes or extra watchdog timers.

The exact production resolver, scheduler and runtime-queue configuration admitted
8 of 16 tasks while queuing 8, even after global CPU tokens adapted above eight.
The focused `indexing/stage1/processing-concurrency-eight` regression verifies
24 jobs, out-of-order completion with ordered commits, peak active eight and
8 MiB fixture scratch. A stricter 2 MiB byte budget admits only two 1 MiB jobs;
cancelling the remaining ten prevents all queued starts and releases accounting.
The regression also accepts the exact override through the normal schema and
rejects zero, fractional/string bounds, typo properties and unknown surfaces.
Content dependency signatures are unchanged by the scheduler configuration.
This is a bounded admission test, not a representative SSR throughput/RSS benchmark.
No 4/16 benchmark was run after the user explicitly chose eight. Speedup and full
memory cost of that choice remain unmeasured; actual live acceptance belongs to Sol.

Native readiness passed on Node 26.8.1. The six focused admission, heartbeat,
watchdog and scheduler regressions passed (5.35 seconds; slowest 2.42 seconds).
Formatting, config budget, environment usage, generated freshness, command
surface, workflow contract, all 39 gate fixtures (7.43 seconds; slowest 3.88 seconds),
and `git diff --check` passed. No broad index, validation campaign or publication was performed.

## Configuration maintenance follow-up

The immediate restart patch is `0653746d9779cbd62c490d85dd9573d9f9f36e96`.
The separate maintenance change removes the duplicate manual known-config-key
list: the validator and inventory now use the same schema declarations. The
schema collector includes named properties inside nested arrays/maps; imports
no longer regenerate committed reports as a side effect. Public budgets and
CLI/environment allowlists remain intentional review points. Type/range/enum
and unknown-key validation still runs normally. The documented
[edit workflow](../config/inventory-notes.md#editing-supported-configuration)
identifies the single declaration and generated outputs. The indexing owner
does not need this tooling-only follow-up to restart with eight slots.

Maintenance validation: all five focused inventory fixtures passed (4.45 seconds;
slowest 2.34 seconds), including schema-only additions/removals and nested map/array
coverage. Formatting, config budget, environment usage, generated freshness, command
surface, workflow contract, all 39 gate fixtures (7.25 seconds; slowest 3.83 seconds),
and diff whitespace checks passed for the follow-up. No failures, timeouts or skips.
The earlier six runtime fixtures apply unchanged; the follow-up edits tooling/docs only.
