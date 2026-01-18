#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';
import { rankHnswIndex } from '../src/shared/hnsw.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'hnsw-ann');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const fakeIndex = {
  searchKnn: (_vec, _limit, filter) => {
    const neighbors = [3, 1, 2];
    const distances = [0.2, 0.1, 0.1];
    if (!filter) return { neighbors, distances };
    const filtered = [];
    const filteredDistances = [];
    for (let i = 0; i < neighbors.length; i += 1) {
      if (filter(neighbors[i])) {
        filtered.push(neighbors[i]);
        filteredDistances.push(distances[i]);
      }
    }
    return { neighbors: filtered, distances: filteredDistances };
  }
};
const fakeHits = rankHnswIndex(
  { index: fakeIndex, space: 'cosine' },
  [0.1, 0.2],
  3,
  new Set([1, 2])
);
if (fakeHits.length !== 2 || fakeHits[0].idx !== 1 || fakeHits[1].idx !== 2) {
  console.error('Expected candidate-set filtering and deterministic tie-breaks in HNSW ranking.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'build embeddings (code)');
run([path.join(root, 'tools', 'build-embeddings.js'), '--stub-embeddings', '--mode', 'prose', '--repo', repoRoot], 'build embeddings (prose)');

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const codeIndex = path.join(codeDir, 'dense_vectors_hnsw.bin');
const codeMeta = path.join(codeDir, 'dense_vectors_hnsw.meta.json');
const proseIndex = path.join(proseDir, 'dense_vectors_hnsw.bin');
const proseMeta = path.join(proseDir, 'dense_vectors_hnsw.meta.json');

if (!fs.existsSync(codeIndex) || !fs.existsSync(codeMeta)) {
  console.error('HNSW index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(proseIndex) || !fs.existsSync(proseMeta)) {
  console.error('HNSW index missing for prose mode.');
  process.exit(1);
}

const searchResult = spawnSync(
  process.execPath,
  [
    path.join(root, 'search.js'),
    'index',
    '--backend',
    'memory',
    '--json',
    '--stats',
    '--ann',
    '--ann-backend',
    'hnsw',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for HNSW ANN test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'hnsw') {
  console.error(`Expected annBackend=hnsw, got ${stats.annBackend}`);
  process.exit(1);
}
if (!stats.annHnsw?.available?.code || !stats.annHnsw?.available?.prose) {
  console.error('Expected HNSW availability for code and prose.');
  process.exit(1);
}

console.log('HNSW ANN test passed');
