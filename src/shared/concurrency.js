import PQueue from 'p-queue';
import { createAbortError, throwIfAborted } from './abort.js';

/**
 * Create shared task queues for IO, CPU, and embeddings work.
 * @param {{ioConcurrency:number,cpuConcurrency:number,embeddingConcurrency?:number,procConcurrency?:number,ioPendingLimit?:number,cpuPendingLimit?:number,embeddingPendingLimit?:number,procPendingLimit?:number}} input
 * @returns {{io:PQueue,cpu:PQueue,embedding:PQueue,proc?:PQueue}}
 */
export function createTaskQueues({
  ioConcurrency,
  cpuConcurrency,
  embeddingConcurrency,
  procConcurrency,
  ioPendingLimit,
  cpuPendingLimit,
  embeddingPendingLimit,
  procPendingLimit
}) {
  const io = new PQueue({ concurrency: Math.max(1, Math.floor(ioConcurrency || 1)) });
  const cpu = new PQueue({ concurrency: Math.max(1, Math.floor(cpuConcurrency || 1)) });
  const embeddingLimit = Number.isFinite(Number(embeddingConcurrency))
    ? Math.max(1, Math.floor(Number(embeddingConcurrency)))
    : Math.max(1, Math.floor(cpuConcurrency || 1));
  const embedding = new PQueue({ concurrency: embeddingLimit });
  const procLimit = Number.isFinite(Number(procConcurrency))
    ? Math.max(1, Math.floor(Number(procConcurrency)))
    : null;
  const proc = procLimit ? new PQueue({ concurrency: procLimit }) : null;
  const applyLimit = (queue, limit) => {
    if (!Number.isFinite(limit) || limit <= 0) return;
    queue.maxPending = Math.floor(limit);
  };
  applyLimit(io, ioPendingLimit);
  applyLimit(cpu, cpuPendingLimit);
  applyLimit(embedding, embeddingPendingLimit);
  if (proc) {
    applyLimit(proc, procPendingLimit);
    return { io, cpu, embedding, proc };
  }
  return { io, cpu, embedding };
}

/**
 * Run async work over items using a shared queue.
 * @param {PQueue} queue
 * @param {Array<any>} items
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onError?:(error:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,onProgress?:(state:{done:number,total:number})=>Promise<void>,bestEffort?:boolean,signal?:AbortSignal,abortError?:Error,retries?:number,retryDelayMs?:number,backoffMs?:number}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithQueue(queue, items, worker, options = {}) {
  const list = Array.from(items || []);
  if (!list.length) return options.collectResults === false ? null : [];
  const collectResults = options.collectResults !== false;
  const onResult = typeof options.onResult === 'function' ? options.onResult : null;
  const onError = typeof options.onError === 'function' ? options.onError : null;
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const retries = Number.isFinite(Number(options.retries)) ? Math.max(0, Math.floor(Number(options.retries))) : 0;
  const retryDelayMs = Number.isFinite(Number(options.retryDelayMs)) ? Math.max(0, Math.floor(Number(options.retryDelayMs))) : 0;
  const backoffMs = Number.isFinite(Number(options.backoffMs)) ? Math.max(0, Math.floor(Number(options.backoffMs))) : null;
  const delayMs = backoffMs != null ? backoffMs : retryDelayMs;
  const bestEffort = options.bestEffort === true;
  const signal = options.signal && typeof options.signal.aborted === 'boolean' ? options.signal : null;
  const abortError = options.abortError instanceof Error ? options.abortError : createAbortError();
  const results = collectResults ? new Array(list.length) : null;
  const pendingSignals = new Set();
  const maxPending = Number.isFinite(queue?.maxPending) ? queue.maxPending : null;
  let aborted = false;
  let firstError = null;
  const errors = [];
  let doneCount = 0;
  const markAborted = () => {
    if (aborted) return;
    aborted = true;
  };
  const recordError = async (err, ctx) => {
    let error = err || new Error('Queue task failed');
    if (onError) {
      try {
        await onError(error, ctx);
      } catch (callbackErr) {
        error = callbackErr;
      }
    }
    if (bestEffort) {
      errors.push(error);
      return;
    }
    if (!firstError) {
      firstError = error;
      markAborted();
    }
  };
  const recordProgress = async () => {
    if (!onProgress) return;
    try {
      await onProgress({ done: doneCount, total: list.length });
    } catch (err) {
      await recordError(err, { index: -1, item: null, signal });
    }
  };
  const abortHandler = () => {
    markAborted();
  };
  if (signal) {
    if (signal.aborted) {
      markAborted();
    } else {
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  }
  const runWorker = async (item, ctx) => {
    let attempt = 0;
    while (true) {
      throwIfAborted(signal);
      let result;
      try {
        result = await worker(item, ctx);
      } catch (err) {
        attempt += 1;
        if (attempt > retries) throw err;
        if (delayMs > 0) {
          await new Promise((resolve) => setTimeout(resolve, delayMs));
        }
        continue;
      }
      if (collectResults) results[ctx.index] = result;
      if (onResult) {
        await onResult(result, ctx);
      }
      return result;
    }
  };
  const enqueue = async (item, index) => {
    const ctx = { index, item, signal };
    if (aborted) return;
    if (signal?.aborted) {
      markAborted();
      return;
    }
    if (maxPending) {
      while (pendingSignals.size >= maxPending && !aborted) {
        await Promise.race(pendingSignals);
      }
    }
    if (aborted) return;
    const task = queue.add(() => runWorker(item, ctx));
    const settled = task.then(
      async () => {
        doneCount += 1;
        await recordProgress();
      },
      async (err) => {
        await recordError(err, ctx);
        doneCount += 1;
        await recordProgress();
      }
    );
    pendingSignals.add(settled);
    void task.catch(() => {});
    const cleanup = settled.finally(() => {
      pendingSignals.delete(settled);
    });
    void cleanup.catch(() => {});
  };
  try {
    for (let index = 0; index < list.length; index += 1) {
      await enqueue(list[index], index);
      if (aborted && !bestEffort) break;
    }
    await Promise.all(pendingSignals);
    if (signal?.aborted) throw abortError;
    if (firstError) throw firstError;
    if (bestEffort && errors.length) {
      throw new AggregateError(errors, 'runWithQueue best-effort failures');
    }
    return results;
  } finally {
    if (signal) {
      signal.removeEventListener('abort', abortHandler);
    }
  }
}

/**
 * Run async work over items with a per-call concurrency limit.
 * @param {Array<any>} items
 * @param {number} limit
 * @param {(item:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<any>} worker
 * @param {{collectResults?:boolean,onResult?:(result:any, ctx:{index:number,item:any,signal?:AbortSignal})=>Promise<void>,signal?:AbortSignal}} [options]
 * @returns {Promise<any[]|null>}
 */
