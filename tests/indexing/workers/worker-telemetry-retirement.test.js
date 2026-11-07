import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkerProcessCoordinator, WORKER_DIAGNOSTIC_LIMIT } from '../../../src/index/build/workers/pool/worker-coordination.js';

// UNVALIDATED: actual coordinator/event owners with inert pools. No workers,
// index, native parser or benchmark is started by this fixture.
const now = Date.now;
let clock = 1700000000000, tasks = 0, seconds = 0, gaugeSamples = 0;
Date.now = () => (clock += 26);
try {
  const coordinator = createWorkerProcessCoordinator({ poolLabel: 'tokenize', normalizedStage: 'stage1',
    crashLogger: { enabled: false }, withPooledPayloadMeta: (_pool, assign, consume) => {
      const labels = {}; assign(labels); return consume(labels);
    },
    observeWorkerTaskDuration: input => { tasks++; seconds += input.seconds; },
    setStageGcPressure() {}, setWorkerGcPressure: input => {
      gaugeSamples++; assert.equal(input.worker, 'all'); assert.equal(input.value, 0.5);
    },
    readProcessPressureSample: () => ({ heapUtilization: 0.25, rssPressure: 0.5, pressureRatio: 0.5 }),
    updatePressureState() {}, maybeReduceWorkersOnPressure: async () => {}
  });
  coordinator.setNumaPinningPlan({ active: true, assignments: [0, 1], nodeCount: 2 });
  const pool = new EventEmitter(); pool.threads = [];
  coordinator.attachPoolListeners(pool);
  const create = (id, target = pool) => {
    const worker = new EventEmitter(); worker.threadId = id; target.threads.push(worker);
    target.emit('workerCreate', worker); return worker;
  };
  const task = (worker, target = pool) => {
    target.emit('message', { type: 'worker-runtime', threadId: worker.threadId, observation: { id: worker.threadId } });
    target.emit('message', { type: 'worker-task-start', threadId: worker.threadId });
    target.emit('message', { type: 'worker-task', threadId: worker.threadId, task: 'tokenize', status: 'ok', durationMs: 125 });
  };
  for (let index = 1; index <= 2048; index++) {
    const worker = create(index); task(worker);
    assert.equal(coordinator.gcPressureStats().workers.length, 1);
    assert.equal(coordinator.runtimeObservationStats(pool).length, 1);
    pool.threads = []; worker.emit('exit', 0);
    assert.deepEqual(coordinator.gcPressureStats().workers, []);
    assert.deepEqual(coordinator.runtimeObservationStats(pool), []);
    assert.equal(coordinator.getNumaAssignmentMap().size, 0, 'retirement is independent of crash logging');
  }
  assert.equal(tasks, 2048); assert.equal(seconds, 256); assert.equal(gaugeSamples, 2048);
  assert.equal(coordinator.busyStats(pool).completedTasks, 2048);
  assert.equal(coordinator.busyStats(pool).workerWallMs, 256000, 'retirement preserves lifetime completed work');

  for (let index = 1; index <= WORKER_DIAGNOSTIC_LIMIT + 32; index++) task(create(3000 + index));
  assert.equal(coordinator.gcPressureStats().workers.length, WORKER_DIAGNOSTIC_LIMIT);
  assert.equal(coordinator.runtimeObservationStats(pool).length, WORKER_DIAGNOSTIC_LIMIT);
  pool.threads = [];
  assert.deepEqual(coordinator.gcPressureStats().workers, [], 'inventory pruning covers missed initial workerCreate/exit hooks');
  assert.deepEqual(coordinator.runtimeObservationStats(pool), []);

  const oldWorker = create(7); task(oldWorker);
  const replacement = new EventEmitter(); replacement.threads = [];
  const completed = coordinator.busyStats(pool).completedTasks;
  coordinator.attachPoolListeners(replacement);
  assert.deepEqual(coordinator.gcPressureStats().workers, []);
  const newWorker = create(7, replacement); task(newWorker, replacement);
  oldWorker.emit('exit', 1);
  task(oldWorker, pool);
  assert.equal(coordinator.gcPressureStats().workers.length, 1, 'old pool exit cannot retire replacement same-number identity');
  assert.equal(coordinator.runtimeObservationStats(replacement).length, 1);
  assert.equal(coordinator.busyStats(replacement).completedTasks, completed + 1, 'stale pool messages do not add work');
  assert.equal(coordinator.getNumaAssignmentMap().size, 1);
  replacement.threads = []; newWorker.emit('exit', 1);
  assert.deepEqual(coordinator.gcPressureStats().workers, []);
  assert.equal(coordinator.getNumaAssignmentMap().size, 0);
} finally { Date.now = now; }
console.log('bounded active worker diagnostics, retirement and lifetime totals controls passed');
