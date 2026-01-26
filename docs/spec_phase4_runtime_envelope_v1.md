# Spec: RuntimeEnvelopeV1 (Phase 4.1)

Status: Draft (implementation-ready)  
Scope: PairOfCleats Phase 4.1  
Primary goal: Remove ambiguity around runtime configuration, concurrency, and subprocess propagation.

---

## 1. Goals

### 1.1 Provide a single, explicit runtime “envelope”
A **RuntimeEnvelopeV1** is a JSON-serializable object that fully describes, for the current process:

1. **Requested (configured) runtime settings** from CLI/config/env.  
2. **Effective runtime settings** that will actually apply in this process (and in spawned subprocesses).  
3. **Derived concurrency and queue lane caps** used by the indexer (IO/CPU/embedding/etc).  
4. **Provenance for every key value** (CLI/config/env/default/auto-policy/computed).  
5. **Warnings when requested and effective differ** (e.g., because the user already set `UV_THREADPOOL_SIZE` externally).

### 1.2 Ensure deterministic propagation to subprocesses
Every subprocess spawned by PairOfCleats (embeddings tool, indexer-service, etc.) must receive an environment consistent with the envelope’s runtime settings, unless explicitly overridden by the caller.

### 1.3 Provide a stable config-dump surface
`pairofcleats index --config-dump` must print JSON containing the envelope and exit with code 0 without doing indexing work.

---

## 2. Non-goals (explicitly out of scope for Phase 4.1)

* Replacing all other config/dump tooling (e.g., `tools/config-dump.js`) — those may be extended later.
* A full end-user configuration schema for every indexing option — Phase 4.1 only requires schema support for runtime/concurrency settings used by this envelope.
* Changing default output formats for search results or index artifacts (except for config dump and logging contract; those are Phase 4.5).

---

## 3. Terminology

* **Requested/configured**: the value derived from user intent (CLI/config/PairOfCleats env vars).
* **Effective**: the value actually in effect for the current process (and by default for spawned children) after considering “do not clobber externally-set env vars”.
* **Base env**: the environment inherited by PairOfCleats before it applies its own patch (e.g., user’s shell env).
* **PairOfCleats env vars**: env vars intended as PairOfCleats configuration (e.g., `PAIROFCLEATS_UV_THREADPOOL_SIZE`), distinct from Node/libuv env vars (e.g., `UV_THREADPOOL_SIZE`).

---

## 4. Data model

### 4.1 Source tags
```ts
type SourceTag =
  | 'cli'
  | 'config'
  | 'env'          // PairOfCleats env vars like PAIROFCLEATS_*
  | 'external-env' // env vars like UV_THREADPOOL_SIZE, NODE_OPTIONS
  | 'autoPolicy'
  | 'default'
  | 'computed';
```

### 4.2 SourcedValue wrapper
```ts
interface SourcedValue<T> {
  value: T;
  source: SourceTag;
  detail?: string; // e.g. "--threads", "config.runtime.uvThreadpoolSize", "UV_THREADPOOL_SIZE"
}
```

### 4.3 RuntimeEnvelopeV1 schema (logical)
```ts
interface RuntimeEnvelopeV1 {
  schemaVersion: 1;
  generatedAt: string; // ISO8601
  process: {
    pid: number;
    argv: string[];      // process.argv
    execPath: string;    // process.execPath
    nodeVersion: string; // process.version
    platform: string;    // process.platform
    arch: string;        // process.arch
  };

  runtime: {
    uvThreadpoolSize: {
      requested: SourcedValue<number | null>; // null means “no explicit request”
      effective: SourcedValue<number>;        // always a number (defaults to 4 if absent)
      note?: string;                          // optional human-readable note
    };

    maxOldSpaceMb: {
      requested: SourcedValue<number | null>;
      effective: SourcedValue<number | null>; // null means “not set / unknown”
    };

    nodeOptions: {
      requested: SourcedValue<string | null>; // extra flags to append
      effective: SourcedValue<string | null>; // NODE_OPTIONS visible to this process
    };

    ioOversubscribe: SourcedValue<boolean>;   // controls IO cap clamping behavior
  };

  concurrency: {
    cpuCount: number;
    maxConcurrencyCap: number;

    threads: SourcedValue<number>;            // requested threads after precedence
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
    // proc lane is optional; only include if implemented in Phase 4.2/4.9
    proc?: { concurrency: number; maxPending: number };
  };

  // Patch that should be applied when spawning subprocesses to replicate the envelope.
  // This is intentionally minimal and should never include secrets.
  envPatch: {
    set: Record<string, string>; // env var assignments to apply (e.g., UV_THREADPOOL_SIZE)
    // When patching NODE_OPTIONS, we prefer to compute the full string we will set.
    // This avoids string concatenation bugs spread across call sites.
    nodeOptions?: string;        // resulting NODE_OPTIONS value for subprocesses
  };

  warnings: Array<{
    code: string;
    message: string;
    fields?: string[];
  }>;
}
```

