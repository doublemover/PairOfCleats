#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { replaceFile, replaceFileSync } from '../../../src/shared/io/atomic-persistence.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'poc-atomic-replace-committed-'));
const finalPath = path.join(tempRoot, 'final.txt');
const backupPath = path.join(tempRoot, 'final.txt.bak');
const missingTempPath = path.join(tempRoot, 'temp.txt');

try {
  await fs.writeFile(finalPath, 'committed\n', 'utf8');
  await replaceFile(missingTempPath, finalPath, { keepBackup: false });
  assert.equal(await fs.readFile(finalPath, 'utf8'), 'committed\n', 'expected async replace to keep committed final file');

  await fs.writeFile(backupPath, 'stale\n', 'utf8');
  replaceFileSync(missingTempPath, finalPath, { keepBackup: false });
  assert.equal(await fs.readFile(finalPath, 'utf8'), 'committed\n', 'expected sync replace to keep committed final file');

  console.log('atomic replace final committed missing temp test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
