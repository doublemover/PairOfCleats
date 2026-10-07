export function createAdaptiveSurfaceSnapshotHelpers({ config }) {
  const buildAdaptiveSurfaceSnapshotByName = (surfaceName, at = config.nowMs()) => {
    const surfaceState = config.adaptiveSurfaceStates.get(surfaceName);
    if (!surfaceState) return null;
    const snapshot = {
      surface: surfaceName,
      pending: 0,
      pendingBytes: 0,
      running: 0,
      inFlightBytes: 0,
      oldestWaitMs: 0,
      ioPending: 0,
      ioPendingBytes: 0,
      ioWaitP95Ms: 0,
      queues: []
    };
    for (const queue of config.queueOrder) {
      if (queue?.surface !== surfaceName) continue;
      const pending = Math.max(0, queue.pending.length);
      const pendingBytes = config.normalizeByteCount(queue.pendingBytes);
      const running = Math.max(0, queue.running);
      const inFlightBytes = config.normalizeByteCount(queue.inFlightBytes);
      const oldestWaitMs = pending > 0
        ? Math.max(0, at - Number(queue.pending[0]?.enqueuedAt || at))
        : 0;
      const waitP95Ms = Math.max(0, Number(queue?.stats?.waitP95Ms) || 0);
      snapshot.pending += pending;
      snapshot.pendingBytes += pendingBytes;
      snapshot.running += running;
      snapshot.inFlightBytes += inFlightBytes;
      snapshot.oldestWaitMs = Math.max(snapshot.oldestWaitMs, oldestWaitMs);
      if ((pendingBytes > 0) || queue.name.includes('.io') || queue.name.includes('write') || queue.name.includes('sqlite')) {
        snapshot.ioPending += pending;
        snapshot.ioPendingBytes += pendingBytes;
        snapshot.ioWaitP95Ms = Math.max(snapshot.ioWaitP95Ms, waitP95Ms);
      }
      snapshot.queues.push({
        name: queue.name,
        pending,
        pendingBytes,
        running,
        inFlightBytes,
        oldestWaitMs,
        waitP95Ms
      });
    }
    snapshot.backlogPerSlot = snapshot.pending / Math.max(1, surfaceState.currentConcurrency);
    const ioPressureByBytes = snapshot.ioPendingBytes / Math.max(1, 256 * 1024 * 1024);
    const ioPressureByWait = snapshot.ioWaitP95Ms / 10000;
    snapshot.ioPressureScore = Math.max(
      0,
      Math.min(
        1.5,
        Math.max(
          snapshot.ioPending > 0 ? (snapshot.ioPending / Math.max(1, surfaceState.currentConcurrency * 2)) : 0,
          ioPressureByBytes,
          ioPressureByWait
        )
      )
    );
    return snapshot;
  };

  const buildAdaptiveSurfaceSnapshots = (at = config.nowMs()) => {
    const out = {};
    for (const surfaceName of config.adaptiveSurfaceStates.keys()) {
      out[surfaceName] = buildAdaptiveSurfaceSnapshotByName(surfaceName, at);
    }
    return out;
  };

  return {
    buildAdaptiveSurfaceSnapshotByName,
    buildAdaptiveSurfaceSnapshots
  };
}
