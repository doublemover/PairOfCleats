#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-client-errors-'));
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
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
  allowedRoots: [tempRoot],
  env
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
