#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import { applyBuildPragmas, restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

import {
  loadSqlitePragmaDatabase,
  openPragmaTestDatabase,
  readPragmaValue
} from './helpers/pragmas-fixture.js';

const Database = await loadSqlitePragmaDatabase();
const { db, dbPath } = await openPragmaTestDatabase({
  label: 'sqlite-build-pragmas-restore',
  name: 'restore.db',
  Database
});
const readPragma = (name) => readPragmaValue(db, name);

db.pragma('cache_size = -1234');
db.pragma('mmap_size = 0');
db.pragma('journal_size_limit = 0');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('synchronous = NORMAL');
db.pragma('temp_store = DEFAULT');
try { db.pragma('locking_mode = NORMAL'); } catch {}

const before = {
  cache_size: readPragma('cache_size'),
  mmap_size: readPragma('mmap_size'),
  journal_size_limit: readPragma('journal_size_limit'),
  wal_autocheckpoint: readPragma('wal_autocheckpoint'),
  synchronous: readPragma('synchronous'),
  temp_store: readPragma('temp_store'),
  locking_mode: readPragma('locking_mode')
};

const state = applyBuildPragmas(db, { inputBytes: 512 * 1024 * 1024, stats: {} });
restoreBuildPragmas(db, state);

const after = {
  cache_size: readPragma('cache_size'),
  mmap_size: readPragma('mmap_size'),
  journal_size_limit: readPragma('journal_size_limit'),
  wal_autocheckpoint: readPragma('wal_autocheckpoint'),
  synchronous: readPragma('synchronous'),
  temp_store: readPragma('temp_store'),
  locking_mode: readPragma('locking_mode')
};

db.close();

for (const key of Object.keys(before)) {
  if (before[key] === null || before[key] === undefined) continue;
  assert.equal(after[key], before[key], `expected pragma ${key} to be restored`);
}

if (!fsSync.existsSync(dbPath)) {
  console.error('Expected sqlite DB to be created.');
  process.exit(1);
}

console.log('sqlite build pragmas restore test passed');
