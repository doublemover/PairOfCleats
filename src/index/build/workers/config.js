import os from 'node:os';
import { getEnvConfig } from '../../../shared/env.js';
import { coerceClampedFraction, coercePositiveIntMinOne } from '../../../shared/number-coerce.js';

const normalizeEnabled = (raw) => {
  if (raw === true || raw === false) return raw;
  const value = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'auto') return 'auto';
  return 'auto';
};

const coerceNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const WORKER_HEAP_TARGET_MIN_MB = 1024;
const WORKER_HEAP_TARGET_DEFAULT_MB = 1536;
const WORKER_HEAP_TARGET_MAX_MB = 2048;
const NUMA_PINNING_STRATEGIES = new Set(['interleave', 'compact']);
const DEFAULT_PRESSURE_THROTTLE_HEAVY_LANGUAGES = Object.freeze([
  'clike',
  'cpp',
  'swift',
  'rust',
  'java',
  'kotlin',
  'typescript',
  'tsx'
]);

/**
 * Downscale worker count only when both signals indicate sustained pressure.
 * This avoids reducing concurrency for transient RSS spikes or GC-only blips.
 *
 * @param {object} input
 * @param {number} input.rssPressure
 * @param {number} input.gcPressure
 * @param {number} input.rssThreshold
 * @param {number} input.gcThreshold
 * @returns {boolean}
 */
export const shouldDownscaleWorkersForPressure = ({
  rssPressure,
  gcPressure,
  rssThreshold,
  gcThreshold
}) => Number.isFinite(rssPressure)
    && Number.isFinite(gcPressure)
    && Number.isFinite(rssThreshold)
    && Number.isFinite(gcThreshold)
    && rssPressure >= rssThreshold
    && gcPressure >= gcThreshold;

/**
 * Build worker `execArgv` by removing parent heap flags so worker limits can
 * be controlled explicitly through `resourceLimits`.
 *
 * @returns {string[]}
 */
export const buildWorkerExecArgv = () => process.execArgv.filter((arg) => {
  if (!arg) return false;
  return !arg.startsWith('--max-old-space-size')
    && !arg.startsWith('--max-semi-space-size');
});

/**
 * Cap requested worker count from total host memory to avoid pathological
 * over-provisioning on memory-constrained machines.
 *
 * @param {number} requested
 * @returns {number|null}
 */
export const resolveMemoryWorkerCap = (requested) => {
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  if (!Number.isFinite(requested) || requested <= 0) return null;
  if (!Number.isFinite(totalMemMb) || totalMemMb <= 0) return null;
  const cap = Math.max(1, Math.floor(totalMemMb / 4096));
  return Math.min(requested, cap);
};

/**
 * Resolve the target per-worker heap policy used for heavy indexing stages.
 * Defaults intentionally bias to 1-2GB per worker when host memory allows.
 *
 * @param {object} [options]
 * @param {number} [options.targetPerWorkerMb]
 * @param {number} [options.minPerWorkerMb]
 * @param {number} [options.maxPerWorkerMb]
 * @returns {{targetPerWorkerMb:number,minPerWorkerMb:number,maxPerWorkerMb:number}}
 */
export const resolveWorkerHeapBudgetPolicy = (options = {}) => {
  const envConfig = options?.envConfig && typeof options.envConfig === 'object'
    ? options.envConfig
    : getEnvConfig();
  const envTargetMb = coercePositiveIntMinOne(envConfig?.workerPoolHeapTargetMb);
  const envMinMb = coercePositiveIntMinOne(envConfig?.workerPoolHeapMinMb);
  const envMaxMb = coercePositiveIntMinOne(envConfig?.workerPoolHeapMaxMb);
  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  const autoTargetMb = Number.isFinite(totalMemMb) && totalMemMb >= 65536
    ? WORKER_HEAP_TARGET_MAX_MB
    : Number.isFinite(totalMemMb) && totalMemMb >= 24576
      ? WORKER_HEAP_TARGET_DEFAULT_MB
      : WORKER_HEAP_TARGET_MIN_MB;
  const minPerWorkerMb = coercePositiveIntMinOne(options.minPerWorkerMb)
    || envMinMb
    || WORKER_HEAP_TARGET_MIN_MB;
  const maxPerWorkerMb = Math.max(
    minPerWorkerMb,
    Math.min(
      process.platform === 'win32' ? 8192 : 16384,
      coercePositiveIntMinOne(options.maxPerWorkerMb) || envMaxMb || WORKER_HEAP_TARGET_MAX_MB
    )
  );
  const targetPerWorkerMb = Math.max(
    minPerWorkerMb,
    Math.min(
      maxPerWorkerMb,
      coercePositiveIntMinOne(options.targetPerWorkerMb) || envTargetMb || autoTargetMb || WORKER_HEAP_TARGET_DEFAULT_MB
    )
  );
  return {
    targetPerWorkerMb,
    minPerWorkerMb,
    maxPerWorkerMb
  };
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
  let resolved = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (typeof arg !== 'string') continue;
    if (arg.startsWith('--max-old-space-size=')) {
      const value = Number(arg.split('=')[1]);
      if (Number.isFinite(value) && value > 0) {
        const mb = Math.floor(value);
        resolved = resolved == null ? mb : Math.min(resolved, mb);
      }
    }
    if (arg === '--max-old-space-size') {
      const value = Number(args[i + 1]);
      if (Number.isFinite(value) && value > 0) {
        const mb = Math.floor(value);
        resolved = resolved == null ? mb : Math.min(resolved, mb);
      }
    }
  }
  return resolved;
};

