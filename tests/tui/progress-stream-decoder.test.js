#!/usr/bin/env node
import { ensureTestingEnv } from '../helpers/test-env.js';
import assert from 'node:assert/strict';
import { createProgressLineDecoder } from '../../src/shared/cli/progress-stream.js';

ensureTestingEnv(process.env);

const seen = [];
let overflowCount = 0;
const decoder = createProgressLineDecoder({
  strict: false,
  maxLineBytes: 64,
  onLine: ({ line }) => seen.push(line),
  onOverflow: () => {
    overflowCount += 1;
  }
});

decoder.push('one\n');
decoder.push('two');
decoder.push('\nthree\n');
decoder.push('x'.repeat(256));
decoder.flush();

assert.equal(seen[0], 'one');
assert.equal(seen[1], 'two');
assert.equal(seen[2], 'three');
assert(overflowCount >= 1, 'expected overflow callback for oversized carry');

console.log('progress stream decoder test passed');
