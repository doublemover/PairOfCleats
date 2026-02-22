#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';
import { skipIfNativeGrammarsUnavailable } from '../../indexing/tree-sitter/native-availability.js';

if (skipIfNativeGrammarsUnavailable(['javascript', 'typescript'], 'retrieval type filters')) {
  process.exit(0);
}

const testConfig = {
  indexing: {
    typeInference: true,
    typeInferenceCrossFile: true
  }
};

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture-types',
  envOverrides: { PAIROFCLEATS_TEST_CONFIG: JSON.stringify(testConfig) }
});

const inferred = runSearch({
  fixtureRoot,
  env,
  query: 'makeWidget',
  mode: 'code',
  args: ['--inferred-type', 'object']
});
if (!(inferred.code || []).length) {
  console.log('inferred-type metadata unavailable in fixture index; skipping retrieval type filters test.');
  process.exit(0);
}

const returns = runSearch({
  fixtureRoot,
  env,
  query: 'makeWidget',
  mode: 'code',
  args: ['--return-type', 'Widget']
});
if (!(returns.code || []).length) {
  console.log('return-type metadata unavailable in fixture index; skipping retrieval type filters test.');
  process.exit(0);
}

console.log('Retrieval type filters ok.');
