import {
  coerceNonNegativeInt,
  coercePositiveInt,
  coerceUnitFraction
} from '../../../shared/number-coerce.js';

const normalizeBoolean = (value) => value === true || value === 'true' || value === '1';

const normalizeOptionalBoolean = (value) => {
  if (value == null) return null;
  return normalizeBoolean(value);
};

const hasCliArg = (rawArgv, name) => Array.isArray(rawArgv)
  && rawArgv.some((arg) => arg === name || String(arg).startsWith(`${name}=`));

const resolveBoolean = ({ cliValue, cliPresent, envValue, configValue, fallback }) => {
  if (cliPresent) return normalizeBoolean(cliValue);
  if (envValue != null) return envValue === true;
  if (typeof configValue === 'boolean') return configValue;
  return fallback;
};

const resolveNumber = ({ cliValue, cliPresent, envValue, configValue, fallback, allowZero = true }) => {
  if (cliPresent) {
    const parsed = allowZero ? coerceNonNegativeInt(cliValue) : coercePositiveInt(cliValue);
    if (parsed != null) return parsed;
  }
  if (envValue != null) {
    const parsed = allowZero ? coerceNonNegativeInt(envValue) : coercePositiveInt(envValue);
    if (parsed != null) return parsed;
  }
  if (configValue != null) {
    const parsed = allowZero ? coerceNonNegativeInt(configValue) : coercePositiveInt(configValue);
    if (parsed != null) return parsed;
  }
  return fallback;
};

const resolveQueueConfig = (value) => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const resolved = {};
  for (const [name, config] of Object.entries(value)) {
    if (!config || typeof config !== 'object') continue;
    const priority = coerceNonNegativeInt(config.priority);
    const maxPending = coercePositiveInt(config.maxPending);
    const weight = coercePositiveInt(config.weight);
    const floorCpu = coerceNonNegativeInt(config.floorCpu);
    const floorIo = coerceNonNegativeInt(config.floorIo);
    const floorMem = coerceNonNegativeInt(config.floorMem);
    resolved[name] = {
      ...(priority != null ? { priority } : {}),
      ...(maxPending != null ? { maxPending } : {}),
      ...(weight != null ? { weight } : {}),
      ...(floorCpu != null ? { floorCpu } : {}),
      ...(floorIo != null ? { floorIo } : {}),
      ...(floorMem != null ? { floorMem } : {})
    };
  }
  return resolved;
};

const DEFAULT_WRITE_BACKPRESSURE = Object.freeze({
  enabled: true,
  writeQueue: 'stage2.write',
  producerQueues: Object.freeze([
    'stage1.cpu',
    'stage1.io',
    'stage1.postings',
    'stage2.relations',
    'stage2.relations.io'
  ]),
  pendingThreshold: 128,
  pendingBytesThreshold: 256 * 1024 * 1024,
  oldestWaitMsThreshold: 15000
});

const resolveWriteBackpressureConfig = (value) => {
  const config = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const writeQueue = typeof config.writeQueue === 'string' && config.writeQueue.trim()
    ? config.writeQueue.trim()
    : DEFAULT_WRITE_BACKPRESSURE.writeQueue;
  const producerQueues = Array.isArray(config.producerQueues)
    ? config.producerQueues
      .filter((entry) => typeof entry === 'string' && entry.trim())
      .map((entry) => entry.trim())
    : Array.from(DEFAULT_WRITE_BACKPRESSURE.producerQueues);
  const pendingThreshold = coercePositiveInt(config.pendingThreshold)
    ?? DEFAULT_WRITE_BACKPRESSURE.pendingThreshold;
  const pendingBytesThreshold = coercePositiveInt(config.pendingBytesThreshold)
    ?? DEFAULT_WRITE_BACKPRESSURE.pendingBytesThreshold;
  const oldestWaitMsThreshold = coercePositiveInt(config.oldestWaitMsThreshold)
    ?? DEFAULT_WRITE_BACKPRESSURE.oldestWaitMsThreshold;
  return {
    enabled: config.enabled !== false,
    writeQueue,
    producerQueues: producerQueues.length
      ? producerQueues
      : Array.from(DEFAULT_WRITE_BACKPRESSURE.producerQueues),
    pendingThreshold,
    pendingBytesThreshold,
    oldestWaitMsThreshold
  };
};

