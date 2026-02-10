#!/usr/bin/env node
import assert from 'node:assert/strict';
import { resolveJsonlExtension as resolveFromShared } from '../../../src/shared/json-stream.js';
import { resolveJsonlExtension as resolveFromWriters } from '../../../src/index/build/artifacts/writers/_common.js';

const cases = [
  null,
  undefined,
  'none',
  'gzip',
  'zstd',
  'brotli',
  ''
];

for (const value of cases) {
  assert.equal(
    resolveFromWriters(value),
    resolveFromShared(value),
    `jsonl extension parity mismatch for value=${String(value)}`
  );
}

console.log('resolution strictness parity test passed');
