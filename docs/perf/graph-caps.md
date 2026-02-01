# Graph Caps Defaults

This document captures how graph expansion caps are selected and calibrated.

## Overview
- The graph caps harness samples bounded neighborhood expansions for representative seeds.
- Measurements are aggregated to produce defaults per language/tier.
- Defaults are recorded in `docs/perf/graph-caps-defaults.json`.

## Selection Rules (v1)
1. Use the harness output to compute P95 nodes/edges/workUnits for the typical tier.
2. Set `maxNodes` to P95(nodes), `maxEdges` to P95(edges), `maxWorkUnits` to P95(workUnits).
3. Clamp `maxFanoutPerNode` to the P95 fanout seen in the harness samples.
4. For huge/problematic tiers, apply a 0.5x multiplier to nodes/edges/workUnits.
5. Record any truncation caps hit during calibration to inform adjustments.

## Output Layout
The harness writes `graph-caps-harness.json` with:
- `graphStats` (node/edge counts by graph)
- `samples[]` (seed + counts + truncation)

The defaults file contains the canonical caps for each language/tier.
