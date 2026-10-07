#!/usr/bin/env node
import assert from 'node:assert/strict';
import { minifyMinhashSignature } from '../../../src/index/minhash.js';
import { resolveMinhashOutputs } from '../../../src/index/build/postings/minhash.js';
import {
  iterateMinhashSignatures,
  packMinhashSignatures
} from '../../../src/index/build/artifacts/minhash-packed.js';

for (const count of [0, 1, 2, 3, 7]) {
  for (const maxDocs of [0, 2]) {
    for (const sparseEnabled of [false, true]) {
      const chunks = Array.from({ length: count }, (_, row) => ({
        minhashSig: Array.from({ length: 64 }, (_, col) => row * 1000 + col)
      }));
      const common = { sparseEnabled, minhashMaxDocs: maxDocs, chunks };
      const eager = resolveMinhashOutputs({ ...common, minhashStream: false });
      const streaming = resolveMinhashOutputs({ ...common, minhashStream: true });
      assert.deepEqual(streaming.minhashGuard, eager.minhashGuard);
      assert.equal(streaming.allowMinhash, eager.allowMinhash);
      assert.deepEqual(streaming.minhashSigs, [], 'streaming must not retain a row table');
      const emitted = streaming.allowMinhash || streaming.minhashGuard?.sampled === true;
      const sampling = streaming.minhashGuard?.sampled ? streaming.minhashGuard : null;
      const rows = emitted ? Array.from(iterateMinhashSignatures({ chunks, sampling })) : [];
      assert.deepEqual(rows, eager.minhashSigs, 'JSON row values/order must match eager emission');
      const packed = packMinhashSignatures({ chunks: emitted ? chunks : [], sampling });
      const reference = packMinhashSignatures({ signatures: eager.minhashSigs });
      assert.deepEqual(packed, reference, 'packed bytes, dimensions and coercion counts must match');
    }
  }
}

// Missing, short, typed and coercible rows retain the exact existing minifier
// behavior, including zero fill and normalization before packing.
const irregular = [
  undefined,
  [],
  [1, NaN, -2, '7', 3.75, Infinity, 0x100000001],
  new Uint32Array([5, 6]),
  Array.from({ length: 32 }, (_, i) => i * 17)
].map((minhashSig) => ({ minhashSig }));
const plan = { sampledSignatureLength: 8, hashStride: 3 };
const eagerRows = irregular.map((chunk) => minifyMinhashSignature(chunk.minhashSig, plan));
assert.deepEqual(Array.from(iterateMinhashSignatures({ chunks: irregular, sampling: plan })), eagerRows);
assert.deepEqual(
  packMinhashSignatures({ chunks: irregular, sampling: plan }),
  packMinhashSignatures({ signatures: eagerRows })
);
assert.deepEqual(
  packMinhashSignatures({ signatures: eagerRows, chunks: irregular, sampling: plan }),
  packMinhashSignatures({ signatures: eagerRows }),
  'already sampled signatures must never be sampled twice'
);

const reads = [];
const chunks = Array.from({ length: 128 }, (_, row) => ({
  get minhashSig() {
    reads.push(row);
    return Array.from({ length: 64 }, (_, col) => row + col);
  }
}));
const outputs = resolveMinhashOutputs({
  sparseEnabled: true, minhashMaxDocs: 2, minhashStream: true, chunks
});
assert.deepEqual([...new Set(reads)], [0], 'planning must not read every source row');
reads.length = 0;
const iterator = iterateMinhashSignatures({ chunks, sampling: outputs.minhashGuard });
assert.deepEqual(reads, [], 'creating the iterator must be lazy');
const first = iterator.next().value;
assert.deepEqual(reads, [0]);
const savedFirst = first.slice();
iterator.next();
assert.deepEqual(reads, [0, 1]);
assert.deepEqual(first, savedFirst, 'yielded sampled rows must have independent storage');
iterator.return();
assert.deepEqual(reads, [0, 1], 'early close must not visit unconsumed rows');
console.log('sampled MinHash stream parity and lazy-row contracts passed');
