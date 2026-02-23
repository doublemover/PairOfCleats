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

const GENERATED_AT = '2026-02-12T00:00:00.000Z';

const writeRepoConfig = async (repoRoot, cacheRoot) => {
  await fs.mkdir(repoRoot, { recursive: true });
  await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
    cache: { root: cacheRoot }
  }, null, 2), 'utf8');
};

const writeRepoBuild = async (repoRoot, { buildId, tokenPostings = '{}', compatibilityKey = null }) => {
  const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
  const buildRoot = path.join(repoCacheRoot, 'builds', buildId);
  const indexDir = path.join(buildRoot, 'index-code');
  await fs.mkdir(indexDir, { recursive: true });
  await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), tokenPostings, 'utf8');
  const includeIndexState = compatibilityKey !== false;
  if (includeIndexState) {
    await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
      compatibilityKey: compatibilityKey || `compat-${buildId}`
    }), 'utf8');
  }
  await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
  await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
    buildId,
    buildRoot
  }), 'utf8');
  return { repoCacheRoot, buildRoot, indexDir };
};

const generateManifestFromWorkspace = async (workspacePath) => {
  const workspaceConfig = loadWorkspaceConfig(workspacePath);
  return await generateWorkspaceManifest(workspaceConfig, { write: false, generatedAt: GENERATED_AT });
};

// Determinism scenario: repeated generation with identical inputs must be byte-stable.
{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-determinism-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoA = path.join(tempRoot, 'repo-a');
  const repoB = path.join(tempRoot, 'repo-b');
  const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

  await writeRepoConfig(repoA, cacheRoot);
  await writeRepoConfig(repoB, cacheRoot);
  await writeRepoBuild(repoA, { buildId: 'build-a' });
  await writeRepoBuild(repoB, { buildId: 'build-b' });
  await fs.writeFile(workspacePath, `{
    "schemaVersion": 1,
    "cacheRoot": "./cache",
    "repos": [
      { "root": "./repo-b", "alias": "B" },
      { "root": "./repo-a", "alias": "A" }
    ]
  }`, 'utf8');

  const first = await generateManifestFromWorkspace(workspacePath);
  const second = await generateManifestFromWorkspace(workspacePath);

  assert.equal(first.manifestPath, second.manifestPath);
  assert.equal(stableStringify(first.manifest), stableStringify(second.manifest), 'manifest output should be byte-stable');
  const repoIds = first.manifest.repos.map((entry) => entry.repoId);
  assert.deepEqual(repoIds, repoIds.slice().sort(), 'repos should be sorted by repoId');
}

// Hash scenario: artifact-content changes should alter hashes; alias-only edits should not.
{
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-hash-'));
  const cacheRoot = path.join(tempRoot, 'cache');
  const repoRoot = path.join(tempRoot, 'repo');
  const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

  await writeRepoConfig(repoRoot, cacheRoot);
  const { indexDir } = await writeRepoBuild(repoRoot, {
    buildId: 'build-1',
    tokenPostings: '{"a":[1]}',
    compatibilityKey: false
  });
  await fs.writeFile(workspacePath, `{
    "schemaVersion": 1,
    "cacheRoot": "./cache",
    "repos": [{ "root": "./repo", "alias": "initial" }]
  }`, 'utf8');

  const first = await generateManifestFromWorkspace(workspacePath);
  const firstSignature = first.manifest.repos[0].indexes.code.indexSignatureHash;

  await new Promise((resolve) => setTimeout(resolve, 25));
  await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"a":[1,2,3]}', 'utf8');

  const second = await generateManifestFromWorkspace(workspacePath);
  const secondSignature = second.manifest.repos[0].indexes.code.indexSignatureHash;
  assert.notEqual(
    firstSignature,
    secondSignature,
    `indexSignatureHash should change when token_postings.json changes (${firstSignature} vs ${secondSignature})`
  );
  assert.notEqual(first.manifest.manifestHash, second.manifest.manifestHash, 'manifestHash should change with index artifact updates');

  await fs.writeFile(workspacePath, `{
    "schemaVersion": 1,
    "cacheRoot": "./cache",
    "repos": [{ "root": "./repo", "alias": "renamed-only" }]
  }`, 'utf8');

  const third = await generateManifestFromWorkspace(workspacePath);
  assert.equal(second.manifest.manifestHash, third.manifest.manifestHash, 'display-only edits must not change manifestHash');
}

console.log('workspace manifest determinism/hash test passed');
