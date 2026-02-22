# Progress Event Protocol (JSONL) — v2

This spec defines the **single protocol boundary** used by the Rust TUI, the Node supervisor, and any progress-capable Node scripts. It is designed to formalize the “try JSON parse, else treat as log line” pattern already used by `tools/bench/language/process.js`.

> Context: Existing emitters: `src/shared/cli/display.js` (JSONL mode) and parser `src/shared/cli/progress-events.js`.

---

## 1) Goals / Non-goals

### Goals
- A **strict JSONL** event stream that the Rust TUI can parse reliably.
- A formal allowlist of event types; avoid misclassifying arbitrary JSON as “progress”.
- Support nesting: **jobs** contain **tasks** and **logs**.
- Stable, versioned schema with backwards compatibility strategy.

### Non-goals
- Represent every possible logging format from every script.
- Replace existing human-readable output for non-supervised CLI usage.

---

## 2) Transport & framing

### 2.1 Transport
- UTF-8 text over any byte stream (pipes, files).
- Each record is a single JSON object encoded as one line (JSON Lines / JSONL).

### 2.2 Framing rule
- **One JSON object per `\n`**.
- `\r\n` is permitted and must be normalized by receivers.
- Senders MUST NOT emit multi-line JSON.
- Receivers MUST tolerate:
  - partial lines (chunk boundaries),
  - trailing partial line at end of stream.

### 2.3 Output channel policy
- **Supervisor stdout**: MUST be JSONL only (strict v2 events).
- Child processes:
  - MAY emit any mixture of progress JSONL and plain text.
  - Supervisor MUST wrap any non-protocol line into a protocol `log` event.

---

## 3) Versioning

### 3.1 Protocol marker
All v2 events MUST include:

- `proto: "poc.progress@2"`

This is the primary discriminator. Without it, a JSON object MUST NOT be treated as a v2 progress event.

### 3.2 Backcompat strategy
Receivers MAY support v1 events (legacy) *only* when explicitly opted into:
- v1 has no `proto`, but still has `{ event, ts }`.
- v1 parsing MUST enforce `event` allowlist to avoid false positives.

Recommended API:
- `parseProgressEventLine(line, { strict = true })`
  - `strict=true`: requires `proto === "poc.progress@2"`
  - `strict=false`: accept v1 events if allowlisted and `ts` resembles ISO-8601.

---

## 4) Canonical event schema (base envelope)

All events share this envelope:

| Field | Type | Required | Notes |
|---|---|---:|---|
| `proto` | string | ✅ | Must equal `"poc.progress@2"` |
| `event` | string | ✅ | Allowlisted event name |
| `ts` | string | ✅ | ISO-8601 timestamp (`new Date().toISOString()`) |
| `runId` | string | ✅ | Unique per TUI session (supervisor instance) |
| `jobId` | string | ✅* | Required for all job-scoped events; not required for `hello` |
| `seq` | integer | ✅ | Monotonic per **job** when `jobId` exists; otherwise per supervisor stream; starts at 1 |
| `pid` | integer \| null | ⛔️ | PID of the child that produced the event (if relevant) |
| `stream` | `"stdout"` \| `"stderr"` \| null | ⛔️ | Only for forwarded child output or wrapped log |

> `runId` and `seq` are emitted by the supervisor. Child scripts are not required to emit them.

---

## 5) Event types

### 5.1 Supervisor/session events

#### `hello`
Emitted once on supervisor startup.

Additional fields:
- `supervisorVersion`: string (matches package version if possible)
- `capabilities`: object
  - `protocolVersion`: `"poc.progress@2"`
  - `supportsCancel`: boolean
  - `supportsResultCapture`: boolean

Example:
```json
{"proto":"poc.progress@2","event":"hello","ts":"2026-01-30T12:00:00.000Z","runId":"run-...","seq":1,"supervisorVersion":"0.3.0","capabilities":{"protocolVersion":"poc.progress@2","supportsCancel":true,"supportsResultCapture":true}}
```

### 5.2 Job lifecycle events

#### `job:start`
Emitted when a run request is accepted.

