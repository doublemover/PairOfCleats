#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-cache-symlink-'));
const allowedRoot = path.join(tempRoot, 'allowed');
const blockedRoot = path.join(tempRoot, 'blocked');
const repoRoot = path.join(allowedRoot, 'repo');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');
const cacheLinkPath = path.join(allowedRoot, 'cache-link');

await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(blockedRoot, { recursive: true });
await fs.symlink(blockedRoot, cacheLinkPath, process.platform === 'win32' ? 'junction' : 'dir');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache-link/federated-cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1'
};

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot,
  allowedRoots: [allowedRoot],
  env
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'cache-root-symlink-escape'
    },
    serverInfo
  );
  assert.equal(response.status, 403);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'FORBIDDEN');
} finally {
  await stop();
}

console.log('API federated cache-root symlink escape test passed');
