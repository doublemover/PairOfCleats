# Graph Caps Defaults

This document captures how graph expansion caps are selected and calibrated.

## Overview
- The graph caps harness samples bounded neighborhood expansions for representative seeds.
- The harness writes `graph-caps-harness.json` with graph stats, sample counts, and truncation markers.
- Defaults are curated from those samples and recorded in `docs/perf/graph-caps-defaults.json`.

## Harness usage
```bash
node tools/bench/graph-caps-harness.js --index <indexDir> --outDir <dir>
node tools/bench/graph-caps-harness.js --graphFixture <graph_relations.json> --outDir <dir>
```

Required:
- `--outDir <path>`: output directory for `graph-caps-harness.json`.
- `--index <path>` or `--graphFixture <path>`: supply exactly one source (index directory or
  a `graph_relations` fixture JSON).

Optional:
- `--depth <n>`: requested neighborhood depth (default 2).

Notes:
- The harness calls `buildGraphNeighborhood` with `direction: both` and `includePaths: false`.
- The CLI run applies sampling caps (`maxFanoutPerNode: 100`, `maxNodes: 200`, `maxEdges: 500`) to bound runtime.
- If no seeds are provided, the harness samples the first call graph node as a `{ type: "chunk", chunkUid }` seed.

## Output Layout
The harness writes `graph-caps-harness.json` with:
- `version`: schema version.
- `generatedAt`: ISO timestamp for the harness run.
- `graphStats`: node/edge counts by graph (`callGraph`, `usageGraph`, `importGraph`).
- `samples[]`: one entry per seed with:
  - `seed`: graph node reference used for expansion.
  - `counts`: `nodesReturned`, `edgesReturned`, `pathsReturned`, `workUnitsUsed`.
  - `truncation`: cap hits (`cap`, `limit`, `observed`, `omitted`, `at`) or `null`.

## Defaults file
`docs/perf/graph-caps-defaults.json` is produced by running the harness on representative
indexes or fixtures, reviewing `graph-caps-harness.json`, and manually curating the caps.
Refresh `generatedAt` when the defaults change.

Top-level fields:
- `version`: schema version for the defaults file.
- `generatedAt`: ISO timestamp for the last update.
- `provenance`: generator/inputs used to produce the samples and a link back to this doc.
- `defaults.global`: baseline caps (no per-language tiers yet).

Cap fields:
- `maxDepth`: maximum neighborhood depth applied during expansion.
- `maxFanoutPerNode`: maximum edge candidates considered per node.
- `maxNodes`: maximum nodes returned.
- `maxEdges`: maximum edges returned.
- `maxPaths`: maximum witness paths captured when paths are enabled.
- `maxCandidates`: maximum candidate refs per symbol edge.
- `maxWorkUnits`: traversal work units (edge expansions) before truncation.
- `maxWallClockMs`: wall-clock budget in milliseconds for traversal work (omit or set to `null` to disable; `0` is a hard cap).
