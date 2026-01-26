# Phase 12 -- Test Strategy and Conformance Matrix (Refined + Deterministic Fixtures)

This document is **normative** for Phase 12 testing. It defines:
- the exact testing layers to implement,
- how to guarantee **API ↔ MCP parity**,
- how to guarantee tests are **hermetic** (no dependence on developer machine layout),
- a conformance matrix mapping requirements → tests.

It is intended to remove ambiguity and give Codex everything it needs to implement Phase 12 correctly without further research.

---

## 1. Goals and non-negotiable constraints

### 1.1 Primary goals

1. **Protocol correctness**
   - MCP is served via the official SDK using stdio transport in SDK mode.
   - Initialize/tools/list/tools/call must conform to the negotiated protocol version in this phase (see contract spec).

2. **Stable, versioned contracts**
   - MCP tool schemas are versioned and snapshotted.
   - HTTP API response envelopes and error structures are stable and documented.

3. **Parity**
   - For equivalent inputs, API and MCP produce equivalent outcomes at the **envelope** level:
     - same `ok` boolean
     - equivalent `result` object (after agreed normalization)
     - equivalent `error` object (code/message/details) for failures
   - `_meta` may differ in timestamps and timings, but must contain required fields.

4. **No silent acceptance of inputs**
   - Any schema field that exists must either:
     - affect behavior, or
     - be rejected explicitly, or
     - be explicitly documented as ignored (discouraged for Phase 12; avoid if possible).

### 1.2 Non-goals (explicitly out of scope for Phase 12)

- Adding new tools.
- Changing core search semantics beyond request/response normalization and schema alignment.
- Building a new API authentication layer.

### 1.3 Hermetic / deterministic execution requirements (applies to all new Phase 12 tests)

Phase 12 tests MUST be **portable**:
- They MUST pass when executed from any working directory (no `process.cwd()` assumptions).
- They MUST NOT depend on the developer's filesystem layout (absolute paths, home directory, OS temp naming).
- They MUST NOT write outside the test-controlled temp/cache roots.
- They MUST be deterministic across runs:
  - stable fixture contents
  - stable environment variables
  - stable normalization of path and time fields

### 1.4 Minimum fixtures + deterministic repo strategy (required)

Phase 12 parity tests often compare MCP and API outputs. Without strong fixture discipline, parity tests can become flaky because:
- absolute paths differ per machine,
- caches persist between runs,
- fixture repos can be polluted (even unintentionally),
- search output can include repo-specific identifiers.

**Strategy:**
1. Use **minimum fixtures**: create/maintain a tiny repository fixture that is just large enough to support deterministic search results.
2. Run tests against a **deterministic repo copy** created under a controlled test root.
3. Enforce **path and meta normalization** for parity comparisons and snapshots.

This strategy ensures parity tests never depend on the developer's local filesystem layout.

---

## 2. Test layers (what to implement)

### 2.1 Unit tests (fast, no subprocesses)
Purpose:
- Validate schema objects, argument mapping, envelope building, and error-code mapping.

Characteristics:
- no server processes
- no indexing (unless specifically needed)
- validate pure functions and module-level invariants

### 2.2 Services tests (spawn servers; protocol + transport)
Purpose:
- Validate MCP SDK server behavior on stdio.
- Validate API server HTTP and SSE behavior.
- Validate cancellation, timeouts, and overload behavior.

Characteristics:
- spawn `tools/mcp-server.js` (SDK mode)
- spawn `tools/api-server.js`
- interact via real transports (stdio, HTTP/SSE)

### 2.3 Contract & parity tests (API ↔ MCP equivalence)
Purpose:
- Assert that API and MCP are different surfaces over the **same tool semantics**.

Characteristics:
- run both servers against the same deterministic repo
- compare normalized envelopes

---

## 3. Deterministic repo + minimum fixtures specification (normative)

### 3.1 Fixture repository design (minimum fixture)

Add (or re-use, if an equivalent already exists) a minimal fixture repo:

- Proposed directory: `tests/fixtures/phase12-min-repo/`
- Must include:
  - `README.md` (contains a unique token like `PHASE12_FIXTURE_TOKEN` for deterministic search)
  - `src/alpha.js` (contains deterministic symbols: `function alphaOne() {}`, `class AlphaTwo {}`)
  - `src/beta.ts` (contains deterministic symbols: `export const betaValue = 42;`)
  - `docs/notes.md` (contains deterministic prose token for text search)
- Must NOT include:
  - large binaries
  - platform-specific files
  - extremely large directories that slow indexing

