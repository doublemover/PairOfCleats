# Phase 9 Spec — Identity Contracts (chunkUid, symbolKey, scopedId, SymbolId)

## Scope
This spec defines the canonical identity types and their invariants for PairOfCleats Phase 9: **collision-safe symbol identity and cross-file linking**.

It is intended to remove ambiguity for implementers and for downstream consumers (graphs, retrieval, map, MCP tools).

## Definitions

### chunkUid
A stable-ish identifier for a *chunk span*.

**Required fields / inputs**
- `namespaceKey` (stable per repo root; usually `"repo"` or equivalent)
- `virtualPath` (POSIX; `fileRelPath` or `fileRelPath#seg:<segmentUid>`)
- `start`, `end` offsets (0-based UTF-16; used only to slice context windows)
- `chunkText` (span text) and pre/post context text
- Optional: `segment.languageId` salt

**Invariants**
- Must be present in every chunk record and persisted in artifact + SQLite representations.
- Must be stable under deterministic builds (line-shift resilient when span text is unchanged).
- Must be collision-safe: any collisions MUST be disambiguated deterministically.

**Representation**
- Type: string
- Prefix: `ck64:v1:` (see canonical algorithm below).

**Algorithm (v1) — canonical**  
This Phase 9 spec adopts the algorithm in `docs/spec-identity-contract.refined.md` §4.

Summary (must match the canonical spec exactly):

```
span = normalizeForUid(chunkText)
pre  = normalizeForUid(fileText.slice(max(0, start - PRE_CONTEXT_CHARS), start))
post = normalizeForUid(fileText.slice(end, min(fileText.length, end + POST_CONTEXT_CHARS)))

spanHash = checksumString("span\0" + span)
preHash  = checksumString("pre\0" + pre)   (only if pre.length > 0)
postHash = checksumString("post\0" + post) (only if post.length > 0)

base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + spanHash
if (segment.languageId) base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + segment.languageId + ":" + spanHash
if (preHash)  base += ":" + preHash
if (postHash) base += ":" + postHash

chunkUid = base
```

Collision handling MUST follow the canonical disambiguation steps (escalated context, then deterministic ordinals).

### symbolKey
A stable grouping key for symbol-like entities; not necessarily unique (overload set).

**Inputs**
- `namespaceKey` (language + namespace domain; e.g., `ts`, `js`, `py`)
- `virtualPath` (segment-safe)
- `kind` (normalized kind taxonomy; see below)
- `qualifiedName` (best-effort; may be null)
- `containerChain` (optional list of ancestor names/kinds)

**Invariants**
- Deterministic for the same input semantics.
- Never used as a join key without disambiguation.

**Representation**
- Type: string
- Recommended: `symk:<hash>` plus optional debug suffixes in dev logs only.

### signatureKey
A per-language normalized signature disambiguator used to distinguish overloads and repeated same-name constructs.

**Inputs**
- `normalizedSignature` (language-specific normalization rules; see below)
- Hash: `sha1(normalizedSignature)` (or sha256; keep consistent with the repo’s hash policy)

**Representation**
- `sig:sha1:<hex>`

### scopedId
A unique join key for a single symbol candidate.

**Inputs**
- `symbolKey`
- `signatureKey` (optional but preferred when available)
- `anchor` disambiguator when needed:
  - stable `(start,end)` or `(startLine,endLine)` within segment
  - or deterministic ordinal after sorting collisions by `(start,end)`.

**Invariants**
- Must be unique per build.
- Must be stable for deterministic builds.
- Collisions must be detected; unresolved collisions are strict-mode errors.

**Representation**
- Type: string
- Format: `scoped:<hash>` where `<hash>` is derived from the deterministic tuple:
  - `symbolKey + '\0' + (signatureKey||'') + '\0' + anchor`

### SymbolId
A globally meaningful identity when available, else a deterministic fallback.

**Schemes**
- `scip:<id>`
- `lsif:<id>`
- `ctags:<id>` (future)
- `heur:<scopedId>` (fallback)

**Invariants**
- Must always be parseable by prefix.
- Consumers must treat scheme as authoritative for interpretation.

## Kind taxonomy (minimal v1)
Phase 9 must define a normalized kind set used by symbol artifacts:
- `function`, `method`, `class`, `interface`, `type`, `enum`, `variable`, `constant`, `namespace`, `module`, `property`, `field`, `unknown`

Producers may include a `rawKind` field for debugging, but `kind` must be from this set.

## Strict validation requirements
Strict validation must enforce:
- `symbols.jsonl` has unique `scopedId`s.
- Every `symbol_edge` endpoint exists in `symbols.jsonl` unless `status: unresolved`.
- Every occurrence range is within file bounds and (if a segment exists) within segment bounds.
- No record is missing required identity fields for its record type.

## Determinism requirements
- All emitted symbol artifacts must be stably ordered:
  - primary key: `scopedId`
  - secondary: `kind`, `virtualPath`, `start`, `end`
- When generating ordinals for collision disambiguation, ordinals must be derived from this stable order.
