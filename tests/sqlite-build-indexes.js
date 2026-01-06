#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { resolveSqlitePaths } from '../tools/dict-utils.js';

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
await fsPromises.writeFile(
  path.join(repoRoot, '.pairofcleats.json'),
  JSON.stringify({ indexing: { treeSitter: { enabled: false } } }, null, 2)
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
runNode('build_sqlite_index', [path.join(root, 'tools', 'build-sqlite-index.js'), '--repo', repoRoot]);

const previousCacheRoot = process.env.PAIROFCLEATS_CACHE_ROOT;
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
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
