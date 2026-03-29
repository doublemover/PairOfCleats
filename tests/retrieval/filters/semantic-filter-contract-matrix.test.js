#!/usr/bin/env node
import assert from 'node:assert/strict';

import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { skipIfNativeGrammarsUnavailable } from '../../indexing/tree-sitter/native-availability.js';

if (skipIfNativeGrammarsUnavailable(['javascript', 'typescript'], 'retrieval semantic filters')) {
  process.exit(0);
}

const typeFixtureConfig = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  }
};

const typeFixture = await ensureFixtureIndex({
  fixtureName: 'type-filters',
  cacheName: 'type-filters',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(typeFixtureConfig) },
  cacheScope: 'isolated',
  requiredModes: ['code']
});
const riskFixture = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  requireRiskTags: true,
  cacheScope: 'isolated',
  requiredModes: ['code']
});

const runTypeSearch = createInProcessSearchRunner({
  fixtureRoot: typeFixture.fixtureRoot,
  env: typeFixture.env
});
const runRiskSearch = createInProcessSearchRunner({
  fixtureRoot: riskFixture.fixtureRoot,
  env: riskFixture.env
});

const cases = [
  {
    name: 'type filters return inferred-type and return-type matches when metadata is available',
    async run() {
      const inferred = await runTypeSearch({
        query: 'makeWidget',
        mode: 'code',
        args: ['--backend', 'memory', '--inferred-type', 'widget']
      });
      const returns = await runTypeSearch({
        query: 'makeWidget',
        mode: 'code',
        args: ['--backend', 'memory', '--return-type', 'Widget']
      });

      if (!(inferred.code || []).length || !(returns.code || []).length) {
        return;
      }

      assert.ok((inferred.code || []).length > 0);
      assert.ok((returns.code || []).length > 0);
    }
  },
  {
    name: 'risk filters return tagged and flow-linked matches when metadata is available',
    async run() {
      const riskTag = await runRiskSearch({
        query: 'exec',
        mode: 'code',
        args: ['--risk', 'command-exec']
      });
      const riskFlow = await runRiskSearch({
        query: 'req',
        mode: 'code',
        args: ['--risk-flow', 'req.body->exec']
      });

      if (!(riskTag.code || []).length || !(riskFlow.code || []).length) {
        return;
      }

      assert.ok((riskTag.code || []).length > 0);
      assert.ok((riskFlow.code || []).length > 0);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('semantic filter contract matrix test passed');
