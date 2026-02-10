#!/usr/bin/env node
import assert from 'node:assert/strict';
import { applyTestEnv } from '../../helpers/test-env.js';
import { createNoopTask, resolveTaskFactory } from '../../../src/shared/cli/noop-task.js';

applyTestEnv();

const noopTask = createNoopTask();
for (const method of ['tick', 'set', 'done', 'fail', 'update']) {
  assert.equal(typeof noopTask[method], 'function');
  noopTask[method]();
}

const sentinel = { marker: 'ok' };
const customTaskFactory = () => sentinel;
assert.equal(resolveTaskFactory(customTaskFactory), customTaskFactory);
const fallbackFactory = resolveTaskFactory(null);
const fallbackTask = fallbackFactory('demo');
assert.equal(typeof fallbackFactory, 'function');
for (const method of ['tick', 'set', 'done', 'fail', 'update']) {
  assert.equal(typeof fallbackTask[method], 'function');
}

console.log('shared cli noop task test passed');
