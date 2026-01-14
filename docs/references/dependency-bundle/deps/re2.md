# `re2`

**Area:** Safe regular expression engine

## Why this matters for PairOfCleats
Native RE2 avoids catastrophic backtracking for user-supplied patterns.

## Implementation notes (practical)
- Keep a strict allowlist of flags to match current behavior.
- Ensure error handling matches re2js so filters stay deterministic.

## Where it typically plugs into PairOfCleats
- Search filters and risk tagging regex evaluation.

## Deep links (implementation-relevant)
1. README — https://github.com/uhop/node-re2#readme

## Suggested extraction checklist
- [ ] Confirm parity with re2js for common flag combinations.
- [ ] Exercise max pattern/input limits with native engine.
