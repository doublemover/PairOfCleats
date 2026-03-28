#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPostingsQueue } from '../../../src/index/build/indexer/steps/process-files/postings-queue.js';
import { buildOrderedAppender } from '../../../src/index/build/indexer/steps/process-files/ordered.js';
import { runApplyWithPostingsBackpressure } from '../../../src/index/build/indexer/steps/process-files.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const cases = [
  {
    name: 'stats reflect current pending reservations and high-water marks',
    async run() {
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
  },
  {
    name: 'waiters wake in order as capacity is released',
    async run() {
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
  },
  {
    name: 'backpressure records waits and supports timeout and abort rejection',
    async run() {
      const queue = createPostingsQueue({
        maxPending: 1,
        maxPendingRows: 2,
        maxPendingBytes: 100,
        maxHeapFraction: 1
      });

      const first = await queue.reserve({ rows: 2, bytes: 80 });
      let secondResolved = false;
      const start = Date.now();
      const secondPromise = queue.reserve({ rows: 2, bytes: 80 }).then((reservation) => {
        secondResolved = true;
        return reservation;
      });

      await sleep(50);
      assert.equal(secondResolved, false);

      first.release();
      const second = await secondPromise;
      const waitedMs = Date.now() - start;
      assert.ok(waitedMs >= 40);
      second.release();

      const stats = queue.stats();
      assert.ok(stats.backpressure?.count >= 1);
      assert.ok(stats.backpressure?.waitMs > 0);

      const timeoutQueue = createPostingsQueue({
        maxPending: 1,
        maxPendingRows: 2,
        maxPendingBytes: 100,
        maxHeapFraction: 1,
        reserveTimeoutMs: 25
      });
      const timeoutGuard = await timeoutQueue.reserve({ rows: 2, bytes: 80 });
      await assert.rejects(
        () => timeoutQueue.reserve({ rows: 2, bytes: 80 }),
        (err) => err?.code === 'POSTINGS_BACKPRESSURE_TIMEOUT'
      );
      timeoutGuard.release();

      const abortQueue = createPostingsQueue({
        maxPending: 1,
        maxPendingRows: 2,
        maxPendingBytes: 100,
        maxHeapFraction: 1
      });
      const abortGuard = await abortQueue.reserve({ rows: 2, bytes: 80 });
      const abortController = new AbortController();
      setTimeout(() => abortController.abort(new Error('abort postings reserve wait')), 10);
      await assert.rejects(
        () => abortQueue.reserve({ rows: 2, bytes: 80, signal: abortController.signal }),
        (err) => (err?.message || '').includes('abort postings reserve wait')
      );
      abortGuard.release();
    }
  },
  {
    name: 'unbounded-count queues wake all waiters when row and byte budgets permit',
    async run() {
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
      assert.equal(secondReservation, null);
      assert.equal(thirdReservation, null);
      assert.equal(fourthReservation, null);

      first.release();
      await sleep(30);
      assert.ok(secondReservation);
      assert.ok(thirdReservation);
      assert.ok(fourthReservation);

      secondReservation.release();
      thirdReservation.release();
      fourthReservation.release();
      await Promise.all([secondPromise, thirdPromise, fourthPromise]);
    }
  },
  {
    name: 'head-of-line bypass prevents ordered flush deadlocks',
    async run() {
      const queue = createPostingsQueue({
        maxPending: 1,
        maxPendingRows: 10,
        maxPendingBytes: 1024,
        maxHeapFraction: 1
      });

      const flushed = [];
      const appender = buildOrderedAppender(
        async (result) => {
          flushed.push(result.id);
        },
        {},
        {
          startIndex: 105,
          expectedCount: 2
        }
      );

      const tailReservation = await queue.reserve({ rows: 10, bytes: 0 });
      const tailDone = appender
        .enqueue(106, { id: 106, chunks: Array.from({ length: 10 }, () => ({})) })
        .finally(() => tailReservation.release());

      const nextIndex = appender.peekNextIndex();
      const headReservation = await queue.reserve({
        rows: 10,
        bytes: 0,
        bypass: Number.isFinite(nextIndex) && 105 <= nextIndex
      });
      const headDone = appender
        .enqueue(105, { id: 105, chunks: Array.from({ length: 10 }, () => ({})) })
        .finally(() => headReservation.release());

      const completionState = await Promise.race([
        Promise.all([headDone, tailDone]).then(() => 'resolved', () => 'rejected'),
        sleep(300).then(() => 'pending')
      ]);
      assert.equal(completionState, 'resolved');

      await Promise.all([headDone, tailDone]);
      assert.deepEqual(flushed, [105, 106]);
      const stats = queue.stats();
      assert.ok(stats.backpressure.bypass >= 1);
      assert.equal(stats.pending.count, 0);
    }
  },
  {
    name: 'enqueue-first apply flow drains after held reservations release',
    async run() {
      const queue = createPostingsQueue({
        maxPending: 1,
        maxPendingRows: 10,
        maxPendingBytes: 1024,
        maxHeapFraction: 1
      });

      const flushed = [];
      const appender = buildOrderedAppender(
        async (result) => runApplyWithPostingsBackpressure({
          sparsePostingsEnabled: true,
          postingsQueue: queue,
          result,
          runApply: async () => {
            flushed.push(result.id);
          }
        }),
        {},
        {
          startIndex: 105,
          expectedCount: 2
        }
      );

      const guardReservation = await queue.reserve({ rows: 10, bytes: 0 });
      const tailDone = appender.enqueue(106, { id: 106, chunks: [{ id: 'tail' }] });
      const headDone = appender.enqueue(105, { id: 105, chunks: [{ id: 'head' }] });

      const waitingState = await Promise.race([
        Promise.all([headDone, tailDone]).then(() => 'resolved'),
        sleep(30).then(() => 'pending')
      ]);
      assert.equal(waitingState, 'pending');

      guardReservation.release();
      await Promise.race([
        Promise.all([headDone, tailDone]),
        sleep(500).then(() => {
          throw new Error('expected enqueue-first ordered flow to complete after releasing queue backpressure');
        })
      ]);

      assert.deepEqual(flushed, [105, 106]);
      assert.equal(queue.stats().pending.count, 0);
    }
  }
];

for (const testCase of cases) {
  await testCase.run();
}

console.log('postings queue contract matrix test passed');
