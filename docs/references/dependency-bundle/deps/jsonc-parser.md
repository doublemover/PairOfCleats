# `jsonc-parser`

**Area:** JSON-with-comments parsing and edits

## Why this matters for PairOfCleats
Parse JSONC configs with location-aware APIs to support stable chunk boundaries and safe edits/patch suggestions.

## Implementation notes (practical)
- Use `getLocation`/`findNodeAtLocation` to map config keys to offsets.
- Use `modify` + `applyEdits` to generate deterministic patches.

## Where it typically plugs into PairOfCleats
- Config indexing: chunk by object sections; optional 'auto-fix' suggestions for formatting/keys.

## Deep links (implementation-relevant)
1. README: getLocation/findNodeAtLocation/modify/applyEdits APIs — https://github.com/microsoft/node-jsonc-parser#readme

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).