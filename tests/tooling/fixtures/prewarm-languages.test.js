#!/usr/bin/env node
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

await ensureFixtureIndex({
  fixtureName: 'languages',
  cacheName: 'language-fixture',
  cacheScope: 'shared',
  requiredModes: ['code'],
  envOverrides: {
    PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ indexing: { scm: { provider: 'none' } } })
  }
});

console.log('languages fixture prewarm complete.');
