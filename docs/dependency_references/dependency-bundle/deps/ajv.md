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
1. Options reference (strict, allErrors, removeAdditional, useDefaults, unevaluatedProperties)  https://ajv.js.org/options.html
2. Getting started / schema compilation patterns (compile once; reuse validators)  https://ajv.js.org/guide/getting-started.html

## Suggested extraction checklist
- [x] Identify the exact API entrypoints you will call and the data structures you will persist. (Use `new Ajv({ allErrors: true, allowUnionTypes: true, strict: true })` and `ajv.compile(schema)` for artifact and failure schema validators; persist compiled validators in memory (src/shared/artifact-schemas.js, src/index/build/failure-taxonomy.js).)
- [x] Record configuration knobs that meaningfully change output/performance. (Options: allErrors, strict, allowUnionTypes (configured in src/shared/artifact-schemas.js and src/index/build/failure-taxonomy.js).)
- [x] Add at least one representative test fixture and a regression benchmark. (Fixture: tests/indexing/validate/index-validate.test.js (tools/index/validate.js on fixtures). Benchmark: tools/bench/language-repos.js (index build + validation).)