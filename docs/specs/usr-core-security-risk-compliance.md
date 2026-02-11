# Spec -- USR Core Security, Risk, and Compliance Contract

Status: Draft v2.0
Last updated: 2026-02-11T08:35:00Z

## Purpose

Define threat/risk taxonomy, data governance policy, and compliance gates across languages and framework profiles.

## Consolidated source coverage

This contract absorbs:

- `usr-language-risk-contract.md` (legacy)
- `usr-security-and-data-governance-contract.md` (legacy)
- `usr-data-classification-contract.md` (legacy)
- `usr-threat-model-and-abuse-case-contract.md` (legacy)
- `usr-threat-response-playbook-catalog.md` (legacy)
- `usr-supply-chain-integrity-contract.md` (legacy)
- `usr-license-and-third-party-attribution-contract.md` (legacy)

## Risk taxonomy model

Per language/framework profile, risk coverage must define:

- sources
- sinks
- sanitizers
- propagation boundaries
- unsupported surfaces

Risk row schema requirements:

| Field | Required | Notes |
| --- | --- | --- |
| `scopeId` | yes | language or framework profile scope |
| `sources` | yes | enumerated source classes |
| `sinks` | yes | enumerated sink classes |
| `sanitizers` | yes | enumerated sanitizer classes |
| `propagationRules` | yes | required data/control propagation semantics |
| `unsupportedRiskSurfaces` | yes | explicit unsupported classes with diagnostics |

## Data governance policy

Data classes must define handling policy for:

- collection
- retention
- redaction
- export/reporting

Strict mode must fail closed for violations in protected classes.

Data-class minimums:

- class definitions must include confidentiality and handling policy
- redaction policy must define deterministic masking format
- export policy must define allowed destinations and controls

## Threat/abuse coverage

Threat catalog rows must map to executable fixture families and expected controls.

Critical classes must be represented in CI and CI-long lanes.

## Supply-chain/license policy

Blocking checks include:

- disallowed dependency provenance
- incompatible license class for configured policy
- tamper/integrity failures in required artifacts

## Interprocedural gating

When interprocedural risk analysis is required by profile:

- minimum traversal and confidence constraints must be met
- unresolved high-risk paths must be reported explicitly
- blocking risk thresholds must feed gate evaluator

Interprocedural mandatory controls:

1. max traversal depth policy by profile
2. confidence floor per propagation class
3. unresolved high-severity path budget thresholds
4. deterministic sink classification for unresolved candidates

## Required outputs

- `usr-threat-model-coverage-report.json`
- `usr-security-gate-results.json`
- `usr-redaction-validation.json`
- `usr-risk-coverage-summary.json`
- `usr-supply-chain-integrity-report.json`
- `usr-license-policy-evaluation.json`
- `usr-interprocedural-gating-report.json`

## References

- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
