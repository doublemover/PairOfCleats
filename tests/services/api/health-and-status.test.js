#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-health-status';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
await fsPromises.rm(cacheRoot, { recursive: true, force: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared'
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [],
  env
});

try {
  const unauthorized = await requestJson('GET', '/health', null, serverInfo, { auth: false });
  if (unauthorized.status !== 401 || unauthorized.body?.code !== 'UNAUTHORIZED') {
    throw new Error('api-server should reject missing auth');
  }

  const corsBlocked = await requestJson('GET', '/health', null, serverInfo, {
    headers: { Origin: 'https://example.com' }
  });
  if (corsBlocked.status !== 403 || corsBlocked.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed CORS origins');
  }

  const preflightBlocked = await requestJson('OPTIONS', '/health', null, serverInfo, {
    headers: {
      Origin: 'https://example.com',
      'Access-Control-Request-Method': 'GET'
    }
  });
  if (preflightBlocked.status !== 403 || preflightBlocked.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed CORS preflight');
  }

  const health = await requestJson('GET', '/health', null, serverInfo);
  if (!health.body?.ok || typeof health.body.uptimeMs !== 'number') {
    throw new Error('api-server /health response invalid');
  }

  const status = await requestJson('GET', '/status', null, serverInfo);
  if (!status.body?.ok || !status.body.status?.repo?.root) {
    throw new Error('api-server /status response missing repo info');
  }
  const statusBody = JSON.stringify(status.body);
  if (statusBody.includes(fixtureRoot) || statusBody.includes(cacheRoot)) {
    throw new Error('api-server /status response leaked absolute paths');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API health/status ok.');