### 4.4 Stability contract
* `schemaVersion` must increment on breaking changes.
* Field names must not change within v1.
* `envPatch` must be safe to apply verbatim to child process environments.

---

## 5. Inputs and precedence

### 5.1 Inputs
`resolveRuntimeEnvelope()` must accept:
* `argv` (parsed args object, from `createCli()`)
* `rawArgv` (process.argv slice after node/script)
* `userConfig` (normalized user config object)
* `autoPolicy` (resolved auto policy object, for concurrency caps)
* `env` (the base env map to inspect; default `process.env`)
* `cpuCount` (from `os.cpus().length` / existing resolver)

### 5.2 Precedence rules (requested values)

For each “requested” field, precedence is:

1. CLI flag (if supported for that field)
2. Config file (e.g., `userConfig.runtime.uvThreadpoolSize`)
3. PairOfCleats env var (e.g., `PAIROFCLEATS_UV_THREADPOOL_SIZE`)
4. Default (null/false/derived)

**Important:** externally set env vars like `UV_THREADPOOL_SIZE` and `NODE_OPTIONS` are *not* part of “requested”; they are part of “effective”.

### 5.3 Do-not-clobber rules (effective + envPatch)
To align with the later roadmap (Phase 19) and avoid surprising behavior:

* If `UV_THREADPOOL_SIZE` is present in the base env, **do not override it**, even if a requested value exists.
* If `NODE_OPTIONS` already contains `--max-old-space-size=…`, do not add a second one.
* If `NODE_OPTIONS` already contains an exact requested `nodeOptions` substring, do not add it again.

When requested != effective due to do-not-clobber rules, add a warning with:
* `code: "runtime.envOverride"`
* fields including the relevant paths (e.g., `runtime.uvThreadpoolSize`)

---

## 6. API and file placement

### 6.1 New module
Create: `src/shared/runtime-envelope.js`

Exports:
* `resolveRuntimeEnvelope(input): RuntimeEnvelopeV1`
* `applyEnvPatch(baseEnv, envPatch): Record<string,string>` — shallow copy + patch helper
* `parseUvThreadpoolSize(env): number | null` — parse from env var
* `parseNodeOptions(env): string | null` — get NODE_OPTIONS
* `parseEffectiveMaxOldSpaceMb({ env, execArgv }): number | null` — reuse existing `parseMaxOldSpaceMb` logic
* `coercePositiveInt(value): number | null` — used for parsing config/env

### 6.2 Required integration points

#### (A) Wrapper CLI: `bin/pairofcleats.js`
**Change:** stop allowlist-based validation for the `index` command. Instead:
* treat everything after `index` as pass-through arguments to `build_index.js`.
* wrapper remains responsible for:
  * selecting script to run
  * applying runtime env patch **before** spawning `build_index.js`

**Implementation:**
* Load user config for repo root (already supported).
* Resolve auto policy (already supported via `resolveIndexAutoPolicy`).
* Call `resolveRuntimeEnvelope({ argvParsedForIndex?, rawArgv, userConfig, autoPolicy, env: process.env, cpuCount })`.
  * For wrapper, you may not have `argv` parsed yet; acceptable approaches:
    1. Parse using the same options set as `build_index.js` (recommended to avoid drift), or
    2. Treat wrapper as “dumb” and only use config/env to patch env; CLI flags handled inside child process.
  * Best choice: import `INDEX_BUILD_OPTIONS` and use `createCli()` in the wrapper too. This keeps parity.
