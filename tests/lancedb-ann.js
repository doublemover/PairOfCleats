#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { tryImport } from '../src/shared/optional-deps.js';
import { getIndexDir, loadUserConfig } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'lancedb-ann');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

const lanceAvailable = (await tryImport('@lancedb/lancedb')).ok;
if (!lanceAvailable) {
  console.warn('lancedb missing; skipping lancedb-ann test.');
  process.exit(0);
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

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, {
    cwd: repoRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot], 'build index');

const userConfig = loadUserConfig(repoRoot);
const codeDir = getIndexDir(repoRoot, 'code', userConfig);
const proseDir = getIndexDir(repoRoot, 'prose', userConfig);
const codeDb = path.join(codeDir, 'dense_vectors.lancedb');
const proseDb = path.join(proseDir, 'dense_vectors.lancedb');
const codeMeta = path.join(codeDir, 'dense_vectors.lancedb.meta.json');
const proseMeta = path.join(proseDir, 'dense_vectors.lancedb.meta.json');

if (!fs.existsSync(codeDb) || !fs.existsSync(codeMeta)) {
  console.error('LanceDB index missing for code mode.');
  process.exit(1);
}
if (!fs.existsSync(proseDb) || !fs.existsSync(proseMeta)) {
  console.error('LanceDB index missing for prose mode.');
  process.exit(1);
}

const searchResult = spawnSync(
  process.execPath,
  [path.join(root, 'search.js'), 'index', '--backend', 'memory', '--json', '--ann', '--repo', repoRoot],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (searchResult.status !== 0) {
  console.error('search.js failed for LanceDB ANN test.');
  if (searchResult.stderr) console.error(searchResult.stderr.trim());
  process.exit(searchResult.status ?? 1);
}

const payload = JSON.parse(searchResult.stdout || '{}');
const stats = payload.stats || {};
if (stats.annBackend !== 'lancedb') {
  console.error(`Expected annBackend=lancedb, got ${stats.annBackend}`);
  process.exit(1);
}
if (!stats.annLance?.available?.code || !stats.annLance?.available?.prose) {
  console.error('Expected LanceDB availability for code and prose.');
  process.exit(1);
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('LanceDB ANN test passed');

