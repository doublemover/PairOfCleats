#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../../tools/shared/dict-utils.js';
import { loadWorkspaceConfig } from '../../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../../src/workspace/manifest.js';
import { toRealPathSync } from '../../../src/workspace/identity.js';

applyTestEnv();

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-compressed-artifacts-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');

await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repoRoot));
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-compressed');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.jsonl.gz'), 'compressed-chunks', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json.zst'), 'compressed-postings', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-compressed'
}, null, 2), 'utf8');
await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-compressed',
  buildRoot
}, null, 2), 'utf8');

await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [
    { "root": "./repo", "alias": "compressed" }
  ]
}`, 'utf8');

const workspaceConfig = loadWorkspaceConfig(workspacePath);
const { manifest } = await generateWorkspaceManifest(workspaceConfig, { write: false });
const repoEntry = manifest.repos[0];
assert.ok(repoEntry, 'workspace manifest should include repo entry');
assert.equal(
  repoEntry.indexes?.code?.availabilityReason,
  'present',
  `expected compressed artifact forms to satisfy presence checks: ${repoEntry.indexes?.code?.availabilityReason}`
);

console.log('compressed artifact presence test passed');
