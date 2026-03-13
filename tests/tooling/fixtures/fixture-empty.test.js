#!/usr/bin/env node
import { applyTestEnv } from '../../helpers/test-env.js';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../../../tools/shared/dict-utils.js';
import { runNode } from '../../helpers/run-node.js';
import { runSqliteBuild } from '../../helpers/sqlite-builder.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const fixtureRoot = path.join(root, 'tests', 'fixtures', 'empty');
const buildIndexPath = path.join(root, 'build_index.js');

if (!fs.existsSync(fixtureRoot)) {
  console.error(`Missing empty fixture at ${fixtureRoot}`);
  process.exit(1);
}

const cacheRoot = resolveTestCachePath(root, 'fixture-empty');
await fsPromises.rm(cacheRoot, { recursive: true, force: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

const env = applyTestEnv({
  cacheRoot,
  embeddings: 'stub'
});

runNode([buildIndexPath, '--stub-embeddings', '--repo', fixtureRoot], 'build index (empty)', fixtureRoot, env);
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

function assertZeroStateManifest(label, dir) {
  const zeroStatePath = path.join(dir, 'pieces', 'sqlite-zero-state.json');
  if (!fs.existsSync(zeroStatePath)) {
    console.error(`Missing ${label} zero-state manifest at ${zeroStatePath}`);
    process.exit(1);
  }
}

assertEmptyChunkMeta('code', codeDir);
assertEmptyChunkMeta('prose', proseDir);
assertZeroStateManifest('code', codeDir);
assertZeroStateManifest('prose', proseDir);

if (fs.existsSync(sqlitePaths.codePath)) {
  console.error(`Expected no sqlite code db for zero-state fixture at ${sqlitePaths.codePath}`);
  process.exit(1);
}
if (fs.existsSync(sqlitePaths.prosePath)) {
  console.error(`Expected no sqlite prose db for zero-state fixture at ${sqlitePaths.prosePath}`);
  process.exit(1);
}

console.log('Empty fixture indexing test passed');
