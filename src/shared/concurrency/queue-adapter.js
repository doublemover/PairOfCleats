import { createAbortError, isAbortSignal, throwIfAborted } from '../abort.js';
import { awaitWithKeepalive } from '../promise-keepalive.js';

/**
 * Adapt a build scheduler queue to a PQueue-like interface used by runWithQueue.
 * @param {{scheduler:ReturnType<typeof createBuildScheduler>,queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number,backpressure?:boolean}} input
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
  backpressure = false
}) {
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    throw new Error('Scheduler queue adapter requires a scheduler instance.');
  }
  if (!queueName) {
    throw new Error('Scheduler queue adapter requires a queue name.');
  }
  const toPositiveInt = (value) => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return Math.floor(parsed);
  };
  const resolvedMaxPending = toPositiveInt(maxPending);
  const resolvedMaxPendingBytes = toPositiveInt(maxPendingBytes);
  const resolvedMaxInFlightBytes = toPositiveInt(maxInFlightBytes);
  scheduler.registerQueue?.(queueName, {
    ...(resolvedMaxPending != null ? { maxPending: resolvedMaxPending } : {}),
    ...(resolvedMaxPendingBytes != null
      ? { maxPendingBytes: resolvedMaxPendingBytes }
      : {}),
    ...(resolvedMaxInFlightBytes != null
      ? { maxInFlightBytes: resolvedMaxInFlightBytes }
      : {})
  });
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
    const bytesRaw = Number(options?.bytes);
    const bytes = Number.isFinite(bytesRaw) && bytesRaw > 0 ? Math.floor(bytesRaw) : 0;
    const signal = isAbortSignal(options?.signal) ? options.signal : null;
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
    maxPending: Number.isFinite(Number(maxPending)) ? Math.floor(Number(maxPending)) : undefined,
    maxPendingBytes: Number.isFinite(Number(maxPendingBytes))
      ? Math.floor(Number(maxPendingBytes))
      : undefined,
    maxInFlightBytes: Number.isFinite(Number(maxInFlightBytes))
      ? Math.floor(Number(maxInFlightBytes))
      : undefined,
    concurrency: Number.isFinite(Number(concurrency)) ? Math.floor(Number(concurrency)) : undefined
  };
}
