#!/usr/bin/env node
import { normalizeExtFilter } from '../src/search/filters.js';

const result = normalizeExtFilter(['*.js', 'JS', '.Md']);
const expected = ['.js', '.md'];

const sorted = (result || []).slice().sort();
const expectedSorted = expected.slice().sort();

const sameLength = sorted.length === expectedSorted.length;
const sameValues = sorted.every((value, idx) => value === expectedSorted[idx]);
if (!sameLength || !sameValues) {
  console.error(`normalizeExtFilter failed: expected ${expectedSorted.join(', ')}, got ${sorted.join(', ')}`);
  process.exit(1);
}

console.log('ext filter test passed');
