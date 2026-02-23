#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsPromises from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createSpillSorter } from '../../../src/map/build-map/io.js';

const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'poc-map-spill-cleanup-'));
const sorter = createSpillSorter({
  label: 'spill',
  compare: (left, right) => left.id - right.id,
  maxInMemory: 1,
  tempDir: tempRoot
});

await sorter.push({ id: 2 });
await sorter.push({ id: 1 });
const finalized = await sorter.finalize();
assert.equal(finalized.spilled, true, 'expected sorter to spill run files');
assert.ok(Array.isArray(finalized.runs) && finalized.runs.length >= 2, 'expected spill run files to exist');

const originalRm = fsPromises.rm;
const attemptsByPath = new Map();
fsPromises.rm = async (targetPath, options) => {
  const key = String(targetPath);
  const attempts = (attemptsByPath.get(key) || 0) + 1;
  attemptsByPath.set(key, attempts);
  if (attempts === 1) {
    const error = new Error('transient descriptor pressure');
    error.code = 'EMFILE';
    throw error;
  }
  return originalRm(targetPath, options);
};

try {
  await sorter.cleanup();
} finally {
  fsPromises.rm = originalRm;
}

for (const runPath of finalized.runs) {
  assert.equal(fs.existsSync(runPath), false, `expected spill run cleanup: ${runPath}`);
  assert.ok((attemptsByPath.get(String(runPath)) || 0) >= 2, 'expected retry path to be exercised');
}

await fsPromises.rm(tempRoot, { recursive: true, force: true });
console.log('map spill cleanup retries test passed');
