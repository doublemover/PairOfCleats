import assert from 'node:assert/strict';
import { THROUGHPUT_LEDGER_SCHEMA_VERSION, computeThroughputLedgerRegression,
  buildThroughputLedgerForTask } from '../../../tools/bench/language/metrics.js';
import { collectRunLedgerComparisonSummary, resolveIndexingSummary } from '../../../tools/reports/show-throughput/analysis.js';
import { toFiniteOrNull, buildIndexingSummaryFromFeatureMetrics, buildIndexingSummaryFromThroughput } from '../../../tools/reports/show-throughput/aggregate.js';
import { BENCH_MEASUREMENT_DERIVATION_VERSION } from '../../../tools/bench/language/metrics/recorded-contract.js';
import { applyTestEnv } from '../../helpers/test-env.js';

// UNVALIDATED: numeric observations are not proof of compatible workloads or
// independent attempts. This batch preserves those separate admissions.
applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
const ledger = value => ({ schemaVersion: THROUGHPUT_LEDGER_SCHEMA_VERSION,
  modalities: { code: { stages: { total: { chunksPerSec: value } } } } });
const compare = (current, baselines) => computeThroughputLedgerRegression({ currentLedger: ledger(current), baselineLedgers: baselines.map(ledger) });
if (selected === 'zero-current') {
  const diff = compare(0, [100, 100]);
  assert.equal(diff.comparedEntries, 1); assert.equal(diff.status, 'compared');
  assert.equal(diff.regressions.length, 1); assert.equal(diff.regressions[0].deltaPct, -1);
  assert.equal(diff.regressions[0].deltaRate, -100); assert.equal(diff.regressions[0].baselineMedian, 100);
} else if (selected === 'zero-baseline' || selected === 'both-zero') {
  const diff = compare(selected === 'both-zero' ? 0 : 100, [0, 0]);
  assert.equal(diff.status, 'zero-baseline'); assert.equal(diff.comparedEntries, 0);
  assert.equal(diff.coverage.zeroBaselineEntries, 1);
  assert.equal(diff.zeroBaselines[0].deltaPct, null);
  assert.equal(diff.zeroBaselines[0].deltaRate, selected === 'both-zero' ? 0 : 100);
  assert.equal(diff.zeroBaselines[0].outcome, selected);
  assert.deepEqual(diff.regressions, []); assert.deepEqual(diff.improvements, []);
} else if (selected.startsWith('current-')) {
  const values = { null: null, missing: undefined, string: '80', boolean: false, negative: -1, nan: NaN };
  const key = selected.slice('current-'.length); assert.ok(Object.hasOwn(values, key));
  const diff = compare(values[key], [100]);
  assert.equal(diff.status, 'unavailable'); assert.equal(diff.comparedEntries, 0);
  assert.equal(diff.coverage.observedCurrentEntries, 0);
  assert.equal(diff.coverage.unavailableCurrentEntries, 1);
  assert.ok(diff.exclusions.some(row => row.reason === 'current-observation-unavailable'));
} else if (selected === 'baseline-null' || selected === 'baseline-string') {
  const diff = compare(80, [selected === 'baseline-null' ? null : '100']);
  assert.equal(diff.status, 'unavailable'); assert.equal(diff.comparedEntries, 0);
  assert.equal(diff.coverage.missingBaselineEntries, 1);
  assert.ok(diff.exclusions.some(row => row.reason === 'baseline-observation-unavailable'));
} else if (selected === 'mixed-baselines') {
  const diff = compare(80, [null, 100]);
  assert.equal(diff.status, 'partial'); assert.equal(diff.comparedEntries, 1);
  assert.equal(diff.regressions[0].baselineRate, 100); assert.equal(diff.regressions[0].baselineSamples, 1);
  assert.equal(diff.regressions[0].deltaPct, -0.2);
} else if (selected === 'zero-mixed-baselines') {
  const diff = compare(80, [0, 100]);
  assert.equal(diff.status, 'compared'); assert.equal(diff.improvements[0].baselineMedian, 50);
  assert.equal(diff.improvements[0].deltaPct, 0.6); assert.equal(diff.improvements[0].baselineSamples, 2);
} else if (selected === 'no-baseline') {
  const diff = compare(80, []);
  assert.equal(diff.status, 'no-baseline'); assert.equal(diff.comparedEntries, 0);
  assert.equal(diff.coverage.observedCurrentEntries, 1); assert.equal(diff.coverage.missingBaselineEntries, 1);
} else if (selected === 'missing-current-stage') {
  const current = ledger(80); delete current.modalities.code.stages.total;
  const diff = computeThroughputLedgerRegression({ currentLedger: current, baselineLedgers: [ledger(100)] });
  assert.equal(diff.status, 'unavailable'); assert.equal(diff.coverage.unavailableCurrentEntries, 1);
} else if (selected === 'missing-baseline-stage') {
  const missing = ledger(100); delete missing.modalities.code.stages.total;
  const diff = computeThroughputLedgerRegression({ currentLedger: ledger(80), baselineLedgers: [ledger(100), missing] });
  assert.equal(diff.status, 'partial'); assert.equal(diff.regressions[0].baselineSamples, 1);
  assert.ok(diff.exclusions.some(row => row.baseline === 1 && row.reason === 'baseline-observation-unavailable'));
} else if (selected === 'missing-current-mode') {
  const baseline = ledger(100); baseline.modalities.prose = { stages: { total: { chunksPerSec: 100 } } };
  const diff = computeThroughputLedgerRegression({ currentLedger: ledger(80), baselineLedgers: [baseline] });
  assert.equal(diff.status, 'partial'); assert.equal(diff.comparedEntries, 1);
  assert.equal(diff.coverage.unavailableCurrentEntries, 1);
  assert.ok(diff.exclusions.some(row => row.modality === 'prose' && row.reason === 'current-observation-unavailable'));
} else if (selected === 'producer-unknown-zero') {
  const actual = buildThroughputLedgerForTask({ throughput: { code: { files: null, chunks: 0, totalMs: 1000 } } });
  const total = actual.modalities.code.stages.total;
  assert.equal(total.chunks, 0); assert.equal(total.chunksPerSec, 0);
  assert.equal(total.files, null); assert.equal(total.filesPerSec, null);
  const diff = computeThroughputLedgerRegression({ currentLedger: actual, baselineLedgers: [ledger(100)] });
  assert.equal(diff.regressions[0].deltaPct, -1);
  assert.equal(diff.metrics.filesPerSec.status, 'unavailable');
} else if (selected === 'finite-observation') {
  for (const value of [null, undefined, false, true, '0', '100', NaN, Infinity, -1]) assert.equal(toFiniteOrNull(value), null);
  assert.equal(toFiniteOrNull(0), 0); assert.equal(toFiniteOrNull(1.5), 1.5);
} else if (selected === 'feature-unknown') {
  const result = buildIndexingSummaryFromFeatureMetrics({ modes: { code: { totals: { count: 2, lines: null, bytes: 100, durationMs: null } } } });
  assert.equal(result.totals.files, 2); assert.equal(result.totals.bytes, 100);
  assert.equal(result.totals.lines, null); assert.equal(result.totals.durationMs, null);
  assert.equal(result.totals.linesPerSec, null);
  assert.equal(result.coverage.counters.lines.state, 'unknown');
} else if (selected === 'feature-matched-scope') {
  const result = buildIndexingSummaryFromFeatureMetrics({ modes: {
    code: { totals: { count: 2, lines: 100, durationMs: 1000 } },
    prose: { totals: { count: 2, lines: null, durationMs: 9000 } }
  } });
  assert.equal(result.totals.files, 4); assert.equal(result.totals.durationMs, 10000);
  assert.equal(result.totals.lines, null); assert.equal(result.totals.linesPerSec, null);
  const rate = result.coverage.rates.linesPerSec;
  assert.equal(rate.state, 'partial'); assert.equal(rate.numerator, 100); assert.equal(rate.durationMs, 1000);
  assert.equal(rate.measuredSubsetPerSec, 100); assert.deepEqual(rate.excludedModes, ['prose']);
} else if (selected === 'throughput-zero-summary') {
  const result = buildIndexingSummaryFromThroughput({ code: { files: 0, bytes: null, totalMs: 1000 } });
  assert.equal(result.totals.files, 0); assert.equal(result.totals.bytes, null);
  assert.equal(result.totals.lines, null); assert.equal(result.totals.durationMs, 1000);
  assert.equal(result.coverage.counters['files.candidates'].state, 'complete');
} else if (selected === 'stale-derived-summary') {
  const stale = { schemaVersion: 1, modes: { code: { files: 2, lines: 0, bytes: 100, durationMs: 0 } },
    totals: { files: 2, lines: 0, bytes: 100, durationMs: 0 }, derivation: { derivationVersion: 2 } };
  const payload = { artifacts: { indexing: stale }, generatedAt: '2026-10-28T00:00:00.000Z' };
  const actual = resolveIndexingSummary({ payload, featureMetrics: { modes: { code: { totals: { count: 2, lines: null, bytes: 100, durationMs: null } } } } });
  assert.notEqual(actual.indexingSummary, stale);
  assert.equal(actual.indexingSummary.totals.lines, null); assert.equal(actual.indexingSummary.totals.durationMs, null);
  assert.equal(actual.indexingSummary.derivation.derivationVersion, BENCH_MEASUREMENT_DERIVATION_VERSION);
  assert.ok(BENCH_MEASUREMENT_DERIVATION_VERSION > 2);
} else if (selected === 'bounded-exclusions') {
  const current = ledger(null);
  const baseline = ledger(null);
  for (let index = 0; index < 40; index++) {
    current.modalities.code.stages[`sample-${index}`] = { chunksPerSec: null };
    baseline.modalities.code.stages[`sample-${index}`] = { chunksPerSec: 100 };
  }
  const diff = computeThroughputLedgerRegression({ currentLedger: current, baselineLedgers: [baseline] });
  assert.equal(diff.exclusions.length, 16); assert.equal(diff.excludedEntries, 42); assert.equal(diff.omittedExclusions, 26);
} else if (selected === 'summary') {
  const runs = [compare(0, [100]), compare(80, [100, null]), compare(null, [100]), compare(100, [0]), compare(80, [])]
    .map(throughputLedgerDiff => ({ throughputLedgerDiff }));
  runs.push({ throughputLedgerDiff: null });
  const summary = collectRunLedgerComparisonSummary(runs);
  assert.equal(summary.scope, 'numeric-observations');
  assert.deepEqual(summary.states, { compared: 1, partial: 1, unavailable: 1, 'zero-baseline': 1, 'no-baseline': 1, 'no-ledger': 1 });
  assert.equal(summary.comparedEntries, 2); assert.equal(summary.zeroBaselineEntries, 1);
} else assert.fail(`Unknown observation control: ${selected}`);
console.log(`throughput ledger observation ${selected} passed`);
