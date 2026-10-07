#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { createWorkspaceAllowlist } from '../../../tools/api/router/workspace-allowlist.js';
import { ERROR_CODES } from '../../../src/shared/error-codes.js';
import { normalizeIdentityPath } from '../../../src/workspace/identity.js';
import { prepareIsolatedTestCacheDir } from '../../helpers/test-cache.js';

const { dir: tempRoot } = await prepareIsolatedTestCacheDir('api-workspace-allowlist');
const allowedRoot = path.join(tempRoot, 'allowed');
const outsideRoot = path.join(tempRoot, 'outside');
const repoRoot = path.join(allowedRoot, 'repo-a');
const workspaceDir = path.join(allowedRoot, 'workspace');
const workspacePath = path.join(workspaceDir, '.pairofcleats-workspace.jsonc');
const allowedCacheRoot = path.join(allowedRoot, 'workspace-cache');
const outsideCacheRoot = path.join(outsideRoot, 'workspace-cache');

await fs.mkdir(repoRoot, { recursive: true });
await fs.mkdir(workspaceDir, { recursive: true });
await fs.mkdir(outsideRoot, { recursive: true });

const writeWorkspace = async ({ cacheRoot = allowedCacheRoot } = {}) => {
  await fs.writeFile(workspacePath, JSON.stringify({
    schemaVersion: 1,
    name: 'API Workspace Allowlist',
    cacheRoot,
    repos: [
      { root: repoRoot, alias: 'repo-a' }
    ]
  }, null, 2), 'utf8');
};

const resolvedRepos = [];
const allowlist = createWorkspaceAllowlist({
  defaultRepo: allowedRoot,
  allowedRepoRoots: [],
  resolveRepo: async (repoPath) => {
    resolvedRepos.push(repoPath);
    return repoPath;
  }
});

try {
  await writeWorkspace();
  const workspaceConfig = await allowlist.ensureWorkspaceAllowlist({ workspacePath });
  assert.equal(
    workspaceConfig.workspacePath,
    normalizeIdentityPath(workspacePath),
    'expected workspace path to round-trip'
  );
  assert.equal(resolvedRepos.length, 1, 'expected workspace repos to be validated through resolveRepo');
  assert.equal(resolvedRepos[0], workspaceConfig.repos[0].repoRootCanonical);

  await assert.rejects(
    () => allowlist.ensureWorkspaceAllowlist({
      workspacePath,
      workspaceId: 'workspace-id-mismatch'
    }),
    /workspaceId does not match/i,
    'expected workspaceId mismatch to be rejected'
  );

  await writeWorkspace({ cacheRoot: outsideCacheRoot });
  await assert.rejects(
    () => allowlist.ensureWorkspaceAllowlist({ workspacePath }),
    (err) => err?.code === ERROR_CODES.FORBIDDEN
      && /cache root not permitted/i.test(String(err?.message || '')),
    'expected cache roots outside the configured allowlist to be forbidden'
  );

  await assert.rejects(
    () => allowlist.ensureWorkspaceAllowlist({
      workspacePath: path.join(outsideRoot, '.pairofcleats-workspace.jsonc')
    }),
    (err) => err?.code === ERROR_CODES.FORBIDDEN
      && /workspace path not permitted/i.test(String(err?.message || '')),
    'expected workspace files outside the configured allowlist to be forbidden'
  );

  console.log('API workspace allowlist test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
