#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createFederatedTempRoot,
  startFederatedApiServer,
  writeFederatedWorkspaceConfig
} from '../../helpers/federated-api.js';

applyTestEnv();

const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-cache-allowlist-');
const allowedRoot = path.join(tempRoot, 'allowed');
const blockedRoot = path.join(tempRoot, 'blocked');
const repoRoot = path.join(allowedRoot, 'repo');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(blockedRoot, { recursive: true });

await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot: '../blocked/cache',
  repos: [
    { root: './repo', alias: 'sample' }
  ]
});

const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot,
  allowedRoots: [allowedRoot]
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'cache-root-allowlist'
    },
    serverInfo
  );
  assert.equal(response.status, 403);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'FORBIDDEN');
} finally {
  await stop();
}

console.log('API federated cache-root allowlist test passed');
