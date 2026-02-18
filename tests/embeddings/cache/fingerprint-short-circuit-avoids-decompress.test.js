#!/usr/bin/env node
import assert from 'node:assert/strict';

import {
  buildChunkHashesFingerprint,
  shouldFastRejectCacheLookup
} from '../../../tools/build/embeddings/cache.js';
import { applyTestEnv } from '../../helpers/test-env.js';

applyTestEnv({ testing: '1' });

const chunkHashesA = ['h1', 'h2', 'h3'];
const chunkHashesB = ['h1', 'hX', 'h3'];
const fingerprintA = buildChunkHashesFingerprint(chunkHashesA);
const fingerprintB = buildChunkHashesFingerprint(chunkHashesB);

assert.ok(fingerprintA && fingerprintB, 'expected non-empty fingerprints');
assert.notEqual(fingerprintA, fingerprintB, 'expected distinct fingerprints for changed chunk hashes');

const cacheIndex = {
  version: 1,
  identityKey: 'identity:test',
  entries: {
    'cache-key': {
      key: 'cache-key',
      hash: 'file-hash',
      chunkSignature: 'chunk-signature',
      chunkHashesFingerprint: fingerprintA
    }
  }
};

let payloadReads = 0;
const maybeReadPayload = ({ chunkHashesFingerprint }) => {
  const reject = shouldFastRejectCacheLookup({
    cacheIndex,
    cacheKey: 'cache-key',
    identityKey: 'identity:test',
    fileHash: 'file-hash',
    chunkSignature: 'chunk-signature',
    chunkHashesFingerprint
  });
  if (!reject) payloadReads += 1;
  return !reject;
};

assert.equal(
  maybeReadPayload({ chunkHashesFingerprint: fingerprintB }),
  false,
  'expected fingerprint mismatch to short-circuit payload read'
);
assert.equal(payloadReads, 0, 'expected no payload/decompress read on mismatch');

assert.equal(
  maybeReadPayload({ chunkHashesFingerprint: fingerprintA }),
  true,
  'expected matching fingerprint to permit payload read'
);
assert.equal(payloadReads, 1, 'expected payload read only when fingerprint matches');

console.log('embeddings cache fingerprint short-circuit test passed');
