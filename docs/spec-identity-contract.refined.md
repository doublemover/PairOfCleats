# Spec — Identity Contract (v1, refined)

Status: Draft  
Applies to: PairOfCleats index build pipeline  
Primary goal: eliminate `file::name` collisions by introducing stable, collision-safe identity primitives.

---

## 0. What this spec is (and is not)

### 0.1 Goals
This spec defines **identity primitives** used to join data across:
- chunks / postings / embeddings (build-local)
- relation graphs (cross-file)
- cross-file inference outputs
- symbol artifacts (Phase 9 surfaces)

It aims to make identity:
- deterministic (same input ⇒ same ID)
- stable under *minor line shifts* (insert/remove text elsewhere in the file)
- collision-safe (duplicate spans handled deterministically)
- segment-safe (embedded/code-fence segments do not collide with their container file)

### 0.2 Non-goals
- Perfect semantic symbol identity across refactors/renames (future external index integration helps).
- Replacing docId as the fast integer join key (docId remains build-local).
- Full module-resolution correctness (defined in cross-file resolution spec, with bounded scope).

---

## 1. Canonical terms

### 1.1 `docId` (build-local)
- Type: integer (≥ 0)
- Meaning: build-local array index used for postings/embeddings alignment.
- Stability: **NOT** stable across builds (MUST NOT be used as a persistent identity).
- Canonical location: `chunk.docId` and in postings/embeddings alignment.

### 1.2 `chunkId` (legacy range-hash)
- Type: string
- Meaning: existing “range-based” ID currently produced by `src/index/chunk-id.js`.
- Stability: changes when offsets change (NOT line-shift resilient).
- Canonical location: `chunk.metaV2.chunkId`
- Status: retained for compatibility/debugging; **MUST NOT** be used as the primary cross-file join key.

### 1.3 `segmentId` (legacy segment range ID)
- Type: string
- Meaning: current segment identifier produced by `src/index/segments.js` (hash includes offsets).
- Stability: NOT stable under line shifts.
- Canonical location: `chunk.metaV2.segment.segmentId`
- Status: retained for debugging/back-compat only.

### 1.4 `segmentUid` (new, stable segment identity)
- Type: string
- Meaning: stable identity for an embedded segment’s *content* (code fence / embedded region), resilient to line shifts in the container file.
- Canonical location:
  - `chunk.segment.segmentUid` (top-level chunk payload)
  - `chunk.metaV2.segment.segmentUid`
- Presence:
  - MUST be present for any chunk originating from a segment (`chunk.segment != null`).
  - MUST be null/absent for non-segment chunks.

### 1.5 `chunkUid` (new, stable chunk identity)
- Type: string
- Meaning: stable identity for a chunk’s span content, used as the canonical node ID for graphs and cross-file joins.
- Canonical location:
  - `chunk.chunkUid` (top-level, convenience)
  - `chunk.metaV2.chunkUid` (canonical)
- Presence:
  - MUST be present for every chunk in code-mode indexing.
- Stability requirements:
  - MUST remain stable if text is inserted/removed *outside* the chunk span and outside its immediate context windows.
  - MUST remain stable across repeated identical builds.

---

## 2. Canonical “virtual path” (segment-safe file identity)

Many identity computations need a stable “file-like namespace” that distinguishes:
- a real file (`src/a.js`)
- an embedded segment inside a container file (`README.md` code fence)

### 2.1 `virtualPath`
- For non-segment chunks:
  - `virtualPath = fileRelPath`
- For segment chunks:
  - `virtualPath = fileRelPath + "#seg:" + segmentUid`

Notes:
- `fileRelPath` MUST be POSIX-style, repo-relative (use `toPosix()`).
- `segmentUid` is stable across line shifts; **do not** use legacy `segmentId`.

---

## 3. `segmentUid` algorithm (normative)

### 3.1 Inputs
For an embedded segment:
- `segment.type` (string; e.g., `"embedded"`, `"comment"`, `"prose"` — project-defined)
- `segment.languageId` (string|null; e.g., `"javascript"`, `"typescript"`, `"python"`)
- `segmentText` (string; the segment’s extracted content that is actually parsed/chunked)

