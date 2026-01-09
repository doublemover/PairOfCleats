# `@vscode/ripgrep`

**Area:** Fast text search integration

## Why this matters for PairOfCleats
Bundle and spawn `rg` reliably across platforms; use it for prefiltering candidate files/lines and for fallback search modes.

## Implementation notes (practical)
- Use exported `rgPath` to locate binary; avoid assuming `rg` exists on PATH.
- Prefer `--json` output for robust parsing; tune flags for speed.

## Where it typically plugs into PairOfCleats
- Index build: pre-scan for tokens to prioritize files; incremental watch: detect changed lines quickly.
- Search: offer 'grep-mode' fallback for repositories without full index.

## Deep links (implementation-relevant)
1. README: rgPath export + usage example (spawn rg; parse output) — https://github.com/microsoft/vscode-ripgrep#usage-example
2. Ripgrep guide (flags, -json output, performance knobs) — https://github.com/BurntSushi/ripgrep/blob/master/GUIDE.md

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).