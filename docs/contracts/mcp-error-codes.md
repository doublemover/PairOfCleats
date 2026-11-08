# MCP error code registry

This document enumerates the canonical MCP error codes emitted by PairOfCleats
for tool execution failures and protocol-level errors.

## Tool error payload shape

Tool failures (CallToolResult with `isError: true`) MUST include a JSON payload
with these keys:

- `code` (string): one of the codes below.
- `namespaceCode` (string): normalized namespaced value (`poc.<lowercase_code>`).
- `message` (string): human-readable summary.
- Optional fields: `stderr`, `stdout`, `timeoutMs`, `exitCode`, `hint`, `nativeCode`,
  `reason`, `evidence`, `details`.

Semantic detail/find/trace use the same domain classifier as HTTP. Invalid limits,
stale generations and expired cursors are `INVALID_REQUEST`; scope mismatch is
`FORBIDDEN`; unavailable semantic index evidence is `NO_INDEX`. The original
domain code remains `nativeCode`. Expired cursors require fresh discovery rather
than replaying that cursor. Unknown failures retain `INTERNAL`.

Context-pack strict-evidence failures retain their reason and evidence summary.
Domain evidence/details use an explicit status/count/limit/generation allowlist,
at most eight nested levels, 128 visited values, sixteen entries per array and
512 characters per string, with a 16 KiB final field ceiling. Bounded output is
marked truncated; arbitrary Error properties, causes, credentials and filesystem
paths are not copied. Existing index-format diagnostics and their exact rebuild
command remain under their separate canonical projection.

## Canonical codes

- `INVALID_REQUEST` — arguments are missing/invalid, or an unsupported option is provided.
- `NO_INDEX` — required index artifacts are missing.
- `TOOL_TIMEOUT` — tool exceeded its configured timeout.
- `CAPABILITY_MISSING` — required optional capability or backend is not available.
- `CANCELLED` — request was cancelled before completion.
- `QUEUE_OVERLOADED` — server queue rejected the request due to load.
- `NOT_FOUND` — requested tool or resource was not found.
- `UNAUTHORIZED` — missing or invalid authentication.
- `FORBIDDEN` — authenticated but not permitted to perform the action.
- `DOWNLOAD_VERIFY_FAILED` — download failed integrity verification.
- `ARCHIVE_UNSAFE` — archive contents are unsafe (path traversal or policy violation).
- `ARCHIVE_TOO_LARGE` — archive exceeds size limits.
- `INTERNAL` — unexpected failures not covered above.

## Protocol-level errors

For JSON-RPC protocol errors (e.g., method not found), the server MUST include
an MCP error code in the `error.data.code` field, using the same values as above.
