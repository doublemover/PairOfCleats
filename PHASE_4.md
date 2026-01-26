# Phase 4 Distillation — Runtime Envelope, Concurrency, and Safety Guardrails

## Reference specs (Phase 4)
These documents define the “best version” design details:
- `spec_phase4_runtime_envelope_v1.md`
- `spec_phase4_concurrency_abort_runwithqueue.md`
- `spec_phase4_subprocess_helper.md`
- `spec_phase4_json_stream_atomic_replace.md`
- `spec_phase4_large_file_caps_strategy.md`
- `spec_phase4_safe_regex_hardening.md`

---

## 4.1 Unified runtime envelope surface + deterministic propagation to child processes

### Deliverables
- A single JSON-serializable `RuntimeEnvelopeV1` with:
  - configured vs effective values
  - per-field source attribution (cli/config/env/default)
  - bounded warnings list
- One canonical resolver: `resolveRuntimeEnvelope({ argv, rawArgv, userConfig, env })`
- One canonical child env builder: `resolveRuntimeEnv(envelope, process.env)`
- One canonical dump: `pairofcleats index --config-dump` prints stable JSON

### Tasks
- [x] Add `src/shared/runtime-envelope.js` (new)
  - [x] Define `RuntimeEnvelopeV1` shape (stable contract)
    - [x] `configured`: requested values with sources (modeled as `requested`/`effective` SourcedValue pairs per spec)
    - [x] `effective`: normalized + clamped values
    - [x] `sources`: per-field attribution
    - [x] `warnings[]`: bounded, deterministic messages
    - [x] `generatedAt`, `toolVersion`, `nodeVersion`, `platform`
  - [x] Implement `resolveRuntimeEnvelope({ argv, rawArgv, userConfig, env })`
    - [x] Enforce precedence: **CLI > config file > environment > defaults**
    - [x] Normalize numeric limits; reject invalid values with precise error messages
    - [x] Compute derived defaults once:
      - CPU count
      - suggested UV threadpool size
      - lane caps (io/cpu/embedding) + pending limits
    - [x] Ensure resolver is pure (no mutation of inputs; no reading global process state besides passed `env`)
  - [x] Implement `resolveRuntimeEnv(envelope, baseEnv)`
    - [x] Deterministically set:
      - `UV_THREADPOOL_SIZE` (only if requested; do not overwrite if user explicitly set and envelope source is default)
      - `NODE_OPTIONS` (merge, do not clobber unrelated flags; ensure `--max-old-space-size` is set only when requested)
    - [x] Ensure **stderr-only** for warnings; stdout reserved for machine outputs (Phase 4.5 compatibility)
- [x] Wire envelope into runtime creation
  - [x] `src/index/build/runtime/runtime.js`
    - [x] Attach `runtime.envelope` and require downstream to use it
  - [x] `src/shared/threads.js` must source defaults from envelope (not ad-hoc env reads)
  - [x] `src/shared/concurrency.js` / runtime queue creation must use envelope lane caps
- [x] Wire envelope into all Node spawn sites (centralized)
  - [x] Identify all spawn sites that run Node code:
    - `bin/pairofcleats.js`
    - `src/integrations/core/index.js`
    - `src/retrieval/cli/load-indexes.js`
    - `src/shared/artifact-io/compression.js`
    - `tools/bench-language-matrix.js`
    - `tools/bench-language-repos.js`
    - `tools/bootstrap.js`
    - `tools/ci-build-artifacts.js`
    - `tools/ci/run-suite.js`
    - `tools/combined-summary.js`
    - `tools/compare-models.js`
    - `tools/indexer-service.js`
    - `tools/map-iso-serve.js`
    - `tools/mcp/runner.js`
    - `tools/parity-matrix.js`
    - `tools/run-phase22-gates.js`
    - `tools/setup.js`
    - `tools/triage/context-pack.js`
    - `tools/triage/ingest.js`
  - [x] Ensure each uses `resolveRuntimeEnv(...)` (or documents why not)