If Phase 12 parity tests need Git metadata, add a tiny `.git` repo initialized at test-time (not committed). Otherwise, keep fixture repo VCS-free.

### 3.2 Deterministic repo creation algorithm (required helper)

All Phase 12 parity tests MUST use a common helper:
- Proposed file: `tests/helpers/deterministic-repo.js`

**API:**

```js
export async function createDeterministicRepo({
  fixtureName,          // e.g. "phase12-min-repo"
  testId,               // e.g. "parity-search-basic"
  keep = process.env.KEEP_TEST_ARTIFACTS === "1",
}) {
  // returns:
  // {
  //   repoPath: string,
  //   cacheRoot: string,
  //   workRoot: string,
  //   cleanup: async () => void
  // }
}
```

**Normative behavior:**
- Determine project root from the helper's own location (`import.meta.url`), **not** from `process.cwd()`.
- Create a stable work root:
  - `workRoot = <ROOT>/tests/.cache/phase12/<fixtureName>/<sanitized testId>/`
- Ensure test isolation:
  - delete `workRoot` at start of helper call (unless `keep === true`)
  - create:
    - `repoPath = <workRoot>/repo`
    - `cacheRoot = <workRoot>/cache`
- Copy fixture contents into `repoPath`.
- Ensure consistent environment for all subprocesses:
  - `PAIROFCLEATS_CACHE_ROOT=<cacheRoot>`
  - `PAIROFCLEATS_WORKER_POOL=off` (determinism)
  - `PAIROFCLEATS_EMBEDDINGS=stub` (no network)
  - (Optional) `PAIROFCLEATS_LOG_LEVEL=error` to reduce noise

**Cleanup:**
- By default, delete `workRoot` after the test completes.
- If `KEEP_TEST_ARTIFACTS=1`, do not delete (debug mode).

### 3.3 Normalization rules for parity comparisons (required helper)

All parity tests MUST compare **normalized envelopes**, not raw outputs.

Add helper:
- Proposed file: `tests/helpers/envelope-normalize.js`

**API:**
```js
export function normalizeEnvelopeForParity(envelope, { repoPath }) {
  // returns a new object safe to compare across API/MCP and across machines
}
```

**Normative normalization rules:**
1. Strip or neutralize non-deterministic fields:
   - remove `_meta.ts`
   - remove `_meta.durationMs`
2. Normalize paths:
   - replace any occurrence of the absolute `repoPath` with `<REPO>`
   - normalize path separators to `/`
3. Normalize arrays where ordering is not semantically significant:
   - for known fields that can be re-ordered due to concurrency, sort deterministically
4. Preserve semantics:
   - do NOT modify `ok`, `error.code`, or `error.message`
   - do NOT "paper over" real mismatch; only normalize explicitly listed sources of nondeterminism

### 3.4 Index/build determinism (required for search parity)

Any test that calls `search` MUST ensure an index exists for the deterministic repo:
- Use existing helper pattern (or create):
  - `ensureFixtureIndex(repoPath, cacheRoot)` with `stubEmbeddings=true` and worker pool off
- Ensure index is built exactly once per deterministic repo instance.

---

## 4. Conformance matrix

Legend:
- **MUST** = required for Phase 12 acceptance
- **SHOULD** = required unless a documented constraint prevents it
- **MAY** = optional

### C-001 -- Tools list completeness and stability (MUST)

**Requirement**
- `tools/list` returns exactly the Phase 12 tool set as defined in `src/integrations/mcp/defs.js`.
- Names must be stable and unique.
- Returned schemas must match snapshot `docs/contracts/mcp-tools.schema.json`.

**Tests**
- `tests/mcp/sdk-tools-list.contract.js`
  - start MCP SDK server
  - call `tools/list`
  - assert tool names match expected set
- `tests/contracts/mcp-tools-schema.snapshot.js`
  - load `docs/contracts/mcp-tools.schema.json`
  - generate current schema snapshot from source
  - assert exact equality (stable JSON)

### C-002 -- Initialize negotiation and metadata (SHOULD)

**Requirement**
- Initialize completes successfully in SDK mode.
- Server negotiates protocol version and advertises tools capability.
- Server returns a tooling schema version somewhere discoverable (prefer `_meta.schemaVersion`).

**Tests**
- `tests/mcp/sdk-initialize.contract.js`
  - initialize + notifications/initialized
  - assert serverInfo/capabilities present
  - assert schemaVersion is present in the negotiated contract surface (initialize `_meta` OR follow-up tools/list `_meta`)

