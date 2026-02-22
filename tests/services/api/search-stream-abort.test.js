#!/usr/bin/env node
import http from 'node:http';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-search-stream-abort';
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

const authHeader = { Authorization: 'Bearer test-token' };

const abortStream = () => new Promise((resolve, reject) => {
  const payload = JSON.stringify({ query: 'return', repoPath: fixtureRoot });
  const req = http.request(
    {
      host: serverInfo.host,
      port: serverInfo.port,
      path: '/search/stream',
      method: 'POST',
      headers: {
        ...authHeader,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
      }
    },
    (res) => {
      res.once('data', () => {
        res.destroy();
        resolve();
      });
    }
  );
  req.on('error', reject);
  req.write(payload);
  req.end();
});

try {
  await abortStream();
  await new Promise((resolve) => setTimeout(resolve, 50));
  const health = await requestJson('GET', '/health', null, serverInfo);
  if (!health.body?.ok) {
    throw new Error('api-server should remain healthy after stream abort');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API search stream abort test passed.');
