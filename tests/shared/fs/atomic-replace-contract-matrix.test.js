#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { replaceFile as replaceJsonFile } from '../../../src/shared/json-stream.js';
import { replaceFile as replacePersistentFile, replaceFileSync } from '../../../src/shared/io/atomic-persistence.js';

const cases = [
  {
    name: 'async replace cleans backup after success',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-success-'));
      const finalPath = path.join(outDir, 'target.json');
      const tempPath = path.join(outDir, 'target.tmp');
      try {
        await fsPromises.writeFile(finalPath, 'before', 'utf8');
        await fsPromises.writeFile(tempPath, 'after', 'utf8');
        await replaceJsonFile(tempPath, finalPath);
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'after');
        assert.equal(fs.existsSync(`${finalPath}.bak`), false);
      } finally {
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'async replace restores backup when promoted temp disappears',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-restore-'));
      const finalPath = path.join(outDir, 'target.json');
      const tempPath = path.join(outDir, 'target.tmp');
      const bakPath = `${finalPath}.bak`;
      const originalRename = fsPromises.rename;
      try {
        await fsPromises.writeFile(finalPath, 'before', 'utf8');
        await fsPromises.writeFile(tempPath, 'after', 'utf8');

        fsPromises.rename = async (from, to) => {
          if (from === finalPath && to === bakPath) return originalRename(from, to);
          if (from === tempPath && to === finalPath) {
            const err = new Error('ENOENT');
            err.code = 'ENOENT';
            throw err;
          }
          return originalRename(from, to);
        };

        let failed = null;
        try {
          await replaceJsonFile(tempPath, finalPath);
        } catch (error) {
          failed = error;
        }
        assert.ok(failed);
        assert.equal(fs.existsSync(finalPath), true);
        assert.equal(fs.existsSync(bakPath), false);
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before');
        assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');
      } finally {
        fsPromises.rename = originalRename;
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'stale backup does not mask missing temp path',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-stale-'));
      const finalPath = path.join(outDir, 'target.json');
      const bakPath = `${finalPath}.bak`;
      const missingTempPath = path.join(outDir, 'target.tmp');
      try {
        await fsPromises.writeFile(finalPath, 'current-final', 'utf8');
        await fsPromises.writeFile(bakPath, 'stale-backup', 'utf8');
        const staleAt = new Date(Date.now() - 60_000);
        await fsPromises.utimes(finalPath, staleAt, staleAt);

        let failed = null;
        try {
          await replaceJsonFile(missingTempPath, finalPath, { keepBackup: false });
        } catch (error) {
          failed = error;
        }
        assert.ok(failed);
        assert.equal(failed?.code, 'ERR_TEMP_MISSING');
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'current-final');
        assert.equal(fs.existsSync(bakPath), true);
      } finally {
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'sync stale backup collision guard preserves original files',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-sync-'));
      const finalPath = path.join(outDir, 'target.json');
      const staleBakPath = `${finalPath}.bak`;
      const tempPath = path.join(outDir, 'target.tmp');
      const originalRenameSync = fs.renameSync;
      const originalCopyFileSync = fs.copyFileSync;
      try {
        await fsPromises.writeFile(finalPath, 'before', 'utf8');
        await fsPromises.writeFile(staleBakPath, 'stale-backup', 'utf8');
        await fsPromises.writeFile(tempPath, 'after', 'utf8');

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
        } catch (error) {
          failed = error;
        }
        assert.ok(failed instanceof Error);
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'before');
        assert.equal(await fsPromises.readFile(staleBakPath, 'utf8'), 'stale-backup');
        assert.equal(await fsPromises.readFile(tempPath, 'utf8'), 'after');
      } finally {
        fs.renameSync = originalRenameSync;
        fs.copyFileSync = originalCopyFileSync;
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'committed final survives missing temp for async and sync persistence helpers',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-committed-'));
      const finalPath = path.join(outDir, 'final.txt');
      const backupPath = path.join(outDir, 'final.txt.bak');
      const missingTempPath = path.join(outDir, 'temp.txt');
      try {
        await fsPromises.writeFile(finalPath, 'committed\n', 'utf8');
        await replacePersistentFile(missingTempPath, finalPath, { keepBackup: false });
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'committed\n');

        await fsPromises.writeFile(backupPath, 'stale\n', 'utf8');
        replaceFileSync(missingTempPath, finalPath, { keepBackup: false });
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'committed\n');
      } finally {
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  },
  {
    name: 'cross-device fallback copies temp into final and removes backups',
    async run() {
      const outDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-exdev-'));
      const finalPath = path.join(outDir, 'target.json');
      const tempPath = path.join(outDir, 'target.tmp');
      const originalRename = fsPromises.rename;
      try {
        await fsPromises.writeFile(finalPath, 'before', 'utf8');
        await fsPromises.writeFile(tempPath, 'after', 'utf8');
        fsPromises.rename = async () => {
          const err = new Error('EXDEV');
          err.code = 'EXDEV';
          throw err;
        };

        await replaceJsonFile(tempPath, finalPath);
        assert.equal(await fsPromises.readFile(finalPath, 'utf8'), 'after');
        assert.equal(fs.existsSync(tempPath), false);
        assert.equal(fs.existsSync(`${finalPath}.bak`), false);
      } finally {
        fsPromises.rename = originalRename;
        await fsPromises.rm(outDir, { recursive: true, force: true });
      }
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('atomic replace contract matrix test passed');
