import assert from 'node:assert/strict';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { advisePhysicalWorkGraph, scheduleAdvisedBaseline } from '../../../src/index/build/runtime/physical-work-advisor.js';

const identity = { worldRoot: 'world', hardwareId: 'fixture-cpu', runtimeId: 'node-fixture', providerId: 'scalar', configId: 'config' };
const calibration = (id, implementationId, interval) => ({ id, identity, implementationId, shapeId: 'tiny',
  observedAt: 10, expiresAt: 100, coverage: 'representative-complete', evidenceRef: 'fixture-observation:' + id, totalMilliseconds: interval });
const alternative = (id, implementationId, calibrationId, contractId = 'exact') => ({ id, implementationId, calibrationId,
  contractId, requires: ['cpu'], resources: { cpu: 1, io: 0, mem: 1, bytes: 64 } });
const node = (id, predecessors) => ({ id, predecessors, contractId: 'exact', inputRoots: ['input'], shapeId: 'tiny', baselineId: 'baseline',
  alternatives: [alternative('baseline', 'scalar', 'slow'), alternative('fast', 'blocked', 'fast'),
    alternative('lossy', 'lossy', 'very-fast', 'approximate')] });
const args = { identity, capabilities: ['cpu'], now: 20,
  calibrations: [calibration('slow', 'scalar', [10, 20]), calibration('fast', 'blocked', [3, 5]), calibration('very-fast', 'lossy', [1, 2])],
  nodes: [node('prepare', []), node('consume', ['prepare'])] };
const plan = advisePhysicalWorkGraph(args);
assert.equal(plan.nodes[0].shadowPreferredId, 'fast');
assert.equal(plan.nodes[0].effectiveId, 'baseline');
assert.deepEqual(plan.serialBaselineMilliseconds, [20, 40]);
assert.deepEqual(plan.dependencyPathMilliseconds, [20, 40]);
assert.equal(plan.nodes[0].alternatives[2].legalCandidate, false);
const independent = advisePhysicalWorkGraph({ ...args, nodes: [node('a', []), node('b', [])] });
assert.deepEqual(independent.serialBaselineMilliseconds, [20, 40]);
assert.deepEqual(independent.dependencyPathMilliseconds, [10, 20]);
assert.equal(independent.overlap, 'not-qualified');
assert.equal(advisePhysicalWorkGraph({ ...args, now: 200 }).serialBaselineMilliseconds, null);
assert.equal(advisePhysicalWorkGraph({ ...args, calibrations: args.calibrations.map(row => ({ ...row, coverage: 'partial' })) })
  .nodes[0].shadowPreferredId, 'baseline');
assert.throws(() => advisePhysicalWorkGraph({ ...args, nodes: [node('later', ['missing'])] }), /topologically/);
assert.throws(() => advisePhysicalWorkGraph({ ...args, capabilities: [] }), /legal baseline/);

const scheduler = createBuildScheduler({ cpuTokens: 1, ioTokens: 1, memoryTokens: 1, maxInFlightBytes: 64 });
const controller = new AbortController();
let releases = 0, starts = 0, finishNative, noteStarted;
const nativeDone = new Promise(resolve => { finishNative = resolve; });
const started = new Promise(resolve => { noteStarted = resolve; });
const operators = new Map([['scalar', { contractId: 'exact', start: () => {
  starts++; noteStarted(); return { completion: nativeDone, releaseWorking: async () => { releases++; } };
} }], ['blocked', { contractId: 'exact', start: () => { throw new Error('Shadow candidate must not execute'); } }]]);
try {
  await assert.rejects(scheduleAdvisedBaseline({ plan, nodeId: 'consume', scheduler, queueName: 'cpu', operators,
    signal: controller.signal }), /predecessor/);
  const execution = scheduleAdvisedBaseline({ plan, nodeId: 'prepare', scheduler, queueName: 'cpu', operators,
    signal: controller.signal });
  const rejection = assert.rejects(execution, error => error.name === 'AbortError');
  await started;
  controller.abort();
  assert.equal(releases, 0, 'cancellation cannot release working bytes before actual completion');
  finishNative('completed-native-output'); await rejection;
  assert.equal(releases, 1); assert.equal(starts, 1);
  const nextController = new AbortController();
  const completedOperators = new Map([['scalar', { contractId: 'exact', start: () => ({ completion: Promise.resolve('value'),
    releaseWorking: () => { releases++; } }) }]]);
  const prepare = await scheduleAdvisedBaseline({ plan, nodeId: 'prepare', scheduler, queueName: 'cpu', operators: completedOperators, signal: nextController.signal });
  assert.equal(prepare.receipt.effectiveImplementation, 'scalar');
  assert.equal(prepare.receipt.shadowPreferredId, 'fast');
  await assert.rejects(scheduleAdvisedBaseline({ plan, nodeId: 'consume', scheduler, queueName: 'cpu', operators: completedOperators,
    signal: nextController.signal, predecessorReceipts: [{ ...prepare.receipt }] }), /predecessor/);
  const consume = await scheduleAdvisedBaseline({ plan, nodeId: 'consume', scheduler, queueName: 'cpu', operators: completedOperators,
    signal: nextController.signal, predecessorReceipts: [prepare.receipt] });
  assert.equal(consume.result, 'value');
  const primary = new Error('baseline failed'), secondary = new Error('working release failed');
  await assert.rejects(scheduleAdvisedBaseline({ plan, nodeId: 'prepare', scheduler, queueName: 'cpu',
    operators: new Map([['scalar', { contractId: 'exact', start: () => ({
      completion: Promise.reject(primary), releaseWorking: () => { throw secondary; }
    }) }]]) }), error => error === primary && error.cleanupError === secondary,
  'working release cannot replace the actual operator failure');
} finally { await scheduler.shutdown({ awaitRunning: true }); }
console.log('shadow physical work and scheduler completion contract passed');
