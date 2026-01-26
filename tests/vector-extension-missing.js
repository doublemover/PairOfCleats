#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { updateSqliteDense } from '../tools/build-embeddings/sqlite-dense.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('vector extension missing test skipped: better-sqlite3 not available');
  process.exit(0);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'vector-extension-missing');
const repoRoot = path.join(tempRoot, 'repo');
const cacheRoot = path.join(tempRoot, 'cache');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });
await fsPromises.mkdir(cacheRoot, { recursive: true });
process.env.PAIROFCLEATS_TESTING = '1';
process.env.PAIROFCLEATS_CACHE_ROOT = cacheRoot;
const userConfig = { cache: { root: cacheRoot } };
const dbPath = path.join(repoRoot, 'index.sqlite');
const db = new Database(dbPath);
db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT)');
db.close();

const result = updateSqliteDense({
  Database,
  root: repoRoot,
  userConfig,
  indexRoot: null,
  mode: 'code',
  vectors: [new Uint8Array([128, 128])],
  dims: 2,
  scale: 2 / 255,
  modelId: 'test',
  dbPath,
  emitOutput: false,
  logger: { log: () => {}, warn: () => {}, error: () => {} }
});

if (result?.skipped) {
  console.error('vector extension missing test failed: updateSqliteDense unexpectedly skipped');
  process.exit(1);
}

const verify = new Database(dbPath);
const count = verify.prepare('SELECT COUNT(*) AS total FROM dense_vectors').get().total;
verify.close();
if (count !== 1) {
  console.error(`vector extension missing test failed: expected 1 vector row, got ${count}`);
  process.exit(1);
}

console.log('vector extension missing test passed');

