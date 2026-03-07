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
  const backupPath = `${finalPath}.bak`;

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

  let failed = null;
  try {
    await replaceSqliteDatabase(tempPath, finalPath);
  } catch (err) {
    failed = err;
  } finally {
    fsPromises.rename = originalRename;
  }

  assert.ok(failed, 'expected sqlite replace to fail closed on EXDEV');
  assert.equal(failed?.code, 'ERR_SQLITE_REPLACE_CROSS_DEVICE');
  const contents = await fsPromises.readFile(finalPath, 'utf8');
  assert.equal(contents, 'before', 'expected original sqlite db restored after EXDEV failure');
  assert.ok(fs.existsSync(tempPath), 'expected temp sqlite db preserved after EXDEV failure');
  assert.ok(!fs.existsSync(backupPath), 'expected backup consumed during restore');
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

const runStaleBackupNoRestoreCase = async () => {
  const finalPath = path.join(outDir, 'stale-backup.sqlite');
  const tempPath = path.join(outDir, 'stale-backup.sqlite.tmp');
  const backupPath = `${finalPath}.bak`;

  await fsPromises.writeFile(backupPath, 'stale', 'utf8');
  await fsPromises.writeFile(tempPath, 'after', 'utf8');

  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
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
  assert.ok(!fs.existsSync(finalPath), 'expected stale backup to remain un-restored when final db did not exist');
  assert.ok(fs.existsSync(backupPath), 'expected stale backup to remain untouched on failure');
  assert.equal(await fsPromises.readFile(backupPath, 'utf8'), 'stale');
  assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');
};

const runCrossDeviceBackupMoveCase = async () => {
  const finalPath = path.join(outDir, 'cross-device-backup.sqlite');
  const tempPath = path.join(outDir, 'cross-device-backup.sqlite.tmp');
  const backupPath = `${finalPath}.bak`;

  await fsPromises.writeFile(finalPath, 'before', 'utf8');
  await fsPromises.writeFile(tempPath, 'after', 'utf8');

  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
    if (from === finalPath && to === backupPath) {
      const err = new Error('EXDEV');
      err.code = 'EXDEV';
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

  assert.ok(failed, 'expected sqlite replace to fail when final->backup crosses devices');
  assert.equal(failed?.code, 'ERR_SQLITE_REPLACE_CROSS_DEVICE');
  assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before');
  assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');
  assert.ok(!fs.existsSync(backupPath), 'expected no backup file when backup move never succeeded');
};

await runCrossDeviceFallbackCase();
await runRestoreBackupCase();
await runStaleBackupNoRestoreCase();
await runCrossDeviceBackupMoveCase();

console.log('sqlite replace database fallback tests passed');
