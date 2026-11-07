import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { runNode } from '../../helpers/run-node.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv();
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('perf/bench/vfs-producer-accounting/')[1];
const clock = pathToFileURL(path.resolve('tests/fixtures/benchmarks/controlled-clock.js')).href;
const run = (script, args, mode = 'read') => {
  const result = runNode(['--import', clock + '?mode=' + mode, 'tools/bench/vfs/' + script + '.js', ...args, '--json'],
    'actual VFS producer accounting ' + selected, process.cwd(), process.env, { stdio: 'pipe', allowFailure: true, timeoutMs: 20000 });
  assert.equal(result.status, 0, result.stderr || result.stdout); return JSON.parse(result.stdout);
};
if (selected === 'segments') {
  for (const count of [1, 3]) for (const samples of [1, 3, 10]) {
    const output = run('segment-hash-cache', ['--segments', String(count), '--unique', String(count), '--size', '8', '--samples', String(samples)], 'hash');
    const baseline = output.bench.noCache;
    assert.equal(baseline.completedOperations, count); assert.equal(baseline.effectiveSamples, Math.min(count, samples));
    assert.equal(baseline.bucketOperations.reduce((sum, value) => sum + value, 0), count);
    assert.equal(baseline.totalMs, count * 10); assert.equal(baseline.opsPerSec, 100);
  }
} else if (selected === 'coalesce') {
  for (const samples of [1, 3, 5]) {
    const report = run('coalesce-docs', ['--files', '2', '--segments', '12', '--samples', String(samples)]);
    const arms = report.bench || report;
    for (const label of ['baseline', 'coalesce']) {
      const arm = arms[label]; assert.equal(arm.docsBefore, 24); assert.equal(arm.completedOperations, 24 * samples);
      assert.equal(arm.completedOutputDocuments, arm.docsAfter * samples); assert.equal(arm.completedSamples, samples);
      assert.equal(arm.totalMs, samples * 10); assert.equal(arm.opsPerSec, arm.docsBefore * 100);
    }
  }
} else if (selected === 'manifest') {
  for (const samples of [1, 3, 5]) {
    const report = run('parallel-manifest-build', ['--segments', '8', '--segmentBytes', '16', '--concurrency', '1', '--samples', String(samples)]);
    const arm = report.scenarios[0]; assert.equal(arm.completedRows, arm.rows * samples);
    assert.equal(arm.completedSamples, samples); assert.equal(arm.rowsPerSec, arm.rows * 100);
  }
} else if (selected === 'merge') {
  for (const samples of [1, 3, 5]) {
    const report = run('merge-runs-heap', ['--runs', '3', '--runSize', '8', '--samples', String(samples)]);
    const arms = report.scenarios[0]; assert.equal(arms.items, 24);
    for (const label of ['linear', 'heap']) {
      const arm = arms[label]; assert.equal(arm.completedItems, arm.items * samples);
      assert.equal(arm.itemsPerSec, arm.items * 100); assert.equal(arm.completedSamples, samples);
    }
  }
} else {
  assert.equal(selected, 'lsp');
  for (const samples of [1, 3, 5]) {
    const report = run('partial-lsp-open', ['--docs', '3', '--targets', '1', '--samples', String(samples)]);
    for (const arm of Object.values(report.bench)) {
      assert.equal(arm.completedDocumentInventory, 3 * samples); assert.equal(arm.completedSamples, samples);
      assert.equal(arm.docsPerSec, 300); assert.equal(arm.openedDocumentCount, null);
      assert.equal(arm.rateScope, 'admitted-document-inventories-across-all-repetitions');
    }
  }
}
console.log('Actual VFS producer completed work and constant-cost repeated rates are independent of bucket/repetition count: ' + selected);
