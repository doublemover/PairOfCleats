#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-search-validation';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  env
});

try {
  const invalid = await requestJson('POST', '/search', {}, serverInfo);
  if (invalid.status !== 400 || invalid.body?.ok !== false || invalid.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing query');
  }

  const unknownField = await requestJson('POST', '/search', {
    query: 'return',
    extraField: true
  }, serverInfo);
  if (unknownField.status !== 400 || unknownField.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject unknown fields');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API search validation ok.');
