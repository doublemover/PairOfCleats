import { resolveThreadLimits } from './threads.js';

const normalizeString = (value) => (typeof value === 'string' ? value.trim() : '');

/**
 * Coerce a value into a positive integer (or null).
 * @param {unknown} value
 * @returns {number|null}
 */
export const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
};

/**
 * Parse UV_THREADPOOL_SIZE from environment.
 * @param {object} env
 * @returns {number|null}
 */
export const parseUvThreadpoolSize = (env = {}) => {
  const raw = env?.UV_THREADPOOL_SIZE;
  return coercePositiveInt(raw);
};

/**
 * Parse NODE_OPTIONS into an argv-like list.
 * @param {object} env
 * @returns {string[]}
 */
export const parseNodeOptions = (env = {}) => {
  const raw = normalizeString(env?.NODE_OPTIONS);
  return raw || null;
};

/**
 * Resolve the effective --max-old-space-size from env/execArgv.
 * @param {{env?:object,execArgv?:string[]}} [input]
 * @returns {number|null}
 */
export const parseEffectiveMaxOldSpaceMb = ({ env = {}, execArgv = [] } = {}) => {
  const argv = Array.isArray(execArgv) ? execArgv : [];
  const nodeOptionsRaw = normalizeString(env?.NODE_OPTIONS || '');
  const nodeOptionsArgv = nodeOptionsRaw ? nodeOptionsRaw.split(/\s+/).filter(Boolean) : [];
  const args = [...argv, ...nodeOptionsArgv];
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

const findCliArg = (rawArgv, name) => Array.isArray(rawArgv)
  && rawArgv.some((arg) => arg === name || String(arg).startsWith(`${name}=`));

const makeSourcedValue = (value, source, detail) => ({
  value,
  source,
  ...(detail ? { detail } : {})
});

const resolveRequested = ({
  cli,
  cliPresent,
  cliDetail,
  config,
  configDetail,
  configSource = 'config',
  env,
  envDetail,
  fallback,
  fallbackSource
}) => {
  if (cliPresent) return makeSourcedValue(cli, 'cli', cliDetail);
  if (config != null) return makeSourcedValue(config, configSource || 'config', configDetail);
  if (env != null) return makeSourcedValue(env, 'env', envDetail);
  return makeSourcedValue(fallback, fallbackSource || 'default');
};

const clampUvThreadpool = (value) => {
  if (!Number.isFinite(value)) return null;
  return Math.max(1, Math.min(128, Math.floor(value)));
};

const buildNodeOptionsPatch = ({ base, requestedOptions, requestedMaxOldSpace }) => {
  const baseText = normalizeString(base);
  const extras = [];
  if (requestedOptions) {
    const trimmed = requestedOptions.trim();
    if (trimmed && !baseText.includes(trimmed)) {
      extras.push(trimmed);
    }
  }
  if (Number.isFinite(requestedMaxOldSpace) && requestedMaxOldSpace > 0) {
    const combined = [baseText, ...extras].join(' ');
    if (!combined.includes('--max-old-space-size')) {
      extras.push(`--max-old-space-size=${Math.floor(requestedMaxOldSpace)}`);
    }
  }
  const merged = [baseText, ...extras].filter(Boolean).join(' ').trim();
  return merged || null;
};

const pushWarning = (warnings, warning, limit = 20) => {
  if (!Array.isArray(warnings) || warnings.length >= limit) return;
  warnings.push(warning);
};

/**
 * Apply env var overrides to a base env map.
 * @param {object} baseEnv
 * @param {object} envPatch
 * @returns {object}
 */
export function applyEnvPatch(baseEnv, envPatch) {
  const env = { ...(baseEnv || {}) };
  const setEntries = envPatch?.set && typeof envPatch.set === 'object' ? envPatch.set : {};
  for (const [key, value] of Object.entries(setEntries)) {
    if (value == null) continue;
    env[key] = String(value);
  }
  if (envPatch?.nodeOptions) {
    env.NODE_OPTIONS = String(envPatch.nodeOptions);
  }
  return env;
}

/**
 * Build the runtime environment block from an envelope.
 * @param {object} envelope
 * @param {object} [baseEnv]
 * @returns {object}
 */
export function resolveRuntimeEnv(envelope, baseEnv = {}) {
  if (!envelope || typeof envelope !== 'object') return { ...(baseEnv || {}) };
  return applyEnvPatch(baseEnv, envelope.envPatch || {});
}

/**
 * Resolve a runtime envelope (thread limits, env, exec args).
 * @param {object} [input]
 * @returns {object}
 */
export function resolveRuntimeEnvelope(input = {}) {
  const {
    argv = {},
    rawArgv = [],
    userConfig = {},
    autoPolicy = null,
    env = {},
    execArgv = [],
    cpuCount: cpuCountInput,
    processInfo = null,
    toolVersion = null
  } = input;
  const resolvedEnv = env && typeof env === 'object' ? env : {};
  const resolvedExecArgv = Array.isArray(execArgv) ? execArgv : [];
  const resolvedProcessInfo = processInfo && typeof processInfo === 'object' ? processInfo : {};
  const resolvedCpuCount = Number.isFinite(cpuCountInput) && cpuCountInput > 0
    ? Math.floor(cpuCountInput)
    : (Number.isFinite(resolvedProcessInfo.cpuCount) ? Math.max(1, Math.floor(resolvedProcessInfo.cpuCount)) : 1);
  const runtimeConfig = userConfig.runtime || {};
  const indexingConfig = userConfig.indexing || {};
  const policyConcurrency = autoPolicy?.indexing?.concurrency || null;
  const configThreads = Number.isFinite(Number(userConfig.threads)) ? Number(userConfig.threads) : null;
  const configConcurrency = Number.isFinite(Number(indexingConfig.concurrency)) ? Number(indexingConfig.concurrency) : null;
  const configImportConcurrency = Number.isFinite(Number(indexingConfig.importConcurrency))
    ? Number(indexingConfig.importConcurrency)
    : null;
  const configIoConcurrencyCap = Number.isFinite(Number(indexingConfig.ioConcurrencyCap))
    ? Number(indexingConfig.ioConcurrencyCap)
    : null;
  const policyFileConcurrency = Number.isFinite(Number(policyConcurrency?.files))
    ? Number(policyConcurrency.files)
    : null;
  const policyImportConcurrency = Number.isFinite(Number(policyConcurrency?.imports))
    ? Number(policyConcurrency.imports)
    : null;
  const policyIoConcurrency = Number.isFinite(Number(policyConcurrency?.io))
    ? Number(policyConcurrency.io)
    : null;

  const envThreads = coercePositiveInt(resolvedEnv?.PAIROFCLEATS_THREADS);
  const envUvThreadpool = coercePositiveInt(resolvedEnv?.PAIROFCLEATS_UV_THREADPOOL_SIZE);
  const envMaxOldSpace = coercePositiveInt(resolvedEnv?.PAIROFCLEATS_MAX_OLD_SPACE_MB);
  const envNodeOptions = normalizeString(resolvedEnv?.PAIROFCLEATS_NODE_OPTIONS) || null;
  const envIoOversubscribeRaw = normalizeString(resolvedEnv?.PAIROFCLEATS_IO_OVERSUBSCRIBE);
  const envIoOversubscribe = envIoOversubscribeRaw ? envIoOversubscribeRaw === '1' || envIoOversubscribeRaw === 'true' : null;

  const cliThreads = coercePositiveInt(argv.threads);
  const cliThreadsPresent = findCliArg(rawArgv, '--threads');

  const resolvedConcurrencyConfig = configThreads ?? configConcurrency ?? policyFileConcurrency;
  const resolvedConcurrencySource = configThreads != null
    ? 'config'
    : configConcurrency != null
      ? 'config'
      : policyFileConcurrency != null
        ? 'autoPolicy'
        : 'default';
  const resolvedConcurrencyDetail = configThreads != null
    ? 'config.threads'
    : configConcurrency != null
      ? 'config.indexing.concurrency'
      : policyFileConcurrency != null
        ? 'autoPolicy.indexing.concurrency.files'
        : 'default';

  const requestedThreads = resolveRequested({
    cli: cliThreads,
    cliPresent: cliThreadsPresent,
    cliDetail: '--threads',
    config: resolvedConcurrencyConfig,
    configDetail: resolvedConcurrencyDetail,
    configSource: resolvedConcurrencySource,
    env: envThreads,
    envDetail: 'PAIROFCLEATS_THREADS',
    fallback: null,
    fallbackSource: 'default'
  });

  const requestedUvThreadpool = resolveRequested({
    cli: null,
    cliPresent: false,
    cliDetail: '--uv-threadpool-size',
    config: coercePositiveInt(runtimeConfig.uvThreadpoolSize),
    configDetail: 'config.runtime.uvThreadpoolSize',
    env: envUvThreadpool,
    envDetail: 'PAIROFCLEATS_UV_THREADPOOL_SIZE',
    fallback: clampUvThreadpool(Math.max(4, Math.ceil(resolvedCpuCount / 2))),
    fallbackSource: 'default'
  });

  const requestedMaxOldSpace = resolveRequested({
    cli: null,
    cliPresent: false,
    cliDetail: '--max-old-space-mb',
    config: coercePositiveInt(runtimeConfig.maxOldSpaceMb),
    configDetail: 'config.runtime.maxOldSpaceMb',
    env: envMaxOldSpace,
    envDetail: 'PAIROFCLEATS_MAX_OLD_SPACE_MB',
    fallback: null,
    fallbackSource: 'default'
  });

  const requestedNodeOptions = resolveRequested({
    cli: null,
    cliPresent: false,
    cliDetail: '--node-options',
    config: normalizeString(runtimeConfig.nodeOptions) || null,
    configDetail: 'config.runtime.nodeOptions',
    env: envNodeOptions,
    envDetail: 'PAIROFCLEATS_NODE_OPTIONS',
    fallback: null,
    fallbackSource: 'default'
  });

  const requestedIoOversubscribe = resolveRequested({
    cli: null,
    cliPresent: false,
    cliDetail: '--io-oversubscribe',
    config: typeof runtimeConfig.ioOversubscribe === 'boolean' ? runtimeConfig.ioOversubscribe : null,
    configDetail: 'config.runtime.ioOversubscribe',
    env: envIoOversubscribe,
    envDetail: 'PAIROFCLEATS_IO_OVERSUBSCRIBE',
    fallback: false,
    fallbackSource: 'default'
  });

  const warnings = [];
  const baseUvThreadpool = parseUvThreadpoolSize(resolvedEnv);
  const baseNodeOptions = parseNodeOptions(resolvedEnv) || '';
  const baseMaxOldSpace = parseEffectiveMaxOldSpaceMb({ env: resolvedEnv, execArgv: resolvedExecArgv });
  const canPatchNodeOptions = !baseNodeOptions;
  const requestedUvValue = clampUvThreadpool(requestedUvThreadpool.value);
  const effectiveUv = baseUvThreadpool
    ? makeSourcedValue(baseUvThreadpool, 'external-env', 'UV_THREADPOOL_SIZE')
    : (requestedUvValue
      ? makeSourcedValue(requestedUvValue, requestedUvThreadpool.source, requestedUvThreadpool.detail)
      : makeSourcedValue(4, 'default'));

  if (baseUvThreadpool && requestedUvValue && baseUvThreadpool !== requestedUvValue) {
    pushWarning(warnings, {
      code: 'runtime.envOverride',
      message: `UV_THREADPOOL_SIZE=${baseUvThreadpool} overrides requested ${requestedUvValue}.`,
      fields: ['runtime.uvThreadpoolSize']
    });
  }

  const nodeOptionsPatch = canPatchNodeOptions
    ? buildNodeOptionsPatch({
      base: baseNodeOptions,
      requestedOptions: requestedNodeOptions.value,
      requestedMaxOldSpace: requestedMaxOldSpace.value
    })
    : null;

  const effectiveNodeOptions = baseNodeOptions
    ? makeSourcedValue(baseNodeOptions, 'external-env', 'NODE_OPTIONS')
    : (nodeOptionsPatch
      ? makeSourcedValue(nodeOptionsPatch, requestedNodeOptions.source, requestedNodeOptions.detail)
      : makeSourcedValue(null, 'default'));

  if (Number.isFinite(baseMaxOldSpace) && Number.isFinite(requestedMaxOldSpace.value)
    && baseMaxOldSpace !== requestedMaxOldSpace.value) {
    pushWarning(warnings, {
      code: 'runtime.envOverride',
      message: `NODE_OPTIONS max-old-space-size=${baseMaxOldSpace} overrides requested ${requestedMaxOldSpace.value}.`,
      fields: ['runtime.maxOldSpaceMb']
    });
  }
  if (!canPatchNodeOptions && !Number.isFinite(baseMaxOldSpace) && Number.isFinite(requestedMaxOldSpace.value)) {
    pushWarning(warnings, {
      code: 'runtime.envOverride',
      message: 'NODE_OPTIONS prevents applying requested max-old-space-size.',
      fields: ['runtime.maxOldSpaceMb']
    });
  }
  if (baseNodeOptions && requestedNodeOptions.value && !baseNodeOptions.includes(requestedNodeOptions.value)) {
    pushWarning(warnings, {
      code: 'runtime.envOverride',
      message: 'NODE_OPTIONS overrides requested runtime.nodeOptions.',
      fields: ['runtime.nodeOptions']
    });
  }

  const effectiveMaxOldSpace = Number.isFinite(baseMaxOldSpace)
    ? makeSourcedValue(baseMaxOldSpace, 'external-env', 'NODE_OPTIONS')
    : (canPatchNodeOptions && Number.isFinite(requestedMaxOldSpace.value)
      ? makeSourcedValue(requestedMaxOldSpace.value, requestedMaxOldSpace.source, requestedMaxOldSpace.detail)
      : makeSourcedValue(null, 'default'));

  const threadLimits = resolveThreadLimits({
    argv: { threads: requestedThreads.value },
    rawArgv,
    envConfig: { threads: envThreads },
    configConcurrency: resolvedConcurrencyConfig,
    configConcurrencySource: resolvedConcurrencyDetail,
    configSourceTag: resolvedConcurrencySource,
    importConcurrencyConfig: configImportConcurrency ?? policyImportConcurrency ?? null,
    ioConcurrencyCapConfig: configIoConcurrencyCap ?? policyIoConcurrency ?? null,
    cpuCount: resolvedCpuCount,
    ioOversubscribe: requestedIoOversubscribe.value,
    uvThreadpoolSize: effectiveUv.value
  });

  const embeddingsConfig = indexingConfig.embeddings || {};
  const embeddingConcurrencyRaw = Number(embeddingsConfig.concurrency);
  let embeddingConcurrency = Number.isFinite(embeddingConcurrencyRaw) && embeddingConcurrencyRaw > 0
    ? Math.floor(embeddingConcurrencyRaw)
    : 0;
  if (!embeddingConcurrency) {
    const platform = resolvedProcessInfo.platform || '';
    const defaultEmbedding = platform === 'win32'
      ? Math.min(2, threadLimits.cpuConcurrency)
      : Math.min(4, threadLimits.cpuConcurrency);
    embeddingConcurrency = Math.max(1, defaultEmbedding);
  }
  embeddingConcurrency = Math.max(1, Math.min(embeddingConcurrency, threadLimits.cpuConcurrency));
  const providerRaw = normalizeString(embeddingsConfig.provider || '').toLowerCase();
  if (providerRaw === 'onnx') {
    const onnxConfig = embeddingsConfig.onnx || {};
    const onnxThreads = Math.max(
      1,
      Number(onnxConfig.intraOpNumThreads) || 0,
      Number(onnxConfig.interOpNumThreads) || 0
    );
    const maxConcurrency = Math.max(1, Math.floor(threadLimits.cpuConcurrency / onnxThreads));
    if (embeddingConcurrency > maxConcurrency) {
      embeddingConcurrency = maxConcurrency;
    }
  }

  const pendingDefaults = {
    io: Math.max(8, threadLimits.ioConcurrency * 4),
    cpu: Math.max(16, threadLimits.cpuConcurrency * 4),
    embedding: Math.max(16, embeddingConcurrency * 4)
  };

  const envPatch = {
    set: {},
    nodeOptions: nodeOptionsPatch || undefined
  };

  if (!baseUvThreadpool && requestedUvValue) {
    envPatch.set.UV_THREADPOOL_SIZE = String(requestedUvValue);
  }

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    process: {
      pid: Number.isFinite(resolvedProcessInfo.pid) ? resolvedProcessInfo.pid : null,
      argv: Array.isArray(rawArgv)
        ? rawArgv
        : (Array.isArray(resolvedProcessInfo.argv) ? resolvedProcessInfo.argv : []),
      execPath: resolvedProcessInfo.execPath || null,
      nodeVersion: resolvedProcessInfo.nodeVersion || null,
      platform: resolvedProcessInfo.platform || null,
      arch: resolvedProcessInfo.arch || null
    },
    toolVersion: toolVersion || null,
    runtime: {
      uvThreadpoolSize: {
        requested: requestedUvThreadpool,
        effective: effectiveUv
      },
      maxOldSpaceMb: {
        requested: requestedMaxOldSpace,
        effective: effectiveMaxOldSpace
      },
      nodeOptions: {
        requested: requestedNodeOptions,
        effective: effectiveNodeOptions
      },
      ioOversubscribe: makeSourcedValue(!!requestedIoOversubscribe.value, requestedIoOversubscribe.source, requestedIoOversubscribe.detail)
    },
    concurrency: {
      cpuCount: resolvedCpuCount,
      totalMemBytes: threadLimits.totalMemBytes,
      totalMemGiB: threadLimits.totalMemGiB,
      maxConcurrencyCap: threadLimits.maxConcurrencyCap,
      threads: makeSourcedValue(threadLimits.threads, threadLimits.source, threadLimits.sourceDetail),
      fileConcurrency: makeSourcedValue(threadLimits.fileConcurrency, threadLimits.source, threadLimits.sourceDetail),
      importConcurrency: makeSourcedValue(threadLimits.importConcurrency, threadLimits.source, threadLimits.sourceDetail),
      ioConcurrency: makeSourcedValue(threadLimits.ioConcurrency, threadLimits.source, threadLimits.sourceDetail),
      cpuConcurrency: makeSourcedValue(threadLimits.cpuConcurrency, threadLimits.source, threadLimits.sourceDetail),
      embeddingConcurrency: makeSourcedValue(embeddingConcurrency, threadLimits.source, threadLimits.sourceDetail)
    },
    queues: {
      io: { concurrency: threadLimits.ioConcurrency, maxPending: pendingDefaults.io },
      cpu: { concurrency: threadLimits.cpuConcurrency, maxPending: pendingDefaults.cpu },
      embedding: { concurrency: embeddingConcurrency, maxPending: pendingDefaults.embedding },
      proc: threadLimits.procConcurrency
        ? { concurrency: threadLimits.procConcurrency, maxPending: threadLimits.procConcurrency * 4 }
        : undefined
    },
    envPatch,
    warnings
  };
}
