#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, getRepoCacheRoot, loadUserConfig, resolveIndexRoot } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'sample');
const tempRoot = path.join(root, '.testCache', 'sqlite-index-state-fail');
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
const chunkMetaColumnar = path.join(codeDir, 'chunk_meta.columnar.json');
const chunkMetaBinaryMeta = path.join(codeDir, 'chunk_meta.binary-columnar.meta.json');
const chunkMetaBinaryData = path.join(codeDir, 'chunk_meta.binary-columnar.bin');
const chunkMetaBinaryOffsets = path.join(codeDir, 'chunk_meta.binary-columnar.offsets.bin');
const chunkMetaBinaryLengths = path.join(codeDir, 'chunk_meta.binary-columnar.lengths.varint');
const chunkMetaColdJsonl = path.join(codeDir, 'chunk_meta_cold.jsonl');
const chunkMetaColdMeta = path.join(codeDir, 'chunk_meta_cold.meta.json');
const chunkMetaColdParts = path.join(codeDir, 'chunk_meta_cold.parts');
await fsPromises.rm(chunkMetaJson, { force: true });
await fsPromises.rm(chunkMetaJsonl, { force: true });
await fsPromises.rm(chunkMetaMeta, { force: true });
await fsPromises.rm(chunkMetaParts, { recursive: true, force: true });
await fsPromises.rm(chunkMetaColumnar, { force: true });
await fsPromises.rm(chunkMetaBinaryMeta, { force: true });
await fsPromises.rm(chunkMetaBinaryData, { force: true });
await fsPromises.rm(chunkMetaBinaryOffsets, { force: true });
await fsPromises.rm(chunkMetaBinaryLengths, { force: true });
await fsPromises.rm(chunkMetaColdJsonl, { force: true });
await fsPromises.rm(chunkMetaColdMeta, { force: true });
await fsPromises.rm(chunkMetaColdParts, { recursive: true, force: true });
const manifestPath = path.join(repoCacheRoot, 'incremental', 'code', 'manifest.json');
await fsPromises.rm(manifestPath, { force: true });

let sqliteFailed = false;
try {
  await runSqliteBuild(repoRoot, { mode: 'code' });
} catch {
  sqliteFailed = true;
}
if (!sqliteFailed) {
  console.error('Expected sqlite build to fail with missing artifacts.');
  process.exit(1);
}

const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
if (!state?.sqlite) {
  console.error('index_state.json missing sqlite section after failure.');
  process.exit(1);
}
if (state.sqlite.status !== 'failed') {
  console.error(`Expected sqlite status=failed, got ${state.sqlite.status}`);
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
await runSqliteBuild(repoRoot, { mode: 'code' });

const refreshedIndexRoot = resolveIndexRoot(repoRoot, userConfig);
const refreshedCodeDir = getIndexDir(repoRoot, 'code', userConfig, { indexRoot: refreshedIndexRoot });
const refreshedStatePath = path.join(refreshedCodeDir, 'index_state.json');
const stateAfter = JSON.parse(fs.readFileSync(refreshedStatePath, 'utf8'));
if (stateAfter.sqlite?.status !== 'ready') {
  console.error(`Expected sqlite status=ready after success, got ${stateAfter.sqlite?.status}`);
  process.exit(1);
}

console.log('sqlite index state fail-closed test passed');

