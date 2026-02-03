#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import fsSync from 'node:fs';
import { applyBuildPragmas, restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-pragmas-restore');
const dbPath = path.join(tempRoot, 'restore.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const db = new Database(dbPath);
const readPragma = (name) => {
  try {
    return db.pragma(name, { simple: true });
  } catch {
    return null;
  }
};

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