### 3.2 Normalization function: `normalizeForUid(text)`
This function MUST be applied before hashing any text:
1. Convert `\r\n` → `\n`
2. Convert remaining `\r` → `\n`
3. Do not trim, reindent, or otherwise modify content.

### 3.3 Hash function
Use existing project hash:
- `checksumString(normalizedText)` from `src/shared/hash.js` (xxh64)

### 3.4 Construction
Compute:
- `segBody = normalizeForUid(segmentText)`
- `segKey = "seg\0" + (segment.type || "") + "\0" + (segment.languageId || "") + "\0" + segBody`
- `segHash = checksumString(segKey)`
- `segmentUid = "segu:v1:" + segHash`

### 3.5 Collision handling
If two segments produce identical `segmentUid`:
- This is allowed (identical segment content).
- Segment-level identity collisions are acceptable because `chunkUid` adds file/virtualPath context.

---

## 4. `chunkUid` algorithm (normative)

### 4.1 Inputs
For each chunk (definition: the unit emitted by the chunker):
- `namespaceKey`: constant string (default `"repo"` for single-repo builds)
- `virtualPath`: from §2.1
- `fileText`: the full decoded file text (string)
- `startOffset`, `endOffset`: the chunk span offsets in `fileText`
- `segment.languageId` if present (optional salt)

### 4.2 Context window parameters (defaults)
- `PRE_CONTEXT_CHARS = 128`
- `POST_CONTEXT_CHARS = 128`

Escalation parameters for collision disambiguation:
- `ESCALATION_CONTEXT_CHARS = 1024`
- `MAX_COLLISION_PASSES = 2` (base + one escalation; ordinal fallback after)

All constants MUST be centralized in one module (recommended: `src/index/identity/chunk-uid.js`).

### 4.3 Span extraction
- `spanRaw = fileText.slice(startOffset, endOffset)`
- `span = normalizeForUid(spanRaw)`

### 4.4 Pre/Post extraction
Pre:
- `preRaw = fileText.slice(max(0, startOffset - PRE_CONTEXT_CHARS), startOffset)`
- `pre = normalizeForUid(preRaw)`

Post:
- `postRaw = fileText.slice(endOffset, min(fileText.length, endOffset + POST_CONTEXT_CHARS))`
- `post = normalizeForUid(postRaw)`

### 4.5 Per-component hashing
Compute:
- `spanHash = checksumString("span\0" + span)`
- `preHash  = checksumString("pre\0" + pre)`   (only if `pre.length > 0`)
- `postHash = checksumString("post\0" + post)` (only if `post.length > 0`)

### 4.6 Base chunkUid construction
Let:
- `langSalt = chunk.segment?.languageId || null` (optional but recommended; see note below)

Base string:
- `base = "ck64:v1:" + namespaceKey + ":" + virtualPath + ":" + spanHash`
- If `langSalt` is present, insert `":" + langSalt` between `virtualPath` and `spanHash`.

Then:
- If `preHash` exists, append `":" + preHash`
- If `postHash` exists, append `":" + postHash`

Result:
- `chunkUid = base`

**Why include `langSalt`?**  
In embedded contexts (e.g., README code fences), identical spans in different segment languages should not collapse.

---

## 5. Collision detection & deterministic disambiguation (normative)

### 5.1 Collision definition
A collision exists if **two or more distinct chunks** in the same build produce the same `chunkUid`.

### 5.2 Required behavior
- The build MUST NOT silently accept collisions.
- The builder MUST deterministically disambiguate colliding chunks such that:
  - all chunks end up with unique `chunkUid`
  - re-running the build yields identical `chunkUid` assignments

### 5.3 Disambiguation algorithm (deterministic)
**Pass 1** (base):
1. Compute `chunkUid` using defaults (§4.2).

If collisions exist, for each collision group:

**Pass 2** (context escalation):
2. Recompute only colliding chunks using:
   - `PRE_CONTEXT_CHARS = ESCALATION_CONTEXT_CHARS`
   - `POST_CONTEXT_CHARS = ESCALATION_CONTEXT_CHARS`
3. If collision resolves, accept.

If collisions still exist after escalation:

**Pass 3** (ordinal suffix):
4. Sort colliding chunks by a stable ordering:
   - primary: `fileRelPath` (posix string)
   - then: `segmentUid` (or empty string)
   - then: `startOffset` ascending
   - then: `endOffset` ascending
   - then: `chunk.kind` lexicographically
   - then: `chunk.name` lexicographically
