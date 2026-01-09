# `ajv`

**Area:** Config validation / schema enforcement

## Why this matters for PairOfCleats
Validate `.pairofcleats.json` and other JSON-based config artifacts with predictable behavior, strictness, and defaults.

## Implementation notes (practical)
- Compile schemas once and reuse validator functions across runs/processes.
- Use strict mode intentionally (or tune it) so config errors fail fast and are actionable.
- Consider `removeAdditional`, `useDefaults`, and `unevaluatedProperties` to keep configs clean and consistent.

## Where it typically plugs into PairOfCleats
- Treat config parsing as part of reproducibility: write the validated, normalized config snapshot into the index artifacts.
- Emit validation errors with path + schema context; include them in `--json` diagnostics output.

## Deep links (implementation-relevant)
1. Options reference (strict, allErrors, removeAdditional, useDefaults, unevaluatedProperties) — https://ajv.js.org/options.html
2. Getting started / schema compilation patterns (compile once; reuse validators) — https://ajv.js.org/guide/getting-started.html

## Suggested extraction checklist
- [ ] Identify the exact API entrypoints you will call and the data structures you will persist.
- [ ] Record configuration knobs that meaningfully change output/performance.
- [ ] Add at least one representative test fixture and a regression benchmark.