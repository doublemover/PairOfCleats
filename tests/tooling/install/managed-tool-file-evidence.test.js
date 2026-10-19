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
const originalLstat = fsSync.lstatSync;
const originalFstat = fsSync.fstatSync;
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
  // Actual Windows writes can preserve size, mtime and ctime. Model that clock
  // collision deterministically on every platform without altering file bytes.
  const sameClock = stat => stat.dev === before.dev && stat.ino === before.ino
    ? new Proxy(stat, { get(target, key, receiver) {
      return key === 'ctimeNs' ? before.ctimeNs : Reflect.get(target, key, receiver);
    } }) : stat;
  fsSync.lstatSync = (...args) => sameClock(originalLstat(...args));
  fsSync.fstatSync = (...args) => sameClock(originalFstat(...args));
  await fs.writeFile(file, 'BBBB');
  await fs.utimes(file, 1700000000, 1700000000);
  const after = fsSync.lstatSync(file, { bigint: true });
  assert.equal(after.size, before.size);
  assert.equal(after.mtimeNs, before.mtimeNs);
  assert.equal(after.ctimeNs, before.ctimeNs, 'the metadata clock collision is exercised');
  assert.equal(hashManagedToolFile(file), createHash('sha256').update('BBBB').digest('hex'));
  assert.ok(reads > firstReads, 'same-size and identical-timestamp changes rehash current bytes');
  assert.equal(readManagedToolText(file, 4), 'BBBB');
  assert.equal(readManagedToolText(file, 3), null);
  assert.equal(readManagedToolText(file, Infinity), null);
  assert.throws(() => hashManagedToolFile(file, Infinity), /byte limit/);
  for (let i = 0; i < 20; i += 1) {
    const candidate = path.join(root, `${i}.txt`);
    await fs.writeFile(candidate, `inert ${i}`);
    assert.equal(hashManagedToolFile(candidate), createHash('sha256').update(`inert ${i}`).digest('hex'));
  }
  assert.equal(hashManagedToolFile(file), createHash('sha256').update('BBBB').digest('hex'), 'multiple files preserve exact byte evidence');
} finally {
  fsSync.readSync = originalRead;
  fsSync.lstatSync = originalLstat;
  fsSync.fstatSync = originalFstat;
  await fs.rm(root, { recursive: true, force: true });
}
console.log('Managed file evidence rehashes same-size and identical-timestamp changes; text and file-size bounds stay explicit.');
