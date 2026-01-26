# Phase 12 Tooling and API Contract Spec (Refined)

**Document ID:** PHASE12_TOOLING_AND_API_CONTRACT_SPEC_REFINED  
**Status:** Proposed (Codex-ready)  
**Last updated:** 2026-01-24 (America/Detroit)

## 0. Purpose

Phase 12 standardizes and hardens the **public contracts** for PairOfCleats tooling surfaces:

1. **HTTP API server** (`tools/api-server.js`)
2. **MCP server** (stdio transport via the **official** MCP SDK)

The goals are:

- Eliminate response-shape ambiguity across surfaces.
- Provide explicit protocol/transport requirements for MCP.
- Make schema evolution intentional (versioned) and testable.
- Enable clients (humans and agents) to safely and deterministically integrate.

This spec is written to be implemented directly by an automated coding agent (e.g., Codex) without gaps.

---

## 1. Scope and non-scope

### 1.1 In scope
- MCP server lifecycle (`initialize`, `initialized`) and tool operations (`tools/list`, `tools/call`).
- MCP stdio transport framing and "no stdout noise" requirements.
- Tool schema versioning and tool contract compatibility rules.
- HTTP API request/response shapes and error envelope hardening.
- Cross-surface parity requirements (API ↔ MCP).
- Conformance test requirements and acceptance criteria hooks (the matrix is maintained in a companion doc).

### 1.2 Out of scope
- Rewriting the search engine, indexing pipeline, scoring, or retrieval algorithms.
- Exposing the MCP server over HTTP (MCP Streamable HTTP transport is not implemented here).
- Broad CLI unification for all `tools/*.js` scripts. (Those scripts remain "internal tooling" unless explicitly wrapped.)

---

## 2. Normative language

The key words **MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, **MAY** are to be interpreted as described in RFC 2119.

---

## 3. Version identifiers

### 3.1 Definitions

- **toolingVersion**: the installed PairOfCleats package version (from `package.json` via `getToolVersion()`).
- **schemaVersion**: the version of the **Tooling/API contract** defined in this spec: schemas, envelopes, and MCP tool definitions.

### 3.2 Formats

- `toolingVersion` MUST be a SemVer string (e.g., `"0.9.0"`).
- `schemaVersion` MUST be a SemVer string (e.g., `"2.0.0"`).

### 3.3 Governance

- **schemaVersion MAJOR** bump: any breaking change to:
  - MCP tool names
  - MCP tool input schema (removal/rename/type change of a field; changing defaults that alter semantics)
  - tool output envelope fields or meanings
  - API response envelope keys or meanings
- **schemaVersion MINOR** bump: backwards-compatible additions:
  - adding optional tool fields
  - adding optional response fields
- **schemaVersion PATCH** bump: editorial changes or clarifications that do not affect runtime behavior.

### 3.4 Single source of truth

A single exported constant MUST exist and be used everywhere:

- `src/shared/schema-version.js` exporting `SCHEMA_VERSION` (string).
- `src/shared/version.js` exporting `TOOLING_VERSION` (string) OR use `getToolVersion()` directly, but it MUST be consistent.

---

## 4. Canonical envelope

### 4.1 Rationale

The current codebase already uses multiple shapes:
- API success responses vary (`{ ok, repo, result }` vs `{ ok, repo, status }`).
- API error construction can be accidentally overridden (`sendError(..., rest)` allows collisions).
- MCP tool outputs are free-form (whatever the underlying tool returns).

Phase 12 introduces a single, collision-resistant envelope to remove ambiguity.

### 4.2 Envelope: `PocEnvelope`

All **tooling/API** success and error payloads MUST conform to:

```jsonc
{
  "ok": true,
  "result": { /* endpoint/tool-specific */ },
  "_meta": {
    "schemaVersion": "2.0.0",
    "toolingVersion": "0.9.0",
    "ts": "2026-01-24T12:34:56.789Z",
    "requestId": "optional-correlation-id"
  }
}
```

Error form:

