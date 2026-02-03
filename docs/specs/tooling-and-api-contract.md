# Phase 12 Tooling and API Contract Spec (Refined)

**Document ID:** PHASE12_TOOLING_AND_API_CONTRACT_SPEC_REFINED  
**Status:** Proposed (Codex-ready)  
**Last updated:** 2026-01-24 (America/Detroit)

## 0. Purpose

Phase 12 standardizes and hardens the **public contracts** for PairOfCleats tooling surfaces:

1. **HTTP API server** (`tools/api/server.js`)
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

- **toolVersion**: the installed PairOfCleats package version (from `package.json`).
- **schemaVersion**: the version of the MCP tool schemas defined in this spec and `src/integrations/mcp/defs.js`.

### 3.2 Formats

- `toolVersion` MUST be a SemVer string (e.g., `"0.9.0"`).
- `schemaVersion` MUST be a SemVer string (e.g., `"1.0.0"`).

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

- `src/integrations/mcp/defs.js` exporting `schemaVersion` (string).
- `package.json` `version` used as `toolVersion` (string).

---

## 4. Response envelopes (current)

Phase 12 keeps the **existing response shapes** while MCP tooling is stabilized. A future
envelope unification (e.g., `_meta` fields) should be treated as a breaking change and
requires an explicit schemaVersion bump.

### 4.1 HTTP API responses

- Success responses return `{ ok: true, repo, result }` (or endpoint-specific payloads such as `{ ok, repo, status }`).
- Error responses return `{ ok: false, code, message, ...details }` as emitted by `tools/api/response.js`.

### 4.2 MCP tool results

- Success: `CallToolResult.content[0].text` is a JSON string containing the tool payload.
- Error: `CallToolResult.isError = true` and `content[0].text` is a JSON string with `{ code, message, ... }`.

If an envelope format is introduced later, it MUST be documented here and reflected in
`docs/contracts/mcp-tools.schema.json` plus any API contracts.

---

## 5. Error codes

### 5.1 Canonical source

String error codes MUST come from `src/shared/error-codes.js`, with the canonical
registry documented in `docs/contracts/mcp-error-codes.md`.

Unknown tools MUST report `NOT_FOUND` (not `UNKNOWN_TOOL`).

### 5.2 Tool vs protocol errors

- **Protocol errors**: JSON-RPC error object with numeric `error.code`.
  - MUST include a string error code in `error.data.code`.
- **Tool execution errors**: MCP `CallToolResult` with `isError: true`.
  - MUST include `PocEnvelope` with `ok:false`.

---

## 6. MCP contract

### 6.1 Protocol revision and compatibility

- The server MUST speak MCP over JSON-RPC 2.0.
- **Phase 12 target protocol revision:** the server MUST implement MCP protocol version **`2024-11-05`**.
- If the client sends a different `initialize.params.protocolVersion`, the server SHOULD respond
  with `InitializeResult.protocolVersion = "2024-11-05"` and continue when safe to do so.

## 6.2 Transport: stdio framing (SDK mode)

### 6.2.1 SDK dependency strategy

- `@modelcontextprotocol/sdk` is an **optional dependency** (capability-gated).
- MCP SDK mode MUST fail fast with a clear error if the dependency is missing.
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
- Legacy transport remains available behind explicit selection (`--mcp-mode legacy` or `mcp.mode=legacy`).
- There MUST NOT be an *automatic* fallback from SDK→legacy when SDK mode is explicitly requested.
- Legacy transport is supported for the migration window but should not receive new features beyond parity.

### 6.4 Initialization: capabilities payload

The server MUST advertise a custom, namespaced capability block under `capabilities.experimental.pairofcleats`.

Example (shape, not full content):

```jsonc
{
  "protocolVersion": "2024-11-05",
  "capabilities": {
    "tools": { "listChanged": false },
    "experimental": {
      "pairofcleats": {
        "schemaVersion": "1.0.0",
        "toolVersion": "0.9.0",
        "capabilities": {
          "docs": { "pdfjsDist": true, "mammoth": false },
          "vector": { "sqliteVec": true, "hnsw": false },
          "mcp": { "sdk": true }
        }
      }
    }
  },
  "serverInfo": { "name": "pairofcleats", "version": "0.9.0" }
}
```

Rules:
- `schemaVersion` and `toolVersion` MUST be present (see `src/integrations/mcp/defs.js` and `tools/mcp/server-config.js`).
- The `capabilities` object SHOULD be sourced from `src/shared/capabilities.js` (or a narrowed subset), so clients can adapt.

### 6.5 Tools: list and call

#### 6.5.1 Canonical tool registry
- Tool definitions MUST be sourced from a single place: `src/integrations/mcp/defs.js`.
- `tools/list` MUST return the full set of tool definitions.
- Tool names MUST remain stable within a schemaVersion major.

#### 6.5.2 Required tool set (schemaVersion 1.x)
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
- `CallToolResult.content` MUST include **one** `TextContent` item containing JSON serialized tool payload.

For tool execution failures:

- `CallToolResult.isError = true`
- `content[0].text` is a serialized JSON payload with `{ code, message, ... }` per `docs/contracts/mcp-error-codes.md`.

**Important:** the payload MUST be stable and parseable (no pretty printing).

### 6.8 Progress notifications (MCP)

- Notifications MUST use method: `notifications/progress`.
- Legacy transport emits:
  - `{ id, tool, message, stream, phase, ts }`
- SDK transport emits (when `progressToken` is provided by the client):
  - `{ progressToken, tool, message, stream, phase, ts }`

Extra fields MUST NOT be added unless permitted by MCP schema.

### 6.9 Cancellation (MCP)

- The server MUST support `$/cancelRequest` for in-flight tool calls.
- On cancellation:
  - The server MUST abort any associated `AbortController` used by the tool execution.
  - The server SHOULD stop emitting progress events for the cancelled request.
  - The server returns a cancelled tool response (`isError=true`, `code=CANCELLED`) when a response is still sent.

### 6.10 Queue overload and timeouts (MCP)

#### 6.10.1 Queue overload
If the server cannot accept a request due to internal queue limits, it MUST respond with JSON-RPC error:

- `error.code = -32001` (server-defined)
- `error.message`: short summary
- `error.data`:
    - `code = "QUEUE_OVERLOADED"`
    - `message`: human readable
    - `details.queue`: `{ max, size }` (numbers)

Default limits (from `tools/mcp/server-config.js`):
- `queueMax`: 64
- `maxBufferBytes`: 8 MB

#### 6.10.2 Tool timeout
If a tool exceeds its configured timeout:
- In-flight execution MUST be aborted.
- The server MUST return **tool execution error** (not protocol error):
    - `CallToolResult.isError = true`
    - Payload `code = "TOOL_TIMEOUT"`
    - `timeoutMs` MUST be included.

Default timeout policy (from `tools/mcp/server-config.js`):
- Global default: 120000 ms.
- Per-tool defaults:
  - `build_index`: 10 min
  - `build_sqlite_index`: 10 min
  - `download_models`: 10 min
  - `download_dictionaries`: 10 min
  - `download_extensions`: 10 min
  - `bootstrap`: 10 min
  - `triage_ingest`: 5 min

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

### 9.1 Mapping table (schemaVersion 1.x)

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
