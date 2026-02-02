# API server and MCP server contract (0.0.2)

This document describes the **public HTTP API server** and the **MCP (Model Context Protocol) server** surfaces.

> Phase 11 introduces new graph-powered “analysis outputs” (context packs, impact, etc.). These surfaces are designed to be **JSON-first**, **bounded**, and **deterministic**, and they share versioned output schemas in `src/contracts/schemas/analysis.js`.

## API server

### Existing endpoints
- `GET /health` returns `{ ok: true, uptimeMs }`.
- `GET /status` returns `{ ok: true, repo, status }`.
- `GET /status/stream` streams `start` → `result`/`error` → `done` SSE events.
- `GET /metrics` returns Prometheus metrics.
- `POST /search` accepts `{ query, mode, top, ... }` and returns `{ ok: true, repo, result }`.
- `POST /search/stream` streams `start` → `progress` → `result`/`error` → `done` SSE events.
- Invalid input returns HTTP 400 with `{ ok: false, code: "INVALID_REQUEST", message }` plus optional `errors`.
- Missing indexes return HTTP 409 with `{ ok: false, code: "NO_INDEX", message }`.

### Phase 11 endpoints (graph-powered analysis outputs)

These endpoints are **recommended** for Phase 11 parity. If implemented, they MUST:
- validate inputs,
- enforce caps (bounded work),
- return versioned JSON outputs validated by `src/contracts/validators/analysis.js`,
- and include `truncation[]` when caps trigger.

#### `POST /graph/context-pack`
Request (recommended):
- `{ seed, direction, depth, caps, edgeFilters, includePaths }`

Response:
- `{ ok: true, repo, result }` where `result` is a `GraphContextPack` payload.

#### `POST /impact`
Request:
- `{ seed, changed, changedFile, direction, depth, caps, edgeFilters }`

Notes:
- At least one of `seed` or `changed`/`changedFile` must be provided.

Response:
- `{ ok: true, repo, result }` where `result` is a `GraphImpactAnalysis` payload.

#### `POST /context-pack`
Request:
- `{ seed, hops, maxBytes, maxTokens, include, caps }`

Response:
- `{ ok: true, repo, result }` where `result` is a `CompositeContextPack` payload.

#### `POST /api-contracts`
Request:
- `{ onlyExports, failOnWarn, caps }`

Response:
- `{ ok: true, repo, result }` where `result` is an `ApiContractsReport` payload.

#### `POST /architecture-check`
Request:
- `{ rules, caps }` where `rules` is either embedded rules JSON or a reference to a rules file path (server policy-dependent).

Response:
- `{ ok: true, repo, result }` where `result` is an `ArchitectureReport` payload.

#### `POST /suggest-tests`
Request:
- `{ changed, max, caps }`

Response:
- `{ ok: true, repo, result }` where `result` is a `SuggestTestsReport` payload.

## MCP server

### Transport
- JSON-RPC 2.0 over stdio.
- **Modes**:
  - `legacy`: Content-Length framing (current default).
  - `sdk`: Official MCP SDK transport (newline-delimited JSON).
  - `auto`: selects `sdk` when available, otherwise `legacy`.
- Mode selection (precedence): `--mcp-mode` CLI → `MCP_MODE`/`PAIROFCLEATS_MCP_MODE` env (exception) → `mcp.mode` config.
- `initialize` must return server info and capabilities.
- `$/cancelRequest` aborts in-flight tool calls (including id `0`).
- Tool errors return `isError: true` with a JSON payload in `content`.

**Cutover policy:** legacy transport remains supported until SDK parity tests are green; there must be no silent fallback from `sdk` to `legacy` when SDK mode is explicitly requested.

### Existing tools
- `tools/list` includes `index_status`, `config_status`, `search`, and maintenance tools.

### Phase 11 tools (recommended)
If Phase 11 is exposed via MCP, `tools/list` SHOULD include tools matching HTTP endpoints:

- `graph_context_pack` → returns `GraphContextPack`
- `impact` → returns `GraphImpactAnalysis`
- `context_pack` → returns `CompositeContextPack`
- `api_contracts` → returns `ApiContractsReport`
- `architecture_check` → returns `ArchitectureReport`
- `suggest_tests` → returns `SuggestTestsReport`

Each tool MUST:
- accept explicit caps/budgets,
- bound work deterministically,
- and return schema-valid JSON.

## References
- `docs/api/server.md`
- `docs/api/mcp-server.md`
- `docs/contracts/analysis-schemas.md`
- `docs/phases/phase-11/spec.md`
