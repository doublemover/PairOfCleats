import assert from 'node:assert/strict';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';

const applied = [];
let release;
const blocked = new Promise(resolve => { release = resolve; });
const appender = buildOrderedAppender(async (result, _state, _shard, context) => {
  if (context.orderIndex === 4) await blocked;
  applied.push([context.orderIndex, result.source]);
}, {}, { expectedIndices: [4, 19, 37] });
const pending = [appender.enqueue(19, { source: 'current' }),
  appender.enqueue(19, { source: 'late duplicate' }),
  appender.enqueue(37, { source: 'last' }),
  appender.enqueue(4, { source: 'first' }),
  appender.enqueue(4, { source: 'during awaited apply' })];
release();
await Promise.all(pending);
assert.deepEqual(applied, [[4, 'first'], [19, 'current'], [37, 'last']]);
appender.assertCompletion();
assert.equal(appender.snapshot().committedCount, 3);
console.log('sparse out-of-order duplicate completions apply exactly once without replacing admitted results');
