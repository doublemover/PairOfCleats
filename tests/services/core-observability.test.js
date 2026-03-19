#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { buildIndex, search } from '../../src/integrations/core/index.js';
import { resolveTestCachePath } from '../helpers/test-cache.js';
import { withTemporaryEnv } from '../helpers/test-env.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const cacheRoot = resolveTestCachePath(root, 'core-observability');

await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await withTemporaryEnv({
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
}, async () => {
  const buildCorrelationId = 'core-build-correlation';
  const buildResult = await buildIndex(fixtureRoot, {
    stage: 'stage2',
    mode: 'code',
    sqlite: false,
    stubEmbeddings: true,
    log: () => {},
    observability: {
      correlation: {
        correlationId: buildCorrelationId,
        requestId: 'core-build-request'
      }
    }
  });
  assert.equal(
    buildResult?.observability?.correlation?.correlationId,
    buildCorrelationId,
    'expected buildIndex to preserve explicit correlation id'
  );
  assert.equal(buildResult?.observability?.surface, 'build');
  assert.equal(buildResult?.observability?.operation, 'build_index');

  const searchCorrelationId = 'core-search-correlation';
  const searchResult = await search(fixtureRoot, {
    query: 'return',
    mode: 'code',
    json: true,
    observability: {
      correlation: {
        correlationId: searchCorrelationId,
        requestId: 'core-search-request'
      }
    }
  });
  assert.equal(
    searchResult?.observability?.correlation?.correlationId,
    searchCorrelationId,
    'expected search to preserve explicit correlation id'
  );
  assert.equal(searchResult?.observability?.surface, 'search');
  assert.equal(searchResult?.observability?.operation, 'search');
  assert.ok(Array.isArray(searchResult?.code), 'expected search results to remain intact');
});

console.log('core observability test passed');
