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
