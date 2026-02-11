# USR Contract Enforcement Guide

Last updated: 2026-02-11T04:25:00Z

## Purpose

This guide defines how CI and local validation enforce USR contract consistency across:

- umbrella and decomposed specs
- machine-readable matrix artifacts
- roadmap traceability references
- required evidence outputs

## Enforcement layers

1. Reference drift checks
- every `docs/specs/usr-*.md` file must be represented in:
  - `docs/specs/usr/README.md`
  - `docs/specs/unified-syntax-representation.md`
  - `TES_LAYN_ROADMAP.md` Appendix H

2. Matrix reference checks
- every `tests/lang/matrix/usr-*.json` file must be referenced in:
  - `docs/specs/usr-registry-schema-contract.md`
  - `docs/specs/unified-syntax-representation.md`
  - `TES_LAYN_ROADMAP.md` Phase 1 matrix inventory

3. Invariant checks
- schema version consistency
- deterministic ordering and canonical serialization
- cross-registry foreign key invariants
- strict enum/range validation

4. Evidence checks
- required reports from active blocking contracts must exist and be linked in scorecards
- stale evidence must fail gating when TTL is exceeded

## CI policy

- `ci-lite`:
  - reference drift checks
  - schema shape checks
- `ci`:
  - strict matrix validators
  - blocking quality/security/waiver gates
- `ci-long`:
  - expanded backcompat matrix
  - drill, failure-injection, and long-running coverage checks

## Failure handling protocol

1. classify the failure as hard-block or advisory
2. attach failing artifact IDs and contract IDs
3. assign owner and remediation ETA
4. require waiver for advisory carry-forward beyond one release window

## Required links in PRs

- contract files modified
- matrix files modified
- validation command output summary
- updated roadmap appendices affected by contract changes
