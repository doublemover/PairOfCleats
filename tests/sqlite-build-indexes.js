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
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({
    indexing: {
      treeSitter: { enabled: false },
      artifacts: {
        chunkMetaFormat: 'jsonl',
        chunkMetaShardSize: 1,
        tokenPostingsFormat: 'sharded',
        tokenPostingsShardSize: 1
      }
    }
  }, null, 2)
);

const env = {
  ...process.env,
  PAIROFCLEATS_CACHE_ROOT: cacheRoot,
  PAIROFCLEATS_EMBEDDINGS: 'stub'
};

const runNode = (label, args) => {
  const result = spawnSync(process.execPath, args, { cwd: repoRoot, env, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Failed: ${label}`);
    process.exit(result.status ?? 1);
  }
};

runNode('build_index', [path.join(root, 'build_index.js'), '--stub-embeddings', '--repo', repoRoot]);
runNode('build_index_stage4', [path.join(root, 'build_index.js'), '--stub-embeddings', '--stage', 'stage4', '--repo', repoRoot]);

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = loadUserConfig(repoRoot);
const indexDir = getIndexDir(repoRoot, 'code', userConfig);
const chunkMetaPartsDir = path.join(indexDir, 'chunk_meta.parts');
const tokenPostingsShardsDir = path.join(indexDir, 'token_postings.shards');
if (!fs.existsSync(chunkMetaPartsDir)) {
  console.error(`Expected chunk_meta.parts to exist at ${chunkMetaPartsDir}`);
  process.exit(1);
}
if (!fs.existsSync(tokenPostingsShardsDir)) {
  console.error(`Expected token_postings.shards to exist at ${tokenPostingsShardsDir}`);
  process.exit(1);
}
const chunkMetaJson = path.join(indexDir, 'chunk_meta.json');
if (fs.existsSync(chunkMetaJson)) {
  console.error(`Expected chunk_meta.json to be absent at ${chunkMetaJson}`);
  process.exit(1);
}
const sqlitePaths = resolveSqlitePaths(repoRoot, {});
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
db.close();

console.log('sqlite build indexes test passed');
