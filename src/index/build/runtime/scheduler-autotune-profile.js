import { withGeneratedCacheMetadata, withoutGeneratedCacheMetadata } from '../../../shared/generated-artifact-cache.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { atomicWriteJson } from '../../../shared/io/atomic-write.js';
import { SCHEDULER_WORKLOAD_OBSERVATION_VERSION } from '../../../shared/concurrency/scheduler-workload-observation.js';
import { SCHEDULER_AUTOTUNE_PROFILE_VERSION, isQualifiedSchedulerProfile } from './scheduler-autotune-policy.js';

const profilePath = root => typeof root === 'string' && root.trim()
  ? path.join(root, 'metrics', 'scheduler-autotune.json') : null;
const nonnegative = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
const positiveInt = value => Number.isSafeInteger(value) && value > 0;
const boundedText = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const kinds = ['cpu', 'io', 'mem'];
const counters = ['started', 'completed', 'failed', 'rejected'];
const insufficient = reason => ({ status: 'insufficient-evidence', decision: 'no-change', reason });

/** Only current, qualified workload profiles can supply automatic authority. */
export async function loadSchedulerAutoTuneProfile({ repoCacheRoot, log = null } = {}) {
  const file = profilePath(repoCacheRoot);
  if (!file) return null;
  try {
    const value = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!isQualifiedSchedulerProfile(value)) return null;
    // Cache ownership metadata belongs to the file, not the recommendation DTO.
    return withoutGeneratedCacheMetadata(value);
  } catch (error) {
    if (error?.code !== 'ENOENT' && typeof log === 'function') log('[scheduler] Failed to load autotune profile: ' + (error?.message || error));
    return null;
  }
}

const summarizePhases = phases => {
  const summary = { activeMs: 0, demandSamples: 0, resourceIntervals: 0, firstAt: Infinity, lastAt: 0,
    pendingSum: 0, runnableSum: 0, inFlightBytesPeak: 0, sampledPendingBytesPeak: 0,
    work: Object.fromEntries(counters.map(key => [key, 0])),
    tokenTime: Object.fromEntries(kinds.map(key => [key, { usedMs: 0, capacityMs: 0 }])),
    blockedBy: {}, admissionWait: {}, signals: { cpuSamples: 0, cpuLoadSum: 0, memorySamples: 0,
      memoryPressureSum: 0, fdCapSamples: 0, cpuHeadroomDemandSamples: 0 } };
  for (const phase of phases) {
    const required = [phase.activeMs, phase.demandSamples, phase.resourceIntervals, phase.firstAt, phase.lastAt,
      phase.pendingSum, phase.runnableSum, phase.inFlightBytesPeak, phase.sampledPendingBytesPeak,
      ...counters.map(key => phase.work?.[key]),
      ...kinds.flatMap(key => [phase.tokenTime?.[key]?.usedMs, phase.tokenTime?.[key]?.capacityMs]),
      ...Object.keys(summary.signals).map(key => phase.signals?.[key])];
    if (!required.every(nonnegative) || phase.lastAt < phase.firstAt) return null;
    summary.firstAt = Math.min(summary.firstAt, phase.firstAt); summary.lastAt = Math.max(summary.lastAt, phase.lastAt);
    for (const key of ['activeMs', 'demandSamples', 'resourceIntervals', 'pendingSum', 'runnableSum']) summary[key] += phase[key];
    for (const key of ['inFlightBytesPeak', 'sampledPendingBytesPeak']) summary[key] = Math.max(summary[key], phase[key]);
    for (const key of counters) summary.work[key] += phase.work[key];
    for (const key of kinds) for (const field of ['usedMs', 'capacityMs']) summary.tokenTime[key][field] += phase.tokenTime[key][field];
    for (const key of Object.keys(summary.signals)) summary.signals[key] += phase.signals[key];
    for (const [reason, count] of Object.entries(phase.blockedBy || {})) {
      if (!nonnegative(count)) return null;
      summary.blockedBy[reason] = (summary.blockedBy[reason] || 0) + count;
    }
    for (const [reason, wait] of Object.entries(phase.admissionWait || {})) {
      if (![wait?.count, wait?.totalMs, wait?.maxMs].every(nonnegative)) return null;
      const target = summary.admissionWait[reason] ||= { count: 0, totalMs: 0, maxMs: 0 };
      target.count += wait.count; target.totalMs += wait.totalMs; target.maxMs = Math.max(target.maxMs, wait.maxMs);
    }
  }
  return summary;
};

/** Final instantaneous stats prove drain only. Learning consumes the bounded
 * observation receipt collected during this exact successful build/mode.
 */
