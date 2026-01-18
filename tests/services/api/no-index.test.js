#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { ensureFixtureIndex } from '../../helpers/fixture-index.js';
import { startApiServer } from '../../helpers/api-server.js';

const cacheName = 'api-no-index';
const cacheRoot = path.join(process.cwd(), 'tests', '.cache', cacheName);
const emptyRepo = path.join(cacheRoot, 'empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });

const { fixtureRoot, env } = await ensureFixtureIndex({
  fixtureName: 'sample',
  cacheName
});

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: fixtureRoot,
  allowedRoots: [emptyRepo],
  env
});

try {
  const noIndex = await requestJson('POST', '/search', {
    repoPath: emptyRepo,
    query: 'return'
  }, serverInfo);
  if (noIndex.status !== 409 || noIndex.body?.code !== 'NO_INDEX') {
    throw new Error('api-server should return NO_INDEX when indexes are missing');
  }
} catch (err) {
  console.error(err?.message || err);
  process.exit(1);
} finally {
  await stop();
}

console.log('API no-index response ok.');
