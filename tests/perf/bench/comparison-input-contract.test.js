import assert from 'node:assert/strict';
import { BENCH_VERDICT_SCHEMA_VERSION, validateBenchComparisonInput } from '../../../src/contracts/bench-comparison-input.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

// Authored actual report-producer/contract controls; execution deferred.
ensureTestingEnv(process.env);
const valid = {
  generatedAt: '2026-10-22T00:00:00.000Z',
  run: { schemaVersion: BENCH_VERDICT_SCHEMA_VERSION, aggregateResultClass: 'repo_failed',
    repoCounts: { total: 3, failed: 1, passed: 1, passedWithDegradation: 1, skipped: 0 },
    countsByResultClass: { repo_failed: 1, passed: 1, passed_with_degradation: 1 },
    countsByDiagnosticType: { parser_crash: 1 } },
  diagnostics: { crashRetention: { retainedCount: 1 }, parity: { status: 'ok', mismatchCount: 0, materialMismatchCount: 0 } },
  overallSummary: { buildMs: { index: 0, sqlite: null } }
};
assert.equal(validateBenchComparisonInput(valid).ok, true);
for (const value of [{}, [], null, { unrelated: true }, { run: { repoCounts: { total: 10, failed: 11, passed: -1 } } }]) {
  assert.equal(validateBenchComparisonInput(value).ok, false, 'unrelated JSON cannot stand in for evidence');
}
const invalid = mutate => {
  const input = structuredClone(valid);
  mutate(input);
  const result = validateBenchComparisonInput(input);
  assert.equal(result.ok, false);
  assert.ok(result.errors.length);
};
for (const value of [undefined, null, false, '', '1', -1, 0.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1]) {
  invalid(input => { input.run.repoCounts.failed = value; });
  invalid(input => { input.run.countsByResultClass.repo_failed = value; });
  invalid(input => { input.diagnostics.crashRetention.retainedCount = value; });
  invalid(input => { input.diagnostics.parity.mismatchCount = value; });
}
invalid(input => { delete input.run.schemaVersion; });
invalid(input => { input.run.schemaVersion = BENCH_VERDICT_SCHEMA_VERSION + 1; });
invalid(input => { input.run.repoCounts.total = 4; });
invalid(input => { input.run.countsByResultClass = {}; });
invalid(input => { input.run.countsByDiagnosticType.parser_crash = 4; });
invalid(input => { delete input.diagnostics.parity; });
invalid(input => { input.diagnostics.parity.materialMismatchCount = 1; });
invalid(input => { input.diagnostics.parity.status = 'warn'; });
invalid(input => { input.generatedAt = 'unknown'; });
for (const value of [false, '', '0', -1, Infinity, NaN, {}]) {
  invalid(input => { input.overallSummary.buildMs.index = value; });
  invalid(input => { input.overallSummary.queryWallMsPerSearch = value; });
}
for (const overallSummary of [undefined, null, {}, { buildMs: null }, { buildMs: { index: null } }]) {
  assert.equal(validateBenchComparisonInput({ ...valid, overallSummary }).ok, true, 'unavailable timings stay unavailable');
}
const empty = structuredClone(valid);
Object.assign(empty.run.repoCounts, { total: 0, passed: 0, passedWithDegradation: 0, failed: 0, skipped: 0 });
empty.run.countsByResultClass = {}; empty.run.countsByDiagnosticType = {};
assert.equal(validateBenchComparisonInput(empty).ok, false);
Object.assign(empty.run.repoCounts, { total: 3, skipped: 3 });
empty.run.countsByResultClass = { skipped: 3 };
assert.equal(validateBenchComparisonInput(empty).ok, false, 'an all-skipped report has no evaluated repository');

const output = await buildReportOutput({ configPath: 'comparison-fixture.json', cacheRoot: null, resultsRoot: null,
  config: { javascript: { label: 'JavaScript', repos: {} } }, results: [
    { language: 'javascript', tier: 'small', repo: 'fixture/one', summary: {
      backends: ['memory'], latencyMsAvg: { memory: 0 }, hitRate: { memory: 1 }, resultCountAvg: { memory: 1 },
      memoryRss: { memory: { mean: 1024 } }, buildMs: { index: 0 } } }
  ] });
const roundtrip = JSON.parse(JSON.stringify(output));
const validation = validateBenchComparisonInput(roundtrip);
assert.equal(validation.ok, true, validation.errors.join('; '));
assert.equal(roundtrip.run.repoCounts.total, 1);
assert.equal(roundtrip.overallSummary.buildMs.index, 0, 'a measured zero remains distinct from unknown');
console.log('Benchmark comparison contract controls authored; execution deferred.');
