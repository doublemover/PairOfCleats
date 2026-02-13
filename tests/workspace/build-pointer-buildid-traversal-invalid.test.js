#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-buildid-traversal-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildsRoot = path.join(repoCacheRoot, 'builds');
const externalBuildRoot = path.join(tempRoot, 'external-build');
const externalCodeDir = path.join(externalBuildRoot, 'index-code');
await fs.mkdir(externalCodeDir, { recursive: true });
await fs.writeFile(path.join(externalCodeDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(externalCodeDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(externalCodeDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-external'
}), 'utf8');

await fs.mkdir(buildsRoot, { recursive: true });
const escapedBuildId = path.relative(buildsRoot, externalBuildRoot);
await fs.writeFile(path.join(buildsRoot, 'current.json'), JSON.stringify({
  buildId: escapedBuildId,
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

assert.equal(repo.build.parseOk, true, 'current.json should parse');
assert.equal(repo.build.buildRoot, null, 'escaped buildId should be treated as invalid pointer');
assert.equal(repo.indexes.code.availabilityReason, 'invalid-pointer');
assert.equal(repo.indexes.code.present, false, 'invalid pointer should not load external index directories');
assert.equal(repo.indexes.code.indexSignatureHash, null, 'invalid pointer should not compute external signatures');
assert.ok(
  manifest.diagnostics.warnings.some((entry) => (
    entry.code === 'WARN_WORKSPACE_INVALID_BUILD_POINTER'
      && String(entry.message || '').includes('buildId points outside repo cache')
  )),
  'expected invalid buildId pointer warning'
);

console.log('workspace buildId traversal pointer invalid test passed');
