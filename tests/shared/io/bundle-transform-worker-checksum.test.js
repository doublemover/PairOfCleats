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

const runNormalizeChecksumWorker = (bundle) => new Promise((resolve, reject) => {
  const worker = new Worker(workerUrl, {
    type: 'module',
    workerData: {
      operation: 'normalize-checksum',
      payload: { bundle }
    }
  });
  const timer = setTimeout(() => {
    reject(new Error('bundle transform worker checksum test timed out'));
    void worker.terminate();
  }, 5000);
  timer.unref?.();
  worker.once('message', (message) => {
    clearTimeout(timer);
    resolve(message);
  });
  worker.once('error', (error) => {
    clearTimeout(timer);
    reject(error);
  });
  worker.once('exit', (code) => {
    if (code === 0) return;
    clearTimeout(timer);
    reject(new Error(`bundle transform worker exited with ${code}`));
  });
});

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
