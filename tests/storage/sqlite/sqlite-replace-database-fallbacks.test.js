#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceSqliteDatabase } from '../../../src/storage/sqlite/utils.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'sqlite-replace-database-fallbacks');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const runCrossDeviceFallbackCase = async () => {
  const finalPath = path.join(outDir, 'cross-device.sqlite');
  const tempPath = path.join(outDir, 'cross-device.sqlite.tmp');

  await fsPromises.writeFile(finalPath, 'before', 'utf8');
  await fsPromises.writeFile(tempPath, 'after', 'utf8');

  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
    if (from === tempPath && to === finalPath) {
      const err = new Error('EXDEV');
      err.code = 'EXDEV';
      throw err;
    }
    return originalRename(from, to);
  };

  try {
    await replaceSqliteDatabase(tempPath, finalPath);
  } finally {
    fsPromises.rename = originalRename;
  }

  const contents = await fsPromises.readFile(finalPath, 'utf8');
  assert.equal(contents, 'after');
  assert.ok(!fs.existsSync(tempPath), 'expected temp sqlite db removed after EXDEV fallback');
};

const runRestoreBackupCase = async () => {
  const finalPath = path.join(outDir, 'restore.sqlite');
  const tempPath = path.join(outDir, 'restore.sqlite.tmp');
  const backupPath = `${finalPath}.bak`;

  await fsPromises.writeFile(finalPath, 'before', 'utf8');
  await fsPromises.writeFile(tempPath, 'after', 'utf8');

  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
    if (from === finalPath && to === backupPath) {
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
    await replaceSqliteDatabase(tempPath, finalPath);
  } catch (err) {
    failed = err;
  } finally {
    fsPromises.rename = originalRename;
  }

  assert.ok(failed, 'expected sqlite replace to fail when temp promote cannot complete');
  assert.ok(fs.existsSync(finalPath), 'expected original sqlite db restored from backup');
  assert.ok(!fs.existsSync(backupPath), 'expected restore to consume backup when keepBackup=false');
  assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before');
  assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');
};

await runCrossDeviceFallbackCase();
await runRestoreBackupCase();

console.log('sqlite replace database fallback tests passed');