- [x] Add `--config-dump` output
  - [x] `bin/pairofcleats.js`
    - [x] Implement `pairofcleats index --config-dump`
    - [x] Print **only JSON** to stdout (no logs), representing:
      - runtime envelope (configured/effective/sources/warnings)
      - derived lane caps
    - [x] Ensure stable ordering where feasible (e.g., keys sorted or at least consistent by construction)
  - [x] Update `docs/config-schema.json` (minimal runtime/concurrency additions)
    - [x] Allow `threads` and `runtime.*` (uvThreadpoolSize, maxOldSpaceMb, nodeOptions, ioOversubscribe)
    - [x] Ensure indexing concurrency fields referenced by envelope are schema-valid

#### Tests / Verification
- [x] `tests/runtime-envelope-uv-threadpool-precedence.js`
  - [x] Cover default, config request, and external UV override cases
- [x] `tests/runtime-envelope-node-options-merge.js`
  - [x] Cover max-old-space merge + external NODE_OPTIONS override
- [x] `tests/index-config-dump.js`
  - [x] Assert dump includes schemaVersion/runtime/concurrency/queues/envPatch
- [x] `tests/runtime/runtime-envelope-spawn-env.test.js`
  - [x] Spawn a tiny Node child via the tool’s wrapper
  - [x] Assert child sees expected `UV_THREADPOOL_SIZE` and `NODE_OPTIONS`
  - [x] Assert `NODE_OPTIONS` merge preserves unrelated flags

---

## 4.2 Thread limit precedence + threadpool-aware I/O scheduling

### Deliverables
- `resolveThreadLimits()` precedence fixed: CLI wins over env/config
- I/O concurrency defaults and clamps derived from effective UV threadpool size
- One consistent queue cap model across build + watch + tooling

### Tasks
- [x] Fix thread limit precedence
  - [x] `src/shared/threads.js` (`resolveThreadLimits`)
    - [x] Precedence: CLI > config > env > defaults
    - [x] Error attribution must reflect source (cli/config/env/autoPolicy)
  - [x] Update call sites to pass the right inputs (avoid hidden env dominance)
    - [x] `src/index/build/runtime/workers.js`
    - [x] `tools/build-sqlite-index/run.js`
- [x] Make I/O concurrency explicitly threadpool-aware
  - [x] Define policy (use the same constants everywhere; per spec: `ioDefaultCap = min(64, max(1, uv*4))`)
    - [x] Clamp `fileConcurrency`, `importConcurrency`, and `ioConcurrency` unless `ioOversubscribe`
  - [x] Implement in:
    - [x] `src/shared/concurrency.js` (`createTaskQueues`)
    - [x] `src/index/build/runtime/workers.js` (`createRuntimeQueues`)
    - [x] `src/index/build/indexer/steps/process-files.js` (`createShardRuntime`)
  - [x] Ensure CPU lane concurrency is independent from IO lane but still bounded by available cores
- [x] Ensure pending limits exist and are enforced (bounded memory)
  - [x] Add `pendingLimit` defaults for each lane (io/cpu/embedding)
  - [x] Ensure queues reject/enqueue with backpressure once pending limit is hit

#### Tests / Verification
- [x] `tests/thread-limits-precedence-cli-over-env.js`
- [x] `tests/io-concurrency-cap-uv-threadpool.js`
- [x] `tests/shard-runtime-uses-threadlimits-io.js`
- [x] `tests/concurrency/pending-limit-enforced.test.js`

---

## 4.3 Abortable runWithQueue + error handling semantics

### Deliverables
- A single abortable queue helper that:
  - is AbortSignal-aware
  - does not leave hanging promises
  - supports best-effort and fail-fast modes

