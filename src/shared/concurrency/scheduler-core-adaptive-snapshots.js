/**
 * Build adaptive-surface queue pressure snapshot for a single surface.
 *
 * @param {{
 *   surfaceName:string,
 *   adaptiveSurfaceStates:Map<string, any>,
 *   queueOrder:any[],
 *   normalizeByteCount:(input:any)=>number,
 *   at:number
 * }} input
 * @returns {object|null}
 */
export const buildAdaptiveSurfaceSnapshotByName = ({
  surfaceName,
  adaptiveSurfaceStates,
  queueOrder,
  normalizeByteCount,
  at
}) => {
  const state = adaptiveSurfaceStates.get(surfaceName);
  if (!state) return null;
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
  for (const queue of queueOrder) {
    if (queue?.surface !== surfaceName) continue;
    const pending = Math.max(0, queue.pending.length);
    const pendingBytes = normalizeByteCount(queue.pendingBytes);
    const running = Math.max(0, queue.running);
    const inFlightBytes = normalizeByteCount(queue.inFlightBytes);
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
  snapshot.backlogPerSlot = snapshot.pending / Math.max(1, state.currentConcurrency);
  const ioPressureByBytes = snapshot.ioPendingBytes / Math.max(1, 256 * 1024 * 1024);
  const ioPressureByWait = snapshot.ioWaitP95Ms / 10000;
  snapshot.ioPressureScore = Math.max(
    0,
    Math.min(
      1.5,
      Math.max(
        snapshot.ioPending > 0 ? (snapshot.ioPending / Math.max(1, state.currentConcurrency * 2)) : 0,
        ioPressureByBytes,
        ioPressureByWait
      )
    )
  );
  return snapshot;
};

/**
 * Build adaptive-surface snapshots for all known surfaces.
 *
 * @param {{
 *   adaptiveSurfaceStates:Map<string, any>,
 *   queueOrder:any[],
 *   normalizeByteCount:(input:any)=>number,
 *   at:number
 * }} input
 * @returns {Record<string, any>}
 */
export const buildAdaptiveSurfaceSnapshots = ({
  adaptiveSurfaceStates,
  queueOrder,
  normalizeByteCount,
  at
}) => {
  const out = {};
  for (const surfaceName of adaptiveSurfaceStates.keys()) {
    out[surfaceName] = buildAdaptiveSurfaceSnapshotByName({
      surfaceName,
      adaptiveSurfaceStates,
      queueOrder,
      normalizeByteCount,
      at
    });
  }
  return out;
};
