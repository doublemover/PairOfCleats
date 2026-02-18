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

const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-client-errors-');
const repoRoot = path.join(tempRoot, 'repo');
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
  allowedRoots: [tempRoot]
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspacePath,
      query: 'cohort-client-error',
      cohort: ['missing-cohort'],
      search: {
        mode: 'code',
        top: 5
      }
    },
    serverInfo
  );
  assert.equal(response.status, 400, 'invalid federated cohort selector should be a client error');
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'INVALID_REQUEST');
} finally {
  await stop();
}

console.log('API federated client error status test passed');
