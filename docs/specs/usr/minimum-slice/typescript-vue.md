# USR Minimum Slice: TypeScript + Vue

Status: Draft v1.0
Last updated: 2026-02-12T01:55:00Z

## Purpose

Define the minimum implementable slice used to validate the end-to-end USR architecture before full language/framework rollout.

## Scope

- Language profile: `typescript`
- Framework profile: `vue`
- Required domains: parsing, normalization, linking, route/template/style canonicalization, risk baseline, report envelope validation

## Required fixtures

- `typescript::minimum-slice::vue-module-001`
- `vue::minimum-slice::template-style-001`

Fixture source root:

- `tests/fixtures/usr/minimum-slice/typescript-vue`

## Required outputs

- `usr-conformance-summary.json`
- `usr-validation-report.json`
- `usr-quality-evaluation-results.json`
- `usr-threat-model-coverage-report.json`
- `usr-release-readiness-scorecard.json`

## Exit checks

- `typescript` C0-C4 slice checks are green under strict mode.
- `vue` C4 overlay checks are green under strict mode.
- Capability transition diagnostics use canonical IDs only.
- Report envelope fields (`runId`, `lane`, `buildId`, `status`) are present in all slice outputs.
