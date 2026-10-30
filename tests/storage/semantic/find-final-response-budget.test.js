#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createSemanticFindService } from '../../../src/semantic/find.js';

const generation = { baseBuildId: 'synthetic-build', semanticRevision: 0 };
const store = { repoRoot: '/fixture', generation,
  findOperations: async () => ({ refs: [], offset: 0, done: true }) };
const request = { repoRoot: store.repoRoot, generation, selector: { field: 'astKind', value: 'NeverPresent' } };
const find = createSemanticFindService();
const result = await find({ store, request });
const bytes = Buffer.byteLength(JSON.stringify(result));
for (const limit of [1, bytes - 1]) {
  await assert.rejects(find({ store, request: { ...request, limits: { bytes: limit } } }),
    { code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
}
for (const limit of [bytes, bytes + 1, 65536]) {
  const response = await find({ store, request: { ...request, limits: { bytes: limit } } });
  assert.deepEqual(response.records, []);
  assert.ok(Buffer.byteLength(JSON.stringify(response)) <= limit);
}
const filtered = { ...store, findOperations: async () => ({ refs: [{ partitionId: 'p', localId: 0 }], offset: 1, done: true }),
  getRecords: async () => [{ span: [100, 120] }] };
await assert.rejects(find({ store: filtered, request: { ...request,
  selector: { field: 'sourcePath', value: 'outside.js', range: { start: 0, end: 10 } }, limits: { bytes: 1 } } }),
{ code: 'ERR_SEMANTIC_OUTPUT_LIMIT' });
console.log('semantic find admits the complete final envelope within the requested bytes');
