#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';
import { readOffsetsFile, resolveOffsetsCount } from '../../../src/shared/artifact-io/offsets.js';

const tempRoot = await makeTempDir('poc-offsets-misaligned-');
const offsetsPath = path.join(tempRoot, 'rows.offsets.bin');

try {
  await fs.writeFile(offsetsPath, Buffer.alloc(9, 0x01));

  await assert.rejects(
    () => readOffsetsFile(offsetsPath),
    /ERR_OFFSETS_INVALID|misaligned/,
    'expected misaligned offsets file to be rejected'
  );

  await assert.rejects(
    () => resolveOffsetsCount(offsetsPath),
    /ERR_OFFSETS_INVALID|misaligned/,
    'expected misaligned offsets count resolution to be rejected'
  );

  console.log('offsets misaligned rejected test passed');
} finally {
  await rmDirRecursive(tempRoot);
}
