# Phase 0 Tracking

Lightweight status tracker for Phase 0 tasks. Update with PR links and status as work lands.

| Area | Status | Notes | PR |
| --- | --- | --- | --- |
| Node 24.13.0 baseline | In progress | `.nvmrc`, `package.json` engines, README updated | |
| CI suite runner | In progress | `tools/ci/run-suite.js --mode pr` / `--mode nightly` | |
| CI workflows | In progress | Node 24.13.0, artifacts, nightly matrix | |
| Capability gate | In progress | `tools/ci/capability-gate.js` + smoke test | |
| Test runner hardening | In progress | skip semantics, kill-tree, logs, timings | |
| Script coverage drift | In progress | wiring cleanup, validation, tests | |
| Script surface policy | In progress | inventory + policy test | |
| Fixture hygiene | In progress | temp fixtures + cwd independence | |
| Determinism baseline | In progress | baseline fixture + nightly perf test | |
| Git hooks | In progress | remove tooling and tests | |

## Fixtures and regressions
- Fixture corpus: `docs/testing/fixture-corpus.md`
- Baseline determinism test: `tests/perf/baseline-artifacts.test.js`

## Definition of done
- `node tools/ci/run-suite.js --mode pr` matches CI behavior and is documented.
- CI uses Node 24.13.0 LTS and uploads logs/JUnit/diagnostics artifacts.
- Test runner supports skip semantics, timeouts kill process trees, and per-run log dirs.
- Script surface inventory is up to date and enforced in tests.


