import assert from 'node:assert/strict';
import path from 'node:path';
import { createIndexerWorkerPool, normalizeWorkerPoolConfig } from '../../../src/index/build/worker-pool.js';
import { projectFileAnalysisInput } from '../../../src/index/build/workers/file-analysis-contract.js';

const analysis = projectFileAnalysisInput({ mode: 'code', ext: '.js', text: 'const x = 1;',
  abs: path.resolve('fixture.js'), relKey: 'fixture.js', root: process.cwd(),
  languageOptions: { treeSitter: { enabled: false } }, fileStat: { size: 12 } });
assert.ok(analysis.payload);
for (const code of ['ERR_WORKER_FATAL', 'ERR_PROCESS_TASK_EXIT']) {
  for (const [method, payload] of [
    ['tokenizeChunk', { text: 'alpha', mode: 'code', file: 'fixture.js', ext: '.js' }],
    ['analyzeFile', analysis.payload],
    ['runQuantize', { vectors: [Float32Array.of(0.1, 0.2)], minVal: -1, maxVal: 1, levels: 256 }]
  ]) {
    const facade = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true,
      maxWorkers: 1, taskTimeoutMs: 1000 }, { cpuLimit: 1 }), dictWords: new Set(),
    dictConfig: {}, postingsConfig: {}, log() {} });
    assert.ok(facade);
    const primary = Object.assign(new Error('Original fatal execution owner.'), { code });
    const owner = facade.pool; let calls = 0;
    owner.run = async () => { calls++; throw primary; };
    try {
      await assert.rejects(facade[method](payload), error => error === primary,
        `${method} fatal dispatch cannot become a null/inline fallback`);
      assert.equal(calls, 1, 'fatal dispatch is not replayed');
      assert.equal(facade.stats().dispatchedTasks, 0);
    } finally { await facade.destroy(); }
  }
}
console.log('Every task facade preserves fatal dispatch failure instead of authorizing inline replay.');
