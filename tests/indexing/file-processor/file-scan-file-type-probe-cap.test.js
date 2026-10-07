#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  FILE_TYPE_PROBE_MAX_BYTES,
  getFileTypeProbeBuffer
} from '../../../src/index/build/file-scan.js';

const shortProbe = Buffer.alloc(512, 65);
assert.equal(
  getFileTypeProbeBuffer(shortProbe),
  shortProbe,
  'expected small file-type probes to pass through unchanged'
);

const longProbe = Buffer.alloc(FILE_TYPE_PROBE_MAX_BYTES + 4096, 65);
const cappedProbe = getFileTypeProbeBuffer(longProbe);
assert.notEqual(cappedProbe, longProbe, 'expected oversized file-type probe to be sliced');
assert.equal(
  cappedProbe.length,
  FILE_TYPE_PROBE_MAX_BYTES,
  'expected oversized file-type probe to be capped at the security boundary'
);
assert.equal(cappedProbe.buffer, longProbe.buffer, 'expected probe cap to avoid copying the backing buffer');

console.log('file scan file-type probe cap test passed');
