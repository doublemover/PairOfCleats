#!/usr/bin/env node
import assert from 'node:assert/strict';
import { printHelp } from '../../../src/retrieval/cli/search-entry.js';
import { ANSI } from '../../../src/shared/cli/ansi-utils.js';

const chunks = [];
const fakeStdout = {
  columns: 88,
  isTTY: false,
  write(value) {
    chunks.push(String(value));
    return true;
  }
};

printHelp(fakeStdout);

const output = chunks.join('');
assert.match(output, /PairOfCleats Search/);
assert.match(output, /Starter Recipes/);
assert.match(output, /--calls <symbol>/);
assert.match(output, /--uses <symbol>/);
assert.match(output, /--author <name>/);
assert.match(output, /--import <path-or-symbol>/);
assert.match(output, /--explain/);
assert.match(output, /--why/);
assert.match(output, /pairofcleats index build/);
assert.ok(output.endsWith('\n'), 'expected help output to end with a trailing newline');
assert.equal(output.includes(ANSI.bold), false, 'expected non-TTY help output to omit ANSI color');

console.log('search help surface test passed');
