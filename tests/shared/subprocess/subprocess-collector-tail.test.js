#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createCollector } from '../../../src/shared/subprocess/options.js';

const collector = createCollector({
  enabled: true,
  maxOutputBytes: 5,
  encoding: 'utf8'
});
collector.push('abc');
collector.push('de');
collector.push('f');
assert.equal(collector.toOutput('string'), 'bcdef');

const longCollector = createCollector({
  enabled: true,
  maxOutputBytes: 16,
  encoding: 'utf8'
});
for (let i = 0; i < 500; i += 1) {
  longCollector.push(`${String(i).padStart(4, '0')}\n`);
}
const tail = longCollector.toOutput('string');
assert.equal(Buffer.byteLength(tail, 'utf8') <= 16, true);
assert.match(tail, /049[0-9]/, 'expected tail output to preserve most recent bytes');

const lineCollector = createCollector({
  enabled: true,
  maxOutputBytes: 64,
  encoding: 'utf8'
});
lineCollector.push('one\ntwo\nthree\n');
assert.deepEqual(lineCollector.toOutput('lines'), ['one', 'two', 'three']);

console.log('subprocess collector tail test passed');
