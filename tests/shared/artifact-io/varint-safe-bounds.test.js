#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { encodeVarintDeltas, readVarintDeltasAt } from '../../../src/shared/artifact-io/varint.js';
import { makeTempDir, rmDirRecursive } from '../../helpers/temp.js';

assert.throws(
  () => encodeVarintDeltas([Number.MAX_SAFE_INTEGER + 1]),
  /Invalid delta value/,
  'expected non-safe integer encode to fail closed'
);

const tempRoot = await makeTempDir('pairofcleats-varint-safe-');
try {
  const dataPath = path.join(tempRoot, 'index.bin');
  await fs.writeFile(dataPath, Buffer.from([0xac, 0x02]), 'binary');

  const decoded = await readVarintDeltasAt(dataPath, 0, 2);
  assert.deepEqual(decoded, [300], 'expected valid read range to decode');

  await assert.rejects(
    () => readVarintDeltasAt(dataPath, 0, 3),
    /Truncated varint read/,
    'expected short reads to fail closed'
  );
} finally {
  await rmDirRecursive(tempRoot);
}

console.log('varint safe bounds test passed');
