#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { open } from 'lmdb';
import { replaceLmdbEntries } from '../../../src/storage/lmdb/replace.js';

const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-lmdb-replace-'));
const db = open({ path: root, encoding: 'binary' });
try {
  db.putSync('old', Buffer.from('committed authority'));
  for (const failure of ['after-clear', 'during-put']) {
    let encoded = 0;
    assert.throws(() => replaceLmdbEntries(db, [['new-a', 'a'], ['new-b', 'b']], value => {
      if (++encoded === (failure === 'after-clear' ? 1 : 2)) throw new Error(failure);
      return Buffer.from(value);
    }), new RegExp(failure));
    assert.equal(db.get('old').toString(), 'committed authority');
    assert.equal(db.get('new-a'), undefined);
  }
  replaceLmdbEntries(db, [['new', 'complete']], value => Buffer.from(value));
  assert.equal(db.get('old'), undefined);
  assert.equal(db.get('new').toString(), 'complete');
} finally { await db.close(); await fs.rm(root, { recursive: true, force: true }); }
console.log('LMDB clear and replacement puts roll back together');
