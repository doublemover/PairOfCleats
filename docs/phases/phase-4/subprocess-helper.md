# Spec: `spawnSubprocess()` Helper (Phase 4.9)

Status: Draft (implementation-ready)

This spec defines a single subprocess orchestration helper that standardizes:

* spawning and environment propagation
* stdout/stderr capture with bounded memory
* timeouts
* AbortSignal cancellation
* kill-tree behavior (POSIX + Windows)

---

## 1. Goals

1. **Consistency:** eliminate ad-hoc subprocess spawning logic across the indexing system.
2. **Safety:** avoid orphaned processes and unbounded output buffering.
3. **Observability:** produce structured errors including exit code, signal, and captured output tails.
4. **Integration:** work seamlessly with RuntimeEnvelope env patching and with the AbortSignal-first cancellation model (Phase 4.4).

---

## 2. Non-goals

* Replacing synchronous command invocations (e.g., `spawnSync` / `execaSync`) in Phase 4.9 unless they cause operational issues.
* Implementing a full "process supervisor" or daemon framework.

---

## 3. Public API

Create: `src/shared/subprocess.js`

### 3.1 Types (logical)
```ts
interface SpawnSubprocessOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;   // full env for the child (already patched)
  stdio?: 'pipe' | 'inherit' | 'ignore' | Array<any>; // forwarded to child_process.spawn
  shell?: boolean;                            // discouraged; default false
  detached?: boolean;                         // default: true on POSIX, false on win32
  unref?: boolean;                            // if true, unref child so parent may exit
  input?: string | Buffer;                    // if provided, written to stdin (when piped)
  signal?: AbortSignal;                       // abort kills child (and tree) and rejects
  timeoutMs?: number;                         // timeout kills child (and tree) and rejects

  // Capture policy (only used when stdio uses pipes)
  captureStdout?: boolean;                    // default true if stdio=='pipe'
  captureStderr?: boolean;                    // default true if stdio=='pipe'
  maxOutputBytes?: number;                    // default 1_000_000
  outputEncoding?: BufferEncoding;            // default 'utf8'
  outputMode?: 'string' | 'lines';            // default 'string'
  onStdout?: (chunk: string) => void;         // optional live stdout hook (chunked)
  onStderr?: (chunk: string) => void;         // optional live stderr hook (chunked)
  onSpawn?: (child: ChildProcess) => void;    // optional hook to capture pid early

  // Exit policy
  rejectOnNonZeroExit?: boolean;              // default true
  expectedExitCodes?: number[];               // default [0]

  // Kill policy
  killSignal?: NodeJS.Signals;                // default 'SIGTERM'
  killGraceMs?: number;                       // default 5000 then SIGKILL
  killTree?: boolean;                         // default true

  // Diagnostics
  name?: string;                              // used in errors/log messages
}

interface SpawnSubprocessResult {
  pid: number;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  durationMs: number;
  stdout?: string | string[];
  stderr?: string | string[];
}

class SubprocessError extends Error {
  name = 'SubprocessError';
  code = 'SUBPROCESS_FAILED';
  result: SpawnSubprocessResult;
  cause?: unknown;
}

class SubprocessTimeoutError extends Error {
  name = 'SubprocessTimeoutError';
  code = 'SUBPROCESS_TIMEOUT';
  result: SpawnSubprocessResult;
}

class SubprocessAbortError extends Error {
  name = 'AbortError';
  code = 'ABORT_ERR';
  result: SpawnSubprocessResult;
}
```

### 3.2 Function signature
```ts
export function spawnSubprocess(
  command: string,
  args: readonly string[],
  options?: SpawnSubprocessOptions,
): Promise<SpawnSubprocessResult>;
```

---

## 4. Behavioral contract

### 4.1 Environment
* Callers pass an explicit `env` object.
* Phase 4.1 provides `applyEnvPatch()`; call sites should do:
  * `env: applyEnvPatch(process.env, runtimeEnvelope.envPatch)`
* `spawnSubprocess` must not mutate `options.env`.

### 4.2 Output capture
If `stdio` is `'pipe'` (default), capture stdout/stderr based on capture flags.

