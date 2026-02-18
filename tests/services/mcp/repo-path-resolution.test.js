#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveRepoPath, resolveToolTimeoutMs } from '../../../tools/mcp/repo.js';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';

const workspaceRoot = process.cwd();
const testRoot = path.join(workspaceRoot, '.testCache', 'mcp-repo-path-resolution');
const repoRoot = path.join(testRoot, 'repo');
const nested = path.join(repoRoot, 'nested', 'pkg');
const cacheRoot = path.join(testRoot, 'cache');
const normPath = (value) => path.normalize(String(value || '')).toLowerCase();

const ensureRepoArtifacts = async (repoPath, buildId = 'test-build') => {
  const userConfig = loadUserConfig(repoPath);
  const repoCacheRoot = getRepoCacheRoot(repoPath, userConfig);
  const buildsRoot = path.join(repoCacheRoot, 'builds');
  await fsPromises.mkdir(buildsRoot, { recursive: true });
  const currentPath = path.join(buildsRoot, 'current.json');
  await fsPromises.writeFile(
    currentPath,
    JSON.stringify({ buildId, buildRoot: buildId }, null, 2),
    'utf8'
  );
  return repoCacheRoot;
};

await fsPromises.rm(testRoot, { recursive: true, force: true });
await fsPromises.mkdir(nested, { recursive: true });

const gitInit = spawnSync('git', ['init', '-q'], {
  cwd: repoRoot,
  stdio: 'ignore'
});
if (gitInit.status !== 0) {
  console.error('Failed to initialize temporary git repository for MCP repo-path resolution test.');
  process.exit(gitInit.status ?? 1);
}

const prevCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
const prevTesting = process.env.PAIROFCLEATS_TESTING;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
applyTestEnv();

try {
  const rootCache = await ensureRepoArtifacts(repoRoot, 'root-build');
  const resolvedFromNested = resolveRepoPath(nested);
  assert.equal(
    normPath(resolvedFromNested),
    normPath(repoRoot),
    'repoPath should resolve to repository root when canonical root has artifacts'
  );

  await fsPromises.rm(rootCache, { recursive: true, force: true });
  await ensureRepoArtifacts(nested, 'nested-build');
  const resolvedWithNestedArtifacts = resolveRepoPath(nested);
  assert.equal(
    normPath(resolvedWithNestedArtifacts),
    normPath(nested),
    'repoPath should remain explicit when canonical root has no artifacts and explicit path does'
  );

  const configPath = path.join(repoRoot, '.pairofcleats.json');
  await fsPromises.writeFile(
    configPath,
    JSON.stringify({
      mcp: {
        toolTimeoutMs: 4321,
        toolTimeouts: {
          search: 9876
        }
      }
    }, null, 2),
    'utf8'
  );

  const perToolTimeout = resolveToolTimeoutMs('search', { repoPath: nested }, {
    envToolTimeoutMs: 111,
    defaultToolTimeoutMs: 222,
    defaultToolTimeouts: {}
  });
  assert.equal(
    perToolTimeout,
    9876,
    'toolTimeouts from repository root config should apply for nested repoPath'
  );

  const defaultToolTimeout = resolveToolTimeoutMs('index_status', { repoPath: nested }, {
    envToolTimeoutMs: 111,
    defaultToolTimeoutMs: 222,
    defaultToolTimeouts: {}
  });
  assert.equal(
    defaultToolTimeout,
    4321,
    'toolTimeoutMs from repository root config should apply for nested repoPath'
  );
} finally {
  if (prevCacheRoot === undefined) delete process.env.PAIROFCLEATS_CACHE_ROOT;
  else process.env.PAIROFCLEATS_CACHE_ROOT = prevCacheRoot;
  if (prevTesting === undefined) delete process.env.PAIROFCLEATS_TESTING;
  else process.env.PAIROFCLEATS_TESTING = prevTesting;
  if (fs.existsSync(testRoot)) {
    await fsPromises.rm(testRoot, { recursive: true, force: true });
  }
}

console.log('MCP repo path resolution test passed');
