import assert from 'node:assert/strict';
import { createPatchQueue } from '../../../src/index/build/build-state/patch-queue.js';
import { mergeState } from '../../../src/index/build/build-state/store.js';
import { startHeartbeat } from '../../../src/index/build/build-state/heartbeat.js';
import { setProgressHandlers } from '../../../src/shared/progress-runtime.js';

// Exercise the production queue and heartbeat against a virtual event loop.
// No production timer/clock override or wall-clock soak is needed.
const native = { now: Date.now, setTimeout, clearTimeout, setInterval, clearInterval };
let now = 1000000, sequence = 0;
const timers = new Map();
const addTimer = (callback, delay = 0, interval = false, args = []) => {
  const timer = { id: ++sequence, at: now + Math.max(0, delay), callback, args,
    interval: interval ? Math.max(1, delay) : null, unref() { return this; } };
  timers.set(timer.id, timer); return timer;
};
Date.now = () => now;
globalThis.setTimeout = (callback, delay, ...args) => addTimer(callback, delay, false, args);
globalThis.setInterval = (callback, delay, ...args) => addTimer(callback, delay, true, args);
globalThis.clearTimeout = globalThis.clearInterval = timer => timers.delete(timer?.id);
const settle = async () => { for (let step = 0; step < 80; step++) await Promise.resolve(); };
const advance = async milliseconds => {
  const target = now + milliseconds;
  let steps = 0;
  for (;;) {
    const next = [...timers.values()].filter(timer => timer.at <= target)
      .sort((left, right) => left.at - right.at || left.id - right.id)[0];
    if (!next) break;
    assert.ok(++steps < 1000, 'bounded virtual timer activity');
    now = next.at;
    if (next.interval) next.at += next.interval;
    else timers.delete(next.id);
    next.callback(...next.args); await settle();
  }
  now = target; await settle();
};
const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
const logs = [];
const restoreLogs = setProgressHandlers({ logLine(message, meta) { logs.push({ message, meta }); } });
const held = [];
try {
  const writes = [];
  let state = {}, inFlight = 0, peak = 0;
  const queue = createPatchQueue({ mergeState, recordStateError: error => { throw error; },
    applyStatePatch: async (_root, patch) => {
      peak = Math.max(peak, ++inFlight); await Promise.resolve();
      state = mergeState(state, patch); writes.push({ at: now, state }); inFlight--; return state;
    } });
  const root = 'virtual-live-state';
  const started = now;
  await queue.queueStatePatch(root, { progress: { code: 0, prose: 0 }, heartbeat: { sequence: 0 } }, [], { waitForFlush: false });
  for (let index = 1; index <= 60; index++) {
    await advance(100);
    await queue.queueStatePatch(root, { progress: { [index % 2 ? 'code' : 'prose']: index },
      heartbeat: { sequence: index } }, [], { waitForFlush: false });
  }
  assert.equal(writes.length, 3, 'continuous input flushes during each two-second window');
  assert.ok(writes.every((write, index) => write.at - (writes[index - 1]?.at ?? started) <= 2000));
  assert.equal(state.heartbeat.sequence, 59);
  await queue.flushBuildState(root); await settle();
  assert.equal(state.heartbeat.sequence, 60); assert.equal(state.progress.code, 59); assert.equal(state.progress.prose, 60);
  assert.equal(writes.length, 4); assert.equal(peak, 1); assert.equal(timers.size, 0);

  const gate = deferred(); held.push(gate);
  const slowWrites = [], slowEvents = [];
  let slowState = {}, active = 0, slowPeak = 0;
  const slow = createPatchQueue({ mergeState, recordStateError: error => { throw error; },
    applyStatePatch: async (_root, patch, events) => {
      slowPeak = Math.max(slowPeak, ++active); slowWrites.push(patch);
      if (slowWrites.length === 1) await gate.promise;
      slowState = mergeState(slowState, patch); slowEvents.push(...events); active--; return slowState;
    } });
  const slowRoot = 'virtual-slow-state', firstLogicalAt = now;
  await slow.queueStatePatch(slowRoot, { progress: { code: 0 }, original: true }, ['original'], { waitForFlush: false });
  await advance(500);
  const firstStartedAt = now;
  for (let index = 1; index <= 100; index++) {
    await advance(100);
    await slow.queueStatePatch(slowRoot, { progress: { code: index } }, [index], { waitForFlush: false });
  }
  const before = await slow.queueStatePatch(slowRoot, { heartbeat: { live: true } }, [], { waitForFlush: false });
  assert.equal(slowWrites.length, 1, 'slow storage retains one pending snapshot instead of detached write backlog');
  assert.equal(before.activeFlushes, 1);
  assert.equal(before.pendingLagMs, now - firstLogicalAt);
  assert.equal(before.activeWriteAgeMs, now - firstStartedAt);
  assert.equal(before.newestLogicalUpdateAgeMs, 0);
  gate.resolve(); await settle();
  const after = await slow.queueStatePatch(slowRoot, { heartbeat: { afterAck: true } }, [], { waitForFlush: false });
  assert.equal(after.oldestPendingAgeMs, now - firstStartedAt - 100);
  assert.equal(after.pendingLagMs, after.oldestPendingAgeMs, 'older acknowledgement cannot erase newer pending age');
  assert.equal(after.lastDurableAcknowledgementAtMs, now);
  assert.equal(after.lastDurableLogicalUpdateAtMs, firstLogicalAt);
  assert.ok(after.coalescedPatches >= 100);
  await advance(0); await slow.flushBuildState(slowRoot); await settle();
  assert.equal(slowWrites.length, 2); assert.equal(slowPeak, 1);
  assert.equal(slowState.progress.code, 100); assert.equal(slowState.original, true);
  assert.deepEqual(slowEvents, ['original', ...Array.from({ length: 100 }, (_, index) => index + 1)]);
  assert.equal(timers.size, 0);

  let attempts = 0, recovered = {}, recoveredEvents = [];
  const recovery = createPatchQueue({ mergeState, recordStateError: error => { throw error; },
    applyStatePatch: async (_root, patch, events) => {
      if (++attempts === 1) throw Object.assign(new Error('controlled lock pressure'), { code: 'ERR_BUILD_STATE_LOCK_UNAVAILABLE' });
      recovered = mergeState(recovered, patch); recoveredEvents.push(...events); return recovered;
    } });
  await recovery.queueStatePatch('virtual-recovery', { progress: { old: true } }, ['old'], { waitForFlush: false });
  await advance(500); assert.equal(attempts, 1);
  for (let index = 1; index <= 4; index++) {
    await advance(100);
    await recovery.queueStatePatch('virtual-recovery', { progress: { newest: index } }, [index], { waitForFlush: false });
  }
  await recovery.queueStatePatch('virtual-recovery', { stage: 'required' }, ['required'], { durabilityClass: 'required' });
  await recovery.flushBuildState('virtual-recovery'); await settle();
  assert.equal(attempts, 2); assert.deepEqual(recovered.progress, { old: true, newest: 4 });
  assert.deepEqual(recoveredEvents, ['old', 1, 2, 3, 4, 'required']);
  assert.equal(timers.size, 0);

  const heartbeatGate = deferred(); held.push(heartbeatGate);
  const heartbeatQueue = createPatchQueue({ mergeState, recordStateError: error => { throw error; },
    applyStatePatch: async () => { await heartbeatGate.promise; return {}; } });
  const originalWrite = heartbeatQueue.queueStatePatch('virtual-heartbeat', { stage: 'pending' }, [], { durabilityClass: 'required' });
  await settle(); await advance(50000);
  const stop = startHeartbeat({ buildRoot: 'virtual-heartbeat', stage: 'stage1', intervalMs: 5000,
    updateBuildStateOutcome: (buildRoot, patch, options) => heartbeatQueue.queueStatePatch(buildRoot, patch, [], options),
    flushBuildState: heartbeatQueue.flushBuildState, buildRootExists: async () => true });
  await settle();
  const warning = logs.find(entry => entry.meta?.buildState?.event === 'heartbeat-write-lag');
  assert.ok(warning, 'actual queue lag drives heartbeat durability warning');
  assert.equal(warning.meta.buildState.lagMs, 50000);
  heartbeatGate.resolve(); await originalWrite; await stop(); await settle();
  assert.equal(timers.size, 0, 'all per-batch timers and heartbeat lifetime are released');
} finally {
  for (const gate of held) gate.resolve();
  await settle(); restoreLogs();
  Date.now = native.now;
  globalThis.setTimeout = native.setTimeout; globalThis.clearTimeout = native.clearTimeout;
  globalThis.setInterval = native.setInterval; globalThis.clearInterval = native.clearInterval;
}
console.log('Build-state coalescing bounds live age and keeps durability telemetry with its owning batch.');
