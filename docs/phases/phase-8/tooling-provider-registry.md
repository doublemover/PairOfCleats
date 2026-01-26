# Phase 8 -- Tooling Provider Registry (Refined)

> **Purpose:** Make tooling-backed enrichment deterministic, segment-aware, cacheable, and collision-safe.  
> **Key refinement in this version:** Explicit identity contracts (`docId`, `chunkId`, `chunkUid`) and optional symbol references (`symbolKey` / `symbolId`) integrated into provider inputs/outputs.

---

## 0. Prerequisites / dependencies

This spec assumes the following contract exists and is implemented (or implemented in the same change set):

- **Identity + Symbol contracts**: `docs/phases/phase-8/identity-and-symbol-contracts.md`  
  - `docId` (int), `chunkId` (range hash), `chunkUid` (stable-ish)
  - `ChunkRef`, `SymbolRef`, join precedence rules

If `chunkUid` is not yet persisted in `metaV2`, the provider framework MUST compute it in-memory and fail closed if missing.

---

## 1. Goals

1. Provide a **single** orchestration entrypoint for tooling-backed passes (TypeScript, LSP, future providers).
2. Standardize **inputs/outputs** so providers can be swapped or chained without bespoke glue.
3. Ensure **all joins are collision-safe**:
   - Primary chunk join key: `chunkUid`
   - Symbol joins (optional): `symbolId/scopedId/symbolKey` tiered
4. Ensure **deterministic caching** keyed on:
   - provider version + provider config hash
   - virtual document hashes (segment-aware)
   - toolchain version (tsserver, typescript compiler, etc.)

---

## 2. Non-goals

- Implementing full SCIP/LSIF symbol IDs across all languages (Phase 8 can emit heuristic `SymbolRef`).
- Implementing a universal "tooling protocol" beyond what TypeScript/LSP need.

---

## 3. Provider registry overview

### 3.1 Registry shape

Create `src/index/tooling/registry.js`:

```js
export const TOOLING_PROVIDERS = new Map();
/**
 * @param {ToolingProvider} provider
 */
export function registerToolingProvider(provider) {
  // validates id, version, required methods
  TOOLING_PROVIDERS.set(provider.id, provider);
}

export function getToolingProvider(id) {
  return TOOLING_PROVIDERS.get(id) || null;
}
```

### 3.2 Provider interface (normative)

```ts
export type ToolingProviderId =
  | 'typescript'
  | 'lsp'
  | string;

export type ToolingProvider = {
  id: ToolingProviderId;
  version: string; // semantic version, must change on output-affecting changes

  // Capability flags used by orchestrator
  capabilities: {
    supportsVirtualDocuments: boolean;
    supportsSegmentRouting: boolean;
    supportsJavaScript?: boolean;
    supportsTypeScript?: boolean;
    supportsSymbolRef?: boolean;
  };

  // Return a stable hash of config (provider-specific). Used for caching.
  getConfigHash(ctx: ToolingRunContext): string;

  // Main entrypoint. Must be pure relative to ctx and inputs (except logging).
  run(ctx: ToolingRunContext, inputs: ToolingRunInputs): Promise<ToolingProviderOutput>;
};
```

---

## 4. Canonical input/output contracts

### 4.1 `ToolingRunContext`

```ts
export type ToolingRunContext = {
  repoRoot: string;           // absolute path
  buildRoot: string;          // absolute path for current build output
  mode: 'code'|'prose'|string;
  logger?: (evt: ToolingLogEvent) => void;

  // identity / provenance
  configHash: string;
  buildId?: string | null;

  // feature flags / policy
  strict: boolean;
  cache: {
    enabled: boolean;
    dir: string;             // e.g., <buildRoot>/tooling-cache
  };
};
```

### 4.2 `ToolingRunInputs`

Providers MUST consume segment-aware virtual documents and chunk locators.

```ts
export type ToolingRunInputs = {
  // Segment-aware virtual docs (see VFS spec)
  documents: ToolingVirtualDocument[];

  // The chunks we want enriched (subset of all chunks)
  targets: ToolingTarget[];

  // Optional: extra info for symbol-aware providers (not required in Phase 8)
  symbolHints?: {
    byChunkUid?: Record<string, SymbolRef>;
  };
};
```

### 4.3 `ToolingVirtualDocument`

This is produced by the VFS builder, not by providers.

```ts
export type ToolingVirtualDocument = {
  virtualPath: string;          // stable, POSIX-like (e.g., ".poc-vfs/src/app.vue#seg2.ts")
  languageId: string;           // effective languageId (segment-aware)
  effectiveExt: string;         // ".ts", ".tsx", ".js", ".jsx", ...
  containerPath: string;        // repo-relative path for container file
  containerExt: string;         // physical file ext (".vue", ".md", ...)

  segmentUid: string;           // stable segment identity (Identity Contract)
  segmentId?: string | null;     // optional debug id (range-derived)

  // full document text that tooling parses
  text: string;

  // deterministic content hash used for caching
  docHash: string;              // "xxh64:<hex16>" (xxHash64 of full text)
};
```

