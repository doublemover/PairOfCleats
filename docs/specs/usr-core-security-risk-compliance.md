# Spec -- USR Core Security, Risk, and Compliance Contract

Status: Draft v2.0
Last updated: 2026-02-11T07:40:00Z

## Purpose

Define threat/risk taxonomy, data governance policy, and compliance gates across languages and framework profiles.

## Consolidated source coverage

This contract absorbs:

- `docs/specs/usr-language-risk-contract.md`
- `docs/specs/usr-security-and-data-governance-contract.md`
- `docs/specs/usr-data-classification-contract.md`
- `docs/specs/usr-threat-model-and-abuse-case-contract.md`
- `docs/specs/usr-threat-response-playbook-catalog.md`
- `docs/specs/usr-supply-chain-integrity-contract.md`
- `docs/specs/usr-license-and-third-party-attribution-contract.md`

## Risk taxonomy model

Per language/framework profile, risk coverage must define:

- sources
- sinks
- sanitizers
- propagation boundaries
- unsupported surfaces

## Data governance policy

Data classes must define handling policy for:

- collection
- retention
- redaction
- export/reporting

Strict mode must fail closed for violations in protected classes.

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

## Required outputs

- `usr-threat-model-coverage-report.json`
- `usr-security-gate-results.json`
- `usr-redaction-validation.json`
- `usr-risk-coverage-summary.json`
- `usr-supply-chain-integrity-report.json`

## References

- `docs/specs/usr-core-language-framework-catalog.md`
- `docs/specs/usr-core-evidence-gates-waivers.md`
