#!/usr/bin/env node
import assert from 'node:assert/strict';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { hashManagedToolFile, readManagedToolText } from '../../../src/shared/managed-tool-file.js';

process.env.PAIROFCLEATS_TESTING = '1';
const root = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-managed-file-evidence-'));
const file = path.join(root, 'inert.txt');
const originalRead = fsSync.readSync;
let reads = 0;
try {
  await fs.writeFile(file, 'AAAA');
  await fs.utimes(file, 1700000000, 1700000000);
  const before = await fs.stat(file, { bigint: true });
  fsSync.readSync = (...args) => { reads += 1; return originalRead(...args); };
  const first = hashManagedToolFile(file);
  assert.equal(first, createHash('sha256').update('AAAA').digest('hex'));
  const firstReads = reads;
  assert.ok(firstReads > 0);
  assert.equal(hashManagedToolFile(file), first);
  assert.equal(reads, firstReads, 'unchanged identity reuses already-verified evidence without content reads');
  await fs.writeFile(file, 'BBBB');
  await fs.utimes(file, 1700000000, 1700000000);
  const after = await fs.stat(file, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.notEqual(after.ctimeNs, before.ctimeNs, 'fixture preserves mtime but changes filesystem change-time');
  assert.equal(hashManagedToolFile(file), createHash('sha256').update('BBBB').digest('hex'));
  assert.ok(reads > firstReads, 'same-size/restored-mtime changes do not reuse a stale verified hash');
  assert.equal(readManagedToolText(file, 4), 'BBBB');
  assert.equal(readManagedToolText(file, 3), null);
  assert.equal(readManagedToolText(file, Infinity), null);
  assert.throws(() => hashManagedToolFile(file, Infinity), /byte limit/);
  for (let i = 0; i < 20; i += 1) {
    const candidate = path.join(root, `${i}.txt`);
    await fs.writeFile(candidate, `inert ${i}`);
    assert.equal(hashManagedToolFile(candidate), createHash('sha256').update(`inert ${i}`).digest('hex'));
  }
  assert.equal(hashManagedToolFile(file), createHash('sha256').update('BBBB').digest('hex'), 'eviction preserves exact rehash fallback');
} finally {
  fsSync.readSync = originalRead;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Managed file evidence reuses stable identities and rehashes same-size/restored-mtime changes; text/retention bounds stay explicit.');