export const deriveSchedulerAutoTuneRecommendation = ({ schedulerStats, schedulerConfig, buildId, mode, outcome } = {}) => {
  if (outcome !== 'completed') return insufficient('workload-not-completed');
  if (!boundedText(buildId) || !boundedText(mode)) return insufficient('missing-workload-scope');
  const observation = schedulerStats?.workloadObservations;
  if (observation?.schemaVersion !== SCHEDULER_WORKLOAD_OBSERVATION_VERSION || observation.complete !== true
    || !boundedText(observation.runId) || observation.resourceIdentity !== schedulerConfig?.resourceIdentity
    || !boundedText(observation.resourceIdentity) || !Array.isArray(observation.phases) || observation.phases.length > 64) {
    return insufficient('missing-incomplete-or-incompatible-observation');
  }
  if (schedulerStats?.activity?.pending !== 0 || schedulerStats?.activity?.running !== 0
    || schedulerStats?.runningTasks !== 0 || schedulerStats?.activity?.inFlightBytes !== 0
    || kinds.some(kind => schedulerStats?.tokens?.[kind]?.used !== 0)) return insufficient('workload-not-drained');
  if (observation.phases.some(phase => !phase || typeof phase !== 'object')) return insufficient('invalid-phase-observation');
  const phases = observation.phases.filter(phase => phase.buildId === buildId && phase.mode === mode);
  const summary = summarizePhases(phases);
  if (!summary || !phases.length) return insufficient('missing-or-invalid-mode-observation');
  if (summary.work.failed || summary.work.rejected || summary.work.started !== summary.work.completed) {
    return insufficient('failed-cancelled-or-partial-workload');
  }
  if (summary.activeMs < 1000 || summary.resourceIntervals < 2 || summary.work.completed < 4 || summary.demandSamples < 3) {
    return insufficient('empty-reused-or-too-short-workload');
  }
  const maxima = ['maxCpuTokens', 'maxIoTokens', 'maxMemoryTokens'];
  if (!maxima.every(key => positiveInt(schedulerConfig?.[key]))) return insufficient('missing-resource-envelope');
  const recommended = Object.fromEntries(maxima.map(key => [key, schedulerConfig[key]]));
  const reasons = { cpu: 'no-qualified-cpu-headroom-and-binding-demand',
    io: 'no-device-service-or-descriptor-headroom-measurement', mem: 'no-qualified-memory-cap-change' };
  const cpu = summary.tokenTime.cpu;
  const cpuOccupancy = cpu.capacityMs > 0 ? cpu.usedMs / cpu.capacityMs : null;
  const cpuInitial = schedulerConfig.cpuTokens;
  const hardCpuMaximum = Math.max(cpuInitial || 1, schedulerConfig.autoTune?.basePolicy?.maximums?.cpu?.value
    || schedulerConfig.maxCpuTokens);
  // Admission demand is not device saturation. Growth is only one CPU slot
  // beyond the observed average capacity, with concurrent known CPU/memory
  // headroom, and never beyond the already accepted hard envelope.
  if (positiveInt(cpuInitial) && cpuOccupancy >= 0.8 && summary.signals.cpuHeadroomDemandSamples >= 3) {
    const observedCapacity = cpu.capacityMs / summary.activeMs;
    recommended.maxCpuTokens = Math.min(hardCpuMaximum,
      Math.max(cpuInitial, Math.ceil(observedCapacity) + 1));
    reasons.cpu = 'cpu-token-admission-demand-with-observed-cpu-and-memory-headroom';
  }
  const changed = maxima.some(key => recommended[key] !== schedulerConfig[key]);
  return { version: SCHEDULER_AUTOTUNE_PROFILE_VERSION, status: 'qualified', decision: changed ? 'adjust' : 'no-change',
    generatedAt: new Date().toISOString(), sourceBuildId: buildId, sourceMode: mode,
    resourceIdentity: observation.resourceIdentity, recommended,
    evidence: { version: SCHEDULER_WORKLOAD_OBSERVATION_VERSION, runId: observation.runId, mode,
      complete: true, cpuBusyTimeMeasured: false, fdUsageMeasured: false,
      coverage: summary, cpuTokenOccupancy: cpuOccupancy, reasons } };
};

/** Insufficient or weaker same-build mode evidence never replaces a qualified
 * profile. Different modes are not silently merged into one workload.
 */
export async function writeSchedulerAutoTuneProfile(input = {}) {
  const file = profilePath(input.repoCacheRoot);
  if (!file) return insufficient('missing-cache-root');
  const payload = deriveSchedulerAutoTuneRecommendation(input);
  if (payload.status !== 'qualified') return payload;
  const previous = await loadSchedulerAutoTuneProfile(input);
  if (previous?.resourceIdentity === payload.resourceIdentity) {
    if (previous.evidence.runId === payload.evidence.runId && previous.sourceMode === payload.sourceMode) {
      return insufficient('observation-already-persisted');
    }
    if (previous.sourceBuildId === payload.sourceBuildId && previous.sourceMode !== payload.sourceMode
      && previous.evidence.coverage.activeMs >= payload.evidence.coverage.activeMs) {
      return insufficient('richer-build-mode-evidence-retained');
    }
  }
  try {
    await atomicWriteJson(file, withGeneratedCacheMetadata(payload, 'scheduler-autotune'), { spaces: 2, newline: true });
    return payload;
  } catch (error) {
    if (typeof input.log === 'function') input.log('[scheduler] Failed to persist autotune profile: ' + (error?.message || error));
    return null;
  }
}
