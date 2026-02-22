#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-cors-allow';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared'
});

const origin = 'https://example.com';
const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  env,
  corsAllowedOrigins: ['example.com']
});

try {
  const allowed = await requestJson('GET', '/health', null, serverInfo, {
    headers: { Origin: origin }
  });
  if (allowed.status !== 200) {
    throw new Error('expected allowed origin to succeed');
  }
  const allowHeader = allowed.headers?.['access-control-allow-origin'];
  if (allowHeader !== origin) {
    throw new Error('expected access-control-allow-origin header to match origin');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API CORS allow test passed.');