Additional fields:
- `command`: array of strings (argv-style, excluding node path)
- `cwd`: string
- `title`: string (UI label)
- `requested`: object (optional; structured request summary)

Example:
```json
{"proto":"poc.progress@2","event":"job:start","ts":"2026-02-04T12:00:00.000Z","seq":1,"runId":"run-1","jobId":"job-1","command":["build_index.js"],"cwd":"C:/repo","title":"Index build"}
```

#### `job:spawn`
Emitted after the subprocess is spawned.

Additional fields:
- `pid`: integer
- `spawnedAt`: ISO string (optional; can equal `ts`)

Example:
```json
{"proto":"poc.progress@2","event":"job:spawn","ts":"2026-02-04T12:00:00.050Z","seq":2,"runId":"run-1","jobId":"job-1","pid":12345,"spawnedAt":"2026-02-04T12:00:00.050Z"}
```

#### `job:end`
Emitted exactly once per job.

Additional fields:
- `status`: `"done"` \| `"failed"` \| `"cancelled"`
- `exitCode`: integer \| null
- `signal`: string \| null
- `durationMs`: integer
- `result`: object \| string \| null (optional, depends on capture policy)
- `error`: object \| null
  - `message`: string
  - `code`: string \| null

Example:
```json
{"proto":"poc.progress@2","event":"job:end","ts":"2026-02-04T12:00:10.000Z","seq":500,"runId":"run-1","jobId":"job-1","status":"ok","exitCode":0,"durationMs":10000,"result":{"summary":{"chunks":120}}}
```

#### `job:artifacts`
Emitted after `job:end` when the supervisor completes the artifacts indexing pass.

Additional fields:
- `artifacts`: array of artifact records (see `docs/specs/supervisor-artifacts-indexing-pass.md`)
- `artifactsIndexed`: boolean (true when pass completed)

Example:
```json
{"proto":"poc.progress@2","event":"job:artifacts","ts":"2026-02-04T12:00:10.010Z","seq":501,"runId":"run-1","jobId":"job-1","artifactsIndexed":true,"artifacts":[{"kind":"index","label":"sqlite","path":"C:/repo/.cache/index-sqlite","exists":true,"bytes":12345,"mtime":"2026-02-04T12:00:09.000Z","mime":"application/x-sqlite3"}]}
```

#### `runtime:metrics`
Supervisor runtime telemetry event used for queue depth, drop/coalesce counters, and throughput signals.

Example:
```json
{"proto":"poc.progress@2","event":"runtime:metrics","ts":"2026-02-04T12:00:10.020Z","seq":502,"runId":"run-1","flow":{"credits":384,"queueDepth":3,"sent":1200,"dropped":4,"coalesced":21,"chunked":2}}
```

#### `event:chunk`
Chunk envelope for oversized events/log payloads. Receivers must reassemble ordered chunks by `chunkId`.

Fields:
- `chunkId`: stable chunk stream id
- `chunkEvent`: original event type
- `chunkIndex`: zero-based chunk index
- `chunkCount`: total chunks
- `chunk`: serialized slice payload

Example:
```json
{"proto":"poc.progress@2","event":"event:chunk","ts":"2026-02-04T12:00:10.030Z","seq":503,"runId":"run-1","jobId":"job-1","chunkId":"run-1-chunk-9","chunkEvent":"log","chunkIndex":0,"chunkCount":3,"chunk":"{\"proto\":\"poc.progress@2\"..."}
```

### 5.3 Task progress events (from `src/shared/cli/display.js`)

These are already emitted by `createDisplay()` when `--progress jsonl`.

#### Common task fields
| Field | Type | Required |
|---|---|---:|
| `taskId` | string | ✅ |
| `name` | string | ✅ |
| `current` | number | ✅ |
| `total` | number \| null | ✅ |
| `unit` | string \| null | ⛔️ |
| `stage` | string \| null | ⛔️ |
| `mode` | string \| null | ⛔️ |
| `status` | string \| null | ⛔️ |
| `message` | string \| null | ⛔️ |
| `ephemeral` | boolean \| null | ⛔️ |

