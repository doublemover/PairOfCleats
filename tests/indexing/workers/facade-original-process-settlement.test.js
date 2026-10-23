import assert from 'node:assert/strict';
import { setImmediate as tick } from 'node:timers/promises';
import path from 'node:path';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';
import { projectFileAnalysisInput } from '../../../src/index/build/workers/file-analysis-contract.js';

const analysis = projectFileAnalysisInput({ mode: 'code', ext: '.js', text: 'const x = 1;',
  abs: path.resolve('fixture.js'), relKey: 'fixture.js', root: process.cwd(),
  languageOptions: { treeSitter: { enabled: false } }, fileStat: { size: 12 } });
assert.ok(analysis.payload);
const cases = [
  ['tokenizeChunk', { text: 'alpha', mode: 'code', file: 'fixture.js', ext: '.js' }],
  ['analyzeFile', analysis.payload],
  ['runQuantize', { vectors: [Float32Array.of(0.1, 0.2)], minVal: -1, maxVal: 1, levels: 256 }]
];
const worker = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true,
  maxWorkers: 1, taskTimeoutMs: 1000 }, { cpuLimit: 1 }), dictWords: new Set(),
dictConfig: {}, postingsConfig: {}, log() {} });
assert.ok(worker);
const owner = worker.pool, originalRun = owner.run, originalDestroy = owner.destroy;
let releasePending = null;
try {
  for (const [method, payload] of cases) {
    let released = false, settled = false;
    const settlement = new Promise(resolve => { releasePending = () => { released = true; resolve(); }; });
    const primary = Object.assign(new Error(`${method} original cancellation`), { name: 'AbortError', code: 'ABORT_ERR' });
    Object.defineProperties(primary, {
      workerSettlement: { value: settlement },
      workerOwnershipReleased: { value: () => released },
      workerOwnershipPending: { get: () => !released }
    });
    const before = worker.stats().completedRequests;
    owner.run = async () => { throw primary; };
    owner.destroy = async () => { assert.fail('pending process failure must not start replacement recovery'); };
    const request = worker[method](payload);
    request.then(() => { settled = true; }, () => { settled = true; });
    await tick();
    assert.equal(settled, false, `${method} facade waits for its original backend`);
    assert.equal(worker.stats().dispatchedTasks, 1);
    assert.equal(worker.stats().outstandingRequests, 1);
    assert.equal(worker.stats().completedRequests, before);
    if (method !== 'runQuantize') {
      assert.equal(worker.stats().requestPressure > 0, true);
    }
    releasePending(); releasePending = null;
    await assert.rejects(request, error => error === primary);
    assert.equal(worker.stats().dispatchedTasks, 0);
    assert.equal(worker.stats().outstandingRequests, 0);
    assert.equal(worker.stats().completedRequests, before + 1);
  }
  for (const [method, payload] of cases) {
    const denied = Object.assign(new Error('compute authority unavailable'), { code: 'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED' });
    owner.run = async () => { throw denied; };
    await assert.rejects(worker[method](payload), error => error === denied,
      `${method} cannot restart or fall back on scheduler authority failure`);
  }
} finally {
  releasePending?.();
  owner.run = originalRun; owner.destroy = originalDestroy;
  await worker.destroy();
}
console.log('Actual pool facade retains backend dispatch until original process release across all task routes.');
