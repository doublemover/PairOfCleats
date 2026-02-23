import assert from 'node:assert/strict';
import { applyTestEnv } from './test-env.js';

const trackedKeys = [
  'PAIROFCLEATS_EMBEDDINGS',
  'PAIROFCLEATS_TEST_CONFIG',
  'PAIROFCLEATS_TESTING'
];

const prev = Object.fromEntries(
  trackedKeys.map((key) => [
    key,
    Object.prototype.hasOwnProperty.call(process.env, key) ? process.env[key] : undefined
  ])
);

try {
  process.env.PAIROFCLEATS_EMBEDDINGS = 'original';
  delete process.env.PAIROFCLEATS_TEST_CONFIG;

  const env = applyTestEnv({
    embeddings: 'stub',
    testConfig: { ok: true },
    syncProcess: false
  });

  assert.equal(env.PAIROFCLEATS_EMBEDDINGS, 'stub', 'returned env should include requested embeddings override');
  assert.equal(process.env.PAIROFCLEATS_EMBEDDINGS, 'original', 'syncProcess=false should not mutate process env');
  assert.equal(process.env.PAIROFCLEATS_TEST_CONFIG, undefined, 'syncProcess=false should not set process test config');
  assert.ok(env.PAIROFCLEATS_TEST_CONFIG?.includes('"ok":true'), 'returned env should include encoded test config');

  console.log('test-env sync option test passed');
} finally {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
