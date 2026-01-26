# `@mongodb-js/zstd`

**Area:** Compression / artifact storage

## Why this matters for PairOfCleats
Zstandard can reduce artifact size while keeping decompression fast.

## Implementation notes (practical)
- Decide whether to support streaming or buffer-only modes per artifact type.
- Ensure fallback to gzip when zstd is unavailable.

## Where it typically plugs into PairOfCleats
- Artifact compression mode selection for build outputs.

## Deep links (implementation-relevant)
1. README -- https://github.com/mongodb-js/zstd#readme

## Suggested extraction checklist
- [ ] Validate compatibility across Node versions/platforms.
- [ ] Benchmark compression ratio vs gzip on large artifacts.
