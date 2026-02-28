#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';
import { replaceDir } from '../../../src/shared/json-stream/atomic.js';

import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const outDir = resolveTestCachePath(root, 'json-stream-atomic-dir-replace-fallback-rollback');
await fsPromises.rm(outDir, { recursive: true, force: true });
await fsPromises.mkdir(outDir, { recursive: true });

const createDirWithFile = async (dirPath, relPath, content) => {
  await fsPromises.mkdir(path.dirname(path.join(dirPath, relPath)), { recursive: true });
  await fsPromises.writeFile(path.join(dirPath, relPath), content, 'utf8');
};

// Case 1: fallback copy failure must not delete the original final directory.
{
  const finalPath = path.join(outDir, 'case1-final');
  const tempPath = path.join(outDir, 'case1-temp');
  await createDirWithFile(finalPath, 'keep.txt', 'old-value');
  await createDirWithFile(tempPath, 'keep.txt', 'new-value');

  const originalRename = fsPromises.rename;
  const originalCp = fsPromises.cp;
  fsPromises.rename = async (from, to) => {
    if (from === tempPath && to === finalPath) {
      const err = new Error('cross-device rename blocked');
      err.code = 'EXDEV';
      throw err;
    }
    return originalRename(from, to);
  };
  fsPromises.cp = async (from, to, options) => {
    if (from === tempPath) {
      const err = new Error('staged copy failed');
      err.code = 'EIO';
      throw err;
    }
    return originalCp(from, to, options);
  };

  let failure = null;
  try {
    await replaceDir(tempPath, finalPath, { keepBackup: false });
  } catch (err) {
    failure = err;
  } finally {
    fsPromises.rename = originalRename;
    fsPromises.cp = originalCp;
  }

  assert.ok(failure, 'expected replaceDir to fail when fallback copy fails');
  assert.equal(failure?.code, 'EXDEV', 'expected original rename failure to surface');
  assert.equal(
    await fsPromises.readFile(path.join(finalPath, 'keep.txt'), 'utf8'),
    'old-value',
    'expected final directory to remain unchanged when fallback fails'
  );
  assert.equal(fs.existsSync(tempPath), true, 'expected temp directory to remain for retry/diagnostics');
  assert.equal(fs.existsSync(`${finalPath}.bak`), false, 'expected transient backup to be restored and cleared');
}

// Case 2: pre-existing stale backup must not overwrite a healthy final directory.
{
  const finalPath = path.join(outDir, 'case2-final');
  const tempPath = path.join(outDir, 'case2-temp');
  const bakPath = `${finalPath}.bak`;
  await createDirWithFile(finalPath, 'keep.txt', 'current-final');
  await createDirWithFile(tempPath, 'keep.txt', 'next-final');
  await createDirWithFile(bakPath, 'keep.txt', 'stale-backup');

  const originalRename = fsPromises.rename;
  fsPromises.rename = async (from, to) => {
    if (from === tempPath && to === finalPath) {
      const err = new Error('non-retryable rename failure');
      err.code = 'EINVAL';
      throw err;
    }
    return originalRename(from, to);
  };

  let failure = null;
  try {
    await replaceDir(tempPath, finalPath, { keepBackup: false });
  } catch (err) {
    failure = err;
  } finally {
    fsPromises.rename = originalRename;
  }

  assert.ok(failure, 'expected replaceDir to fail on non-retryable rename error');
  assert.equal(failure?.code, 'EINVAL', 'expected non-retryable error to surface');
  assert.equal(
    await fsPromises.readFile(path.join(finalPath, 'keep.txt'), 'utf8'),
    'current-final',
    'expected stale backup to not overwrite a healthy final directory'
  );
  assert.equal(
    await fsPromises.readFile(path.join(bakPath, 'keep.txt'), 'utf8'),
    'stale-backup',
    'expected stale backup to remain untouched'
  );
}

console.log('atomic dir replace fallback rollback test passed');
