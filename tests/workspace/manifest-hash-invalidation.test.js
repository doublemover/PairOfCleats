#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { toRealPathSync } from '../../src/workspace/identity.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-hash-'));
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
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"a":[1]}', 'utf8');
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-1',
  buildRoot
}), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo", "alias": "initial" }]
}`, 'utf8');

const firstConfig = loadWorkspaceConfig(workspacePath);
const first = await generateWorkspaceManifest(firstConfig, { write: false, generatedAt: '2026-02-12T00:00:00.000Z' });
const firstSignature = first.manifest.repos[0].indexes.code.indexSignatureHash;

await new Promise((resolve) => setTimeout(resolve, 25));
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"a":[1,2,3]}', 'utf8');

const secondConfig = loadWorkspaceConfig(workspacePath);
const second = await generateWorkspaceManifest(secondConfig, { write: false, generatedAt: '2026-02-12T00:00:00.000Z' });
const secondSignature = second.manifest.repos[0].indexes.code.indexSignatureHash;
assert.notEqual(firstSignature, secondSignature, `indexSignatureHash should change when token_postings.json changes (${firstSignature} vs ${secondSignature})`);
assert.notEqual(first.manifest.manifestHash, second.manifest.manifestHash, 'manifestHash should change with index artifact updates');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo", "alias": "renamed-only" }]
}`, 'utf8');

const thirdConfig = loadWorkspaceConfig(workspacePath);
const third = await generateWorkspaceManifest(thirdConfig, { write: false, generatedAt: '2026-02-12T00:00:00.000Z' });
assert.equal(second.manifest.manifestHash, third.manifest.manifestHash, 'display-only edits must not change manifestHash');

console.log('workspace manifest hash invalidation test passed');
