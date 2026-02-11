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
  'PAIROFCLEATS_ANN_BACKEND'
];
const prev = Object.fromEntries(keys.map((key) => [key, snapshotEnv(key)]));

try {
  process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';
  process.env.PAIROFCLEATS_TEST_CONFIG = '{"ok":true}';
  process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX = 'yes';
  process.env.PAIROFCLEATS_ANN_BACKEND = 'lancedb';

  applyTestEnv({
    embeddings: null,
    testConfig: null,
    extraEnv: { PAIROFCLEATS_TEST_CACHE_SUFFIX: null }
  });

  assert.equal(process.env.PAIROFCLEATS_EMBEDDINGS, undefined, 'embeddings should be cleared');
  assert.equal(process.env.PAIROFCLEATS_TEST_CONFIG, undefined, 'test config should be cleared');
  assert.equal(process.env.PAIROFCLEATS_TEST_CACHE_SUFFIX, undefined, 'extra env key should be cleared');
  assert.equal(process.env.PAIROFCLEATS_ANN_BACKEND, undefined, 'non-test PAIROFCLEATS env should be cleared');

  console.log('test-env clear test passed');
} finally {
  for (const [key, value] of Object.entries(prev)) {
    restoreEnv(key, value);
  }
}
