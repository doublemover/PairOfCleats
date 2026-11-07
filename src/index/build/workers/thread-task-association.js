export const PISCINA_TASK_ASSOCIATION_VERSION = 1;
export const PISCINA_TASK_ASSOCIATION_DEPENDENCY = '5.3.2';

/** The documented queue-options/load-balancer interfaces identify dispatch,
 * while pool.threads and Node Worker's exit identify physical retirement.
 * At concurrentTasksPerWorker1 Piscina's default chooses the first idle worker.
 * Never inspect WorkerInfo, taskInfos, private symbols or replacement workers.
 */
export const createThreadTaskAssociation = ({ version, queueOptionsSymbol }) => {
  if (version !== PISCINA_TASK_ASSOCIATION_DEPENDENCY || typeof queueOptionsSymbol !== 'symbol') {
    throw Object.assign(new Error('Piscina task ownership requires the qualified 5.3.2 public dispatch interfaces; requalify dependency conformance.'), {
      code: 'ERR_WORKER_TASK_ASSOCIATION_UNSUPPORTED'
    });
  }
  const assignments = new WeakMap();
  return {
    prepare(payload, assign) {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new TypeError('Indexer thread payload must be a record.');
      const metadata = Object.freeze({ version: PISCINA_TASK_ASSOCIATION_VERSION });
      assignments.set(metadata, assign);
      return { payload: { ...payload, [queueOptionsSymbol]: metadata }, release: () => assignments.delete(metadata) };
    },
    loadBalancer(task, workers) {
      const assign = assignments.get(task[queueOptionsSymbol]);
      if (typeof assign !== 'function') throw Object.assign(new Error('Thread dispatch has no original task ownership token.'), {
        code: 'ERR_WORKER_TASK_ASSOCIATION_REQUIRED'
      });
      const worker = workers.find(candidate => candidate.currentUsage === 0) || null;
      if (worker) assign(worker.id);
      return worker;
    }
  };
};
