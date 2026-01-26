# `greedy-number-partitioning`

**Area:** Work sharding / load balancing

## Why this matters for PairOfCleats
Partition weighted tasks into k bins (e.g., files by size/estimated parse cost) to reduce stragglers in worker pools.

## Implementation notes (practical)
- Use LPT-style heuristics when exact optimal partitioning is unnecessary.
- Feed realistic weights (bytes, historical parse time) for better balance.

## Where it typically plugs into PairOfCleats
- Indexer: partition file list into worker batches to minimize tail latency.

## Deep links (implementation-relevant)
1. Repo README: usage (partition weights into k bins; LPT heuristic)  https://github.com/dvopalecky/greedy-number-partitioning#readme

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: use greedy partitioning to balance shard weights or queue batches.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: number of groups, weight function, max group size.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tools/shard-census.js sample outputs. Planned benchmark: tools/shard-census.js or tests/thread-limits.js.)