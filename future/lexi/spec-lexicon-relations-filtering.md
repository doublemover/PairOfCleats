# Spec -- Lexicon-Aware Relations Filtering

Status: **Proposed**  
Owner: Index Build  
Last Updated: 2026-01-30

---

## Summary

This spec defines a **post-extraction**, **pre-indexing** filtering layer for `rawRelations` outputs produced by language relation extractors.

The intent is to remove obvious, lexicon-validated noise from:

- `rawRelations.usages`
- `rawRelations.calls`
- `rawRelations.callDetails`
- `rawRelations.callDetailsWithRange`

This improves:

- `file_relations.json` signal quality (`usages`)
- chunk-level `codeRelations.calls` accuracy used by `search --calls`
- downstream call-site artifacts (Phase 10+ risk flows, graph building, etc.)

### Hard constraint

This filtering **must not** reduce general lexical search recall because:

- It affects relations metadata only, not BM25 token postings.
- It is conservative by default and fail-open.

---

## Where It Runs

The filtering runs in:

- `src/index/build/file-processor/cpu.js`

Immediately after:

- `rawRelations = lang.buildRelations(...)`

and immediately before:

- `buildFileRelations(rawRelations, relKey)`
- `buildCallIndex(rawRelations)`

---

## Inputs and Outputs

### Input: `rawRelations`

A language-specific object that may include:

- `imports: string[]`
- `exports: string[]`
- `calls: Array<[callerName: string, calleeName: string]>`
- `usages: string[]`
- `callDetails: Array<{ caller, callee, kind, line, col, calleeNormalized, receiver, ... }>`
- `callDetailsWithRange: Array<{ caller, callee, kind, line, col, range, ... }>`

Not all languages populate all fields.

### Output: `filteredRelations`

Same shape as `rawRelations`, with filtered arrays. All keys not touched must be preserved.

---

## Lexicon Dependency

The filter consumes per-language lexicon stopwords in the **relations** domain:

- `lexicon.stopwords.relations`

Default derivation for v1:

- `keywords ∪ literals`

Builtins and types are *not* stopwords for relations by default.

---

## Filtering Rules

### Rule 0: Fail-open

If any of these are true:

- lexicon is disabled
- lexicon for the language cannot be loaded
- rawRelations is null/invalid

Then return `rawRelations` unchanged.

### Rule 1: `usages`

Input: `rawRelations.usages: string[]`

Steps:

1. If not an array -> do nothing.
2. Normalize each token for comparison:
   - `tNorm = String(t).trim().toLowerCase()`
3. Drop any entry if:
   - `tNorm` is empty
   - `tNorm` is in `lexicon.stopwords.relations`
4. Preserve original casing in the returned list (optional), but prefer to keep original strings from extraction.
5. Preserve stable order.
6. Optional: stable de-dupe (keep first occurrence).

### Rule 2: `calls`

Input: `rawRelations.calls: Array<[caller, callee]>`

Steps:

1. If not an array -> do nothing.
2. For each `[caller, callee]`:
   - Normalize `calleeBase = extractSymbolBaseName(callee)` (see below)
   - Compare `calleeBaseNorm = calleeBase.toLowerCase()`
3. Drop the call if:
   - `calleeBaseNorm` is empty
   - `calleeBaseNorm` in `lexicon.stopwords.relations`
4. Preserve stable order.
5. Optional: stable de-dupe on tuple `(caller, callee)`.

### Rule 3: `callDetails` and `callDetailsWithRange`

Input: arrays of objects with at least `{ caller, callee }`.

Steps:

1. If not array -> do nothing.
2. For each entry:
   - `calleeBase = extractSymbolBaseName(entry.callee)`
   - Drop if base is empty or in stopwords (same as Rule 2).
3. Preserve stable order.
4. Do not mutate unrelated fields (range, line, receiver, etc.).

---

## `extractSymbolBaseName` Contract

Because call names can include member separators across languages, we define a shared normalization:

Given `name: string`, return the “base symbol” likely to be the callable identifier.

Split on separators, take the last non-empty segment:

- `.`
- `::`
- `->`
- `#` (optional)
- `/` (optional; for some module-like contexts)

Then trim again and remove trailing punctuation:

- `()` (if present)
- `;`, `,`

Examples:

- `"foo.bar"` -> `"bar"`
- `"Foo::new"` -> `"new"`
- `"obj->method"` -> `"method"`
- `"console.log"` -> `"log"`

This function is shared by:
- build-time filtering
- retrieval-time relation boost

---

## Configuration

All knobs are **internal** and wired through `languageOptions.lexicon` (build runtime).

Recommended default (safe):

```js
languageOptions.lexicon = {
  enabled: true,
  relations: {
    enabled: true,
    drop: {
      keywords: true,
      literals: true,
      builtins: false,
      types: false
    }
  }
}
```

Future extension (not required for v1):
- Allow dropping builtins/types for relations if desired for very noisy languages.

---

## Logging / Metrics (Recommended)

Emit structured counters per file:

- `lexicon.relations.filtered language=<id> file=<relKey> callsDropped=<n> usagesDropped=<n>`

If a structured metrics collector exists, also emit:

- per-language totals
- per-category totals

This is crucial to validate that filtering is conservative and not overzealous.

---

## Test Plan

### Unit: rules correctness

Test file: `tests/file-processor/lexicon-relations-filter.test.js`

Cases:

- `usages` drops `if`, `return`, `true` when they exist and are listed as keywords/literals.
- `calls` drops calls where callee base is `if` / `null` etc.
- Does not drop builtins (`print`, `console`, `len`) by default.
- Stable ordering preserved.

### Integration: retrieval filters improve

Test file: `tests/retrieval/uses-and-calls-filters-respect-lexicon.test.js`

Using `tests/fixtures/languages` index:

- `--calls return` yields 0.
- `--uses if` yields 0.
- `--calls print` yields >0 (since builtins are not dropped by default).

---

## Compatibility Notes

- This spec does not require modifying language-specific relation extractors.
- Filtering only affects relation metadata, not token postings, so it cannot reduce the ability to find content via normal search terms.
- `--calls` / `--uses` behavior may improve by removing nonsense; it should not regress common use cases because builtins/types are not dropped by default.

