#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyBuildPragmas, restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = resolveTestCachePath(root, 'sqlite-wal-size-limit');
const dbPath = path.join(tempRoot, 'wal.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const db = new Database(dbPath);
const state = applyBuildPragmas(db, { inputBytes: 2 * 1024 * 1024 * 1024, stats: {} });
const journalLimit = Number(state.applied.journal_size_limit || 0);
const walCheckpoint = Number(state.applied.wal_autocheckpoint || 0);
const lockingMode = state.applied.locking_mode;

assert.ok(journalLimit > 0, 'expected journal_size_limit to be applied');
assert.ok(walCheckpoint > 0, 'expected wal_autocheckpoint to be applied');
assert.ok(lockingMode === 'EXCLUSIVE' || lockingMode === 'exclusive', 'expected locking_mode to be EXCLUSIVE');

restoreBuildPragmas(db, state);
db.close();

console.log('sqlite wal size limit test passed');
