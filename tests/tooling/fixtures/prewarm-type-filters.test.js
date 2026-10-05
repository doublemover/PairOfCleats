#!/usr/bin/env node
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

await ensureFixtureIndex({
  fixtureName: 'type-filters',
  cacheName: 'type-filters',
  cacheScope: 'shared',
  requiredModes: ['code'],
  envOverrides: {
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ indexing: { scm: { provider: 'none' } } })
  }
});

console.log('type-filters fixture prewarm complete.');
