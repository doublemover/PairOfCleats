import assert from 'node:assert/strict';
import Module from 'node:module';
import { createTantivyProvider } from '../../../src/retrieval/sparse/providers/tantivy.js';
const original = Module._load;
const rows = Array.from({ length: 5001 }, (_, idx) => ({ idx, score: 6000 - idx }));
const limits = [];
Module._load = function (name, ...args) {
  if (name === 'tantivy') return { openIndex: () => ({ close() {} }), search: (_handle, _query, limit) => { limits.push(limit); return rows.slice(0, limit); } };
  return original.call(this, name, ...args);
};
try {
  const provider = createTantivyProvider();
  const input = { idx: { chunkMeta: new Array(rows.length), tantivy: { available: true, dir: 'authored' } },
    queryTokens: ['needle'], mode: 'code', topN: 1, allowedIds: new Set([5000]) };
  assert.deepEqual(provider.search(input).hits, [{ idx: 5000, score: 1000 }]);
  assert.ok(limits.at(-1) > 2000, 'eligible rank is independent of allowed-set cardinality and initial overfetch');
  limits.length = 0;
  assert.deepEqual(provider.search({ ...input, allowedIds: new Set() }).hits, []);
  assert.deepEqual(limits, []);
  assert.deepEqual(provider.search({ ...input, allowedIds: new Set([9999]) }).hits, [], 'complete corpus exhaustion proves an empty result');
} finally { Module._load = original; }
console.log('Tantivy deep filtered recall passed');
