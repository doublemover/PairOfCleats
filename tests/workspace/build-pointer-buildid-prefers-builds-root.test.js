#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-buildid-prefers-builds-root-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildsRoot = path.join(repoCacheRoot, 'builds');
const buildId = 'build-1';
const canonicalBuildRoot = path.join(buildsRoot, buildId);
const canonicalIndexDir = path.join(canonicalBuildRoot, 'index-code');
const rogueBuildRoot = path.join(repoCacheRoot, buildId);
const rogueIndexDir = path.join(rogueBuildRoot, 'index-code');

await fs.mkdir(canonicalIndexDir, { recursive: true });
await fs.writeFile(path.join(canonicalIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(canonicalIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(canonicalIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-builds'
}), 'utf8');

await fs.mkdir(rogueIndexDir, { recursive: true });
await fs.writeFile(path.join(rogueIndexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(rogueIndexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(rogueIndexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-rogue'
}), 'utf8');

await fs.mkdir(buildsRoot, { recursive: true });
await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
  buildId,
  modes: ['code']
}), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo" }]
}`, 'utf8');

const workspaceConfig = loadWorkspaceConfig(workspacePath);
const { manifest } = await generateWorkspaceManifest(workspaceConfig, { write: false });
const repo = manifest.repos[0];

assert.equal(
  repo.build.buildRoot,
  toRealPathSync(canonicalBuildRoot),
  'buildId fallback should resolve to builds/<buildId>'
);
assert.equal(
  repo.indexes.code.indexDir,
  toRealPathSync(canonicalIndexDir),
  'index path should come from builds/<buildId>/index-code'
);
assert.equal(
  repo.indexes.code.compatibilityKey,
  'compat-builds',
  'manifest should read index_state from builds root, not repo-cache sibling path'
);

console.log('workspace buildId fallback prefers builds root test passed');
