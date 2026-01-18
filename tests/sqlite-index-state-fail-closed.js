#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getRepoCacheRoot, loadUserConfig, resolveIndexRoot } from '../tools/dict-utils.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-index-state-fail');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(tempRoot, { recursive: true });
await fsPromises.cp(fixtureRoot, repoRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const run = (args, label) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

run([
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'build index');

const userConfig = loadUserConfig(repoRoot);
const indexRoot = resolveIndexRoot(repoRoot, userConfig);
const codeDir = getIndexDir(repoRoot, 'code', userConfig, { indexRoot });
const repoCacheRoot = getRepoCacheRoot(repoRoot, userConfig);
const statePath = path.join(codeDir, 'index_state.json');
if (!fs.existsSync(statePath)) {
  console.error('Expected index_state.json after initial build.');
  process.exit(1);
}

const chunkMetaJson = path.join(codeDir, 'chunk_meta.json');
const chunkMetaJsonl = path.join(codeDir, 'chunk_meta.jsonl');
const chunkMetaMeta = path.join(codeDir, 'chunk_meta.meta.json');
const chunkMetaParts = path.join(codeDir, 'chunk_meta.parts');
await fsPromises.rm(chunkMetaJson, { force: true });
await fsPromises.rm(chunkMetaJsonl, { force: true });
await fsPromises.rm(chunkMetaMeta, { force: true });
await fsPromises.rm(chunkMetaParts, { recursive: true, force: true });
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
await fsPromises.rm(manifestPath, { force: true });

const sqliteBuild = spawnSync(
  process.execPath,
  [
    path.join(root, 'tools', 'build-sqlite-index.js'),
    '--mode',
    'code',
    '--repo',
    repoRoot
  ],
  { cwd: repoRoot, env, encoding: 'utf8' }
);
if (sqliteBuild.status === 0) {
  console.error('Expected build-sqlite-index to fail with missing artifacts.');
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (!state?.sqlite) {
  console.error('index_state.json missing sqlite section after failure.');
  process.exit(1);
}
if (state.sqlite.pending !== true || state.sqlite.ready !== false) {
  console.error(`Expected sqlite pending=true and ready=false, got pending=${state.sqlite.pending} ready=${state.sqlite.ready}`);
  process.exit(1);
}

run([
  path.join(root, 'build_index.js'),
  '--stub-embeddings',
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'rebuild index');
run([
  path.join(root, 'tools', 'build-sqlite-index.js'),
  '--mode',
  'code',
  '--repo',
  repoRoot
], 'rebuild sqlite');

const stateAfter = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (stateAfter.sqlite?.pending !== false || stateAfter.sqlite?.ready !== true) {
  console.error(
    `Expected sqlite pending=false and ready=true after success, got pending=${stateAfter.sqlite?.pending} ready=${stateAfter.sqlite?.ready}`
  );
  process.exit(1);
}

console.log('sqlite index state fail-closed test passed');
