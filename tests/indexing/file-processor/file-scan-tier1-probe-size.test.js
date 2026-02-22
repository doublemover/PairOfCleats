#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFileScanner } from '../../../src/index/build/file-scan.js';

const runProbe = async (scanner) => {
  let requestedBytes = 0;
  await scanner.scanFile({
    absPath: '/repo/blob.unknown',
    stat: { size: 20000 },
    ext: '.unknown',
    readSample: async (_absPath, bytes) => {
      requestedBytes = bytes;
      return Buffer.from('text sample\n', 'utf8');
    }
  });
  return requestedBytes;
};

const defaultScanner = createFileScanner();
assert.equal(defaultScanner.tier1ProbeBytes, 8192, 'expected default tier1 probe size');
assert.equal(await runProbe(defaultScanner), 8192, 'expected unknown files to use tier1 probe bytes');

const lowScanner = createFileScanner({ tier1ProbeBytes: 1024 });
assert.equal(lowScanner.tier1ProbeBytes, 4096, 'expected tier1 probe min clamp');
assert.equal(await runProbe(lowScanner), 4096, 'expected unknown files to respect min-clamped probe size');

const highScanner = createFileScanner({ tier1ProbeBytes: 65536 });
assert.equal(highScanner.tier1ProbeBytes, 8192, 'expected tier1 probe max clamp');
assert.equal(await runProbe(highScanner), 8192, 'expected unknown files to respect max-clamped probe size');

console.log('file scan tier1 probe size test passed');
