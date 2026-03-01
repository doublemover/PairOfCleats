#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { getRepoCacheRoot } from '../../tools/shared/dict-utils.js';
import { toRealPathSync } from '../../src/workspace/identity.js';
import { loadWorkspaceConfig } from '../../src/workspace/config.js';
import { generateWorkspaceManifest } from '../../src/workspace/manifest.js';
import { validateWorkspaceManifest } from '../../src/contracts/validators/workspace.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-workspace-manifest-schema-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repo = path.join(tempRoot, 'repo');
await fs.mkdir(repo, { recursive: true });
await fs.writeFile(path.join(repo, '.pairofcleats.json'), JSON.stringify({ cache: { root: cacheRoot } }, null, 2), 'utf8');

const repoCacheRoot = getRepoCacheRoot(toRealPathSync(repo));
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(indexDir, { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({ compatibilityKey: 'compat-a' }), 'utf8');
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({ buildId: 'build-1', buildRoot }, null, 2), 'utf8');

const workspacePath = path.join(tempRoot, '.pairofcleats-workspace.jsonc');
await fs.writeFile(workspacePath, `{
  "schemaVersion": 1,
  "cacheRoot": "./cache",
  "repos": [{ "root": "./repo" }]
}`, 'utf8');

const resolved = loadWorkspaceConfig(workspacePath);
const { manifest } = await generateWorkspaceManifest(resolved, { write: false, generatedAt: '2026-02-20T00:00:00.000Z' });

const validation = validateWorkspaceManifest(manifest);
assert.equal(validation.ok, true, validation.errors.join('; '));

console.log('workspace manifest schema validation test passed');
