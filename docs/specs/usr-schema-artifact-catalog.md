# Spec -- USR Schema and Artifact Catalog

Status: Draft v0.1
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

This catalog binds each required USR evidence artifact to canonical filename, schema path, producer, gate consumer, and retention class.

## 1. Canonical catalog table (normative)

| Artifact ID | Filename | Schema | Producer | Consumer gate | Retention |
| --- | --- | --- | --- | --- | --- |
| conformance-summary | usr-conformance-summary.json | docs/schemas/usr/usr-conformance-summary.schema.json | conformance lane | conformance gate | 180d |
| compatibility-matrix-results | usr-backcompat-matrix-results.json | docs/schemas/usr/usr-backcompat-matrix-results.schema.json | backcompat lane | migration gate | 180d |
| quality-evaluation-results | usr-quality-evaluation-results.json | docs/schemas/usr/usr-quality-evaluation-results.schema.json | quality lane | quality gate | 180d |
| quality-regression-report | usr-quality-regression-report.json | docs/schemas/usr/usr-quality-regression-report.schema.json | quality lane | readiness gate | 180d |
| threat-model-coverage-report | usr-threat-model-coverage-report.json | docs/schemas/usr/usr-threat-model-coverage-report.schema.json | security lane | security gate | 180d |
| failure-injection-report | usr-failure-injection-report.json | docs/schemas/usr/usr-failure-injection-report.schema.json | resilience lane | resilience gate | 180d |
| benchmark-summary | usr-benchmark-summary.json | docs/schemas/usr/usr-benchmark-summary.schema.json | benchmark lane | performance gate | 180d |
| observability-rollup | usr-observability-rollup.json | docs/schemas/usr/usr-observability-rollup.schema.json | observability lane | SLO gate | 180d |
| waiver-active-report | usr-waiver-active-report.json | docs/schemas/usr/usr-waiver-active-report.schema.json | waiver validator | governance gate | 90d |
| operational-readiness-validation | usr-operational-readiness-validation.json | docs/schemas/usr/usr-operational-readiness-validation.schema.json | ops validator | cutover gate | 180d |
| incident-response-drill-report | usr-incident-response-drill-report.json | docs/schemas/usr/usr-incident-response-drill-report.schema.json | ops drill runner | cutover gate | 180d |
| rollback-drill-report | usr-rollback-drill-report.json | docs/schemas/usr/usr-rollback-drill-report.schema.json | ops drill runner | cutover gate | 180d |
| release-readiness-scorecard | usr-release-readiness-scorecard.json | docs/schemas/usr/usr-release-readiness-scorecard.schema.json | audit layer | release gate | permanent |

## 2. Normative constraints

- every blocking artifact MUST have a schema in docs/schemas/usr/
- schemaVersion MUST be present and validated for all cataloged artifacts
- producer/consumer IDs MUST align with ownership map
- stale blocking artifacts MUST fail gate evaluation

## 3. References

- docs/specs/usr-evidence-catalog.md
- docs/specs/usr-gate-evaluation-algorithm.md
- docs/specs/usr-validation-cli-contract.md

## 4. Freshness classes (normative)

| Freshness class | Max age | Default gate impact |
| --- | --- | --- |
| strict-blocking | 24h | blocking on stale |
| advisory | 72h | advisory on stale |
| archival | n/a | non-gating |

## Required Fields and Tables

- Implementations MUST maintain a machine-readable table for each normative row class in this contract domain.
- Required tables MUST include stable identifiers, owner metadata, and blocking/advisory classification fields.

## Invalid Cases

- Missing required keys, unknown blocking enums, and incompatible schemaVersion MUST be invalid.
- Invalid cases MUST produce deterministic diagnostics and reason codes.

## Cross-Contract Conflict Resolution

- Conflicts between this contract and other decomposed contracts MUST be resolved via change-management workflow.
- If unresolved, umbrella USR spec precedence applies and promotion is blocked.

## Ownership and Escalation

- Primary and backup owners MUST be declared in ownership matrices.
- Escalation routing for blocking failures MUST follow the operational runbook contract.

## Change Log

- v0.1: initial draft baseline for this contract.

## Success Metrics

- Blocking-failure count for this contract domain MUST trend to zero before promotion.
- Deterministic rerun consistency for domain checks MUST remain within configured drift budget.

## Non-goals

- This contract does not replace umbrella USR semantics in docs/specs/unified-syntax-representation.md.
- This contract does not authorize bypass of strict-mode blocking behavior unless an active waiver exists.

## Rollout Behavior

- New requirements in this contract MUST be rolled out through shadow, dual-read/write, and cutover where applicable.
- Rollout deviations MUST be tracked with time-bounded waivers.

## Implementation Checklist

- [ ] Required machine-readable rows defined and validated.
- [ ] Blocking/advisory gates mapped and enforced.
- [ ] Required evidence artifacts emitted and linked in scorecard.
- [ ] Drift checks green.

## Canonical Examples

- Include at least one minimal valid example and one maximal typical example for this contract domain.
- Examples MUST be deterministic and compatible with declared schema versions.

