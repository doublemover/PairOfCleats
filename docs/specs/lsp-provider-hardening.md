# Phase 8 -- LSP Provider Hardening (Refined)

> **Purpose:** Make the existing LSP tooling provider reliable, deterministic, and compatible with segment-aware virtual documents and canonical chunk identity (`chunkUid`).

Status: Implemented for the required acceptance criteria in the current branch. Focused validation passed 7 selected LSP/VFS checks with 0 failures, 0 timeouts, and 0 skipped in `temp/validation/lsp-vfs-focused-spec-acceptance-20260521.log`.

This refinement adds:
- `chunkUid`-keyed storage (no `file::name`)
- Virtual document support (VFS)
- Deterministic restart semantics
- Clear failure accounting policy
- Token URIs + hash routing options for VFS documents

---

## 0. Implementation status

Provider implementation: `src/integrations/tooling/providers/lsp.js`  
Client implementation: `src/integrations/tooling/lsp/client.js`

Historical gaps now closed:
- Provider output is keyed by `chunkUid`, not `${file}::${name}`.
- `.poc-vfs/...` virtual documents are opened before LSP queries.
- Restart generation safety is covered by a focused race test.
- Failure accounting is covered at the per-target level.

---

## 1. Goals

1. **Correctness:** No silent key collisions; results keyed by `chunkUid`.
2. **Segment-aware:** Support requests against `.poc-vfs/...` virtual paths.
3. **Stability:** Robust restart/backoff semantics for the LSP server process.
4. **Determinism:** Identical inputs produce identical output order and shapes.

---

## 2. LSP provider contract (updated)

### 2.1 Inputs

Use `ToolingRunInputs.targets[]` where each target includes:

- `chunk: ChunkRef` (must include chunkUid)
- `virtualPath` + `virtualRange`

### 2.2 Output

Provider MUST emit `ToolingProviderOutput.byChunkUid`.

---

## 3. Virtual document support

### 3.1 Document opening policy (mandatory)

Before querying hover/signature help for a target in `virtualPath`:

1. Send `textDocument/didOpen` with:
   - `uri = file://<virtualPath>` (or a custom URI scheme if server supports)
   - `languageId` derived from `ToolingVirtualDocument.languageId`
   - `text` from the VFS document

2. For subsequent targets in the same virtualPath:
   - do not re-open unless content hash changed
   - if content hash changed, send `didChange` (preferred) or close+open

Disk-backed VFS materialization MAY use:
- IO batching (see `docs/specs/vfs-io-batching.md`)
- cold-start cache reuse (see `docs/specs/vfs-cold-start-cache.md`)

### 3.2 URI scheme

Prefer `file://` URIs with an absolute path under a temp directory that mirrors `.poc-vfs/...` structure, **if** the server requires filesystem-backed paths.

If the server supports in-memory schemes, allow `poc-vfs://...`.

This must be configurable per language server.

#### Token URIs

- When enabled, the provider SHOULD use `poc-vfs` URIs with a token query parameter (see `docs/specs/vfs-token-uris.md`).
- When using `file://` URIs, hash routing SHOULD be applied to disk paths so token changes force a new on-disk path (see `docs/specs/vfs-hash-routing.md`).

#### URI encoding rules

- `poc-vfs://` URIs MUST encode each path segment via `encodeURIComponent`.
- Disk fallback paths MUST be derived via `resolveVfsDiskPath` to avoid path traversal or unsafe characters.
- When using disk-backed URIs, reuse existing files when `docHash` is unchanged to avoid unnecessary rewrites.

---

## 4. Robust process lifecycle (hardening)

### 4.1 Generation token for restart safety

In `createLspClient(...)`, track a monotonically increasing `generation`:

- each `start()` increments generation and associates it with the spawned process
- exit handler only performs cleanup if the exiting process generation matches current generation

This prevents old exit events from tearing down a newly started process.

### 4.2 Backoff policy (mandatory)

On repeated spawn failures:
- exponential backoff with cap (e.g., 250ms → 5s)
- reset backoff after a successful "initialize" handshake

### 4.3 Strict shutdown

Ensure:
- `shutdown` request is sent when possible
- `exit` notification follows
- hard kill after timeout

---

## 5. Failure accounting policy (refined)

Current `createToolingGuard.recordFailure()` increments per attempt.  
New policy: increment failure counters per **target**.

### 5.1 Definitions

- A "target failure" means all attempts for a target failed.
- Retries are internal and do not count as separate failures.

### 5.2 Required implementation

- Maintain per-target attempt loop.
- Only call `recordFailure()` after exhausting retries for that target.
- `recordSuccess()` may be called per successful target.

---

## 6. Type extraction strategy

LSP servers vary. Baseline strategy:

1. `textDocument/hover` at the symbol identifier position:
   - parse return type where possible (language-server-specific)
2. `textDocument/signatureHelp` at call-site or function position:
   - parse parameters + return type where possible
3. If server supports it, consider:
   - `textDocument/documentSymbol` for symbol anchoring (optional Phase 8)

All parsed types must be normalized and emitted with confidence.

---

## 7. Joining results to chunks (critical)

**Never** key by `file::name`.  
Always key by `chunkUid`:

- For each target, output entry:
  - `byChunkUid[target.chunk.chunkUid] = enrichment`

Include `chunkId` and `docId` in the `ChunkRef` for traceability.

If two targets share the same `chunkUid` (should not happen if chunkUid collision handling is implemented):
- treat as a hard error in strict mode
- else last-write-wins but record diagnostic

---

## 8. Implementation ownership

1. `src/integrations/tooling/providers/lsp.js`
   - accepts `ToolingVirtualDocument[]` and `ToolingTarget[]`
   - opens VFS docs before queries
   - stores results in `byChunkUid`
2. `src/integrations/tooling/lsp/client.js`
   - owns generation token behavior, backoff, and strict shutdown
3. `src/index/type-inference-crossfile/tooling.js`
   - consumes `byChunkUid` outputs

---

## 9. Acceptance criteria

- [x] Provider can return hover/signature results for `.poc-vfs/...` virtual paths.
- [x] Provider outputs are keyed by `chunkUid`.
- [x] Restart races do not corrupt active sessions (generation token test).
- [x] Failure counts reflect per-target failures, not per-attempt.

---

## 10. Tests (exact)

1. `tests/tooling/lsp/bychunkuid-keying.test.js`
   - Fake LSP client returns deterministic payload; assert map keys are chunkUid.

2. `tests/tooling/lsp/restart-generation-safety.test.js`
   - Simulate old process exit after new start; assert new process remains active.

3. `tests/tooling/lsp/vfs-didopen.test.js`
   - Ensure didOpen is sent for virtual doc before hover.

4. `tests/tooling/lsp/metrics-contract-matrix.test.js`
   - Retry loop triggers one failure count per target.

Current validation:

```powershell
node tests/run.js tooling/lsp/bychunkuid-keying tooling/lsp/restart-generation-safety tooling/lsp/vfs-didopen tooling/lsp/metrics-contract-matrix tooling/vfs/maps-segment-offsets tooling/vfs/routing-and-token-contract-matrix tooling/vfs/invalid-virtual-range-regression --lane=all --timeout-ms 30000
```

Evidence: `temp/validation/lsp-vfs-focused-spec-acceptance-20260521.log`.

