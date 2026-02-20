const normalizeBoolean = (value) => value === true || value === 'true' || value === '1';

const normalizeOptionalBoolean = (value) => {
  if (value == null) return null;
  return normalizeBoolean(value);
};

const coerceNonNegativeInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return Math.floor(parsed);
};

const coercePositiveInt = (value) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.floor(parsed);
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
    resolved[name] = {
      ...(priority != null ? { priority } : {}),
      ...(maxPending != null ? { maxPending } : {}),
      ...(weight != null ? { weight } : {})
    };
  }
  return resolved;
};

export const SCHEDULER_QUEUE_NAMES = {
  stage1Cpu: 'stage1.cpu',
  stage1Io: 'stage1.io',
  stage1Proc: 'stage1.proc',
  stage1Postings: 'stage1.postings',
  stage2Relations: 'stage2.relations',
  stage2RelationsIo: 'stage2.relations.io',
  stage4Sqlite: 'stage4.sqlite',
  embeddingsCompute: 'embeddings.compute',
  embeddingsIo: 'embeddings.io'
};

export const resolveSchedulerConfig = ({ argv, rawArgv, envConfig, indexingConfig, runtimeConfig, envelope }) => {
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
  const defaultMem = coercePositiveInt(envelope?.concurrency?.cpuConcurrency?.value) || 1;

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

  const queues = resolveQueueConfig(schedulerConfig?.queues);

  return {
    enabled,
    lowResourceMode,
    cpuTokens: Math.max(1, cpuTokens || 1),
    ioTokens: Math.max(1, ioTokens || 1),
    memoryTokens: Math.max(1, memoryTokens || 1),
    starvationMs,
    queues
  };
};
