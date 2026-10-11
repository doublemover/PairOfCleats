import assert from 'node:assert/strict';
import { __runWithAdaptiveConcurrencyForTests as runFiles } from '../../../tools/build/embeddings/runner.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
for (const siblingFails of [false, true]) {
  const first = deferred(), sibling = deferred();
  const starts = [];
  const firstError = new Error('first file failed');
  let settled = false;
  const outcome = runFiles({ items: [0, 1, 2, 3], initialConcurrency: 2,
    worker: (id) => { starts.push(id); return id === 0 ? first.promise : sibling.promise; }
  }).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
  assert.deepEqual(starts, [0, 1]);
  first.reject(firstError);
  await tick();
  assert.equal(settled, false, 'caller retains ownership while active sibling uses resources');
  assert.deepEqual(starts, [0, 1]);
  if (siblingFails) sibling.reject(new Error('later sibling failure'));
  else sibling.resolve();
  assert.equal(await outcome, firstError, 'preserve first error after all siblings settle');
  await tick();
  assert.deepEqual(starts, [0, 1], 'never start replacements after failure');
}
// Synchronous throws cannot escape the task reservation bookkeeping, including
// when an earlier sibling is already using caller-owned resources.
for (const failureIndex of [0, 1]) {
  const sibling = deferred();
  const starts = [];
  const expected = new Error('synchronous worker throw');
  let settled = false;
  const outcome = runFiles({ items: [0, 1, 2, 3], initialConcurrency: 3,
    worker: (id) => {
      starts.push(id);
      if (id === failureIndex) throw expected;
      return sibling.promise;
    }
  }).then(() => { settled = true; return null; }, (error) => { settled = true; return error; });
  await tick();
  assert.equal(settled, failureIndex === 0);
  assert.deepEqual(starts, failureIndex === 0 ? [0] : [0, 1]);
  sibling.resolve();
  assert.equal(await outcome, expected);
}
// A failing admission resolver is also a caller failure, not permission to leave
// active siblings detached or admit additional work.
{
  const tasks = [deferred(), deferred()];
  const starts = [];
  const expected = new Error('pressure reader failed');
  let calls = 0, settled = false;
  const outcome = runFiles({ items: [0, 1, 2], initialConcurrency: 2,
    resolveConcurrency: () => { if (++calls > 1) throw expected; return 2; },
    worker: (id) => { starts.push(id); return tasks[id].promise; }
  }).then(() => null, (error) => { settled = true; return error; });
  tasks[0].resolve();
  await tick();
  assert.equal(settled, false);
  assert.deepEqual(starts, [0, 1]);
  tasks[1].resolve();
  assert.equal(await outcome, expected);
}
assert.deepEqual(await runFiles({ items: [], worker: () => {} }),
  { peakConcurrency: 0, adjustments: 0, finalConcurrency: 1 });
console.log('adaptive file pump owns/drains active siblings and stops admissions on every failure path');
