import { currentSchedulerTaskLease, withSchedulerCpuSuspended } from '../../../shared/concurrency/scheduler-task-scope.js';
import { throwIfAborted } from '../../../shared/abort.js';

/** The existing file-local parser chain serializes runtime access. Only its
 * predecessor wait suspends CPU; the admitted continuation executes the parser.
 * Each slot retires after execution, failure or canceled reacquisition. */
export const createFileSerialCompute = () => {
  let tail = null;
  return async operation => {
    if (typeof operation !== 'function') throw new TypeError('Serial file compute requires a function.');
    const lease = currentSchedulerTaskLease();
    if (lease && !lease.active) throw Object.assign(new Error('Scheduler task retired before serial file compute.'), {
      code: 'ERR_SCHEDULER_TASK_RETIRED'
    });
    const previous = tail;
    let retire;
    const slot = new Promise(resolve => { retire = resolve; });
    tail = slot;
    try {
      if (previous) await withSchedulerCpuSuspended(() => previous);
      throwIfAborted(lease?.signal);
      if (lease && !(lease.used.cpu > 0)) throw Object.assign(new Error('Serial file compute requires active CPU admission.'), {
        code: 'ERR_SCHEDULER_COMPUTE_NOT_ADMITTED'
      });
      return await operation();
    } finally {
      retire();
      if (tail === slot) tail = null;
    }
  };
};
