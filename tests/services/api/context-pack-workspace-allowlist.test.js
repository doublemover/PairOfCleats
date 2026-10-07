#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { applyTestEnv } from '../../helpers/test-env.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';
import { writeFederatedWorkspaceConfig, startFederatedApiServer } from '../../helpers/federated-api.js';

applyTestEnv();

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'api-context-pack-workspace-allowlist');
const allowedRoot = path.join(tempRoot, 'allowed-root');
const blockedRoot = path.join(tempRoot, 'blocked-root');
const repoRoot = path.join(allowedRoot, 'repo');
const workspacePath = path.join(blockedRoot, '.pairofcleats-workspace.jsonc');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(path.join(repoRoot, 'src'), { recursive: true });
await fs.mkdir(blockedRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, 'src', 'alpha.js'), 'export const alpha = 1;\n', 'utf8');
await writeFederatedWorkspaceConfig(workspacePath, {
  schemaVersion: 1,
  repos: [
    { root: repoRoot, alias: 'alpha', priority: 1 }
  ]
});

const { serverInfo, requestJson, stop } = await startFederatedApiServer({
  repoRoot,
  allowedRoots: [allowedRoot],
  envOverrides: process.env
});

try {
  const response = await requestJson('POST', '/analysis/context-pack', {
    repoPath: repoRoot,
    workspacePath,
    seed: 'chunk:chunk-risk',
    hops: 0,
    includeRisk: true,
    includeGraph: false,
    includeImports: false,
    includeUsages: false,
    includeCallersCallees: false
  }, serverInfo);

  assert.equal(response.status, 403, 'expected workspace path outside allowlist to be forbidden');
  assert.equal(response.body?.ok, false, 'expected API error envelope');
  assert.equal(response.body?.code, 'FORBIDDEN');
  assert.match(String(response.body?.message || ''), /not permitted/i);
} finally {
  await stop();
}

console.log('API context-pack workspace allowlist test passed');
