import { createAbortError, isAbortSignal, throwIfAborted } from '../abort.js';
import { awaitWithKeepalive } from '../promise-keepalive.js';
import { normalizeSchedulerByteLimit, normalizeSchedulerMaxPending, normalizeSchedulerRequest } from './scheduler-core-policy.js';

/**
 * Adapt a build scheduler queue to a PQueue-like interface used by runWithQueue.
 * @param {{scheduler:ReturnType<typeof createBuildScheduler>,queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number,backpressure?:boolean,queueConfig?:object|null}} input
 * @returns {{add:(fn:()=>Promise<any>,options?:{bytes?:number,signal?:AbortSignal|null})=>Promise<any>,onIdle:()=>Promise<void>,clear:()=>void,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number}}
 */
export function createSchedulerQueueAdapter({
  scheduler,
  queueName,
  tokens,
  maxPending,
  maxPendingBytes,
  maxInFlightBytes,
  concurrency,
  backpressure = false,
  queueConfig = null
}) {
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    throw new Error('Scheduler queue adapter requires a scheduler instance.');
  }
  if (!queueName) {
    throw new Error('Scheduler queue adapter requires a queue name.');
  }
  // Runtime defaults bound the producer window; configured scheduler limits
  // independently own admission. Preserve explicit zero (unlimited) at that
  // boundary, while retaining the producer's own bounded working set.
  const producerMaxPending = normalizeSchedulerMaxPending(maxPending);
  const producerMaxPendingBytes = normalizeSchedulerByteLimit(maxPendingBytes);
  const producerMaxInFlightBytes = normalizeSchedulerByteLimit(maxInFlightBytes);
  const explicitQueueCap = Number.isFinite(Number(queueConfig?.concurrency)) && Number(queueConfig.concurrency) > 0
    ? Math.floor(Number(queueConfig.concurrency)) : null;
  let requestedConcurrency = Number.isFinite(Number(concurrency)) && Number(concurrency) > 0
    ? Math.floor(Number(concurrency)) : null;
  const effectiveConcurrency = () => explicitQueueCap == null ? requestedConcurrency
    : requestedConcurrency == null ? explicitQueueCap : Math.min(explicitQueueCap, requestedConcurrency);
  const registered = scheduler.registerQueue?.(queueName, {
    ...(maxPending != null ? { maxPending: producerMaxPending ?? 0 } : {}),
    ...(maxPendingBytes != null ? { maxPendingBytes: producerMaxPendingBytes ?? 0 } : {}),
    ...(maxInFlightBytes != null ? { maxInFlightBytes: producerMaxInFlightBytes ?? 0 } : {}),
    ...(queueConfig || {}),
    ...(effectiveConcurrency() != null ? { concurrency: effectiveConcurrency() } : {})
  });
  const intersectLimit = (producerLimit, schedulerLimit) => (
    producerLimit == null ? schedulerLimit
      : schedulerLimit == null ? producerLimit : Math.min(producerLimit, schedulerLimit)
  );
  const resolvedMaxPending = intersectLimit(producerMaxPending, normalizeSchedulerMaxPending(registered?.maxPending));
  const resolvedMaxPendingBytes = intersectLimit(producerMaxPendingBytes, normalizeSchedulerByteLimit(registered?.maxPendingBytes));
  const resolvedMaxInFlightBytes = intersectLimit(producerMaxInFlightBytes, normalizeSchedulerByteLimit(registered?.maxInFlightBytes));
  const pending = new Set();
  let admitted = 0;
  const admissionWaiters = [];
  let clearGeneration = 0;
  let idleResolvers = [];
  const notifyIdle = () => {
    if (pending.size !== 0 || admitted !== 0 || admissionWaiters.length !== 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };
  const releaseCapacity = () => {
    admitted -= 1;
    while (admissionWaiters.length && admitted < resolvedMaxPending) {
      const next = admissionWaiters.shift();
      next.detachAbort();
      admitted += 1;
      next.resolve();
    }
    notifyIdle();
  };
  const waitForCapacity = (signal) => {
    throwIfAborted(signal);
    if (admitted < resolvedMaxPending) {
      admitted += 1;
      return Promise.resolve();
    }
    return awaitWithKeepalive(new Promise((resolve, reject) => {
      const waiter = { resolve, reject, detachAbort: () => {} };
      if (signal) {
        const onAbort = () => {
          const index = admissionWaiters.indexOf(waiter);
          if (index < 0) return;
          admissionWaiters.splice(index, 1);
          waiter.detachAbort();
          reject(createAbortError());
          notifyIdle();
        };
        signal.addEventListener('abort', onAbort, { once: true });
        waiter.detachAbort = () => signal.removeEventListener('abort', onAbort);
      }
      admissionWaiters.push(waiter);
    }));
  };
  const add = async (fn, options = {}) => {
    // Validate before joining the bounded producer window. Invalid bytes must
    // not turn into an uncharged request, nor strand an admission waiter.
    const overrides = normalizeSchedulerRequest({ bytes: options?.bytes, cpu: options?.cpu });
    const bytes = overrides.bytes;
    const signal = isAbortSignal(options?.signal) ? options.signal : null;
    throwIfAborted(signal);
    const generation = clearGeneration;
    const bounded = backpressure && resolvedMaxPending;
    if (bounded) {
      await waitForCapacity(signal);
      try {
        throwIfAborted(signal);
        if (generation !== clearGeneration) throw new Error('scheduler queue cleared');
      } catch (error) { releaseCapacity(); throw error; }
    }
    const baseTokens = { ...(tokens || { cpu: 1 }) };
    // Internal nested compute requests may add a CPU charge; callers cannot
    // lower the queue's existing CPU, I/O or memory envelope.
    if (overrides.cpu > 0) baseTokens.cpu = Math.max(baseTokens.cpu || 0, overrides.cpu);
    const tokenRequest = {
      ...baseTokens,
      ...(bytes > 0 ? { bytes } : {}),
      ...(signal ? { signal } : {})
    };
    const task = scheduler.schedule(queueName, tokenRequest, fn);
    pending.add(task);
    task.finally(() => {
      pending.delete(task);
      if (bounded) releaseCapacity();
      notifyIdle();
    }).catch(() => {});
    return task;
  };
  const onIdle = () => {
    if (pending.size === 0 && admitted === 0 && admissionWaiters.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  };
  const clear = () => {
    clearGeneration += 1;
    for (const waiter of admissionWaiters.splice(0)) {
      waiter.detachAbort();
      waiter.reject(new Error('scheduler queue cleared'));
    }
    scheduler.clearQueue?.(queueName, 'scheduler queue cleared');
  };
  return {
    add,
    onIdle,
    clear,
    maxPending: resolvedMaxPending ?? (maxPending === 0 ? 0 : undefined),
    maxPendingBytes: resolvedMaxPendingBytes ?? (maxPendingBytes === 0 ? 0 : undefined),
    maxInFlightBytes: resolvedMaxInFlightBytes ?? (maxInFlightBytes === 0 ? 0 : undefined),
    get concurrency() { return effectiveConcurrency() ?? undefined; },
    set concurrency(value) {
      if (!Number.isSafeInteger(value) || value < 1) throw new TypeError('Queue concurrency must be a positive integer.');
      requestedConcurrency = value;
      scheduler.registerQueue?.(queueName, { concurrency: effectiveConcurrency() });
    }
  };
}