const SCHEDULER_DEFAULT_QUEUE_CONFIG = Object.freeze({
  'stage1.cpu': Object.freeze({ priority: 40, weight: 3, floorCpu: 1 }),
  'stage1.io': Object.freeze({ priority: 35, weight: 2, floorIo: 1 }),
  'stage1.proc': Object.freeze({ priority: 45, weight: 2 }),
  'stage1.postings': Object.freeze({ priority: 25, weight: 4, floorCpu: 1 }),
  'stage2.write': Object.freeze({ priority: 25, weight: 4, floorIo: 1 }),
  'stage2.relations': Object.freeze({ priority: 30, weight: 3 }),
  'stage2.relations.io': Object.freeze({ priority: 30, weight: 2, floorIo: 1 }),
  'stage4.sqlite': Object.freeze({ priority: 20, weight: 5, floorIo: 1 }),
  'embeddings.compute': Object.freeze({ priority: 35, weight: 3 }),
  'embeddings.io': Object.freeze({ priority: 30, weight: 2 })
});

const mergeQueueConfig = (defaults, overrides) => {
  const merged = {};
  const defaultEntries = defaults && typeof defaults === 'object'
    ? Object.entries(defaults)
    : [];
  for (const [queueName, config] of defaultEntries) {
    merged[queueName] = { ...config };
  }
  const overrideEntries = overrides && typeof overrides === 'object'
    ? Object.entries(overrides)
    : [];
  for (const [queueName, config] of overrideEntries) {
    merged[queueName] = {
      ...(merged[queueName] || {}),
      ...(config && typeof config === 'object' ? config : {})
    };
  }
  return merged;
};

export const SCHEDULER_QUEUE_NAMES = {
  stage1Cpu: 'stage1.cpu',
  stage1Io: 'stage1.io',
  stage1Proc: 'stage1.proc',
  stage1Postings: 'stage1.postings',
  stage2Write: 'stage2.write',
  stage2Relations: 'stage2.relations',
  stage2RelationsIo: 'stage2.relations.io',
  stage4Sqlite: 'stage4.sqlite',
  embeddingsCompute: 'embeddings.compute',
  embeddingsIo: 'embeddings.io'
};

