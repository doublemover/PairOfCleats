#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createDisplay } from '../../../src/shared/cli/display.js';

const writes = [];
const stream = {
  isTTY: false,
  write: (chunk) => {
    writes.push(String(chunk));
    return true;
  }
};

const display = createDisplay({
  stream,
  isTTY: false,
  progressMode: 'tty',
  json: false
});

assert.equal(display.progressMode, 'log');
assert.equal(display.interactive, false);

display.showProgress('Test', 1, 2);
assert.ok(writes.join('').includes('Test'), 'expected progress output in log mode');

display.close();

console.log('progress tty normalization test passed');
