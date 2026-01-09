# `picomatch`

**Area:** Glob parsing/matching

## Why this matters for PairOfCleats
Fast glob matching for include/exclude rules and path filters; provides parsing/scanning utilities for diagnostics.

## Implementation notes (practical)
- Use `scan`/`parse` for debugging and normalizing patterns.
- Be explicit about Windows path separators and slash handling.

## Where it typically plugs into PairOfCleats
- Config: allow users to specify include/exclude globs; surface 'why excluded' diagnostics.

## Deep links (implementation-relevant)
1. README: API (makeRe/parse/scan; extglobs/braces) — https://github.com/micromatch/picomatch#readme
2. Changelog: scan()/parse() output details (tokens/slashes/parts) — https://github.com/micromatch/picomatch/blob/master/CHANGELOG.md

## Suggested extraction checklist
- [ ] Confirm you can obtain stable node/section ranges (`start/end` offsets or line/column).
- [ ] Identify the minimal AST traversal/query approach that yields needed metadata (avoid full transforms unless required).
- [ ] Decide what becomes chunk metadata vs. what stays as derived indexes (postings/relations).
- [ ] Note any performance pitfalls (per-file program creation, per-node FFI, full-file buffering).