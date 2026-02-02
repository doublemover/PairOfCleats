# Spec -- Lexicon-Aware Relation Boosts

Status: **Proposed**  
Owner: Retrieval  
Last Updated: 2026-01-30

---

## Summary

This spec defines an **optional, boost-only** retrieval ranking signal that uses code relations and per-language lexicons to improve ordering without harming recall.

The boost uses:

- `chunk.codeRelations.calls` (per chunk)
- `chunk.codeRelations.usages` OR file-level `file_relations.usages`

And excludes lexicon stopwords so we do not boost on boilerplate tokens (keywords, literals, primitive types, ubiquitous builtins).

---

## Scope

### In scope

- Add a new scoring component: `relationBoost`
- Add explain output when `--explain` is enabled
- Gate behavior behind `quality=max` or an explicit config (default off)

### Out of scope

- Filtering results (must be boost-only)
- Graph-based ranking (Phase 11.4)
- Cross-file expansion

---

## Inputs

Per query:

- `queryTokens: string[]`  
  From `buildQueryPlan(...)` in `src/retrieval/cli/query-plan.js`.

Per hit:

- `chunk.lang: string | null`
- `chunk.codeRelations.calls: Array<[caller: string, callee: string]> | null`
- `chunk.codeRelations.usages: string[] | null`
- `fileRelations.usages: string[] | null` (fallback)

Per lexicon:

- `lexicon.isStopword(langId, token, domain='ranking')`

---

## Derived Sets

### Signal tokens

For a hit with language `L`:

```
signalTokens = unique(queryTokens)
  .map(lowercase if caseTokens is false; otherwise preserve)
  .filter(t => t.length > 0)
  .filter(t => !lexicon.isStopword(L, t, 'ranking'))
```

Notes:

- Use the *hit’s language* as the lexicon context; a query does not always specify language.
- This is intentionally per-hit to avoid global stopword unions that can over-filter.

### Call base set

If `chunk.codeRelations.calls` exists:

```
callBaseSet = new Set(
  calls.map(([caller, callee]) => extractSymbolBaseName(callee)).filter(Boolean).map(lowercase)
)
```

### Usage set

Prefer chunk-level if present:

- `usageSet = new Set(chunk.codeRelations.usages.map(lowercase))`

Else fall back:

- `usageSet = new Set(fileRelations.usages.map(lowercase))`

---

## Matching

Compute:

- `callMatches = count(signalTokens ∩ callBaseSet)`
- `usageMatches = count(signalTokens ∩ usageSet)`

Optionally track which tokens matched (bounded to max 10).

---

## Scoring

The boost is bounded and additive:

```
boost = min(maxBoost, callMatches * perCall + usageMatches * perUse)
```

Recommended defaults (tunable):

- `perCall = 0.25`
- `perUse  = 0.10`
- `maxBoost = 1.50`

The boost must be small relative to BM25 score so it reorders ties and near-ties rather than dominating.

---

## Explain Output

When `argv.explain` is enabled, attach:

```json
{
  "relationBoost": {
    "enabled": true,
    "lang": "typescript",
    "signalTokens": ["baz", "qux"],
    "callMatches": 1,
    "usageMatches": 1,
    "matchedTokens": ["baz"],
    "boost": 0.35
  }
}
```

Constraints:

- Truncate `signalTokens` to max 20 in explain.
- Truncate `matchedTokens` to max 10.

---

## Gating / Configuration

Default: **off**.

Enable only when either:

- `analysisPolicy.quality.value === 'max'`
- OR an internal config flag is set (avoid new CLI surface in v1).

Configuration structure (internal):

```js
relationBoost: {
  enabled: boolean,
  perCall: number,
  perUse: number,
  maxBoost: number
}
```

---

## Determinism Requirements

- Given the same index and query, boost must be deterministic:
  - stable iteration order is irrelevant because only counts matter
  - matched token lists in explain must be deterministically truncated:
    - sort tokens lexicographically before truncation **or**
    - preserve query order (recommended: preserve query order)

---

## Test Plan

### Unit tests

File: `tests/retrieval/relation-boost.test.js`

- Should:
  - compute correct counts
  - ignore stopwords for ranking
  - be bounded by `maxBoost`

### Integration tests

File: `tests/retrieval/relation-boost-does-not-filter.test.js`

- Prove hit count unchanged when boost is enabled.

Optional:

- A small fixture index query that demonstrates reordering.

---

## Failure Modes / Mitigations

- Missing lexicon -> treat as no stopwords (or `_generic`) and proceed.
- Missing relations fields -> boost=0.
- Large query token lists -> clamp explain lists; scoring uses sets and remains bounded.

