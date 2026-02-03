# Phase 8 -- LSP Provider Hardening (Refined)

> **Purpose:** Make the existing LSP tooling provider reliable, deterministic, and compatible with segment-aware virtual documents and canonical chunk identity (`chunkUid`).

This refinement adds:
- `chunkUid`-keyed storage (no `file::name`)
- Virtual document support (VFS)
- Deterministic restart semantics
- Clear failure accounting policy

---

## 0. Current baseline (grounded)

Provider implementation: `src/integrations/tooling/providers/lsp.js`  
Client implementation: `src/integrations/tooling/lsp/client.js`

Observed behaviors:
- Stores results keyed by `${file}::${name}` (collision-prone).
- Uses on-disk file paths; no notion of virtual documents.
- Process restart handling can race due to captured `proc` ref in exit handler.
- Tooling guard counts failures per-attempt rather than per-target.

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

### 3.2 URI scheme

Prefer `file://` URIs with an absolute path under a temp directory that mirrors `.poc-vfs/...` structure, **if** the server requires filesystem-backed paths.

If the server supports in-memory schemes, allow `poc-vfs://...`.

This must be configurable per language server.

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

## 8. Implementation plan

1. Refactor `src/integrations/tooling/providers/lsp.js`
   - accept `ToolingVirtualDocument[]` and `ToolingTarget[]`
   - open/update VFS docs before queries
   - store results in `byChunkUid`
2. Harden `src/integrations/tooling/lsp/client.js`
   - generation token
   - backoff
   - strict shutdown
3. Update `src/index/type-inference-crossfile/tooling.js`
   - consume `byChunkUid` outputs

---

## 9. Acceptance criteria

- [ ] Provider can return hover/signature results for `.poc-vfs/...` virtual paths.
- [ ] Provider outputs are keyed by `chunkUid`.
- [ ] Restart races do not corrupt active sessions (generation token test).
- [ ] Failure counts reflect per-target failures, not per-attempt.

---

## 10. Tests (exact)

1. `tests/tooling/lsp/lsp-bychunkuid-keying.test.js`
   - Fake LSP client returns deterministic payload; assert map keys are chunkUid.

2. `tests/tooling/lsp/lsp-restart-generation-safety.test.js`
   - Simulate old process exit after new start; assert new process remains active.

3. `tests/tooling/lsp/lsp-vfs-didopen.test.js`
   - Ensure didOpen is sent for virtual doc before hover.

4. `tests/tooling/lsp/lsp-failure-accounting-per-target.test.js`
   - Retry loop triggers one failure count per target.

