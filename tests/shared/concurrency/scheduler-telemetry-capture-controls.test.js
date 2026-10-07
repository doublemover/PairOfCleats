import assert from 'node:assert/strict';
import { createSchedulerTelemetryCapture } from '../../../src/shared/concurrency/scheduler-core-telemetry-capture.js';

let clock = 0;
let clockReads = 0;
let queueReads = 0;
let tokenCopies = 0;
let backpressureCalls = 0;
let snapshotsEnabled = false;
let changeQueue = false;
const pending = [{}];
const queue = { name: 'fixture', pendingBytes: 4, running: 1, inFlightBytes: 8,
  get pending() { queueReads += 1; return pending; } };
const capture = createSchedulerTelemetryCapture({
  nowMs: () => { clockReads += 1; return clock; }, startedAtMs: 0,
  queueOrder: [queue], getStage: () => 'fixture-stage',
  getTraceIntervalMs: () => 1000, getQueueDepthSnapshotIntervalMs: () => 2000,
  traceMaxSamples: 16, queueDepthSnapshotMaxSamples: 16,
  isQueueDepthSnapshotsEnabled: () => snapshotsEnabled,
  cloneTokenState: () => { tokenCopies += 1; return { cpu: { total: 2, used: 1 }, io: {}, mem: {} }; },
  evaluateWriteBackpressure: () => {
    backpressureCalls += 1;
    if (changeQueue) { pending.push({}); changeQueue = false; }
    return { active: false };
  }
});

// A bounded operation control, not a timing benchmark: unsampled polls must not
// walk queues or copy token state, even when snapshot capture is disabled.
for (let i = 1; i <= 100; i += 1) {
  clock = i * 10;
  capture.captureTelemetryIfDue('poll');
}
assert.equal(clockReads, 100, 'one shared clock read per poll');
assert.equal(queueReads, 1);
assert.equal(tokenCopies, 1);
assert.equal(backpressureCalls, 1);
assert.equal(capture.getSchedulingTrace().length, 1);
assert.equal(capture.getQueueDepthSnapshots().length, 0);

clock = 2000;
snapshotsEnabled = true;
changeQueue = true;
capture.captureTelemetryIfDue('changed');
assert.equal(clockReads, 101);
const trace = capture.getSchedulingTrace().at(-1);
const snapshot = capture.getQueueDepthSnapshots().at(-1);
assert.equal(trace.at, snapshot.at);
assert.equal(trace.stage, 'fixture-stage');
assert.equal(trace.reason, 'changed');
assert.equal(trace.activity.pending, 1);
assert.equal(snapshot.pending, 2, 'separate live snapshots preserve callback-visible changes');
assert.equal(queueReads, 3);
assert.equal(tokenCopies, 2);
assert.equal(backpressureCalls, 2);

const getterOrder = [];
const forced = capture.captureSchedulingTrace({
  get now() { getterOrder.push('now'); return 2060; },
  get reason() { getterOrder.push('reason'); return 'forced'; },
  get force() { getterOrder.push('force'); return true; }
});
assert.deepEqual(getterOrder, ['now', 'reason', 'force']);
assert.equal(forced.reason, 'forced');
assert.equal(forced.activity.pending, 2);
assert.equal(clockReads, 101, 'explicit now avoids another clock read');
assert.equal(capture.captureQueueDepthSnapshot({ now: 2060, force: true }).pending, 2);
clock = 2500;
assert.equal(capture.captureSchedulingTrace(), null);
assert.equal(clockReads, 102, 'public default now is retained');
assert.throws(() => capture.captureSchedulingTrace(null), TypeError);

for (let i = 0; i < 20; i += 1) {
  capture.captureSchedulingTrace({ now: 3000 + i, reason: `forced-${i}`, force: true });
  capture.captureQueueDepthSnapshot({ now: 3000 + i, reason: `forced-${i}`, force: true });
}
for (const records of [capture.getSchedulingTrace(), capture.getQueueDepthSnapshots()]) {
  assert.equal(records.length, 16);
  assert.equal(records[0].reason, 'forced-4');
  assert.equal(records.at(-1).reason, 'forced-19');
}
snapshotsEnabled = false;
assert.equal(capture.captureQueueDepthSnapshot({ now: 6000, force: true }), null);
console.log('scheduler capture controls passed: unsampled queue-work gate, one clock/poll, live snapshot ordering, public defaults/getters/force and bounded records');
