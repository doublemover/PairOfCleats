#!/usr/bin/env node
import assert from 'node:assert';
import { cleanContext } from '../../../src/retrieval/output/context.js';

const lines = [
  '```ts',
  'const x = 1;',
  '```',
  '',
  'function test() {}'
];
const cleaned = cleanContext(lines);
assert(!cleaned.some((line) => line.includes('```')), 'expected fence lines to be removed');
assert(cleaned.some((line) => line.includes('const x = 1')), 'expected code line to remain');
console.log('cleanContext fence stripping test passed');