### Tasks
- [x] Implement abortable queue primitive per `spec_phase4_concurrency_abort_runwithqueue.md`
  - [x] `src/shared/concurrency.js`
    - [x] `runWithQueue(items, worker, options)` additions:
      - [x] `signal?: AbortSignal`
      - [x] `bestEffort?: boolean` (default false)
      - [x] `onError?: (err, item) => void`
      - [x] `onProgress?: ({done,total}) => void` (optional; must not spam)
    - [x] Ensure:
      - [x] Fail-fast: first error aborts remaining work and rejects
      - [x] Best-effort: collect errors, continue, throw `AggregateError`
      - [x] Abort: stop scheduling new work; reject outstanding waits; worker must observe signal if doing long work
- [x] Replace ad-hoc queues with `runWithQueue` where appropriate
  - [x] Build file processing lane scheduling (worker ctx updates applied)
  - [x] Watch processing scheduling
  - [x] Any embedding batch scheduling

#### Tests / Verification
- [x] `tests/concurrency-run-with-queue-best-effort.js`
- [x] `tests/concurrency-run-with-queue-abort.js`
- [x] `tests/async/runwithqueue-failfast.test.js`

---

## 4.4 Cancellation semantics across lanes + subprocess boundaries

### Deliverables
- One “standard cancellation story”:
  - abort signal created at the top (CLI command invocation)
  - propagated into all async lanes (io/cpu/embedding)
  - propagated into subprocess spawning; abort kills child, tears down streams, and resolves/rejects deterministically

### Tasks
- [x] Add shared abort utilities (single canonical helpers)
  - [x] `src/shared/abort.js` (new)
    - [x] `createAbortControllerWithHandlers()`
    - [x] `createAbortError()` / `isAbortError()`
    - [x] `throwIfAborted(signal)`
    - [x] `raceAbort(signal, promise)` (ensures awaits don’t hang)
- [x] Thread `AbortSignal` through:
  - [x] build index pipeline stages (discover/preprocess/process)
  - [x] runWithQueue workers
  - [x] embedding/vector generation
- [x] Ensure subprocess spawning is abortable
  - [x] Integrate with `spec_phase4_subprocess_helper.md` (Phase 4.9) so abort kills the child process and resolves error paths.

#### Tests / Verification
- [x] `tests/abort/abort-propagates-to-queues.test.js`
- [x] `tests/abort/abort-propagates-to-subprocess.test.js`

---

## 4.5 Logging, progress, and output contracts (stdout discipline)

### Deliverables
- stdout is reserved for:
  - `--json` outputs
  - config dumps
  - tool-server machine outputs
- logs and progress go to stderr
- progress and logging are deterministic and bounded (no spam loops)

### Tasks
- [x] Enforce stdout contract everywhere
  - [x] Audit all `console.log()` / stdout writes in:
    - `bin/`
    - `tools/`
    - `src/`
  - [x] Replace with stderr logging (or structured logger) where not an explicit JSON output
- [x] Fix progress semantics for edge cases
  - [x] Ensure `total=0` does not produce divide-by-zero, NaN%, or spam
- [x] Normalize `--progress=tty`:
    - [x] only use interactive TTY progress when `process.stderr.isTTY === true`
    - [x] otherwise degrade to `--progress=log` (or none) deterministically
- [x] Ensure pino-pretty (or equivalent) is gated correctly
  - [x] If pretty logging is enabled, ensure it only affects stderr and never machine outputs
- [x] Ensure ring buffer and “recent logs” are bounded and sanitized
  - [x] No unbounded accumulation of metadata
  - [x] Stable truncation rules

#### Tests / Verification
- [x] `tests/logging/stdout-contract.test.js`
- [x] `tests/progress/total-zero-safe.test.js`
- [x] `tests/progress/tty-normalization.test.js`

---

## 4.6 JSON streaming writer correctness + gzip forwarding

(See `spec_phase4_json_stream_atomic_replace.md`.)

### Deliverables
- JSON streaming writer honors gzip options and max bytes
- deterministic JSON chunk emission
- does not corrupt on partial writes

### Tasks
- [x] Ensure gzip parameters are forwarded end-to-end
  - [x] `src/shared/json-stream.js`
  - [x] `src/shared/artifact-io.js` (n/a: no stream writer wrapper)
