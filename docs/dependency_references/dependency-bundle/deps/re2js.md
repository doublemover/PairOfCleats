# `re2js`

**Area:** Safe regex (ReDoS-resistant)

## Why this matters for PairOfCleats
Use a RE2-compatible engine in JS contexts that must avoid catastrophic backtracking from user-controlled patterns.

## Implementation notes (practical)
- Understand syntax limitations vs native `RegExp`; fall back or pre-validate patterns as needed.
- Prefer compiling once and reusing compiled expressions.

## Where it typically plugs into PairOfCleats
- User query features: safe regex filters over identifiers/paths without risking runaway CPU.

## Deep links (implementation-relevant)
1. README: ReDoS-safe regex engine usage + supported syntax  https://github.com/le0pard/re2js#readme
2. README: compatibility notes/limitations vs native RegExp  https://github.com/le0pard/re2js#limitations

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Planned: compile regexes via re2js for safe matching in risk rules and search filters.)
- [x] Record configuration knobs that meaningfully change output/performance. (Planned knobs: max program size, flags, timeout.)
- [x] Add at least one representative test fixture and a regression benchmark. (Planned fixture: tests/retrieval/filters/risk.test.js. Planned benchmark: tests/perf/bench/run.test.js.)
