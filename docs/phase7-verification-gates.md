# Phase 7 Verification Gates

Phase 7 in the roadmap focuses on **regression**, **parity**, and **UX acceptance** gates for the core user workflows:

1. **Index build** (code + prose)
2. **Search** (deterministic, stable ranking)
3. **Code map** (deterministic, guardrailed, multiple render formats)
4. **Editor integrations** (baseline parity of defaults + command coverage)

This repo now includes a concrete, automated set of gates that map directly to the Phase 7 items.

## What is covered

### Parity checklist vs editor extensions

Automated parity checks live in:

- `npm run editor-parity-test`

This test verifies (at minimum):

- The VS Code extension exposes the expected configuration keys.
- The Sublime Text package exposes the expected baseline command palette entries (search, indexing, mapping).
- Default settings parity for search defaults (mode, backend, max results) and map guardrails (max files/members/edges).

### Deterministic outputs for map/search

Determinism gates:

- `npm run search-determinism-test`
- `npm run code-map-determinism-test`

These tests run the same command twice against the same temporary repo and assert the results are identical (excluding explicitly time-varying fields where relevant).

### Performance acceptance criteria via guardrails

Guardrail gates:

- `npm run code-map-guardrails-test` (explicit limits)
- `npm run code-map-default-guardrails-test` (default limits)

These tests assert that map generation enforces hard bounds on member/edge growth and reports truncation.

### End-to-end smoke (index + search + map)

The existing fixture smoke now exercises the full Phase 7 workflow:

- `npm run fixture-smoke`

It builds indexes, runs representative searches, and then generates maps in:

- JSON (`--format json`)
- DOT (`--format dot`)
- SVG (`--format svg`, with an automatic DOT fallback if Graphviz is not installed)

### Optional SVG rendering when Graphviz is available

Two complementary gates exist:

- `npm run code-map-graphviz-fallback-test` (forces `dot` to be unavailable and asserts DOT fallback)
- `npm run code-map-graphviz-available-test` (runs only when `dot` is present; otherwise exits 0 and prints a skip message)

## Recommended Phase 7 command set

For local verification, the following is the intended Phase 7 gate set:

```bash
npm run fixture-smoke
npm run search-determinism-test
npm run code-map-determinism-test
npm run code-map-dot-test
npm run code-map-guardrails-test
npm run code-map-default-guardrails-test
npm run code-map-graphviz-fallback-test
npm run code-map-graphviz-available-test
npm run editor-parity-test
```

Notes:

- `code-map-graphviz-available-test` is **optional** by design and will auto-skip if `dot` is not present.
- `fixture-smoke` uses stub embeddings to keep the run deterministic and CI-friendly.
