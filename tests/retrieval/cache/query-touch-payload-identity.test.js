import { createCacheFixtureExecutions } from './query-cache-fixture.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { persistSearchSession } from '../../../src/retrieval/cli/run-search-session/persist.js';
import { persistQueryCacheTouch } from '../../../src/retrieval/query-cache-touches.js';
import { loadQueryCache } from '../../../src/retrieval/query-cache.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';
const { dir } = await prepareIsolatedTestCacheDir('query-touch-payload-identity');
try {
  const cachePath = path.join(dir, 'cache.json');
  await persistSearchSession({ executionOutcomes: createCacheFixtureExecutions(), queryCacheEnabled: true, cacheKey: 'key', cacheHit: false,
    cacheData: { version: 1, entries: [] }, queryCachePath: cachePath, queryCacheTtlMs: 60000,
    cacheSignature: 'generation', codeHits: [{ id: 1, text: 'x'.repeat(100000) }],
    proseHits: [], extractedProseHits: [], recordHits: [], queryCacheMaxEntries: 8 });
  const original = await fs.readFile(cachePath, 'utf8'), saved = JSON.parse(original).entries[0];
  const ts = saved.ts + 10;
  assert.equal(await persistQueryCacheTouch({ cachePath, key: 'key', signature: 'generation', payloadId: saved.payloadId, ts, maxEntries: 8 }), true);
  assert.equal(await fs.readFile(cachePath, 'utf8'), original, 'a hit writes recency metadata without serializing payloads');
  assert.equal(loadQueryCache(cachePath).entries[0].ts, ts);
  await persistQueryCacheTouch({ cachePath, key: 'key', signature: 'wrong-generation', payloadId: saved.payloadId, ts: ts + 100, maxEntries: 8 });
  await persistQueryCacheTouch({ cachePath, key: 'key', signature: 'generation', payloadId: 'replaced-payload', ts: ts + 200, maxEntries: 8 });
  assert.equal(loadQueryCache(cachePath).entries[0].ts, ts, 'touches cannot transfer between payload or generation identities');
  assert.ok((await fs.stat(`${cachePath}.touches.json`)).size < 4096);
} finally { await fs.rm(dir, { recursive: true, force: true }); }
console.log('Awaited cache touches preserve sliding recency without rewriting immutable result payloads.');
