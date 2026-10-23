import { MAP_DATA_PROTOCOL, SNAPSHOT_PAGE_LIMITS } from './protocol.js';
import { createSnapshotRequestQueue } from './request-queue.js';
import { captureSceneResource, preserveSceneCleanupFailures } from '../scene-retirement.js';

/** One generation, bounded in-flight queries, one cancellable request per lane. */
export const createGraphWorkerClient = ({ snapshot, endpoint, token, demand = false,
  onProgress = () => {}, onFailure = () => {}, WorkerImpl = globalThis.Worker }) => {
  if (typeof WorkerImpl !== 'function') throw new Error('Module workers are unavailable; using retained source navigation.');
  const worker = new WorkerImpl(new URL('./graph-worker.js', import.meta.url), { type: 'module' });
  const pending = new Map(), lanes = new Map(), queue = createSnapshotRequestQueue();
  let serial = 0, retired = false, ready = false, active = 0, notified = false, disposeSent = false, lastFailure = null, post;
  const resourceOwner = captureSceneResource(worker, 'snapshot original module worker', 'terminate', [], { required: true });
  const work = Object.freeze(Object.defineProperty(new Error('Original snapshot worker callback, post or dispatch has not returned.'),
    'sceneOwnershipReleased', { value: () => active === 0 && pending.size === 0 }));
  resourceOwner.retainFailure(work);
  const combine = (primary, errors = []) => preserveSceneCleanupFailures(primary, errors, { hasPrimary: true, forceAggregate: true });
  const retain = error => { resourceOwner.retainFailure(error); return error; };
  const send = message => {
    active++;
    try { return Reflect.apply(post, worker, [message]); }
    catch (error) { retain(error); throw error; }
    finally { active--; }
  };
  const removeRequest = request => {
    const entry = pending.get(request);
    if (!entry) return null;
    pending.delete(request);
    if (lanes.get(entry.lane) === request) lanes.delete(entry.lane);
    return entry;
  };
  const retireRequest = (request, error) => {
    const entry = removeRequest(request);
    if (!entry) return [];
    const errors = [];
    try { entry.cleanup(); } catch (cleanup) { errors.push(retain(cleanup)); }
    entry.reject(combine(error, errors));
    return errors;
  };
  // Each action is independent. A failed transport call cannot strand dispatch
  // promises or prevent the exact captured native owner from being retained.
  const retire = (primary, { sendDispose = false, notify = true } = {}) => {
    retired = true; ready = false;
    retain(primary);
    const errors = [];
    try { queue.dispose(combine(primary)); } catch (error) { errors.push(retain(error)); }
    for (const request of [...pending.keys()]) errors.push(...retireRequest(request, primary));
    if (sendDispose && !disposeSent) {
      disposeSent = true;
      try { send({ protocol: MAP_DATA_PROTOCOL, kind: 'dispose' }); } catch (error) { errors.push(error); }
    }
    try { resourceOwner.retire(); } catch (error) { errors.push(error); }
    lastFailure = combine(primary, errors);
    if (notify && !notified) {
      notified = true;
      try { onFailure(lastFailure); }
      catch (error) { errors.push(retain(error)); lastFailure = combine(primary, errors); }
    }
    return { error: lastFailure, failed: errors.length > 0 };
  };
  // Accepted callbacks drain before ordinary error retirement. Reentrant
  // disposal instead retains original work and needs explicit reconciliation.
  const accept = callback => {
    if (retired) return;
    active++;
    let failed = false, primary;
    try { callback(); } catch (error) { failed = true; primary = retain(error); }
    finally { active--; }
    if (failed) retire(primary);
  };
  const read = (value, keys) => {
    const captured = Object.create(null);
    for (const key of keys) { if (retired) return null; captured[key] = value[key]; }
    return retired ? null : captured;
  };
  const hostError = (message, fallback) => new Error(typeof message === 'string' && message ? message : fallback);
  try {
    resourceOwner.assertCaptured();
    post = worker.postMessage;
    if (typeof post !== 'function') throw new TypeError('Snapshot worker has no original postMessage method.');
    worker.onmessage = event => accept(() => {
      const data = event.data;
      if (retired) return;
      const message = read(data, ['protocol', 'snapshot', 'kind', 'request', 'revision', 'event', 'error', 'value']);
      if (!message || message.protocol !== MAP_DATA_PROTOCOL || message.snapshot !== snapshot) return;
      if (message.kind === 'init') {
        if (message.event === 'error') throw hostError(message.error, 'Snapshot worker initialization failed.');
        if (message.event === 'ready') ready = true;
        onProgress(data); return;
      }
      const entry = pending.get(message.request);
      if (!entry || entry.kind !== message.kind || entry.revision !== message.revision) return;
      removeRequest(message.request);
      try { entry.cleanup(); }
      catch (error) { entry.reject(combine(error)); throw error; }
      if (message.event === 'error') entry.reject(hostError(message.error, 'Snapshot worker query failed.')); else entry.resolve(message.value);
    });
    worker.onerror = event => accept(() => {
      // Inspect the primary before preventDefault; its independent failure must
      // not erase the host's original diagnostic or block pending retirement.
      const message = event.message;
      if (retired) return;
      const primary = hostError(message, 'Snapshot worker failed; retained source navigation remains available.');
      try {
        const prevent = event.preventDefault;
        if (!retired && typeof prevent === 'function') Reflect.apply(prevent, event, []);
      } catch (error) { throw combine(primary, [error]); }
      throw primary;
    });
    worker.onmessageerror = () => accept(() => { throw new Error('Snapshot worker message could not be decoded.'); });
    send({ protocol: MAP_DATA_PROTOCOL, snapshot, request: ++serial, revision: 0, kind: 'init', endpoint, token, demand });
  } catch (error) { throw retire(error, { notify: false }).error; }
  const dispatch = (kind, payload, { revision = 0, signal, lane = kind } = {}) => {
    if (retired || !ready) return Promise.reject(new Error('Snapshot query worker is not ready.'));
    const previous = lanes.get(lane);
    if (previous) {
      const primary = new DOMException('Superseded map query.', 'AbortError'), errors = [];
      try { send({ protocol: MAP_DATA_PROTOCOL, kind: 'cancel', lane }); } catch (error) { errors.push(error); }
      retireRequest(previous, errors.length ? combine(primary, errors) : primary);
      if (errors.length) return Promise.reject(retire(combine(primary, errors)).error);
    }
    if (pending.size >= SNAPSHOT_PAGE_LIMITS.inFlight) return Promise.reject(new Error('Snapshot worker is at its in-flight request budget. Retry after the pending operation.'));
    const id = ++serial;
    return new Promise((resolve, reject) => {
      const aborted = () => {
        const primary = signal.reason === undefined ? new DOMException('Cancelled map query.', 'AbortError') : signal.reason, errors = [];
        if (!retired) try { send({ protocol: MAP_DATA_PROTOCOL, kind: 'cancel', lane }); } catch (error) { errors.push(error); }
        retireRequest(id, combine(primary, errors));
        if (errors.length) retire(combine(primary, errors));
      };
      pending.set(id, { kind, lane, revision, resolve, reject, cleanup: () => signal?.removeEventListener('abort', aborted) });
      lanes.set(lane, id);
      try {
        signal?.addEventListener('abort', aborted, { once: true });
        if (signal?.aborted) { aborted(); return; }
        if (retired || !pending.has(id)) return;
        send({ protocol: MAP_DATA_PROTOCOL, snapshot, request: id, revision, kind, lane, payload });
      } catch (error) { retain(error); retireRequest(id, combine(error)); }
    });
  };
  const request = (kind, payload, options = {}) => queue.request({ lane: options.lane || kind, signal: options.signal,
    run: signal => dispatch(kind, payload, { ...options, signal }) });
  return Object.freeze({ request, stats: () => queue.stats(), get ready() { return ready; },
    get failure() { return lastFailure; }, get resourceOwner() { return retired ? resourceOwner : null; },
    dispose() {
      if (retired) return resourceOwner.retire();
      const outcome = retire(new DOMException('Snapshot query owner retired.', 'AbortError'), { sendDispose: true });
      if (outcome.failed) throw outcome.error;
    } });
};
