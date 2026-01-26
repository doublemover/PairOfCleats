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
1. Reference implementation + API examples (build automaton; search)  https://github.com/spencermountain/aho_corasick#readme
2. Alternative high-perf wrapper (Rust daachorse via Node bindings)  https://github.com/BlackGlory/aho-corasick#readme

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: build an automaton from dictionary terms and use search() to emit match spans; persist the term list + automaton snapshot in cache.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: case sensitivity, overlapping matches, word-boundary filtering, max dictionary size.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/fixtures/dict-scan/ (terms + sample text). Planned benchmark: tools/bench-dict-seg.js (extend with multi-pattern scan).)