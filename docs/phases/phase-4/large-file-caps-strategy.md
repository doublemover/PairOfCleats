# Spec: Large-file Strategy and Cap Correctness (Phase 4.7)

Date: 2026-01-25  
Repo reviewed: `PairOfCleats-main (39).zip`

## 0. Goals

Phase 4.7 is about making "large file" behavior **bounded, deterministic, and user-visible**, while ensuring that **cap resolution is consistent** anywhere we make skip/reuse decisions (pre-read skip, cached-bundle reuse, watchers, and discovery).

Concrete goals:

1. **Bounded behavior:** the system must never accidentally "run away" on giant files/projects (memory spikes, multi-minute stalls, etc.).
2. **User-visible behavior:** when we skip, we must record *why* (reason) and *which cap* caused it (bytes/lines + max values).
3. **Cap correctness:** resolve file caps using the **best available hints**:
   * extension (`ext`)
   * language id (`languageId`) when known
   * mode (`mode`) when mode-specific caps exist
4. **Cache safety:** cached-bundle reuse must enforce the same caps as live processing so we do not "resurrect" files/chunks that should be excluded.
5. **Defense in depth:** "untrusted" guardrails (from `runtime/caps.js`) must remain hard to bypass.

## 1. Non-goals

* Implementing "partial indexing/truncation metadata" is **out of scope** for Phase 4.7 unless the contract is explicitly extended. The default strategy in this spec is **skip**.
* Changing tokenization/chunking heuristics is out of scope (caps only).
* Replacing the discovery pipeline is out of scope; we only make targeted cap-resolution fixes and defense-in-depth improvements.

## 2. Current Code Map (as of zip 39)

### 2.1 Existing cap definition and normalization
* `src/index/build/runtime/caps.js`
  * `resolveFileCapsAndGuardrails()` produces:
    * `maxFileBytes` (global cap; default 5 MiB, further clamped by untrusted guardrails)
    * `fileCaps` object (normalized caps by default/ext/language)

### 2.2 Existing cap resolution helper
* `src/index/build/file-processor/read.js`
  * `resolveFileCaps(fileCaps, ext, languageId = null)` already supports **byLanguage** and **byExt**, selecting the strictest (`min`) of applicable limits.

### 2.3 Known incorrect / inconsistent call sites
* Pre-read skip uses **extension only**:
  * `src/index/build/file-processor/skip.js` calls `resolveFileCaps(fileCaps, ext)` (does not pass `languageId` or `mode`).
  * Call site `src/index/build/file-processor.js` has `fileLanguageId` available but does not thread it into `resolvePreReadSkip`.
* Cached-bundle reuse uses **extension only**:
  * `src/index/build/file-processor/cached-bundle.js` calls `resolveFileCaps(fileCaps, ext)` (ignores `fileLanguageId` that it receives).
* Discovery + watch cap resolution uses **extension only**:
  * `src/index/build/discover.js` (internal `resolveMaxBytesForExt()`)
  * `src/index/build/watch.js` (internal `resolveMaxBytesForExt()`)

### 2.4 CPU processing already uses language-aware caps
* `src/index/build/file-processor/cpu.js` uses `resolveFileCaps(fileCaps, ext, lang.id)` correctly.

## 3. Strategy Decision: Skip (No Truncation)

**Decision:** For Phase 4.7, the strategy for oversized files is **skip with explicit metadata**.

Rationale:
* Truncation creates subtle correctness problems (partial imports, incomplete symbol lists, misleading "coverage").
* Truncation requires an explicit output contract (metadata about truncation, downstream behavior) that is not yet defined.
* Skipping is deterministic, safe, and easy to reason about.

### 3.1 Skip metadata (contract)
Whenever an oversize skip happens, record:

* `reason: "oversize"`
* `bytes` and `maxBytes` (when maxBytes is the trigger)
* `lines` and `maxLines` (when maxLines is the trigger)
* `capSource` (optional but recommended): `"maxBytes" | "maxLines"`
* `stage` (recommended): `"discover" | "watch" | "pre-read" | "cached-reuse" | "cpu"`

This metadata must be appended to the existing `skippedFiles` arrays already used throughout the index build pipeline.

## 4. Cap Resolution Semantics (Best-Version)

