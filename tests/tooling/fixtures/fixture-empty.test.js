#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'empty');
const buildIndexPath = path.join(root, 'build_index.js');

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Missing empty fixture at ${fixtureRoot}`);
  process.exit(1);
}

const cacheRoot = path.join(root, '.testCache', 'fixture-empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;

function run(args, label) {
  const result = spawnSync(process.execPath, args, {
    cwd: fixtureRoot,
    env,
    stdio: 'inherit'
  });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
}

run([buildIndexPath, '--stub-embeddings', '--repo', fixtureRoot], 'build index (empty)');
await runSqliteBuild(fixtureRoot);

const userConfig = loadUserConfig(fixtureRoot);
const codeDir = getIndexDir(fixtureRoot, 'code', userConfig);
const proseDir = getIndexDir(fixtureRoot, 'prose', userConfig);
const sqlitePaths = resolveSqlitePaths(fixtureRoot, userConfig);

function assertEmptyChunkMeta(label, dir) {
  const metaPath = path.join(dir, 'chunk_meta.json');
  if (!fs.existsSync(metaPath)) {
    console.error(`Missing ${label} chunk meta at ${metaPath}`);
    process.exit(1);
  }
  const raw = fs.readFileSync(metaPath, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data) || data.length !== 0) {
    console.error(`Expected empty ${label} chunk meta but found ${data.length}`);
    process.exit(1);
  }
}

assertEmptyChunkMeta('code', codeDir);
assertEmptyChunkMeta('prose', proseDir);

if (!fs.existsSync(sqlitePaths.codePath)) {
  console.error(`Missing sqlite code db at ${sqlitePaths.codePath}`);
  process.exit(1);
}
if (!fs.existsSync(sqlitePaths.prosePath)) {
  console.error(`Missing sqlite prose db at ${sqlitePaths.prosePath}`);
  process.exit(1);
}

console.log('Empty fixture indexing test passed');