* Spawn `node scripts/build_index.js …` with `env: applyEnvPatch(process.env, envelope.envPatch)`.

#### (B) Index script: `scripts/build_index.js`
Add option: `--config-dump` (boolean).

Behavior:
* Compute envelope at startup.
* If `--config-dump`:
  * write JSON to stdout: `JSON.stringify(envelope, null, 2)` (or `--json` controls formatting)
  * exit 0 without running the index.

#### (C) Runtime construction: `src/index/build/runtime/runtime.js`
* Ensure thread limits and queue creation use envelope-derived concurrency values, not re-derived ad hoc.
* Store the envelope on runtime state for later introspection (e.g., attach to `runtimeRef.runtimeEnvelope`).

#### (D) Subprocess spawning
Phase 4.9 will introduce `spawnSubprocess`; in Phase 4.1, at minimum:
* Use `applyEnvPatch(process.env, envelope.envPatch)` wherever env is passed explicitly to spawned processes.

---

## 7. Config schema requirements

### 7.1 Expand `docs/config-schema.json` minimally for Phase 4
At minimum, allow:
* `threads` (number)
* `runtime` object:
  * `uvThreadpoolSize` (int >= 1)
  * `maxOldSpaceMb` (int >= 128)
  * `nodeOptions` (string)
  * `ioOversubscribe` (boolean)

Additionally, because runtime envelope must resolve concurrency from indexing config, allow:
* `indexing` object with:
  * `concurrency` object (if needed)
  * or at least allow `indexing.maxFileBytes`, `indexing.maxFileLines`, `indexing.fileCaps` if Phase 4.7 is implemented via config

**Recommendation:** For Phase 4.1, keep schema additions narrow and explicitly documented. Broader schema expansion can be done later.

---

## 8. Tests

Add Node test modules under `tests/` (Node’s built-in test runner is already used).

### 8.1 runtime envelope requested/effective semantics
Create: `tests/runtime-envelope-uv-threadpool-precedence.js`

Cases:
1. No requested value, no base env: effective is 4 (default), patch is empty.
2. Requested via config: patch sets UV_THREADPOOL_SIZE; effective equals requested when base env absent.
3. Base env UV_THREADPOOL_SIZE set: patch does not override; warning emitted if requested differs.

### 8.2 NODE_OPTIONS and max-old-space merging
Create: `tests/runtime-envelope-node-options-merge.js`

Cases:
1. Requested maxOldSpaceMb when base NODE_OPTIONS absent ⇒ patch adds `--max-old-space-size=…`.
2. Base NODE_OPTIONS already includes `--max-old-space-size=…` ⇒ patch does not add another; warning if requested differs.
3. Requested nodeOptions appended only once.

### 8.3 config dump surface
Create: `tests/index-config-dump.js`

Run `node scripts/build_index.js --config-dump --json` and assert:
* exit code 0
* stdout parses as JSON with `schemaVersion: 1`
* includes `runtime`, `concurrency`, `queues`, and `envPatch`.

---

## 9. Migration and backwards compatibility

* Existing `tools/dict-utils/paths.js:getRuntimeConfig()` is currently a stub.  
  After implementing `RuntimeEnvelopeV1`, either:
  * delete it (preferred), or
  * re-implement it as a thin wrapper around envelope resolution.

* Keep do-not-clobber behavior for `UV_THREADPOOL_SIZE` and `NODE_OPTIONS` to align with later roadmap phases and existing tests (`tests/uv-threadpool-no-override.js`).

---

## 10. Performance considerations

* `resolveRuntimeEnvelope` must be pure and fast: only string/number parsing and simple computations.
* Avoid any file IO in the resolver; file IO belongs to config loading, not envelope creation.
* Warnings must be recorded but should not spam logs; logging occurs elsewhere (Phase 4.5).

