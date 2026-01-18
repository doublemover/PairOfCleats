#!/usr/bin/env node
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { loadUserConfig } from '../tools/dict-utils.js';
import { updateSqliteDense } from '../tools/build-embeddings/sqlite-dense.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch {
  console.log('vector extension missing test skipped: better-sqlite3 not available');
  process.exit(0);
}

const root = process.cwd();
const tempRoot = path.join(root, 'tests', '.cache', 'vector-extension-missing');
const repoRoot = path.join(tempRoot, 'repo');
await fsPromises.rm(tempRoot, { recursive: true, force: true });
await fsPromises.mkdir(repoRoot, { recursive: true });

const missingPath = path.join(repoRoot, 'missing-extension.so');
const configPath = path.join(repoRoot, '.pairofcleats.json');
await fsPromises.writeFile(
  configPath,
  JSON.stringify({
    sqlite: {
      vectorExtension: {
        enabled: true,
        path: missingPath
      }
    }
  }, null, 2)
);

const userConfig = loadUserConfig(repoRoot);
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
