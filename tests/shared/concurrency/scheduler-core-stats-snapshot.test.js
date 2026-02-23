#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
  buildSchedulerAdaptivePayload,
  buildSchedulerAdaptiveSurfaceStats,
  buildSchedulerQueueStatsSnapshot,
  buildSchedulerStatsPayload,
  cloneSchedulerSystemSignals,
  resolveSchedulerUtilization
} from '../../../src/shared/concurrency/scheduler-core-stats.js';
import { ensureTestingEnv } from '../../helpers/test-env.js';

ensureTestingEnv(process.env);

const queueOrder = [
  {
    name: 'stage1',
    surface: 'cpu',
    pending: [{ enqueuedAt: 1000 }],
    pendingBytes: 128,
    running: 2,
    inFlightBytes: 256,
    maxPending: 10,
    maxPendingBytes: 1024,
    maxInFlightBytes: 4096,
    floorCpu: 1,
    floorIo: 0,
    floorMem: 1,
    priority: 10,
    weight: 2,
    stats: {
      scheduled: 5,
      started: 4,
      completed: 3,
      failed: 1,
      rejected: 0,
      rejectedMaxPending: 0,
      rejectedMaxPendingBytes: 0,
      starvation: 0,
      lastWaitMs: 10,
      waitP95Ms: 25,
      waitSamples: [10, 20, 25]
    }
  },
  {
    name: 'write',
    surface: 'io',
    pending: [],
    pendingBytes: 0,
    running: 1,
    inFlightBytes: 512,
    maxPending: 5,
    maxPendingBytes: 512,
    maxInFlightBytes: 2048,
    floorCpu: 0,
    floorIo: 1,
    floorMem: 0,
    priority: 20,
    weight: 1,
    stats: {
      scheduled: 2,
      started: 2,
      completed: 2,
      failed: 0,
      rejected: 0,
      rejectedMaxPending: 0,
      rejectedMaxPendingBytes: 0,
      starvation: 0,
      lastWaitMs: 2,
      waitP95Ms: 4,
      waitSamples: []
    }
  }
];

const snapshot = buildSchedulerQueueStatsSnapshot({
  queueOrder,
  nowMs: () => 2000,
  normalizeByteCount: (value) => Number(value) || 0
});

assert.equal(snapshot.activity.pending, 1);
assert.equal(snapshot.activity.pendingBytes, 128);
assert.equal(snapshot.activity.running, 3);
assert.equal(snapshot.activity.inFlightBytes, 768);
assert.equal(snapshot.queueStats.stage1.oldestWaitMs, 1000);
assert.equal(snapshot.queueStats.stage1.waitSampleCount, 3);
assert.equal(snapshot.queueStats.write.pending, 0);

assert.equal(resolveSchedulerUtilization(5, 10), 0.5);
assert.equal(resolveSchedulerUtilization(5, 0), 0);
assert.equal(resolveSchedulerUtilization(20, 10), 1);

const adaptiveSurfaceStates = new Map([
  ['io', {
    minConcurrency: 1,
    maxConcurrency: 8,
    currentConcurrency: 4,
    decisions: { up: 2, down: 1 },
    lastAction: 'scale-up',
    lastDecisionAt: 1700000000000,
    lastDecision: { reason: 'pressure' }
  }]
]);
const adaptiveStats = buildSchedulerAdaptiveSurfaceStats({
  adaptiveSurfaceStates,
  buildAdaptiveSurfaceSnapshotByName: (surfaceName) => ({ surfaceName, pending: 3 })
});
assert.deepEqual(adaptiveStats.io.snapshot, { surfaceName: 'io', pending: 3 });
assert.equal(adaptiveStats.io.currentConcurrency, 4);
assert.deepEqual(buildSchedulerAdaptiveSurfaceStats({
  adaptiveSurfaceStates: new Map(),
  buildAdaptiveSurfaceSnapshotByName: () => ({})
}), {});

const clonedSignals = cloneSchedulerSystemSignals({
  cpu: { utilization: 0.8 },
  memory: { rssMb: 1024 }
});
assert.deepEqual(clonedSignals, {
  cpu: { utilization: 0.8 },
  memory: { rssMb: 1024 }
});
assert.equal(cloneSchedulerSystemSignals(null), null);

const adaptivePayload = buildSchedulerAdaptivePayload({
  adaptiveEnabled: true,
  baselineLimits: { cpu: 2, io: 2, mem: 2 },
  maxLimits: { cpu: 4, io: 4, mem: 4 },
  adaptiveTargetUtilization: 0.75,
  adaptiveStep: 1,
  adaptiveMemoryReserveMb: 512,
  adaptiveMemoryPerTokenMb: 16,
  globalMaxInFlightBytes: 1024,
  adaptiveCurrentIntervalMs: 400,
  adaptiveMode: 'aggressive',
  smoothedUtilization: 0.5,
  smoothedPendingPressure: 0.2,
  smoothedStarvation: 0.1,
  adaptiveSurfaceControllersEnabled: true,
  adaptiveSurfaces: adaptiveStats,
  adaptiveDecisionTrace: [{ id: 1 }],
  cloneDecisionEntry: (entry) => ({ ...entry, cloned: true }),
  lastSystemSignals: { cpu: { load: 0.8 }, memory: { rssMb: 500 } },
  cloneSchedulerSystemSignals,
  evaluateWriteBackpressure: () => ({ blocked: false }),
  writeBackpressure: { producerQueues: new Set(['stage1']) }
});
assert.equal(adaptivePayload.enabled, true);
assert.equal(adaptivePayload.decisionTrace[0].cloned, true);
assert.deepEqual(adaptivePayload.writeBackpressure.producerQueues, ['stage1']);

const statsPayload = buildSchedulerStatsPayload({
  queueStats: snapshot.queueStats,
  activity: snapshot.activity,
  counters: {
    scheduled: 5,
    rejected: 1,
    rejectedByReason: { maxPending: 1, maxPendingBytes: 0, cleared: 0, shutdown: 0 }
  },
  adaptive: adaptivePayload,
  utilization: { cpu: 0.5, io: 0.25, mem: 0.75 },
  tokens: {
    cpu: { total: 4, used: 2 },
    io: { total: 4, used: 1 },
    mem: { total: 4, used: 3 }
  },
  telemetry: { stage: 'stage1', traceIntervalMs: 1000 }
});
assert.equal(statsPayload.utilization.overall, 0.75);
assert.equal(statsPayload.counters.rejectedByReason.maxPending, 1);
assert.equal(statsPayload.tokens.mem.used, 3);

console.log('scheduler core stats snapshot test passed');
