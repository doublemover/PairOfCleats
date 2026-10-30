import assert from 'node:assert/strict';
import { createRequire, registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import { applyTestEnv } from '../../helpers/test-env.js';
import { awaitWithKeepalive } from '../../../src/shared/promise-keepalive.js';

applyTestEnv();
const require = createRequire(import.meta.url), actual = pathToFileURL(require.resolve('piscina')).href;
const observations = []; globalThis.__lazyPoolConstruction = observations;
const hook = registerHooks({ resolve(specifier, context, next) {
  if (specifier === 'piscina' && context.parentURL?.endsWith('/src/index/build/workers/pool.js')) {
    return { url: 'lazy-pool:piscina', shortCircuit: true };
  }
  return next(specifier, context);
}, load(url, context, next) {
  if (url === 'lazy-pool:piscina') return { format: 'module', shortCircuit: true, source:
    'import Actual from ' + JSON.stringify(actual) + ';'
    + 'export default class Observed extends Actual {constructor(options){super(options);'
    + 'globalThis.__lazyPoolConstruction.push({options,pool:this,initialThreads:this.threads.length});}}' };
  return next(url, context);
} });
let pool;
try {
  const { createIndexerWorkerPool, normalizeWorkerPoolConfig } = await import('../../../src/index/build/worker-pool.js');
  pool = await createIndexerWorkerPool({ config: normalizeWorkerPoolConfig({ enabled: true, maxWorkers: 4,
    backend: 'worker', taskTimeoutMs: 5000, heapTargetMb: 256, minHeapMb: 256, maxHeapMb: 256 }, { cpuLimit: 1 }),
  dictWords: new Set(['alpha', 'beta']), dictConfig: {}, postingsConfig: {} });
  assert.ok(pool); assert.equal(pool.getExecutionBackend(), 'worker');
  assert.equal(observations.length, 1);
  const created = observations[0];
  assert.equal(created.options.minThreads, 0); assert.equal(created.options.maxThreads, 4);
  assert.equal(created.initialThreads, 0); assert.equal(created.pool.threads.length, 0, 'an unused enabled pool creates no idle native workers');
  assert.equal(pool.stats().dispatchedTasks, 0);
  const result = await awaitWithKeepalive(pool.tokenizeChunk({ text: 'alpha beta alpha', mode: 'code', ext: '.js', languageId: 'javascript' }));
  assert.ok(result); assert.ok(result.tokens.includes('alpha')); assert.ok(result.tokens.includes('beta'));
  assert.ok(created.pool.threads.length > 0 && created.pool.threads.length <= 4, 'actual admitted work lazily starts the unchanged backend');
  assert.equal(pool.stats().completedRequests, 1);
  await pool.destroy(); await pool.destroy();
  assert.equal(created.pool.threads.length, 0, 'the original shutdown owner settles every lazily acquired worker');
  console.log(JSON.stringify({ minThreads: created.options.minThreads, maxThreads: created.options.maxThreads,
    initialThreads: created.initialThreads, completedRequests: pool.stats().completedRequests, remainingThreads: created.pool.threads.length }));
} finally { await pool?.destroy(); hook.deregister(); delete globalThis.__lazyPoolConstruction; }
