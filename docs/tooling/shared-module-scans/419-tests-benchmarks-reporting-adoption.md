# Shared-Module Scan: #419

- Issue: `#419`
- Title: `Scan tests, fixtures, benchmarks, and reporting surfaces for missed shared-module adoption`
- Scan date: `2026-03-26`

## Summary

This surface already has good local reuse, especially in:

- [tests/helpers/test-env.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\test-env.js)
- [tests/helpers/test-cache.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\test-cache.js)
- [tests/helpers/api-server.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\api-server.js)
- [tests/helpers/analysis-surface-parity.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\analysis-surface-parity.js)

The right cleanup here is not to hoist test semantics into production shared code. The real adoption work is:

- use the existing test helpers more consistently
- reduce repeated report-generator CLI/JSON boilerplate
- continue consolidating parity-harness setup where it is already clearly shared

## Adoption Matrix

### 1. Temp-root and env setup in tests

Shared modules to prefer:
- [test-cache.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\test-cache.js)
- [test-env.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\test-env.js)

Representative local implementations:
- [canonical-workflows.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\cli\general\canonical-workflows.test.js)
- [capability-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\capability-gate.smoke.test.js)
- [bench-language-rollout-gate.smoke.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\ci\bench-language-rollout-gate.smoke.test.js)
- [onnx-cpu-tuning-and-token-cache.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\indexing\embeddings\onnx-cpu-tuning-and-token-cache.test.js)
- [paths-builds-root.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\tooling\dict-utils\paths-builds-root.test.js)

Best action:
- Prefer the existing test helpers over raw `mkdtemp` or hand-rolled `process.env` mutation when the test is not explicitly asserting raw environment behavior.

### 2. Report generator CLI scaffolding

Shared modules to prefer:
- [cli.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\cli.js)
- [stable-json.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\stable-json.js)
- [json-stream.js](C:\Users\sneak\Development\DOUBLECLEAT\src\shared\json-stream.js)

Representative local implementations:
- [show-throughput.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\show-throughput.js)
- [diagnostics-report.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\diagnostics-report.js)
- [parity-matrix.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\parity-matrix.js)
- [combined-summary.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\combined-summary.js)
- [metrics-dashboard.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\metrics-dashboard.js)
- [report-code-map.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\report-code-map.js)
- [repo-inventory.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\docs\repo-inventory.js)
- [script-inventory.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\docs\script-inventory.js)
- [report.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\test_times\report.js)

Best action:
- Share CLI parsing and JSON/report-writing boilerplate where semantics are identical.
- Keep aggregation and rendering logic local to each report.

### 3. Parity harnesses and API fixture setup

Shared modules to prefer:
- [analysis-surface-parity.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\analysis-surface-parity.js)
- [api-server.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers\api-server.js)

Representative local implementations:
- [risk-explain-surface-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\analysis\risk-explain-surface-parity.test.js)
- [risk-delta-surface-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\analysis\risk-delta-surface-parity.test.js)
- [strict-evidence-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\context-pack\strict-evidence-parity.test.js)
- [risk-filters-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\context-pack\risk-filters-parity.test.js)
- [federated-risk-parity.test.js](C:\Users\sneak\Development\DOUBLECLEAT\tests\context-pack\federated-risk-parity.test.js)

Best action:
- Keep extending these existing helpers instead of letting each parity suite grow bespoke setup.

## Healthy No-Adopt Zones

- [tests/helpers](C:\Users\sneak\Development\DOUBLECLEAT\tests\helpers)
  - healthy local shared test surface
- [benchmarks/repos](C:\Users\sneak\Development\DOUBLECLEAT\benchmarks\repos)
  - fixture payload, not adoption target
- [tools/bench](C:\Users\sneak\Development\DOUBLECLEAT\tools\bench)
  - share low-level helpers selectively, keep workload semantics local
- [show-throughput.js](C:\Users\sneak\Development\DOUBLECLEAT\tools\reports\show-throughput.js)
  - domain-specific aggregation/rendering should remain local

## Recommended Follow-On Issues

- `#426`: if low-level JSON/report/file boilerplate still feels too fragmented after H31
- `#428`: for the shared test-harness/helper follow-on work
- `#432`: for prioritizing the concrete cleanup queue after the full shared-module scan program is done