```jsonc
{
  "ok": false,
  "error": {
    "code": "INVALID_REQUEST",
    "message": "Human readable summary.",
    "details": { /* optional structured data */ }
  },
  "_meta": {
    "schemaVersion": "2.0.0",
    "toolingVersion": "0.9.0",
    "ts": "2026-01-24T12:34:56.789Z",
    "requestId": "optional-correlation-id"
  }
}
```

### 4.3 Reserved keys

- The top-level keys `ok`, `result`, `error`, `_meta` are reserved.
- Implementations MUST NOT merge arbitrary payload objects into the top-level envelope.
- Additional data MUST live inside `result` (success) or `error.details` (failure).

### 4.4 `_meta` standard fields

`_meta` MUST include:

- `schemaVersion` (string)
- `toolingVersion` (string)
- `ts` (ISO-8601 timestamp in UTC)

`_meta` SHOULD include (when available):

- `requestId` (string): correlation ID for logging and tracing.
- `repo` (string): resolved repo path (if relevant).
- `durationMs` (number): for completed operations.
- `warnings` (array): structured warnings, not strings.

---

## 5. Error codes

### 5.1 Canonical source

String error codes MUST come from `src/shared/error-codes.js`.

**Phase 12 requirement:** add missing MCP/runtime codes to the enum if they are used in contract outputs:

- `TOOL_TIMEOUT`
- `QUEUE_OVERLOADED`
- `UNKNOWN_TOOL`

(If a code remains protocol-only, it still MUST be listed to keep the contract enumerable.)

### 5.2 Tool vs protocol errors

- **Protocol errors**: JSON-RPC error object with numeric `error.code`.
  - MUST include a string error code in `error.data.code`.
- **Tool execution errors**: MCP `CallToolResult` with `isError: true`.
  - MUST include `PocEnvelope` with `ok:false`.

---

## 6. MCP contract

### 6.1 Protocol revision and compatibility

- The server MUST speak MCP over JSON-RPC 2.0.
- **Phase 12 target protocol revision:** the server MUST implement MCP protocol version **`2025-11-25`** in SDK mode.
- If the client sends a different `initialize.params.protocolVersion`, the server MUST:
  - respond with `InitializeResult.protocolVersion = "2025-11-25"` if it can proceed, OR
  - fail the initialization with a JSON-RPC error if the SDK cannot safely interoperate with that client version.

Rationale:
- The official TypeScript SDK v1.24.0+ explicitly tracks MCP spec `2025-11-25`; pinning the protocol version removes ambiguity and eliminates "partial support" behaviors.

## 6.2 Transport: stdio framing (SDK mode)

### 6.2.1 SDK dependency pinning

- `@modelcontextprotocol/sdk` MUST be added to `dependencies` (not devDependencies) to ensure the MCP server is usable in production installs.
- The dependency SHOULD be pinned to a **known-good v1.x release line** (e.g., `1.25.x`) rather than an unbounded caret range, to avoid silent protocol drift.
- The MCP server implementation MUST import from the SDK's `server` entrypoints (ESM), e.g.:
  - `@modelcontextprotocol/sdk/server/*`
  - `@modelcontextprotocol/sdk/server/stdio` (transport)
  - and MUST NOT implement its own framing in SDK mode.

Note: the SDK package is published as `type: module` but provides both ESM and CJS exports; PairOfCleats is already ESM (`"type": "module"`), so use ESM imports.

**SDK mode MUST use newline-delimited JSON messages:**
- Each JSON-RPC message MUST be encoded as a single line JSON object.
- Messages MUST be delimited by a single `\n` (LF).
- The serialized JSON MUST NOT contain unescaped newline characters.

**Operational requirement:** stdout is reserved exclusively for protocol messages.
- All logs MUST go to stderr (or a file), never to stdout.

### 6.3 Legacy transport (non-normative)

The current repo contains a custom Content-Length transport (`tools/mcp/transport.js` + `src/shared/jsonrpc.js`).

