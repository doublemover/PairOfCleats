#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';

import { createLruCache } from '../../../src/shared/cache/lru.js';
import { estimateStringBytes } from '../../../src/shared/cache/size.js';
import {
  buildCacheKey,
  buildCacheKeyPayload,
  buildLocalCacheKey,
  normalizeCacheNamespace
} from '../../../src/shared/cache-key.js';
import {
  normalizeLegacyCacheRootPath,
  CACHE_ROOT_LAYOUT_VERSION,
  clearCacheRoot,
  getCacheRoot,
  getCacheTempRoot,
  resolveVersionedCacheRoot
} from '../../../src/shared/cache-roots.js';
import { defineCachePolicy, resolveCachePolicy } from '../../../src/shared/cache/policy.js';
import { buildGraphIndexCacheKey } from '../../../src/graph/store.js';
import { buildMapCacheKey } from '../../../src/map/build-map.js';
import { buildQueryCacheKey } from '../../../src/retrieval/cli-index.js';
import { buildQueryPlanCacheKey } from '../../../src/retrieval/query-plan-cache.js';
import { readCacheMeta, writeCacheMeta } from '../../../tools/build/embeddings/cache.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { withTemporaryEnv } from '../../helpers/test-env.js';

let shutdownCalls = 0;
const basePolicy = defineCachePolicy({
  name: 'contract.cache',
  maxEntries: 5,
  maxBytes: 1024,
  ttlMs: 1000,
  invalidationTrigger: ['build-pointer-change', 'build-pointer-change', 'ttl'],
  shutdown: () => {
    shutdownCalls += 1;
  }
});
assert.equal(basePolicy.name, 'contract.cache');
assert.equal(basePolicy.maxEntries, 5);
assert.equal(basePolicy.maxBytes, 1024);
assert.equal(basePolicy.ttlMs, 1000);
assert.deepEqual(basePolicy.invalidationTriggers, ['build-pointer-change', 'ttl']);
assert.equal(basePolicy.invalidationTrigger, 'build-pointer-change');
basePolicy.shutdown();
assert.equal(shutdownCalls, 1);
const resolvedPolicy = resolveCachePolicy({ maxEntries: 9, ttlMs: 5000 }, basePolicy);
assert.equal(resolvedPolicy.maxEntries, 9);
assert.equal(resolvedPolicy.maxBytes, 1024);
assert.equal(resolvedPolicy.ttlMs, 5000);
assert.equal(resolvedPolicy.invalidationTrigger, 'build-pointer-change');
assert.throws(() => defineCachePolicy({
  name: 'bad.cache.trigger',
  maxEntries: 1,
  maxBytes: null,
  ttlMs: 0,
  shutdown: () => {}
}));
assert.throws(() => defineCachePolicy({
  name: 'bad.cache.shutdown',
  maxEntries: 1,
  maxBytes: null,
  ttlMs: 0,
  invalidationTrigger: 'manual'
}));