Bounded memory:
* Maintain a rolling buffer of at most `maxOutputBytes` per stream.
  * Implementation strategy: store chunks in an array and trim from head as needed.
* If `outputMode='lines'`:
  * Split on `\n` and keep rolling tail in terms of total bytes (not line count).

If `stdio` is `'inherit'`, do not capture (stdout/stderr in result omitted).

### 4.3 Exit policy
* If `rejectOnNonZeroExit=true`:
  * resolve only if `exitCode` is in `expectedExitCodes` (default `[0]`)
  * otherwise reject with `SubprocessError` including captured output and result details.
* If `rejectOnNonZeroExit=false`, always resolve.

### 4.4 Timeout
If `timeoutMs` is set:
* Start a timer at spawn.
* If timer fires before process exit:
  * kill the process (and tree, if killTree)
  * reject with `SubprocessTimeoutError`

### 4.5 AbortSignal
If `signal` is provided:
* If already aborted before spawn:
  * throw AbortError immediately, do not spawn.
* Otherwise, attach an `abort` listener:
  * kill process (and tree) promptly
  * reject with AbortError

**Important:** if both timeout and abort happen, abort should win if the signal fired first; otherwise timeout wins. Always include `result` for diagnostics.

### 4.6 Kill-tree behavior (cross-platform)
Default `killTree=true`.

POSIX:
* Spawn child with `detached=true` so it becomes leader of its own process group.
* Kill tree by sending signal to negative pid:
  * `process.kill(-pid, 'SIGTERM')`
* After `killGraceMs`, send `SIGKILL` to the process group if still alive.

Windows:
* Use `taskkill` for tree kill:
  * `taskkill /PID <pid> /T /F`
* If `taskkill` fails, fall back to `child.kill()` as best effort.

**Rationale:** Node's `child.kill()` does not reliably kill grandchildren; we need tree cleanup to avoid orphan processes in watch mode and long-running servers.

### 4.7 Listener cleanup
Ensure:
* abort listeners are removed on exit
* stdout/stderr listeners removed on exit
* timers cleared on exit
This is required to prevent leaks in watch mode.

---

## 5. Adoption scope for Phase 4.9

### 5.1 Critical adoption targets (must)
1. `src/integrations/core/index.js: runEmbeddingsTool()`
2. `tools/indexer-service.js` (spawn + wait helpers)
3. Any subprocess started in indexing pipeline that can outlive the parent (watch mode cancellation)

### 5.2 Deferred adoption targets (optional / later)
* python pool (special lifecycle)
* LSP client / language servers (special lifecycle)

---

## 6. Tests

Create: `tests/shared/subprocess/abort-kills-child.test.js`

Steps:
1. Spawn: `node -e "setInterval(() => {}, 1000)"` with `stdio: 'ignore'`, `killTree=true`.
2. Abort after 100ms.
3. Assert:
   * promise rejects with AbortError (code ABORT_ERR)
   * process is not alive after a short delay (best effort: attempt `process.kill(pid, 0)` and expect failure on POSIX)

Create: `tests/shared/subprocess/timeout-kills-child.test.js`

1. Spawn the same long-running process with `timeoutMs=200`.
2. Assert:
   * rejects with SubprocessTimeoutError
   * process is killed.

Create: `tests/shared/subprocess/capture-bounds.test.js`

1. Spawn a process that prints > maxOutputBytes to stdout.
2. Assert stdout in result is truncated to <= maxOutputBytes and contains the tail.

---

## 7. Integration with AbortSignal-first model

* `spawnSubprocess` should accept the same `signal` passed down from watch mode/build runtime.
* When used inside `runWithQueue`, pass the queue runner's `signal` through to `spawnSubprocess`.

---

## 8. Implementation notes (practical)

* Use `child_process.spawn` (not `exec`) by default.
* Avoid `shell=true` unless there is a strong reason; it changes quoting and complicates kill-tree behavior.
* If `detached=true`, consider `child.unref()` only if caller explicitly wants the parent to exit without waiting; by default keep it referenced for deterministic lifecycle management.

