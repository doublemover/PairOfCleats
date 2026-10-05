#!/usr/bin/env node
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';

// Prewarming parser/search fixtures does not require the enclosing checkout's
// history, which can fetch missing blobs in partial clones.
const envOverrides = {
  PAIROFCLEATS_TEST_CONFIG: JSON.stringify({ indexing: { scm: { provider: 'none' } } })
};

await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName: 'fixture-sample',
  cacheScope: 'shared',
  requiredModes: ['code'],
  envOverrides
});

console.log('sample fixture prewarm complete.');
