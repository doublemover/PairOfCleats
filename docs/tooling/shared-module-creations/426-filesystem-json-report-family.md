# Shared Module Creation: #426

- Issue: `#426`
- Title: `Identify and create shared filesystem, JSON, report-writing, and small persistence helper modules`
- Created: `2026-03-26`

## What landed

- New canonical shared owner: [json-file.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\json-file.js)

## Duplicate clusters addressed

1. The `tools/ci/usr` gates were all hand-rolling the same JSON config load and JSON report write flow.
2. Several parity and smoke tests had small one-off JSON fixture/report helpers that were doing the same generic work.

## Why this approach is best

- The repeated behavior was narrow and well-defined: read a JSON file, or write a pretty JSON file and create parent directories first.
- Hoisting that into one tiny helper removes repetition without creating a broad filesystem junk drawer.
- Artifact-specific JSONL and atomic persistence behavior already has better-specialized owners and was intentionally left alone.

## Migrations completed

- [item35-framework-canonicalization-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item35-framework-canonicalization-gate.js)
- [item36-backcompat-matrix-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item36-backcompat-matrix-gate.js)
- [item37-governance-drift-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item37-governance-drift-gate.js)
- [item38-catalog-contract-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item38-catalog-contract-gate.js)
- [item39-normalization-linking-identity-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item39-normalization-linking-identity-gate.js)
- [item40-pipeline-incremental-transforms-gate.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\ci\usr\item40-pipeline-incremental-transforms-gate.js)
- [risk-delta-surface-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\analysis\risk-delta-surface-parity.test.js)
- [bench-language-rollout-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\bench-language-rollout-gate.smoke.test.js)
- [import-resolution-slo-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\import-resolution-slo-gate.smoke.test.js)
- [stage-usage-checklist.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\perf\indexing\validate\stage-usage-checklist.test.js)

## What intentionally stayed local

- artifact-specific JSONL writers
- atomic persistence and retry behavior
- temp-root lifecycle helpers

Those have different semantics and should stay with their more specialized owners.

## Historical follow-up notes

These are not active roadmap tasks. Reopen this family only from a fresh generated-output duplication signal or report-writing contract drift:

- migrate repeated generic JSON fixture/report helpers only when their behavior matches [json-file.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\json-file.js)
- keep avoiding a broad all-purpose filesystem helper unless a current scan shows a tighter repeated family
