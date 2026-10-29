import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createInterface } from 'node:readline';
import { PYTHON_AST_SCRIPT } from './ast-script.js';
import { findPythonExecutable } from './executable.js';
import { attachCleanupSignalHandlers } from '../../shared/process-signals.js';
import { registerChildProcessForCleanup } from '../../shared/subprocess/tracking-register.js';
import { killChildProcessTree } from '../../shared/kill-tree.js';
import { getEnvConfig } from '../../shared/env/runtime.js';
import { runWithTimeout } from '../../shared/promise-timeout.js';
import { currentRunResourceScope } from '../../shared/lifecycle/run-scope.js';
import { createRunSharedResources } from '../../shared/lifecycle/shared-resource.js';
import { addStorageFailureContext } from '../../shared/storage/operation-error.js';
import { observeStorageResource } from '../../shared/storage/failure-observation.js';

const PYTHON_AST_DEFAULTS = {
  enabled: true,
  workerCount: 2,
  maxWorkers: 2,
  scaleUpQueueMs: 250,
  taskTimeoutMs: 30000,
  maxRetries: 1,
  maxQueued: null,
  maxTextBytes: 512 * 1024,
  crashLoopMax: 3,
  crashWindowMs: 60000,
  crashBackoffMs: 30000
};

let pythonPool = null;
let pythonPoolSignature = null;
let pythonPoolHooked = false;

export function normalizePythonAstConfig(config = {}, options = {}) {
  if (config.enabled === false) return { enabled: false };
  const defaultMaxWorkers = Number.isFinite(options.defaultMaxWorkers)
    ? Math.max(1, Math.floor(options.defaultMaxWorkers))
    : PYTHON_AST_DEFAULTS.maxWorkers;
  const launchThreads = getEnvConfig().threads;
  const launchCap = Math.max(1, Math.min(4, os.availableParallelism(),
    Number.isFinite(launchThreads) && launchThreads > 0 ? Math.floor(launchThreads) : 4));
  const hardMaxWorkers = Number.isFinite(options.hardMaxWorkers)
    ? Math.min(launchCap, Math.max(1, Math.floor(options.hardMaxWorkers)))
    : launchCap;
  const workerCountRaw = Number(config.workerCount);
  const workerCount = Number.isFinite(workerCountRaw)
    ? Math.min(hardMaxWorkers, Math.max(1, Math.floor(workerCountRaw)))
    : Math.min(hardMaxWorkers, PYTHON_AST_DEFAULTS.workerCount, defaultMaxWorkers);
  const maxWorkersRaw = Number(config.maxWorkers);
  const requestedMax = Number.isFinite(maxWorkersRaw)
    ? Math.max(workerCount, Math.floor(maxWorkersRaw))
    : Math.max(workerCount, defaultMaxWorkers);
  const cappedMax = Math.min(requestedMax, hardMaxWorkers);
  const maxWorkers = Math.max(workerCount, cappedMax);
  const scaleUpQueueMsRaw = Number(config.scaleUpQueueMs);
  const scaleUpQueueMs = Number.isFinite(scaleUpQueueMsRaw)
    ? Math.max(0, Math.floor(scaleUpQueueMsRaw))
    : PYTHON_AST_DEFAULTS.scaleUpQueueMs;
  const taskTimeoutMsRaw = Number(config.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw)
    ? Math.max(1000, Math.floor(taskTimeoutMsRaw))
    : PYTHON_AST_DEFAULTS.taskTimeoutMs;
  const maxRetriesRaw = Number(config.maxRetries);
  const maxRetries = Number.isFinite(maxRetriesRaw)
    ? Math.max(0, Math.floor(maxRetriesRaw))
    : PYTHON_AST_DEFAULTS.maxRetries;
  const maxQueuedRaw = Number(config.maxQueued);
  const maxQueued = Number.isFinite(maxQueuedRaw)
    ? Math.max(0, Math.floor(maxQueuedRaw))
    : null;
  const maxTextBytesRaw = Number(config.maxTextBytes);
  const maxTextBytes = Number.isFinite(maxTextBytesRaw)
    ? Math.max(0, Math.floor(maxTextBytesRaw))
    : PYTHON_AST_DEFAULTS.maxTextBytes;
  const crashLoopMaxRaw = Number(config.crashLoopMax);
  const crashLoopMax = Number.isFinite(crashLoopMaxRaw)
    ? Math.max(0, Math.floor(crashLoopMaxRaw))
    : PYTHON_AST_DEFAULTS.crashLoopMax;
  const crashWindowMsRaw = Number(config.crashWindowMs);
  const crashWindowMs = Number.isFinite(crashWindowMsRaw)
    ? Math.max(0, Math.floor(crashWindowMsRaw))
    : PYTHON_AST_DEFAULTS.crashWindowMs;
  const crashBackoffMsRaw = Number(config.crashBackoffMs);
  const crashBackoffMs = Number.isFinite(crashBackoffMsRaw)
    ? Math.max(0, Math.floor(crashBackoffMsRaw))
    : PYTHON_AST_DEFAULTS.crashBackoffMs;
  return {
    enabled: true,
    workerCount,
    maxWorkers,
    scaleUpQueueMs,
    taskTimeoutMs,
    maxRetries,
    maxQueued,
    maxTextBytes,
    crashLoopMax,
    crashWindowMs,
    crashBackoffMs
  };
}

