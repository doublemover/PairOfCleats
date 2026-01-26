# Metadata Schema v2 (Updated)

This document defines the v2 per-chunk metadata contract. `metaV2` is stored inside `chunk_meta` entries.

Schema version: **2.0.0**

This updated version aligns the contract with:
- segment-aware indexing (embedded code inside container formats),
- Phase 5 “container vs effective” language identity, and
- current implementation realities in PairOfCleats-main (39).

## 1) Core identity

### 1.1 chunk identity fields

- `chunkId` (string): stable identifier for the chunk span within a container file.
  - Current implementation derives it from the container file path, segment id, and the chunk range.
  - `chunkId` is **range-specific**; line-shift edits that move offsets will change it.
- `file` (string): repo-relative container path (POSIX separators).
- `fileHash` (string|null): hash of the decoded container file contents (if computed).
- `fileHashAlgo` (string|null): hash algorithm identifier (e.g., `sha1`).

### 1.2 range

`range` describes the chunk span in the **container file text**.

- `range.start` (number): UTF-16 code unit offset (0-based, inclusive)
- `range.end` (number): UTF-16 code unit offset (0-based, exclusive)
- `range.startLine` (number): 1-based
- `range.endLine` (number): 1-based

Offsets must be compatible with `text.slice(start, end)`.

## 2) Segment identity (embedded content)

`segment` describes the embedded segment from which this chunk was produced.

- `segment.segmentId` (string)
- `segment.segmentUid` (string): stable segment identity based on normalized segment text + type + hint (Phase 8 identity contract).
  - Stable across rebuilds unless the segment text/type/language changes.
- `segment.type` (string): `code | prose | config | comment | embedded`
- `segment.languageId` (string|null): raw segment language hint (e.g., fence/lang attribute).  
  This is NOT guaranteed to match the language registry id.
- `segment.ext` (string|null): effective extension derived from the hint (e.g., `.tsx`, `.ts`)
- `segment.parentSegmentId` (string|null)
- `segment.start` / `segment.end` (number): container offsets for the segment span
- `segment.startLine` / `segment.endLine` (number|null): container line numbers for the segment span
- `segment.embeddingContext` (string|null): `code | prose | ...`
  - Required for embedded segments; null for non-segment chunks.

For non-segmented chunks (full container files), `segment` may be null.

## 3) Container vs effective language identity (Phase 5)

A chunk originates from a **container file** (physical file on disk) but may be interpreted under an **effective** language (the language used to parse/tokenize/enrich the chunk content).

### 3.1 Canonical fields

- `container` (object):
  - `ext` (string|null): container file extension (e.g., `.md`, `.vue`)
  - `languageId` (string|null): container language id (registry id when known)
- `effective` (object):
  - `ext` (string|null): effective extension used for parsing/tokenization (e.g., `.ts`, `.tsx`)
  - `languageId` (string|null): effective language registry id (e.g., `typescript`)

### 3.2 Legacy compatibility

- Older builds may only populate `ext` and `lang` without `container/effective`.
- Readers should treat:
  - `metaV2.ext` as container extension (legacy),
  - `metaV2.lang` as “best available language id” (legacy), and
  - derive effective identity from `segment.languageId` + mapping tables when `effective` is missing.

### 3.3 `lang` and `ext` top-level fields

For new builds (Phase 5+), the following interpretation is recommended:

- `lang`: effective language registry id (same as `effective.languageId`)
- `ext`: container extension (same as `container.ext`)

These are retained for compatibility with older readers that expect `lang/ext` at the top level.

## 4) Symbol descriptor fields

- `kind` (string|null): function/class/etc
- `name` (string|null): symbol name (may be qualified)
- `signature` (string|null)
- `doc` (string|null)
- `annotations` (string[]): decorators/attributes
- `modifiers` (string[] | object): canonical is string array; legacy object map tolerated
- `params` (string[]): parameter names
- `returns` (string|null): a single declared return type string when available (legacy convenience; prefer `types.declared.returns[]`)

## 5) Types

`types` is an object with optional `declared`, `inferred`, and `tooling` buckets.

- `types.<bucket>.returns`: array of type entries
- `types.<bucket>.params`: canonical is an object map `{ paramName: TypeEntry[] }`
  - legacy form may be an array (loses param name); readers should tolerate it

Rationale: parameter types must retain the parameter name, while returns are anonymous. This is why params are a map and returns are a list.

Example (canonical):

```json
{
  "types": {
    "inferred": {
      "params": {
        "opts": [{ "type": "WidgetOpts", "source": "tooling" }]
      },
      "returns": [{ "type": "Widget", "source": "tooling" }]
    }
  }
}
```

Type entry shape (minimum):

```ts
type TypeEntry = {
  type: string;
  source?: string | null;
  confidence?: number | null;
  shape?: string | null;
  elements?: string[] | null;
  evidence?: string[] | null;
};
```

## 6) Relations (summary)

- `relations.calls` / `relations.usages`: light-weight edge lists (legacy)
- `relations.callLinks` / `relations.usageLinks`: cross-file linked targets (post-inference)
- `relations.callSummaries`: bounded, explainable summaries (post-inference)

Phase 6 introduces a dedicated `call_sites` artifact for evidence-rich callsites; do not bloat `metaV2` with full callsite payloads.

## 7) Mapping from `docmeta`

Key mapping (non-exhaustive):

- `docmeta.signature` → `metaV2.signature`
- `docmeta.doc` → `metaV2.doc`
- `docmeta.decorators` → `metaV2.annotations`
- `docmeta.modifiers` → `metaV2.modifiers`
- `docmeta.params` → `metaV2.params`
- `docmeta.paramTypes` → `metaV2.types.declared.params`
- `docmeta.returnType` and `docmeta.returns` → `metaV2.types.declared.returns`
- `docmeta.inferredTypes.*` → `metaV2.types.inferred.*`
- `docmeta.risk.*` → `metaV2.risk.*`
- `docmeta.controlFlow.*` → `metaV2.controlFlow.*`
- `docmeta.dataflow.*` → `metaV2.dataflow.*`

## 8) Contract notes

- Offsets are in decoded text (UTF-16 code units). If tooling uses byte offsets, it must translate.
- Any fields not defined above must be placed under `extensions` when strict schema enforcement is enabled.
