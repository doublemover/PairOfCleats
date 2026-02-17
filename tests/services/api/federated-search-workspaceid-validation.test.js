#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  createFederatedTempRoot,
  startFederatedApiServer
} from '../../helpers/federated-api.js';

applyTestEnv();

const tempRoot = await createFederatedTempRoot('pairofcleats-api-fed-wsid-');
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot,
  allowedRoots: [tempRoot]
});

try {
  const response = await requestJson(
    'POST',
    '/search/federated',
    {
      workspaceId: 'ws1-demo',
      query: 'sample'
    },
    serverInfo
  );
  assert.equal(response.status, 400);
  assert.equal(response.body?.ok, false);
  assert.equal(response.body?.code, 'INVALID_REQUEST');
  const errors = Array.isArray(response.body?.errors) ? response.body.errors : [];
  assert.ok(errors.some((entry) => String(entry).includes('workspacePath')), 'expected workspacePath validation error');
} finally {
  await stop();
}

console.log('API federated workspaceId validation test passed');
