# PERFPLAN Execution Guide

This guide explains how to execute phases in `PERFPLAN.MD` with consistent documentation and test coverage.

## Phase execution order
Follow the order in `PERFPLAN.MD`. Do not skip ahead unless a phase explicitly allows it.

## Required steps for each phase
1. **Scope** the files listed in the phase and confirm they exist.
2. **Implement** the phase tasks in order.
3. **Update docs/specs** listed in the phase.
4. **Add tests** listed in the phase (or mark why they are deferred).
5. **Run tests** for the lane(s) specified in the phase acceptance.
6. **Update acceptance checkboxes** at commit time only.

## Stage audit outputs
When phases touch indexing performance, ensure these outputs are produced and documented:
- `metrics/stage-audit-<mode>.json`
- `build_state.json` (stage checkpoints)

## Documentation expectations
If a phase introduces:
- new artifacts → update `docs/contracts/artifact-contract.md`
- new config keys → update `docs/config/schema.json`, `docs/config/contract.md`, `docs/config/inventory.*`
- new CLI flags → update `docs/guides/commands.md`

## Testing expectations
Use:
- `node tests/run.js --lane ci-lite` for quick regression checks
- `node tests/run.js --lane ci` for full coverage of unit/integration/services

## Rollback guidance
If a phase introduces regressions, revert to the last green commit and re-run the phase with smaller steps and tighter tests.
