#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { replaceDir, replaceFile, replaceFileSync } from '../../../src/shared/io/atomic-persistence.js';

const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'pairofcleats-atomic-persistence-'));

try {
  const finalFile = path.join(tempRoot, 'final.txt');
  const missingTempFile = path.join(tempRoot, 'missing-temp.txt');

  await assert.rejects(
    replaceFile(missingTempFile, finalFile),
    (error) => error?.code === 'ERR_TEMP_MISSING' && /Temp file missing before replace/i.test(error.message),
    'replaceFile should fail closed with ERR_TEMP_MISSING when the temp file is absent'
  );

  const syncError = (() => {
    try {
      replaceFileSync(missingTempFile, finalFile);
      return null;
    } catch (error) {
      return error;
    }
  })();
  assert.ok(syncError instanceof Error, 'replaceFileSync should throw when the temp file is absent');
  assert.equal(syncError?.code, 'ERR_TEMP_MISSING');
  assert.match(syncError?.message || '', /Temp file missing before replace/i);

  const directoryTarget = path.join(tempRoot, 'directory-target');
  const tempPayload = path.join(tempRoot, 'payload.txt');
  await fs.mkdir(directoryTarget, { recursive: true });
  await fs.writeFile(tempPayload, 'payload', 'utf8');
  await assert.rejects(
    replaceFile(tempPayload, directoryTarget),
    (error) => error?.code === 'EISDIR' && /file replace requires a file target/i.test(error.message),
    'replaceFile should preserve the EISDIR contract for directory targets'
  );
  assert.equal(await fs.readFile(tempPayload, 'utf8'), 'payload', 'temp payload should remain after EISDIR rejection');

  const missingTempDir = path.join(tempRoot, 'missing-temp-dir');
  const finalDir = path.join(tempRoot, 'final-dir');
  await assert.rejects(
    replaceDir(missingTempDir, finalDir),
    (error) => error?.code === 'ERR_TEMP_MISSING' && /Temp dir missing before replace/i.test(error.message),
    'replaceDir should fail closed with ERR_TEMP_MISSING when the temp dir is absent'
  );

  console.log('atomic persistence contract test passed');
} finally {
  await fs.rm(tempRoot, { recursive: true, force: true });
}
