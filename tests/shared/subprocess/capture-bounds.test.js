#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSubprocess } from '../../../src/shared/subprocess.js';

const maxOutputBytes = 512;
const script = `process.stdout.write('a'.repeat(${maxOutputBytes * 3}));`;
const result = await spawnSubprocess(process.execPath, ['-e', script], {
  maxOutputBytes,
  outputMode: 'string'
});

assert.ok(typeof result.stdout === 'string', 'expected stdout string');
assert.ok(result.stdout.length <= maxOutputBytes, 'stdout should be capped');
assert.equal(result.stdout.length, maxOutputBytes, 'expected stdout to contain tail bytes');
assert.equal(result.stdout, 'a'.repeat(maxOutputBytes), 'expected tail of output');

console.log('subprocess capture bounds test passed');
