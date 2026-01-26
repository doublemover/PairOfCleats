import os from 'node:os';

const normalizeEnabled = (raw) => {
  if (raw === true || raw === false) return raw;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'auto') return 'auto';
  return 'auto';
};

export const buildWorkerExecArgv = () => process.execArgv.filter((arg) => {
  if (!arg) return false;
  return !arg.startsWith('--max-old-space-size')
    && !arg.startsWith('--max-semi-space-size');
});

export const resolveMemoryWorkerCap = (requested) => {
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (!Number.isFinite(requested) || requested <= 0) return null;
  if (!Number.isFinite(totalMemMb) || totalMemMb <= 0) return null;
  const cap = Math.max(1, Math.floor(totalMemMb / 4096));
  return Math.min(requested, cap);
};

const parseMaxOldSpaceMb = () => {
  // process.execArgv does NOT include NODE_OPTIONS. Since we often set
  // --max-old-space-size via NODE_OPTIONS (e.g. from user/runtime config),
  // include both sources when inferring the heap budget.
  const execArgv = Array.isArray(process.execArgv) ? process.execArgv : [];
  const nodeOptionsRaw = typeof process.env.NODE_OPTIONS === 'string'
    ? process.env.NODE_OPTIONS
    : '';
  const nodeOptionsArgv = nodeOptionsRaw
    ? nodeOptionsRaw.split(/\s+/).filter(Boolean)
    : [];
  const args = [...execArgv, ...nodeOptionsArgv];
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
    if (arg === '--max-old-space-size') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value > 0) return Math.floor(value);
    }
  }
  return null;
};

export const resolveWorkerResourceLimits = (maxWorkers) => {
  const workerCount = Math.max(1, Math.floor(Number(maxWorkers) || 0));
  if (!Number.isFinite(workerCount) || workerCount <= 0) return null;

  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  const maxOldSpaceMb = parseMaxOldSpaceMb();

  // Budget worker heaps based on either the explicitly configured
  // --max-old-space-size or a conservative fraction of system RAM.
  //
  // Important: this value is an upper bound per worker, not a reservation.
  // The pool previously used a hard 8GB basis cap and then divided by
  // (workers * 2), which could yield extremely small per-worker heaps on
  // high-concurrency machines (e.g. 256MB with 16 workers). That is too small
  // for multi-language parsing workloads and can trigger V8 "Zone" OOMs even
  // when the process RSS is low.
  let budgetMb = null;
  if (Number.isFinite(maxOldSpaceMb) && maxOldSpaceMb > 0) {
    // If the user explicitly configured a heap budget, keep it as the sizing
    // basis (we still apply a physical-RAM cap below).
    budgetMb = Math.floor(maxOldSpaceMb);
  } else if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    // Without an explicit heap budget, stay conservative by default.
    const defaultBasisCapMb = 8192;
    budgetMb = Math.min(defaultBasisCapMb, Math.floor(totalMemMb * 0.75));
  }
  if (!Number.isFinite(budgetMb) || budgetMb <= 0) return null;

  // Avoid fully consuming physical memory; leave headroom for the main process
  // and native allocations (SQLite, WASM, model runtimes, etc.).
  if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    const hardCap = Math.max(1024, Math.floor(totalMemMb * 0.9));
    budgetMb = Math.min(budgetMb, hardCap);
  }

  // Split the budget across workers while leaving one "share" for the main
  // process.
  const perWorker = Math.floor(budgetMb / (workerCount + 1));
  const minMb = 256;
  const platformCap = process.platform === 'win32' ? 8192 : 16384;
  const capped = Math.max(minMb, Math.min(platformCap, perWorker));
  return { maxOldGenerationSizeMb: capped };
};

/**
 * Normalize worker pool configuration.
 * @param {object} raw
 * @param {{cpuLimit?:number}} options
 * @returns {object}
 */
