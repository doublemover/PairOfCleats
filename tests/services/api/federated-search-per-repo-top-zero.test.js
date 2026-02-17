#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-top-zero-'));
const allowedRoot = path.join(tempRoot, 'allowed');
const repoRoot = path.join(allowedRoot, 'repo');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const env = {
  ...process.env,};

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
      query: 'per-repo-top-zero',
      limits: {
        perRepoTop: 0,
        concurrency: 1
      }
    },
    serverInfo
  );
  assert.notEqual(
    response.status,
    400,
    'request should pass API schema validation when limits.perRepoTop is zero'
  );
  assert.notEqual(response.body?.code, 'INVALID_REQUEST');
  if (response.status === 200) {
    assert.equal(response.body?.ok, true);
    assert.equal(response.body?.backend, 'federated');
  }
} finally {
  await stop();
}

console.log('API federated per-repo top zero validation test passed');
