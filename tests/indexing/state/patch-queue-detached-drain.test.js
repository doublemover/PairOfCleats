#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPatchQueue } from '../../../src/index/build/build-state/patch-queue.js';

for (const failure of ['success', 'error', 'lock-return', 'lock-throw']) {
  let release, started;
  const blocked = new Promise(resolve => { release = resolve; });
  const entered = new Promise(resolve => { started = resolve; });
  const queue = createPatchQueue({ mergeState: (a, b) => ({ ...a, ...b }), recordStateError() {},
    applyStatePatch: async () => {
      started(); await blocked;
      const error = Object.assign(new Error(failure), failure.startsWith('lock') ? { code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE' } : {});
      if (failure === 'lock-return') return error;
      if (failure !== 'success') throw error;
      return { committed: true };
    } });
  const key = `drain-${failure}`;
  const waiter = queue.queueStatePatch(key, { stage: 'test' }, [], { flushNow: true, durabilityClass: 'required' });
  const outcome = waiter.catch(() => null);
  await entered;
  let settled = false;
  const drain = queue.flushBuildState(key).then(result => { settled = true; return result; });
  await new Promise(setImmediate);
  assert.equal(settled, false, 'flush cannot acknowledge a detached apply still in flight');
  release(); await outcome;
  assert.equal((await drain).status, failure === 'success' ? 'flushed' : 'timed_out');
}
console.log('explicit state flush fences detached writes and observes failed recovery');
