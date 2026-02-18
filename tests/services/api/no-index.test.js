#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

applyTestEnv();

const cacheRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-no-index-'));
const defaultRepo = path.join(cacheRoot, 'default');
const emptyRepo = path.join(cacheRoot, 'empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(defaultRepo, { recursive: true });
await fsPromises.mkdir(emptyRepo, { recursive: true });
await fsPromises.writeFile(path.join(defaultRepo, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const env = {
  ...process.env,  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: '0'
};

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: defaultRepo,
  allowedRoots: [emptyRepo],
  env
});

try {
  const noIndex = await requestJson('POST', '/search', {
    repoPath: emptyRepo,
    query: 'return'
  }, serverInfo);
  assert.equal(noIndex.status, 409);
  assert.equal(noIndex.body?.code, 'NO_INDEX');
} finally {
  await stop();
  await fsPromises.rm(cacheRoot, { recursive: true, force: true });
}

console.log('API no-index response ok.');
