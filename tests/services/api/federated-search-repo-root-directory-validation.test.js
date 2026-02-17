#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-repo-root-directory-'));
const allowedRoot = path.join(tempRoot, 'allowed');
const defaultRepo = path.join(allowedRoot, 'repo-default');
const notDirectory = path.join(allowedRoot, 'repo-root.txt');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(defaultRepo, { recursive: true });
await fs.writeFile(notDirectory, 'not a directory', 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-root.txt", "alias": "bad-root" }
  ]
}`, 'utf8');

const env = {
  ...process.env,};

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot: defaultRepo,
  allowedRoots: [allowedRoot],
  env
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'directory-validation'
    },
    serverInfo
  );
  assert.equal(response.status, 400);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'INVALID_REQUEST');
  assert.match(String(response.body?.message || ''), /must be a directory/i);
} finally {
  await stop();
}

console.log('API federated repo-root directory validation test passed');
