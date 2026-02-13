#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';
import { stableStringify } from '../../src/shared/stable-json.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-determinism-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoA = path.join(tempRoot, 'repo-a');
const repoB = path.join(tempRoot, 'repo-b');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

const writeRepoConfig = async (repoRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
};

const writeRepoBuild = async (repoRoot, buildId) => {
  const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
  await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
    compatibilityKey: `compat-${buildId}`
  }), 'utf8');
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId,
    buildRoot
  }), 'utf8');
};

await writeRepoConfig(repoA);
await writeRepoConfig(repoB);
await writeRepoBuild(repoA, 'build-a');
await writeRepoBuild(repoB, 'build-b');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo-b", "alias": "B" },
    { "root": "./repo-a", "alias": "A" }
  ]
}`, 'utf8');

const workspaceConfig = loadWorkspaceConfig(workspacePath);
const generatedAt = '2026-02-12T00:00:00.000Z';
const first = await generateWorkspaceManifest(workspaceConfig, { write: false, generatedAt });
const second = await generateWorkspaceManifest(workspaceConfig, { write: false, generatedAt });

assert.equal(first.manifestPath, second.manifestPath);
assert.equal(stableStringify(first.manifest), stableStringify(second.manifest), 'manifest output should be byte-stable');
const repoIds = first.manifest.repos.map((entry) => entry.repoId);
assert.deepEqual(repoIds, repoIds.slice().sort(), 'repos should be sorted by repoId');

console.log('workspace manifest determinism test passed');