- [x] Ensure maxBytes enforcement happens on disk writes
  - [x] hard stop once exceeding cap
  - [x] return explicit error code
- [x] Ensure writer closes cleanly on abort
  - [x] tie into Phase 4.4 abort semantics

#### Tests / Verification
- [x] `tests/json-stream/gzip-options-forwarded.test.js`
- [x] `tests/json-stream/maxbytes-enforced.test.js`
- [x] `tests/json-stream/abort-closes-stream.test.js`

---

## 4.7 Large-file strategy and cap correctness

(See `spec_phase4_large_file_caps_strategy.md`.)

### Deliverables
- language-aware (and optionally mode-aware) cap resolution at every skip/reuse decision point
- cached-bundle reuse cannot bypass caps
- skip records always include reason + cap values

### Tasks
- [x] Implement canonical cap resolution updates
  - [x] `src/index/build/file-processor/read.js`
    - [x] extend resolver to accept `(languageId, mode)`
  - [x] `src/index/build/file-processor/skip.js`
    - [x] thread `languageId`, `mode`, and `maxFileBytes` (defense-in-depth)
    - [x] ensure skip includes `{ reason:'oversize', stage:'pre-read', ... }`
  - [x] `src/index/build/file-processor/cached-bundle.js`
    - [x] resolve caps with `(languageId, mode)` and clamp with `maxFileBytes`
    - [x] ensure skip includes `{ reason:'oversize', stage:'cached-reuse', ... }`
- [x] (Optional but recommended) harden watch + discovery cap resolution
  - [x] `src/index/build/watch.js`
  - [x] `src/index/build/discover.js`

#### Tests / Verification
- [x] `tests/file-caps/pre-read-skip-respects-language.test.js`
- [x] `tests/file-caps/cached-bundle-respects-caps.test.js`
- [x] `tests/file-caps/doc-mode-large-markdown-not-skipped.test.js` (only if `byMode` exists)

---

## 4.8 Safe regex hardening

(See `spec_phase4_safe_regex_hardening.md`.)

### Deliverables
- no post-hoc timeouts
- deterministic flag handling across re2/re2js
- diagnostics on rejected regex compilation (where feasible)
- continued use of safe-regex for all user-driven patterns

### Tasks
- [x] Update safe-regex core
  - [x] `src/shared/safe-regex.js`
    - [x] remove timing-based `timeoutMs` semantics
    - [x] restrict + canonicalize flags to `gims`
    - [x] add `compileSafeRegex(...)` diagnostics helper
- [x] Update call sites (at minimum)
  - [x] `src/index/risk-rules.js`
    - [x] use `compileSafeRegex(...)`
    - [x] record bounded diagnostics (errors/warnings)
  - [x] `src/retrieval/output/filters.js`
    - [x] implement Option A fallback (pattern substring) for failed `/.../flags`
- [x] (Optional audit) find any remaining user-driven `new RegExp(...)` uses and either:
  - [x] replace with safe-regex, or
  - [x] prove inputs are not user-driven and are bounded

#### Tests / Verification
- [x] `tests/safe-regex/program-size-cap.test.js`
- [x] `tests/safe-regex/input-length-cap.test.js`
- [x] `tests/safe-regex/flags-normalization.test.js`
- [x] `tests/risk-rules/invalid-pattern-diagnostics.test.js`

---

## 4.9 Subprocess helper (consolidate spawn semantics)

(See `spec_phase4_subprocess_helper.md`.)

### Deliverables
- one subprocess helper that:
  - centralizes spawn options
  - propagates runtime envelope env vars
  - supports AbortSignal cancellation correctly

### Tasks
- [x] Add `src/shared/subprocess.js` (or agreed location)
  - [x] `spawnSubprocess(command, args, options)`
  - [x] callers pass env already patched via `resolveRuntimeEnv(...)`
  - [x] abort kills child and closes streams
  - [x] errors propagate with stable error codes
