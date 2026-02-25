import { isAbortSignal } from '../abort.js';

/**
 * Adapt a build scheduler queue to a PQueue-like interface used by runWithQueue.
 * @param {{scheduler:ReturnType<typeof createBuildScheduler>,queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number}} input
 * @returns {{add:(fn:()=>Promise<any>,options?:{bytes?:number,signal?:AbortSignal|null})=>Promise<any>,onIdle:()=>Promise<void>,clear:()=>void,maxPending?:number,maxPendingBytes?:number,maxInFlightBytes?:number,concurrency?:number}}
 */
export function createSchedulerQueueAdapter({
  scheduler,
  queueName,
  tokens,
  maxPending,
  maxPendingBytes,
  maxInFlightBytes,
  concurrency
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
  let idleResolvers = [];
  const notifyIdle = () => {
    if (pending.size !== 0) return;
    const resolvers = idleResolvers;
    idleResolvers = [];
    for (const resolve of resolvers) {
      resolve();
    }
  };
  const add = (fn, options = {}) => {
    const bytesRaw = Number(options?.bytes);
    const bytes = Number.isFinite(bytesRaw) && bytesRaw > 0 ? Math.floor(bytesRaw) : 0;
    const signal = isAbortSignal(options?.signal) ? options.signal : null;
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
      notifyIdle();
    }).catch(() => {});
    return task;
  };
  const onIdle = () => {
    if (pending.size === 0) return Promise.resolve();
    return new Promise((resolve) => {
      idleResolvers.push(resolve);
    });
  };
  const clear = () => {
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
