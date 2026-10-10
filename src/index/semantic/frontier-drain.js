import { throwIfAborted } from '../../shared/abort.js';
/** Explicit bounded drain; callers provide existing scheduler and whole-generation publisher. */
export const drainSemanticFrontier = async ({ control, scheduler, baseBuildId, owner,
  handlers, publishGeneration, verifyPublication, findPublished = async () => null,
  dependencyHashes = new Map(), maxTasks = 16, maxMs = 30000, leaseMs = 60000,
  resources = { cpu: 1, io: 1, mem: 1, bytes: 1048576 }, signal = null, now = () => Date.now() }) => {
  if (!control?.available) return { status: 'unavailable', reason: 'sqlite_control_store_unavailable', completed: 0 };
  if (!Number.isSafeInteger(maxTasks) || maxTasks < 0 || maxTasks > 128
    || !Number.isSafeInteger(maxMs) || maxMs < 0 || !Number.isSafeInteger(leaseMs) || leaseMs <= maxMs) {
    throw new TypeError('Invalid bounded semantic drain allowance.');
  }
  if (typeof scheduler?.schedule !== 'function' || typeof publishGeneration !== 'function' || typeof verifyPublication !== 'function') {
    throw new TypeError('Existing scheduler and verified whole-generation publisher are required.');
  }
  const started = now();
  const result = { status: 'complete', completed: 0, failed: 0, recovered: 0, taskIds: [] };
  for (let count = 0; count < maxTasks && now() - started < maxMs; count += 1) {
    throwIfAborted(signal);
    const [lease] = control.leaseReady({ baseBuildId, owner, now: now(), leaseMs, limit: 1, dependencyHashes });
    if (!lease) break;
    const task = lease.descriptor;
    result.taskIds.push(task.taskId);
    try {
      const existing = await findPublished({ task, inputHash: lease.inputHash });
      if (existing) {
        await control.acknowledgePublished({ taskId: task.taskId, owner, publication: existing, verifyPublication, now });
        result.completed += 1; result.recovered += 1; continue;
      }
      const handler = handlers[task.kind];
      if (typeof handler !== 'function') throw Object.assign(new Error('Semantic task implementation unavailable.'), { code: 'ERR_SEMANTIC_TASK_UNSUPPORTED' });
      const output = await scheduler.schedule('relations', { ...resources, signal }, async () => {
        throwIfAborted(signal);
        return handler({ task, inputHash: lease.inputHash, signal });
      });
      throwIfAborted(signal);
      control.renew({ taskId: task.taskId, owner, now: now(), leaseMs });
      const publication = await publishGeneration({ task, inputHash: lease.inputHash, output, signal });
      await control.acknowledgePublished({ taskId: task.taskId, owner, publication, verifyPublication, now });
      result.completed += 1;
    } catch (error) {
      const aborted = signal?.aborted === true;
      try {
        control.release({ taskId: task.taskId, owner, now: now(), reason: error.code || error.message,
          transient: error.transient === true, cancelled: aborted });
      } catch (leaseError) {
        if (leaseError.code !== 'ERR_SEMANTIC_LEASE_LOST') throw leaseError;
      }
      result.failed += 1; result.status = 'partial';
      if (aborted) throw error;
    }
  }
  if (result.taskIds.length === maxTasks || now() - started >= maxMs) result.status = 'partial';
  return result;
};
