#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-repo-auth';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
const emptyRepo = path.join(cacheRoot, 'empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName,
  cacheScope: 'shared'
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [emptyRepo],
  env
});

try {
  const forbidden = await requestJson('POST', '/search', {
    repoPath: cacheRoot,
    query: 'return'
  }, serverInfo);
  if (forbidden.status !== 403 || forbidden.body?.code !== 'FORBIDDEN') {
    throw new Error('api-server should reject disallowed repo paths');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API repo authorization ok.');
