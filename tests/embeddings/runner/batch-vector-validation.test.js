#!/usr/bin/env node
import assert from 'node:assert/strict';
import { assertVectorArrays, runBatched } from '../../../tools/build/embeddings/embed.js';

for (const invalid of [NaN, Infinity, -Infinity, '1', null, undefined, 1n]) {
  assert.throws(() => assertVectorArrays([[1, invalid]], 1, 'fixture'), /non-finite number/);
}
for (const invalid of [NaN, Infinity, -Infinity]) {
  await assert.rejects(runBatched({ texts: ['one'], batchSize: 1,
    embed: async () => [Float32Array.from([1, invalid])] }), /non-finite number/);
}
assert.throws(() => assertVectorArrays([[1], [1, 2]], 2, 'fixture'), /dimensions differ/);
let batches = 0;
await assert.rejects(runBatched({ texts: ['one', 'two'], batchSize: 1,
  embed: async () => [new Float32Array(++batches)] }), /dimensions changed/);
assertVectorArrays([[0, -1], Float64Array.from([1, 2])], 2, 'valid');
assert.deepEqual(await runBatched({ texts: ['valid'], batchSize: 1,
  embed: async () => [Float32Array.from([0, 1])] }), [Float32Array.from([0, 1])]);
console.log('Batch admission rejects nonnumeric/nonfinite and inconsistent-width vectors.');
