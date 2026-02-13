#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-win-canon-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'RepoCase');
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoVariant = repoRoot.replace('RepoCase', 'REPOCASE');
try {
  await fs.access(repoVariant);
} catch {
  await fs.symlink(repoRoot, repoVariant, 'dir');
}
const workspaceA = path.join(tempRoot, 'workspace-a.jsonc');
const workspaceB = path.join(tempRoot, 'workspace-b.jsonc');
await fs.writeFile(workspaceA, JSON.stringify({
  schemaVersion: 1,
  repos: [{ root: repoRoot }]
}, null, 2), 'utf8');
await fs.writeFile(workspaceB, JSON.stringify({
  schemaVersion: 1,
  repos: [{ root: repoVariant }]
}, null, 2), 'utf8');

const configA = loadWorkspaceConfig(workspaceA, { platform: 'win32' });
const configB = loadWorkspaceConfig(workspaceB, { platform: 'win32' });
const repoA = configA.repos[0];
const repoB = configB.repos[0];

assert.equal(repoA.repoRootCanonical, repoB.repoRootCanonical);
assert.equal(repoA.repoId, repoB.repoId);
assert.equal(configA.repoSetId, configB.repoSetId);
assert.equal(
  getRepoCacheRoot(repoA.repoRootCanonical),
  getRepoCacheRoot(repoB.repoRootCanonical),
  'cache keys should remain stable for mixed-case path variants on win32'
);

const duplicateWorkspace = path.join(tempRoot, 'workspace-dup.jsonc');
await fs.writeFile(duplicateWorkspace, JSON.stringify({
  schemaVersion: 1,
  repos: [{ root: repoRoot }, { root: repoVariant }]
}, null, 2), 'utf8');
assert.throws(
  () => loadWorkspaceConfig(duplicateWorkspace, { platform: 'win32' }),
  /Duplicate canonical repo root/i,
  'mixed-case duplicates should collapse to one canonical identity'
);

console.log('windows path canonicalization contract test passed');
