import assert from 'node:assert/strict';
import { createFtsWork } from '../../../src/retrieval/fts-work.js';

const fixture = ({ count = 5, budget = 100, chunkSize = 2, step = () => {}, qualify = rows => rows,
  close = () => ({ done: true }), guard = null, rowLimit = 100 } = {}) => {
  let time = 0, next = 0, closed = 0;
  const batches = [];
  const work = createFtsWork({ timeBudgetMs: budget, chunkSize, now: () => time, throwIfAborted: guard });
  return { work, batches, get closed() { return closed; }, get next() { return next; },
    advance: ms => { time += ms; },
    run: () => work.collect({ rowLimit, openCursor: () => ({
      next() { step(next, ms => { time += ms; }); return next < count ? { value: { id: next++ }, done: false } : { done: true }; },
      return() { closed++; return close(); }
    }), qualifyBatch: rows => { batches.push(rows.map(row => row.id)); return qualify(rows, work, ms => { time += ms; }); } }) };
};
for (const [count, expected] of [[0, []], [1, [[0]]], [2, [[0, 1]]], [3, [[0, 1], [2]]], [5, [[0, 1], [2, 3], [4]]]]) {
  const test = fixture({ count });
  assert.deepEqual(test.run().rows.map(row => row.id), Array.from({ length: count }, (_, i) => i));
  assert.deepEqual(test.batches, expected);
  assert.equal(test.closed, 1);
}
for (const [chunkSize, expected] of [[1, 5], [2, 3], [5, 1]]) {
  const test = fixture({ chunkSize });
  assert.equal(test.run().termination, 'complete');
  assert.equal(test.work.snapshot().batches, expected, 'chunk size must change actual qualification dispatch');
}
const slow = fixture({ budget: 10, step: (_id, advance) => advance(25) });
assert.deepEqual(slow.run(), { rows: [{ id: 0 }], termination: 'deadline' });
assert.equal(slow.next, 1, 'a slow synchronous step cannot be interrupted, but no next step may dispatch');
assert.equal(slow.closed, 1);
assert.equal(slow.work.snapshot().overrunMs, 15);
assert.equal(slow.work.snapshot().hardDeadline, false);
assert.equal(slow.work.snapshot().nativeInterruption, false);
const partial = fixture({ budget: 10, qualify: (rows, work, advance) => {
  if (rows[0].id >= 2) {
    work.run('metadata', () => advance(15));
    work.run('terms', () => assert.fail('term query cannot dispatch after hydration exhausted the allowance'));
  }
  return rows;
} });
assert.deepEqual(partial.run(), { rows: [{ id: 0 }, { id: 1 }], termination: 'deadline' });
assert.equal(partial.work.snapshot().phases.metadata, 15);
assert.equal(partial.closed, 1);
const cap = fixture({ rowLimit: 4 });
assert.equal(cap.run().termination, 'row-cap');
assert.equal(cap.work.snapshot().rowsScanned, 4);
assert.equal(cap.closed, 1);
const nativeError = new Error('native query failure');
const failed = fixture({ step: () => { throw nativeError; } });
assert.throws(failed.run, error => error === nativeError);
assert.equal(failed.closed, 1);
for (const close of [() => { throw new Error('close failed'); }, () => ({ done: false })]) {
  const cleanup = fixture({ close });
  assert.throws(cleanup.run, error => error.cacheOwnershipPending === true);
  assert.equal(cleanup.closed, 1);
}
let cancelled = false;
const abort = Object.assign(new Error('cancelled'), { code: 'ABORT_ERR' });
const cancellation = fixture({ step: (_id) => { cancelled = true; }, guard: () => { if (cancelled) throw abort; } });
assert.throws(cancellation.run, error => error === abort);
assert.equal(cancellation.closed, 1, 'cancellation retains cursor disposal');
console.log('FTS cooperative work dispatch, partial qualification and cursor disposal test passed');
