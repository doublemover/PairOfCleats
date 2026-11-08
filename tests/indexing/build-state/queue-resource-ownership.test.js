import assert from 'node:assert/strict';
import { createPatchQueue } from '../../../src/index/build/build-state/patch-queue.js';
import { mergeState } from '../../../src/index/build/build-state/store.js';
import { estimateJsonBytes } from '../../../src/shared/cache/size.js';
import { createManualClock } from '../../helpers/manual-clock.js';
import { setProgressHandlers } from '../../../src/shared/progress-runtime.js';

// UNVALIDATED: actual queue with virtual clock/inert native write boundaries.
const selected = process.env.PAIROFCLEATS_TEST_ID?.split('/').at(-1);
assert.ok(['required-no-auto', 'pending', 'callback-capture', 'diagnostic', 'detached', 'best-effort-retry', 'retained-bytes'].includes(selected));
const clock = createManualClock(), logs = [];
const restoreLogs = setProgressHandlers({ logLine(message, meta) { logs.push({ message, meta }); } });
const rejected = async work => { try { await work(); } catch (error) { return error; } assert.fail('expected retained queue failure'); };
let ready = false, release;
const gate = new Promise(resolve => { release = resolve; });
try {
  let calls = 0, codeReads = 0, state = {};
  const events = [], writes = [], reports = [];
  const secondary = Object.freeze(Object.assign(new Error('diagnostic-owned work'), { cacheOwnershipReleased() {
    assert.equal(this, secondary); return ready;
  } }));
  const primary = new Error('original write failed');
  const pending = ['pending', 'callback-capture', 'detached'].includes(selected);
  if (pending) {
    primary.cacheOwnershipPending = false;
    primary.cacheOwnershipReleased = function () { assert.equal(this, primary); return ready; };
  }
  Object.defineProperty(primary, 'code', { get() {
    codeReads++; if (selected === 'diagnostic') throw secondary;
    return selected === 'best-effort-retry' ? 'ERR_BUILD_STATE_LOCK_UNAVAILABLE' : 'EIO';
  } });
  const queue = createPatchQueue({ mergeState, recordStateError: (_root, error) => reports.push(error),
    applyStatePatch: async (_root, patch, batchEvents) => {
      writes.push(patch);
      if (++calls === 1) { if (selected === 'detached') await gate; throw primary; }
      state = mergeState(state, patch); events.push(...batchEvents); return state;
    } });
  const root = `virtual-resource-${selected}`, initial = { stage: 'original', retained: 'x'.repeat(4096) };
  if (selected === 'best-effort-retry' || selected === 'retained-bytes') {
    const first = queue.queueStatePatch(root, initial, ['old'], { flushNow: true });
    if (selected === 'retained-bytes') await rejected(() => first);
    else assert.equal((await first).status, 'timed_out');
    if (selected === 'retained-bytes') {
      const telemetry = await queue.queueStatePatch(root, { progress: { completed: 2 } }, ['new'], { waitForFlush: false });
      assert.ok(telemetry.pendingPatchBytes >= estimateJsonBytes(initial), 'failed retained work is charged');
      await queue.flushBuildState(root);
    } else {
      await clock.advance(250);
      assert.equal(logs.filter(entry => entry.meta?.buildState?.event === 'patch-lock-unavailable-retry').length, 1);
      await queue.flushBuildState(root);
    }
    assert.equal(calls, 2); assert.equal(state.retained.length, 4096);
    assert.deepEqual(events, selected === 'retained-bytes' ? ['old', 'new'] : ['old']);
  } else {
    const first = queue.queueStatePatch(root, initial, ['old'], { durabilityClass: 'required' });
    const firstFailure = rejected(() => first);
    const followers = [];
    if (selected === 'detached') {
      await clock.settle();
      for (const stage of ['next', 'last']) followers.push(rejected(() => queue.queueStatePatch(root, { stage }, [stage], { durabilityClass: 'required' })));
      release();
    }
    const failure = await firstFailure; await Promise.all(followers); await clock.settle();
    assert.equal(calls, 1);
    await clock.advance(10000); assert.equal(calls, 1, 'no background replay of required or unsettled work');
    if (pending || selected === 'diagnostic') {
      assert.equal(failure.cacheOwnershipReleased(), false);
      if (pending) assert.equal(codeReads, 0, 'native settlement precedes diagnostic getters');
      if (selected === 'callback-capture') {
        primary.cacheOwnershipReleased = () => true;
        assert.equal(failure.cacheOwnershipReleased(), false, 'captured callback survives public replacement');
      }
      await rejected(() => queue.flushBuildState(root));
      await rejected(() => queue.queueStatePatch(root, { stage: 'must-not-admit' }, [], { durabilityClass: 'required' }));
      assert.equal(calls, 1); ready = true;
    } else assert.equal(failure, primary);
    await queue.flushBuildState(root); await clock.settle();
    assert.equal(calls, 2); assert.equal(state.retained.length, 4096);
    assert.equal(state.stage, selected === 'detached' ? 'last' : 'original');
    assert.deepEqual(events, selected === 'detached' ? ['old', 'next', 'last'] : ['old']);
    assert.equal(writes.length, 2, 'explicit recovery writes once after original owners settle');
  }
  await clock.settle(); assert.equal(clock.timers.size, 0, 'all waiter and pending timers are retired');
} finally { ready = true; release(); await clock.settle(); restoreLogs(); clock.restore(); }
console.log(`Build-state queue original ownership: ${selected}`);
