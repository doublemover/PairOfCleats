#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-wsid-'));
const repoRoot = path.join(tempRoot, 'repo');
await fs.mkdir(repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1'
};

const { serverInfo, requestJson, stop } = await startApiServer({
  repoRoot,
  allowedRoots: [tempRoot],
  env
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