export function normalizeWorkerPoolConfig(raw = {}, options = {}) {
  const enabled = normalizeEnabled(raw.enabled);
  const cpuLimit = Number.isFinite(options.cpuLimit)
    ? Math.max(1, Math.floor(options.cpuLimit))
    : Math.max(1, os.cpus().length * 4);
  const defaultMaxWorkers = Number.isFinite(options.defaultMaxWorkers)
    ? Math.max(1, Math.floor(options.defaultMaxWorkers))
    : Math.max(1, cpuLimit);
  const hardMaxWorkers = Number.isFinite(options.hardMaxWorkers)
    ? Math.max(1, Math.floor(options.hardMaxWorkers))
    : null;
  const maxWorkersRaw = Number(raw.maxWorkers);
  const allowOverCap = raw.allowOverCap === true || options.allowOverCap === true;
  const requestedMax = Number.isFinite(maxWorkersRaw) && maxWorkersRaw > 0
    ? Math.max(1, Math.floor(maxWorkersRaw))
    : defaultMaxWorkers;
  const cappedMax = (!allowOverCap && Number.isFinite(hardMaxWorkers))
    ? Math.min(requestedMax, hardMaxWorkers)
    : requestedMax;
  const maxWorkers = Math.max(1, cappedMax);
  const maxFileBytesRaw = raw.maxFileBytes;
  let maxFileBytes = 512 * 1024;
  if (maxFileBytesRaw === false || maxFileBytesRaw === 0) {
    maxFileBytes = null;
  } else {
    const maxFileBytesParsed = Number(maxFileBytesRaw);
    if (Number.isFinite(maxFileBytesParsed) && maxFileBytesParsed > 0) {
      maxFileBytes = Math.floor(maxFileBytesParsed);
    }
  }
  const idleTimeoutMsRaw = Number(raw.idleTimeoutMs);
  const idleTimeoutMs = Number.isFinite(idleTimeoutMsRaw) && idleTimeoutMsRaw > 0
    ? Math.floor(idleTimeoutMsRaw)
    : 30000;
  const taskTimeoutMsRaw = Number(raw.taskTimeoutMs);
  const taskTimeoutMs = Number.isFinite(taskTimeoutMsRaw) && taskTimeoutMsRaw > 0
    ? Math.floor(taskTimeoutMsRaw)
    : 60000;
  const quantizeBatchRaw = Number(raw.quantizeBatchSize);
  const quantizeBatchSize = Number.isFinite(quantizeBatchRaw) && quantizeBatchRaw > 0
    ? Math.floor(quantizeBatchRaw)
    : 128;
  const splitByTask = raw.splitByTask === true || raw.splitTasks === true;
  const quantizeMaxWorkersRaw = Number(raw.quantizeMaxWorkers);
  const quantizeMaxWorkers = Number.isFinite(quantizeMaxWorkersRaw) && quantizeMaxWorkersRaw > 0
    ? Math.max(1, Math.floor(quantizeMaxWorkersRaw))
    : null;
  return {
    enabled,
    maxWorkers,
    maxFileBytes,
    idleTimeoutMs,
    taskTimeoutMs,
    quantizeBatchSize,
    splitByTask,
    quantizeMaxWorkers
  };
}

/**
 * Resolve worker pool configuration with environment overrides.
 * @param {object} raw
 * @param {{workerPool?:string}|null} envConfig
 * @param {{cpuLimit?:number}} [options]
 * @returns {object}
 */
export function resolveWorkerPoolConfig(raw = {}, envConfig = null, options = {}) {
  const config = normalizeWorkerPoolConfig(raw, options);
  const override = typeof envConfig?.workerPool === 'string'
    ? envConfig.workerPool.trim().toLowerCase()
    : '';
  if (override) {
    if (['0', 'false', 'off', 'disable', 'disabled'].includes(override)) {
      config.enabled = false;
    } else if (['1', 'true', 'on', 'enable', 'enabled'].includes(override)) {
      config.enabled = true;
    } else if (override === 'auto') {
      config.enabled = 'auto';
    }
  }
  return config;
}
