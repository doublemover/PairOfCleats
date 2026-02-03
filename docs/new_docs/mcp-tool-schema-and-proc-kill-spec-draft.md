# Draft: MCP Tool Schema Stability Spec + Process-Tree Kill Semantics

This document contains:

1) A **public stability spec** for PairOfCleats’ MCP tool surface (“what’s stable across releases”).  
2) A small **internal-only** spec for process-tree kill semantics across Windows vs POSIX.

> Authority: Per current direction, GIGAMAP/GIGAROADMAP is authoritative. Any docs under `docs/` should be kept consistent with this spec once finalized.

---

# Part 1 — MCP tool schema stability spec (public)

## 1) Scope

This spec governs the stable contract of:

- tool definitions (names, arguments, argument validation),
- result payload shapes (success vs error),
- schema versioning rules,
- cancellation + timeout semantics,
- and progress notification semantics.

It applies to both:
- the **legacy** stdio JSON-RPC transport (`tools/mcp/server.js` + `tools/mcp/transport.js`), and
- an eventual **SDK-backed** server mode.

---

## 2) Versioning: `schemaVersion` and bump rules

### 2.1 Required version fields
We define two version concepts:

- **Tool schema version**: `schemaVersion` (monotonic integer)
  - Affects: argument names, argument semantics, result JSON shape, error code taxonomy.
- **Implementation build/version**: `toolingVersion` (string; e.g., SemVer + commit)
  - Used for debugging; not a compatibility gate.

Each tool definition MUST include:
- `name`
- `description`
- `inputSchema` (JSON Schema object)
- `schemaVersion` (integer)
- (recommended) `toolingVersion` (string)

### 2.2 Bump rules (monotonic integer)
A `schemaVersion` bump is required when:
- any **required** argument is added,
- any argument meaning changes,
- defaults change in a way that alters behavior,
- result JSON structure changes (add/remove/rename required fields),
- error codes are added/removed/renamed,
- cancellation/timeout semantics change in observable ways.

A bump is NOT required for:
- docs clarifications,
- adding purely optional arguments that default cleanly and are explicitly ignored unless set,
- adding optional fields to results that do not change meaning and are absent-by-default.

> Policy recommendation: If you have any doubt, bump the version. Tooling consumers (MCP clients) strongly prefer explicit bumps over silent drift.

---

## 3) Tool list and naming stability

### 3.1 Stable names
Tool names are stable identifiers. Renames are breaking and require:
- a `schemaVersion` bump, and
- a compatibility alias period (optional), where the old name remains available but deprecated.

### 3.2 Current tool set (as implemented)
As of the current repo snapshot, tools are defined in `src/integrations/mcp/defs.js`:

- `index_build`
- `index_status`
- `search`
- `show_file`
- `check_status`
- `workspace_status`

This spec assumes these tool names remain stable unless explicitly version-bumped.

---

## 4) Argument validation and “reserved field” policy

### 4.1 Unknown arguments
MCP tool calls MUST be deterministic and explicit:

- Unknown fields in `params.arguments` MUST be rejected as `INVALID_REQUEST` (or `INVALID_ARGS`) **unless**:
  - they are explicitly marked as `reserved` in the schema and must still be rejected if set.

### 4.2 “Accepted but ignored” is forbidden
A schema field must not exist if it does nothing. For each schema field, the implementation must:
- either map it to behavior,
- or reject it if set (reserved),
- or remove it.

This rule prevents consumer confusion and makes tests meaningful.

---

## 5) Result payload shapes (success vs error)

### 5.1 Success payload
Tools should return a JSON object result (tool-specific). Under legacy transport, the server currently wraps it as:

```jsonc
{
  "content": [
    { "type": "text", "text": "{...json...}" }
  ]
}
```

**Stability requirements:**
- The JSON inside `content[0].text` MUST be valid JSON.
- On success, the tool must not set `isError: true`.

> Optional improvement (future): emit `{ type: "json", json: {...} }` when supported by MCP clients. If added, keep the old `text` mode for compatibility.

### 5.2 Error payload
Under legacy transport, errors are returned as `isError: true` with JSON in `content[0].text`, shaped as:

```jsonc
{
  "message": "human-readable",
  "code": "ERROR_CODE_STRING",
  "stderr": "optional",
  "stdout": "optional",
  "timeoutMs": 12345,
  "hint": "optional remediation hint"
}
```

**Required:**
- `message` (string)
- `code` (string from the error code table below)

**Optional:**
- `stderr`, `stdout` (trimmed strings)
- `timeoutMs` (finite number)
- `hint` (string; stable-ish but not relied on programmatically)

---

## 6) Error code table (public, stable)

Error codes are string constants defined in `src/shared/error-codes.js`. The table below is the *public contract* for MCP consumers.

| Code | Meaning | Typical remediation |
|---|---|---|
| `INVALID_REQUEST` | Malformed request / unknown tool name / schema mismatch | Fix client request; update schema |
| `NOT_FOUND` | File/index/resource not found | Build the index / fix path |
| `NO_INDEX` | Index required but not present | Run build-index for the workspace/repo |
| `CAPABILITY_MISSING` | Optional dependency or platform capability missing | Install deps / change config |
| `QUEUE_OVERLOADED` | Server queue full | Retry later / reduce concurrency |
| `TOOL_TIMEOUT` | Tool exceeded timeout | Increase timeout / optimize / narrower scope |
| `CANCELLED` | Request cancelled by client | None; expected |
| `INTERNAL` | Unexpected internal error | Report bug; gather logs |
| `UNAUTHORIZED` / `FORBIDDEN` | Access control failures (if added) | Credentials/permissions |
| `DOWNLOAD_VERIFY_FAILED` | Integrity check failed for downloads | Retry; check network/proxy |
| `ARCHIVE_UNSAFE` / `ARCHIVE_TOO_LARGE` | Archive safety gate triggered | Use safer archive / lower size |

