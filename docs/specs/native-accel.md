# Native Acceleration Spec

Status: Final (No-Go) v1.0  
Last updated: 2026-02-21T00:00:00Z

## Decision

Native acceleration is **not adopted** for the active retrieval runtime. The single active runtime remains JS.

## Active contract

1. Runtime negotiation is still versioned and deterministic through `src/shared/native-accel.js`.
2. ABI mismatches must return `NATIVE_ACCEL_ABI_MISMATCH`.
3. Non-mismatch requests must deterministically return `NATIVE_ACCEL_DISABLED_NO_GO`.
4. Fallback runtime is always `js` and is deterministic.

## Scope after no-go

- Keep one runtime path in production (`js`).
- Keep feasibility parity artifacts and deterministic handshake behavior for auditability.
- Do not ship dual runtime paths, conditional native fast paths, or compatibility shims.

## Feasibility evidence retained

- `tests/retrieval/native/feasibility-parity-harness.test.js`
- `tests/retrieval/native/abi-handshake-version-mismatch.test.js`
- `tests/retrieval/native/fallback-contract.test.js`
- `tests/retrieval/native/no-go-capability-surface.test.js`
- `tests/retrieval/native/no-go-docs-spec-consistency.test.js`

## Related docs

- `docs/perf/native-accel.md`
- `docs/archived/native-accel-adoption-go-path.md`
- `src/shared/native-accel.js`
- `src/shared/capabilities.js`