/**
 * Resolve per-worker V8 heap limits for Piscina based on worker count, host
 * RAM, explicit heap flags, and optional per-worker targets.
 *
 * @param {number} maxWorkers
 * @param {object} [options]
 * @param {number} [options.targetPerWorkerMb]
 * @param {number} [options.minPerWorkerMb]
 * @param {number} [options.maxPerWorkerMb]
 * @returns {{maxOldGenerationSizeMb:number}|null}
 */
export const resolveWorkerResourceLimits = (maxWorkers, options = {}) => {
  const workerCount = Math.max(1, Math.floor(Number(maxWorkers) || 0));
  if (!Number.isFinite(workerCount) || workerCount <= 0) return null;

  const totalMemMb = Math.floor(os.totalmem() / (1024 * 1024));
  const maxOldSpaceMb = parseMaxOldSpaceMb();
  const explicitProcessHeapBudget = Number.isFinite(maxOldSpaceMb) && maxOldSpaceMb > 0;
  const heapPolicy = resolveWorkerHeapBudgetPolicy(options);
  const targetPerWorkerMb = heapPolicy.targetPerWorkerMb;
  const minPerWorkerMb = heapPolicy.minPerWorkerMb;
  const maxPerWorkerMb = heapPolicy.maxPerWorkerMb;

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
  if (explicitProcessHeapBudget) {
    // If the user explicitly configured a heap budget, keep it as the sizing
    // basis (we still apply a physical-RAM cap below).
    budgetMb = Math.floor(maxOldSpaceMb);
  } else if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    // Without an explicit heap budget, allow a larger basis so each worker can
    // run with 1-2GB heaps on large hosts without artificial throttling.
    const defaultBasisCapMb = 32768;
    budgetMb = Math.min(defaultBasisCapMb, Math.floor(totalMemMb * 0.8));
  }
  if (!Number.isFinite(budgetMb) || budgetMb <= 0) return null;

  // Avoid fully consuming physical memory; leave headroom for the main process
  // and native allocations (SQLite, parser runtimes, model runtimes, etc.).
  if (Number.isFinite(totalMemMb) && totalMemMb > 0) {
    const hardCap = Math.max(1024, Math.floor(totalMemMb * 0.9));
    budgetMb = Math.min(budgetMb, hardCap);
  }

  // Split the budget across workers while leaving one "share" for the main
  // process.
  const perWorkerBudgetRawMb = Math.floor(budgetMb / (workerCount + 1));
  // Keep resource limits active even when the split budget underflows.
  // Returning `null` here removes worker caps entirely in Piscina.
  const perWorkerBudgetMb = Number.isFinite(perWorkerBudgetRawMb) && perWorkerBudgetRawMb > 0
    ? perWorkerBudgetRawMb
    : 1;
  const autoTargetMb = Number.isFinite(totalMemMb) && totalMemMb >= 65536
    ? WORKER_HEAP_TARGET_MAX_MB
    : Number.isFinite(totalMemMb) && totalMemMb >= 24576
      ? WORKER_HEAP_TARGET_DEFAULT_MB
      : WORKER_HEAP_TARGET_MIN_MB;
  const boostedBudgetTargetMb = perWorkerBudgetMb > 0
    ? Math.floor(perWorkerBudgetMb * 1.25)
    : autoTargetMb;
  const desiredTargetMb = Math.min(
    targetPerWorkerMb || autoTargetMb,
    boostedBudgetTargetMb
  );
  const platformCap = process.platform === 'win32' ? 8192 : 16384;
  const policyMinMb = Math.max(256, minPerWorkerMb || WORKER_HEAP_TARGET_MIN_MB);
  const policyMaxMb = Math.max(
    policyMinMb,
    Math.min(platformCap, maxPerWorkerMb || WORKER_HEAP_TARGET_MAX_MB)
  );
  // Never let per-worker heap ceilings exceed the derived per-worker budget.
  // This prevents worker aggregate limits from oversubscribing host/process
  // memory budgets on high-worker-count or memory-constrained hosts.
  const effectiveMaxMb = Math.max(1, Math.min(policyMaxMb, perWorkerBudgetMb));
  const effectiveMinMb = Math.min(policyMinMb, effectiveMaxMb);
  const capped = Math.max(
    effectiveMinMb,
    Math.min(effectiveMaxMb, desiredTargetMb)
  );
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
  let maxFileBytes = 2 * 1024 * 1024;
  if (maxFileBytesRaw === false || maxFileBytesRaw === 0) {
    maxFileBytes = null;
  } else {
    const maxFileBytesParsed = Number(maxFileBytesRaw);
    if (Number.isFinite(maxFileBytesParsed) && maxFileBytesParsed > 0) {
      maxFileBytes = Math.floor(maxFileBytesParsed);
    }
  }
  const minFileBytesRaw = raw.minFileBytes;
  let minFileBytes = 4 * 1024;
  if (minFileBytesRaw === false || minFileBytesRaw === 0) {
    minFileBytes = null;
  } else {
    const minFileBytesParsed = Number(minFileBytesRaw);
    if (Number.isFinite(minFileBytesParsed) && minFileBytesParsed > 0) {
      minFileBytes = Math.floor(minFileBytesParsed);
    }
  }
  if (Number.isFinite(minFileBytes) && Number.isFinite(maxFileBytes) && minFileBytes > maxFileBytes) {
    minFileBytes = maxFileBytes;
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
  const heapTargetMb = coercePositiveIntMinOne(raw.heapTargetMb);
  const heapMinMb = coercePositiveIntMinOne(raw.heapMinMb);
  const heapMaxMb = coercePositiveIntMinOne(raw.heapMaxMb);
  const normalizedHeapMinMb = heapMinMb != null && heapMaxMb != null
    ? Math.min(heapMinMb, heapMaxMb)
    : heapMinMb;
  const normalizedHeapMaxMb = heapMaxMb != null && normalizedHeapMinMb != null
    ? Math.max(heapMaxMb, normalizedHeapMinMb)
    : heapMaxMb;
  const autoDownscaleOnPressure = raw.autoDownscaleOnPressure !== false;
  const downscaleRssThreshold = coerceClampedFraction(
    raw.downscaleRssThreshold,
    { min: 0.5, max: 0.99, allowZero: false }
  ) ?? 0.9;
  const downscaleGcThreshold = coerceClampedFraction(
    raw.downscaleGcThreshold,
    { min: 0.5, max: 0.99, allowZero: false }
  ) ?? 0.85;
  const downscaleCooldownMsRaw = Number(raw.downscaleCooldownMs);
  const downscaleCooldownMs = Number.isFinite(downscaleCooldownMsRaw) && downscaleCooldownMsRaw > 0
    ? Math.max(1000, Math.floor(downscaleCooldownMsRaw))
    : 15000;
  const downscaleMinWorkersRaw = coercePositiveIntMinOne(raw.downscaleMinWorkers);
  const downscaleMinWorkers = downscaleMinWorkersRaw != null
    ? Math.max(1, Math.min(maxWorkers, downscaleMinWorkersRaw))
    : Math.max(1, Math.floor(maxWorkers * 0.5));
  const memoryWatermarkSoft = coerceClampedFraction(
    raw.memoryWatermarkSoft,
    { min: 0.7, max: 0.995, allowZero: false }
  ) ?? 0.97;
  const configuredMemoryWatermarkHard = coerceClampedFraction(
    raw.memoryWatermarkHard,
    { min: 0.75, max: 0.999, allowZero: false }
  ) ?? 0.992;
  const memoryWatermarkHard = Math.min(
    0.999,
    Math.max(memoryWatermarkSoft + 0.01, configuredMemoryWatermarkHard)
  );
  const pressureThrottleConfig = raw.pressureLanguageThrottle
    && typeof raw.pressureLanguageThrottle === 'object'
    ? raw.pressureLanguageThrottle
    : {};
  const heavyLanguages = Array.from(new Set(
    (Array.isArray(pressureThrottleConfig.heavyLanguages)
      ? pressureThrottleConfig.heavyLanguages
      : DEFAULT_PRESSURE_THROTTLE_HEAVY_LANGUAGES)
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => entry.trim().toLowerCase())
  ));
  const softMaxPerLanguage = coercePositiveIntMinOne(
    pressureThrottleConfig.softMaxPerLanguage
  ) ?? Math.max(2, Math.min(maxWorkers, Math.max(4, Math.floor(maxWorkers * 0.85))));
  const hardMaxPerLanguageRaw = coerceNonNegativeInt(
    pressureThrottleConfig.hardMaxPerLanguage
  );
  const hardMaxPerLanguage = Math.min(
    softMaxPerLanguage,
    hardMaxPerLanguageRaw ?? Math.max(1, Math.floor(softMaxPerLanguage * 0.5))
  );
  const pressureCacheMaxEntries = coercePositiveIntMinOne(raw.pressureCacheMaxEntries) ?? 2048;
  const blockHeavyOnHardPressure = pressureThrottleConfig.blockHeavyOnHardPressure !== false;
  const numaConfig = raw?.numaPinning && typeof raw.numaPinning === 'object'
    ? raw.numaPinning
    : {};
  const numaStrategyRaw = typeof numaConfig.strategy === 'string'
    ? numaConfig.strategy.trim().toLowerCase()
    : '';
  const numaStrategy = NUMA_PINNING_STRATEGIES.has(numaStrategyRaw)
    ? numaStrategyRaw
    : 'interleave';
  const numaMinCpuCores = coercePositiveIntMinOne(numaConfig.minCpuCores) || 24;
  const numaNodeCount = coercePositiveIntMinOne(numaConfig.nodeCount);
  const numaEnabled = numaConfig.enabled === true;
  return {
    enabled,
    maxWorkers,
    maxFileBytes,
    minFileBytes,
    idleTimeoutMs,
    taskTimeoutMs,
    quantizeBatchSize,
    splitByTask,
    quantizeMaxWorkers,
    heapTargetMb,
    heapMinMb: normalizedHeapMinMb,
    heapMaxMb: normalizedHeapMaxMb,
    autoDownscaleOnPressure,
    downscaleRssThreshold,
    downscaleGcThreshold,
    downscaleCooldownMs,
    downscaleMinWorkers,
    memoryPressure: {
      watermarkSoft: memoryWatermarkSoft,
      watermarkHard: memoryWatermarkHard,
      cacheMaxEntries: pressureCacheMaxEntries,
      languageThrottle: {
        enabled: pressureThrottleConfig.enabled !== false,
        heavyLanguages,
        softMaxPerLanguage,
        hardMaxPerLanguage,
        blockHeavyOnHardPressure
      }
    },
    numaPinning: {
      enabled: numaEnabled,
      strategy: numaStrategy,
      minCpuCores: numaMinCpuCores,
      nodeCount: numaNodeCount
    }
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
  const hardMaxWorkers = Number.isFinite(options?.hardMaxWorkers)
    ? Math.max(1, Math.floor(options.hardMaxWorkers))
    : null;
  if (override) {
    if (['0', 'false', 'off', 'disable', 'disabled'].includes(override)) {
      config.enabled = false;
    } else if (['1', 'true', 'on', 'enable', 'enabled'].includes(override)) {
      config.enabled = true;
    } else if (override === 'auto') {
      config.enabled = 'auto';
    }
  }
  const maxWorkersOverride = coercePositiveIntMinOne(envConfig?.workerPoolMaxWorkers);
  if (maxWorkersOverride != null) {
    config.maxWorkers = hardMaxWorkers != null
      ? Math.min(maxWorkersOverride, hardMaxWorkers)
      : maxWorkersOverride;
  }
  const heapTargetOverride = coercePositiveIntMinOne(envConfig?.workerPoolHeapTargetMb);
  const heapMinOverride = coercePositiveIntMinOne(envConfig?.workerPoolHeapMinMb);
  const heapMaxOverride = coercePositiveIntMinOne(envConfig?.workerPoolHeapMaxMb);
  if (heapTargetOverride != null) config.heapTargetMb = heapTargetOverride;
  if (heapMinOverride != null) config.heapMinMb = heapMinOverride;
  if (heapMaxOverride != null) config.heapMaxMb = heapMaxOverride;
  if (config.heapMinMb != null && config.heapMaxMb != null && config.heapMinMb > config.heapMaxMb) {
    const nextMin = Math.min(config.heapMinMb, config.heapMaxMb);
    const nextMax = Math.max(config.heapMinMb, config.heapMaxMb);
    config.heapMinMb = nextMin;
    config.heapMaxMb = nextMax;
  }
  return config;
}
