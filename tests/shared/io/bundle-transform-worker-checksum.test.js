#!/usr/bin/env node
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';

import { applyTestEnv } from '../../helpers/test-env.js';
import { MAX_BUNDLE_CHECKSUM_BYTES } from '../../../src/shared/bundle-contract.js';
import {
  checksumBundlePayloadLocal,
  normalizeBundlePayload
} from '../../../src/shared/bundle-io-checksum.js';

applyTestEnv({ testing: '1' });

const workerUrl = new URL('../../../src/shared/workers/bundle-transform-worker.js', import.meta.url);

const runNormalizeChecksumWorker = async (bundle) => {
  const worker = new Worker(workerUrl, {
    type: 'module',
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 }
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('bundle transform worker checksum test timed out')), 5000);
      worker.once('message', (message) => { assert.equal(message.id, 1); resolve(message); });
      worker.once('error', reject);
      worker.once('exit', (code) => reject(new Error(`bundle transform worker exited before result with ${code}`)));
      worker.postMessage({ id: 1, operation: 'normalize-checksum', payload: { bundle } });
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
};

const bundle = {
  z: 'last',
  a: {
    d: 4,
    b: 2
  },
  chunks: [
    {
      text: 'alpha',
      chunkId: 'c1',
      file: 'src/a.js'
    }
  ]
};
const expectedNormalized = normalizeBundlePayload(bundle);
const expectedChecksum = await checksumBundlePayloadLocal(expectedNormalized, {
  maxChecksumBytes: MAX_BUNDLE_CHECKSUM_BYTES
});

const message = await runNormalizeChecksumWorker(bundle);

assert.equal(message?.ok, true, message?.error || 'expected worker checksum normalization to succeed');
assert.deepEqual(message.result?.normalized, expectedNormalized, 'expected worker normalized payload parity');
assert.deepEqual(message.result?.checksum, expectedChecksum, 'expected worker checksum parity');
assert.equal(typeof message.result?.checksum?.value, 'string', 'expected cloneable checksum value');

console.log('bundle transform worker checksum parity ok');
