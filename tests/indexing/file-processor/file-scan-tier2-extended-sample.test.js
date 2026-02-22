#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createFileScanner } from '../../../src/index/build/file-scan.js';

const scanner = createFileScanner({
  tier1ProbeBytes: 8192,
  sampleBytes: 16384,
  binary: {
    sampleMinBytes: 1,
    maxNonTextRatio: 0.3
  },
  minified: {
    sampleMinBytes: 1,
    minChars: 1024,
    singleLineChars: 4096,
    avgLineThreshold: 300,
    maxLineThreshold: 600,
    maxWhitespaceRatio: 0.2
  }
});

const readCalls = [];
const binaryResult = await scanner.scanFile({
  absPath: '/repo/src/blob.unknown',
  stat: { size: 100000 },
  ext: '.unknown',
  readSample: async (_absPath, bytes) => {
    readCalls.push(bytes);
    if (bytes <= 8192) {
      return Buffer.from('plain-text-prefix\n'.repeat(200), 'utf8');
    }
    const extended = Buffer.alloc(bytes, 65);
    extended[12000] = 0;
    return extended;
  }
});

assert.deepEqual(
  readCalls,
  [8192, 16384],
  'expected tier-2 extended sample read after tier-1 inconclusive binary probe'
);
assert.equal(binaryResult.skip?.reason, 'binary', 'expected binary skip after extended sample');
assert.equal(binaryResult.checkedBinary, true, 'expected binary check to complete');

const conclusiveCalls = [];
const conclusiveResult = await scanner.scanFile({
  absPath: '/repo/src/conclusive.unknown',
  stat: { size: 100000 },
  ext: '.unknown',
  readSample: async (_absPath, bytes) => {
    conclusiveCalls.push(bytes);
    const sample = Buffer.alloc(bytes, 65);
    sample[32] = 0;
    return sample;
  }
});

assert.deepEqual(
  conclusiveCalls,
  [8192],
  'expected no tier-2 read when tier-1 result is already conclusive'
);
assert.equal(conclusiveResult.skip?.reason, 'binary', 'expected binary skip from tier-1 sample');

console.log('file scan tier2 extended sample test passed');
