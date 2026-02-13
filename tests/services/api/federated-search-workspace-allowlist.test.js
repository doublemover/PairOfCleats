#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { startApiServer } from '../../helpers/api-server.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-api-fed-allowlist-'));
const allowedRoot = path.join(tempRoot, 'allowed');
const blockedRoot = path.join(tempRoot, 'blocked');
const defaultRepo = path.join(allowedRoot, 'repo-default');
const blockedRepo = path.join(blockedRoot, 'repo-blocked');
const workspacePath = path.join(allowedRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(defaultRepo, { recursive: true });
await fs.mkdir(blockedRepo, { recursive: true });

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-default", "alias": "allowed" },
    { "root": "../blocked/repo-blocked", "alias": "blocked" }
  ]
}`, 'utf8');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1'
};

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
