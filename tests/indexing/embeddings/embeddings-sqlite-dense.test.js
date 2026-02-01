#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { updateSqliteDense } from '../../../tools/build-embeddings/sqlite-dense.js';
import { skip } from '../../helpers/skip.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  skip('better-sqlite3 not available; skipping embeddings sqlite dense test.');
}

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-embeddings-sqlite-'));
const dbPath = path.join(tempRoot, 'index-code.db');
const dbMissingPath = path.join(tempRoot, 'index-missing.db');

const vectors = [
  [1, 2, 3],
  [4, 5, 6]
];

const createDbWithTables = (target) => {
  const db = new Database(target);
  db.exec('CREATE TABLE dense_vectors (mode TEXT, doc_id INTEGER, vector BLOB)');
  db.exec('CREATE TABLE dense_meta (mode TEXT, dims INTEGER, scale REAL, model TEXT)');
  db.close();
};

createDbWithTables(dbPath);
new Database(dbMissingPath).close();

const disabledResult = updateSqliteDense({
  Database,
  root: tempRoot,
  userConfig: { sqlite: { use: false } },
  mode: 'code',
  vectors,
  dims: 3,
  scale: 1,
  modelId: 'model-a',
  dbPath,
  emitOutput: false
});
assert.equal(disabledResult.skipped, true, 'expected sqlite update to skip when disabled');

const missingResult = updateSqliteDense({
  Database,
  root: tempRoot,
  userConfig: { sqlite: { use: true } },
  mode: 'code',
  vectors,
  dims: 3,
  scale: 1,
  modelId: 'model-a',
  dbPath: dbMissingPath,
  emitOutput: false
});
assert.equal(missingResult.skipped, true, 'expected sqlite update to skip when tables missing');
assert.equal(missingResult.reason, 'missing dense tables', 'expected missing dense tables reason');

const enabledResult = updateSqliteDense({
  Database,
  root: tempRoot,
  userConfig: { sqlite: { use: true } },
  mode: 'code',
  vectors,
  dims: 3,
  scale: 1,
  modelId: 'model-a',
  dbPath,
  emitOutput: false
});
assert.equal(enabledResult.skipped, false, 'expected sqlite update to run when enabled');

const db = new Database(dbPath, { readonly: true });
const denseCount = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors').get().total;
const metaCount = db.prepare('SELECT COUNT(*) AS total FROM dense_meta').get().total;
const modeCount = db.prepare('SELECT COUNT(*) AS total FROM dense_vectors WHERE mode = ?').get('code').total;
db.close();
assert.equal(denseCount, vectors.length, 'expected dense vectors to be written');
assert.equal(metaCount, 1, 'expected dense metadata to be written');
assert.equal(modeCount, vectors.length, 'expected mode-specific dense vectors');

console.log('embeddings sqlite dense test passed');
