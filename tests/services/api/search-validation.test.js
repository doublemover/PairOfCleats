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
  cacheName,
  cacheScope: 'shared'
});

const { serverInfo, requestJson, requestRaw, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  maxBodyBytes: 512,
  env
});

try {
  const invalid = await requestJson('POST', '/search', {}, serverInfo);
  if (invalid.status !== 400 || invalid.body?.ok !== false || invalid.body?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing query');
  }

  const missingContentType = await requestRaw(
    'POST',
    '/search',
    JSON.stringify({ query: 'return' }),
    serverInfo,
    { headers: {} }
  );
  if (missingContentType.status !== 415 || missingContentType.json?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should reject missing content-type');
  }

  const oversizedPayload = { query: 'return', extra: 'x'.repeat(600) };
  const tooLarge = await requestRaw(
    'POST',
    '/search',
    JSON.stringify(oversizedPayload),
    serverInfo,
    { headers: { 'Content-Type': 'application/json' } }
  );
  if (tooLarge.status !== 413 || tooLarge.json?.code !== 'INVALID_REQUEST') {
    throw new Error('api-server should enforce body size limits');
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
