import { randomUUID } from 'node:crypto';

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const KINDS = new Set(['api', 'mcp', 'indexer']);

/** A capability binds the exact already-admitted job object, never a discovered
 * PID, endpoint or reusable job ID. Cancellation/settlement stay with that job.
 */
export const createTuiServiceControls = ({ requireScope, getJob, cancelJob } = {}) => {
  const owned = new Map();
  const reservations = new Map();
  const enabled = typeof getJob === 'function' && typeof cancelJob === 'function';
  const assertEnabled = () => {
    if (!enabled) fail('ERR_TUI_SERVICE_CONTROL_UNAVAILABLE', 'This workflow owner has no exact supervisor job-control bridge.');
  };
  const prune = () => {
    for (const [id, entry] of owned) {
      if (getJob(entry.jobId) === entry.owner && entry.owner.settled !== true) continue;
      // A terminal/replaced job is not evidence that its protocol resource
      // closed. Preserve its bounded diagnostic/control slot until the exact
      // resource owner confirms closure, even if that observation fails.
      try { if (entry.inspectClosure()?.closed === true) owned.delete(id); } catch {}
    }
  };
  const reserve = ({ scopeId, kind }) => {
    if (!enabled) return null;
    requireScope(scopeId); prune();
    if (!KINDS.has(kind)) fail('ERR_TUI_SERVICE_CONTROL_UNAVAILABLE', 'Unknown owned service kind.');
    if (owned.size + reservations.size >= 6) fail('ERR_TUI_SERVICE_CONTROL_LIMIT', 'The six owned-service control slots remain occupied.');
    const reservation = Object.freeze({});
    reservations.set(reservation, { scopeId, kind });
    return reservation;
  };
  const register = ({ scopeId, kind, jobId, inspectClosure, reservation = null }) => {
    if (!enabled || !KINDS.has(kind) || typeof inspectClosure !== 'function') return null;
    requireScope(scopeId); prune();
    const reserved = reservation === null ? null : reservations.get(reservation);
    if (reservation !== null && (!reserved || reserved.scopeId !== scopeId || reserved.kind !== kind)) {
      fail('ERR_TUI_SERVICE_STALE', 'Service admission no longer belongs to this exact scope/kind.');
    }
    const owner = getJob(jobId);
    if (!owner || owner.internal || owner.finalized || typeof owner.settlement?.then !== 'function') return null;
    const existing = [...owned.values()].find(entry => entry.owner === owner);
    if (existing) { reservations.delete(reservation); return existing.id; }
    if (owned.size + reservations.size - (reserved ? 1 : 0) >= 6) fail('ERR_TUI_SERVICE_CONTROL_LIMIT', 'The six owned-service control slots remain occupied.');
    const id = randomUUID();
    owned.set(id, { id, scopeId, kind, jobId, owner, inspectClosure });
    reservations.delete(reservation);
    return id;
  };
  const list = scopeId => {
    assertEnabled(); requireScope(scopeId); prune();
    return [...owned.values()].filter(entry => entry.scopeId === scopeId).map(entry => {
      let closed = false;
      try { closed = entry.inspectClosure()?.closed === true; } catch {}
      return {
      serviceId: entry.id, service: entry.kind, jobId: entry.jobId, phase: entry.owner.status,
      canStop: getJob(entry.jobId) === entry.owner && entry.owner.settled !== true
        && !entry.owner.finalized && !entry.owner.abortController.signal.aborted,
      stopRequested: entry.owner.abortController.signal.aborted,
      executionSettled: entry.owner.settled === true,
      resourceClosure: closed ? 'confirmed' : 'unconfirmed',
      settlementPending: entry.owner.settled !== true || !closed,
      healthMeaning: 'This control identity proves current-session job ownership only. Health is reported separately by its protocol owner.'
      };
    });
  };
  const stop = async ({ scopeId, serviceId, confirmed }) => {
    assertEnabled(); requireScope(scopeId);
    const entry = owned.get(serviceId);
    if (confirmed !== true) fail('ERR_TUI_SERVICE_CONFIRMATION', 'Confirm the exact selected owned service before stopping.');
    if (!entry || entry.scopeId !== scopeId || getJob(entry.jobId) !== entry.owner
      || entry.owner.settled === true || entry.owner.finalized) {
      fail('ERR_TUI_SERVICE_STALE', 'The selected service is no longer the same active owned job. Refresh services.');
    }
    if (!entry.stopping) {
      // No await occurs between the exact-object comparison and cancellation.
      // The private promise remains retained after an operation timeout/abort.
      if (cancelJob(entry.jobId, 'user_cancel') !== true) fail('ERR_TUI_SERVICE_STALE', 'The exact owned service did not accept cancellation.');
      entry.stopping = Promise.resolve(entry.owner.settlement).then(() => {
        // Job execution can finish with a failed closer. The exact resource map
        // must independently witness removal before this is a stop receipt.
        const closure = entry.inspectClosure();
        const closed = closure?.closed === true;
        if (closed && owned.get(serviceId) === entry) owned.delete(serviceId);
        return { stopRequested: true, executionSettled: true, settled: closed, pending: !closed,
          ...(closed ? {} : { errorCode: 'ERR_TUI_SERVICE_CLOSURE_PENDING' }), service: entry.kind, jobId: entry.jobId,
          finalStatus: entry.owner.status, readinessClaim: false };
      });
      entry.stopping.catch(() => {});
    }
    return entry.stopping;
  };
  return { enabled, reserve, releaseReservation: value => reservations.delete(value), register, list, stop,
    clear() { owned.clear(); reservations.clear(); } };
};