export async function runWithConcurrency(items, limit, worker, options = {}) {
  const queue = new PQueue({ concurrency: Math.max(1, Math.floor(limit || 1)) });
  return runWithQueue(queue, items, worker, options);
}

/**
 * Create a build scheduler that coordinates CPU/IO/memory tokens across queues.
 * This is intentionally generic and can be wired into Stage1/2/4 and embeddings.
 * @param {{enabled?:boolean,lowResourceMode?:boolean,cpuTokens?:number,ioTokens?:number,memoryTokens?:number,starvationMs?:number,queues?:Record<string,{priority?:number,maxPending?:number}>}} input
 * @returns {{schedule:(queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},fn?:()=>Promise<any>)=>Promise<any>,stats:()=>any,shutdown:()=>void,setLimits:(limits:{cpuTokens?:number,ioTokens?:number,memoryTokens?:number})=>void}}
 */
export function createBuildScheduler(input = {}) {
  const enabled = input.enabled !== false;
  const lowResourceMode = input.lowResourceMode === true;
  const starvationMs = Number.isFinite(Number(input.starvationMs))
    ? Math.max(0, Math.floor(Number(input.starvationMs)))
    : 30000;
  const normalizeTokenPool = (value) => {
    const parsed = Math.floor(Number(value ?? 1));
    if (!Number.isFinite(parsed)) return 1;
    return Math.max(0, parsed);
  };
  let cpuTokens = normalizeTokenPool(input.cpuTokens);
  let ioTokens = normalizeTokenPool(input.ioTokens);
  let memoryTokens = normalizeTokenPool(input.memoryTokens);

  const queueConfig = input.queues || {};
  const queues = new Map();
  const queueOrder = [];
  const nowMs = () => Date.now();
  const counters = {
    scheduled: 0,
    started: 0,
    completed: 0,
    failed: 0,
    rejected: 0,
    starvation: 0
  };

  const ensureQueue = (name) => {
    if (queues.has(name)) return queues.get(name);
    const cfg = queueConfig[name] || {};
    const state = {
      name,
      priority: Number.isFinite(Number(cfg.priority)) ? Number(cfg.priority) : 50,
      maxPending: Number.isFinite(Number(cfg.maxPending)) ? Math.max(1, Math.floor(Number(cfg.maxPending))) : null,
      pending: [],
      running: 0,
      stats: {
        scheduled: 0,
        started: 0,
        completed: 0,
        failed: 0,
        rejected: 0,
        starvation: 0
      }
    };
    queues.set(name, state);
    queueOrder.push(state);
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
    return state;
  };

  const applyQueueConfig = (queue, config) => {
    if (!queue || !config || typeof config !== 'object') return;
    if (Number.isFinite(Number(config.priority))) {
      queue.priority = Number(config.priority);
    }
    if (Number.isFinite(Number(config.maxPending))) {
      queue.maxPending = Math.max(1, Math.floor(Number(config.maxPending)));
    }
    queueOrder.sort((a, b) => a.priority - b.priority || a.name.localeCompare(b.name));
  };

  const registerQueue = (queueName, config = {}) => {
    const queue = ensureQueue(queueName);
    applyQueueConfig(queue, config);
    return queue;
  };

  const registerQueues = (configMap = {}) => {
    if (!configMap || typeof configMap !== 'object') return;
    for (const [queueName, config] of Object.entries(configMap)) {
      registerQueue(queueName, config);
    }
  };

  const tokenState = () => ({
    cpu: { total: cpuTokens, used: 0 },
    io: { total: ioTokens, used: 0 },
    mem: { total: memoryTokens, used: 0 }
  });
  let tokens = tokenState();
  let shuttingDown = false;

  const canStart = (req) => {
    const cpu = Math.max(0, Math.floor(Number(req?.cpu || 0)));
    const io = Math.max(0, Math.floor(Number(req?.io || 0)));
    const mem = Math.max(0, Math.floor(Number(req?.mem || 0)));
    return (
      tokens.cpu.used + cpu <= tokens.cpu.total &&
      tokens.io.used + io <= tokens.io.total &&
      tokens.mem.used + mem <= tokens.mem.total
    );
  };

  const reserve = (req) => {
    const cpu = Math.max(0, Math.floor(Number(req?.cpu || 0)));
    const io = Math.max(0, Math.floor(Number(req?.io || 0)));
    const mem = Math.max(0, Math.floor(Number(req?.mem || 0)));
    tokens.cpu.used += cpu;
    tokens.io.used += io;
    tokens.mem.used += mem;
    return { cpu, io, mem };
  };

  const release = (used) => {
    tokens.cpu.used = Math.max(0, tokens.cpu.used - (used?.cpu || 0));
    tokens.io.used = Math.max(0, tokens.io.used - (used?.io || 0));
    tokens.mem.used = Math.max(0, tokens.mem.used - (used?.mem || 0));
  };

  const findStartableIndex = (queue) => {
    if (!queue?.pending?.length) return -1;
    for (let i = 0; i < queue.pending.length; i += 1) {
      if (canStart(queue.pending[i].tokens)) return i;
    }
    return -1;
  };

  const pickNextQueue = () => {
    if (!queueOrder.length) return null;
    let starving = null;
    let picked = null;
    for (const q of queueOrder) {
      if (!q.pending.length) continue;
      const index = findStartableIndex(q);
      if (index < 0) continue;
      const waited = nowMs() - q.pending[0].enqueuedAt;
      if (waited >= starvationMs && (!starving || waited > starving.waited)) {
        starving = { queue: q, waited, index };
      } else if (!picked) {
        picked = { queue: q, index };
      }
    }
    if (starving) return { queue: starving.queue, starved: true, index: starving.index };
    return picked ? { queue: picked.queue, starved: false, index: picked.index } : null;
  };

  const pump = () => {
    if (shuttingDown) return;
    while (true) {
      const pick = pickNextQueue();
      if (!pick) return;
      const { queue, starved, index } = pick;
      const next = queue.pending[index];
      if (!next || !canStart(next.tokens)) return;
      queue.pending.splice(index, 1);
      queue.running += 1;
      queue.stats.started += 1;
      counters.started += 1;
      if (starved) {
        queue.stats.starvation += 1;
        counters.starvation += 1;
      }
      const used = reserve(next.tokens);
      const done = Promise.resolve()
        .then(next.fn)
        .then(
          (value) => {
            queue.stats.completed += 1;
            counters.completed += 1;
            next.resolve(value);
          },
          (err) => {
            queue.stats.failed += 1;
            counters.failed += 1;
            next.reject(err);
          }
        )
        .finally(() => {
          queue.running -= 1;
          release(used);
          pump();
        });
      void done;
    }
  };

  const schedule = (queueName, tokensReq = { cpu: 1 }, fn) => {
    if (typeof tokensReq === 'function') {
      fn = tokensReq;
      tokensReq = { cpu: 1 };
    }
    if (typeof fn !== 'function') {
      return Promise.reject(new Error('schedule requires a function'));
    }
    if (!enabled || lowResourceMode) {
      return Promise.resolve().then(fn);
    }
    if (shuttingDown) {
      counters.rejected += 1;
      return Promise.reject(new Error('scheduler is shut down'));
    }
    const queue = ensureQueue(queueName);
    if (queue.maxPending && queue.pending.length >= queue.maxPending) {
      queue.stats.rejected += 1;
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      counters.rejected += 1;
      return Promise.reject(new Error(`queue ${queueName} is at maxPending`));
    }
    return new Promise((resolve, reject) => {
      queue.pending.push({
        tokens: tokensReq,
        fn,
        resolve,
        reject,
        enqueuedAt: nowMs()
      });
      queue.stats.scheduled += 1;
      counters.scheduled += 1;
      pump();
    });
  };

  const clearQueue = (queueName, reason = 'scheduler queue cleared') => {
    const queue = queues.get(queueName);
    if (!queue || !queue.pending.length) return 0;
    const error = new Error(reason);
    const cleared = queue.pending.splice(0, queue.pending.length);
    for (const item of cleared) {
      queue.stats.rejected += 1;
      counters.rejected += 1;
      try {
        item.reject(error);
      } catch {}
    }
    return cleared.length;
  };

  const stats = () => {
    const queueStats = {};
    for (const q of queueOrder) {
      const oldest = q.pending.length ? nowMs() - q.pending[0].enqueuedAt : 0;
      queueStats[q.name] = {
        pending: q.pending.length,
        running: q.running,
        maxPending: q.maxPending,
        oldestWaitMs: oldest,
        scheduled: q.stats.scheduled,
        started: q.stats.started,
        completed: q.stats.completed,
        failed: q.stats.failed,
        rejected: q.stats.rejected,
        starvation: q.stats.starvation
      };
    }
    return {
      queues: queueStats,
      counters: { ...counters },
      tokens: {
        cpu: { ...tokens.cpu },
        io: { ...tokens.io },
        mem: { ...tokens.mem }
      }
    };
  };

  const shutdown = () => {
    shuttingDown = true;
  };

  const setLimits = (limits = {}) => {
    if (Number.isFinite(Number(limits.cpuTokens))) {
      cpuTokens = Math.max(0, Math.floor(Number(limits.cpuTokens)));
    }
    if (Number.isFinite(Number(limits.ioTokens))) {
      ioTokens = Math.max(0, Math.floor(Number(limits.ioTokens)));
    }
    if (Number.isFinite(Number(limits.memoryTokens))) {
      memoryTokens = Math.max(0, Math.floor(Number(limits.memoryTokens)));
    }
    tokens.cpu.total = cpuTokens;
    tokens.io.total = ioTokens;
    tokens.mem.total = memoryTokens;
    pump();
  };

  return {
    schedule,
    stats,
    shutdown,
    setLimits,
    registerQueue,
    registerQueues,
    clearQueue,
    enabled,
    lowResourceMode
  };
}

/**
 * Adapt a build scheduler queue to a PQueue-like interface used by runWithQueue.
 * @param {{scheduler:ReturnType<typeof createBuildScheduler>,queueName:string,tokens?:{cpu?:number,io?:number,mem?:number},maxPending?:number,concurrency?:number}} input
 * @returns {{add:(fn:()=>Promise<any>)=>Promise<any>,onIdle:()=>Promise<void>,clear:()=>void,maxPending?:number,concurrency?:number}}
 */
export function createSchedulerQueueAdapter({ scheduler, queueName, tokens, maxPending, concurrency }) {
  if (!scheduler || typeof scheduler.schedule !== 'function') {
    throw new Error('Scheduler queue adapter requires a scheduler instance.');
  }
  if (!queueName) {
    throw new Error('Scheduler queue adapter requires a queue name.');
  }
  scheduler.registerQueue?.(queueName, {
    ...(Number.isFinite(Number(maxPending)) ? { maxPending: Math.max(1, Math.floor(Number(maxPending))) } : {})
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
  const add = (fn) => {
    const task = scheduler.schedule(queueName, tokens || { cpu: 1 }, fn);
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
    concurrency: Number.isFinite(Number(concurrency)) ? Math.floor(Number(concurrency)) : undefined
  };
}
