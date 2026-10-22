import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { createQueryPlanDiskCache, createQueryPlanEntry } from '../../../src/retrieval/query-plan-cache.js';
import { buildTestPlan, createPlanInputs } from '../pipeline/query-plan-helpers.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('query-session-merge-and-plan-lru');
try {
  const queryCachePath = path.join(dir, 'results.json');
  const persist = cacheKey => persistSearchSession({ queryCacheEnabled: true, cacheKey, cacheHit: false,
    cacheData: { version: 1, entries: [] }, queryCachePath, cacheShouldPersist: false,
    queryCacheTtlMs: 60000, cacheSignature: 'generation-a', query: cacheKey, backendLabel: 'memory',
    proseHits: [], extractedProseHits: [], codeHits: [{ id: cacheKey }], recordHits: [], queryCacheMaxEntries: 10 });
  await Promise.all([persist('query-one'), persist('query-two')]);
  const saved = JSON.parse(await fs.readFile(queryCachePath, 'utf8'));
  assert.deepEqual(saved.entries.map(entry => entry.key).sort(), ['query-one', 'query-two'],
    'writers merge fresh disk state after acquiring the shared cache lock');
  const cachePath = path.join(dir, 'plans.json');
  const cache = createQueryPlanDiskCache({ path: cachePath, maxEntries: 2, ttlMs: 60000 });
  const plan = buildTestPlan(createPlanInputs());
  const entry = timestamp => ({ ...createQueryPlanEntry({ plan, configSignature: 'config', indexSignature: 'index' }), ts: timestamp });
  const now = Date.now();
  cache.set('old', entry(now - 10)); cache.set('new', entry(now));
  await cache.persist();
  const loaded = createQueryPlanDiskCache({ path: cachePath, maxEntries: 2, ttlMs: 60000 });
  assert.equal(loaded.load(), 2);
  loaded.set('third', entry(now + 1));
  assert.equal(loaded.cache.has('old'), false, 'restoration evicts the actual oldest plan');
  assert.equal(loaded.cache.has('new'), true);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Query-cache writers merge independent entries and disk restoration preserves LRU order.');