Phase 12 policy:
- Legacy transport MAY remain temporarily behind an explicit opt-in flag (e.g., `PAIROFCLEATS_MCP_TRANSPORT=legacy`) **for one release window**.
- There MUST NOT be an *automatic* fallback from SDK→legacy.
- Legacy transport is **out of contract**: no new features, no conformance guarantees, and it is excluded from Phase 12 conformance gating.

### 6.4 Initialization: capabilities payload

The server MUST advertise a custom, namespaced capability block under `capabilities.experimental.pairofcleats`.

Example (shape, not full content):

```jsonc
{
  "protocolVersion": "2025-11-25",
  "capabilities": {
    "tools": { "listChanged": false },
    "experimental": {
      "pairofcleats": {
        "schemaVersion": "2.0.0",
        "toolingVersion": "0.9.0",
        "transport": "sdk",
        "capabilities": {
          "docs": { "pdfjsDist": true, "mammoth": false },
          "vector": { "sqliteVec": true, "hnsw": false },
          "mcp": { "sdk": true, "legacy": false }
        }
      }
    }
  },
  "serverInfo": { "name": "pairofcleats", "version": "0.9.0" }
}
```

Rules:
- `schemaVersion` and `toolingVersion` MUST be present.
- The `capabilities` object SHOULD be sourced from `src/shared/capabilities.js` (or a narrowed subset), so clients can adapt.

### 6.5 Tools: list and call

#### 6.5.1 Canonical tool registry
- Tool definitions MUST be sourced from a single place: `src/integrations/mcp/defs.js`.
- `tools/list` MUST return the full set of tool definitions.
- Tool names MUST remain stable within a schemaVersion major.

#### 6.5.2 Required tool set (schemaVersion 2.x)
The following tool names MUST exist (currently present in `defs.js`):

- `index_status`
- `config_status`
- `build_index`
- `search`
- `download_models`
- `download_dictionaries`
- `download_extensions`
- `verify_extensions`
- `build_sqlite_index`
- `compact_sqlite_index`
- `cache_gc`
- `clean_artifacts`
- `bootstrap`
- `report_artifacts`
- `triage_ingest`
- `triage_decision`
- `triage_context_pack`

If any tool is removed or renamed, schemaVersion MAJOR MUST bump.

### 6.6 Argument validation (MCP)

- `tools/call.params.arguments` MUST be validated against the tool's `inputSchema`.
- Validation failures MUST return a JSON-RPC error:
  - `error.code`: `-32602` (Invalid params)
  - `error.data.code`: `INVALID_REQUEST`
  - `error.data.details`: an array of schema violations (Ajv-style)

### 6.7 Tool outputs (MCP)

For every successful tool execution, the server MUST return:

- `CallToolResult.isError = false`
- `CallToolResult.content` MUST include **one** `TextContent` item containing JSON serialized `PocEnvelope`.
- `CallToolResult.structuredContent` SHOULD include the parsed `PocEnvelope` object.

For tool execution failures:

- `CallToolResult.isError = true`
- `content[0].text` is still a serialized `PocEnvelope` with `ok:false`
- `structuredContent` SHOULD include the same envelope.

**Important:** the envelope MUST be stable and parseable (no pretty printing).

### 6.8 Progress notifications (MCP)

- The server MUST only emit progress notifications if the request includes `params._meta.progressToken`.
- Notifications MUST use method: `notifications/progress`.
- `params` MUST include:
  - `progressToken` (the provided token)
  - `progress` (monotonic number)
  - `total` (optional number, MAY be omitted if unknown)
  - `message` (optional string)

**Mapping rule from existing code:**
- Existing MCP tooling uses callback shapes like `{ phase, message, stream }`.
- In SDK mode, these MUST be mapped to `message` strings, e.g.: `"[search][phase=search] Running search."`
- Extra fields MUST NOT be added to notification params unless permitted by MCP schema.

### 6.9 Cancellation (MCP)

