import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';
import { loadBenchPolicy, evaluateBenchVerdict } from '../../../tools/bench/language/verdict.js';
import { buildReportOutput } from '../../../tools/bench/language/report.js';
import { validateBenchComparisonInput } from '../../../src/contracts/bench-comparison-input.js';

applyTestEnv();
const { dir } = await prepareIsolatedTestCacheDir('waiver-report-count-consumer');
const healthy = { repo: 'healthy', language: 'javascript', tier: 'small', summary: { queries: 1, buildMs: { index: 1, sqlite: 0 } } };
const failed = { repo: 'failed', language: 'javascript', tier: 'small', failed: true, failureReason: 'bench', failureCode: 1 };
const loadErrors = ['first invalid policy row', 'second invalid policy row'];
for (const tasks of [[], [healthy], [healthy, failed]]) {
  const result = evaluateBenchVerdict({ tasks, policy: { loadErrors, waivers: [] } });
  assert.equal(result.run.repoCounts.total, tasks.length);
  assert.equal(result.run.repoCounts.passed, tasks.includes(healthy) ? 1 : 0);
  assert.equal(result.run.repoCounts.failed, tasks.includes(failed) ? 1 : 0);
  assert.equal(result.run.repoCounts.skipped, 0); assert.equal(result.run.repoCounts.passedWithDegradation, 0);
  assert.equal(result.run.exitCode, 1); assert.equal(result.run.productionClean.status, 'fail');
  assert.equal(result.run.issues.unwaived.filter(row => row.repo === null).length, 2);
  assert.deepEqual(result.run.issues.unwaived.filter(row => row.repo === null).map(row => row.message), loadErrors);
}
const waiverFile = path.join(dir, 'waivers.json');
const valid = { id: 'bounded', owner: 'fixture-owner', justification: 'known failed task',
  allowedUntil: '2099-01-01T00:00:00.000Z', failureClass: 'benchmark_failed', repo: 'failed' };
for (const waivers of [[valid], [{ ...valid, allowedUntil: '2000-01-01T00:00:00Z' }],
  [valid, { ...valid, id: 'bad', allowedUntil: null }], [valid, { ...valid }],
  [valid, { id: 'malformed' }]]) {
  await fs.writeFile(waiverFile, JSON.stringify({ schemaVersion: 1, waivers }));
  const policy = await loadBenchPolicy({ waiverFile });
  const report = await buildReportOutput({ configPath: path.join(process.cwd(), 'benchmarks/repos.json'),
    cacheRoot: path.join(dir, 'cache'), resultsRoot: path.join(dir, 'results'),
    results: [healthy, failed], config: { javascript: { label: 'JavaScript' } }, waiverFile });
  assert.equal(report.run.repoCounts.total, 2); assert.equal(report.run.repoCounts.passed, 1); assert.equal(report.run.repoCounts.failed, 1);
  assert.equal(Object.values(report.run.countsByResultClass).reduce((sum, count) => sum + count, 0), 2);
  if (policy.loadErrors.length) {
    assert.equal(report.run.exitCode, 1); assert.equal(report.run.policy.activeWaiverCount, 0);
    assert.equal(report.run.issues.unwaived.filter(row => row.repo === null).length, policy.loadErrors.length);
  }
  if (waivers.length === 1 && waivers[0].allowedUntil.startsWith('2099')) {
    assert.equal(report.run.policy.activeWaiverCount, 1);
    assert.equal(report.run.issues.waived.length, 1, 'the valid future waiver still applies to its explicit failure');
    assert.equal(report.run.exitCode, 0);
  }
  if (waivers.length === 1 && waivers[0].allowedUntil.startsWith('2000')) {
    assert.equal(report.run.policy.activeWaiverCount, 0);
    assert.equal(report.run.exitCode, 1);
  }
  // The comparison contract still requires independently observed diagnostic
  // parity. Supply that separate control without changing producer counts.
  const roundtrip = JSON.parse(JSON.stringify({ ...report, diagnostics: { ...report.diagnostics,
    crashRetention: { retainedCount: 0 }, parity: { status: 'ok', mismatchCount: 0, materialMismatchCount: 0 } } }));
  const admitted = validateBenchComparisonInput(roundtrip);
  assert.equal(admitted.ok, true, admitted.errors.join('; '));
}
console.log('Actual waiver verdict/report and comparison admission keep policy findings separate from exact repository counts.');
