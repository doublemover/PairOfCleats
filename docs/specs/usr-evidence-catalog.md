# Spec -- USR Evidence Catalog

Status: Draft v0.3
Last updated: 2026-02-11T05:30:00Z

## 0. Purpose and scope

This specification defines the canonical inventory of evidence artifacts required to promote USR phases and language/framework profiles.

It establishes:

- artifact ID and filename standards
- producer and consumer ownership
- freshness/retention policy
- release gate linkage requirements

## 1. Canonical evidence artifact inventory (normative)

| Artifact ID | Required filename | Produced by | Consumed by |
| --- | --- | --- | --- |
| `conformance-summary` | `usr-conformance-summary.json` | conformance lanes | conformance gates, readiness scorecard |
| `compatibility-matrix-results` | `usr-backcompat-matrix-results.json` | backcompat harness | migration and rollout gates |
| `quality-evaluation-results` | `usr-quality-evaluation-results.json` | quality harness | quality gates, release readiness |
| `quality-regression-report` | `usr-quality-regression-report.json` | quality harness | release readiness and triage |
| `threat-coverage-report` | `usr-threat-model-coverage-report.json` | security harness | security gates and operational review |
| `failure-injection-report` | `usr-failure-injection-report.json` | resilience harness | failure and rollout gates |
| `benchmark-summary` | `usr-benchmark-summary.json` | benchmark harness | performance and capacity gates |
| `observability-rollup` | `usr-observability-rollup.json` | observability pipeline | SLO and release gates |
| `waiver-active-report` | `usr-waiver-active-report.json` | waiver validator | rollout, governance, and CI checks |
| `operational-readiness-validation` | `usr-operational-readiness-validation.json` | operational validator | cutover gates |
| `incident-drill-report` | `usr-incident-response-drill-report.json` | operations drills | cutover and incident readiness |
| `rollback-drill-report` | `usr-rollback-drill-report.json` | operations drills | cutover and rollback authority |
| `release-readiness-scorecard` | `usr-release-readiness-scorecard.json` | audit/reporting layer | release train decision gate |

## 2. Required metadata envelope (normative)

Every evidence artifact MUST include:

- `artifactId`
- `schemaVersion`
- `generatedAt` (ISO 8601 UTC)
- `producerId` and `producerVersion`
- `scope` (`global` / `lane` / `language` / `framework`)
- `blockingFindings` and `advisoryFindings` counts
- `sourceInputs` (fixture set, matrix IDs, config hash)

## 3. Freshness and retention policy

- blocking gate artifacts must be generated in the same CI run used for promotion decisions
- stale artifact threshold for blocking gates is `24h`
- stale artifact threshold for advisory gates is `72h`
- retention:
  - blocking evidence: `180 days`
  - advisory evidence: `90 days`
  - release scorecards: permanent for released versions

## 4. Missing and stale evidence behavior

- missing required blocking artifact is a hard-block
- stale required blocking artifact is a hard-block unless active, unexpired waiver exists
- missing advisory artifact emits warning plus owner assignment and ETA

## 5. Required validation outputs

- `usr-evidence-catalog-validation.json`
- `usr-evidence-catalog-drift-report.json`
- `usr-evidence-freshness-report.json`

## 6. References

- `docs/specs/usr-audit-and-reporting-contract.md`
- `docs/specs/usr-implementation-readiness-contract.md`
- `docs/specs/usr-release-train-contract.md`
- `docs/specs/usr-waiver-and-exception-contract.md`
- `docs/specs/usr-schema-artifact-catalog.md`
- `docs/schemas/usr/*.json`
- `TES_LAYN_ROADMAP.md`
