# Phase 8 -- Tooling VFS + Segment Routing (Refined)

> **Purpose:** Provide segment-aware "virtual documents" to tooling providers (TypeScript, LSP), so embedded-language chunks are analyzed as if they lived in real `.ts/.js/.tsx/.jsx` files -- and so results can be joined back to chunks deterministically.

This document refines the previous draft by:
- Making identity explicit (`docId`, `chunkId`, `chunkUid`)
- Defining container-vs-effective language fields
- Specifying exact offset mapping rules
- Clarifying `segment.ext` vs effective language derivation (Phase 5 persists `segment.ext`)

---

## 0. Dependencies

- `docs/specs/identity-and-symbol-contracts.md` (ChunkRef + chunkUid)
- `docs/specs/vfs-manifest-artifact.md`
- Effective language contract (container vs effective fields) is aligned with P0-04:
  - `effectiveLanguageId`, `effectiveExt`
  - `containerLanguageId`, `containerExt`

Optional extensions:
- `docs/specs/vfs-index.md`
- `docs/specs/vfs-token-uris.md`
- `docs/specs/vfs-hash-routing.md`
- `docs/specs/vfs-cdc-segmentation.md`
- `docs/specs/vfs-cold-start-cache.md`

---

## 1. Conceptual model

### 1.1 Container vs effective language

A chunk originates from:

- A **container file** on disk (e.g., `.md`, `.vue`, `.svelte`)
- Optionally a **segment** describing embedded language (e.g., fenced `ts` code block)

Therefore each chunk has:

- `containerPath` + `containerExt` (physical)
- `effectiveLanguageId` + `effectiveExt` (language of the chunk content)
- `segmentUid` (required for routing / identity)
- `segmentId` (optional debug; range-derived and not stable under edits)

`segmentUid` is derived per the Identity Contract (segment type + languageId + normalized segment text).

Language IDs MUST be normalized to lowercase for routing and provider selection.

Tooling providers MUST route by **effective** language, not container extension.

### 1.2 Virtual documents

A **virtual document** is a stable path + text pair that tooling parses.

- For non-segmented files: one virtual document == the real file on disk.
- For segmented files: each segment becomes a distinct virtual document (one per `{containerPath, segmentUid}`).

This avoids mixing multiple languages into one document and makes tooling behavior predictable.

---

## 2. Virtual path format (mandatory)

### 2.1 Requirements

Virtual paths MUST:

- be deterministic
- be POSIX-style (use `/` separators)
- not conflict with real repo files
- encode segment identity and effective extension

### 2.2 Canonical format

Use a reserved prefix directory plus encoded container path:

```
.poc-vfs/<containerRelPath>#seg:<segmentUid><effectiveExt>
```

Examples:

- Container file (full-file segment):
  - `.poc-vfs/src/utils/math.ts#seg:<segmentUid>.ts`
  - (or simply use the real path; see 2.3)

- Markdown fenced TS segment:
  - `.poc-vfs/docs/guide.md#seg:<segmentUid>.ts`

- Vue `<script lang="ts">`:
  - `.poc-vfs/src/App.vue#seg:<segmentUid>.ts`

### 2.3 Alternative (allowed)

For non-segmented files, you MAY use the real path instead of `.poc-vfs/...` if:
- you can guarantee the provider will only read from in-memory VFS and not from disk by path, OR
- the on-disk file content matches exactly the virtual document content.

To keep the system uniform and reduce provider branching, prefer always using `.poc-vfs/...` paths.

### 2.4 Path encoding

- `containerPath` MUST be derived from `relKey` (repo-relative POSIX).
- Only `#` and `%` are encoded in `containerPath` before embedding in `.poc-vfs/...`.

### 2.5 Optional routing enhancements (draft)

- Hash routing MAY prepend a hash-derived prefix for disk paths and token URIs; see `docs/specs/vfs-hash-routing.md`.
- Token URIs MAY use `poc-vfs://` with a token derived from `docHash`; see `docs/specs/vfs-token-uris.md`.
- These extensions MUST NOT change `virtualPath` in `vfs_manifest`.

---

## 3. Data structures

### 3.1 `ToolingVirtualDocument`

```ts
export type ToolingVirtualDocument = {
  virtualPath: string;

  // Container identity
  containerPath: string;   // repo-relative path, POSIX
  containerExt: string;    // physical ext, e.g. ".md", ".vue"
  containerLanguageId?: string | null;

  // Effective identity
  languageId: string;      // effectiveLanguageId
  effectiveExt: string;    // ".ts", ".tsx", ".js", ".jsx", ...

  segmentUid: string;       // stable segment identity (Identity Contract)

  segmentId?: string | null; // optional debug id (range-derived)

  text: string;
  docHash: string;         // "xxh64:<hex16>" (xxHash64 of full text)
};
```

### 3.2 `ToolingTarget` (chunk locator)

```ts
export type ToolingTarget = {
  chunk: ChunkRef;                 // docId + chunkUid + chunkId + file + segmentUid (+ optional segmentId)
  virtualPath: string;             // points into ToolingVirtualDocument.virtualPath
  virtualRange: { start: number; end: number }; // offsets in virtual document

  // Optional symbol hint
  symbol?: SymbolRef | null;

  kind?: string | null;
  name?: string | null;
  languageId?: string | null;
};
```

---

## 4. Effective extension derivation (mandatory)

