#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createRunQueue } from '../src/shared/onnx-embeddings.js';

const queue = createRunQueue();
let active = 0;
let maxActive = 0;
const order = [];

const tasks = Array.from({ length: 5 }, (_, i) => queue(async () => {
  active += 1;
  maxActive = Math.max(maxActive, active);
  order.push(i);
  await new Promise((resolve) => setTimeout(resolve, 10));
  active -= 1;
  return i;
}));

const results = await Promise.all(tasks);
assert.equal(maxActive, 1, 'expected serialized session.run queue');
assert.deepEqual(results, [0, 1, 2, 3, 4], 'expected queue to preserve task order');
assert.deepEqual(order, [0, 1, 2, 3, 4], 'expected queue to run tasks sequentially');

console.log('onnx session queue test passed');
