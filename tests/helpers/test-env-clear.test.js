import assert from 'node:assert/strict';
import { applyTestEnv } from './test-env.js';

const snapshotEnv = (key) => (Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined);
const restoreEnv = (key, value) => {
  if (value === undefined) {
    delete process.env[key];
  } else {
    process.env[key] = value;
  }
};

const keys = [
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_TEST_CACHE_SUFFIX',
  'PAIROFCLEATS_ANN_BACKEND',
  'PAIROFCLEATS_TRUSTED_CONFIG',
  'PAIROFCLEATS_WORKER_POOL',
  'PAIROFCLEATS_THREADS',
  'PAIROFCLEATS_BUNDLE_THREADS'
];
const prev = Object.fromEntries(keys.map((key) => [key, snapshotEnv(key)]));

try {
  process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  process.env.PAIROFCLEATS_TEST_CONFIG = '{"ok":true}';
  process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX = 'yes';
  process.env.PAIROFCLEATS_ANN_BACKEND = 'lancedb';
  process.env.PAIROFCLEATS_TRUSTED_CONFIG = '/user-owned/extension-policy.json';
  process.env.PAIROFCLEATS_WORKER_POOL = 'off';
  process.env.PAIROFCLEATS_THREADS = '1';
  process.env.PAIROFCLEATS_BUNDLE_THREADS = '1';

  applyTestEnv({
    embeddings: null,
    testConfig: null,
    extraEnv: { PAIROFCLEATS_TEST_CACHE_SUFFIX: null }
  });

  assert.equal(process.env.PAIROFCLEATS_EMBEDDINGS, undefined, 'embeddings should be cleared');
  assert.equal(process.env.PAIROFCLEATS_TEST_CONFIG, undefined, 'test config should be cleared');
  assert.equal(process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX, undefined, 'extra env key should be cleared');
  assert.equal(process.env.PAIROFCLEATS_ANN_BACKEND, undefined, 'non-test PAIROFCLEATS env should be cleared');

  assert.equal(process.env.PAIROFCLEATS_TRUSTED_CONFIG, '/user-owned/extension-policy.json');
  assert.equal(process.env.PAIROFCLEATS_WORKER_POOL, 'off');
  assert.equal(process.env.PAIROFCLEATS_THREADS, '1');
  assert.equal(process.env.PAIROFCLEATS_BUNDLE_THREADS, '1');
  const explicitlyCleared = applyTestEnv({ syncProcess: false, extraEnv: {
    PAIROFCLEATS_TRUSTED_CONFIG: null, PAIROFCLEATS_WORKER_POOL: null,
    PAIROFCLEATS_THREADS: null, PAIROFCLEATS_BUNDLE_THREADS: null
  } });
  assert.equal(explicitlyCleared.PAIROFCLEATS_TRUSTED_CONFIG, undefined);
  assert.equal(explicitlyCleared.PAIROFCLEATS_WORKER_POOL, undefined);
  assert.equal(explicitlyCleared.PAIROFCLEATS_THREADS, undefined);
  assert.equal(explicitlyCleared.PAIROFCLEATS_BUNDLE_THREADS, undefined);

  console.log('test-env clear test passed');
} finally {
  for (const [key, value] of Object.entries(prev)) {
    restoreEnv(key, value);
  }
}
