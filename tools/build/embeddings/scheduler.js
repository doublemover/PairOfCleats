import os from 'node:os';
import { createBuildScheduler } from '../../../src/shared/concurrency.js';
import { resolveRuntimeEnvelope } from '../../../src/shared/runtime-envelope.js';
import { resolveSchedulerConfig, SCHEDULER_QUEUE_NAMES } from '../../../src/index/build/runtime/scheduler.js';

const scheduleWithFallback = async (scheduler, queueName, tokens, fn, enabled) => {
  if (!enabled) return fn();
  try {
    return await scheduler.schedule(queueName, tokens, fn);
  } catch (err) {
    const message = err?.message || '';
    if (message.includes('maxPending')) {
      return fn();
    }
    throw err;
  }
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

  const schedulerTokens = scheduler.stats?.().tokens || null;
  const schedulerEnabled = scheduler.enabled && !scheduler.lowResourceMode;
  const canScheduleCompute = schedulerEnabled && (schedulerTokens?.cpu?.total ?? 0) > 0;
  const canScheduleIo = schedulerEnabled && (schedulerTokens?.io?.total ?? 0) > 0;
  const scheduleCompute = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsCompute,
    { cpu: 1 },
    fn,
    canScheduleCompute
  );
  const scheduleIo = (fn) => scheduleWithFallback(
    scheduler,
    SCHEDULER_QUEUE_NAMES.embeddingsIo,
    { io: 1 },
    fn,
    canScheduleIo
  );

  return {
    scheduler,
    scheduleCompute,
    scheduleIo
  };
};
