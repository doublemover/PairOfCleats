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
- `--mode code|prose|both|records|auto`: search mode
- `--top <n>`: number of results
- `--json`: emit JSON output
- `--compact`: compact JSON output
- `--explain`: include score explanation payload
- `--filter <path>`: filter by file path substring (and related filter flags documented elsewhere)

## Outputs

### Text mode
Human readable results (ranked list). Exact formatting may evolve.

### JSON mode
The JSON output is intended to be machine-readable and stable. At minimum:
- `ok` (boolean)
- `query` (string)
- `results[]` (ranked hits)
- optional `explain` sections if enabled

> See `docs/contracts/search-cli.md` in-repo for non-Phase‑11 details. Phase 11 extends the explain payload with a graph ranking section when enabled.

## Phase 11 extensions to search

### A) Graph-aware ranking (opt-in)

#### Flags (proposed contract)
- `--graph-ranking` (boolean; default false)
  - Enables graph-aware ranking features.
  - **Must not change membership**; only ordering within baseline selection.
- `--graph-ranking-weights <json>`
  - JSON object of weights, e.g. `{"degreeIn":0.1,"proximityToSeeds":0.4}`.
- `--graph-ranking-max-work <n>`
  - Deterministic work-unit cap for per-query graph feature computation.
- `--graph-ranking-max-ms <n>` (optional fuse)
  - Wall-clock fuse; may reduce determinism if it triggers (must be reported).
- `--graph-ranking-seeds top1|topK|none` (default: `top1`)
- `--graph-ranking-seed-k <n>` (only used for `topK`)

Config mapping (normative):
- `--graph-ranking-max-work` -> `retrieval.graphRanking.maxGraphWorkUnits`
- `--graph-ranking-max-ms` -> `retrieval.graphRanking.maxWallClockMs`
- `--graph-ranking-seeds` -> `retrieval.graphRanking.seedSelection`
- `--graph-ranking-seed-k` -> `retrieval.graphRanking.seedK`

#### Membership invariant (required)
When `--graph-ranking` is enabled:
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
      "enabled": true,
      "delta": 0.123,
      "features": {
        "degreeIn": 3,
        "degreeOut": 5,
        "proximityToSeeds": 0.5
      },
      "truncated": false,
      "truncation": []
    }
  }
}
```

### B) Context expansion (optional; separate from graph ranking)

Phase 11 hardens `src/retrieval/context-expansion.js` to be safe on worst-case repos and to prefer identity-first joins when graph artifacts exist.

If a search-time context expansion mode is exposed, it MUST:
- be opt-in (default off),
- be bounded by explicit caps (`maxPerHit`, `maxTotal`, per-source caps, maxWorkUnits),
- record truncation metadata when caps trigger, and
- remain deterministic.

Recommended flag contract (if enabled):
- `--context-expansion` (boolean)
- `--context-expansion-max-per-hit <n>`
- `--context-expansion-max-total <n>`
- `--context-expansion-max-work <n>`
- `--context-expansion-explain` (include reasons, bounded)

## Notes on the `pairofcleats` wrapper

`bin/pairofcleats.js` must not enforce a stale flag allowlist for `search`. The wrapper MUST accept all documented search flags and delegate parsing/validation to `search.js`.