function createPythonAstPool({ pythonBin, config, log }) {
  const state = {
    pythonBin,
    config,
    log,
    workers: [],
    retiringWorkers: new Set(),
    cleanupErrors: new Map(),
    cleanupOverflow: false,
    queue: [],
    nextId: 1,
    stopping: false,
    disabledUntil: 0,
    crashCount: 0,
    crashWindowStart: 0,
    lastBackpressureLog: 0,
    lastDisabledLog: 0,
    lastPayloadLog: 0,
    shutdownPromise: null
  };

  const isDisabled = () => state.disabledUntil && Date.now() < state.disabledUntil;

  const logOnce = (message, key) => {
    if (typeof log !== 'function' || !message) return;
    const now = Date.now();
    if (key === 'backpressure') {
      if (now - state.lastBackpressureLog < 10000) return;
      state.lastBackpressureLog = now;
    }
    if (key === 'disabled') {
      if (now - state.lastDisabledLog < 10000) return;
      state.lastDisabledLog = now;
    }
    if (key === 'payload') {
      if (now - state.lastPayloadLog < 10000) return;
      state.lastPayloadLog = now;
    }
    log(message);
  };

  const settlePendingJobs = (reason = null) => {
    for (const worker of state.workers) {
      const pendingJobs = Array.from(worker.pending.values());
      worker.pending.clear();
      worker.busy = false;
      worker.busySince = 0;
      for (const job of pendingJobs) {
        if (job.timer) clearTimeout(job.timer);
        job.resolve(null);
      }
    }
    const queuedJobs = state.queue.splice(0, state.queue.length);
    for (const job of queuedJobs) {
      if (job.timer) clearTimeout(job.timer);
      job.lastError = reason || job.lastError || null;
      job.resolve(null);
    }
  };

  const observeCleanupFailure = error => {
    if (state.cleanupErrors.has(error)) return;
    if (state.cleanupErrors.size === 128) {
      state.cleanupOverflow ||= Object.assign(new Error('Python worker retirement diagnostics exceeded their bound.'),
        { cacheOwnershipPending: true, cacheOwnershipReleased: () => false });
      return;
    }
    state.cleanupErrors.set(error, { observation: observeStorageResource(error, { phase: 'python-worker-retirement' }), reported: false });
  };
  const workerCount = () => state.workers.length + state.retiringWorkers.size;
  const retireWorker = (worker, { forceKill = true, graceMs = 0 } = {}) => {
    if (worker.retirement) return worker.retirement;
    worker.exited = true;
    state.retiringWorkers.add(worker);
    detachWorker(worker);
    let finished = false, originalFailure = null;
    const released = () => finished && worker.closeObserved && (!originalFailure || originalFailure.isSettled());
    const original = (async () => {
      let primary = null;
      if (forceKill) {
        try { await killChildProcessTree(worker.proc, { killTree: true, detached: false, graceMs, awaitGrace: graceMs > 0 }); }
        catch (error) { primary = error; originalFailure = observeStorageResource(error, { phase: 'python-worker-termination' }); }
      }
      await worker.closed;
      finalizeWorkerRegistration(worker);
      if (primary) throw primary;
    })().finally(() => {
      finished = true;
      if (worker.closeObserved) state.retiringWorkers.delete(worker);
    });
    worker.retirement = runWithTimeout(() => original, { timeoutMs: 5000,
      errorFactory: () => Object.assign(new Error('Python AST worker close was not confirmed.'), { code: 'PYTHON_AST_SHUTDOWN_UNCONFIRMED' })
    }).catch(error => {
      const failure = addStorageFailureContext(error, { cacheOwnershipPending: true,
        cacheOwnershipReleased: released }, undefined, { forceAggregate: true });
      observeCleanupFailure(failure);
      throw failure;
    });
    worker.retirement.catch(() => {});
    return worker.retirement;
  };
  const shutdownWorkers = async () => {
    settlePendingJobs(new Error('python_ast_pool_shutdown'));
    const workers = [...new Set([...state.workers, ...state.retiringWorkers])];
    const stopTasks = [];
    for (const worker of workers) {
      worker.exited = true;
      worker.busy = false;
      worker.busySince = 0;
      try {
        worker.proc?.stdin?.end?.();
      } catch {}
      stopTasks.push(retireWorker(worker, { graceMs: 100 }));
    }
    const results = await Promise.allSettled(stopTasks);
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    for (const [error, record] of state.cleanupErrors) {
      if (!record.reported || !record.observation.isSettled()) { failures.push(error); record.reported = true; }
      else state.cleanupErrors.delete(error);
    }
    if (state.cleanupOverflow) failures.push(state.cleanupOverflow);
    const unique = [...new Set(failures)];
    if (unique.length) throw unique.slice(1).reduce((error, secondary) => addStorageFailureContext(error,
      {}, secondary, { secondaryPresent: true }), unique[0]);
  };

  const disablePool = (reason) => {
    if (isDisabled()) return;
    const backoffMs = Number.isFinite(config.crashBackoffMs)
      ? Math.max(0, config.crashBackoffMs)
      : 0;
    if (!backoffMs) return;
    const reasonText = typeof reason === 'string'
      ? reason
      : (reason?.message || String(reason || 'unknown error'));
    state.disabledUntil = Date.now() + backoffMs;
    state.crashCount = 0;
    state.crashWindowStart = 0;
    logOnce(`[python-ast] Crash loop detected; disabling pool for ${backoffMs}ms (${reasonText}).`, 'disabled');
    settlePendingJobs(reason);
    void shutdownWorkers().catch(error => logOnce(`[python-ast] Worker cleanup incomplete: ${error?.message || error}`, 'cleanup'));
  };

  const recordCrash = (reason) => {
    if (state.stopping || !reason) return;
    const windowMs = Number.isFinite(config.crashWindowMs) ? config.crashWindowMs : 0;
    const maxCrashes = Number.isFinite(config.crashLoopMax) ? config.crashLoopMax : 0;
    if (!windowMs || !maxCrashes) return;
    const now = Date.now();
    if (!state.crashWindowStart || now - state.crashWindowStart > windowMs) {
      state.crashWindowStart = now;
      state.crashCount = 0;
    }
    state.crashCount += 1;
    if (state.crashCount >= maxCrashes) {
      disablePool(reason);
    }
  };

  const requeueJob = (job, reason) => {
    if (state.stopping || isDisabled()) {
      job.resolve(null);
      return;
    }
    job.attempts = (job.attempts || 0) + 1;
    job.lastError = reason || null;
    if (job.attempts > config.maxRetries) {
      job.resolve(null);
      return;
    }
    job.queuedAt = Date.now();
    state.queue.unshift(job);
  };

  const detachWorker = (worker) => {
    state.workers = state.workers.filter((w) => w !== worker);
  };

  function finalizeWorkerRegistration(worker) {
    try {
      worker.readline?.close?.();
    } catch {}
    worker.readline = null;
    try {
      worker.unregisterChild?.();
    } catch {}
    worker.unregisterChild = null;
  }

  const handleWorkerExit = (worker, reason, options = {}) => {
    if (worker.exited) return;
    const pending = Array.from(worker.pending.values());
    worker.pending.clear();
    worker.busy = false;
    for (const job of pending) if (job.timer) clearTimeout(job.timer);
    const retirement = retireWorker(worker, { forceKill: options.forceKill === true });
    const recovery = retirement.then(() => {
      for (const job of pending) requeueJob(job, reason);
      if (!state.stopping && !isDisabled() && workerCount() < config.workerCount) spawnWorker();
      drainQueue();
    }, error => {
      for (const job of [...pending, ...state.queue.splice(0)]) job.reject(error);
    });
    recovery.catch(error => {
      observeCleanupFailure(error);
      for (const job of [...pending, ...state.queue.splice(0)]) job.reject(error);
    });
    if (reason && !state.stopping) {
      recordCrash(reason);
    }
  };

  const handleLine = (worker, line) => {
    let payload;
    try {
      payload = JSON.parse(line);
    } catch (err) {
      if (typeof log === 'function') {
        log(`[python-ast] Failed to parse worker output: ${String(err)}`);
      }
      return;
    }
    const job = worker.pending.get(payload.id);
    if (!job) return;
    if (job.timer) clearTimeout(job.timer);
    worker.pending.delete(payload.id);
    worker.busy = false;
    const result = payload?.result;
    if (payload?.error || result?.error) {
      job.resolve(null);
    } else {
      job.resolve(result || null);
    }
    drainQueue();
  };

  const spawnWorker = () => {
    if (state.stopping || isDisabled() || workerCount() >= config.maxWorkers) return null;
    const proc = spawn(pythonBin, ['-u', '-c', PYTHON_AST_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    });
    const unregisterChild = registerChildProcessForCleanup(proc, {
      killTree: true,
      detached: false
    });
    proc.unref();
    const worker = {
      id: state.workers.length + 1,
      proc,
      unregisterChild,
      pending: new Map(),
      busy: false,
      busySince: 0,
      exited: false,
      closeObserved: false,
      readline: null
    };
    worker.closed = new Promise(resolve => proc.once('close', () => { worker.closeObserved = true; resolve(); }));
    state.workers.push(worker);
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
    worker.readline = rl;
    rl.on('line', (line) => handleLine(worker, line));
    proc.on('error', (err) => handleWorkerExit(worker, err, { forceKill: true }));
    proc.on('exit', (code, signal) =>
      handleWorkerExit(worker, code ? new Error(`exit ${code}`) : signal)
    );
    proc.stderr.on('data', (chunk) => {
      if (typeof log === 'function' && !state.stopping) {
        log(`[python-ast] ${chunk.toString().trim()}`);
      }
    });
    return worker;
  };

  const assignJob = (worker, job) => {
    if (!worker || worker.exited) return;
    job.startedAt = Date.now();
    worker.busy = true;
    worker.busySince = job.startedAt;
    worker.pending.set(job.id, job);
    const payload = {
      id: job.id,
      text: job.text,
      dataflow: job.dataflow,
      controlFlow: job.controlFlow,
      path: job.path || null
    };
    try {
      worker.proc.stdin.write(`${JSON.stringify(payload)}\n`);
    } catch (err) {
      handleWorkerExit(worker, err, { forceKill: true });
      return;
    }
    job.timer = setTimeout(() => {
      handleWorkerExit(worker, new Error('timeout'), { forceKill: true });
    }, config.taskTimeoutMs);
  };

  const maybeScale = () => {
    if (isDisabled()) return;
    if (!state.queue.length) return;
    if (workerCount() >= config.maxWorkers) return;
    const oldestWaitMs = Date.now() - state.queue[0].queuedAt;
    if (oldestWaitMs < config.scaleUpQueueMs) return;
    spawnWorker();
  };

  const drainQueue = () => {
    if (state.stopping || isDisabled()) return;
    while (workerCount() < config.workerCount) {
      if (!spawnWorker()) break;
    }
    let idle = state.workers.find((worker) => !worker.busy && !worker.exited);
    while (idle && state.queue.length) {
      const job = state.queue.shift();
      assignJob(idle, job);
      idle = state.workers.find((worker) => !worker.busy && !worker.exited);
    }
    maybeScale();
  };

  for (let i = 0; i < config.workerCount; i += 1) {
    spawnWorker();
  }

  return {
    request(text, { dataflow, controlFlow, path }) {
      return new Promise((resolve, reject) => {
        if (state.cleanupOverflow) { reject(state.cleanupOverflow); return; }
        for (const [error, record] of state.cleanupErrors) {
          if (!record.observation.isSettled()) { reject(error); return; }
        }
        if (state.stopping) { resolve(null); return; }
        const maxTextBytes = Number.isFinite(config.maxTextBytes)
          ? config.maxTextBytes
          : null;
        const sourceText = typeof text === 'string' ? text : '';
        if (maxTextBytes && Buffer.byteLength(sourceText, 'utf8') > maxTextBytes) {
          if (path) {
            try {
              const stat = fs.statSync(path);
              if (stat.size > maxTextBytes) {
                logOnce('[python-ast] File too large; falling back to heuristic chunking.', 'payload');
                resolve(null);
                return;
              }
            } catch {
              logOnce('[python-ast] Failed to stat source file; falling back to heuristic chunking.', 'payload-stat');
              resolve(null);
              return;
            }
            text = null;
          } else {
            logOnce('[python-ast] Payload too large; falling back to heuristic chunking.', 'payload');
            resolve(null);
            return;
          }
        }
        if (isDisabled()) {
          const remaining = Math.max(0, state.disabledUntil - Date.now());
          logOnce(`[python-ast] Pool disabled for ${remaining}ms; falling back to heuristic chunking.`, 'disabled');
          resolve(null);
          return;
        }
        const pendingCount = state.queue.length + state.workers.reduce((sum, worker) => sum + worker.pending.size, 0);
        if (Number.isFinite(config.maxQueued) && pendingCount >= config.maxQueued) {
          logOnce('[python-ast] Queue backpressure triggered; falling back to heuristic chunking.', 'backpressure');
          resolve(null);
          return;
        }
        const job = {
          id: state.nextId++,
          text,
          dataflow,
          controlFlow,
          path,
          attempts: 0,
          queuedAt: Date.now(),
          resolve,
          reject
        };
        state.queue.push(job);
        drainQueue();
      });
    },
    async shutdown() {
      if (state.shutdownPromise) {
        await state.shutdownPromise;
        return;
      }
      state.stopping = true;
      state.shutdownPromise = (async () => {
        await shutdownWorkers();
      })();
      try {
        await state.shutdownPromise;
      } finally {
        state.shutdownPromise = null;
      }
    },
    isShutdownSettled: () => state.stopping && !state.workers.length && !state.retiringWorkers.size
      && !state.cleanupOverflow && [...state.cleanupErrors.values()].every(record => record.observation.isSettled())
  };
}

