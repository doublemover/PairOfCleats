#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  findStartableQueueIndex,
  pickNextSchedulerQueue
} from '../../../src/shared/concurrency/scheduler-core-queue-selection.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const queueWithBlockedPrefix = {
  pending: [
    { tokens: { slot: 0 }, enqueuedAt: 0 },
    { tokens: { slot: 1 }, enqueuedAt: 0 },
    { tokens: { slot: 2 }, enqueuedAt: 0 },
    { tokens: { slot: 3 }, enqueuedAt: 0 },
    { tokens: { slot: 4 }, enqueuedAt: 0 }
  ],
  pendingSearchCursor: 0
};

let checks = 0;
const startAtOrAfterThree = (_queue, tokens) => {
  checks += 1;
  return Number(tokens?.slot) >= 3;
};

const firstIndex = findStartableQueueIndex({
  queue: queueWithBlockedPrefix,
  canStart: startAtOrAfterThree
});
assert.equal(firstIndex, 3, 'expected first startable request after blocked prefix');
assert.equal(checks, 4, 'expected initial scan to visit blocked prefix once');

queueWithBlockedPrefix.pending.splice(firstIndex, 1);
checks = 0;
const secondIndex = findStartableQueueIndex({
  queue: queueWithBlockedPrefix,
  canStart: startAtOrAfterThree
});
assert.equal(secondIndex, 3, 'expected rotating cursor to resume at prior dequeue slot');
assert.equal(
  checks,
  1,
  'expected rotating cursor to avoid rescanning blocked prefix on subsequent dequeue'
);

const wrapQueue = {
  pending: [
    { tokens: { slot: 0 }, enqueuedAt: 0 },
    { tokens: { slot: 1 }, enqueuedAt: 0 },
    { tokens: { slot: 2 }, enqueuedAt: 0 },
    { tokens: { slot: 3 }, enqueuedAt: 0 }
  ],
  pendingSearchCursor: 3
};
let wrapChecks = 0;
const canStartFrontOnly = (_queue, tokens) => {
  wrapChecks += 1;
  return Number(tokens?.slot) === 0;
};
const wrappedIndex = findStartableQueueIndex({
  queue: wrapQueue,
  canStart: canStartFrontOnly
});
assert.equal(wrappedIndex, 0, 'expected wrapped scan to still consider head entries');
assert.equal(wrapChecks, 2, 'expected wrapped scan to probe cursor slot then front slot');

const queueOrder = [
  {
    name: 'normal',
    pending: [{ tokens: { slot: 1 }, enqueuedAt: 900 }],
    pendingSearchCursor: 0,
    weight: 1,
    priority: 5,
    stats: { waitP95Ms: 0 }
  },
  {
    name: 'starved',
    pending: [{ tokens: { slot: 2 }, enqueuedAt: 0 }],
    pendingSearchCursor: 0,
    weight: 1,
    priority: 50,
    stats: { waitP95Ms: 0 }
  }
];
const picked = pickNextSchedulerQueue({
  queueOrder,
  nowMs: () => 10_000,
  starvationMs: 2_000,
  canStart: () => true
});
assert.ok(picked, 'expected picker to return a startable queue');
assert.equal(picked?.queue?.name, 'starved', 'expected starvation override to bypass priority scoring');
assert.equal(picked?.starved, true, 'expected starvation marker for selected queue');

console.log('scheduler core queue selection test passed');