- The server MUST support `notifications/cancelled` with `params.requestId`.
- On cancellation:
  - The server MUST abort any associated `AbortController` used by the tool execution.
  - The server SHOULD stop emitting progress events for the cancelled request.
  - The server SHOULD NOT send a response for the cancelled request (per MCP guidance); if a response races, clients may ignore it.

**Legacy:** if legacy mode remains temporarily, it MAY also support `$/cancelRequest`.

### 6.10 Queue overload and timeouts (MCP)

#### 6.10.1 Queue overload
If the server cannot accept a request due to internal queue limits, it MUST respond with JSON-RPC error:

- `error.code = -32001` (server-defined)
- `error.message`: short summary
- `error.data`:
  - `code = "QUEUE_OVERLOADED"`
  - `message`: human readable
  - `details.queue`: `{ max, size }` (numbers)

#### 6.10.2 Tool timeout
If a tool exceeds its configured timeout:
- In-flight execution MUST be aborted.
- The server MUST return **tool execution error** (not protocol error):
  - `CallToolResult.isError = true`
  - Envelope `error.code = "TOOL_TIMEOUT"`
  - `error.details.timeoutMs` MUST be included.

---

## 7. HTTP API contract (PairOfCleats API server)

### 7.1 General rules
- All JSON responses MUST use `PocEnvelope`.
- All error responses MUST use `PocEnvelope` with `ok:false` and `error`.
- For POST endpoints:
  - Request bodies MUST be JSON (`Content-Type` contains `application/json`).
  - Non-JSON bodies MUST return `415` with `INVALID_REQUEST`.

### 7.2 Endpoints

#### 7.2.1 `GET /health`
Success result:

```jsonc
{ "ok": true, "result": { "uptimeMs": 12345 }, "_meta": { ... } }
```

#### 7.2.2 `GET /status`
Success result:

```jsonc
{ "ok": true, "result": { "repo": "/path", "status": { /* existing status payload */ } }, "_meta": { ... } }
```

#### 7.2.3 `GET /status/stream` (SSE)
Events MUST have JSON `data` that is a `PocEnvelope`.

- `start`: `{ ok:true, result:{ repo }, _meta }`
- `result`: `{ ok:true, result:{ repo, status }, _meta }`
- `error`: `{ ok:false, error:{...}, _meta }`
- `done`: `{ ok:true, result:{}, _meta }` (done is not an error carrier)

#### 7.2.4 `POST /search`
Input matches current `tools/api/validation.js` (Ajv).  
Success:

```jsonc
{ "ok": true, "result": { "repo": "/path", "search": { /* existing search JSON payload */ } }, "_meta": { ... } }
```

#### 7.2.5 `POST /search/stream` (SSE)
Events MUST have JSON `data` that is a `PocEnvelope`.

- `start`: `{ ok:true, result:{}, _meta }`
- `progress`: `{ ok:true, result:{ phase, message }, _meta }`
- `result`: `{ ok:true, result:{ repo, search }, _meta }`
- `error`: `{ ok:false, error:{...}, _meta }`
- `done`: `{ ok:true, result:{}, _meta }`

### 7.3 HTTP status code mapping

| Scenario | HTTP | Envelope `error.code` |
|---|---:|---|
| invalid JSON / schema validation | 400 | `INVALID_REQUEST` |
| repo forbidden by allowlist | 403 | `FORBIDDEN` |
| request body too large | 413 | `INVALID_REQUEST` |
| unsupported media type | 415 | `INVALID_REQUEST` |
| missing index artifacts | 409 | `NO_INDEX` |
| unhandled exception | 500 | `INTERNAL` |

---

## 8. Cross-surface parity rules (API ↔ MCP)

For tools that have HTTP equivalents, MCP outputs MUST match HTTP outputs **at the envelope level**.

Example:
- MCP tool `search` successful output envelope MUST match `/search` envelope's `result.search` payload (modulo `_meta.ts` and `_meta.durationMs`).

---

## 9. Search tool schema ↔ CLI flag mapping (explicit)

The `search` MCP tool exposes `arguments` that map 1:1 to the search CLI flags used by `src/retrieval/cli-args.js`.

