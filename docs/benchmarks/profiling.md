# Performance profiling

Use profiling to explain a measured slowdown, then use unprofiled runs to check
the improvement. This guide restores the useful CPU/I/O diagnosis workflow from
the historical `mess` branch with current paths and configuration names.

The [benchmark overview](overview.md) owns timing harnesses and warm/cold
methodology. A [test-runner profile](../perf/test-runner-profile-artifacts.md)
records test scheduling/timings; it is not a JavaScript CPU sample profile.

## Agree on a bounded experiment

Before starting, identify the exact fixture, operation and expected evidence.
Profiling consumes additional CPU, memory and disk. On a shared machine, obtain
the needed measurement window and resource allocation first. This guide does
not authorize a previously deferred benchmark or release campaign.

- Start with a disposable small fixture and an isolated cache/output directory.
- Set a wall-time deadline, aggregate process-tree memory limit, CPU allowance,
  and free-memory/free-disk reserves. Stop when a limit is reached.
- Keep a single measured workload active. Background builds distort timing.
- Node's `--max-old-space-size` limits one V8 heap, not total/native memory or
  child processes. `--threads` controls indexing concurrency, not an OS CPU quota.
- Do not delete a user's working cache to manufacture a cold run. Record whether
  the run has a fresh process, loaded index, embedding cache, and OS page cache.

Repository tests retain their 30-second per-test limit. A larger profiling run
needs a separately chosen budget; do not silently raise limits after a failure.

## Capture CPU samples in the process doing the work

Create `temp/profiles` before running these examples, and execute from the repo
root inside your chosen process-tree resource guard. Use a fresh output filename
for every run. These commands are examples, not recorded benchmark results.

```sh
node --max-old-space-size=512 --cpu-prof --cpu-prof-dir=temp/profiles --cpu-prof-name=index-small.cpuprofile build_index.js --repo ./tests/fixtures/sample --mode code --threads 1 --stage stage1 --scm-provider none --no-sqlite
node --max-old-space-size=512 --cpu-prof --cpu-prof-dir=temp/profiles --cpu-prof-name=search-small.cpuprofile search.js alpha --repo ./tests/fixtures/sample --mode code --backend memory --no-ann --json
```

The search example requires an existing compatible fixture index. The build
example measures stage1, without SCM or a SQLite build; it is not a full enriched
or embedding-enabled build. Keep those choices fixed in comparisons.

The maintained direct [build](../../build_index.js) and [search](../../search.js)
entrypoints can print legacy-entrypoint guidance. They are used here to attach
Node's profiler to the work process. For ordinary use, prefer `pairofcleats index
build` and `pairofcleats search`. The [public dispatcher](../../bin/pairofcleats.js)
can spawn a child, so profiling only that dispatcher can miss the actual work.
Likewise, a main-process profile is not automatically evidence about every worker
thread, subprocess, native library or GPU operation.

Open the `.cpuprofile` in a compatible CPU-profile viewer. Inspect bottom-up
stacks and self time. Common indexing candidates are parsing/tokenization,
JSON encoding/decoding, hashing and embedding preprocessing. Heavy garbage
collection suggests allocation/retention work rather than a small arithmetic
optimization. A CPU profile alone cannot establish an I/O wait bottleneck.

## Separate I/O pressure from CPU work

Record file sizes/counts, storage type, index backend, embedding provider/model,
cache state, elapsed time, process-tree peak RSS and workload configuration.
Correlate CPU utilization with filesystem latency and runtime timing counters.
For a bounded timeline trace of the same search fixture:

```sh
node --max-old-space-size=512 --trace-event-categories=v8,node --trace-event-file-pattern=temp/profiles/search-trace.json search.js alpha --repo ./tests/fixtures/sample --mode code --backend memory --no-ann --json
```

Review the output in a compatible trace viewer. Trace files can grow quickly;
retain the deadline and disk reserve, and use a small case before longer runs.

Current [configuration](../config/contract.md) uses `runtime.uvThreadpoolSize`
and `indexing.ioConcurrencyCap`. An existing `UV_THREADPOOL_SIZE` is respected by
the [runtime envelope](../../src/shared/runtime-envelope/resolve.js); libuv tuning
must be in place before the work process starts. Changing an environment value
inside an already-running process is not a reliable thread-pool resize.
More concurrency can increase contention and memory, so vary one limit at a time.

## Prove the result, preserve the evidence

1. Save the baseline commit, command, input/index identity, runtime versions,
   effective resource settings and cache state with the profile.
2. Fix the identified owner and add a focused correctness or operation-count
   regression. A deterministic duplicate-work reduction is useful evidence even
   when an end-to-end benchmark is not authorized.
3. Repeat the same bounded, unprofiled workload. Keep cold and warm results
   separate; report repetitions and variability rather than one best sample.
4. Preserve failed, timed-out and resource-stopped runs as such. Do not convert
   them into successful measurements, and do not overwrite a baseline silently.
5. Report what was measured. Scoped checks do not establish release readiness;
   broader acceptance remains governed by the [roadmap](../roadmap.md).

Profiles/traces can reveal source paths, function names and workload details.
Keep them under the ignored `temp/` output area and review their contents before
sharing; the authored guide belongs in Git, generated measurement output does not.
