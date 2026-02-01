# Graph caps and calibration harness (Phase 11)

## 1) Goal

Graph-powered features (neighborhood packs, impact analysis, graph ranking, suggest-tests) must be:

- **bounded** (no unbounded traversals or candidate sets),
- **deterministic** (same repo/config ⇒ same output),
- **configurable** (caps are first-class configuration),
- and **calibrated** (defaults justified by real repo measurements).

This document defines the shared cap vocabulary and the calibration harness outputs.

---

## 2) Shared cap vocabulary (normative)

All graph expansions in Phase 11 MUST use the same cap names and semantics.

### Structural caps
- `maxDepth` (int, >= 0)
  - Maximum hop distance from the seed in BFS traversal.
- `maxFanoutPerNode` (int, >= 0)
  - Maximum number of outgoing (or incoming) edges examined per visited node, after deterministic adjacency ordering.
- `maxNodes` (int, >= 1)
  - Maximum number of nodes returned (including seed if resolved).
- `maxEdges` (int, >= 0)
  - Maximum number of edges returned.
- `maxPaths` (int, >= 0)
  - Maximum number of witness paths returned (when witness paths are requested).

### Candidate caps
- `maxCandidates` (int, >= 0)
  - Maximum candidates retained in any `ReferenceEnvelope.candidates[]`.

### Deterministic work caps
- `maxWorkUnits` (int, >= 1)
  - A deterministic “work budget” counter used to bound traversal independent of wall-clock.

### Safety fuse (optional; non-determinism risk)
- `maxWallClockMs` (int, >= 1)
  - Optional last-resort fuse to avoid runaway CPU in pathological cases.
  - If it fires, implementations MUST emit truncation metadata indicating `cap: "maxWallClockMs"`.

**Important:** Determinism guarantees rely on structural/work-unit caps. Wall-clock truncation may vary by machine/load.

---

## 3) Truncation metadata requirements (normative)

Whenever any cap triggers, the output MUST include `truncation[]` records:

- `scope` must identify which slice truncated (`graph`, `impact`, `ranking`, etc.)
- `cap` must be one of the shared cap names
- `limit` must report the configured value
- `observed` and `omitted` should be included when measurable

---

## 4) Config surfaces (recommended)

Phase 11 should expose caps in both indexing and retrieval config.

### Indexing (graph build-time)
Recommended config path:
- `indexing.graph.caps`

Used by:
- `src/index/build/graphs.js` (buildRelationGraphs) for `callGraph`, `importGraph`, `usageGraph`

### Retrieval (runtime expansions)
Recommended config path:
- `retrieval.graph.caps`

Used by:
- `src/graph/neighborhood.js`
- `src/graph/impact.js`
- `src/context-pack/assemble.js` (graph slice)
- `src/tooling/suggest-tests.js`
- graph ranking features that require neighborhood queries

### Graph ranking
Recommended config path:
- `retrieval.graphRanking.*`
  - `enabled`
  - `weights`
  - `maxGraphWorkUnits`
  - optional `maxWallClockMs`

---

## 5) Default cap presets (non-normative placeholders)

Defaults MUST be calibrated via the harness. Until calibration exists, start with conservative presets:

### Typical repos (general)
```json
{
  "maxDepth": 2,
  "maxFanoutPerNode": 25,
  "maxNodes": 250,
  "maxEdges": 500,
  "maxPaths": 200,
  "maxCandidates": 25,
  "maxWorkUnits": 50000
}
```

### Huge/problematic repos (fallback)
```json
{
  "maxDepth": 1,
  "maxFanoutPerNode": 10,
  "maxNodes": 100,
  "maxEdges": 200,
  "maxPaths": 50,
  "maxCandidates": 10,
  "maxWorkUnits": 15000
}
```

---

## 6) Calibration harness (Phase 11)

### 6.1 Inputs
- `benchmarks/repos.json` defines repositories to measure.
- Repos are categorized into tiers:
  - `small`, `typical`, `large`, `huge`, `problematic`
- Harness MUST accept:
  - a deterministic RNG seed (for selecting representative nodes)
  - explicit caps preset selection
  - `--outDir` to override output root
  - `--runId` to force a stable run identifier
  - `--now` (ISO timestamp) to inject a deterministic clock for CI

### 6.2 What the harness measures
For each repo:
1. **Indexing with graphs enabled**
2. **Graph distributions**
   - node counts / edge counts per graph
   - degree distribution summary (p50/p90/p95/p99)
   - SCC stats (optional)
3. **Representative expansions**
   - seeds:
     - random nodes (seeded RNG)
     - top-degree nodes (deterministic top-K)
     - entrypoints when detectable (best-effort)
   - record:
     - runtime
     - output sizes (bytes, nodes, edges)
     - truncation frequency
     - work-units consumed

### 6.3 Outputs
Harness MUST write a versioned output bundle:

- `benchmarks/results/<YYYY-MM-DD>/graph-caps/`
  - `summary.json`
  - `repos/<repo-id>.json` (per repo)
  - optional per-run logs

Recommended `summary.json` shape:

```json
{
  "version": "1.0.0",
  "generatedAt": "2026-02-01T00:00:00Z",
  "seed": 12345,
  "tiers": {
    "typical": {
      "reposMeasured": 12,
      "graphStats": {
        "callGraph": { "nodesP95": 12000, "edgesP95": 60000, "degreeP95": 45 },
        "importGraph": { "nodesP95": 8000, "edgesP95": 22000, "degreeP95": 12 }
      },
      "expansionStats": {
        "maxDepth2": {
          "p95NodesReturned": 180,
          "p95EdgesReturned": 320,
          "p95WorkUnits": 22000,
          "p95Ms": 18,
          "truncationRate": 0.06
        }
      }
    }
  },
  "recommendedDefaults": {
    "typescript": {
      "typical": { "maxDepth": 2, "maxFanoutPerNode": 25, "...": 0 }
    }
  }
}
```

### 6.4 Machine-readable defaults
The harness SHOULD also emit:
- `docs/perf/graph-caps-defaults.json` (committable defaults keyed by language and optional tier)

---

## 7) Tests (required)

- `tests/indexing/graphs/caps-enforced-and-reported.test.js`
  - caps trigger deterministically in graph build and are reported
- `tests/perf/bench/graph-caps-harness-smoke.test.js`
  - harness runs on an in-tree fixture and writes a deterministic results JSON file
