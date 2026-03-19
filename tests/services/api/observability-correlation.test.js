#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-observability-correlation';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared',
  requiredModes: ['code']
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  env
});

try {
  const headers = {
    'X-Correlation-Id': 'api-correlation-test',
    'X-Request-Id': 'api-request-test'
  };
  const searchResponse = await requestJson(
    'POST',
    '/search',
    { query: 'return', mode: 'code', top: 3 },
    serverInfo,
    { headers }
  );
  assert.equal(searchResponse.status, 200);
  assert.equal(searchResponse.headers['x-correlation-id'], 'api-correlation-test');
  assert.equal(searchResponse.headers['x-request-id'], 'api-request-test');
  assert.equal(searchResponse.body?.observability?.correlation?.correlationId, 'api-correlation-test');
  assert.equal(searchResponse.body?.result?.observability?.correlation?.correlationId, 'api-correlation-test');
} finally {
  await stop();
}

console.log('API observability correlation test passed');
