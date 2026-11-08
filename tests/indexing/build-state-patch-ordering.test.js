#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createPatchQueue } from '../../src/index/build/build-state/patch-queue.js';
import { mergeState } from '../../src/index/build/build-state/store.js';

for (const failure of ['error', 'lock-return', 'lock-throw']) {
  let rejectFirst, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const first = new Promise((_, reject) => { rejectFirst = reject; });
  let calls = 0, state = {};
  const events = [];
  const queue = createPatchQueue({ mergeState, recordStateError: () => {},
    applyStatePatch: async (_root, patch, batchEvents) => {
      calls++;
      if (calls === 1) {
        entered();
        if (failure === 'lock-return') { try { await first; } catch (error) { return error; } }
        await first;
      }
      state = mergeState(state, patch);
      events.push(...batchEvents);
      return state;
    } });
  const root = `ordering-${failure}`;
  const old = queue.queueStatePatch(root, { stage: 'old', independent: true }, ['old'], { durabilityClass: 'required' });
  const rejected = assert.rejects(old);
  await started;
  const next = queue.queueStatePatch(root, { stage: 'new' }, ['new'], { durabilityClass: 'required' });
  const third = queue.queueStatePatch(root, { stage: 'newest' }, ['newest'], { durabilityClass: 'required' });
  rejectFirst(Object.assign(new Error('injected failure'),
    failure.startsWith('lock') ? { code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE' } : {}));
  await rejected;
  await next; await third;
  await queue.flushBuildState(root);
  assert.deepEqual(state, { stage: 'newest', independent: true });
  assert.deepEqual(events, ['old', 'new', 'newest']);
  assert.equal(calls, 3, 'no stale retry may follow acknowledged newer batches');
}
console.log('failed detached patches recover before later batch acknowledgements');
