# Spec -- USR Implementation Playbook

Status: Draft v0.3
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

This playbook defines the implementation sequence for delivering USR contracts with controlled risk and measurable readiness.

It is execution-focused and maps contract families to phase gates, required evidence, and rollback-safe milestones.

## 1. Execution sequence (normative)

1. Phase 0: governance lock
- freeze contract precedence
- assign owners and escalation paths
- validate contract inventory and drift checks

2. Phase 1: registry and schema lock
- complete matrix schema and invariant validators
- establish deterministic matrix generation pipeline
- block unknown keys and missing required rows

3. Phases 2-6: modeling and runtime core
- identity stability, parser adapters, normalization, and resolution
- language/framework semantic overlays and risk wiring
- incremental/index/package/runtime behavior controls

4. Phases 7-10: conformance and migration
- fixture families and conformance lanes
- compatibility matrix and dual-write/shadow-read rollout
- quality, threat, and failure-injection gates

5. Phases 11-15: scale-out and release operations
- language batch expansion
- framework expansion and edge canonicalization closure
- operational drills, scorecards, and release train cutover
- testing policy and schema-catalog enforcement closure

## 2. Minimum implementation slice (normative)

The mandatory first slice is:

- language: `typescript`
- framework: `vue`
- domains: parsing, normalization, linking, route/template/style canonicalization, risk baseline, reporting

Slice completion requires strict-mode green results for all blocking gates in this scope.

## 3. Entry/exit criteria by milestone

| Milestone | Entry criteria | Exit criteria |
| --- | --- | --- |
| registry-ready | contract inventory complete | schema + cross-registry checks green |
| parser-ready | registry-ready | parser adapter conformance green |
| semantic-ready | parser-ready | normalization + linking + risk baseline green |
| conformance-ready | semantic-ready | required C-level lanes green |
| rollout-ready | conformance-ready | backcompat and operational readiness green |
| release-ready | rollout-ready | scorecard has zero blocking findings |

## 4. Rollback-safe controls

- every rollout stage must have explicit rollback condition and owner
- feature flags for new behavior must default to safe values until promotion
- release decisions must consume latest valid evidence artifacts only
- expired waivers cannot be used for cutover gates

## 5. Required evidence outputs

- `usr-implementation-playbook-validation.json`
- `usr-implementation-playbook-drift-report.json`
- `usr-release-readiness-scorecard.json`

## 6. References

- `TES_LAYN_ROADMAP.md`
- `docs/specs/unified-syntax-representation.md`
- `docs/specs/usr-evidence-catalog.md`
- `docs/specs/usr-rollout-and-migration-contract.md`
- `docs/specs/usr-operational-runbook-contract.md`
- `docs/specs/usr-schema-artifact-catalog.md`
- `docs/testing/usr-*.md`
