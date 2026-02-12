#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-invalid-pointer-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-a'
}), 'utf8');

await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), '{invalid json', 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo" }]
}`, 'utf8');

const workspaceConfig = loadWorkspaceConfig(workspacePath);
const { manifest } = await generateWorkspaceManifest(workspaceConfig, { write: false });
const repo = manifest.repos[0];
const codeMode = repo.indexes.code;

assert.equal(repo.build.currentJsonExists, true, 'current.json should be detected');
assert.equal(repo.build.parseOk, false, 'invalid current.json should be treated as missing pointer');
assert.equal(repo.build.buildId, null, 'invalid pointer should clear buildId');
assert.equal(codeMode.availabilityReason, 'invalid-pointer');
assert.equal(codeMode.indexSignatureHash, null, 'invalid pointer should not preserve stale index signatures');

console.log('workspace invalid build pointer treated as missing test passed');