const cacheRootTemp = resolveTestCachePath(process.cwd(), 'cache-root-versioning');
await fsp.rm(cacheRootTemp, { recursive: true, force: true });
await fsp.mkdir(cacheRootTemp, { recursive: true });
await withTemporaryEnv({
  PAIROFCLEATS_CACHE_ROOT: '',
  PAIROFCLEATS_HOME: path.join(cacheRootTemp, 'pairofcleats-home')
}, async () => {
  const baseRoot = path.join(cacheRootTemp, 'pairofcleats-home');
  const cacheRoot = resolveVersionedCacheRoot(baseRoot);
  assert.ok(cacheRoot.endsWith(path.join('pairofcleats-home', CACHE_ROOT_LAYOUT_VERSION)));
  assert.equal(path.basename(cacheRoot), 'cache');
  assert.throws(
    () => normalizeLegacyCacheRootPath(path.join(baseRoot, 'cache-v1', 'bench-language')),
    { code: 'ERR_LEGACY_CACHE_ROOT_UNSUPPORTED' }
  );

  await fsp.mkdir(baseRoot, { recursive: true });
  await fsp.mkdir(cacheRoot, { recursive: true });
  const legacyRoot = path.join(baseRoot, 'cache-v1');
  await fsp.mkdir(legacyRoot, { recursive: true });
  const versionedSentinel = path.join(cacheRoot, 'versioned.txt');
  const legacySentinel = path.join(baseRoot, 'legacy.txt');
  const legacyCacheSentinel = path.join(legacyRoot, 'legacy-cache.txt');
  await fsp.writeFile(versionedSentinel, 'versioned');
  await fsp.writeFile(legacySentinel, 'legacy');
  await fsp.writeFile(legacyCacheSentinel, 'legacy-cache');

  assert.equal(path.resolve(getCacheRoot()), path.resolve(cacheRoot));
  assert.equal(path.resolve(getCacheTempRoot('sqlite-build')), path.resolve(path.join(cacheRoot, 'tmp', 'sqlite-build')));

  clearCacheRoot({ baseRoot, includeLegacy: false });
  assert.equal(fs.existsSync(versionedSentinel), false);
  assert.equal(fs.existsSync(legacySentinel), true);
  assert.equal(fs.existsSync(legacyCacheSentinel), true);

  clearCacheRoot({ baseRoot, includeLegacy: true });
  assert.equal(fs.existsSync(cacheRoot), false);
  assert.equal(fs.existsSync(legacyRoot), false);
  assert.equal(fs.existsSync(baseRoot), true);
});

const migrationTemp = resolveTestCachePath(process.cwd(), 'cache-migration');
await fsp.rm(migrationTemp, { recursive: true, force: true });
await fsp.mkdir(migrationTemp, { recursive: true });
for (const scenario of [
  { baseName: 'root-a', rebuild: false },
  { baseName: 'root-b', rebuild: true }
]) {
  const baseRoot = path.join(migrationTemp, scenario.baseName, 'cache-root');
  const resolvedRoot = resolveVersionedCacheRoot(baseRoot);
  await fsp.mkdir(resolvedRoot, { recursive: true });
  const legacyPath = path.join(resolvedRoot, 'legacy.txt');
  const sentinelPath = path.join(resolvedRoot, 'sentinel.txt');
  await fsp.writeFile(legacyPath, 'legacy');
  await fsp.writeFile(sentinelPath, 'keep');

  await withTemporaryEnv({
    PAIROFCLEATS_CACHE_ROOT: baseRoot,
    PAIROFCLEATS_CACHE_REBUILD: scenario.rebuild ? '1' : undefined
  }, async () => {
    const resolved = getCacheRoot();
    assert.equal(path.resolve(resolved), path.resolve(resolvedRoot));
    assert.equal(fs.existsSync(legacyPath), !scenario.rebuild);
    assert.equal(fs.existsSync(sentinelPath), !scenario.rebuild);
  });
}

const base = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['zeta', 'alpha'],
  pathPolicy: 'posix'
});
const reordered = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['alpha', 'zeta'],
  pathPolicy: 'posix'
});
const differentMode = buildCacheKey({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'prose',
  schemaVersion: 'sv1',
  featureFlags: ['alpha', 'zeta'],
  pathPolicy: 'posix'
});
assert.equal(base.key, reordered.key);
assert.notEqual(base.key, differentMode.key);
assert.match(base.key, /^[a-z0-9-]+:ck1:[a-f0-9]{40}$/);
const payload = buildCacheKeyPayload({
  repoHash: 'repoA',
  buildConfigHash: 'cfgA',
  mode: 'code',
  schemaVersion: 'sv1',
  featureFlags: ['b', 'a'],
  pathPolicy: true
});
assert.equal(payload.featureFlags, 'a,b');
assert.equal(payload.pathPolicy, 'native');
assert.equal(normalizeCacheNamespace(' Repo/Cache Value '), 'repo-cache-value');

