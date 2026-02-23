#!/usr/bin/env node
import assert from 'node:assert/strict';
import { shuffleInPlace } from '../../../tools/bench/language-repos/planning.js';

const source = ['a', 'b', 'c', 'd', 'e'];
const shuffled = [...source];

const randomValues = [0.01, 0.83, 0.22, 0.74];
let randomIndex = 0;
const originalRandom = Math.random;
Math.random = () => randomValues[randomIndex++] ?? 0;
try {
  shuffleInPlace(shuffled);
} finally {
  Math.random = originalRandom;
}

assert.deepEqual(
  [...shuffled].sort(),
  [...source].sort(),
  'shuffle should preserve item multiset'
);
assert.notDeepEqual(
  shuffled,
  source,
  'controlled random stream should produce a reordered output'
);

console.log('bench-language shuffle test passed');