### 4.1 Canonical resolver API

Define a single canonical resolver:

```js
resolveFileCaps(fileCaps, ext, languageId = null, mode = null) -> {
  maxBytes: number|null,
  maxLines: number|null
}
```

Where:
* `ext` is a normalized extension (e.g., `.js`) or empty string.
* `languageId` is the normalized language id (e.g., `javascript`) or null.
* `mode` is one of: `'code' | 'prose' | 'extracted-prose' | 'records'` (or null).

### 4.2 Semantics
* Start with a **mode default override** if present, else use `fileCaps.default`.
* Apply **extension caps** (`fileCaps.byExt[ext]`) and **language caps** (`fileCaps.byLanguage[languageId]`).
* For each cap dimension (`maxBytes`, `maxLines`), take the **minimum** of all applicable limits.

This preserves the "hard to bypass guardrails" property (more specific caps can only tighten), while still allowing mode-specific defaults (see below) to prevent accidental over-strictness when modes are intended to differ.

### 4.3 Optional: mode-specific default caps (`fileCaps.byMode`)
To support the roadmap requirement "mode-aware where applicable", add an optional structure:

```json
"fileCaps": {
  "default": { "maxBytes": 5242880, "maxLines": 20000 },
  "byMode": {
    "code":  { "maxBytes": 5242880, "maxLines": 20000 },
    "prose": { "maxBytes": 10485760, "maxLines": 50000 }
  },
  "byExt": { ".js": { "maxBytes": 2000000 } },
  "byLanguage": { "javascript": { "maxLines": 15000 } }
}
```

Resolution rule:
* `baseDefault = fileCaps.byMode[mode] ?? fileCaps.default`
* `effective = min(baseDefault, byExt, byLanguage)`

Important:
* `byMode` is a **default override**, not a separate "tightening cap", so it may be more permissive than `default`.
* Untrusted guardrails (in `runtime/caps.js`) must still clamp any permissive values.

### 4.4 Defense-in-depth: include `maxFileBytes` in file processor caps
Even though discovery/watch already enforce `maxFileBytes`, file processing should enforce it again to prevent bypass when processing entry sets that did not originate from discovery.

Implement:
* Thread `runtime.maxFileBytes` into `createFileProcessor({ maxFileBytes })`.
* In pre-read skip + cached-bundle reuse, compute:
  * `effectiveMaxBytes = min(maxFileBytes, resolvedCaps.maxBytes)` (ignoring nulls)

## 5. Implementation Plan (File-by-file)

### 5.1 `src/index/build/runtime/caps.js`
1. Extend `normalizeCaps()` to recognize optional `fileCaps.byMode`:
   * keys: `code`, `prose`, `extracted-prose`, `records`
   * values: normalize with the existing `normalizeCapEntry()` helper.
2. Ensure untrusted guardrails still clamp *all* relevant byte caps:
   * If `untrusted.maxFileBytes` is set, clamp `maxFileBytes` and also clamp:
     * `fileCaps.default.maxBytes`
     * `fileCaps.byMode[mode].maxBytes` (for each mode)
     * any future caps field that can exceed guardrails

### 5.2 `src/index/build/file-processor/read.js`
1. Update `resolveFileCaps()` to accept `mode` as an optional 4th parameter.
2. Implement mode-default selection:
   * `const modeCaps = mode && fileCaps?.byMode?.[mode] ? fileCaps.byMode[mode] : null;`
   * `const baseDefaultCaps = modeCaps || fileCaps?.default || {};`
3. Continue applying strictest-min behavior across base default, ext, language.

### 5.3 `src/index/build/file-processor/skip.js`
1. Update `resolvePreReadSkip()` signature to accept:
   * `languageId` (optional)
   * `mode` (optional)
   * `maxFileBytes` (optional)
2. Resolve caps via:
   * `const caps = resolveFileCaps(fileCaps, ext, languageId, mode);`
   * `const effectiveMaxBytes = pickMinLimit(maxFileBytes, caps.maxBytes);`
3. Use `effectiveMaxBytes` for the size check; include both values in skip metadata.
4. Use `caps.maxLines` for line-cap checks, but ensure the skip record includes:
   * `lines`, `maxLines`, and `stage: 'pre-read'`.

