# Spec: RuntimeEnvelopeV1 (current)

Status: Implemented

This document describes the RuntimeEnvelope surface produced by `src/shared/runtime-envelope.js`.
It reflects current behavior in code and tests.

## 1) Goals

- Provide a single JSON-serializable envelope of requested and effective runtime settings.
- Provide deterministic concurrency and queue caps derived from config, env, and auto-policy.
- Provide a safe env patch for subprocesses without clobbering user-provided env.
- Emit warnings when requested settings are overridden by external env.

## 2) Data model

### 2.1 Source tags
```ts
type SourceTag =
  | 'cli'
  | 'config'
  | 'env'
  | 'external-env'
  | 'autoPolicy'
  | 'default'
  | 'computed';
```

### 2.2 Sourced value
```ts
interface SourcedValue<T> {
  value: T;
  source: SourceTag;
  detail?: string;
}
```

### 2.3 RuntimeEnvelopeV1
```ts
interface RuntimeEnvelopeV1 {
  schemaVersion: 1;
  generatedAt: string; // ISO
  process: {
    pid: number | null;
    argv: string[];
    execPath: string | null;
    nodeVersion: string | null;
    platform: string | null;
    arch: string | null;
  };
  toolVersion: string | null;

  runtime: {
    uvThreadpoolSize: {
      requested: SourcedValue<number | null>;
      effective: SourcedValue<number>;
    };
    maxOldSpaceMb: {
      requested: SourcedValue<number | null>;
      effective: SourcedValue<number | null>;
    };
    nodeOptions: {
      requested: SourcedValue<string | null>;
      effective: SourcedValue<string | null>;
    };
    ioOversubscribe: SourcedValue<boolean>;
  };

  concurrency: {
    cpuCount: number;
    totalMemBytes: number;
    totalMemGiB: number | null;
    maxConcurrencyCap: number;
    threads: SourcedValue<number>;
    fileConcurrency: SourcedValue<number>;
    importConcurrency: SourcedValue<number>;
    ioConcurrency: SourcedValue<number>;
    cpuConcurrency: SourcedValue<number>;
    embeddingConcurrency: SourcedValue<number>;
  };

  queues: {
    io: { concurrency: number; maxPending: number };
    cpu: { concurrency: number; maxPending: number };
    embedding: { concurrency: number; maxPending: number };
    proc?: { concurrency: number; maxPending: number };
  };

  envPatch: {
    set: Record<string, string>;
    nodeOptions?: string;
  };

  warnings: Array<{
    code: string;
    message: string;
    fields?: string[];
  }>;
}
```

## 3) Inputs and precedence

### 3.1 Inputs
`resolveRuntimeEnvelope` accepts:
- `argv` (parsed CLI)
- `rawArgv` (raw process argv after node/script)
- `userConfig`
- `autoPolicy` (indexing concurrency auto-policy)
- `env` (base env map)
- `execArgv` (node exec args)
- `cpuCount` (explicit CPU count)
- `processInfo` (pid/argv/platform/etc)
- `toolVersion`

### 3.2 Requested value precedence (current behavior)

- `threads`:
  1. CLI `--threads`
  2. `config.threads`
  3. `config.indexing.concurrency`
  4. `autoPolicy.indexing.concurrency.files`
  5. `PAIROFCLEATS_THREADS`
  6. default (`null`, resolved in `resolveThreadLimits`)

- `runtime.uvThreadpoolSize`:
  1. `config.runtime.uvThreadpoolSize`
  2. `PAIROFCLEATS_UV_THREADPOOL_SIZE`
  3. default `max(4, ceil(cpuCount / 2))`

- `runtime.maxOldSpaceMb`:
  1. `config.runtime.maxOldSpaceMb`
  2. `PAIROFCLEATS_MAX_OLD_SPACE_MB`
  3. default `null`

- `runtime.nodeOptions`:
  1. `config.runtime.nodeOptions`
  2. `PAIROFCLEATS_NODE_OPTIONS`
  3. default `null`

- `runtime.ioOversubscribe`:
  1. `config.runtime.ioOversubscribe`
  2. `PAIROFCLEATS_IO_OVERSUBSCRIBE`
  3. default `false`

### 3.3 Effective value rules

- If `UV_THREADPOOL_SIZE` is already set in the base env, it becomes the effective value and
  no patch is applied. Otherwise the requested value is used and `envPatch.set.UV_THREADPOOL_SIZE`
  is applied.

