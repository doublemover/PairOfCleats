#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = createPostingsQueue({
  maxPending: 1,
  maxPendingRows: 1,
  maxPendingBytes: 8,
  maxHeapFraction: 1
});

const first = await queue.reserve({ rows: 1, bytes: 8 });
let secondReservation = null;
let thirdReservation = null;

const secondPromise = queue.reserve({ rows: 1, bytes: 8 }).then((reservation) => {
  secondReservation = reservation;
  return reservation;
});
const thirdPromise = queue.reserve({ rows: 1, bytes: 8 }).then((reservation) => {
  thirdReservation = reservation;
  return reservation;
});

await sleep(30);
assert.equal(secondReservation, null, 'expected second waiter to block before first release');
assert.equal(thirdReservation, null, 'expected third waiter to block before first release');

first.release();
await sleep(30);
assert.ok(secondReservation, 'expected second waiter to wake after first release');
assert.equal(thirdReservation, null, 'expected third waiter to remain blocked until next release');

secondReservation.release();
await sleep(30);
assert.ok(thirdReservation, 'expected third waiter to wake after second release');

thirdReservation.release();
await Promise.all([secondPromise, thirdPromise]);

console.log('postings queue wake fairness test passed');
