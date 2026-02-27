#!/usr/bin/env node
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code']
});

await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code']
});

await ensureFixtureIndex({
  fixtureName: 'type-filters',
  cacheName: 'type-filters',
  cacheScope: 'shared',
  requiredModes: ['code']
});

console.log('fixture prewarm complete.');
