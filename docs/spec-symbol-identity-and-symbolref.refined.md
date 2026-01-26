# Spec — Symbol Identity & SymbolRef (v1, refined)

Status: Draft  
Depends on: **Spec — Identity Contract (v1, refined)** (`chunkUid`, `segmentUid`, `virtualPath`)  
Primary goal: deterministically represent “what symbol is this?” and “what symbol does this reference point to?” without `file::name` collisions.

---

## 0. Key design choices (normative)

### 0.1 Separate “group identity” vs “instance identity”
We explicitly model:
- **symbolKey**: groups “the same named symbol in the same scope” (signature-free)
- **signatureKey**: disambiguates overload-like situations
- **scopedId**: the canonical unique ID for a single symbol instance
- **symbolId**: a “public” ID with a scheme prefix; prefers external semantic IDs if available

This separation enables:
- stable grouping for UI/search
- safe uniqueness for graphs and inference

### 0.2 Represent uncertainty explicitly
Resolution MUST not be silently dropped. Any reference that cannot be uniquely resolved MUST be emitted as:
- `state: "ambiguous"` with candidates, or
- `state: "unresolved"` with reasons

---

## 1. Terms

### 1.1 `qualifiedName`
- Type: string
- Meaning: the name used for identity and display, as produced by the chunker.
- Source: `chunk.name` (already includes `Class.method` for JS chunker, etc.)

### 1.2 `kindGroup`
- Type: string enum
- Meaning: normalized category used to avoid collisions across different symbol kinds.
- Example values:
  - `"function"`, `"method"`, `"class"`, `"module"`, `"type"`, `"value"`, `"unknown"`

### 1.3 `virtualPath`
Defined in Identity Contract §2; MUST include `#seg:<segmentUid>` for segment-origin chunks.

---

## 2. Canonical fields on chunks (normative)

Every code chunk that represents a symbol definition MUST carry a computed symbol identity object:

### 2.1 `metaV2.symbol` (canonical)
```json
{
  "symbolKey": "symk1:…",
  "signatureKey": "sig1:…",
  "scopedId": "scid1:…",
  "symbolId": "heur:… | scip:…",
  "kindGroup": "function",
  "qualifiedName": "Foo.bar",
  "containerName": "Foo",
  "languageId": "javascript",
  "virtualPath": "src/foo.js#seg:segu:v1:…"
}
```

### 2.2 Convenience duplication
`chunk.symbol` MAY be duplicated at the top-level chunk object, but `metaV2.symbol` is canonical.

---

## 3. Normalization primitives

### 3.1 `normalizeName(name)`
- MUST be a pure function.
- Default behavior (v1):
  - `trim()`
  - collapse consecutive whitespace to a single space
  - do **not** change case
  - do **not** rewrite punctuation

### 3.2 `normalizeSignature(signature)`
- If signature is absent, signatureKey is null.
- Otherwise:
  - collapse whitespace: `signature.replace(/\s+/g, " ").trim()`

---

## 4. `kindGroup` mapping (normative)

Map language-specific chunk kinds (e.g. `FunctionDeclaration`, `MethodDefinition`, etc.) to a stable group.

Recommended v1 mapping rules (in priority order):
1. If kind matches `/method/i` → `"method"`
2. If kind matches `/class/i` → `"class"`
3. If kind matches `/function|arrow/i` → `"function"`
4. If kind matches `/module|root/i` → `"module"`
5. If kind matches `/interface|type|enum|struct|trait|protocol|record/i` → `"type"`
6. Else → `"value"` (or `"unknown"` if you prefer a stricter split)

Implementation should live in a single helper:
- `src/index/identity/kind-group.js` (recommended)

---

## 5. `symbolKey` (group identity)

### 5.1 Inputs
- `namespaceKey` (default `"repo"`)
- `languageId` (chunk language; use segment language when present)
- `virtualPath`
- `kindGroup`
- `qualifiedName` (from chunker)

### 5.2 Raw form (informative)
```
symk:v1:{namespaceKey}:{languageId}:{virtualPath}:{kindGroup}:{normalizedQualifiedName}
```

### 5.3 Stored form (normative)
To keep keys compact and safe in JSONL:
- `symbolKey = "symk1:" + sha1(raw)`

Where `sha1()` is the project function used elsewhere (e.g. `src/shared/hash.js`).

### 5.4 Collision handling
- SHA1 collisions are theoretically possible but practically negligible.
- No additional collision handling is required for `symbolKey` in v1.

---

## 6. `signatureKey` (overload disambiguation)

### 6.1 Inputs
- `signature` string from `docmeta.signature` when available.
- For languages without signatures, MAY be null.

### 6.2 Construction
- `signatureNorm = normalizeSignature(signature)`
- `signatureKey = signatureNorm ? ("sig1:" + sha1(signatureNorm)) : null`

### 6.3 Notes
- signatureKey MUST NOT include docId, chunkId, or offsets.
- signatureKey SHOULD reflect semantic signature (when tooling provides it), but v1 only guarantees basic whitespace normalization.

---

## 7. `scopedId` (unique per symbol instance)

### 7.1 Inputs
- `symbolKey`
- `signatureKey` (or `"nosig"`)
- `chunkUid` (preferred anchor)  
  Fallback anchor: `chunkId` (only if chunkUid unavailable, which should not happen after Phase 9)