- `NODE_OPTIONS` patching only occurs when the base env does not contain `NODE_OPTIONS`.
  The patch merges `runtime.nodeOptions` and `--max-old-space-size` when requested.

- `maxOldSpaceMb` effective value is read from `NODE_OPTIONS`/`execArgv` when present,
  otherwise from the requested value if `NODE_OPTIONS` is patchable.

## 4) Concurrency and queues

- Concurrency values are derived by `resolveThreadLimits` using the requested threads,
  config concurrency, import concurrency, IO cap, cpu count, total system memory,
  and ioOversubscribe.
- `embeddingConcurrency` is derived from `indexing.embeddings.concurrency` or defaults
  (platform-aware) and capped by CPU concurrency.
- Queue `maxPending` defaults are:
  - `io`: `max(8, ioConcurrency * 4)`
  - `cpu`: `max(16, cpuConcurrency * 4)`
  - `embedding`: `max(16, embeddingConcurrency * 4)`

Embedding batch size auto-tuning is centralized in `src/shared/embedding-batch.js`.
Stage3 `build-embeddings` uses provider-aware defaults when batch size is not explicitly configured
(for CPU-only providers like `stub`/`onnx`, batch size is additionally capped by available threads).

## 4.5 Scheduler config (build runtime)
The build scheduler configuration is resolved alongside the runtime envelope (in `createBuildRuntime`) and stored on the build runtime object. It is **not** part of the RuntimeEnvelope schema.

Runtime fields:
- `runtime.schedulerConfig` holds the resolved config values.
- `runtime.scheduler` holds the scheduler instance used for stage wiring and queue adapters.

When the scheduler is enabled (and not in low-resource bypass mode), runtime queues are
adapter-backed and schedule work via the scheduler token pools instead of PQueue.
Stage progress reporting includes scheduler stats in its metadata payload.

The `build-embeddings` tool resolves the scheduler configuration using the same
envelope inputs (argv, config, env) and schedules embedding compute + artifact IO
via `embeddings.compute` and `embeddings.io` queues. This keeps Stage3 backpressure
consistent with the rest of the build pipeline.

Stage3 cache writes also use a bounded in-process writer queue to avoid unbounded pending payload retention.
Writer `maxPending` defaults to a small value derived from IO tokens (capped) and is additionally bounded by
`indexing.scheduler.queues[embeddings.io].maxPending` when configured.

Config path:
- `indexing.scheduler.*` (config file)

Env overrides:
- `PAIROFCLEATS_SCHEDULER`
- `PAIROFCLEATS_SCHEDULER_CPU`
- `PAIROFCLEATS_SCHEDULER_IO`
- `PAIROFCLEATS_SCHEDULER_MEM`
- `PAIROFCLEATS_SCHEDULER_LOW_RESOURCE`
- `PAIROFCLEATS_SCHEDULER_STARVATION_MS`

CLI overrides:
- `--scheduler` / `--no-scheduler`
- `--scheduler-cpu`
- `--scheduler-io`
- `--scheduler-mem`
- `--scheduler-low-resource` / `--no-scheduler-low-resource`
- `--scheduler-starvation`

## 5) Env patch

`envPatch` is safe to apply to subprocesses using `applyEnvPatch` or `resolveRuntimeEnv`.

- `envPatch.set` currently includes only `UV_THREADPOOL_SIZE` when applicable.
- `envPatch.nodeOptions` is set only when base `NODE_OPTIONS` is empty and a patch is needed.

## 6) Warnings

Warnings use `code: "runtime.envOverride"` when a requested value cannot be applied because of
base env settings (for example, `UV_THREADPOOL_SIZE` or `NODE_OPTIONS`).

## 7) Implementation references

- Runtime envelope: `src/shared/runtime-envelope.js`
- Runtime construction: `src/index/build/runtime/runtime.js`
- Thread limits: `src/shared/threads.js`

Tests:
- `tests/shared/runtime/runtime-envelope-uv-threadpool-precedence.test.js`
- `tests/shared/runtime/runtime-envelope-node-options-merge.test.js`
- `tests/shared/runtime/runtime-envelope-spawn-env.test.js`
- `tests/shared/runtime/uv-threadpool-no-override.test.js`
- `tests/shared/runtime/uv-threadpool-env.test.js`

## 8) Compatibility notes

- `schemaVersion` increments on breaking changes to the envelope shape.
- `envPatch` must not include secrets.
