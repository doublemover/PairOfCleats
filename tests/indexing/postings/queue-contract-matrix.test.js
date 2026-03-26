#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

{
  const queue = createPostingsQueue({
    maxPending: 2,
    maxPendingRows: 4,
    maxPendingBytes: 200,
    maxHeapFraction: 1
  });

  const first = await queue.reserve({ rows: 2, bytes: 60 });
  const second = await queue.reserve({ rows: 1, bytes: 20 });

  const mid = queue.stats();
  assert.equal(mid.limits?.maxPending, 2);
  assert.equal(mid.pending?.count, 2);
  assert.equal(mid.pending?.rows, 3);
  assert.equal(mid.pending?.bytes, 80);
  assert.ok(mid.highWater?.pending >= 2);
  assert.ok(mid.highWater?.rows >= 3);
  assert.ok(mid.highWater?.bytes >= 80);

  second.release();
  first.release();

  const end = queue.stats();
  assert.equal(end.pending?.count, 0);
  assert.equal(end.pending?.rows, 0);
  assert.equal(end.pending?.bytes, 0);
}

{
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
  assert.equal(secondReservation, null);
  assert.equal(thirdReservation, null);

  first.release();
  await sleep(30);
  assert.ok(secondReservation);
  assert.equal(thirdReservation, null);

  secondReservation.release();
  await sleep(30);
  assert.ok(thirdReservation);

  thirdReservation.release();
  await Promise.all([secondPromise, thirdPromise]);
}

console.log('postings queue contract matrix test passed');
