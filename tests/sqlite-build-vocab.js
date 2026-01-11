#!/usr/bin/env node
import assert from 'node:assert/strict';
import { ensureVocabIds } from '../src/storage/sqlite/build/vocab.js';

let Database;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error('better-sqlite3 is required for sqlite build vocab test.');
  process.exit(1);
}

const db = new Database(':memory:');
db.exec('CREATE TABLE token_vocab (mode TEXT, token_id INTEGER, token TEXT, PRIMARY KEY (mode, token_id))');

const insertSeed = db.prepare('INSERT INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)');
insertSeed.run('code', 0, 'alpha');
insertSeed.run('code', 1, 'beta');
insertSeed.run('prose', 0, 'beta');

const insertStmt = db.prepare('INSERT OR REPLACE INTO token_vocab (mode, token_id, token) VALUES (?, ?, ?)');

let result = ensureVocabIds(
  db,
  'code',
  'token_vocab',
  'token_id',
  'token',
  ['beta', 'gamma', 'beta'],
  insertStmt
);
assert.equal(result.inserted, 1, 'expected one new token');
assert.equal(result.map.get('beta'), 1, 'expected existing token id');
assert.equal(result.map.get('gamma'), 2, 'expected new token id');

const rowCount = db.prepare('SELECT COUNT(*) AS total FROM token_vocab WHERE mode = ?').get('code').total;
assert.equal(rowCount, 3, 'expected vocab size to grow by one');

const beforeCount = rowCount;
result = ensureVocabIds(
  db,
  'code',
  'token_vocab',
  'token_id',
  'token',
  ['delta', 'epsilon'],
  insertStmt,
  { limits: { ratio: 0.4, absolute: 1 } }
);
assert.equal(result.skip, true, 'expected vocab growth to be skipped');
const afterCount = db.prepare('SELECT COUNT(*) AS total FROM token_vocab WHERE mode = ?').get('code').total;
assert.equal(afterCount, beforeCount, 'expected vocab size to remain unchanged');

db.close();

console.log('sqlite build vocab test passed');