Prefer `metaV2.effective.ext` (or `chunk.segment.ext` where present). If missing, derive `effectiveExt` from `effectiveLanguageId`.

### 4.1 Canonical mapping table

Use the existing mapping in `src/index/segments.js` (`LANGUAGE_ID_EXT`) as the canonical source.

Rules:
- `typescript` → `.ts`
- `tsx` → `.tsx`
- `javascript` → `.js`
- `jsx` → `.jsx`
- others as available

### 4.2 MUST preserve TSX/JSX

If upstream code collapses `tsx → typescript` or `jsx → javascript`, that must be corrected (see P0-05) before this routing is considered complete.

---

## 5. Offset mapping (critical)

### 5.1 Definitions

- `containerStart/containerEnd`: offsets in the container file (as stored in chunks today).
- `segmentStart`: offset in the container file where the segment text begins.
- `virtualStart/virtualEnd`: offsets in the virtual document text.

### 5.2 Mapping rules

For a chunk inside a segment:

```
virtualStart = containerStart - segmentStart
virtualEnd   = containerEnd   - segmentStart
```

For a chunk with no segment (`segmentStart = 0`):

```
virtualStart = containerStart
virtualEnd   = containerEnd
```

### 5.3 Validation

The VFS builder MUST assert:

- `0 <= virtualStart <= virtualEnd <= virtualDoc.text.length`

If violated, this is a bug in segmentation/chunk offset adjustment; fail in strict mode.

---

## 6. Building virtual documents and targets (implementation plan)

Create `src/index/tooling/vfs.js` (or similar) exposing:

- `buildToolingVirtualDocuments(chunks, fileTextByPath, options) -> { documents, targets }`

### 6.1 Inputs

- `chunks`: in-memory chunk objects already produced by the builder
- `fileTextByPath`: map from `containerPath` to full file text (already loaded in file-processor)
- `options.strict`

### 6.2 Algorithm (deterministic)

1. Group chunks by `{containerPath, segmentUid}`.
2. For each group:
   - Determine `effectiveLanguageId` (lowercased):
     - `chunk.lang` or `chunk.metaV2.lang` if present, else `chunk.segment.languageId`, else file-level language.
   - Determine `effectiveExt` from mapping table (Section 4).
   - Determine virtual document `text`:
     - If segment: use segmentText extracted during segmentation.
     - Else: use full file text.
   - Compute `docHash = "xxh64:" + xxh64(text)`.
   - Create `virtualPath`.
3. For each chunk in the group:
   - Build a `ChunkRef` (docId, chunkUid, chunkId, file, segmentUid, range).
   - Compute `virtualRange` via offset mapping.
   - Create a `ToolingTarget` pointing to the group's `virtualPath`.

### 6.3 Where to get segmentText

Preferred: extend segmentation output to include `segment.text` for each segment (already computed internally).  
If not available, re-slice from container text using segment `{start,end}`:

- `segmentText = containerText.slice(segment.start, segment.end)`

This must match the chunk offsets after segment adjustment.

### 6.4 Optional lookup accelerators (draft)

- `vfs_index` MAY be used to resolve `virtualPath` without scanning `vfs_manifest` (see `docs/specs/vfs-index.md`).
- Segment hashing MAY reuse a cache keyed by file hash + segment range (see `docs/specs/vfs-segment-hash-cache.md`).
- Large files MAY use CDC segmentation when no language-specific segmenter exists (see `docs/specs/vfs-cdc-segmentation.md`).

---

## 7. Provider routing (mandatory)

Given a `ToolingVirtualDocument.languageId`:

- If `languageId in {typescript, tsx, javascript, jsx}`:
  - eligible for TypeScript provider
- Else:
  - skip TypeScript provider (unless future providers support it)

LSP provider routing depends on server capabilities and configured language servers. It MUST route based on `effectiveExt/languageId` in the virtual doc, not container ext.

---

## 8. Caching keys (must be stable)

For any provider run, compute a cache key:

```
cacheKey = sha1(
  providerId + "|" +
  providerVersion + "|" +
  providerConfigHash + "|" +
  join(sorted(documents.map(d => d.virtualPath + ":" + d.docHash)), ",")
)
```

This ensures:
- any change in virtual doc content invalidates cache
- ordering is deterministic

## 8.1 Operational performance extensions (draft)

- Cold-start cache MAY reuse VFS disk docs across runs; see `docs/specs/vfs-cold-start-cache.md`.
- IO batching MAY reduce disk write churn during VFS materialization; see `docs/specs/vfs-io-batching.md`.

---

## 9. Acceptance criteria

- [ ] Embedded TS/JS segments inside `.md/.vue/.svelte/.astro` are routed to the correct provider.
- [ ] All tool outputs can be joined back to chunks by `chunkUid`.
- [ ] Offset mapping is validated and fails closed in strict mode.

---

## 10. Tests (exact)

1. `tests/tooling/vfs/vfs-maps-segment-offsets.test.js`
   - Fixture: `.md` file with fenced TS.
   - Assert `virtualRange` maps to the correct substring in `virtualDoc.text`.

2. `tests/tooling/vfs/vfs-virtualpath-deterministic.test.js`
   - Build twice; assert identical virtualPath generation.

3. `tests/tooling/vfs/vfs-routing-by-effective-language.test.js`
   - `.vue` with `<script lang="ts">` and `<template>`.
   - Ensure TS tooling runs only on TS virtual doc, not on template.


