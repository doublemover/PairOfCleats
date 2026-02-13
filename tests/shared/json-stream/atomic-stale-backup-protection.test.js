#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { replaceFile } from '../../../src/shared/json-stream.js';

process.env.PAIROFCLEATS_TESTING = '1';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-atomic-stale-backup-'));

const finalPath = path.join(tempRoot, 'target.json');
const backupPath = `${finalPath}.bak`;
const missingTempPath = path.join(tempRoot, 'missing.tmp');

await fsPromises.writeFile(finalPath, 'current-final', 'utf8');
await fsPromises.writeFile(backupPath, 'stale-backup', 'utf8');
const staleAt = new Date(Date.now() - 60_000);
await fsPromises.utimes(finalPath, staleAt, staleAt);

let staleFailure = null;
try {
  await replaceFile(missingTempPath, finalPath, { keepBackup: false });
} catch (error) {
  staleFailure = error;
}
assert.ok(staleFailure, 'missing temp path should fail safely');
assert.equal(staleFailure?.code, 'ERR_TEMP_MISSING');
assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'current-final');
assert.equal(fs.existsSync(backupPath), true, 'stale backup should remain untouched on failure');

const finalPathSecond = path.join(tempRoot, 'target-second.json');
const backupPathSecond = `${finalPathSecond}.bak`;
const tempPath = path.join(tempRoot, 'next.tmp');
await fsPromises.writeFile(finalPathSecond, 'before', 'utf8');
await fsPromises.writeFile(tempPath, 'after', 'utf8');

const originalRename = fsPromises.rename;
fsPromises.rename = async (from, to) => {
  if (from === finalPathSecond && to === backupPathSecond) {
    return originalRename(from, to);
  }
  if (from === tempPath && to === finalPathSecond) {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  }
  return originalRename(from, to);
};

let restoreFailure = null;
try {
  await replaceFile(tempPath, finalPathSecond);
} catch (error) {
  restoreFailure = error;
} finally {
  fsPromises.rename = originalRename;
}

assert.ok(restoreFailure, 'missing temp during promotion should fail');
assert.ok(fs.existsSync(finalPathSecond), 'final file should be restored from backup');
assert.ok(!fs.existsSync(backupPathSecond), 'backup should be consumed during restore');
assert.equal(await fsPromises.readFile(finalPathSecond, 'utf8'), 'before');
assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');

console.log('atomic stale backup protection test passed');
