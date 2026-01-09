# `smol-toml`

**Area:** TOML parsing

## Why this matters for PairOfCleats
Parse TOML configs into objects and (optionally) stringify; use for chunking by tables/keys.

## Implementation notes (practical)
- Be mindful of TOML spec edge cases (multiline strings, datetime).
- Normalize parsed output if you index semantic values.

## Where it typically plugs into PairOfCleats
- Config chunking: split by top-level tables and keys; retain table paths as facets.

## Deep links (implementation-relevant)
1. Repo README: parse/stringify API (TOML v1.1-ish compliance notes) — https://github.com/squirrelchat/smol-toml#readme
2. TOML spec (edge cases; multiline strings; datetime) — https://toml.io/en/

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).