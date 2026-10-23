import assert from 'node:assert/strict';
import PQueue from 'p-queue';
import { runWithQueue } from '../../../src/shared/concurrency/run-with-queue.js';

// AUTHORED: a reporting/skip callback cannot settle original backend resources.
const contains = (error, expected, depth = 0) => error === expected || (depth < 8 &&
  (error?.cause && contains(error.cause, expected, depth + 1)
    || error?.errors?.some(item => contains(item, expected, depth + 1))));
for (const fields of [
  { code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED' }, { code: 'PISCINA_DESTROY_TIMEOUT' },
  { code: 'PISCINA_FORCE_TERMINATE_INCOMPLETE' }, { code: 'BUILD_CLEANUP_TIMEOUT' },
  { code: 'ERR_PROCESS_TASK_BUDGET' }, { code: 'ERR_TOKENIZER_RESOURCE_PRESSURE' },
  { code: 'ERR_SCHEDULER_CPU_REACQUIRE' },
  { workerOwnershipPending: true }, { cacheOwnershipPending: true },
  { cacheOwnershipPending: false, cacheOwnershipReleased: () => false }
]) {
  const owner = Object.freeze({ exact: 'original-resource-owner' });
  const failure = Object.freeze(Object.assign(new Error('original backend lifetime unconfirmed'), fields, { owner, retryable: true }));
  let attempts = 0, skipped = 0, results = 0;
  await assert.rejects(runWithQueue(new PQueue({ concurrency: 1 }), [0], async () => { attempts++; throw failure; },
    { retries: 2, bestEffort: true, onError: () => { skipped++; }, onResult: () => { results++; } }), error => contains(error, failure));
  assert.equal(attempts, 1);
  assert.equal(skipped, 0, 'ordered skip/error recovery must not replace original cleanup authority');
  assert.equal(results, 0);
  assert.equal(failure.owner, owner);
}
let attempts = 0;
assert.deepEqual(await runWithQueue(new PQueue({ concurrency: 1 }), [0], async () => {
  if (++attempts === 1) throw Object.assign(new Error('settled ordinary worker error'), { retryable: true });
  return 'settled';
}, { retries: 2 }), ['settled']);
assert.equal(attempts, 2, 'independently retryable settled failures retain their production retry policy');
const controller = new AbortController();
const failure = Object.freeze(Object.assign(new Error('original cleanup beats concurrent outer cancellation'), {
  code: 'ERR_WORKER_POOL_CLEANUP_UNCONFIRMED', workerOwnershipPending: true
}));
await assert.rejects(runWithQueue(new PQueue({ concurrency: 1 }), [0], () => {
  controller.abort(); throw failure;
}, { signal: controller.signal, onError: () => assert.fail('cancellation cannot authorize ordered skip') }),
error => contains(error, failure));
console.log('resource failures forbid outer retry and ordered skip while ordinary retries remain');
