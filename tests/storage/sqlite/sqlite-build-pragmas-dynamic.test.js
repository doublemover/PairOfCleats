#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { applyBuildPragmas, restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

let Database = null;
try {
  ({ default: Database } = await import('better-sqlite3'));
} catch (err) {
  console.error(`better-sqlite3 missing: ${err?.message || err}`);
  process.exit(1);
}

const root = process.cwd();
const tempRoot = path.join(root, '.testCache', 'sqlite-build-pragmas-dynamic');
const smallPath = path.join(tempRoot, 'small.db');
const largePath = path.join(tempRoot, 'large.db');

await fs.rm(tempRoot, { recursive: true, force: true });
await fs.mkdir(tempRoot, { recursive: true });

const smallDb = new Database(smallPath);
const smallState = applyBuildPragmas(smallDb, { inputBytes: 10 * 1024 * 1024, stats: {} });
restoreBuildPragmas(smallDb, smallState);
smallDb.close();

const largeDb = new Database(largePath);
const largeState = applyBuildPragmas(largeDb, { inputBytes: 3 * 1024 * 1024 * 1024, stats: {} });
restoreBuildPragmas(largeDb, largeState);
largeDb.close();

const smallCache = Math.abs(Number(smallState.applied.cache_size || 0));
const largeCache = Math.abs(Number(largeState.applied.cache_size || 0));
assert.ok(largeCache >= smallCache, 'expected larger cache_size for large input');

const smallJournal = Number(smallState.applied.journal_size_limit || 0);
const largeJournal = Number(largeState.applied.journal_size_limit || 0);
assert.ok(largeJournal >= smallJournal, 'expected larger journal_size_limit for large input');

console.log('sqlite build pragmas dynamic test passed');
