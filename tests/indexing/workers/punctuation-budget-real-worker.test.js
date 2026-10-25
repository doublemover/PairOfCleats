import assert from 'node:assert/strict';
import { tokenizeChunkText } from '../../../src/index/build/tokenization.js';
import { createWorkerPoolTestResources } from './worker-pool-fixture.js';

const { workerPool, context } = await createWorkerPoolTestResources({ maxFileBytes: 65536 });
assert.ok(workerPool, 'punctuation route qualification requires the real worker');
const input = { text: ';'.repeat(10001) + '\n' + ','.repeat(10001), mode: 'code', ext: '.js', languageId: 'javascript' };
try {
  const inline = tokenizeChunkText({ ...input, context });
  const worker = await workerPool.tokenizeChunk(input);
  for (const key of ['tokens', 'seq', 'tokenIds', 'minhashSig', 'stats']) assert.deepEqual(worker[key], inline[key], key);
  assert.deepEqual(worker.stats.punctuation, { limit: 20000, emitted: 20000, truncated: true });
  assert.equal(workerPool.stats().backend, 'worker');
  assert.ok(workerPool.pool.completed > 0, 'the real worker executed this capped code input');
} finally { await workerPool.destroy(); }
console.log('The real token worker preserves direct-route punctuation tokens and bounded coverage evidence.');
