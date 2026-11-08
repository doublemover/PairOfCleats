import { SCHEDULER_WORKLOAD_OBSERVATION_VERSION } from '../../../shared/concurrency/scheduler-workload-observation.js';

// Hard cutover: only profiles derived from current workload observations qualify.
export const SCHEDULER_AUTOTUNE_PROFILE_VERSION = 4;

export const isQualifiedSchedulerProfile = value => value?.version === SCHEDULER_AUTOTUNE_PROFILE_VERSION
  && value.status === 'qualified' && ['adjust', 'no-change'].includes(value.decision)
  && typeof value.resourceIdentity === 'string' && value.resourceIdentity.length > 0
  && typeof value.sourceBuildId === 'string' && value.sourceBuildId.length > 0
  && typeof value.sourceMode === 'string' && value.sourceMode.length > 0
  && value.evidence?.version === SCHEDULER_WORKLOAD_OBSERVATION_VERSION && value.evidence.complete === true
  && value.evidence.cpuBusyTimeMeasured === false && value.evidence.fdUsageMeasured === false
  && typeof value.evidence.runId === 'string' && value.evidence.runId.length > 0
  && value.evidence.mode === value.sourceMode
  && Number.isFinite(value.evidence.coverage?.activeMs) && value.evidence.coverage.activeMs >= 1000
  && Number.isSafeInteger(value.evidence.coverage?.demandSamples) && value.evidence.coverage.demandSamples >= 3
  && Number.isSafeInteger(value.evidence.coverage?.work?.completed) && value.evidence.coverage.work.completed >= 4
  && value.evidence.coverage.work.started === value.evidence.coverage.work.completed
  && value.evidence.coverage.work.failed === 0 && value.evidence.coverage.work.rejected === 0
  && ['maxCpuTokens', 'maxIoTokens', 'maxMemoryTokens'].every(key => Number.isSafeInteger(value.recommended?.[key])
    && value.recommended[key] > 0);
