# Native Acceleration Performance Plan

Status: Final (No-Go) v1.0  
Last updated: 2026-02-21T00:00:00Z

## Decision summary

Native acceleration is not active. Performance work remains focused on JS runtime indexing/retrieval hot paths.

## Retained feasibility evidence

The feasibility parity harness is retained as an audit artifact but is not a release gate for production behavior:

- `tests/retrieval/native/feasibility-parity-harness.test.js`
- `tests/retrieval/native/abi-handshake-version-mismatch.test.js`
- `tests/retrieval/native/fallback-contract.test.js`

## Active measurement scope

- End-to-end query latency on canonical JS runtime.
- Stage-level latency from existing retrieval telemetry.
- Memory headroom and deterministic cache behavior in JS runtime.

## Related docs

- `docs/specs/native-accel.md`
- `docs/perf/retrieval-pipeline.md`
