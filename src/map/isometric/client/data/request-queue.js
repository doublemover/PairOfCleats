import { SNAPSHOT_PAGE_LIMITS } from './protocol.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';

const cancelled = message => new DOMException(message, 'AbortError');
const reasonFor = signal => { const reason = signal.reason; return reason === undefined ? cancelled('Snapshot request cancelled.') : reason; };

/** Bounded physical concurrency; cancelled work keeps its slot until settled. */
export const createSnapshotRequestQueue = ({ inFlight = SNAPSHOT_PAGE_LIMITS.inFlight, queued = 16 } = {}) => {
  if (!Number.isInteger(inFlight) || inFlight < 1 || !Number.isInteger(queued) || queued < 0) throw new Error('Finite snapshot request budgets required.');
  const queue = [], entries = new Set(), lanes = new Map();
  const metrics = { started: 0, settled: 0, superseded: 0, rejectedAtCapacity: 0, peakRunning: 0, peakQueued: 0 };
  let running = 0, retired = false;
  const complete = entry => {
    if (!entry.settled || entry.completed || entry.adding) return;
    entry.completed = true;
    const { failed, error, value } = entry.outcome, cleanupErrors = [...entry.lateErrors];
    if (failed) entry.listenerOwner?.retainFailure(error);
    try { entry.listenerOwner?.retire(); } catch (cleanup) { cleanupErrors.push(cleanup); }
    if (cleanupErrors.length) entry.reject(preserveSceneCleanupFailures(error, cleanupErrors, { hasPrimary: failed, forceAggregate: true }));
    else if (failed) entry.reject(error);
    else entry.resolve(value);
  };
  const settle = (entry, { failed = false, error, value } = {}) => {
    if (entry.settled) return;
    entry.settled = true; entry.outcome = { failed, error, value };
    if (lanes.get(entry.lane) === entry) lanes.delete(entry.lane);
    complete(entry);
  };
  const cancel = (entry, reason) => {
    if (entry.settled) return;
    let abortFailed = false, abortError;
    try { entry.abort(reason); } catch (error) { abortFailed = true; abortError = error; }
    finally {
      settle(entry, { failed: true, error: abortFailed
        ? preserveSceneCleanupFailures(reason, [abortError], { hasPrimary: true, forceAggregate: true }) : reason });
      if (!entry.running) {
        const position = queue.indexOf(entry); if (position >= 0) queue.splice(position, 1);
        entries.delete(entry);
      }
    }
  };
  const execute = async entry => {
    try { entry.check(); settle(entry, { value: await entry.run(entry.signal) }); }
    catch (error) { settle(entry, { failed: true, error }); }
    finally { running--; metrics.settled++; entries.delete(entry); pump(); }
  };
  const pump = () => {
    if (retired) return;
    while (running < inFlight && queue.length) {
      if (!queue[0].admitted) return;
      const entry = queue.shift(); if (entry.settled) continue;
      entry.running = true; running++; metrics.started++; metrics.peakRunning = Math.max(metrics.peakRunning, running); void execute(entry);
    }
  };
  return Object.freeze({
    request({ lane, signal, run }) {
      if (retired) return Promise.reject(new Error('Snapshot request queue has retired.'));
      if (typeof lane !== 'string' || !lane || typeof run !== 'function') return Promise.reject(new Error('Snapshot operation lane and runner required.'));
      try { if (signal?.aborted) return Promise.reject(reasonFor(signal)); } catch (error) { return Promise.reject(error); }
      const previous = lanes.get(lane);
      if (previous) { metrics.superseded++; cancel(previous, cancelled('Superseded snapshot operation.')); }
      if (retired) return Promise.reject(new Error('Snapshot request queue has retired.'));
      if (queue.length >= queued + Math.max(0, inFlight - running)) {
        metrics.rejectedAtCapacity++;
        return Promise.reject(new Error('Snapshot request queue is full. Close a pending source panel or retry after it settles.'));
      }
      return new Promise((resolve, reject) => {
        const controller = new AbortController(), internalSignal = controller.signal;
        const originalAbort = controller.abort, originalCheck = internalSignal.throwIfAborted;
        const entry = { lane, run, resolve, reject, signal: internalSignal,
          abort: reason => Reflect.apply(originalAbort, controller, [reason]),
          check: () => Reflect.apply(originalCheck, internalSignal, []), settled: false,
          completed: false, outcome: null, lateErrors: [], running: false, admitted: false, adding: false, listenerOwner: null };
        const abort = () => {
          let reason;
          try { reason = reasonFor(signal); } catch (error) { reason = error; }
          cancel(entry, reason); pump();
        };
        entries.add(entry); lanes.set(lane, entry); queue.push(entry);
        try {
          if (signal != null) {
            entry.adding = true;
            entry.listenerOwner = captureSceneResource(signal, 'snapshot original abort listener', 'removeEventListener', ['abort', abort], { required: true });
            entry.listenerOwner.retainFailure(Object.freeze(Object.defineProperty(new Error('Original snapshot abort registration has not returned.'),
              'sceneOwnershipReleased', { value: () => !entry.adding })));
            entry.listenerOwner.assertCaptured();
            if (!entry.settled && !retired) {
              const add = signal.addEventListener;
              if (typeof add !== 'function') throw new TypeError('Snapshot signal has no original addEventListener method.');
              if (!entry.settled && !retired) {
                const result = Reflect.apply(add, signal, ['abort', abort, { once: true }]);
                if (result !== undefined) {
                  entry.listenerOwner.retainFailure(result);
                  throw Object.assign(new Error('Original snapshot abort registration returned no confirmed void outcome.', { cause: result }),
                    { sceneOwnershipPending: true });
                }
              }
            }
          }
        } catch (error) {
          entry.listenerOwner?.retainFailure(error);
          entry.adding = false;
          if (entry.settled) entry.lateErrors.push(error);
          else settle(entry, { failed: true, error });
        } finally { entry.adding = false; }
        complete(entry);
        entry.admitted = true;
        if (entry.settled || retired) {
          if (!entry.settled) cancel(entry, cancelled('Snapshot request owner retired.'));
          const position = queue.indexOf(entry); if (position >= 0) queue.splice(position, 1);
          entries.delete(entry);
        } else {
          try { if (signal?.aborted) abort(); } catch (error) { cancel(entry, error); }
        }
        pump(); metrics.peakQueued = Math.max(metrics.peakQueued, queue.length);
      });
    },
    stats() { return { ...metrics, running, queued: queue.length, inFlightBudget: inFlight, queueBudget: queued }; },
    dispose(reason = cancelled('Snapshot request owner retired.')) {
      if (retired) return;
      retired = true;
      for (const entry of entries) cancel(entry, reason);
      queue.length = 0; lanes.clear();
    }
  });
};