### 7.2 Raw form (informative)
```
scid:v1:{symbolKey}:{signatureKey|nosig}:{anchor=chunkUid}
```

### 7.3 Stored form (normative)
- `scopedId = "scid1:" + sha1(raw)`

### 7.4 Why include `chunkUid`?
- `symbolKey` groups by name/scope and can represent multiple declarations.
- `chunkUid` provides stable per-instance anchoring without relying on offsets.

---

## 8. `symbolId` (public identity with scheme)

### 8.1 Scheme precedence (normative)
1. If an external index provides a stable semantic ID (SCIP preferred):
   - `symbolId = "scip:" + <scipSymbolString>`
2. Else:
   - `symbolId = "heur:" + scopedId`

### 8.2 Additional fields (recommended)
When `symbolId` is external (scip/lsif), it is recommended to also store:
- `fallbackSymbolId = "heur:" + scopedId`

This prevents “losing” a deterministic internal identity if external providers are incomplete.

---

## 9. SymbolRef (reference envelope)

### 9.1 Purpose
A SymbolRef is a versioned envelope used anywhere we point to a symbol:
- chunk-level `callLinks` / `usageLinks`
- `symbol_occurrences` artifact
- `symbol_edges` artifact

SymbolRef MUST be able to represent:
- resolved
- ambiguous
- unresolved

### 9.2 Schema (normative)
```ts
type SymbolRefV1 = {
  v: 1;

  // Resolution state
  state: "resolved" | "ambiguous" | "unresolved";

  // The name as observed at the reference site (required)
  name: string;

  // Optional hints
  kindHint?: string | null;
  languageId?: string | null;

  // If resolved
  symbolId?: string | null;
  scopedId?: string | null;
  symbolKey?: string | null;
  chunkUid?: string | null;
  file?: string | null;

  // Resolution metadata
  confidence?: number | null;      // 0..1
  reason?: string | null;          // human-readable
  scheme?: string | null;          // e.g. "scip", "heuristic-v1"

  // If ambiguous, MUST include candidates (possibly truncated)
  candidates?: Array<{
    symbolId?: string | null;
    scopedId: string;
    symbolKey: string;
    chunkUid: string;
    file: string;
    kindGroup?: string | null;
    score?: number | null;         // relative score for ranking
    reasons?: string[] | null;     // machine-readable reason codes
  }> | null;

  truncation?: {
    truncated: boolean;
    cap: number;
    reason?: string | null;
  } | null;

  // Optional evidence for debugging
  evidence?: {
    importerFile?: string | null;
    importSpecs?: string[] | null;
  } | null;
}
```

### 9.3 Minimal validity rules
- `v` MUST equal `1`
- `name` MUST be non-empty
- If `state === "resolved"`, then (`scopedId` AND `chunkUid`) MUST be present
- If `state === "ambiguous"`, then `candidates` MUST be present and length ≥ 2
- If `state === "unresolved"`, then `reason` SHOULD be present

---

## 10. Where SymbolRef appears (normative)

### 10.1 `codeRelations.callLinks[]`
Each call edge emitted on a chunk MUST be of the form:
```json
{
  "type": "call",
  "from": { "chunkUid": "…" },
  "to": { "v": 1, "state": "resolved|ambiguous|unresolved", "name": "foo", ... }
}
```

### 10.2 `codeRelations.usageLinks[]`
Same pattern:
```json
{
  "type": "usage",
  "from": { "chunkUid": "…" },
  "to": { "v": 1, "state": "resolved|ambiguous|unresolved", "name": "Bar", ... }
}
```

### 10.3 Backward compatibility fields (temporary)
To avoid breaking existing consumers, callLinks MAY also include legacy fields:
- `file` and `target` (legacy)
But graph building MUST prefer `to.chunkUid` / `to.scopedId` and MUST NOT rely on `file::target`.

---

## 11. Implementation checklist

### 11.1 Compute and attach `metaV2.symbol`
Implement in a single place during file processing:
- after `chunkUid` exists (Identity spec)
- before artifacts are written

Recommended location:
- `src/index/build/file-processor/assemble.js` (right before `buildMetaV2`), or
- `src/index/metadata-v2.js` (if all inputs are present)

Inputs required:
- `chunk.metaV2.chunkUid`
- `chunk.file` / `chunk.segment.segmentUid` for virtualPath
- `chunk.lang` / segment language
- `chunk.kind`, `chunk.name`
- `docmeta.signature` when present

### 11.2 Add schemas and strict validation
- Update `src/shared/artifact-schemas.js` for new symbol artifacts (see symbol artifacts spec)
- Update `src/index/validate.js` to ensure `metaV2.symbol.scopedId` exists when `metaV2.chunkUid` exists (strict mode).

---

## 12. Acceptance tests (minimum)

1. Same-name symbols across different files yield different:
   - `symbolKey` (due to virtualPath)
   - `scopedId`
2. Same-name method and function yield different `kindGroup`, thus different `symbolKey`.
3. Overload-like duplicates yield:
   - same `symbolKey`
   - different `scopedId` (anchor differs and/or signatureKey differs)
4. Segment chunks produce `virtualPath` containing `#seg:<segmentUid>` and therefore do not collide with container file symbols.
