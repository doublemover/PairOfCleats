import assert from 'node:assert/strict';
import { applyTestEnv, withTemporaryEnv } from './test-env.js';

await withTemporaryEnv({
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_TEST_LANE: 'ci',
  PAIROFCLEATS_TEST_CONFIG: null
}, async () => {
  const defaultEnv = applyTestEnv({ syncProcess: false });
  const defaultConfig = JSON.parse(defaultEnv.PAIROFCLEATS_TEST_CONFIG || '{}');
  assert.equal(defaultConfig.indexing?.typeInference, false, 'ci lane should disable type inference by default');
  assert.equal(defaultConfig.indexing?.typeInferenceCrossFile, false, 'ci lane should disable cross-file type inference by default');
  assert.equal(defaultConfig.tooling?.lsp?.enabled, false, 'ci lane should disable lsp by default');

  const overrideEnv = applyTestEnv({
    testConfig: {
      tooling: { lsp: { enabled: true } },
      indexing: { typeInference: true }
    },
    syncProcess: false
  });
  const overrideConfig = JSON.parse(overrideEnv.PAIROFCLEATS_TEST_CONFIG || '{}');
  assert.equal(overrideConfig.tooling?.lsp?.enabled, true, 'explicit lsp override should win over lane default');
  assert.equal(overrideConfig.indexing?.typeInference, true, 'explicit type inference override should win over lane default');
  assert.equal(overrideConfig.indexing?.typeInferenceCrossFile, false, 'unset lane defaults should remain in merged config');

  await withTemporaryEnv({ PAIROFCLEATS_TEST_LANE: 'smoke' }, async () => {
    const nonCiEnv = applyTestEnv({ syncProcess: false });
    assert.equal(
      Object.prototype.hasOwnProperty.call(nonCiEnv, 'PAIROFCLEATS_TEST_CONFIG'),
      false,
      'non-ci lanes should not inject implicit test config'
    );
  });
});

console.log('lane default test config test passed');
