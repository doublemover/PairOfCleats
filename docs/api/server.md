# Minimal API Server

## Overview
The API server is a lightweight local HTTP JSON wrapper around the core search/status
handlers. It is intended for local developer tooling (or local agent orchestration),
not for exposing publicly.

Auth behavior:
- When bound to a non-localhost address, auth is required unless `--allow-unauthenticated` is set.
- When bound to localhost, auth is optional unless you provide a token (then it is required).

Provide a bearer token via `PAIROFCLEATS_API_TOKEN` or `--auth-token`. Use
`--allow-unauthenticated` only when you explicitly want to disable auth.

The server runs in-process and does not shell out to the CLI.

## Startup
- `pairofcleats service api`

Options:
- `--host <addr>`: bind address (default `127.0.0.1`)
- `--port <port>`: port number (use `0` for an ephemeral port)
- `--repo <path>`: default repo root (auto-detected if omitted)
- `--output <compact|full|json>`: default search output (default `compact`)
- `--json`: emit a JSON startup line with `host`, `port`, and `baseUrl`
- `--quiet`: suppress non-essential logs
- `--auth-token <token>`: bearer token required for requests (or set `PAIROFCLEATS_API_TOKEN`)
- `--allow-unauthenticated`: explicit opt-out to disable auth
- `--cors-allowed-origins <list>`: comma-separated allowlist of origins
- `--cors-allow-any`: explicit opt-in to allow any origin (unsafe)
- `--allowed-repo-roots <list>`: comma-separated allowlist for `repoPath` overrides
- `--max-body-bytes <n>`: cap request body size in bytes (default 1,000,000)

## Endpoints

### `GET /health`
Returns a heartbeat payload with uptime.

Response:
```json
{ "ok": true, "uptimeMs": 12345 }
```

### `GET /status`
Reports artifact sizes and cache health using the core status payload from
`src/integrations/core/status.js`.

Query params:
- `repo`: optional repo path override

Response:
```json
{
  "ok": true,
  "repo": "/path/to/repo",
  "status": { "...": "see core status output" }
}
```

### `GET /status/stream`
Streams status as Server-Sent Events (SSE). Each event includes JSON `data`.

Events:
- `start` `{ ok, repo }`
- `result` `{ ok, repo, status }`
- `error` `{ ok: false, code, message }`
- `done` `{ ok }`

### `GET /metrics`
Returns Prometheus metrics for the API server.

Response:
```text
# HELP ...
# TYPE ...
```

### `POST /search`
Executes the search pipeline with the provided payload and returns JSON output.

Payload schema (canonical):
- The server validates payloads against `searchRequestSchema` in `tools/api/validation.js`.
- Unknown keys are rejected (`additionalProperties: false`).

Required:
- `query` (string, non-empty)

Optional:
- `repo` / `repoPath` (string)
- `output` (`compact` | `json` | `full`)
- `mode` (`code` | `prose` | `records` | `both` | `all` | `extracted-prose`)
- `backend` (`auto` | `memory` | `sqlite` | `sqlite-fts` | `lmdb`)
- `ann` (boolean), `top` (integer), `context` (integer)
- `type`, `author`, `import`, `calls`, `uses`, `signature`, `param`, `decorator`, `inferredType`,
  `returnType`, `throws`, `reads`, `writes`, `mutates`, `alias`, `awaits`
- `risk`, `riskTag`, `riskSource`, `riskSink`, `riskCategory`, `riskFlow`
- `branchesMin`, `loopsMin`, `breaksMin`, `continuesMin`, `churnMin` (integers)
- `chunkAuthor`, `modifiedAfter` (strings), `modifiedSince` (integer)
- `visibility`, `extends`, `branch`, `lang`
- `lint`, `async`, `generator`, `returns`, `case`, `caseFile`, `caseTokens` (booleans)
- `path`, `file`, `ext` (string or array of strings)
- `meta` (string | array | object), `metaJson` (any JSON value)

Response:
```json
{
  "ok": true,
  "repo": "/path/to/repo",
  "result": { "code": [ ... ], "prose": [ ... ] }
}
```

Errors:
- `400 INVALID_REQUEST` for schema or repo validation failures.
- `401 UNAUTHORIZED` for missing/invalid auth.
- `403 FORBIDDEN` for disallowed repo paths.
- `409 NO_INDEX` when indexes are missing.
- `500 INTERNAL` for unexpected failures.
Error payloads include `{ ok: false, code, message }` plus optional `errors` (validation) or `error` (internal detail).

### `POST /search/stream`
Runs a search and streams progress/results as SSE events. The request payload
matches `/search`.

Events:
- `start` `{ ok: true }`
- `progress` `{ ok: true, phase, message }`
- `result` `{ ok: true, repo, result }`
- `error` `{ ok: false, code, message }`
- `done` `{ ok }`

Example:
```bash
curl -N http://127.0.0.1:7345/search/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"return","mode":"code"}'
```

Notes:
- By default, `output` is `compact` (uses `--json --compact` in the CLI).
- Missing indexes return `409 NO_INDEX` with a JSON error payload.
- `Content-Type: application/json` is required for POST payloads.
- `repoPath` overrides are disabled by default and only allowed when `--allowed-repo-roots` is set.

## Error codes and troubleshooting
PairOfCleats uses the shared error code registry in `docs/contracts/mcp-error-codes.md`.
Common cases:
- `INVALID_REQUEST`: payload schema errors; verify required fields and types.
- `UNAUTHORIZED`: missing or invalid token; set `PAIROFCLEATS_API_TOKEN` or `--auth-token`.
- `FORBIDDEN`: repo path not allowed; update `--allowed-repo-roots`.
- `NO_INDEX`: indexes are missing; run `pairofcleats index build` (or `node build_index.js`).
- `INTERNAL`: unexpected failure; check server logs for details.

## Security considerations
- Auth is required for non-localhost bindings unless `--allow-unauthenticated` is set.
- CORS is disabled by default; enable with `--cors-allowed-origins` (include localhost explicitly) or opt-in to
  `--cors-allow-any` only if you understand the exposure.
- `repoPath` overrides require an explicit allowlist; otherwise the server uses its configured repo only.
