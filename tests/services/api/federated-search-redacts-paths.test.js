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

const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-redaction-');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });

await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  cacheRoot: './cache',
  repos: [
    { root: './repo', alias: 'sample' }
  ]
});

const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot,
  allowedRoots: [tempRoot],
  envOverrides: {
    PAIROFCLEATS_CACHE_ROOT: cacheRoot
  }
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'greet',
      select: {
        tags: ['does-not-exist']
      },
      search: {
        mode: 'code',
        top: 5
      }
    },
    serverInfo
  );
  assert.equal(response.status, 200);
  assert.equal(response.body?.ok, true);
  assert.deepEqual(response.body?.code || [], [], 'empty selection should return zero hits');

  const serialized = JSON.stringify(response.body);
  assert.equal(serialized.includes(repoRoot), false, 'response should not expose absolute repo root paths');
  assert.equal(serialized.includes(workspacePath), false, 'response should not expose absolute workspace path');
  assert.equal(serialized.includes(cacheRoot), false, 'response should not expose absolute cache root');
} finally {
  await stop();
}

console.log('API federated search redacts paths test passed');
