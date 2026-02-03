#!/usr/bin/env node
import assert from 'node:assert/strict';
import { promisify } from 'node:util';
import { zstdDecompress } from 'node:zlib';
import { encodeEmbeddingsCache } from '../../../src/shared/embeddings-cache/format.js';

const decompress = promisify(zstdDecompress);

const payload = {
  key: 'cache-key',
  file: 'src/alpha.js',
  hash: 'abc123',
  chunkSignature: 'sig-1',
  cacheMeta: {
    identityKey: 'identity-key',
    identity: { provider: 'stub', modelId: 'model', dims: 3 }
  },
  codeVectors: [Uint8Array.from([1, 2, 3])],
  docVectors: [[3, 2, 1]],
  mergedVectors: [[2, 2, 2]]
};

const encoded = await encodeEmbeddingsCache(payload, { level: 1 });
assert.ok(encoded.length > 0, 'expected encoded cache payload');
const magic = encoded.subarray(0, 4).toString('ascii');
assert.notEqual(magic, 'PCEB', 'expected cache payload to be compressed');

const raw = await decompress(encoded);
const rawMagic = raw.subarray(0, 4).toString('ascii');
assert.equal(rawMagic, 'PCEB', 'expected zstd payload to decode embeddings cache header');

console.log('embeddings cache compression zstd test passed');
