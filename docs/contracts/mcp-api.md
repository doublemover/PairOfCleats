# API server and MCP server contract

## API server
- `GET /health` returns `{ ok: true, uptimeMs }`.
- `GET /status` returns `{ ok: true, repo, status }`.
- `GET /status/stream` streams `start` → `result`/`error` → `done` SSE events.
- `GET /metrics` returns Prometheus metrics.
- `POST /search` accepts `{ query, mode, top, ... }` and returns `{ ok: true, repo, result }`.
- `POST /search/stream` streams `start` → `progress` → `result`/`error` → `done` SSE events.
- Invalid input returns HTTP 400 with `{ ok: false, code: "INVALID_REQUEST", message }` plus optional `errors`.
- Missing indexes return HTTP 409 with `{ ok: false, code: "NO_INDEX", message }`.

## MCP server
- JSON-RPC 2.0 with `Content-Length` framing over stdio.
- `initialize` must return server info and capabilities.
- `tools/list` includes `index_status`, `config_status`, `search`, and maintenance tools.
- `$/cancelRequest` aborts in-flight tool calls (including id `0`).
- Tool errors return `isError: true` with a JSON payload in `content`.

## References
- `docs/api/server.md`
- `docs/api/mcp-server.md`

