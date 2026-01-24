#!/usr/bin/env node
import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../src/shared/concurrency.js';

const queue = new PQueue({ concurrency: 2 });

const setItems = new Set(['a', 'b', 'c']);
const setResults = await runWithQueue(queue, setItems, async (item) => item.toUpperCase());
assert.deepEqual(setResults, ['A', 'B', 'C'], 'set iteration should preserve order');

function *gen() {
  yield 1;
  yield 2;
  yield 3;
}
const genResults = await runWithQueue(queue, gen(), async (item) => item * 2);
assert.deepEqual(genResults, [2, 4, 6], 'generator iteration should preserve order');

console.log('concurrency iterable inputs test passed');
