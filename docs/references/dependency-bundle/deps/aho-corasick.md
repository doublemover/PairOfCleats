# `aho-corasick`

**Area:** Multi-pattern search / dictionary matching

## Why this matters for PairOfCleats
Efficiently match many keywords at once (e.g., dictionary terms, slang lists, risk tokens) over large text streams.

## Implementation notes (practical)
- Build the automaton once per dictionary snapshot; serialize if possible for reuse.
- Use for token-level or substring-level matches; pair with boundaries when needed.

## Where it typically plugs into PairOfCleats
- Dictionary bootstrapping and token tagging during indexing.
- Fast scan step for 'candidate chunks' before heavier parsing.

## Deep links (implementation-relevant)
1. Reference implementation + API examples (build automaton; search) — https://github.com/spencermountain/aho_corasick#readme
2. Alternative high-perf wrapper (Rust daachorse via Node bindings) — https://github.com/BlackGlory/aho-corasick#readme

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.