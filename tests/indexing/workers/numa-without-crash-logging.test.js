import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createWorkerProcessCoordinator } from '../../../src/index/build/workers/pool/worker-coordination.js';
for (const crashLogger of [null, { enabled: false, logError: () => assert.fail('disabled crash logger invoked') }]) {
  const coordinator = createWorkerProcessCoordinator({ crashLogger });
  coordinator.setNumaPinningPlan({ active: true, assignments: [0, 1], nodeCount: 2 });
  const pool = new EventEmitter();
  coordinator.attachPoolListeners(pool);
  const workers = [7, 8, 9].map(threadId => Object.assign(new EventEmitter(), { threadId }));
  for (const worker of workers) pool.emit('workerCreate', worker);
  assert.deepEqual([...coordinator.getNumaAssignmentMap()], [[7, 0], [8, 1], [9, 0]],
    'creation telemetry interleaves independently of crash logging');
  workers[0].emit('exit', 0);
  workers[1].emit('exit', 1);
  assert.deepEqual([...coordinator.getNumaAssignmentMap()], [[9, 0]], 'both clean and failed exits retire assignments');
  workers[2].emit('exit', 0);
  assert.equal(coordinator.getNumaAssignmentMap().size, 0);
  coordinator.setNumaPinningPlan({ active: false, assignments: [0, 1] });
  pool.emit('workerCreate', Object.assign(new EventEmitter(), { threadId: 10 }));
  assert.equal(coordinator.getNumaAssignmentMap().size, 0, 'disabled pinning does not invent assignments');
}
console.log('NUMA lifecycle telemetry without crash logging passed');