#### `task:start`
- Emitted when a task is first created (`ensureTask()` in `display.js`).

Example:
```json
{"proto":"poc.progress@2","event":"task:start","ts":"2026-02-04T12:00:00.010Z","seq":3,"runId":"run-1","jobId":"job-1","taskId":"code:scan","name":"Scanning code","stage":"code"}
```

#### `task:progress`
- Emitted on update (`updateTask()` in `display.js`).

Example:
```json
{"proto":"poc.progress@2","event":"task:progress","ts":"2026-02-04T12:00:00.120Z","seq":4,"runId":"run-1","jobId":"job-1","taskId":"code:scan","current":24,"total":120,"unit":"files","percent":20}
```

#### `task:end`
- Emitted when a task completes (`done` or `fail`).

Example:
```json
{"proto":"poc.progress@2","event":"task:end","ts":"2026-02-04T12:00:01.200Z","seq":5,"runId":"run-1","jobId":"job-1","taskId":"code:scan","status":"ok","durationMs":1190}
```
### 5.4 Log events

#### `log`
Either emitted by `createDisplay()` (JSONL mode) or wrapped by the supervisor.

Fields:
| Field | Type | Required |
|---|---|---:|
| `level` | `"trace"`\|`"debug"`\|`"info"`\|`"warn"`\|`"error"` | ✅ |
| `message` | string | ✅ |
| `meta` | object \| null | ⛔️ |
| `stream` | `"stdout"`\|`"stderr"`\|null | ⛔️ |

Notes:
- When wrapping raw lines, supervisor SHOULD:
  - use `level="info"` for stdout lines
  - use `level="info"` for stderr lines unless the line matches `^\[error\]` or similar heuristics

Example:
```json
{"proto":"poc.progress@2","event":"log","ts":"2026-02-04T12:00:00.030Z","seq":6,"runId":"run-1","jobId":"job-1","level":"info","stream":"stderr","message":"indexing started"}
```

---

## 6) Emission rules (normative)

### 6.1 Supervisor rules
- MUST emit `hello` first.
- MUST include `proto`, `runId`, `seq`, `ts` on every event.
- MUST add `jobId` to every job/task/log event.
- MUST NOT write any non-JSONL data to stdout.
- When replay logging is enabled, MUST mirror the same serialized JSONL events to the replay log.

### 6.2 Child script rules (recommended, not required)
- When invoked with `--progress jsonl`, scripts SHOULD:
  - emit progress/log events exclusively via `createDisplay()` to stderr.
- Scripts MAY still write raw output; it will be wrapped by supervisor.

---

## 7) Parsing rules (receiver)

### 7.1 Strict parsing (default for Rust TUI)
A line is a valid protocol event if:
- it is valid JSON (object), and
- `proto === "poc.progress@2"`, and
- `event` is in the allowlist set, and
- `ts` is a string

Anything else is rejected.

### 7.2 Compatibility parsing (optional, for bench harness)
A line may be treated as a legacy event if:
- valid JSON object
- `proto` is missing
- `event` is allowlisted (existing set: `task:start`, `task:progress`, `task:end`, `log`)
- `ts` looks ISO-8601

---

## 8) Implementation mapping to existing code

### Emitter mapping
- `src/shared/cli/display.js`
  - `writeJsonLog()` emits `log` events.
  - `emitTaskEvent()` emits `task:*` events.
  - Update recommended: merge `{ runId, jobId }` context into every event.

### Parser mapping
- `tools/bench/language/process.js`
  - Replace its “parse or log” with a shared decoder that enforces allowlist + proto rules.

---

## 9) Example: job with mixed output

Child emits:
- JSONL task progress on stderr
- some plain stderr lines

Supervisor emits (all strict v2 JSONL):
1) `job:start`
2) `job:spawn`
3) forwarded `task:*` events (augmented with jobId)
4) wrapped stderr line as `log`
5) `job:end`

---

## 10) Security / safety considerations
- Limit maximum line length (e.g. 1MB) to avoid memory blowups.
- Do not treat arbitrary JSON as progress unless `proto` matches.
- Avoid echoing secrets in `meta`; keep `meta` optional and bounded.
