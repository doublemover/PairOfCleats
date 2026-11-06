import { createSchedulerWorkloadObservation } from '../../src/shared/concurrency/scheduler-workload-observation.js';

/** Deterministic current observation data built through the aggregate owner. */
export const schedulerWorkloadInput = ({ config, buildId = 'fixture', mode = 'code',
  durationMs = 1500, completed = 4, cpuCapacity = config.cpuTokens || 1,
  cpuHeadroom = false, rejected = 0, failed = 0 } = {}) => {
  let at = 0;
  const counters = { started: 0, completed: 0, failed: 0, rejected: 0 };
  const resource = { tokens: { cpu: { used: 0, total: cpuCapacity },
    io: { used: 0, total: config.ioTokens || 1 }, mem: { used: 0, total: config.memoryTokens || 1 } },
  counters, inFlightBytes: 0, active: false };
  const observation = createSchedulerWorkloadObservation({ nowMs: () => at,
    readResources: () => resource, readContext: () => ({ buildId, mode, stage: 'processing', stageEpoch: 1 }),
    resourceIdentity: config.resourceIdentity });
  observation.resourcesChanged();
  resource.active = true; resource.tokens.cpu.used = cpuCapacity; resource.inFlightBytes = 32;
  counters.started = completed + failed;
  observation.resourcesChanged();
  for (at = 0; at < durationMs; at += durationMs / 3) observation.sample({ pending: 4, runnable: 0,
    pendingBytes: 64, blockedBy: { 'cpu-tokens': 4 } }, cpuHeadroom
    ? { cpu: { externalLoadAvailable: true, loadRatio: 0.4 }, memory: { totalBytes: 1024, pressureScore: 0.2 } } : null, at);
  at = durationMs;
  counters.completed = completed; counters.failed = failed; counters.rejected = rejected;
  resource.active = false; resource.tokens.cpu.used = 0; resource.inFlightBytes = 0;
  observation.resourcesChanged();
  return { schedulerConfig: config, buildId, mode, outcome: 'completed', schedulerStats: {
    runningTasks: 0, activity: { pending: 0, running: 0, inFlightBytes: 0 }, tokens: resource.tokens,
    workloadObservations: observation.snapshot() } };
};