const preflightTemp = resolveTestCachePath(process.cwd(), 'cache-preflight-meta');
await fsp.rm(preflightTemp, { recursive: true, force: true });
await fsp.mkdir(preflightTemp, { recursive: true });
const identity = { provider: 'test', modelId: 'model', dims: 256 };
assert.equal(readCacheMeta(preflightTemp, identity, 'code'), null);
const meta = {
  version: 1,
  identityKey: 'abc123',
  dims: 256,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString()
};
await writeCacheMeta(preflightTemp, identity, 'code', meta);
const loaded = readCacheMeta(preflightTemp, identity, 'code');
assert.ok(loaded);
assert.equal(loaded.identityKey, meta.identityKey);
assert.equal(loaded.dims, meta.dims);

const sizeCache = createLruCache({
  name: 'size-test',
  maxMb: 0.0001,
  ttlMs: 0,
  sizeCalculation: estimateStringBytes
});
sizeCache.set('a', 'a'.repeat(80));
sizeCache.set('b', 'b'.repeat(80));
const hasA = sizeCache.get('a') !== null;
const hasB = sizeCache.get('b') !== null;
assert.ok(!(hasA && hasB));
assert.ok(sizeCache.stats.evictions >= 1);

const ttlCache = createLruCache({
  name: 'ttl-test',
  maxMb: 1,
  ttlMs: 10,
  sizeCalculation: estimateStringBytes
});
ttlCache.set('x', 'value');
await new Promise((resolve) => setTimeout(resolve, 25));
assert.equal(ttlCache.get('x'), null);

const badSizerCache = createLruCache({
  name: 'bad-sizer-test',
  maxMb: 1,
  ttlMs: 0,
  sizeCalculation: () => 0
});
assert.throws(() => badSizerCache.set('bad', 'value'), /sizeCalculation returned/);

const graphKeyA = buildGraphIndexCacheKey({
  indexSignature: 'sig',
  repoRoot: '/repo',
  graphs: ['usage', 'call'],
  includeCsr: true
});
const graphKeyB = buildGraphIndexCacheKey({
  indexSignature: 'sig',
  repoRoot: '/repo',
  graphs: ['call', 'usage'],
  includeCsr: true
});
assert.equal(graphKeyA, graphKeyB);

const mapKeyA = buildMapCacheKey({
  buildId: 'build-1',
  options: { scope: 'repo', focus: null, include: ['src'], onlyExported: true }
});
const mapKeyB = buildMapCacheKey({
  buildId: 'build-1',
  options: { include: ['src'], onlyExported: true, focus: null, scope: 'repo' }
});
assert.equal(mapKeyA, mapKeyB);

const queryKeyA = buildQueryCacheKey({ query: 'foo', filters: ['a', 'b'] });
const queryKeyB = buildQueryCacheKey({ filters: ['a', 'b'], query: 'foo' });
assert.equal(queryKeyA.key, queryKeyB.key);

const localKeyA = buildLocalCacheKey({
  namespace: 'Bench Cache',
  payload: { b: 2, a: 1, omitted: undefined }
});
const localKeyB = buildLocalCacheKey({
  namespace: 'bench-cache',
  payload: { a: 1, b: 2 }
});
assert.equal(localKeyA.serialized, '{"namespace":"bench-cache","payload":{"a":1,"b":2},"version":"lk1"}');
assert.equal(localKeyA.key, localKeyB.key);

const localArrayKey = buildLocalCacheKey({
  namespace: 'array',
  payload: [1, undefined, { z: true, a: null }]
});
assert.equal(
  localArrayKey.serialized,
  '{"namespace":"array","payload":[1,null,{"a":null,"z":true}],"version":"lk1"}'
);

const planKeyA = buildQueryPlanCacheKey({ query: 'foo', configSignature: 'cfg', indexSignature: 'idx' });
const planKeyB = buildQueryPlanCacheKey({ query: 'foo', configSignature: 'cfg', indexSignature: 'idx' });
assert.equal(planKeyA.key, planKeyB.key);

console.log('cache contract matrix test passed');
