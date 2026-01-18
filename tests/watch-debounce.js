import assert from 'node:assert/strict';
import { createDebouncedScheduler } from '../src/index/build/watch.js';

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

console.log('watch debounce test passed');
