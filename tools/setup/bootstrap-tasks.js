import { createBuildScheduler } from '../../src/shared/concurrency/scheduler-core.js';
import { readEffectiveCpu } from '../../src/shared/effective-cpu.js';
import { readEffectiveMemory } from '../../src/shared/effective-memory.js';

const MIB = 1024 * 1024;

/** Uses existing npm jobs input; introduces no application config/CLI surface. */
export const resolveBootstrapBudget = ({ env = process.env, cpu = readEffectiveCpu(), memory = readEffectiveMemory(),
  maxJobs = 4, bytesPerJob = 256 * MIB } = {}) => {
  const requested = env.npm_config_jobs ?? env.NPM_CONFIG_JOBS;
  if (requested != null && !/^[1-9]\d*$/.test(String(requested))) {
    throw new Error('Bootstrap npm_config_jobs must be a positive integer.');
  }
  if (!Number.isFinite(cpu.cpuCount) || cpu.cpuCount < 1
    || !Number.isFinite(memory.freeBytes) || memory.freeBytes < 0
    || !Number.isSafeInteger(maxJobs) || maxJobs < 1
    || !Number.isSafeInteger(bytesPerJob) || bytesPerJob < 1) {
    throw new Error('Invalid bootstrap resource inventory.');
  }
  const memoryBytes = Math.floor(Math.max(0, memory.freeBytes) * 0.5);
  if (memoryBytes < bytesPerJob) throw new Error('Insufficient available memory for one bounded bootstrap task.');
  const cpuCount = Math.min(Math.floor(cpu.cpuCount), Math.floor(memoryBytes / bytesPerJob),
    requested == null ? Number.MAX_SAFE_INTEGER : Number(requested));
  const jobs = Math.min(cpuCount, maxJobs, Math.floor(memoryBytes / bytesPerJob),
    requested == null ? maxJobs : Number(requested));
  return Object.freeze({ jobs, cpuCount, memoryBytes, compilerJobs: Math.max(1, Math.floor(cpuCount / jobs)),
    cpuMethod: cpu.method, memoryMethod: memory.method });
};

const dependency = value => typeof value === 'string' ? { id: value, settled: false } : value;

/** Finite setup dependency orchestration over the existing resource scheduler.
 * Package exclusivity is expressed by dependencies and full-budget tasks; this
 * owner never runs concurrent root npm mutations. */
export const runBootstrapTasks = async (tasks, { budget = resolveBootstrapBudget(), signal = null,
  onResult = () => {}, stopOnRequiredFailure = true } = {}) => {
  const byId = new Map();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || byId.has(task.id) || typeof task.run !== 'function') {
      throw new Error('Bootstrap tasks require unique nonempty identities and executable owners.');
    }
    byId.set(task.id, task);
  }
  const visited = new Set(), visiting = new Set();
  const validate = task => {
    if (visited.has(task.id)) return;
    if (visiting.has(task.id)) throw new Error(`Bootstrap dependency cycle: ${task.id}`);
    visiting.add(task.id);
    for (const entry of task.dependsOn || []) {
      const dep = dependency(entry);
      if (!dep || !byId.has(dep.id)) throw new Error(`Missing bootstrap dependency for ${task.id}: ${dep?.id}`);
      validate(byId.get(dep.id));
    }
    const cpu = task.exclusive ? budget.cpuCount : (task.cpu ?? 1);
    const bytes = task.exclusive ? budget.memoryBytes : (task.bytes ?? 1);
    if (!Number.isSafeInteger(cpu) || cpu <= 0 || cpu > budget.cpuCount
      || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > budget.memoryBytes) {
      throw new Error(`Bootstrap task exceeds the admitted resource budget: ${task.id}`);
    }
    visiting.delete(task.id); visited.add(task.id);
  };
  tasks.forEach(validate);
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener('abort', abort, { once: true });
  const scheduler = createBuildScheduler({
    enabled: true, cpuTokens: budget.cpuCount, ioTokens: budget.jobs, memoryTokens: budget.jobs,
    maxInFlightBytes: budget.memoryBytes,
    queues: { bootstrap: { concurrency: budget.jobs, maxPending: Math.max(1, tasks.length),
      maxInFlightBytes: budget.memoryBytes } }, traceMaxSamples: Math.max(1, tasks.length * 2)
  });
  const promises = new Map();
  let observerError = null;
  const execute = task => {
    if (promises.has(task.id)) return promises.get(task.id);
    const pending = (async () => {
      const dependencies = await Promise.all((task.dependsOn || []).map(entry => execute(byId.get(dependency(entry).id))));
      const blocked = dependencies.some((result, index) => result.status !== 'succeeded'
        && !dependency(task.dependsOn[index]).settled);
      const row = { id: task.id, required: task.required !== false, status: 'pending', startedAt: null,
        finishedAt: null, durationMs: null, result: null, error: null };
      if (blocked) row.status = 'blocked';
      else if (controller.signal.aborted) row.status = 'cancelled';
      else {
        try {
          row.result = await scheduler.schedule('bootstrap', {
            cpu: task.exclusive ? budget.cpuCount : (task.cpu ?? 1), io: 1, mem: 1,
            bytes: task.exclusive ? budget.memoryBytes : (task.bytes ?? 1), signal: controller.signal
          }, async () => {
            row.startedAt = Date.now();
            const result = await task.run({ signal: controller.signal,
              compilerJobs: task.exclusive ? budget.cpuCount : (task.cpu ?? 1) });
            if (result?.ok === false) {
              throw Object.assign(new Error(result.message || `${task.id} failed`), { result });
            }
            return result;
          });
          row.status = 'succeeded';
        } catch (error) {
          row.status = controller.signal.aborted && error?.name === 'AbortError' ? 'cancelled' : 'failed';
          row.result = error.result || null;
          row.error = error;
          if (row.required && stopOnRequiredFailure && !controller.signal.aborted) controller.abort(error);
        }
      }
      row.finishedAt = Date.now();
      row.durationMs = row.startedAt == null ? 0 : Math.max(0, row.finishedAt - row.startedAt);
      try { onResult(row); } catch (error) {
        observerError ||= error;
        controller.abort(error);
      }
      return row;
    })();
    promises.set(task.id, pending);
    return pending;
  };
  try {
    const results = await Promise.all(tasks.map(execute));
    if (observerError) throw observerError;
    return { ok: results.every(row => !row.required || row.status === 'succeeded'), results, budget };
  } finally {
    signal?.removeEventListener?.('abort', abort);
    await scheduler.shutdown({ awaitRunning: true, timeoutMs: 30000 });
  }
};