### C-003 -- Envelope shape for MCP tool results (MUST)

**Requirement**
- Every `tools/call` success returns a PocEnvelope:
  - `content: [{ type: "text", text: "<json string>" }]`
  - `structuredContent` contains parsed envelope object
- Envelope:
  - top-level keys only: `ok`, `result` OR `error`, `_meta` (optional)
  - no reserved keys leakage into `result`

**Tests**
- `tests/mcp/sdk-tool-envelope.contract.js`
  - call representative tool (e.g., `index_status`)
  - parse result
  - assert envelope schema

### C-004 -- API envelope shape consistency (MUST)

**Requirement**
- All JSON endpoints return PocEnvelope.
- SSE events carry PocEnvelope in `data:` payloads.

**Tests**
- `tests/api/envelope.contract.js`
  - `/health`, `/status`, `/search`, error case
- `tests/api/sse.contract.js`
  - `/status/stream`, `/search/stream`
  - validate event ordering and envelope payloads

### C-005 -- Error-code mapping consistency (MUST)

**Requirement**
- Known failures map to stable error codes and messages, consistently across API and MCP:
  - invalid params
  - unknown tool
  - repo missing / invalid
  - tool timeout
  - queue overload
  - cancelled

**Tests**
- `tests/mcp/sdk-errors.contract.js`
- `tests/api/errors.contract.js`
- `tests/parity/errors.parity.js`

### C-006 -- Strict argument validation (MUST)

**Requirement**
- MCP tool input MUST be validated against the declared JSON schema (including additionalProperties=false).
- API request bodies MUST be validated consistently.

**Tests**
- `tests/mcp/sdk-arg-validation.contract.js`
  - send unknown arg
  - assert InvalidParams
- `tests/api/arg-validation.contract.js`
  - send unknown arg
  - assert error envelope with correct error code

### C-007 -- Cancellation (MUST)

**Requirement**
- Cancellation stops work promptly and returns a cancelled error.
- No further progress notifications after cancellation.

**Tests**
- `tests/mcp/sdk-cancellation.contract.js`
- `tests/api/cancellation.contract.js` (if API supports cancellation semantics; otherwise N/A)

### C-008 -- Timeouts (MUST)

**Requirement**
- Long-running tool calls time out deterministically with a stable error code and message.
- Underlying work is aborted (no leaked subprocesses).

**Tests**
- `tests/mcp/sdk-timeout.contract.js`
- `tests/unit/abort-kills-child.unit.js` (if child processes are used)

### C-009 -- Queue overload / backpressure (MUST)

**Requirement**
- When concurrency limit is exceeded, server rejects quickly with overload error code.
- This MUST be deterministic and testable.

**Tests**
- `tests/mcp/sdk-overload.contract.js`

### C-010 -- API ↔ MCP parity on representative tool(s) (MUST)

**Requirement**
- For identical deterministic repo + request inputs:
  - `search` parity: same normalized results
  - `status` parity (if exposed in MCP): same normalized status payload
- Parity comparisons MUST use deterministic repo + normalization helpers.

**Tests**
- `tests/parity/search.parity.js`
- `tests/parity/status.parity.js`

### C-011 -- Deterministic repo strategy enforcement (MUST)

**Requirement**
- Phase 12 parity tests MUST not rely on `process.cwd()` or developer filesystem layout.
- Phase 12 parity tests MUST use deterministic repo helper and normalization helper.

**Tests**
- `tests/parity/_harness.contract.js`
  - explicitly asserts that helper computes ROOT from `import.meta.url` and that the fixture is copied into `<ROOT>/tests/.cache/...`
  - asserts normalized output contains `<REPO>` placeholder rather than absolute path

---

## 5. CI lane placement and performance targets

- All MCP SDK server tests should run in the **services** lane.
- Parity tests should be written to run in under ~30s total:
  - minimal fixture repo
  - stub embeddings
  - worker pool off
- If parity tests become slow, split:
  - fast contract tests always on
  - heavier parity tests behind a lane or tag (only if necessary)

---

## 6. Implementation checklist (high level)

- [ ] Add minimal fixture repo for Phase 12 parity tests.
- [ ] Add deterministic repo helper.
- [ ] Add envelope normalization helper.
- [ ] Implement MCP SDK server contract + envelope behavior.
- [ ] Migrate API responses to PocEnvelope.
- [ ] Implement conformance tests for SDK + API + parity.
- [ ] Gate legacy transport behind explicit flag; ensure SDK is default when installed.

