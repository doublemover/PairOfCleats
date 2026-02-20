# Native Acceleration Spec

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Goal

Define native acceleration scope, correctness boundaries, and hard-cutover behavior when enabled.

## Scope

- Bitmap operations used by retrieval/filter stages.
- Top-k selection and ANN primitives.
- Worker offload integration for native compute tasks.

Out of scope:

- Dual runtime support for legacy accelerated paths.
- Partial compatibility wrappers for retired implementations.

## Correctness contract

1. Native output must be semantically equivalent to active JS baseline for supported inputs.
2. Tie handling must be deterministic.
3. Error taxonomy must be stable and shared across CLI/API/MCP surfaces.

## Runtime contract

- Capability detection must be explicit and deterministic.
- Missing required native dependency in required mode is a hard failure.
- Cancellation must propagate through worker/native boundaries.

## Cutover policy

If native acceleration is adopted for a surface:

1. Native path becomes the single active implementation.
2. Superseded paths are removed in the same phase.
3. Specs/tests are updated to active behavior only.

## Required evidence

- Equivalence tests for bitmap/top-k/ANN/worker-offload behavior.
- Adversarial tie and cancellation coverage.
- Deterministic error-code coverage.

## Related docs

- `docs/perf/native-accel.md`
- `src/shared/native-accel.js`
- `src/shared/capabilities.js`
