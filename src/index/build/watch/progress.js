import { writeProgressEvent } from '../../../shared/cli/progress-events.js';
import { getProgressContext } from '../../../shared/env.js';
import { normalizeProgressMode } from '../../../shared/cli/display/terminal.js';

/** Structured observations through the canonical progress writer. Monitoring
 * readiness proves an admitted watcher only; publication and search/backend
 * readiness remain separate facts. No prose interpretation or inferred percent.
 */
export const createWatchProgress = ({ runtime, emit = writeProgressEvent, stream = process.stderr } = {}) => {
  const enabled = normalizeProgressMode(runtime?.argv?.progress) === 'jsonl';
  const context = getProgressContext() || {};
  let monitoring = false, stopped = false, started = false, previous = null;
  const faults = new Map();
  const faultCode = error => String(error?.code || 'ERR_WATCH_OPERATION').replace(/[^A-Za-z0-9_]/g, '').slice(0, 80);
  const observe = snapshot => {
    if (!enabled || stopped) return;
    const stopping = Boolean(snapshot.shutdownSignal);
    const fault = faults.values().next().value || null;
    const busy = snapshot.running || snapshot.pendingReplay || snapshot.backlogDepth > 0 || !snapshot.quiescent;
    const phase = stopping ? 'stopping' : fault ? 'degraded' : !monitoring ? 'starting' : busy ? 'updating' : 'monitoring';
    const published = snapshot.lastConsistentGeneration?.publicationCommitted === true;
    const payload = { ...context, taskId: 'watch:monitor', name: 'Watch', stage: 'watch', status: 'running',
      phase, state: phase === 'monitoring' ? 'idle' : phase === 'updating' || phase === 'starting' ? 'active' : phase,
      watchReady: monitoring && !fault && !stopping, quiescent: snapshot.quiescent === true,
      backlogDepth: snapshot.backlogDepth, pendingReplay: snapshot.pendingReplay === true,
      consistency: snapshot.consistency, lastEventAt: snapshot.lastEventAt || null,
      activeGeneration: snapshot.activeGeneration || null,
      lastConsistentGeneration: snapshot.lastConsistentGeneration || null,
      publicationCommitted: published,
      readiness: { watcher: monitoring && !fault && !stopping, publishedGeneration: published, searchReady: null },
      degradedReason: fault?.reason || null, errorCode: fault?.code || null,
      degradedReasons: [...faults.keys()],
      message: stopping ? 'Watch shutdown requested; owner teardown remains pending.'
        : fault ? 'Watch is degraded; retained generation evidence is separate.'
          : phase === 'monitoring' ? 'Watcher admitted and idle; index/search readiness is not inferred.'
            : 'Watch has active or queued work; publication remains independently observed.' };
    const identity = JSON.stringify(payload);
    if (identity === previous) return;
    previous = identity;
    // Progress delivery must not replace the existing watch operation/error.
    try { emit(stream, started ? 'task:progress' : 'task:start', payload); } catch {}
    started = true;
  };
  return { observe,
    monitoring(snapshot) { monitoring = true; observe(snapshot); },
    degraded(reason, error, snapshot) { faults.set(reason, { reason, code: faultCode(error) }); observe(snapshot); },
    recovered(snapshot, reasons = ['build', 'validation', 'lock-contention', 'scheduler', 'phase-state', 'outcome']) {
      for (const reason of reasons) faults.delete(reason);
      observe(snapshot);
    },
    stopped(snapshot, error = null) {
      if (!enabled || stopped) return;
      observe(snapshot);
      stopped = true;
      const fault = faults.values().next().value || null;
      try { emit(stream, 'task:end', { ...context, taskId: 'watch:monitor', name: 'Watch', stage: 'watch',
        phase: error ? 'degraded' : 'stopped', state: error ? 'degraded' : 'stopped',
        status: error ? 'failed' : snapshot.shutdownSignal ? 'cancelled' : 'done',
        watchReady: false, quiescent: snapshot.quiescent === true,
        readiness: { watcher: false, publishedGeneration: snapshot.lastConsistentGeneration?.publicationCommitted === true, searchReady: null },
        publicationCommitted: snapshot.lastConsistentGeneration?.publicationCommitted === true,
        errorCode: error ? faultCode(error) : fault?.code || null,
        ownershipPending: error?.cacheOwnershipPending === true,
        degradedReason: error ? 'teardown' : fault?.reason || null,
        message: error ? 'Watch teardown did not complete; ownership remains governed by the original error.'
          : 'Watcher closed and active watch work drained; index readiness remains a separate observation.' }); } catch {}
    }
  };
};
