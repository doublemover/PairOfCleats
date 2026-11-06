import { createBuildScheduler } from '../../src/shared/concurrency/scheduler-core.js';
import { readEffectiveCpu } from '../../src/shared/effective-cpu.js';
import { readEffectiveMemory } from '../../src/shared/effective-memory.js';
import { readErrorDataProperty } from '../../src/shared/error-data.js';
import { observeStorageResource, createStorageObservationLedger } from '../../src/shared/storage/failure-observation.js';
import { addStorageFailureContext } from '../../src/shared/storage/operation-error.js';
import { createHash, randomUUID } from 'node:crypto';

const MIB = 1024 * 1024;
export const BOOTSTRAP_TASK_EVENT_VERSION = 1;
const eventErrorText = (error, key, limit) => {
  const value = readErrorDataProperty(error, key);
  return typeof value === 'string' ? value.slice(0, limit) : null;
};

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
  onResult = () => {}, onEvent = null, eventContext = {}, stopOnRequiredFailure = true } = {}) => {
  if (typeof onResult !== 'function') throw new TypeError('Bootstrap result observation requires a function.');
  if (onEvent !== null && typeof onEvent !== 'function') throw new TypeError('Bootstrap events require an explicit observer.');
  if (!Array.isArray(tasks) || tasks.length > 256) throw new TypeError('Bootstrap requires a finite task plan of at most 256 tasks.');
  const byId = new Map();
  for (const task of tasks) {
    if (!task || typeof task.id !== 'string' || !task.id || task.id.length > 256 || byId.has(task.id) || typeof task.run !== 'function') {
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
  const identity = Object.freeze({ runId: eventContext.runId ?? randomUUID(), batchId: randomUUID(), planId: eventContext.planId
    ?? createHash('sha256').update(JSON.stringify({ budget, tasks: tasks.map(task => ({ id: task.id,
      required: task.required !== false, dependsOn: task.dependsOn || [], exclusive: task.exclusive === true,
      cpu: task.cpu ?? 1, bytes: task.bytes ?? 1 })) })).digest('hex') });
  if (Object.values(identity).some(value => typeof value !== 'string' || !/^[a-zA-Z0-9._:-]{1,128}$/.test(value))) throw new TypeError(
    'Bootstrap event identities require bounded run and plan identifiers.');
  let sequence = 0;
  const runStartedAt = Date.now();
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
  const observerErrors = [];
  const observations = createStorageObservationLedger();
  let eventObserverFailed = false;
  const observeFailure = error => {
    observerErrors.push(error); observations.remember(error); controller.abort(error);
  };
  const emit = async (row, state, fields = {}) => {
    if (eventObserverFailed) return;
    const timestamp = Date.now();
    const event = Object.freeze({ schemaVersion: BOOTSTRAP_TASK_EVENT_VERSION, kind: 'bootstrap-task-event', ...identity, sequence: ++sequence,
      taskId: row.id, attempt: 1, required: row.required, state, timestamp,
      elapsedMs: Math.max(0, timestamp - runStartedAt), ...fields });
    try { await onEvent(event); } catch (error) { eventObserverFailed = true; observeFailure(error); }
  };
  const execute = task => {
    if (promises.has(task.id)) return promises.get(task.id);
    const pending = (async () => {
      const row = { id: task.id, required: task.required !== false, status: 'pending', queuedAt: Date.now(),
        admissionAt: null, dependencyWaitMs: 0, admissionWaitMs: null, startedAt: null,
        finishedAt: null, durationMs: null, result: null, error: null };
      let retirementPending = false, operationStarted = false;
      if (onEvent) await emit(row, 'queued');
      if (onEvent && task.dependsOn?.length) await emit(row, 'dependency-wait');
      const dependencyStartedAt = Date.now();
      const dependencies = await Promise.all((task.dependsOn || []).map(entry => execute(byId.get(dependency(entry).id))));
      row.dependencyWaitMs = task.dependsOn?.length ? Math.max(0, Date.now() - dependencyStartedAt) : 0;
      const blocked = dependencies.some((result, index) => result.status !== 'succeeded'
        && !dependency(task.dependsOn[index]).settled);
      if (blocked) row.status = 'blocked';
      else if (controller.signal.aborted) row.status = 'cancelled';
      else {
        try {
          if (onEvent) await emit(row, 'resource-wait');
          row.admissionAt = Date.now();
          row.result = await scheduler.schedule('bootstrap', {
            cpu: task.exclusive ? budget.cpuCount : (task.cpu ?? 1), io: 1, mem: 1,
            bytes: task.exclusive ? budget.memoryBytes : (task.bytes ?? 1), signal: controller.signal
          }, async () => {
            row.startedAt = Date.now();
            row.admissionWaitMs = Math.max(0, row.startedAt - row.admissionAt);
            if (onEvent) await emit(row, 'started');
            controller.signal.throwIfAborted();
            operationStarted = true;
            const result = await task.run({ signal: controller.signal,
              compilerJobs: task.exclusive ? budget.cpuCount : (task.cpu ?? 1) });
            if (result?.ok === false) {
              const original = Object.getOwnPropertyDescriptor(result, 'error');
              throw Object.assign(new Error(result.message || `${task.id} failed`,
                original && Object.hasOwn(original, 'value') ? { cause: original.value } : undefined), { result });
            }
            return result;
          });
          row.status = 'succeeded';
        } catch (error) {
          row.status = controller.signal.aborted && (!operationStarted || readErrorDataProperty(error, 'name') === 'AbortError') ? 'cancelled' : 'failed';
          row.result = readErrorDataProperty(error, 'result') ?? null;
          row.error = error;
          try { observeStorageResource(error, { phase: 'bootstrap-task-retirement' }).requireSettled(); }
          catch (pending) { retirementPending = true; row.error = pending; }
          observations.remember(row.error);
          if ((retirementPending || row.required && stopOnRequiredFailure) && !controller.signal.aborted) controller.abort(row.error);
        }
      }
      row.finishedAt = Date.now();
      row.durationMs = row.startedAt == null ? 0 : Math.max(0, row.finishedAt - row.startedAt);
      Object.freeze(row);
      if (onEvent) await emit(row, row.status, { durationMs: row.durationMs, dependencyWaitMs: row.dependencyWaitMs,
        admissionWaitMs: row.admissionWaitMs, taskResourceState: row.startedAt == null ? 'not-admitted' : retirementPending ? 'pending' : 'retired',
        error: row.status === 'failed' || row.status === 'cancelled' ? Object.freeze({
          code: eventErrorText(row.error, 'code', 96), message: eventErrorText(row.error, 'message', 1024)
        }) : null });
      // Observe the original callback's full settlement, including asynchronous
      // and falsy rejection. Diagnostic callbacks cannot rewrite task outcomes.
      try { await onResult(row); } catch (error) { observeFailure(error); }
      return row;
    })();
    promises.set(task.id, pending);
    return pending;
  };
  let results, primary, failed = false;
  const taskFailures = () => (results || []).filter(row => row.status === 'failed').map(row => row.error);
  try {
    results = await Promise.all(tasks.map(execute));
    if (observerErrors.length) {
      const originals = [...taskFailures(), ...observerErrors];
      if (originals.length === 1) throw originals[0];
      // Keep raw falsey causes in the diagnostic graph. Resource authority is
      // retained independently by the original observation ledger below.
      throw new AggregateError(originals, 'Bootstrap task/result observation failed.', { cause: observerErrors[0] });
    }
  } catch (error) { primary = error; failed = true; observations.remember(error); }
  finally { signal?.removeEventListener?.('abort', abort); }
  const fields = { bootstrapResults: results ? Object.freeze([...results]) : null };
  const contextOptions = { nonEnumerable: ['bootstrapResults'], secondaryPresent: true };
  try { await scheduler.shutdown({ awaitRunning: true, timeoutMs: 30000 }); }
  catch (cleanup) {
    if (!failed && taskFailures().length) {
      const originals = taskFailures();
      primary = new AggregateError(originals, 'Bootstrap tasks failed before scheduler retirement.', { cause: originals[0] }); failed = true;
    }
    primary = failed ? addStorageFailureContext(primary, fields, cleanup, contextOptions)
      : addStorageFailureContext(cleanup, fields, null, { nonEnumerable: ['bootstrapResults'] });
    failed = true;
  }
  // Callback rejection is not physical resource retirement, even after all
  // scheduler tasks drained. Capture these original callbacks before returning
  // or flattening the raw AggregateError into a coordinator diagnostic.
  try { observations.requireSettled(); }
  catch (pending) {
    primary = failed ? addStorageFailureContext(primary, fields, pending, contextOptions)
      : addStorageFailureContext(pending, fields, null, { nonEnumerable: ['bootstrapResults'] });
    failed = true;
  }
  if (failed) throw primary;
  return { ok: results.every(row => !row.required || row.status === 'succeeded'), results, budget };
};