5. Assign ordinals starting at 1 in that sorted order.
6. Final `chunkUid = base + ":ord" + ordinal`

Notes:
- The ordinal suffix MUST be applied only when needed.
- The sort order MUST NOT include `docId` (not stable across builds).

### 5.4 Collision metrics
The index build MUST record:
- number of collisions encountered
- number resolved in pass 2 vs pass 3
- maximum collision group size
- files involved

---

## 6. Storage contract (normative)

### 6.1 Chunk payload
The chunk payload MUST include:
- `chunk.chunkUid` (top-level, convenience)
- `chunk.metaV2.chunkUid` (canonical)

For segment chunks, meta MUST also include:
- `chunk.segment.segmentUid`
- `chunk.metaV2.segment.segmentUid`

### 6.2 Artifact contract
`chunk_meta` JSONL MUST include the above fields via metaV2; strict validation MUST fail if missing.

---

## 7. Code touchpoints (implementation checklist)

This spec is intended to map cleanly onto existing code:

### 7.1 New module
- Add `src/index/identity/chunk-uid.js` exporting:
  - `normalizeForUid(text)`
  - `computeSegmentUid({segmentText, segmentType, languageId})`
  - `computeChunkUid({namespaceKey, virtualPath, fileText, startOffset, endOffset, langSalt})`
  - `dedupeChunkUids(chunks, fileTextByRelPath)` (collision disambiguation)

### 7.2 Where to compute `segmentUid`
- Compute `segmentUid` **while the full container text is available** (segment text is required).
  - **Recommended touchpoint (current repo):** `src/index/build/file-processor/cpu.js` immediately after `discoverSegments(text, ...)`.
  - Implementation sketch:
    - `segmentText = text.slice(segment.start, segment.end)`
    - `segmentUid = computeSegmentUid({ namespaceKey, containerRelPath, segmentType, languageId, segmentText })`
- Plumb `segmentUid` (and derived `virtualPath`) onto each segment object so `chunkSegments()` can carry it into `chunk.segment`.

### 7.3 Where to compute `chunkUid`
- Compute `chunkUid` **during chunk payload assembly**, where `chunkText`, `preContext`, and `postContext` already exist.
  - **Recommended touchpoint (current repo):** `src/index/build/file-processor/process-chunks.js` in the per-chunk loop, immediately before `buildChunkPayload(...)`.
  - Attach `chunkUid` to the chunk record/payload so it flows into `metaV2` and all emitted artifacts.

### 7.4 Cache path
- The incremental cache hydrate path does not reliably have the full container text required to recompute segmentUid/chunkUid.
- Recommended strategy (conservative and deterministic):
  - If cached chunks are missing `segmentUid`, `virtualPath`, or `chunkUid`, treat as a **cache miss** and reprocess the file normally.
  - (Optional) If the full container text *is* available at hydrate time, recompute may be used, but the default should be cache-miss fallback.

### 7.5 Meta builder + validation
- Update `src/index/metadata-v2.js` to include:
  - `chunkUid`
  - `segment.segmentUid` and `segment.virtualPath` when present
- Strict validation:
  - Implement a strict-mode check in `src/index/validate/checks.js` (invoked by `src/index/validate.js`) that fails if any chunk is missing `chunkUid` or segment identity fields.

---

## 8. Test fixtures (minimum)

1. **Line-shift resilience**
   - baseline file with 2 chunks; build chunkUid
   - insert 10 lines at top; rebuild
   - assert chunkUid unchanged for existing chunks

2. **Segment safety**
   - markdown file with two code fences containing same function text
   - ensure `segmentUid` differs only if segment content differs; if identical, `chunkUid` disambiguation MUST produce stable ordinals

3. **Deterministic collision disambiguation**
   - duplicate identical chunks in same file
   - ensure deterministic `:ordN` assignment persists under unrelated edits above both chunks

---

## 9. Acceptance criteria

This spec is “done” when:
- no code path uses `file::name` as a unique join key
- every chunk has `metaV2.chunkUid`
- graph construction and symbol artifacts prefer `chunkUid` over `chunkId`
- strict validation fails on missing chunkUid
