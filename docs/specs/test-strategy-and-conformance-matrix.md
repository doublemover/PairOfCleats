# Phase 12 -- Test Strategy and Conformance Matrix

Last updated: 2026-02-11T07:25:00Z

This document is normative for Phase 12 testing and parity behavior.

## Authoritative references

- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-core-quality-conformance-testing.md`
- `docs/specs/usr-core-rollout-release-migration.md`
- `docs/specs/usr-core-normalization-linking-identity.md`
- `docs/specs/usr-core-pipeline-incremental-transforms.md`
- `docs/specs/usr-core-artifact-schema-catalog.md`
- `docs/specs/usr-core-observability-performance-ops.md`
- `docs/specs/usr-core-security-risk-compliance.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`

## Non-negotiable constraints

- tests must be hermetic and deterministic
- API and MCP envelope parity must be asserted via normalized comparisons
- no silent schema-field acceptance
- fixture mutation must be attributable and gated

## Deterministic fixture strategy

- use minimum fixture repositories with controlled cache/work roots
- normalize path/timing nondeterminism before parity comparison
- keep embeddings/network off in deterministic lanes

## Required test layers

1. unit contracts
2. service/protocol tests
3. API vs MCP parity tests
4. compatibility matrix tests
5. resilience/failure-injection tests

## Conformance classes

- C0: schema + envelope shape
- C1: identity + normalization stability
- C2: linking/resolution parity
- C3: risk/security behavior
- C4: framework route/template/style + hydration behavior

Each language/framework profile must declare required class and pass criteria.

## CI policy

- strict compatibility scenarios are blocking
- non-strict scenarios are advisory by default but still reported
- expanded pairwise compatibility runs in `ci-long`
- gate evidence outputs are required for release readiness
