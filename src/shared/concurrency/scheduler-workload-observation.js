import { randomUUID } from 'node:crypto';

export const SCHEDULER_WORKLOAD_OBSERVATION_VERSION = 1;
const kinds = ['cpu', 'io', 'mem'];
const counters = ['started', 'completed', 'failed', 'rejected'];
const reasons = ['queue-concurrency', 'surface-concurrency', 'retained-file-window', 'write-backpressure',
  'cpu-tokens', 'io-tokens', 'memory-tokens', 'queue-bytes', 'global-bytes'];
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 256 ? value : null;

/** Fixed-size online summaries. Resource transitions integrate logical token
 * occupancy; sampled admission demand is labeled separately. No task payload,
 * per-task history or copied trace is retained by this owner.
 */
export const createSchedulerWorkloadObservation = ({ nowMs, readResources, readContext, resourceIdentity }) => {
  const runId = randomUUID(), phases = new Map();
  const priorValues = new Float64Array(10);
  let priorAt = null, priorActive = false, priorPhase = null, currentScope = null, currentPhase = null;
  let overflow = false, clockInvalid = false, scopeOverlap = false;
  const capture = () => {
    const at = nowMs(), resource = readResources(), context = readContext();
    const buildId = text(context.buildId), mode = text(context.mode), stage = text(context.stage), stageEpoch = context.stageEpoch || 0;
    if (!currentScope || currentScope.buildId !== buildId || currentScope.mode !== mode || currentScope.stage !== stage || currentScope.stageEpoch !== stageEpoch) {
      if (currentScope && priorActive && (currentScope.buildId !== buildId || currentScope.mode !== mode)) scopeOverlap = true;
      currentScope = { buildId, mode, stage, stageEpoch };
      currentPhase = phases.get(JSON.stringify(currentScope)) || null;
    }
    let phase = currentPhase;
    if (!phase && phases.size < 64) {
      phase = { ...currentScope, firstAt: at, lastAt: at, activeMs: 0, resourceIntervals: 0,
        tokenTime: Object.fromEntries(kinds.map(kind => [kind, { usedMs: 0, capacityMs: 0 }])),
        work: { started: 0, completed: 0, failed: 0, rejected: 0 }, lastDemandAt: null, lastSignalsAt: null,
        demandSamples: 0, pendingSum: 0, runnableSum: 0,
        blockedBy: Object.fromEntries(reasons.map(reason => [reason, 0])),
        admissionWait: Object.fromEntries(reasons.map(reason => [reason, { count: 0, totalMs: 0, maxMs: 0 }])),
        inFlightBytesPeak: 0, sampledPendingBytesPeak: 0,
        signals: { cpuSamples: 0, cpuLoadSum: 0, memorySamples: 0, memoryPressureSum: 0, fdCapSamples: 0,
          cpuHeadroomDemandSamples: 0 } };
      phases.set(JSON.stringify(currentScope), phase); currentPhase = phase;
    } else if (!phase) overflow = true;
    if (priorAt !== null) {
      const elapsed = at - priorAt;
      if (!Number.isFinite(elapsed) || elapsed < 0) clockInvalid = true;
      else if (priorPhase) {
        priorPhase.lastAt = at;
        if (priorActive && elapsed > 0) {
          priorPhase.activeMs += elapsed; priorPhase.resourceIntervals++;
          for (let index = 0; index < kinds.length; index++) {
            priorPhase.tokenTime[kinds[index]].usedMs += elapsed * priorValues[index * 2];
            priorPhase.tokenTime[kinds[index]].capacityMs += elapsed * priorValues[index * 2 + 1];
          }
        }
        for (let index = 0; index < counters.length; index++) {
          const delta = number(resource.counters[counters[index]]) - priorValues[6 + index];
          if (delta < 0) clockInvalid = true; else priorPhase.work[counters[index]] += delta;
        }
      }
    }
    if (phase) phase.inFlightBytesPeak = Math.max(phase.inFlightBytesPeak, number(resource.inFlightBytes));
    for (let index = 0; index < kinds.length; index++) {
      priorValues[index * 2] = number(resource.tokens[kinds[index]]?.used);
      priorValues[index * 2 + 1] = number(resource.tokens[kinds[index]]?.total);
    }
    for (let index = 0; index < counters.length; index++) priorValues[6 + index] = number(resource.counters[counters[index]]);
    priorAt = at; priorActive = Boolean(resource.active); priorPhase = phase;
    return phase;
  };
  return {
    resourcesChanged: capture,
    sample({ pending, pendingBytes, runnable, blockedBy }, signals = null, signalsAt = null) {
      const phase = capture();
      if (!phase || !priorActive) return;
      if (phase.lastDemandAt !== null && priorAt - phase.lastDemandAt < 100) return;
      phase.lastDemandAt = priorAt;
      phase.demandSamples++; phase.pendingSum += number(pending); phase.runnableSum += number(runnable);
      phase.sampledPendingBytesPeak = Math.max(phase.sampledPendingBytesPeak, number(pendingBytes));
      for (const reason of reasons) phase.blockedBy[reason] += number(blockedBy?.[reason]);
      if (!Number.isFinite(signalsAt) || priorAt - signalsAt < 0 || priorAt - signalsAt > 10000) return;
      if (phase.lastSignalsAt !== null && signalsAt <= phase.lastSignalsAt) return;
      phase.lastSignalsAt = signalsAt;
      if (signals?.cpu?.externalLoadAvailable === true && Number.isFinite(signals.cpu.loadRatio)) {
        phase.signals.cpuSamples++; phase.signals.cpuLoadSum += number(signals.cpu.loadRatio);
      }
      if (number(signals?.memory?.totalBytes) > 0 && Number.isFinite(signals.memory.pressureScore)) {
        phase.signals.memorySamples++; phase.signals.memoryPressureSum += number(signals.memory.pressureScore);
      }
      if (number(blockedBy?.['cpu-tokens']) > 0 && signals?.cpu?.externalLoadAvailable === true
        && Number.isFinite(signals.cpu.loadRatio) && signals.cpu.loadRatio >= 0 && signals.cpu.loadRatio < 0.75
        && number(signals?.memory?.totalBytes) > 0 && Number.isFinite(signals.memory.pressureScore)
        && signals.memory.pressureScore >= 0 && signals.memory.pressureScore < 0.75) phase.signals.cpuHeadroomDemandSamples++;
      // A configured token cap is not measured descriptor utilization.
      if (signals?.fd?.available === true) phase.signals.fdCapSamples++;
    },
    observeAdmissionWait(reason, waitMs) {
      const phase = capture();
      const wait = phase?.admissionWait[reason];
      if (!wait || !Number.isFinite(waitMs) || waitMs < 0) return;
      wait.count++; wait.totalMs += waitMs; wait.maxMs = Math.max(wait.maxMs, waitMs);
    },
    snapshot() {
      capture();
      return { schemaVersion: SCHEDULER_WORKLOAD_OBSERVATION_VERSION, runId,
        resourceIdentity: text(resourceIdentity), complete: !overflow && !clockInvalid && !scopeOverlap,
        scope: 'run-mode-stage-logical-token-occupancy-and-sampled-admission',
        cpuBusyTimeMeasured: false, fdUsageMeasured: false, overflow, clockInvalid, scopeOverlap,
        phases: structuredClone([...phases.values()]) };
    }
  };
};
