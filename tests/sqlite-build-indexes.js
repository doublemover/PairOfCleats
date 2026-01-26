#!/usr/bin/env node
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { getIndexDir, loadUserConfig, resolveSqlitePaths } from '../tools/dict-utils.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'sqlite-build-indexes');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');

await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });

await fsPromises.writeFile(path.join(repoRoot, 'alpha.js'), 'const alpha = 1;\n');
await fsPromises.writeFile(path.join(repoRoot, 'beta.js'), 'const beta = 2;\n');

const env = {
  ...process.env,
  PAIROFCLEATS_TESTING: '1',
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
process.env.PAIROFCLEATS_EMBEDDINGS = 'stub';

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_sqlite', [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot]);

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
const tokenPostingsShardsDir = path.join(indexDir, 'token_postings.shards');
const chunkMetaJson = path.join(indexDir, 'chunk_meta.json');
const hasChunkMeta = fs.existsSync(chunkMetaJson) || fs.existsSync(chunkMetaPartsDir);
if (!hasChunkMeta) {
  console.error(`Expected chunk metadata in ${chunkMetaJson} or ${chunkMetaPartsDir}`);
  process.exit(1);
}
const hasTokenPostings = fs.existsSync(tokenPostingsShardsDir)
  || fs.existsSync(path.join(indexDir, 'token_postings.json'));
if (!hasTokenPostings) {
  console.error(`Expected token postings artifacts in ${tokenPostingsShardsDir}`);
  process.exit(1);
}
const sqlitePaths = resolveSqlitePaths(repoRoot, userConfig);
if (previousCacheRoot === undefined) {
  delete process.env.PAIROFCLEATS_CACHE_ROOT;
} else {
  process.env.PAIROFCLEATS_CACHE_ROOT = previousCacheRoot;
}
const db = new Database(sqlitePaths.codePath);
const indexList = db.prepare("PRAGMA index_list('token_postings')").all();
const indexNames = new Set(indexList.map((row) => row.name));
if (!indexNames.has('idx_token_postings_token')) {
  console.error('Expected idx_token_postings_token to exist');
  process.exit(1);
}
const chunkIndexList = db.prepare("PRAGMA index_list('chunks')").all();
const chunkIndexNames = new Set(chunkIndexList.map((row) => row.name));
if (!chunkIndexNames.has('idx_chunks_file_id')) {
  console.error('Expected idx_chunks_file_id to exist');
  process.exit(1);
}
db.close();

console.log('sqlite build indexes test passed');
