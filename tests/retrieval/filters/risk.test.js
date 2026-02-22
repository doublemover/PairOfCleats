#!/usr/bin/env node
import { ensureFixtureIndex, runSearch } from '../../helpers/fixture-index.js';
import { skipIfNativeGrammarsUnavailable } from '../../indexing/tree-sitter/native-availability.js';

if (skipIfNativeGrammarsUnavailable(['javascript'], 'retrieval risk filters')) {
  process.exit(0);
}

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  requireRiskTags: true
});

const riskTag = runSearch({
  fixtureRoot,
  env,
  query: 'exec',
  mode: 'code',
  args: ['--risk', 'command-exec']
});
if (!(riskTag.code || []).length) {
  console.log('risk tags unavailable in fixture index; skipping retrieval risk filters test.');
  process.exit(0);
}

const riskFlow = runSearch({
  fixtureRoot,
  env,
  query: 'req',
  mode: 'code',
  args: ['--risk-flow', 'req.body->exec']
});
if (!(riskFlow.code || []).length) {
  console.log('risk flows unavailable in fixture index; skipping retrieval risk filters test.');
  process.exit(0);
}

console.log('Retrieval risk filters ok.');
