#!/usr/bin/env node
import assert from 'node:assert/strict';
import { printHelp } from '../../../src/retrieval/cli/search-entry.js';

const chunks = [];
const fakeStdout = {
  columns: 88,
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
assert.match(output, /pairofcleats index build/);

console.log('search help surface test passed');
