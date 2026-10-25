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
- `GET /search` applies the same historical-selector admission. `snapshot` and
  `snapshotId` remain separate until canonical conflict validation. `asOf`/`as-of`
  and repeated historical scalar keys accept identical trimmed values and reject
  distinct ones. Explicit blank selectors reject instead of selecting latest;
  omission retains current-data behavior. Intentional list fields such as
  `path`/`paths` continue to accumulate.
- `POST /search/stream` streams `start` → `progress` → `result`/`error` → `done` SSE events.
- Invalid input returns HTTP 400 with `{ ok: false, code: "INVALID_REQUEST", message }` plus optional `errors`.
- Missing indexes return HTTP 409 with `{ ok: false, code: "NO_INDEX", message }`.

### Bounded evidence workspace (implementation checkpoint)

- `GET /map/workspace` and its fixed asset/vendor paths serve static application code only.
  They run after origin validation and before bearer authentication so the UI can accept a token.
- `POST /map/catalog` accepts `{ repoRoot? }`; data access requires normal API authentication
  and repository allowlist resolution. Returns `{ ok: true, result }` with `kind: "artifact-catalog"`,
  a content-pinned generation, availability, format/inspection mode and explicit unknown bytes.
- `POST /map/artifact` accepts `{ repoRoot?, name, generation, cursor? }`. Names are logical
  artifact names, never paths. Returns `kind: "artifact-page"`, bounded rows/object or physical
  provenance, generation, optional single-use cursor and coverage. Expired cursors return 410;
  changed generations return 409; absent artifacts return 404. Unsupported or oversize reads
  return an explicit error. It never starts indexing or enrichment.
- Row pages admit at most 128 records / 64 KiB. Artifact inputs are capped at 2 MiB where the
  existing logical loaders support this budget. The published semantic store retains its
  existing backend bounds. Eight readers maximum, 60-second idle expiration pruned on calls.

See [the coverage and acceptance record](../guides/reladraw-workspace.md). Browser acceptance
and the separate Three.js replacement remain pending; these endpoints do not imply them.

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
- `initialize` must return server info, capabilities, and tool schema versions.
- `$/cancelRequest` aborts in-flight tool calls (including id `0`).
- Legacy request IDs preserve their JSON type across admission, queued/active
  cancellation, progress and settlement. Numeric `1` and string `"1"` (likewise
  `0`/`"0"`) are independent identities; exact same-type duplicates remain
  rejected until the original work and response delivery settle. Responses retain the original
  wire ID. The admitted ID domain matches the installed SDK: strings, including
  the empty string, and safe integers. Invalid request IDs reject; invalid or
  unknown cancellation targets cannot affect a different request.
- `build_index` and `build_sqlite_index` retain that request signal through core
  work and SQLite ingestion. Cancellation is checked before restore/follow-on
  stages and publication; restore subprocesses and parser workers settle before
  execution capacity is released. SQLite cancellation is cooperative at phase
  and batch boundaries; an individual synchronous SQL statement completes
  before its next checkpoint. Aborted transactions roll back and prior output
  remains authoritative. A completed atomic publication is not undone.
- Tool errors return `isError: true` with a JSON payload in `content`.

Legacy output admission, progress loss policy and execution/delivery/stream-close
ownership are specified in [legacy output lifetime](mcp-output-lifetime.md).

**Cutover policy:** legacy transport remains supported until SDK parity tests are green; there must be no silent fallback from `sdk` to `legacy` when SDK mode is explicitly requested.

### Existing tools
- `tools/list` includes `index_status`, `config_status`, `search`, and maintenance tools.

### Tool schema versioning

The current source catalog is 1.10.1. `graph_evidence` explicitly declares an
object root for MCP SDK interoperability, preserving its existing `oneOf`
branches and strict request validators. Real SDK discovery, search/context and
cancellation checks pass at the October 24 repair checkpoint. Its additive opt-in semantic
`pathSemantics` request profile and `pathCapability` result distinguish bounded
balanced-call value traces from relation neighborhoods. Existing requests keep
their default behavior. These graph declarations do not prove executable-path
feasibility. Generated schema/actual-server snapshots and transport acceptance
must be refreshed against the frozen resulting candidate; this scoped repair
does not qualify the complete MCP release.
- MCP tool schemas are versioned via `schemaVersion` (SemVer) and `toolVersion` (package version).
- Breaking changes to tool names or input schemas require a **major** schemaVersion bump.
- Backwards-compatible additions require a **minor** bump; editorial clarifications are **patch** bumps.
- Canonical snapshot: `docs/contracts/mcp-tools.schema.json` (validated by `src/integrations/mcp/validate.js`).

`risk_explain` tool notes:
- `includePartialFlows` requests bounded partial frontier flows alongside full interprocedural flows.
- `maxPartialFlows` caps the number of partial flows returned in the MCP payload.

### Initialize response shape
- `initialize` returns an object that must validate against `docs/contracts/mcp-initialize.schema.json`.
- Required keys: `protocolVersion`, `serverInfo`, `capabilities`, `schemaVersion`, `toolVersion`.
- Capabilities are reported under `capabilities.experimental.pairofcleats`, with the effective
  `schemaVersion`, `toolVersion`, and server capability flags.

### Error codes
- Tool error payloads MUST include a stable `code` and `message`.
- Protocol-level JSON-RPC errors MUST include `error.data.code` with the same canonical codes.
- Canonical registry: `docs/contracts/mcp-error-codes.md`.

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
- `docs/specs/graph-product-surfaces.md`