**Normative rule:** every field must either:
- map to a CLI flag (or core search param), OR
- be explicitly listed as RESERVED (future use) and rejected if provided.

### 9.1 Mapping table (schemaVersion 2.x)

| MCP arg | CLI flag | Type | Notes |
|---|---|---|---|
| `query` | (positional) | string | REQUIRED |
| `repoPath` | `--repo` | string | OPTIONAL; defaults per server config |
| `mode` | `--mode` | enum | `code|prose|extracted-prose|records|all|both` (normalize) |
| `backend` | `--backend` | enum/string | keep in sync with CLI `--backend` |
| `output` | `--compact` / `--json` | enum | mapping: `compact` => `--compact`, `full` => omit `--compact`, `json` => `--json` |
| `ann` | `--ann` / `--no-ann` | boolean | null means default |
| `top` | `-n` | number | clamp ≥1 |
| `context` | `--context` | number | IMPORTANT: avoid shadowing the MCP context object; use `contextLines` variable in code |
| `type` | `--type` | string | |
| `author` | `--author` | string | |
| `import` | `--import` | string | |
| `calls` | `--calls` | string | |
| `uses` | `--uses` | string | |
| `signature` | `--signature` | string | |
| `param` | `--param` | string | |
| `decorator` | `--decorator` | string | |
| `inferredType` | `--inferred-type` | string | |
| `returnType` | `--return-type` | string | |
| `throws` | `--throws` | string | |
| `reads` | `--reads` | string | |
| `writes` | `--writes` | string | |
| `mutates` | `--mutates` | string | |
| `alias` | `--alias` | string | |
| `awaits` | `--awaits` | string | |
| `risk` | `--risk` | string | |
| `riskTag` | `--risk-tag` | string | |
| `riskSource` | `--risk-source` | string | |
| `riskSink` | `--risk-sink` | string | |
| `riskCategory` | `--risk-category` | string | |
| `riskFlow` | `--risk-flow` | string | |
| `branchesMin` | `--branches` | number | |
| `loopsMin` | `--loops` | number | |
| `breaksMin` | `--breaks` | number | |
| `continuesMin` | `--continues` | number | |
| `churnMin` | `--churn` | number | |
| `chunkAuthor` | `--chunk-author` | string | |
| `modifiedAfter` | `--modified-after` | string | |
| `modifiedSince` | `--modified-since` | number | |
| `visibility` | `--visibility` | string | |
| `extends` | `--extends` | string | |
| `lint` | `--lint` | boolean | |
| `async` | `--async` | boolean | |
| `generator` | `--generator` | boolean | |
| `returns` | `--returns` | boolean | |
| `branch` | `--branch` | string | |
| `lang` | `--lang` | string | |
| `case` | `--case` | boolean | |
| `caseFile` | `--case-file` | boolean | |
| `caseTokens` | `--case-tokens` | boolean | |
| `path` | `--path` | string or string[] | MUST accept string or array; normalize to repeated flag |
| `file` | `--file` | string or string[] | same |
| `ext` | `--ext` | string or string[] | same |
| `meta` | `--meta` | object/array/string | normalize to repeated `--meta key=value` |
| `metaJson` | `--meta-json` | object|string | if object, JSON.stringify |

**Explicit required code fix:** `tools/mcp/tools.js` currently redeclares a `const context` inside `runSearch`, which is a parse-time syntax error. The numeric "context lines" MUST be renamed (e.g., `contextLines`). This is a blocking fix for any MCP execution.

---

## 10. Required artifacts (implementation deliverables)

Phase 12 implementation MUST include these artifacts in-repo:

1. `src/shared/schema-version.js` (source of truth)
2. A generated **tool schema snapshot** file committed to the repo:
   - `docs/contracts/mcp-tools.schema.json` (or similar)
3. Ajv validation wiring for MCP tool inputs:
   - `src/integrations/mcp/validate.js`
4. Conformance tests (see companion document):
   - `tests/mcp/sdk-*.test.js`
   - `tests/api/contract-*.test.js`

