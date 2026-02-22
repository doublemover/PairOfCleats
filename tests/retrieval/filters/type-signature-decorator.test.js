#!/usr/bin/env node
import { createInProcessSearchRunner, ensureFixtureIndex } from '../../helpers/fixture-index.js';

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});
const runSearch = createInProcessSearchRunner({ fixtureRoot, env });

const typeScoped = await runSearch({
  query: 'sayHello',
  mode: 'code',
  args: ['--backend', 'memory', '--type', 'MethodDeclaration']
});
if (!(typeScoped.code || []).length) {
  console.error('Fixture type filter returned no results.');
  process.exit(1);
}

const signatureScoped = await runSearch({
  query: 'sayHello',
  mode: 'code',
  args: ['--backend', 'memory', '--signature', 'func sayHello']
});
if (!(signatureScoped.code || []).length) {
  console.error('Fixture signature filter returned no results.');
  process.exit(1);
}

const decoratorScoped = await runSearch({
  query: 'sayHello',
  mode: 'code',
  args: ['--backend', 'memory', '--decorator', 'available']
});
if (!(decoratorScoped.code || []).length) {
  console.error('Fixture decorator filter returned no results.');
  process.exit(1);
}

console.log('Fixture type/signature/decorator filters ok.');
