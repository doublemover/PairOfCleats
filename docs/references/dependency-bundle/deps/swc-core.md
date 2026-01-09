# `@swc/core`

**Area:** Fast parsing/transform (JS/TS)

## Why this matters for PairOfCleats
Use SWC for high-throughput parsing/transform when you need speed and are willing to work with SWC ASTs or emitted code.

## Implementation notes (practical)
- Tune parser syntax options (TS/JSX/Decorators) to match repo reality.
- Use transforms selectively; parsing-only is usually faster/safer for indexing.

## Where it typically plugs into PairOfCleats
- Throughput mode: use SWC to quickly extract top-level declarations and ranges for chunking.

## Deep links (implementation-relevant)
1. Core usage docs (parse/transform; syntax options) — https://swc.rs/docs/usage/core
2. Configuration reference (parser syntax settings; TS/JSX/Decorators) — https://swc.rs/docs/configuration/compilation

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).