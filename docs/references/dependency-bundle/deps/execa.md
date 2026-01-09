# `execa`

**Area:** Process execution

## Why this matters for PairOfCleats
Run external tools (ripgrep, pyright, git, language servers) with robust stdio handling and cleanup semantics.

## Implementation notes (practical)
- Use explicit stdio piping and `reject` behavior to keep failures deterministic.
- Capture both stdout/stderr (`all`) where debugging is important.

## Where it typically plugs into PairOfCleats
- Tooling integration: spawn optional analyzers and capture structured output.

## Deep links (implementation-relevant)
1. API reference (stdio, all, reject, cleanup, pipes) — https://github.com/sindresorhus/execa/blob/main/docs/api.md

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.