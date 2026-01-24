# Phase 0 Fixture Corpus

This document lists fixture repos used for Phase 0 validation and determinism checks.

## Baseline fixture (`tests/fixtures/baseline`)
Purpose: deterministic indexing regression checks (code + prose + embedded code fences).

Contains:
- `src/index.ts`, `src/component.tsx`, and `src/dup/index.ts` (duplicate basenames).
- `docs/README.md` with fenced `tsx`.
- `public/index.html` with inline `<script>`.
- `data/config.json` and `data/config.xml`.

Used by:
- `tests/perf/baseline-artifacts.test.js`

## Sample fixture (`tests/fixtures/sample`)
Purpose: general integration fixture used by multiple tests (index validation, services, etc.).

Notes:
- Always copy to a temp directory before mutating.
- Access via `tests/helpers/fixtures.js` where possible.
