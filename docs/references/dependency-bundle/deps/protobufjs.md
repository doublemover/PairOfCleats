# `protobufjs`

**Area:** Protocol Buffers parsing/tooling

## Why this matters for PairOfCleats
Parse `.proto` files and optionally generate static modules/types; useful for extracting messages/services for index metadata.

## Implementation notes (practical)
- Use reflection-based loading for indexing; use CLI generation when you want stable, build-time artifacts.
- Capture package + message/service hierarchies for chunk context.

## Where it typically plugs into PairOfCleats
- Chunk by message/enum/service; extract field types and RPC signatures.

## Deep links (implementation-relevant)
1. Protobuf.js docs (load .proto; reflection-based messages) — https://protobufjs.github.io/protobuf.js/index.html
2. CLI docs (pbjs/pbts for generating static modules) — https://github.com/protobufjs/protobuf.js/blob/master/cli/README.md

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).