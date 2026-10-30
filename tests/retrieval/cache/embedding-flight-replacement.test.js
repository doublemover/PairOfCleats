#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createEmbeddingResolver } from '../../../src/retrieval/cli/run-search-session/embedding-cache.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
for (const capacity of [2, 64]) for (const rejected of [false, true]) for (const replacementDone of [false, true]) {
  const old = deferred(), replacement = deferred();
  let calls = 0, aCalls = 0;
  const impl = async ({ text }) => {
    calls++;
    if (text !== 'A') return [text.length];
    aCalls++;
    return aCalls === 1 ? old.promise : replacement.promise;
  };
  const resolve = text => createEmbeddingResolver({ throwIfAborted() {}, embeddingQueryText: text,
    modelConfig: {}, useStubEmbeddings: true, embeddingProvider: 'xenova', getQueryEmbeddingImpl: impl, maxCacheEntries: capacity
  })('fixture', 1, true, null);
  const first = resolve('A');
  const firstResult = rejected ? assert.rejects(first, /retired failure/) : first;
  for (let i = 0; i < capacity; i++) await resolve(`B${i}`);
  const second = resolve('A');
  if (replacementDone) { replacement.resolve([7]); await second; }
  if (rejected) old.reject(new Error('retired failure'));
  else old.resolve(null);
  await firstResult;
  const third = resolve('A');
  if (!replacementDone) replacement.resolve([7]);
  assert.deepEqual(await second, [7]);
  assert.deepEqual(await third, [7]);
  assert.equal(aCalls, 2, 'retired null/error cleanup cannot evict a pending or completed replacement');
  assert.equal(calls, capacity + 2);
}
console.log('Query-flight replacement survives retired null/error at small and default capacities.');
