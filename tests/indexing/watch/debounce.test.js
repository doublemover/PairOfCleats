import assert from 'node:assert/strict';
import { createDebouncedScheduler } from '../../../src/index/build/watch.js';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let calls = 0;
const scheduler = createDebouncedScheduler({
  debounceMs: 30,
  onRun: () => {
    calls += 1;
  }
});

scheduler.schedule();
scheduler.schedule();
await wait(10);
scheduler.schedule();
await wait(60);
assert.equal(calls, 1, 'expected single debounced run');

scheduler.schedule();
await wait(50);
assert.equal(calls, 2, 'expected second run after debounce');

const errors = [];
const throwingHooks = createDebouncedScheduler({
  debounceMs: 1,
  onFire: () => { throw new Error('fire hook failed'); },
  onRun: async () => {
    calls += 1;
    throw new Error('run failed');
  },
  onError: (error) => {
    errors.push(error.message);
    throw new Error('error hook failed');
  }
});
throwingHooks.schedule();
await wait(30);
assert.equal(calls, 3, 'a failing notification must not prevent the scheduled work');
assert.deepEqual(errors, ['fire hook failed', 'run failed']);

const rejectingHooks = createDebouncedScheduler({
  debounceMs: 1,
  onRun: async () => { throw new Error('async run failed'); },
  onError: async () => { throw new Error('async error hook failed'); }
});
rejectingHooks.schedule();
await wait(30);

scheduler.schedule();
scheduler.cancel();
await wait(50);
assert.equal(calls, 3, 'cancel must still suppress the scheduled run');

console.log('watch debounce test passed');
