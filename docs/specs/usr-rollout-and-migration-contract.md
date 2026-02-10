# Spec -- USR Rollout and Migration Contract

Status: Draft v0.1
Last updated: 2026-02-10T03:00:00Z

## 0. Purpose and scope

This document defines rollout phases, dual-write/shadow-read strategy, parity criteria, and cutover gates for USR adoption.

It decomposes `docs/specs/unified-syntax-representation.md` sections 26, 27, and 36.

## 1. Rollout phases (normative)

### Phase A -- contract readiness

- schema/validators and profile registries implemented
- drift checks active in CI
- diagnostics and reason-code taxonomy enforced

Gate A:

- all contract checks green

### Phase B -- dual-write

- emit USR alongside legacy artifact outputs
- preserve legacy outputs as externally authoritative
- generate parity comparison reports

Gate B:

- parity criteria pass for required fixtures and lanes

### Phase C -- shadow-read

- internal readers consume USR outputs for decision paths
- external surfaces remain legacy until cutover
- monitor drift and unresolved budgets

Gate C:

- shadow-read metrics stable and within approved budget

### Phase D -- production cutover

- USR-backed derivations become authoritative
- legacy outputs remain compatibility surfaces until deprecation gates are met

Gate D:

- required conformance levels and compatibility matrix pass

## 2. Dual-write and shadow-read policy

Dual-write requirements:

- USR and legacy artifacts emitted for same build inputs
- ID/range provenance retained for auditing
- deterministic parity runner compares mapped surfaces

Shadow-read requirements:

- read-path feature flag controls USR consumption
- fallback to legacy path on strict failures with explicit diagnostics
- all fallbacks recorded in run reports

## 3. Parity acceptance criteria

Minimum parity checks:

- semantic equivalence for symbols/edges/relations/risk summaries where mapped
- deterministic ordering equivalence
- no silent capability loss

Blocking thresholds:

- strict parity failures: blocking
- warning-level divergence: budgeted and time-bounded

## 4. Compatibility and deprecation protocol

Compatibility matrix:

- execute `BC-001` through `BC-012` baseline classes
- execute pairwise expanded scenarios
- strict failures block promotion

Deprecation rules:

- no removal without migration mapper + conformance evidence
- deprecated specs/docs move to `docs/archived/` with deprecation header
- deprecation timing tied to successful cutover and compatibility stability

## 5. Cutover gates and evidence

Required evidence artifacts:

- `usr-conformance-summary.json`
- `usr-backcompat-matrix-results.json`
- `usr-capability-state-transitions.json`
- `usr-determinism-rerun-diff.json`

Cutover approval requires:

- architecture + contracts owner sign-off
- explicit unresolved risk acceptance for non-blocking known issues

## 6. References

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/migration-and-backcompat.md`
- `docs/specs/usr-conformance-and-fixture-contract.md`
