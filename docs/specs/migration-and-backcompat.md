# Phase 9 Spec -- Migration and Backward Compatibility

Last updated: 2026-02-10T08:35:00Z

This document is aligned with:

- `docs/specs/unified-syntax-representation.md` sections 19, 27, and 36
- `docs/specs/unified-syntax-representation.md` sections 38 and 39
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-embedding-bridge-contract.md`
- `docs/specs/usr-generated-provenance-contract.md`
- `docs/specs/usr-registry-schema-contract.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-observability-and-slo-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`

## Why a migration spec is necessary
Phase 9 replaces several legacy join assumptions:
- graph nodes keyed by `file::name`
- cross-file linking that assumes uniqueness of a bare name
- implicit "pick a winner" behaviors

These changes must ship with explicit back-compat rules so older artifacts (or partially upgraded indexes) do not silently break.

## Compatibility model
### Contract versions
- Public symbol artifacts are versioned (schema version in their meta sidecars if sharded; otherwise in manifest entries).
- Readers must support N-1 schema major, with adapters.
- For USR payloads, compatibility is governed by `schemaVersion` and section 36 scenario classes (`BC-001` through `BC-012`).

### Legacy fields retained (display-only)
Phase 9 will preserve the legacy fields **only as evidence/display**:
- `legacyKey = file::name`
- raw name matches
- leaf name matches

But:
- they must not be used as join keys in new code paths.

### Partial-upgrade behavior
If symbol artifacts are missing:
- Graph building falls back to `chunkUid` nodes and emits edges only when endpoints can be identified by `chunkUid`.
- Any name-only joins must be explicitly labeled as `status: unresolved` rather than guessed.

### Strict mode
Strict mode requires:
- symbol artifacts present
- no legacy name-only joins for cross-file edges
- no unknown USR fields, unknown diagnostic codes, or unknown reason codes
- canonical serialization and ID grammar compliance

### Non-strict mode
Non-strict mode allows:
- additive namespaced fields through compatibility adapters
- unknown minor-version additive fields with explicit compatibility diagnostics

Non-strict mode does not allow:
- major-version semantic mismatches
- invalid ID grammar
- broken endpoint constraints

## Mandatory compatibility matrix linkage

Phase 9 migration is not complete until the USR matrix artifact is present and green for required scenarios:

- Matrix source: `tests/lang/matrix/usr-backcompat-matrix.json`
- Result artifact: `usr-backcompat-matrix-results.json`
- Baseline classes: `BC-001` through `BC-012`
- Expansion rules: producer/reader variant and fixture-profile pairwise expansion (USR section 36.7)

Release-blocking strict scenarios:

- `BC-001`, `BC-002`, `BC-003`, `BC-005`, `BC-006`, `BC-008`, `BC-009`, `BC-010`, `BC-012`

Required migration evidence outputs:

- `usr-backcompat-matrix-results.json`
- `usr-conformance-summary.json` (for impacted lanes)
- `usr-capability-state-transitions.json`
- `usr-embedding-bridge-cases.json` validation report
- `usr-generated-provenance-cases.json` validation report

## Deprecations
After Phase 9, these patterns are deprecated:
- `Map` keyed by `${file}::${name}` for anything cross-file.
- `chunkIdByKey.set(file::name, ...)` without multi-mapping or ambiguity handling.

## Rollout plan
1. Land identity module + symbol artifacts behind a feature flag (`indexing.symbolIdentity=on`).
2. Update graphs and cross-file linking to prefer symbol identity when present.
3. Add strict validation gates and enable in CI for fixtures.
4. Add USR backward-compat matrix lane and make strict scenarios blocking.
5. Flip default on once metrics show acceptable ambiguity/unresolved rates and matrix pass thresholds are met.

Rollback requirement:

- rollout MUST define one-step rollback to legacy read path with explicit rollback trigger thresholds.

