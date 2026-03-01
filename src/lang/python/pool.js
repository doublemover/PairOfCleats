import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { createInterface } from 'node:readline';
import { PYTHON_AST_SCRIPT } from './ast-script.js';
import { findPythonExecutable } from './executable.js';
import { registerChildProcessForCleanup } from '../../shared/subprocess.js';
import { killChildProcessTree } from '../../shared/kill-tree.js';

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

function normalizePythonAstConfig(config = {}, options = {}) {
  if (config.enabled === false) return { enabled: false };
  const defaultMaxWorkers = Number.isFinite(options.defaultMaxWorkers)
    ? Math.max(1, Math.floor(options.defaultMaxWorkers))
    : PYTHON_AST_DEFAULTS.maxWorkers;
  const hardMaxWorkers = Number.isFinite(options.hardMaxWorkers)
    ? Math.max(1, Math.floor(options.hardMaxWorkers))
    : null;
  const allowOverCap = config.allowOverCap === true || options.allowOverCap === true;
  const workerCountRaw = Number(config.workerCount);
  const workerCount = Number.isFinite(workerCountRaw)
    ? Math.max(1, Math.floor(workerCountRaw))
    : Math.min(PYTHON_AST_DEFAULTS.workerCount, defaultMaxWorkers);
  const maxWorkersRaw = Number(config.maxWorkers);
  const requestedMax = Number.isFinite(maxWorkersRaw)
    ? Math.max(workerCount, Math.floor(maxWorkersRaw))
    : Math.max(workerCount, defaultMaxWorkers);
  const cappedMax = (!allowOverCap && Number.isFinite(hardMaxWorkers))
    ? Math.min(requestedMax, hardMaxWorkers)
    : requestedMax;
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
    queue: [],
    nextId: 1,
    stopping: false,
    disabledUntil: 0,
    crashCount: 0,
    crashWindowStart: 0,
    lastBackpressureLog: 0,
    lastDisabledLog: 0,
    lastPayloadLog: 0
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

  const shutdownWorkers = () => {
    for (const worker of state.workers) {
      killChildProcessTree(worker.proc, {
        killTree: true,
        detached: false,
        graceMs: 0,
        awaitGrace: false
      }).catch(() => {});
    }
    state.workers = [];
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
    for (const job of state.queue) {
      job.resolve(null);
    }
    state.queue = [];
    shutdownWorkers();
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
    if (isDisabled()) {
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

  const handleWorkerExit = (worker, reason, options = {}) => {
    if (worker.exited) return;
    try {
      worker.unregisterChild?.();
    } catch {}
    worker.unregisterChild = null;
    if (options.forceKill) {
      killChildProcessTree(worker.proc, {
        killTree: true,
        detached: false,
        graceMs: 0,
        awaitGrace: false
      }).catch(() => {});
    }
    worker.exited = true;
    const pending = Array.from(worker.pending.values());
    worker.pending.clear();
    worker.busy = false;
    detachWorker(worker);
    for (const job of pending) {
      if (job.timer) clearTimeout(job.timer);
      requeueJob(job, reason);
    }
    if (reason && !state.stopping) {
      recordCrash(reason);
    }
    if (!state.stopping && !isDisabled() && state.workers.length < config.workerCount) {
      spawnWorker();
    }
    drainQueue();
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
    if (state.stopping || isDisabled()) return null;
    const proc = spawn(pythonBin, ['-u', '-c', PYTHON_AST_SCRIPT], {
      stdio: ['pipe', 'pipe', 'pipe']
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
      exited: false
    };
    state.workers.push(worker);
    const rl = createInterface({ input: proc.stdout, crlfDelay: Infinity });
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
    if (state.workers.length >= config.maxWorkers) return;
    const oldestWaitMs = Date.now() - state.queue[0].queuedAt;
    if (oldestWaitMs < config.scaleUpQueueMs) return;
    spawnWorker();
  };

  const drainQueue = () => {
    if (state.stopping || isDisabled()) return;
    while (state.workers.length < config.workerCount) {
      spawnWorker();
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
      return new Promise((resolve) => {
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
          resolve
        };
        state.queue.push(job);
        drainQueue();
      });
    },
    shutdown() {
      state.stopping = true;
      shutdownWorkers();
      state.queue = [];
    }
  };
}

export async function getPythonAstPool(log, config = {}) {
  const normalized = normalizePythonAstConfig(config, config);
  if (!normalized.enabled) return null;
  const pythonBin = await findPythonExecutable(log);
  if (!pythonBin) return null;
  const signature = JSON.stringify(normalized);
  if (!pythonPool || pythonPoolSignature !== signature) {
    if (pythonPool) pythonPool.shutdown();
    pythonPool = createPythonAstPool({ pythonBin, config: normalized, log });
    pythonPoolSignature = signature;
  }
  if (!pythonPoolHooked) {
    pythonPoolHooked = true;
    process.once('exit', () => pythonPool?.shutdown());
    process.once('SIGINT', () => pythonPool?.shutdown());
    process.once('SIGTERM', () => pythonPool?.shutdown());
  }
  return pythonPool;
}

export function shutdownPythonAstPool() {
  if (pythonPool) {
    pythonPool.shutdown();
    pythonPool = null;
    pythonPoolSignature = null;
  }
}
