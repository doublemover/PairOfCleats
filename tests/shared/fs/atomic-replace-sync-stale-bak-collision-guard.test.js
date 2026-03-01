#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFileSync } from '../../../src/shared/io/atomic-persistence.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'atomic-replace-sync-stale-bak-collision-guard');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'target.json');
const staleBakPath = `${finalPath}.bak`;
const tempPath = path.join(outDir, 'target.tmp');

await fsPromises.writeFile(finalPath, 'before', 'utf8');
await fsPromises.writeFile(staleBakPath, 'stale-backup', 'utf8');
await fsPromises.writeFile(tempPath, 'after', 'utf8');

const originalRenameSync = fs.renameSync;
const originalCopyFileSync = fs.copyFileSync;
fs.renameSync = (from, to) => {
  if (from === tempPath && to === finalPath) {
    const err = new Error('EPERM');
    err.code = 'EPERM';
    throw err;
  }
  return originalRenameSync(from, to);
};
fs.copyFileSync = () => {
  const err = new Error('EACCES');
  err.code = 'EACCES';
  throw err;
};

let failed = null;
try {
  replaceFileSync(tempPath, finalPath);
} catch (err) {
  failed = err;
} finally {
  fs.renameSync = originalRenameSync;
  fs.copyFileSync = originalCopyFileSync;
}

assert.ok(failed instanceof Error, 'expected replaceFileSync to fail under forced rename/copy errors');
assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before', 'expected original final file restored');
assert.equal(await fsPromises.readFile(staleBakPath, 'utf8'), 'stale-backup', 'expected stale .bak untouched');
assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after', 'expected temp payload preserved after failure');

console.log('atomic replace sync stale .bak collision guard test passed');
