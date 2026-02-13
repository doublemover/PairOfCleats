#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-catalog-json-'));
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
const expectedFederationCacheRoot = path.resolve(tempRoot, 'workspace-cache');
const toolPath = path.join(root, 'tools', 'workspace', 'catalog.js');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: path.join(tempRoot, 'repo-cache-root') }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');

await fs.mkdir(path.join(indexDir), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-build-1'
}, null, 2), 'utf8');
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-1',
  buildRoot
}, null, 2), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "name": "catalog fixture",
  "cacheRoot": "./workspace-cache",
  "repos": [
    { "root": "./repo", "alias": "sample" }
  ]
}`, 'utf8');

const run = spawnSync(
  process.execPath,
  [toolPath, '--workspace', workspacePath, '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);

assert.equal(payload.ok, true);
assert.equal(
  toRealPathSync(payload.cacheRoots?.federationCacheRoot),
  toRealPathSync(expectedFederationCacheRoot)
);
assert.equal(typeof payload.cacheRoots?.workspaceManifestPath, 'string');
assert.ok(payload.cacheRoots.workspaceManifestPath.endsWith('.json'));
assert.equal(payload.repos.length, 1);
assert.equal(typeof payload.repos[0]?.repoId, 'string');
assert.ok(payload.repos[0].repoId.startsWith('repo-'));
assert.ok(payload.repos[0]?.pointer, 'expected pointer/build metadata for repo');
assert.equal(payload.repos[0]?.pointer?.buildId, 'build-1');
assert.equal(payload.repos[0]?.pointer?.parseOk, true);
assert.equal(typeof payload.repos[0]?.pointer?.currentJsonPath, 'string');
assert.equal(
  toRealPathSync(payload.repos[0]?.repoCacheRoot),
  toRealPathSync(repoCacheRoot),
  'catalog should report repo-specific cache roots'
);

console.log('workspace catalog json test passed');
