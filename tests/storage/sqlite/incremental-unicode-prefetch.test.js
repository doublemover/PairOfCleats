#!/usr/bin/env node
import assert from 'node:assert/strict';
import Database from 'better-sqlite3';
import { createIncrementalDocIdResolver } from '../../../src/storage/sqlite/build/incremental-update/doc-id-resolver.js';
const db = new Database(':memory:');
try {
  db.exec('CREATE TABLE chunks(id INTEGER PRIMARY KEY,mode TEXT,file TEXT)');
  const insert = db.prepare('INSERT INTO chunks VALUES(?,?,?)');
  insert.run(7, 'code', 'Éclair.js'); insert.run(8, 'prose', 'Éclair.js'); insert.run(9, 'code', 'Folder\\Eclair.js');
  for (const platform of ['win32', 'linux']) {
    const resolver = createIncrementalDocIdResolver({ db, mode: 'code', changed: [], deleted: ['Éclair.js'], batchSize: 256, platform });
    assert.deepEqual(resolver.resolveExistingDocIds('Éclair.js'), [7]);
  }
  const windows = createIncrementalDocIdResolver({ db, mode: 'code', changed: [], deleted: ['folder/eclair.js'], batchSize: 256, platform: 'win32' });
  assert.deepEqual(windows.resolveExistingDocIds('folder/eclair.js'), [9]);
  assert.deepEqual(windows.resolveExistingDocIds('missing.js'), []);
} finally { db.close(); }
