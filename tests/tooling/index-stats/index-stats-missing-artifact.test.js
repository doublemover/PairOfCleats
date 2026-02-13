#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-missing-'));
const cacheRoot = path.join(tempRoot, 'cache');
const repoRoot = path.join(tempRoot, 'repo');
const toolPath = path.join(root, 'tools', 'index', 'stats.js');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(repoRoot, { recursive: true });
await fs.writeFile(path.join(repoRoot, '.pairofcleats.json'), JSON.stringify({
  cache: { root: cacheRoot }
}, null, 2), 'utf8');

const userConfig = loadUserConfig(repoRoot);
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-verify');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1}]', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-verify'
}, null, 2), 'utf8');

await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  buildId: 'build-verify',
  compatibilityKey: 'compat-verify',
  pieces: [
    {
      name: 'chunk_meta',
      path: 'chunk_meta.json',
      bytes: 10,
      count: 1,
      checksum: 'xxh64:deadbeef'
    },
    {
      name: 'token_postings',
      path: 'token_postings.json',
      bytes: 24,
      count: 2
    }
  ]
}, null, 2), 'utf8');

await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-verify',
  buildRoot
}, null, 2), 'utf8');

const run = spawnSync(
  process.execPath,
  [toolPath, '--repo', repoRoot, '--verify', '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
  }
);

assert.equal(run.status, 1, 'verify should fail when required artifacts are missing/mismatched');
const payload = JSON.parse(run.stdout);
assert.equal(payload.verify?.ok, false);
assert.ok(
  payload.verify.errors.some((entry) => entry.includes('missing artifact token_postings.json')),
  `expected missing token_postings artifact error, got: ${payload.verify.errors.join('; ')}`
);
assert.ok(
  payload.verify.warnings.some((entry) => entry.includes('checksum mismatch')),
  `expected checksum mismatch warning, got: ${payload.verify.warnings.join('; ')}`
);

console.log('index stats missing artifact test passed');
