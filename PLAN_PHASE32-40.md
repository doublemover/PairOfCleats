# Plan

We will execute the Phase 32-40 hard cut in a dedicated worktree, freezing the public contract, enforcing budgets, and wiring all behavior through AutoPolicy while retaining LMDB as a first-class backend (with a simple opt-in) before deleting legacy knobs/docs and validating the final surface.

## Scope
- In: Phases 32-40 (contract/budgets, AutoPolicy + minimal config, profile/env/flag removal, indexing/search policy wiring, LMDB kept and parity-checked, vector extension auto-only, docs + CI guardrails + inventory).
- Out: Earlier phases, new features outside config surface reduction, unrelated performance tuning.

## Action items
[x] Create worktree and keep this plan updated as tasks complete.
[x] Phase 32: add config contract/budgets docs, extend config inventory for allowlists/budgets, add CI/lint guardrails for env usage + schema + flag budgets.
[x] Phase 33: minimal config schema, centralized loader, AutoPolicy module, tests for unknown keys + deterministic policy resolution.
[x] Phase 34-35: remove profiles and profile env/flag, secrets-only env module, remove env override call-sites, update config hash behavior.
[x] Phase 36-38: strict CLI whitelist, collapse search filters, remove indexing/search knobs, wire build/search to AutoPolicy with SQLite + LMDB parity and a simple LMDB opt-in.
[x] Phase 39: make vector extension auto-only, keep LMDB wiring intact, keep parity entry points.
[x] Phase 40: sweep docs (README/commands/setup) for removed flags, update LMDB opt-in guidance, and delete remaining dead helpers/tests.
[x] Update tests that relied on removed env/config overrides (cache root, profiles) and ensure LMDB coverage remains.
[x] Modernize remaining tests/bench scripts to the new contract via test-only env overrides (no config keys/removed flags).
[x] Run lint/format and quick sanity checks, then update config inventory/guardrails if needed.

## Open questions
- None.
