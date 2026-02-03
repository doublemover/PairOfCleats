#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../../../tools/shared/dict-utils.js';
import { normalizeHnswConfig, rankHnswIndex } from '../../../src/shared/hnsw.js';
import { requireHnswLib } from '../../helpers/optional-deps.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'hnsw-ann');
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

requireHnswLib({ reason: 'hnswlib-node not available; skipping hnsw-ann test.' });

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

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--scm-provider', 'none', '--repo', repoRoot], 'build index');
run([path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'code', '--repo', repoRoot], 'build embeddings (code)');
run([path.join(root, 'tools', 'build/embeddings.js'), '--stub-embeddings', '--mode', 'prose', '--repo', repoRoot], 'build embeddings (prose)');

const userConfig = loadUserConfig(repoRoot);
const hnswConfig = normalizeHnswConfig(userConfig.indexing?.embeddings?.hnsw || {});
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const codeIndex = path.join(codeDir, 'dense_vectors_hnsw.bin');
const codeMeta = path.join(codeDir, 'dense_vectors_hnsw.meta.json');
const codeDocIndex = path.join(codeDir, 'dense_vectors_doc_hnsw.bin');
const codeDocMeta = path.join(codeDir, 'dense_vectors_doc_hnsw.meta.json');
const codeCodeIndex = path.join(codeDir, 'dense_vectors_code_hnsw.bin');
const codeCodeMeta = path.join(codeDir, 'dense_vectors_code_hnsw.meta.json');
const proseIndex = path.join(proseDir, 'dense_vectors_hnsw.bin');
const proseMeta = path.join(proseDir, 'dense_vectors_hnsw.meta.json');
const proseDocIndex = path.join(proseDir, 'dense_vectors_doc_hnsw.bin');
const proseDocMeta = path.join(proseDir, 'dense_vectors_doc_hnsw.meta.json');
const proseCodeIndex = path.join(proseDir, 'dense_vectors_code_hnsw.bin');
const proseCodeMeta = path.join(proseDir, 'dense_vectors_code_hnsw.meta.json');

if (!fs.existsSync(codeIndex) || !fs.existsSync(codeMeta)) {
  console.error('HNSW index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeDocIndex) || !fs.existsSync(codeDocMeta)) {
  console.error('HNSW doc index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(codeCodeIndex) || !fs.existsSync(codeCodeMeta)) {
  console.error('HNSW code index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(proseIndex) || !fs.existsSync(proseMeta)) {
  console.error('HNSW index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDocIndex) || !fs.existsSync(proseDocMeta)) {
  console.error('HNSW doc index missing for prose mode.');
  process.exit(1);
}
if (!fs.existsSync(proseCodeIndex) || !fs.existsSync(proseCodeMeta)) {
  console.error('HNSW code index missing for prose mode.');
  process.exit(1);
}

const codeState = JSON.parse(fs.readFileSync(path.join(codeDir, 'index_state.json'), 'utf8'));
const proseState = JSON.parse(fs.readFileSync(path.join(proseDir, 'index_state.json'), 'utf8'));
if (codeState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected code embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}
if (proseState?.embeddings?.embeddingIdentity?.normalize !== true) {
  console.error('Expected prose embeddingIdentity.normalize=true in index_state.json.');
  process.exit(1);
}

const codeMetaPayload = JSON.parse(fs.readFileSync(codeMeta, 'utf8'));
const proseMetaPayload = JSON.parse(fs.readFileSync(proseMeta, 'utf8'));
if (codeMetaPayload.space !== hnswConfig.space) {
  console.error(`Expected HNSW code space=${hnswConfig.space}, got ${codeMetaPayload.space}`);
  process.exit(1);
}
if (proseMetaPayload.space !== hnswConfig.space) {
  console.error(`Expected HNSW prose space=${hnswConfig.space}, got ${proseMetaPayload.space}`);
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

