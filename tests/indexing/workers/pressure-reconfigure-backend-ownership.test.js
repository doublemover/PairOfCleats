import assert from 'node:assert/strict';
import { createWorkerPoolLifecycle } from '../../../src/index/build/workers/pool/lifecycle.js';

// AUTHORED actual lifecycle-controller control; backend/native checks are deferred.
let backendTasks = 0, pendingRequests = 2, destroyed = 0, created = 0;
const originalNow = Date.now;
let now = originalNow(); Date.now = () => now;
const lifecycle = createWorkerPoolLifecycle({ configuredMaxWorkers: 3, downscaleMinWorkers: 1,
  downscaleCooldownMs: 0, getActiveTasks: () => backendTasks,
  shouldDownscaleWorkersForPressure: () => true, createPool: () => {
    created++; return { threads: [], destroy: async () => { destroyed++; } };
  } });
try {
  lifecycle.initialize();
  await lifecycle.maybeReduceWorkersOnPressure({ rssPressure: 1, gcPressure: 1 });
  assert.equal(pendingRequests, 2);
  assert.equal(destroyed, 1, 'throttle waiters do not keep idle backend capacity alive');
  now += 100;
  assert.equal(await lifecycle.ensurePool(), true, 'pre-dispatch requester is not mistaken for executing backend work');
  assert.equal(created, 2);
  backendTasks = 1;
  await lifecycle.maybeReduceWorkersOnPressure({ rssPressure: 1, gcPressure: 1 });
  assert.equal(destroyed, 1, 'actual dispatched work retains original backend until settlement');
  backendTasks = 0;
  await lifecycle.handleTaskDrained();
  assert.equal(destroyed, 2);
  pendingRequests = 0;
  now += 100; await lifecycle.ensurePool();
} finally { backendTasks = 0; await lifecycle.destroy(); Date.now = originalNow; }
console.log('pressure restart distinguishes queued requests from actual backend ownership');
