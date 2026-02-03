# Map Pipeline Performance

## Overview
Phase 12 focuses on reducing map build memory use while keeping output deterministic and viewer-friendly. The build now streams nodes/edges, enforces guardrails, and captures build telemetry.

## Streaming Build Output
Map build output can be serialized without buffering the full JSON by using the streaming writer:

- `src/map/build-map/io.js` exposes `writeMapJsonStream({ filePath, mapBase, nodes, edges })`.
- `nodes` and `edges` can be async iterables; the writer streams arrays incrementally.
- Output preserves the same schema and key ordering as in-memory map builds.

## Spill + Deterministic Ordering
Large edge sets are handled with spill files:

- Edges are accumulated in bounded buffers and sorted runs are written to temp JSONL files.
- Runs are merged deterministically to preserve stable ordering by edge key.
- This avoids materializing large edge arrays while keeping output order stable.

## Guardrails
Per-section size guardrails protect memory and output size:

- `maxNodeBytes`, `maxEdgeBytes`, `maxSymbolBytes` enforce upper bounds on serialized bytes.
- Guardrails throw with actionable messages when a section exceeds its cap.

## Build Telemetry
Map builds emit per-stage telemetry and high-water marks:

- `buildMetrics.stages`: elapsed time and memory snapshot per stage.
- `buildMetrics.peak`: peak `heapUsed`, `rss`, `external`, `arrayBuffers` observed during the build.
- `buildMetrics.counts`: row counts for nodes, members, and edges.

The telemetry is attached to the map model as an optional `buildMetrics` field.

## Benchmarks
Run the bench scripts from repo root. Each script emits a JSON summary with timings and peak heap.

- `node tools/bench/map/build-map-streaming.js --repo . --json`
- `node tools/bench/map/build-map-memory.js --repo . --json`
- `node tools/bench/map/viewer-fps.js --repo .`
- `node tools/bench/map/viewer-lod-stress.js --repo .`

Viewer benchmarks start a local server and print a URL plus instructions. Keep the perf HUD visible and record FPS/frame time after the scene settles.

### Expected Deltas
- Streaming writer should reduce peak heap during JSON output vs baseline stringify/write.
- Build memory benchmark should show stable peak heap numbers across runs (guardrails prevent runaway output sizes).
- Viewer FPS bench should show fewer dropped frames once instancing + culling are active.
- LOD stress bench should visibly switch tiers (full/simplified/hidden) as you zoom or increase edge counts, reducing draw counts when under load.