**Rule:** Do not add “one-off” codes lightly. Prefer extending `details` and keeping the code taxonomy small.

---

## 7) Cancellation semantics (public, stable)

### 7.1 Required behavior
When the server receives `$/cancelRequest` for an in-flight request:
- it MUST attempt to stop the work promptly,
- it MUST return exactly one terminal response for the original request ID,
- and that response MUST be `isError: true` with `code: "CANCELLED"`.

### 7.2 ID canonicalization (required)
JSON-RPC IDs can be string or number. The server MUST canonicalize IDs for in-flight tracking:

- store in-flight entries under `String(id)`
- cancellation lookup uses `String(params.id)`

This prevents silent cancellation failures when clients send numeric IDs and cancellation uses strings (or vice versa).

### 7.3 Post-cancellation progress
After cancellation:
- the server MUST stop sending progress notifications for that request ID (best effort).
- the response should not be “success” if cancellation occurred.

---

## 8) Timeout semantics (public, stable)

### 8.1 Required behavior
When a tool exceeds its timeout:
- the server MUST abort it,
- MUST return `isError: true` with `code: "TOOL_TIMEOUT"`,
- and MUST include `timeoutMs` in the error payload.

### 8.2 Subprocess behavior
If a tool spawns subprocesses:
- those subprocesses MUST be terminated on timeout.
- termination MUST be “tree-aware” (kill the process group on POSIX; `taskkill /T` on Windows).

(Internal details are specified in Part 2 below.)

---

## 9) Progress notification semantics (public, stable)

Progress notifications are sent as `notifications/progress` with payload:

```jsonc
{
  "id": "toolCallId",
  "tool": "search",
  "message": "human text",
  "stream": "info|stderr|stdout|debug",
  "phase": "progress|download|index|search|...",
  "ts": "ISO timestamp"
}
```

### 9.1 Throttling (required)
To avoid overwhelming clients:
- progress must be **throttled/coalesced** (recommended: <= 4 per second per tool call).
- if multiple lines arrive quickly, coalesce into one message with a summary or keep only the latest.

### 9.2 No progress after terminal response
After success/error response, do not emit further progress for that tool call.

---

## 10) Test requirements to enforce stability

Recommended minimum test suite additions:

- Schema snapshot tests:
  - `tests/services/mcp/mcp-schema.test.js` should assert stable tool names, required fields, and `schemaVersion`.
- Argument mapping tests:
  - for each tool field, ensure it affects behavior or is rejected.
- Cancellation tests:
  - cancellation produces `CANCELLED`, no success, no post-cancel progress.
- Timeout tests:
  - timeouts produce `TOOL_TIMEOUT`, subprocesses are killed (no orphans).

---

# Part 2 — Internal spec: process-tree kill semantics (Windows vs POSIX)

This section is internal implementation guidance to ensure timeouts/cancellation do not leak work.

## 1) Goals

- Ensure *all descendants* of a spawned tool subprocess are terminated (as much as the OS allows).
- Avoid leaving “orphan” processes after MCP cancellation/timeouts or test failures.
- Keep behavior consistent across Windows and POSIX.

## 2) Canonical implementation hook

Use the existing primitive:

- `src/shared/subprocess.js` (`spawnSubprocess`, `killProcessTree` behavior)

Do NOT reimplement ad-hoc kill logic in MCP modules. Instead:
- thread `AbortSignal` to `spawnSubprocess({ signal })`,
- and let the shared module perform termination.

## 3) POSIX semantics (Linux/macOS)

### 3.1 Process group strategy
- Spawn with `detached: true` so the child becomes the leader of a new process group.
- On kill: send signals to the process group using negative PID (`kill(-pid, SIGTERM)`).

### 3.2 Termination sequence
Recommended sequence (as implemented):
1. Send `SIGTERM` to the process group.
2. Wait a bounded grace period (e.g., 2000ms).
3. If still alive, send `SIGKILL` to the process group.

### 3.3 Edge cases
- If the process exits between steps, ignore “no such process” errors.
- If a descendant daemonizes itself into a different process group (rare), it may survive; treat as best-effort and consider additional hardening only if observed.

## 4) Windows semantics

### 4.1 Taskkill strategy
- Use: `taskkill /pid <PID> /T /F`
  - `/T` kills the process tree.
  - `/F` forces termination.

### 4.2 Edge cases
- If `taskkill` fails because the process already exited, ignore.
- Some processes may require elevated privileges; treat as a controlled error in tests/CI if it happens.

## 5) Testing requirements

A minimal cross-platform test should:
- spawn a long-running process that spawns a child,
- trigger abort,
- assert both parent and child terminate quickly.

Implementation note:
- Use a small Node script that spawns a child `node -e "setInterval(...)"` to form a tree.
- Confirm no further output is emitted after abort and that the parent exit event fires.

---

## 6) Open questions / decisions needed

- What is the default grace period (ms) before escalating to `SIGKILL` / forced kill?
- Should tools be allowed to override kill strategy (rare), or always use the shared primitive?
- How should we log kill failures in MCP mode (debug vs error)?

