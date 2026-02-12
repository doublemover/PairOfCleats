#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, getRepoId, loadUserConfig, toRealPathSync } from '../../../tools/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-explicit-repo-'));
const cacheRoot = path.join(tempRoot, 'cache');
const parentRoot = path.join(tempRoot, 'parent');
const explicitRepoPath = path.join(parentRoot, 'child');
const toolPath = path.join(root, 'tools', 'index', 'stats.js');
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

await fs.mkdir(explicitRepoPath, { recursive: true });
await fs.writeFile(path.join(parentRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: path.join(tempRoot, 'parent-cache-root') }
}, null, 2), 'utf8');

const explicitUserConfig = loadUserConfig(explicitRepoPath);
const explicitRepoCacheRoot = getRepoCacheRoot(explicitRepoPath, explicitUserConfig);
const buildRoot = path.join(explicitRepoCacheRoot, 'builds', 'build-child');
const indexDir = path.join(buildRoot, 'index-code');

await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"tokens":["alpha"]}', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-child'
}, null, 2), 'utf8');
await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  repoId: getRepoId(explicitRepoPath),
  buildId: 'build-child',
  compatibilityKey: 'compat-child',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [
    { name: 'chunk_meta', path: 'chunk_meta.json', bytes: Buffer.byteLength('[{"id":1}]', 'utf8'), count: 1 },
    { name: 'token_postings', path: 'token_postings.json', bytes: Buffer.byteLength('{"tokens":["alpha"]}', 'utf8'), count: 1 }
  ]
}, null, 2), 'utf8');
await fs.mkdir(path.join(explicitRepoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(explicitRepoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-child',
  buildRoot
}, null, 2), 'utf8');

const run = spawnSync(
  process.execPath,
  [toolPath, '--repo', explicitRepoPath, '--json'],
  {
    encoding: 'utf8',
    env: {
      ...process.env,
      PAIROFCLEATS_TESTING: '1',
      PAIROFCLEATS_CACHE_ROOT: cacheRoot
    }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);

assert.equal(payload.repoId, getRepoId(explicitRepoPath), 'repoId should derive from explicit --repo path');
assert.equal(
  toRealPathSync(payload.indexRoot),
  toRealPathSync(buildRoot),
  'index stats should use explicit --repo cache/index roots'
);

console.log('index stats explicit repo path test passed');
