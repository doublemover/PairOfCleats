# Search CLI Contract (0.0.2)

This document defines the CLI interface and output contract for **search**.

- Command script: `search.js`
- CLI entrypoint: `pairofcleats search` (wrapper around `search.js`)

> Phase 11 adds **opt-in graph ranking** (ordering only; membership invariant) and may add a hardened **context expansion** mode. These features MUST NOT change default behavior unless enabled.

## Inputs

### Required
- Query string: last positional argument, e.g.
  - `search.js "how does risk explain work"`

### Common flags
- `--repo <path>`: repo root (defaults to current directory)
- `--mode code|prose|extracted-prose|records|both|all`: search mode
- `--top <n>` (alias: `-n`): number of results
- `--json`: emit JSON output
- `--compact`: compact JSON output
- `--stats`: include stats payload
- `--explain` / `--why`: include score explanation payload
- `--matched`: include matched query tokens in text output
- `--filter "<expr>"`: filter expression for file/lang/ext/type (see below)

### Filter flags
- `--file`, `--path`, `--lang`, `--ext`, `--type`
- `--case`, `--case-file`, `--case-tokens`
- `--author`, `--chunk-author`, `--import`, `--signature`, `--param`, `--inferred-type`, `--return-type`
- `--calls`, `--uses`, `--decorator`, `--throws`, `--reads`, `--writes`, `--mutates`, `--alias`, `--lint`, `--awaits`, `--visibility`, `--extends`, `--async`, `--generator`, `--returns`
- `--risk`, `--risk-tag`, `--risk-source`, `--risk-sink`, `--risk-category`, `--risk-flow`
- `--struct-pack`, `--struct-rule`, `--struct-tag`
- `--meta <key[=value]>` (repeatable), `--meta-json <json>`
- `--modified-after <iso-date>`, `--modified-since <days>`, `--churn <spec>`, `--branch <name>`
- `--branches`, `--loops`, `--breaks`, `--continues`

### Backend + ranking flags
- `--backend auto|sqlite|sqlite-fts|lmdb|memory|tantivy` (alias: `fts`)
- `--ann` / `--no-ann`
- `--ann-backend auto|lancedb|sqlite|hnsw|js`
- `--dense-vector-mode merged|code|doc|auto`
- `--graph-ranking-max-work <n>`, `--graph-ranking-max-ms <n>`
- `--graph-ranking-seeds top1|topK|none`, `--graph-ranking-seed-k <n>`
- `--bm25-k1 <n>`, `--bm25-b <n>`
- `--fts-profile <profile>`
- `--fts-weights <json|list>`
- `--model <id>`
- `--stub-embeddings`
- `--comments` / `--no-comments`
- `--non-strict` (allow legacy artifact fallback when manifests are missing)

### `--filter` expression
`--filter` accepts space- or comma-separated tokens. Supported keys are `file`/`path`, `lang`, `ext`, and `type`/`kind`.
Tokens without a key are treated as file/path filters. Unknown keys are rejected. `--filter` merges with the explicit filter flags above (ANDed).

## Outputs

### Text mode
Human readable results (ranked list). Exact formatting may evolve.

### JSON mode
The JSON output is intended to be machine-readable and stable. At minimum:
- `ok` (boolean)
- `query` (string)
- `results[]` (ranked hits)
- optional `explain` sections if enabled

> See `docs/contracts/search-contract.md` for semantic details. Phase 11 extends the explain payload with a graph ranking section when enabled.

## Phase 11 extensions to search

### A) Graph-aware ranking (opt-in)

Graph ranking is enabled via config (`retrieval.graphRanking.enabled`). The CLI only provides overrides:
- `--graph-ranking-max-work <n>` (work-unit cap)
- `--graph-ranking-max-ms <n>` (optional wall-clock fuse)
- `--graph-ranking-seeds top1|topK|none` (default: `top1`)
- `--graph-ranking-seed-k <n>` (only used for `topK`)

Config mapping (normative):
- `retrieval.graphRanking.enabled` (boolean)
- `retrieval.graphRanking.weights` (object; `degree`, `proximity`)
- `--graph-ranking-max-work` -> `retrieval.graphRanking.maxGraphWorkUnits`
- `--graph-ranking-max-ms` -> `retrieval.graphRanking.maxWallClockMs`
- `--graph-ranking-seeds` -> `retrieval.graphRanking.seedSelection`
- `--graph-ranking-seed-k` -> `retrieval.graphRanking.seedK`

#### Membership invariant (required)
When graph ranking is enabled:
1. Search MUST compute the baseline result set (the returned `topN`) without graph features.
2. Graph ranking may reorder *only* those results.
3. The returned result membership MUST be identical with graph ranking off/on.

#### Explain payload changes
When `--explain` is enabled and graph ranking is enabled, each hit SHOULD include:

```json
{
  "scoreBreakdown": {
    "baseline": { "...": "existing fields" },
    "graph": {
      "score": 0.123,
      "degree": 8,
      "proximity": 0.5,
      "weights": { "degree": 0.1, "proximity": 0.4 },
      "seedSelection": "top1",
      "seedK": null
    }
  }
}
```

### B) Context expansion (optional; separate from graph ranking)

Phase 11 hardens `src/retrieval/context-expansion.js` to be safe on worst-case repos and to prefer identity-first joins when graph artifacts exist.

Context expansion is config-driven (no CLI flags). When enabled via `retrieval.contextExpansion.*`, it MUST:
- be opt-in (default off),
- be bounded by explicit caps (`maxPerHit`, `maxTotal`, per-source caps, `maxWorkUnits`),
- record truncation metadata when caps trigger, and
- remain deterministic.

## Notes on the `pairofcleats` wrapper

`bin/pairofcleats.js` must not enforce a stale flag allowlist for `search`. The wrapper MUST accept all documented search flags and delegate parsing/validation to `search.js`.
