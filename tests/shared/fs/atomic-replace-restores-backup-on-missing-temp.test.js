#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceFile } from '../../../src/shared/json-stream.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'atomic-replace-restore-backup');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const finalPath = path.join(outDir, 'target.json');
const tempPath = path.join(outDir, 'target.tmp');
const bakPath = `${finalPath}.bak`;

await fsPromises.writeFile(finalPath, 'before', 'utf8');
await fsPromises.writeFile(tempPath, 'after', 'utf8');

const originalRename = fsPromises.rename;
fsPromises.rename = async (from, to) => {
  if (from === finalPath && to === bakPath) {
    return originalRename(from, to);
  }
  if (from === tempPath && to === finalPath) {
    const err = new Error('ENOENT');
    err.code = 'ENOENT';
    throw err;
  }
  return originalRename(from, to);
};

let failed = null;
try {
  await replaceFile(tempPath, finalPath);
} catch (err) {
  failed = err;
} finally {
  fsPromises.rename = originalRename;
}

assert.ok(failed, 'expected replaceFile to fail when temp cannot be promoted');
assert.ok(fs.existsSync(finalPath), 'expected original file to be restored from backup');
assert.ok(!fs.existsSync(bakPath), 'expected backup to be consumed during restore');
assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before');
assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');

console.log('atomic replace restores backup on missing temp test passed');
