import os from 'node:os';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';
import { resolveSchedulerConfig, SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';

const toPositiveIntOrNull = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return null;
  return Math.max(1, Math.floor(num));
};

export const resolveExplicitThreadsCap = ({ argv, rawArgv }) => {
  const argvThreads = toPositiveIntOrNull(argv?.threads);
  if (argvThreads) return argvThreads;
  if (!Array.isArray(rawArgv)) return null;
  for (let i = 0; i < rawArgv.length; i += 1) {
    const token = String(rawArgv[i] || '');
    if (!token) continue;
    if (token === '--threads' || token === '-j') {
      return toPositiveIntOrNull(rawArgv[i + 1]);
    }
    if (token.startsWith('--threads=')) {
      return toPositiveIntOrNull(token.slice('--threads='.length));
    }
  }
  return null;
};

const scheduleWithFallback = async (scheduler, queueName, tokens, fn, enabled) => {
  if (!enabled) return fn();
  return await scheduler.schedule(queueName, tokens, fn);
};

export const createEmbeddingsScheduler = ({ argv, rawArgv, userConfig, envConfig, indexingConfig }) => {
  const resolvedRawArgv = Array.isArray(rawArgv) ? rawArgv : [];
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const envelope = resolveRuntimeEnvelope({
    argv,
    rawArgv: resolvedRawArgv,
    userConfig,
    env: process.env,
    execArgv: process.execArgv,
    cpuCount
  });
  const schedulerConfig = resolveSchedulerConfig({
    argv,
    rawArgv: resolvedRawArgv,
    envConfig,
    indexingConfig,
    runtimeConfig: userConfig?.runtime,
    envelope
  });
  const scheduler = createBuildScheduler(schedulerConfig);
  scheduler.registerQueues?.(schedulerConfig.queues);
  const envelopeCpuConcurrencyRaw = Number(envelope?.concurrency?.cpuConcurrency?.value);
  const envelopeCpuConcurrencyUncapped = Number.isFinite(envelopeCpuConcurrencyRaw) && envelopeCpuConcurrencyRaw > 0
    ? Math.max(1, Math.floor(envelopeCpuConcurrencyRaw))
    : 1;
  const explicitThreadsCap = resolveExplicitThreadsCap({ argv, rawArgv: resolvedRawArgv });
  const envelopeCpuConcurrency = explicitThreadsCap
    ? Math.max(1, Math.min(envelopeCpuConcurrencyUncapped, explicitThreadsCap))
    : envelopeCpuConcurrencyUncapped;

  const schedulerExplicitlyEnabled = envConfig?.schedulerEnabled === true || argv?.scheduler === true;
  const schedulerEnabled = scheduler.enabled && (!scheduler.lowResourceMode || schedulerExplicitlyEnabled);
  const scheduleCompute = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsCompute,
    { cpu: 1 },
    fn,
    schedulerEnabled
  );
  const scheduleIo = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsIo,
    { io: 1 },
    fn,
    schedulerEnabled
  );

  return {
    scheduler,
    scheduleCompute,
    scheduleIo,
    envelopeCpuConcurrency
  };
};
