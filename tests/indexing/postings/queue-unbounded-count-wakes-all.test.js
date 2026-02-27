#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const queue = createPostingsQueue({
  maxPendingRows: 100,
  maxPendingBytes: 1000,
  maxHeapFraction: 1
});

const first = await queue.reserve({ rows: 100, bytes: 300 });
let secondReservation = null;
let thirdReservation = null;
let fourthReservation = null;

const secondPromise = queue.reserve({ rows: 20, bytes: 100 }).then((reservation) => {
  secondReservation = reservation;
  return reservation;
});
const thirdPromise = queue.reserve({ rows: 20, bytes: 100 }).then((reservation) => {
  thirdReservation = reservation;
  return reservation;
});
const fourthPromise = queue.reserve({ rows: 20, bytes: 100 }).then((reservation) => {
  fourthReservation = reservation;
  return reservation;
});

await sleep(30);
assert.equal(secondReservation, null, 'expected second waiter to block before release');
assert.equal(thirdReservation, null, 'expected third waiter to block before release');
assert.equal(fourthReservation, null, 'expected fourth waiter to block before release');

first.release();
await sleep(30);

assert.ok(secondReservation, 'expected second waiter to wake after release');
assert.ok(thirdReservation, 'expected third waiter to wake after release');
assert.ok(fourthReservation, 'expected fourth waiter to wake after release');

secondReservation.release();
thirdReservation.release();
fourthReservation.release();
await Promise.all([secondPromise, thirdPromise, fourthPromise]);

console.log('postings queue unbounded count wake test passed');
