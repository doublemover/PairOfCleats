#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';

import { writeBinaryRowFrames } from '../../../src/shared/artifact-io/binary-columnar.js';
import { resolveTestCachePath } from '../../helpers/test-cache.js';

const root = process.cwd();
const testRoot = resolveTestCachePath(root, 'binary-columnar-phase-timings');
await fs.rm(testRoot, { recursive: true, force: true });
await fs.mkdir(testRoot, { recursive: true });

const result = await writeBinaryRowFrames({
  rowBuffers: ['alpha', 'beta', 'gamma'],
  dataPath: path.join(testRoot, 'rows.bin'),
  offsetsPath: path.join(testRoot, 'rows.offsets.bin'),
  lengthsPath: path.join(testRoot, 'rows.lengths.varint')
});

assert.equal(result.count, 3, 'expected row count');
assert.ok(result.phaseTimings && typeof result.phaseTimings === 'object', 'expected phase timings');
assert.ok(Number.isFinite(result.phaseTimings.flushMs), 'expected flushMs timing');
assert.ok(Number.isFinite(result.phaseTimings.fsyncMs), 'expected fsyncMs timing');
assert.ok(Number.isFinite(result.phaseTimings.publishMs), 'expected publishMs timing');
assert.equal(result.phaseTimings.serializationMs, 0, 'expected serializationMs to remain writer-owned');

await fs.rm(testRoot, { recursive: true, force: true });

console.log('binary columnar phase timings test passed');
