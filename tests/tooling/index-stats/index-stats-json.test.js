#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getRepoCacheRoot, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { ARTIFACT_SURFACE_VERSION } from '../../../src/contracts/versioning.js';

process.env.PAIROFCLEATS_TESTING = '1';

const root = process.cwd();
const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-index-stats-json-'));
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
const buildRoot = path.join(repoCacheRoot, 'builds', 'build-1');
const indexDir = path.join(buildRoot, 'index-code');
await fs.mkdir(path.join(indexDir, 'pieces'), { recursive: true });
await fs.writeFile(path.join(indexDir, 'chunk_meta.json'), '[{"id":1},{"id":2}]', 'utf8');
await fs.writeFile(path.join(indexDir, 'token_postings.json'), '{"tokens":["alpha"]}', 'utf8');
await fs.writeFile(path.join(indexDir, 'phrase_ngrams.json'), '{"rows":1}', 'utf8');
await fs.writeFile(path.join(indexDir, 'chargram_postings.json'), '{"rows":1}', 'utf8');
await fs.writeFile(path.join(indexDir, 'file_meta.json'), '[{"path":"a.js"},{"path":"b.js"}]', 'utf8');
await fs.writeFile(path.join(indexDir, 'index_state.json'), JSON.stringify({
  compatibilityKey: 'compat-build-1'
}, null, 2), 'utf8');

const chunkBytes = Buffer.byteLength('[{"id":1},{"id":2}]', 'utf8');
const tokenBytes = Buffer.byteLength('{"tokens":["alpha"]}', 'utf8');
const phraseBytes = Buffer.byteLength('{"rows":1}', 'utf8');
const chargramBytes = Buffer.byteLength('{"rows":1}', 'utf8');
const fileMetaBytes = Buffer.byteLength('[{"path":"a.js"},{"path":"b.js"}]', 'utf8');

await fs.writeFile(path.join(indexDir, 'pieces', 'manifest.json'), JSON.stringify({
  version: 2,
  repoId: 'repo-manifest-id',
  buildId: 'build-1',
  compatibilityKey: 'compat-build-1',
  artifactSurfaceVersion: ARTIFACT_SURFACE_VERSION,
  pieces: [
    { name: 'chunk_meta', path: 'chunk_meta.json', bytes: chunkBytes, count: 2 },
    { name: 'token_postings', path: 'token_postings.json', bytes: tokenBytes, count: 3 },
    { name: 'phrase_ngrams', path: 'phrase_ngrams.json', bytes: phraseBytes, count: 1 },
    { name: 'chargram_postings', path: 'chargram_postings.json', bytes: chargramBytes, count: 1 },
    { name: 'file_meta', path: 'file_meta.json', bytes: fileMetaBytes, count: 2 }
  ]
}, null, 2), 'utf8');

await fs.mkdir(path.join(repoCacheRoot, 'builds'), { recursive: true });
await fs.writeFile(path.join(repoCacheRoot, 'builds', 'current.json'), JSON.stringify({
  buildId: 'build-1',
  buildRoot
}, null, 2), 'utf8');

const run = spawnSync(
  process.execPath,
  [toolPath, '--repo', repoRoot, '--json'],
  {
    encoding: 'utf8',
    env: { ...process.env, PAIROFCLEATS_TESTING: '1' }
  }
);

assert.equal(run.status, 0, run.stderr || run.stdout);
const payload = JSON.parse(run.stdout);
assert.equal(payload.schemaVersion, 1);
assert.equal(payload.buildId, 'build-1');
assert.equal(payload.compatibilityKey, 'compat-build-1');
assert.equal(payload.artifactSurfaceVersion, ARTIFACT_SURFACE_VERSION);
assert.deepEqual(Object.keys(payload.modes), ['code']);
assert.equal(payload.modes.code.chunkMeta.rows, 2);
assert.equal(payload.modes.code.tokenPostings.rows, 3);
assert.equal(payload.modes.code.fileMeta.rows, 2);
assert.equal(payload.totals.chunkCount, 2);
assert.equal(payload.totals.fileCount, 2);
assert.equal(payload.totals.bytesByFamily.chunks, chunkBytes);
assert.equal(payload.totals.bytesByFamily.postings, tokenBytes + phraseBytes + chargramBytes);

console.log('index stats json test passed');