let pythonLifecycleTail=Promise.resolve();
let pythonGeneration=0;
let pythonShutdownPending=0;
const scopedPythonPools = createRunSharedResources({
  create: async ({ config, log }, { isNeeded }) => {
    const pythonBin = await findPythonExecutable(log);
    if (!pythonBin || !isNeeded()) return null;
    const pool = createPythonAstPool({ pythonBin, config, log });
    return { pool, close: pool.shutdown.bind(pool), isDisposed: pool.isShutdownSettled.bind(pool) };
  },
  dispose: resource => resource.close(), isDisposed: resource => resource.isDisposed()
});
const scopedPythonViews = new WeakMap();
const ensurePythonShutdownHooks = () => {
  if (pythonPoolHooked) return;
  pythonPoolHooked = true;
  process.once('exit', () => { void shutdownPythonAstPool().catch(() => {}); });
  attachCleanupSignalHandlers({ cleanup: () => { void shutdownPythonAstPool().catch(() => {}); } });
};
const serializePythonLifecycle=task=>{
  const pending=pythonLifecycleTail.then(task);
  pythonLifecycleTail=pending.catch(()=>{});
  return pending;
};
export async function getPythonAstPool(log,config={}){
  const normalized=normalizePythonAstConfig(config,config);
  const owner = currentRunResourceScope();
  owner?.assertAccepting();
  if(!normalized.enabled||pythonShutdownPending>0)return null;
  if (owner) {
    ensurePythonShutdownHooks();
    const resource = await scopedPythonPools.acquire(owner, JSON.stringify(normalized), { config: normalized, log });
    if (!resource) return null;
    let views = scopedPythonViews.get(owner);
    if (!views) { views = new WeakMap(); scopedPythonViews.set(owner, views); }
    let view = views.get(resource);
    if (!view) {
      view = Object.freeze({ request: (...args) => owner.track(() => resource.run(value => value.pool.request(...args))) });
      views.set(resource, view);
    }
    return view;
  }
  const generation=pythonGeneration;
  return serializePythonLifecycle(async()=>{
    if(generation!==pythonGeneration||pythonShutdownPending>0)return null;
    const pythonBin=await findPythonExecutable(log);
    if(!pythonBin||generation!==pythonGeneration||pythonShutdownPending>0)return null;
    const signature=JSON.stringify(normalized);
    if(!pythonPool||pythonPoolSignature!==signature){
      const previous=pythonPool;
      if(previous)await previous.shutdown();
      if(pythonPool===previous){pythonPool=null;pythonPoolSignature=null;}
      if(generation!==pythonGeneration||pythonShutdownPending>0)return null;
      pythonPool=createPythonAstPool({pythonBin,config:normalized,log});
      pythonPoolSignature=signature;
    }
    ensurePythonShutdownHooks();
    return pythonPool;
  });
}
export function shutdownPythonAstPool(){
  pythonGeneration+=1;
  pythonShutdownPending+=1;
  const legacy = serializePythonLifecycle(async()=>{
    const previous=pythonPool;
    if(previous)await previous.shutdown();
    if(pythonPool===previous){pythonPool=null;pythonPoolSignature=null;}
  });
  return Promise.allSettled([legacy, scopedPythonPools.shutdownAll()]).then(results => {
    const failures = results.filter(result => result.status === 'rejected').map(result => result.reason);
    if (failures.length) throw failures.slice(1).reduce((error, secondary) => addStorageFailureContext(error,
      {}, secondary, { secondaryPresent: true }), failures[0]);
  }).finally(()=>{pythonShutdownPending-=1;});
}
