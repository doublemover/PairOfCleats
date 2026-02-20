# USR Guardrails In CI + Perf

This document tracks itemized USR section guardrails (items 35-40) and where each script is wired.

## CI Entry Point

`tools/ci/run-suite.js` runs each configured USR gate and writes reports under the configured diagnostics root (`<diagnostics>/usr/`).

## Perf Entry Point

`tools/bench/language-repos.js` runs configured USR benchmark snapshots once per run and stores JSON output in `<resultsRoot>/usr/`.

## Item 35 - Per-framework edge canonicalization

Config:
- `docs/config/usr-guardrails/item-35-framework-canonicalization.json`

Gate:
- `tools/ci/usr/item35-framework-canonicalization-gate.js`
- Report: `usr-section-35-framework-canonicalization-report.json`

Bench:
- `tools/bench/usr/item35-framework-canonicalization.js`
- Snapshot: `item35-framework-canonicalization.json`

## Item 36 - Mandatory backward-compatibility matrix

Config:
- `docs/config/usr-guardrails/item-36-backcompat-matrix.json`

Gate:
- `tools/ci/usr/item36-backcompat-matrix-gate.js`
- Report: `usr-section-36-backcompat-matrix-report.json`

Bench:
- `tools/bench/usr/item36-backcompat-matrix.js`
- Snapshot: `item36-backcompat-matrix.json`

## Item 37 - Decomposed contract governance

Config:
- `docs/config/usr-guardrails/item-37-governance-drift.json`

Gate:
- `tools/ci/usr/item37-governance-drift-gate.js`
- Report: `usr-section-37-governance-drift-report.json`

Bench:
- `tools/bench/usr/item37-governance-drift.js`
- Snapshot: `item37-governance-drift.json`

## Item 38 - Core language/framework catalog

Config:
- `docs/config/usr-guardrails/item-38-catalog-contract.json`

Gate:
- `tools/ci/usr/item38-catalog-contract-gate.js`
- Report: `usr-section-38-catalog-contract-report.json`

Bench:
- `tools/bench/usr/item38-catalog-contract.js`
- Snapshot: `item38-catalog-contract.json`

## Item 39 - Core normalization/linking/identity

Config:
- `docs/config/usr-guardrails/item-39-normalization-linking-identity.json`

Gate:
- `tools/ci/usr/item39-normalization-linking-identity-gate.js`
- Report: `usr-section-39-normalization-linking-report.json`

Bench:
- `tools/bench/usr/item39-normalization-linking-identity.js`
- Snapshot: `item39-normalization-linking-identity.json`

## Item 40 - Core pipeline/incremental/transforms

Config:
- `docs/config/usr-guardrails/item-40-pipeline-incremental-transforms.json`

Gate:
- `tools/ci/usr/item40-pipeline-incremental-transforms-gate.js`
- Report: `usr-section-40-pipeline-incremental-report.json`

Bench:
- `tools/bench/usr/item40-pipeline-incremental-transforms.js`
- Snapshot: `item40-pipeline-incremental-transforms.json`
