# USR New Language Onboarding Guide

Last updated: 2026-02-11T07:25:00Z

## Purpose

Define mandatory steps for adding a registry language with deterministic, testable USR behavior.

## Preconditions

- language added to `src/index/language-registry/registry-data.js`
- owner assigned per `docs/specs/usr-core-governance-change.md`
- rollout plan defined per `docs/specs/usr-core-rollout-release-migration.md`

## Required specification updates

1. Catalog updates
- `docs/specs/usr-core-language-framework-catalog.md`
- `tests/lang/matrix/usr-language-profiles.json`
- `tests/lang/matrix/usr-capability-matrix.json`

2. Semantics updates
- `docs/specs/usr-core-normalization-linking-identity.md`
- raw-kind mapping, resolution ambiguity policy, identity stability constraints

3. Security/risk updates
- `docs/specs/usr-core-security-risk-compliance.md`
- risk source/sink/sanitizer coverage (if applicable)

4. Test/conformance updates
- `docs/specs/usr-core-quality-conformance-testing.md`
- required fixture families, C-level targets, expected diagnostics

5. Roadmap updates
- `TES_LAYN_ROADMAP.md` language batch and gate sections
- `docs/specs/usr-consolidation-coverage-matrix.md` if new normative scope is introduced

## Promotion gates

- schema and invariant checks green
- required conformance levels green
- compatibility matrix scenarios green for impacted surfaces
- blocking security/performance/quality gates green
- release-readiness scorecard evidence updated
