# Graph Caps and Work Budgets (Spec)

This spec defines the **graph expansion caps** and **work budget** semantics used by graph tooling
(graph-context, context-pack, impact, suggest-tests) and the **graph ranking** work budget used
in retrieval. It is intended to match current implementation behavior.

## 1. GraphCaps object (graph expansion)

GraphCaps is an optional object with the following fields (all numbers are integers after
normalization):

- `maxDepth`: cap on traversal depth. When set and the requested depth exceeds it, the effective
  depth is clamped and a truncation record is emitted.
- `maxFanoutPerNode`: cap on edge candidates per node (after deterministic sort).
- `maxNodes`: cap on total nodes returned.
- `maxEdges`: cap on total edges returned.
- `maxPaths`: cap on witness paths (only when `includePaths=true`).
- `maxCandidates`: cap on symbol edge candidates (applies to symbolEdges normalization).
- `maxWorkUnits`: cap on work units consumed by traversal.
- `maxWallClockMs`: wall-clock budget in milliseconds.

### 1.1 Normalization rules

Implementation (see `src/graph/neighborhood.js`, `src/graph/work-budget.js`):

- Each cap is normalized with `Number(value)`; non-finite values become `null`.
- Values are floored to integers.
- Values <= 0 become `0` (a **hard cap**).
- `null` means **no cap** for that field.

**Note on `maxWallClockMs = 0`:** a value of `0` is a hard cap and will stop traversal on the
first wall-clock check (budget checks occur every 256 work units). To disable wall-clock limiting,
omit the field or set it to `null`.

### 1.2 Work budget

Work budget is enforced by `createWorkBudget`:

- `maxWorkUnits` limits cooperative preparation/admission units. Call, usage and import
  candidates consume before endpoint descriptors and call-site evidence are constructed.
  Symbol entries consume before inspection, then reserve one unit per candidate-prefix
  slot before copying/sorting that prefix and one per target witness. Candidate-cap
  notices from discarded symbol fanout remain visible when the budget admits their
  preparation. An exhausted preparation budget preserves already admitted edges.
- `stats.counts.workUnitsUsed` includes these preparation checks; it is not just the
  number of returned edges. Graph lookup/count-index construction and cold reverse-CSR
  setup remain separate costs. A prepared exact-count row avoids discarded descriptors;
  legacy normalization/deduplication still uses its full exact-count fallback.
- The stopping checkpoint is counted and stops when `used >= maxWorkUnits`, before
  its associated operation. This is a cooperative operation bound, not a hard deadline
  over synchronous index construction or sorting.
- `maxWallClockMs` is checked every 256 work units (`checkEvery=256`).
- When a limit is exceeded, traversal stops and a truncation record is emitted with:
  - `cap`: the cap that triggered (`maxWorkUnits` or `maxWallClockMs`).
  - `limit`: the configured limit value.
  - `observed`: `used` (for `maxWorkUnits`) or `elapsedMs` (for `maxWallClockMs`).

### 1.3 Truncation records

Graph expansion returns a `truncation[]` list. Each entry is shaped as:

```json
{
  "scope": "graph",
  "cap": "maxNodes|maxEdges|maxFanoutPerNode|maxDepth|maxPaths|maxCandidates|maxWorkUnits|maxWallClockMs",
  "limit": 123,
  "observed": 456,
  "omitted": 789,
  "at": { "node": "chunkUid|filePath" }
}
```

Only fields relevant to the cap are populated. `omitted` and `at` are optional.

### 1.4 Stats payload

Graph expansion returns:

- `stats.artifactsUsed`: `{ graphRelations, symbolEdges, callSites }` booleans.
- `stats.counts`: `{ nodesReturned, edgesReturned, pathsReturned, workUnitsUsed }`.

### 1.5 Config and CLI sources

Graph caps are sourced from:

- User config: `retrieval.graph.caps`.
- CLI overrides (when supported): `--maxDepth`, `--maxFanoutPerNode`, `--maxNodes`,
  `--maxEdges`, `--maxPaths`, `--maxCandidates`, `--maxWorkUnits`, `--maxWallClockMs`.

These are used by graph tooling in `src/integrations/tooling/*` and by `buildGraphNeighborhood`.

---

## 2. Graph ranking work budget (retrieval)

Graph ranking applies a secondary score based on call/usage graph proximity and node degree.
It has its own work budget (separate from GraphCaps).

### 2.1 Config surface

The retrieval config uses:

- `retrieval.graphRanking.enabled` (boolean)
- `retrieval.graphRanking.weights.degree` (number)
- `retrieval.graphRanking.weights.proximity` (number)
- `retrieval.graphRanking.seedSelection` (`top1` | `topK` | `none`)
- `retrieval.graphRanking.seedK` (number; only used when `seedSelection=topK`)
- `retrieval.graphRanking.maxGraphWorkUnits` (number; default **500**)
- `retrieval.graphRanking.maxWallClockMs` (number; optional)

Defaults (from `src/retrieval/pipeline/graph-ranking.js`):

- `seedSelection` defaults to `top1`.
- `seedK` defaults to **3** when `seedSelection=topK`.
- `maxGraphWorkUnits` defaults to **500** if not provided.

### 2.2 Work budget semantics

Graph ranking uses `createWorkBudget` with:

```js
createWorkBudget({ maxWorkUnits: maxGraphWorkUnits, maxWallClockMs })
```

Traversal halts when the budget stops. The resulting stats are:

- `stats.workUnitsUsed`: actual work units consumed.
- `stats.truncated`: `true` when `workUnitsUsed >= maxGraphWorkUnits`.

### 2.3 Explain payload

When `explain=true`, each ranked entry includes `scoreBreakdown.graph`:

```json
{
  "score": 1.23,
  "degree": 4,
  "proximity": 0.5,
  "weights": { "degree": 0.1, "proximity": 0.3 },
  "seedSelection": "top1",
  "seedK": 3
}
```

This is appended to any existing score breakdown data.

## Explicit count/preparation qualification

Run `node --expose-gc tests/graph/qualification-neighborhood-cost.js` on the prepared
supported runtime. The internal fixture records ordinary/CSR index construction,
full order/count admission, first incoming reverse-CSR setup, warm exact counts,
raw normalization/deduplication and repeated traversal-cache misses separately.
Degrees8/256/20000, fanout1/3, out/in/both and three fresh generations retain exact
ordinary/CSR output and source identity. It reports exact typed-array bytes and
retained heap/RSS boundaries; encoded adjacency bytes are wire size, not object
heap attribution. Cold setup is separate from cooperative traversal budgets.