### 5.4 `src/index/build/file-processor.js`
1. Add `maxFileBytes` to `createFileProcessor(options)` destructuring.
2. When calling `resolvePreReadSkip(...)`, pass:
   * `languageId: fileLanguageId`
   * `mode`
   * `maxFileBytes`
3. When calling `reuseCachedBundle(...)`, pass `fileLanguageId`, `mode`, and `maxFileBytes`.

### 5.5 `src/index/build/file-processor/cached-bundle.js`
1. Update `reuseCachedBundle()` to use:
   * `resolveFileCaps(fileCaps, ext, fileLanguageId, mode)`
2. Apply `effectiveMaxBytes = min(maxFileBytes, caps.maxBytes)` before comparing to `fileStat.size`.
3. When skipping due to caps, return a skip record with:
   * `reason: 'oversize'`
   * `stage: 'cached-reuse'`
   * `bytes/maxBytes` and/or `lines/maxLines` depending on trigger.
4. Preserve `hashAlgo` behavior:
   * Keep `resolvedHashAlgo = fileHashAlgo || cachedEntry.hashAlgo`
   * Ensure `fileHashAlgo` is not hardcoded in new paths.

### 5.6 `src/index/build/watch.js` (recommended hardening)
1. Replace the local `resolveMaxBytesForExt()` logic with calls to the canonical `resolveFileCaps()`:
   * compute `languageId = getLanguageForFile(ext, relKey)?.id ?? null` where available.
2. Use `effectiveMaxBytes = min(runtime.maxFileBytes, caps.maxBytes)` for skip decisions.
3. Ensure skip records for watch include `stage: 'watch'`.

### 5.7 `src/index/build/discover.js` (recommended hardening)
1. Extend `resolveMaxBytesForExt()` to also consider `language.id`:
   * Use `resolveFileCaps(fileCaps, ext, language?.id ?? null, null)` and then min with `maxFileBytes`.
2. **Do not** apply `byMode` at discovery time (discovery is mode-agnostic). Mode-specific caps should be enforced at pre-read/cpu stages to avoid "wrong-mode strictness".

## 6. Tests / Verification

### 6.1 Required tests (as per roadmap)
1. `tests/file-caps/pre-read-skip-respects-language.test.js`
   * Configure `fileCaps.byLanguage.javascript.maxBytes = 1`.
   * Create a `.js` file of size > 1 byte.
   * Ensure `resolvePreReadSkip(...)` returns `reason='oversize'` and includes `maxBytes=1`.
   * This test must fail on the current ext-only implementation and pass once `languageId` is threaded.

2. `tests/file-caps/cached-bundle-respects-caps.test.js`
   * Construct a cached bundle where `maxLine > cap`.
   * Set `fileCaps.byLanguage.<lang>.maxLines` small enough to force a skip.
   * Ensure `reuseCachedBundle(...)` returns `{result:null, skip:{reason:'oversize', stage:'cached-reuse', ...}}`.

3. `tests/file-caps/doc-mode-large-markdown-not-skipped.test.js` (**only if `byMode` is implemented**)
   * Set `fileCaps.default.maxBytes` small.
   * Set `fileCaps.byMode.prose.maxBytes` large.
   * Ensure that in prose mode, the same markdown file is **not** skipped.

### 6.2 Additional recommended tests (defense-in-depth)
4. `tests/file-caps/pre-read-skip-respects-maxfilebytes.test.js`
   * Pass `maxFileBytes` smaller than any fileCaps cap; ensure skip uses the smaller max.
5. `tests/watch/watch-maxbytes-respects-language.test.js` (if watch is hardened)
6. `tests/discover/discover-maxbytes-respects-language.test.js` (if discover is hardened)

## 7. Compatibility and Performance Notes

* Cap resolution is O(1) per file (map lookups + min).
* Threading `languageId` is already done in `file-processor.js` (via `getLanguageForFile`), so no additional IO is introduced.
* Mode-specific caps (`byMode`) are optional and backward compatible; absence yields existing behavior.

## 8. Future Phase Alignment

* Phase 9/19 scaling work benefits from deterministic, bounded skipping.
* If truncation/partial indexing is desired later, it must be introduced as a new explicit contract with downstream-aware metadata (not silently added here).
