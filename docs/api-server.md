# Minimal API Server

## Overview
The API server is a lightweight local HTTP JSON wrapper around the existing CLI
search/status commands. It is intended for local developer tooling (or local
agent orchestration), not for exposing publicly. There is no auth layer; bind to
`127.0.0.1` or a private interface.

## Startup
- `pairofcleats service api`

Options:
- `--host <addr>`: bind address (default `127.0.0.1`)
- `--port <port>`: port number (use `0` for an ephemeral port)
- `--repo <path>`: default repo root (auto-detected if omitted)
- `--output <compact|full|json>`: default search output (default `compact`)
- `--json`: emit a JSON startup line with `host`, `port`, and `baseUrl`
- `--quiet`: suppress non-essential logs

## Endpoints

### `GET /health`
Returns a heartbeat payload with uptime.

Response:
```json
{ "ok": true, "uptimeMs": 12345 }
```

### `GET /status`
Reports artifact sizes and cache health using the same logic as
`pairofcleats cache report`.

Query params:
- `repo`: optional repo path override

Response:
```json
{
  "ok": true,
  "repo": "/path/to/repo",
  "status": { "...": "see cache report output" }
}
```

### `GET /status/stream`
Streams status as Server-Sent Events (SSE). Each event includes JSON `data`.

Events:
- `start` `{ ok, repo }`
- `result` `{ ok, repo, status }`
- `error` `{ ok: false, message, stderr? }`
- `done` `{ ok }`

### `POST /search`
Executes `search.js` with the provided payload and returns JSON output.

Payload fields:
- `query` (required)
- `repo` / `repoPath` (optional override)
- `mode`, `backend`, `output`, `ann`, `top`, `context`
- Any CLI filter equivalent (e.g. `type`, `signature`, `reads`, `riskTag`, `path`, `ext`, `meta`)

Response:
```json
{
  "ok": true,
  "repo": "/path/to/repo",
  "result": { "code": [ ... ], "prose": [ ... ] }
}
```

### `POST /search/stream`
Runs a search and streams progress/results as SSE events. The request payload
matches `/search`.

Events:
- `start` `{ ok: true }`
- `log` `{ stream: "stderr", message }` (stderr lines, if any)
- `result` `{ ok: true, repo, result }`
- `error` `{ ok: false, message, code?, stderr? }`
- `done` `{ ok }`

Example:
```bash
curl -N http://127.0.0.1:7345/search/stream \
  -H "Content-Type: application/json" \
  -d '{"query":"return","mode":"code"}'
```

Notes:
- By default, `output` is `compact` (same as `--json-compact` in the CLI).
- Missing indexes will return a 500 with the CLI stderr in `stderr`.
- CLI subprocesses run via `execa` with bounded stdout/stderr buffers; stream endpoints forward stderr lines as they arrive.

## Security considerations
- No authentication is built in; bind locally and protect with firewall rules.
- The server shells out to the CLI on each request. Ensure the repo is trusted.
