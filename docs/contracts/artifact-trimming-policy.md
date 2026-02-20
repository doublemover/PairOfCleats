# Artifact Trimming Policy Contract

Status: Draft v1.0  
Last updated: 2026-02-20T00:00:00Z

## Purpose

Define deterministic trimming behavior for oversized artifact rows and enforce stable output semantics.

## Scope

Applies to all artifact writers that may trim records due to size/row limits.

## Deterministic trim order

1. Stable writer-defined ordering of candidate records.
2. Stable trim priority categories for optional fields.
3. Stable final row rejection when required fields cannot be preserved.

No randomized or environment-dependent ordering is allowed.

## Required invariants

1. Required fields are never dropped.
2. Trimmed output preserves schema validity.
3. Trim counters are emitted in artifact/state stats.
4. Trim reasons are deterministic and enumerable.

## Policy metadata

Each trimmed artifact path must record:

- `trimPolicyVersion`
- `trimmedRows`
- `trimmedFields`
- `trimReasonCounts`

## Compatibility policy

No legacy trim modes are supported. Active policy is authoritative.

## Related docs

- `docs/contracts/artifact-schemas.md`
- `docs/contracts/artifact-contract.md`
- `src/index/build/artifacts/writers/*`