export const resolveSchedulerConfig = ({
  argv,
  rawArgv,
  envConfig,
  indexingConfig,
  runtimeConfig,
  envelope,
  autoTuneProfile = null
}) => {
  const schedulerConfig = (indexingConfig && indexingConfig.scheduler)
    || (runtimeConfig && runtimeConfig.scheduler)
    || {};
  const cliSchedulerPresent = hasCliArg(rawArgv, '--scheduler') || hasCliArg(rawArgv, '--no-scheduler');
  const cliLowResourcePresent = hasCliArg(rawArgv, '--scheduler-low-resource')
    || hasCliArg(rawArgv, '--no-scheduler-low-resource');
  const cliCpuPresent = hasCliArg(rawArgv, '--scheduler-cpu');
  const cliIoPresent = hasCliArg(rawArgv, '--scheduler-io');
  const cliMemPresent = hasCliArg(rawArgv, '--scheduler-mem');
  const cliStarvationPresent = hasCliArg(rawArgv, '--scheduler-starvation');

  const cliCpu = argv?.['scheduler-cpu'] ?? argv?.schedulerCpu;
  const cliIo = argv?.['scheduler-io'] ?? argv?.schedulerIo;
  const cliMem = argv?.['scheduler-mem'] ?? argv?.schedulerMem;
  const cliStarvation = argv?.['scheduler-starvation'] ?? argv?.schedulerStarvation;
  const cliLowResource = argv?.['scheduler-low-resource'] ?? argv?.schedulerLowResource;

  const defaultCpu = coercePositiveInt(envelope?.concurrency?.cpuConcurrency?.value) || 1;
  const defaultIo = coercePositiveInt(envelope?.concurrency?.ioConcurrency?.value) || 1;
  const totalMemBytes = Number(envelope?.concurrency?.totalMemBytes);
  const reserveBytes = 2 * 1024 * 1024 * 1024;
  const defaultMemByHeadroom = Number.isFinite(totalMemBytes) && totalMemBytes > reserveBytes
    ? Math.floor((totalMemBytes - reserveBytes) / (1024 * 1024 * 1024))
    : null;
  const defaultMem = coercePositiveInt(defaultMemByHeadroom)
    || coercePositiveInt(envelope?.concurrency?.embeddingConcurrency?.value)
    || 1;

  const enabled = resolveBoolean({
    cliValue: argv?.scheduler,
    cliPresent: cliSchedulerPresent,
    envValue: envConfig?.schedulerEnabled,
    configValue: schedulerConfig?.enabled,
    fallback: true
  });

  const lowResourceMode = resolveBoolean({
    cliValue: cliLowResource,
    cliPresent: cliLowResourcePresent,
    envValue: envConfig?.schedulerLowResource,
    configValue: schedulerConfig?.lowResourceMode,
    fallback: false
  });

  const cpuTokens = resolveNumber({
    cliValue: cliCpu,
    cliPresent: cliCpuPresent,
    envValue: envConfig?.schedulerCpuTokens,
    configValue: schedulerConfig?.cpuTokens,
    fallback: defaultCpu,
    allowZero: false
  });

  const ioTokens = resolveNumber({
    cliValue: cliIo,
    cliPresent: cliIoPresent,
    envValue: envConfig?.schedulerIoTokens,
    configValue: schedulerConfig?.ioTokens,
    fallback: defaultIo,
    allowZero: false
  });

  const memoryTokens = resolveNumber({
    cliValue: cliMem,
    cliPresent: cliMemPresent,
    envValue: envConfig?.schedulerMemoryTokens,
    configValue: schedulerConfig?.memoryTokens,
    fallback: defaultMem,
    allowZero: false
  });

  const starvationMs = resolveNumber({
    cliValue: cliStarvation,
    cliPresent: cliStarvationPresent,
    envValue: envConfig?.schedulerStarvationMs,
    configValue: schedulerConfig?.starvationMs,
    fallback: 30000,
    allowZero: false
  });

  const adaptiveEnabled = resolveBoolean({
    cliValue: argv?.['scheduler-adaptive'] ?? argv?.schedulerAdaptive,
    cliPresent: hasCliArg(rawArgv, '--scheduler-adaptive') || hasCliArg(rawArgv, '--no-scheduler-adaptive'),
    envValue: envConfig?.schedulerAdaptive,
    configValue: schedulerConfig?.adaptive,
    fallback: true
  });

  const autoTuneProfileState = autoTuneProfile && typeof autoTuneProfile === 'object'
    ? autoTuneProfile
    : null;
  const autoTuneConfig = schedulerConfig?.autoTune && typeof schedulerConfig.autoTune === 'object'
    ? schedulerConfig.autoTune
    : {};
  const autoTuneEnabled = autoTuneConfig.enabled !== false;
  const autoTuneMaxCpu = autoTuneEnabled ? coercePositiveInt(autoTuneProfileState?.recommended?.maxCpuTokens) : null;
  const autoTuneMaxIo = autoTuneEnabled ? coercePositiveInt(autoTuneProfileState?.recommended?.maxIoTokens) : null;
  const autoTuneMaxMem = autoTuneEnabled ? coercePositiveInt(autoTuneProfileState?.recommended?.maxMemoryTokens) : null;
  const maxCpuTokens = resolveNumber({
    cliValue: argv?.['scheduler-max-cpu'] ?? argv?.schedulerMaxCpu,
    cliPresent: hasCliArg(rawArgv, '--scheduler-max-cpu'),
    envValue: envConfig?.schedulerMaxCpuTokens,
    configValue: schedulerConfig?.maxCpuTokens,
    fallback: autoTuneMaxCpu != null
      ? Math.max(cpuTokens, autoTuneMaxCpu)
      : Math.max(cpuTokens, defaultCpu * 3),
    allowZero: false
  });

  const maxIoTokens = resolveNumber({
    cliValue: argv?.['scheduler-max-io'] ?? argv?.schedulerMaxIo,
    cliPresent: hasCliArg(rawArgv, '--scheduler-max-io'),
    envValue: envConfig?.schedulerMaxIoTokens,
    configValue: schedulerConfig?.maxIoTokens,
    fallback: autoTuneMaxIo != null
      ? Math.max(ioTokens, autoTuneMaxIo)
      : Math.max(ioTokens, defaultIo * 3),
    allowZero: false
  });

  const maxMemoryTokens = resolveNumber({
    cliValue: argv?.['scheduler-max-mem'] ?? argv?.schedulerMaxMem,
    cliPresent: hasCliArg(rawArgv, '--scheduler-max-mem'),
    envValue: envConfig?.schedulerMaxMemoryTokens,
    configValue: schedulerConfig?.maxMemoryTokens,
    fallback: autoTuneMaxMem != null
      ? Math.max(memoryTokens, autoTuneMaxMem)
      : Math.max(memoryTokens, defaultMem * 3),
    allowZero: false
  });
  const adaptiveTargetUtilization = coerceUnitFraction(
    envConfig?.schedulerTargetUtilization
      ?? schedulerConfig?.adaptiveTargetUtilization
      ?? schedulerConfig?.targetUtilization
  ) ?? 0.85;
  const adaptiveStep = resolveNumber({
    cliValue: null,
    cliPresent: false,
    envValue: envConfig?.schedulerAdaptiveStep,
    configValue: schedulerConfig?.adaptiveStep,
    fallback: 1,
    allowZero: false
  });
  const adaptiveMemoryReserveMb = resolveNumber({
    cliValue: null,
    cliPresent: false,
    envValue: envConfig?.schedulerMemoryReserveMb,
    configValue: schedulerConfig?.memoryReserveMb,
    fallback: 2048,
    allowZero: true
  });
  const adaptiveMemoryPerTokenMb = resolveNumber({
    cliValue: null,
    cliPresent: false,
    envValue: envConfig?.schedulerMemoryPerTokenMb,
    configValue: schedulerConfig?.memoryPerTokenMb,
    fallback: 1024,
    allowZero: false
  });
  const utilizationAlertTarget = coerceUnitFraction(
    envConfig?.schedulerUtilizationAlertTarget
      ?? schedulerConfig?.utilizationAlertTarget
      ?? schedulerConfig?.utilizationTarget
  ) ?? 0.75;
  const utilizationAlertWindowMs = resolveNumber({
    cliValue: null,
    cliPresent: false,
    envValue: envConfig?.schedulerUtilizationAlertWindowMs,
    configValue: schedulerConfig?.utilizationAlertWindowMs,
    fallback: 15000,
    allowZero: false
  });

  const queues = mergeQueueConfig(
    SCHEDULER_DEFAULT_QUEUE_CONFIG,
    resolveQueueConfig(schedulerConfig?.queues)
  );
  const writeBackpressure = resolveWriteBackpressureConfig(
    schedulerConfig?.writeBackpressure
  );

  return {
    enabled,
    lowResourceMode,
    cpuTokens: Math.max(1, cpuTokens || 1),
    ioTokens: Math.max(1, ioTokens || 1),
    memoryTokens: Math.max(1, memoryTokens || 1),
    adaptive: adaptiveEnabled,
    adaptiveTargetUtilization,
    adaptiveStep: Math.max(1, adaptiveStep || 1),
    adaptiveMemoryReserveMb: Math.max(0, adaptiveMemoryReserveMb || 0),
    adaptiveMemoryPerTokenMb: Math.max(64, adaptiveMemoryPerTokenMb || 1024),
    utilizationAlertTarget,
    utilizationAlertWindowMs: Math.max(1000, utilizationAlertWindowMs || 15000),
    maxCpuTokens: Math.max(1, maxCpuTokens || 1),
    maxIoTokens: Math.max(1, maxIoTokens || 1),
    maxMemoryTokens: Math.max(1, maxMemoryTokens || 1),
    starvationMs,
    queues,
    writeBackpressure,
    autoTune: {
      enabled: autoTuneEnabled,
      sourceBuildId: typeof autoTuneProfileState?.sourceBuildId === 'string'
        ? autoTuneProfileState.sourceBuildId
        : null
    }
  };
};
