# Bounded recovery and low-load use

Date: 2026-10-03. Frozen input: `953aac6bb697f887c69e63b3a9c379acb623e4a9`.
This guide records focused recovery evidence and an opt-in configuration for a
small local workload. It does not change product-wide defaults or establish
release-wide acceptance.

## Finalization correction

The frozen full bundle builder was exercised with one hand-authored chunk, real
`better-sqlite3` 12.6.2 / SQLite 3.51.2, one bundle thread and no vectors. A
checkpoint error followed by a throwing diagnostic warning left the native
handle open with zero close calls. The reproduction manually released it.

The correction contains best-effort warning callbacks in the close helper and
pragma handling, ensures close follows pragma restoration, and protects the
artifact builder's final clamping summary. The regression covers:

- A checkpoint diagnostic callback throwing before close
- Pragma restoration warning callbacks throwing
- Preservation of the actual promotion failure instead of a diagnostic error
- Failed-output database and sidecar cleanup
- A successful one-chunk real bundle build with a failed checkpoint and callback
- Successful and failed real artifact builds with a throwing clamping diagnostic

The artifact fixtures supply two synthetic storage values; they do not load an
embedding model or perform inference. The failed artifact case preserves the
original build exception. All owned native handles close exactly once.

Focused checks run sequentially with one CPU affinity, low process priority,
512 MiB Node heap and a 30-second per-command timeout. The finalization fixture,
the prior startup-lifecycle fixture and changed-file ESLint pass. The new
finalization fixture is registered at the end of the existing `ci-lite` order.
The broad lane, platform, security-rescan and performance campaigns remain
deferred; these passing fixtures do not reclassify historical interrupted runs.

## Opt-in configuration

Place this in the target small repository's `.pairofcleats.json`, merging it with
any existing project-specific settings. Embeddings are disabled rather than
replaced by a stub. Use the same configuration for each serial tooling trial.

```json
{
  "quality": "fast",
  "threads": 1,
  "runtime": { "maxOldSpaceMb": 512, "uvThreadpoolSize": 1, "ioOversubscribe": false },
  "tooling": {
    "autoInstallOnDetect": false,
    "autoEnableOnDetect": false,
    "allowGlobalFallback": false,
    "timeoutMs": 10000
  },
  "indexing": {
    "concurrency": 1,
    "importConcurrency": 1,
    "ioConcurrencyCap": 1,
    "scheduler": { "enabled": true, "cpuTokens": 1, "ioTokens": 1, "memoryTokens": 1, "lowResourceMode": true },
    "workerPool": { "enabled": false, "maxWorkers": 1 },
    "artifacts": { "writeConcurrency": 1 },
    "embeddings": { "enabled": false, "mode": "off", "concurrency": 1 },
    "typeInference": false,
    "riskAnalysis": false
  }
}
```

This configuration passes the current schema. Runtime-envelope assertions verify
one CPU queue, one IO queue, a 512 MiB heap and no IO oversubscription. The file
planner may retain two outstanding file tasks even at one thread; CPU scheduling
and the IO queue remain limited to one. The generic envelope displays an unused
embedding queue budget, while the build embedding runtime's explicit off mode
prevents embedding execution.

Also set `PAIROFCLEATS_EMBEDDINGS=off`, `PAIROFCLEATS_THREADS=1`,
`PAIROFCLEATS_BUNDLE_THREADS=1`, `PAIROFCLEATS_WORKER_POOL=off`,
`NODE_OPTIONS=--max-old-space-size=512` and `UV_THREADPOOL_SIZE=1` in the invoking
process. Bound CPU/IO/memory scheduler token and maximum token settings to one,
disable adaptive expansion and reserve 2 GiB for other work. Disable cross-file
parallel propagation and keep incremental bundle updates and discovery stat
concurrency at one. Do not run model download/setup commands. Offline environment
flags are additional safeguards, not a replacement for disabling the embedding
runtime.

For language-semantic trials, enable only the required provider in that fixture
and deliberately enable its inference features. Keep every other provider off.
CPU affinity and heap limits apply to child commands but do not independently
cap the RSS of arbitrary external language servers; measure those processes and
stop a trial that threatens the shared resource reserve. A 512 MiB Node heap is
not a promise that a large repository will fit.
