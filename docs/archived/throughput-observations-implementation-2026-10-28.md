# Throughput numeric observation repair — 2026-10-28

**UNVALIDATED source:** `2dada0f772e592df2e5522e83ef67093cf7c19f1`, tree
`becaec4b4190e5387cf6fc95f830b2cd64e9815f`. Branch
`codex/pr557-audit-repairs-20261012`, Windows x64, Node 26.12.1.

#277 had two concrete remaining numeric defects: regression code discarded a
measured zero alongside unavailable values, and feature/throughput summary
fallbacks converted null observations into zero and combined unmatched counts
and clocks. The repair:

- Preserves measured zero as numeric data. A positive baseline to zero current
  rate now reports -100%; zero median baselines produce explicit non-percent
  observations with signed absolute deltas, never invented percentages.
- Rejects scalar coercion and retains missing/null/invalid current and baseline
  observations, including entirely missing modes/stages. All-unobserved
  non-total metrics retain their intentional not-applicable scope. Unknown
  baseline members do not silently become complete samples.
- Reports compared/partial/unavailable/zero-baseline/no-baseline states with
  exact coverage/exclusion counts and at most 16 detail rows per diagnostic
  array. JSON/human overviews expose counts; repo fields stay null when unknown,
  and language aggregates count actual percent comparisons rather than merely
  finding a baseline envelope.
- Reuses the existing scan observation/coverage owner for feature and throughput
  summary fallbacks. Whole totals require complete declared-mode observations;
  partial matched-subset rates retain their exact numerator/clock/mode receipt.
  Measured empty work remains admitted. Diagnostic derivation version **3**
  forces old derived content to be recomputed; native authority is preserved.

Twenty-five `tooling/reports/throughput-ledger-observations/*` cases are authored,
**unexecuted**. They cover zero current/baselines, null/absent/string/boolean/
negative/nonfinite data, incomplete baseline cohorts, missing modes/stages,
actual ledger production, scalar admission, unknown/empty feature and throughput
summaries, matched-subset clocks, stale derived-summary invalidation, bounded
diagnostics and actual report-summary collection. Existing multi-metric and
history-key tests retain all assertions and add independent numeric constants;
the existing actual CLI fixture asserts availability reporting.

Format/ESLint, ten JavaScript syntax checks, whitespace and static module-cycle
analysis (zero cycles) passed. No functional fixture, benchmark, query child,
native operation or measurement ran. No public knob, import budget, retry,
threshold or invalid-data contract was relaxed.

This is **partial #277 implementation**: compatible workload/environment/cache
and independent-attempt admission, source-bound real producer qualification,
incompatible/unknown history controls and actual serial raw measurements still
need completion. Numeric `compared` is not qualified performance. #1680's
recorded measurement owner remains in use; live structural analysis is not an
immutable historical attempt snapshot. No issue is closed. The source queue is
now **480 pending, 145 partial, 93 unresolved** of the last 718-open inventory.
PR metadata remains the verified 140-commit snapshot until its next refresh.
