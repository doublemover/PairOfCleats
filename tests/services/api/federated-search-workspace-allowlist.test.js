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

const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-allowlist-');
const allowedRoot = path.join(tempRoot, 'allowed');
const blockedRoot = path.join(tempRoot, 'blocked');
const defaultRepo = path.join(allowedRoot, 'repo-default');
const blockedRepo = path.join(blockedRoot, 'repo-blocked');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(defaultRepo, { recursive: true });
await fs.mkdir(blockedRepo, { recursive: true });

await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot: './cache',
  repos: [
    { root: './repo-default', alias: 'allowed' },
    { root: '../blocked/repo-blocked', alias: 'blocked' }
  ]
});

const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot: defaultRepo,
  allowedRoots: [allowedRoot]
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'allowlist'
    },
    serverInfo
  );
  assert.equal(response.status, 403);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'FORBIDDEN');
} finally {
  await stop();
}

console.log('API federated search workspace allowlist test passed');