- [x] Replace ad-hoc spawns with helper
  - [x] `tools/indexer-service.js`
  - [x] `src/integrations/core/index.js`
  - [x] other Node spawn sites found via grep
  - Deferred (streaming or long-lived processes): `tools/ctags-ingest.js`, `tools/gtags-ingest.js`,
    `tools/scip-ingest.js`, `src/integrations/tooling/lsp/client.js`, `src/lang/python/pool.js`,
    `tools/map-iso-serve.js`

#### Tests / Verification
- [x] `tests/subprocess/spawn-error-propagates.test.js`
- [x] `tests/subprocess/abort-kills-child.test.js`
- [x] `tests/subprocess/timeout-kills-child.test.js`
- [x] `tests/subprocess/capture-bounds.test.js`

---

## 4.10 Embedding/vector and encoding guardrails

### Deliverables
- merging vectors never produces NaNs
- quantization normalization parity across vector forms
- encoding metadata is preserved and reused deterministically

### Tasks
- [x] Fix vector merge logic (`mergeEmbeddingVectors`)
  - [x] `src/shared/embedding-utils.js`
    - [x] treat missing entries as `0`
    - [x] never add `undefined` (avoid NaN)
- [x] Normalize vectors consistently before quantization (if multiple vector forms emitted)
  - [x] `src/index/build/file-processor/embeddings.js`
    - [x] ensure `embedding_u8`, `embed_code_u8`, `embed_doc_u8` follow the same normalization rule unless contract explicitly says otherwise
- [x] Encoding metadata plumbing and reuse
  - [x] `src/shared/encoding.js`
    - [x] ensure decoded output includes encoding + fallback flags (already present)
  - [x] `src/index/build/file-processor.js`
    - [x] persist encoding metadata in file meta artifacts
    - [x] when file bytes unchanged, reuse prior encoding metadata deterministically
    - [x] fallback decoding warnings must be bounded and “warn once per file per run”

#### Tests / Verification
- [x] `tests/embeddings/merge-vectors-no-nan.test.js`
- [x] `tests/embeddings/quantize-normalization-parity.test.js` (if multiple forms emitted)
- [x] `tests/encoding/metadata-plumbed-and-reused.test.js`

---

## 4.11 Atomic file replace and `.bak` hygiene

(See `spec_phase4_json_stream_atomic_replace.md`.)

### Deliverables
- atomic replace works consistently across platforms
- `.bak` files do not accumulate
- safe cross-device fallback

### Tasks
- [x] Harden `replaceFile(...)`
  - [x] `src/shared/json-stream.js`
  - [x] `src/shared/artifact-io.js` (shared cleanup helper)
  - [x] cleanup `.bak` after successful replace where safe
  - [x] ensure Windows path-length logic remains correct
  - [x] safe fallback for cross-device rename
- [x] Ensure replace is used consistently where needed
  - [x] all artifact writes that claim atomicity must call the same helper

#### Tests / Verification
- [x] `tests/fs/atomic-replace-cleans-bak.test.js`
- [x] `tests/fs/atomic-replace-cross-device-fallback.test.js`

---

## Recommended implementation order (to reduce rework)

- [x] 1) 4.1 Runtime envelope (enables consistent config + spawn env shaping)
- [x] 2) 4.2 Thread + queue caps (depends on envelope)
- [x] 3) 4.3–4.4 Abort + runWithQueue (depends on queue model)
- [x] 4) 4.9 Subprocess helper (depends on envelope + abort)
- [x] 5) 4.5 Logging/progress contract (can be parallel but benefits from envelope’s dump mode)
- [x] 6) 4.6 + 4.11 JSON stream + atomic replace (largely independent)
- [x] 7) 4.7 Large-file caps (touches build/watch/discover; best after queue+abort are stable)
- [x] 8) 4.8 Safe regex (touches shared + risk rules + retrieval)
- [x] 9) 4.10 Embedding/encoding guardrails

