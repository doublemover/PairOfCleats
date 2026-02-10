#!/usr/bin/env node
import assert from 'node:assert/strict';
import { restoreBuildPragmas } from '../../../src/storage/sqlite/build/pragmas.js';

const seen = [];
const db = {
  pragma(statement) {
    seen.push(statement);
    return null;
  }
};

restoreBuildPragmas(db, {
  before: {
    journal_mode: 'DELETE',
    synchronous: 'FULL',
    temp_store: 'FILE',
    cache_size: -4000,
    mmap_size: 0,
    wal_autocheckpoint: 256,
    journal_size_limit: 0,
    page_size: 8192,
    locking_mode: 'NORMAL'
  }
});

assert.ok(seen.includes('journal_mode = DELETE'), 'expected journal_mode to be restored');
assert.ok(seen.includes('page_size = 8192'), 'expected page_size to be restored');
assert.ok(seen.includes('locking_mode = NORMAL'), 'expected locking_mode to be restored');

console.log('sqlite pragmas restore contract test passed');
