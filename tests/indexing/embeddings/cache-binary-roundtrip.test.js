#!/usr/bin/env node
import assert from 'node:assert/strict';
import { decodeEmbeddingsCache, encodeEmbeddingsCache } from '../../../src/shared/embeddings-cache/format.js';

const payload = {
  key: 'cache-key',
  file: 'src/alpha.js',
  hash: 'abc123',
  chunkSignature: 'sig-1',
  chunkHashes: ['h1', 'h2'],
  cacheMeta: {
    identityKey: 'identity-key',
    identity: { provider: 'stub', modelId: 'model', dims: 3 }
  },
  codeVectors: [
    Uint8Array.from([1, 2, 3]),
    new Uint8Array(0)
  ],
  docVectors: [
    [3, 2, 1],
    [4, 5, 6]
  ],
  mergedVectors: [
    [2, 2, 2],
    []
  ]
};

const encoded = await encodeEmbeddingsCache(payload, { level: 1 });
const decoded = await decodeEmbeddingsCache(encoded);

assert.equal(decoded.file, payload.file);
assert.equal(decoded.hash, payload.hash);
assert.equal(decoded.chunkSignature, payload.chunkSignature);
assert.deepEqual(decoded.chunkHashes, payload.chunkHashes);
assert.equal(decoded.cacheMeta.identityKey, payload.cacheMeta.identityKey);
assert.equal(decoded.codeVectors.length, 2);
assert.equal(decoded.docVectors.length, 2);
assert.equal(decoded.mergedVectors.length, 2);

assert.deepEqual(Array.from(decoded.codeVectors[0]), [1, 2, 3]);
assert.equal(decoded.codeVectors[1].length, 0);
assert.deepEqual(Array.from(decoded.docVectors[0]), [3, 2, 1]);
assert.deepEqual(Array.from(decoded.docVectors[1]), [4, 5, 6]);
assert.deepEqual(Array.from(decoded.mergedVectors[0]), [2, 2, 2]);
assert.equal(decoded.mergedVectors[1].length, 0);

console.log('embeddings cache binary roundtrip test passed');
