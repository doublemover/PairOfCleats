#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'hnsw-ann');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const config = {
  cache: { root: cacheRoot },
  search: { annBackend: 'hnsw' },
  indexing: {
    embeddings: {
      hnsw: {
        enabled: true
      }
    }
  }
};

await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify(config, null, 2) + '\n'
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

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
  [path.join(root, 'search.js'), 'index', '--backend', 'memory', '--json', '--ann', '--repo', repoRoot],
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