### 4.4 `ToolingTarget` (chunk-aware; collision-safe)

```ts
export type ToolingTarget = {
  chunk: ChunkRef; // docId + chunkUid + chunkId + file + segmentUid (+ optional segmentId) + optional range

  // Range within virtual document (preferred), so provider does not need container offsets.
  virtualRange: { start: number; end: number };

  // Optional: symbol identity for symbol-like targets
  symbol?: SymbolRef | null;

  // Hints
  kind?: string | null;
  name?: string | null;
  languageId?: string | null; // effective language id
};
```

---

## 5. Provider outputs (normative)

### 5.1 `ToolingProviderOutput`

Providers MUST key outputs by `chunkUid`.

```ts
export type ToolingProviderOutput = {
  provider: { id: string; version: string; configHash: string };

  // "byChunkUid" is the only canonical output map.
  byChunkUid: Record<string, ToolingEnrichment>;

  // Optional provider-level diagnostics (doctor-like info can be emitted here too)
  diagnostics?: ToolingDiagnostics;

  // Optional: provider-level symbol table (for future graph integration)
  symbols?: {
    bySymbolId?: Record<string, SymbolRef>;
    bySymbolKey?: Record<string, SymbolRef[]>;
  };
};
```

### 5.2 `ToolingEnrichment`

```ts
export type ToolingEnrichment = {
  chunk: ChunkRef;      // MUST be present for traceability (not just implied by map key)
  symbol?: SymbolRef;   // optional

  // The actual payload is provider-defined but must be versioned.
  payload: {
    // For type providers, these are the initial normalized shapes:
    returnType?: string | null;
    paramTypes?: Record<string, { type: string; confidence: number; source: string }[]>;
    genericHints?: any;
  };

  // provenance for debugging and confidence scoring
  provenance: {
    provider: string;
    version: string;
    collectedAt: string;        // ISO timestamp
    evidence?: string[];        // short strings; no large blobs
  };
};
```

### 5.3 Backward compatibility (temporary)

Some legacy code paths currently store maps keyed by `file::name` or by `chunkId`. During migration:

- The orchestrator MAY accept legacy provider outputs as:
  - `byChunkId: Record<string, ...>`
  - `byLegacyKey: Record<string, ...>`
- But MUST normalize them into `byChunkUid` before merging into the build state.

Normalization is performed using the in-memory mapping:

- `chunkUidByChunkId: Map<string, string>`
- `chunkUidByLegacyKey: Map<string, string>` (where legacyKey = `file::name`)

If normalization cannot resolve a key, in **strict mode** it is an error; otherwise it is a warning and the entry is dropped.

---

## 6. Orchestration pipeline

### 6.1 Entry point

Create `src/index/tooling/run.js`:

```js
export async function runToolingProviders(ctx, inputs, providerIds) {
  // 1) validate identity fields present (chunkUid must exist)
  // 2) build per-provider cache keys
  // 3) run providers sequentially or in a controlled concurrency pool
  // 4) merge results into a single normalized output keyed by chunkUid
}
```

### 6.2 Merging policy (mandatory)

When two providers emit enrichment for the same `chunkUid`:

- Merge at the **field level** with deterministic precedence:
  1. preferred provider(s) for the language
  2. higher confidence entries
  3. stable lexical tie-break (providerId, then type string)

Never silently overwrite without recording provenance.

---

## 7. Implementation grounding (current code touchpoints)

These are the most relevant existing modules to modify:

- `src/index/type-inference-crossfile/tooling.js`
  - currently keys `typesByChunk` by `${file}::${name}` -- must migrate to `chunkUid`.
- `src/integrations/tooling/providers/lsp.js`
  - stores results by `file::name` -- must migrate to `chunkUid`.
- `src/index/tooling/typescript-provider.js`
  - currently limited JS support and disk-only files -- must support VFS docs and JS parity (separate spec).
- `src/index/chunk-id.js`
  - currently exposes `resolveChunkId` -- extend / add `resolveChunkUid` and standardize naming.

---

## 8. Acceptance criteria (Phase 8 gate)

- [ ] Registry can run at least TypeScript and LSP providers via a single orchestrator.
- [ ] Provider outputs are keyed by `chunkUid` (not `file::name`).
- [ ] Orchestrator caches provider outputs using `provider.version + provider.configHash + virtualDocHashes`.
- [ ] Strict mode rejects missing/unresolvable chunkUid joins.

---

## 9. Tests (exact)

1. `tests/tooling/provider-registry-normalizes-legacy-keys.test.js`
   - Feed a fake provider output keyed by `file::name` and assert it normalizes into `byChunkUid`.

2. `tests/tooling/provider-registry-merges-deterministically.test.js`
   - Two fake providers emit overlapping chunks; assert merge is deterministic and provenance retained.

3. `tests/tooling/provider-registry-strict-missing-chunkuid.test.js`
   - Provide a target missing chunkUid; assert strict mode fails fast with actionable error.


