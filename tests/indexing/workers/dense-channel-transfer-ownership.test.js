#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildDenseVectors } from '../../../src/index/build/postings/dense-vectors.js';
import { buildQuantizeRunPayload } from '../../../src/index/build/workers/pool/payload.js';
import { quantizeVec } from '../../../src/index/embedding.js';

for (const failAfterTransfer of [false, true]) {
  const embedding = Float32Array.from([0.1, 0.2]);
  const chunks = [{ embedding }];
  const inline = await buildDenseVectors({ chunks });
  let transfers = 0;
  const actual = await buildDenseVectors({ chunks, quantizePool: {
    config: { quantizeBatchSize: 1 },
    async runQuantize(input) {
      const run = buildQuantizeRunPayload(input);
      const received = structuredClone(run.payload, { transfer: run.transferList });
      transfers += run.transferList.length;
      if (failAfterTransfer) throw new Error('worker rejected after ownership transfer');
      return received.vectors.map(vector => quantizeVec(vector));
    }
  } });
  assert.equal(transfers, 3);
  assert.equal(embedding.byteLength, 8, 'worker dispatch must preserve source storage');
  assert.deepEqual(actual, inline, 'all dense channels and inline failure recovery retain the same source values');
}
const backing = Float32Array.from([1, 2, 3]);
const view = backing.subarray(1);
const payload = buildQuantizeRunPayload({ vectors: [view, view] });
const received = structuredClone(payload.payload, { transfer: payload.transferList });
assert.deepEqual(Array.from(received.vectors[0]), [2, 3]);
assert.deepEqual(Array.from(backing), [1, 2, 3]);
console.log('Dense-channel worker transfer and failure ownership passed.');
