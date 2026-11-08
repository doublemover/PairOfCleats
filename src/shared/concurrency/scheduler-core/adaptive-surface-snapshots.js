const IO_OBSERVATION_WINDOW_MS = 10000;
export const recentIoAdmissionEvidence = (samples, at, stage, stageEpoch = 0) => {
  const recent = (Array.isArray(samples) ? samples : []).filter(sample => sample.stage === stage && sample.stageEpoch === stageEpoch
    && Number.isFinite(sample.observedAt) && sample.observedAt <= at && at - sample.observedAt <= IO_OBSERVATION_WINDOW_MS
    && Number.isFinite(sample.waitMs) && sample.waitMs >= 0);
  const values = recent.map(sample => sample.waitMs).sort((a, b) => a - b);
  const latestAt = recent.length ? Math.max(...recent.map(sample => sample.observedAt)) : null;
  return { scope: 'last-observed-io-admission-constraint', available: recent.length > 0,
    windowMs: IO_OBSERVATION_WINDOW_MS, stage, stageEpoch, samples: recent.length,
    latestAgeMs: latestAt === null ? null : at - latestAt,
    p95Ms: values.length ? values[Math.max(0, Math.ceil(values.length * 0.95) - 1)] : null };
};

export function createAdaptiveSurfaceSnapshotHelpers({ config, admissionReason = null, getStage = () => null, getStageEpoch = () => 0 }) {
  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = config.nowMs()) => {
    const surfaceState = config.adaptiveSurfaceStates.get(surfaceName);
    if (!surfaceState) return null;
    const stage = getStage(), stageEpoch = getStageEpoch();
    const snapshot = { surface: surfaceName, pending: 0, pendingBytes: 0, running: 0, retainedRunning: 0,
      suspendedCpu: 0, inFlightBytes: 0, oldestWaitMs: 0, oldestDemandWaitMs: 0,
      runnablePending: 0, surfaceBlockedPending: 0, ioPending: 0, ioPendingBytes: 0,
      ioBlockedPending: 0, writeBackpressureBlocked: 0, ioWaitP95Ms: null,
      cpuReservedTokens: 0, ioReservedTokens: 0, memoryReservedTokens: 0,
      ioWaitEvidence: { available: false, stage, stageEpoch, windowMs: IO_OBSERVATION_WINDOW_MS, samples: 0, latestAgeMs: null },
      admissionAvailable: typeof admissionReason === 'function', blockedBy: {}, queues: [] };
    for (const queue of config.queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      const pending = Math.max(0, queue.pending.length), pendingBytes = config.normalizeByteCount(queue.pendingBytes);
      const retainedRunning = Math.max(0, queue.running), suspendedCpu = Math.max(0, queue.suspendedCpu || 0);
      const running = Math.max(0, retainedRunning - suspendedCpu);
      const inFlightBytes = config.normalizeByteCount(queue.inFlightBytes);
      const enqueuedAt = Number(queue.pending[0]?.enqueuedAt);
      const oldestWaitMs = pending && Number.isFinite(enqueuedAt) ? Math.max(0, at - enqueuedAt) : 0;
      const evidence = recentIoAdmissionEvidence(queue.stats?.ioAdmissionSamples, at, stage, stageEpoch);
      snapshot.pending += pending; snapshot.pendingBytes += pendingBytes;
      snapshot.running += running; snapshot.retainedRunning += retainedRunning; snapshot.suspendedCpu += suspendedCpu;
      snapshot.inFlightBytes += inFlightBytes; snapshot.oldestWaitMs = Math.max(snapshot.oldestWaitMs, oldestWaitMs);
      const reserved = { cpu: 0, io: 0, mem: 0 };
      for (const entry of queue.runningSince?.keys() || []) {
        const actual = entry.taskLease?.used;
        if (!actual) continue;
        for (const kind of ['cpu', 'io', 'mem']) reserved[kind] += Math.max(0, Number(actual[kind]) || 0);
      }
      snapshot.cpuReservedTokens += reserved.cpu; snapshot.ioReservedTokens += reserved.io; snapshot.memoryReservedTokens += reserved.mem;
      for (const entry of queue.pending) {
        const request = config.normalizeRequest(entry.tokens);
        const reason = admissionReason ? admissionReason(queue, request) : 'unavailable';
        if (reason) snapshot.blockedBy[reason] = (snapshot.blockedBy[reason] || 0) + 1;
        else snapshot.runnablePending++;
        if (reason === 'surface-concurrency') snapshot.surfaceBlockedPending++;
        if (!reason || reason === 'surface-concurrency') {
          const since = Number(entry.enqueuedAt);
          if (Number.isFinite(since)) snapshot.oldestDemandWaitMs = Math.max(snapshot.oldestDemandWaitMs, Math.max(0, at - since));
        }
        if (request.io > 0) {
          snapshot.ioPending++; snapshot.ioPendingBytes += config.normalizeByteCount(entry.bytes);
          if (reason === 'io-tokens') snapshot.ioBlockedPending++;
        }
        if (reason === 'write-backpressure') snapshot.writeBackpressureBlocked++;
      }
      if (evidence.available) {
        snapshot.ioWaitP95Ms = Math.max(snapshot.ioWaitP95Ms ?? 0, evidence.p95Ms);
        snapshot.ioWaitEvidence.available = true; snapshot.ioWaitEvidence.samples += evidence.samples;
        snapshot.ioWaitEvidence.latestAgeMs = Math.min(snapshot.ioWaitEvidence.latestAgeMs ?? Infinity, evidence.latestAgeMs);
      }
      snapshot.queues.push({ name: queue.name, pending, pendingBytes, running, retainedRunning, suspendedCpu, inFlightBytes,
        reservedTokens: reserved, oldestWaitMs, waitP95Ms: queue.stats?.waitP95Ms ?? null, ioAdmissionEvidence: evidence });
    }
    snapshot.backlogPerSlot = (snapshot.runnablePending + snapshot.surfaceBlockedPending) / Math.max(1, surfaceState.currentConcurrency);
    // These are diagnosed admission constraints, not device busy-time. Retained
    // source/AST bytes and generic CPU/queue wait never manufacture I/O pressure.
    const diagnosedIoDemand = snapshot.ioBlockedPending > 0 || snapshot.writeBackpressureBlocked > 0;
    snapshot.ioPressureScore = diagnosedIoDemand ? Math.max(0, Math.min(1.5, Math.max(
      snapshot.ioBlockedPending / Math.max(1, surfaceState.currentConcurrency * 2),
      snapshot.writeBackpressureBlocked ? 1 : 0,
      snapshot.ioWaitEvidence.available ? snapshot.ioWaitP95Ms / 10000 : 0))) : null;
    return snapshot;
  };
  const buildAdaptiveSurfaceSnapshots = (at = config.nowMs()) => Object.fromEntries(
    [...config.adaptiveSurfaceStates.keys()].map(name => [name, buildAdaptiveSurfaceSnapshotByName(name, at)]));
  return { buildAdaptiveSurfaceSnapshotByName, buildAdaptiveSurfaceSnapshots };
}
