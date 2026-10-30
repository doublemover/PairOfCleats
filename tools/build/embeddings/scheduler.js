import { readEffectiveMemory } from '../../../src/shared/effective-memory.js';
import os from 'node:os';
import { createBuildScheduler } from '../../../src/shared/concurrency/scheduler-core.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope/resolve.js';
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

const scheduleWithFallback = async (scheduler, queueName, tokens, fn) => {
  return await scheduler.schedule(queueName, tokens, fn);
};

export const createEmbeddingsScheduler = ({ argv, rawArgv, userConfig, rawEnv = process.env, envConfig, indexingConfig, signal = null, memorySnapshot = null }) => {
  const resolvedRawArgv = Array.isArray(rawArgv) ? rawArgv : [];
  const cpuCount = typeof os.availableParallelism === 'function'
    ? os.availableParallelism()
    : os.cpus().length;
  const envelope = resolveRuntimeEnvelope({
    argv,
    rawArgv: resolvedRawArgv,
    userConfig,
    env: rawEnv,
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
  const effectiveMemory = memorySnapshot || readEffectiveMemory();
  const boundedSchedulerConfig = { ...schedulerConfig, memoryBudget: {
    configuredLimitBytes: effectiveMemory.totalBytes
  }, maxInFlightBytes: Math.min(schedulerConfig.maxInFlightBytes || Infinity,
    Math.max(1, Math.floor(effectiveMemory.freeBytes * 0.25))) };
  let scheduler = createBuildScheduler(boundedSchedulerConfig);
  const explicitlyEnabled = envConfig?.schedulerEnabled === true || argv?.scheduler === true;
  if (scheduler.enabled && scheduler.lowResourceMode && !explicitlyEnabled) {
    scheduler.shutdown();
    scheduler = createBuildScheduler({ ...boundedSchedulerConfig, enabled: false });
  }
  scheduler.registerQueues?.(schedulerConfig.queues);
  const envelopeCpuConcurrencyRaw = Number(envelope?.concurrency?.cpuConcurrency?.value);
  const envelopeCpuConcurrencyUncapped = Number.isFinite(envelopeCpuConcurrencyRaw) && envelopeCpuConcurrencyRaw > 0
    ? Math.max(1, Math.floor(envelopeCpuConcurrencyRaw))
    : 1;
  const explicitThreadsCap = resolveExplicitThreadsCap({ argv, rawArgv: resolvedRawArgv });
  const envelopeCpuConcurrency = explicitThreadsCap
    ? Math.max(1, Math.min(envelopeCpuConcurrencyUncapped, explicitThreadsCap))
    : envelopeCpuConcurrencyUncapped;

  const scheduleCompute = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsCompute,
    { cpu: 1, signal },
    fn
  );
  const scheduleIo = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsIo,
    { io: 1, signal },
    fn
  );
  const scheduleNative = (fn, { estimatedBytes = 0 } = {}) => scheduleWithFallback(scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsCompute, { cpu: 1, mem: 1,
      bytes: Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(Number(estimatedBytes) || 0))), signal }, fn);

  return {
    scheduler,
    scheduleCompute,
    scheduleIo,
    scheduleNative,
    envelopeCpuConcurrency,
    runtimeEnvelope: envelope
  };
};
